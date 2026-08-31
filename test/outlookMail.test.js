const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');

const {
  FIXED_MAILBOX,
  createGraphClient,
  createOutlookConfig,
  validateGraphUrl
} = require('../outlookMail/graphClient');
const {
  createOutlookService,
  normalizeAttachments,
  sanitizeMessageHtml
} = require('../outlookMail/service');
const { SIGNATURE_LOGO_URL, SIGNATURE_MARKER } = require('../outlookMail/signature');
const { createOutlookRouter } = require('../outlookMail/router');

function configuredEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    MICROSOFT_TENANT_ID: 'tenant-id',
    MICROSOFT_CLIENT_ID: 'client-id',
    MICROSOFT_CLIENT_SECRET: 'client-secret',
    OUTLOOK_CURSOR_SECRET: 'cursor-secret-at-least-for-tests',
    OUTLOOK_MAILBOX_ADDRESS: FIXED_MAILBOX,
    OUTLOOK_ALLOWED_MAILBOXES: FIXED_MAILBOX,
    ...overrides
  };
}

function configuredConfig(overrides = {}) {
  return { ...createOutlookConfig(configuredEnv()), ...overrides };
}

function responseHeaders(values = {}) {
  const normalized = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
  return { get: (name) => normalized.get(String(name).toLowerCase()) || null };
}

function graphResponse(status, body = null, headers = {}) {
  const raw = Buffer.isBuffer(body)
    ? body
    : Buffer.from(body === null || body === undefined ? '' : JSON.stringify(body));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: responseHeaders(headers),
    async text() { return raw.toString('utf8'); },
    async json() {
      if (!raw.length) throw new SyntaxError('Empty Graph response');
      return JSON.parse(raw.toString('utf8'));
    },
    async arrayBuffer() {
      return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    }
  };
}

function mailboxUrl(suffix = '') {
  return `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(FIXED_MAILBOX)}${suffix}`;
}

function signCursor(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

async function listenWithRouter(t, service, options = {}) {
  const app = express();
  app.use((req, res, next) => {
    req.user = { id: 'test-user', role: req.get('x-test-role') || 'direktor' };
    next();
  });
  app.use('/api/outlook', createOutlookRouter({
    service,
    config: service.config,
    ...options
  }));
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  }));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function routerRequest(baseUrl, options = {}) {
  const url = new URL(options.path || '/api/outlook/status', baseUrl);
  const payload = options.rawBody !== undefined
    ? String(options.rawBody)
    : (options.body === undefined ? null : JSON.stringify(options.body));
  const headers = {
    'x-test-role': options.role || 'direktor',
    ...(options.headers || {})
  };
  if (payload !== null) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(payload));
  }
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: options.method || 'GET',
      headers
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let body = null;
        try { body = raw ? JSON.parse(raw) : null; } catch (error) { body = raw; }
        resolve({ status: response.statusCode, headers: response.headers, body, raw });
      });
    });
    request.once('error', reject);
    if (payload !== null) request.write(payload);
    request.end();
  });
}

test('konfiguracija je vezana za sales mailbox, a pisanje je iskljuceno po defaultu', () => {
  const defaults = createOutlookConfig(configuredEnv({ OUTLOOK_MAIL_WRITES_ENABLED: undefined }));
  assert.equal(defaults.mailbox, FIXED_MAILBOX);
  assert.equal(defaults.configured, true);
  assert.equal(defaults.writeEnabled, false);

  const nonBoolean = createOutlookConfig(configuredEnv({ OUTLOOK_MAIL_WRITES_ENABLED: '1' }));
  assert.equal(nonBoolean.writeEnabled, false);

  const enabled = createOutlookConfig(configuredEnv({ OUTLOOK_MAIL_WRITES_ENABLED: 'true' }));
  assert.equal(enabled.writeEnabled, true);

  const hostile = createOutlookConfig(configuredEnv({
    OUTLOOK_MAILBOX_ADDRESS: 'director@s-consulting.ba',
    OUTLOOK_ALLOWED_MAILBOXES: 'director@s-consulting.ba'
  }));
  assert.equal(hostile.mailbox, FIXED_MAILBOX);
  assert.equal(hostile.configured, false);
  assert.match(hostile.configurationMessage, /mailbox/i);
});

test('Graph koristi app-only scope, fiksni mailbox i immutable ID header', async () => {
  const tokenRequests = [];
  const fetchCalls = [];
  const graph = createGraphClient({
    config: configuredConfig({ maxReadRetries: 0 }),
    msalClient: {
      async acquireTokenByClientCredential(request) {
        tokenRequests.push(request);
        return { accessToken: 'app-only-token' };
      }
    },
    async fetchImpl(url, request) {
      fetchCalls.push({ url: String(url), request });
      return graphResponse(200, { value: [] });
    }
  });

  await graph.request(graph.mailboxPath('/mailFolders/inbox/messages'));

  assert.deepEqual(tokenRequests, [{
    scopes: ['https://graph.microsoft.com/.default'],
    skipCache: false
  }]);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, mailboxUrl('/mailFolders/inbox/messages'));
  assert.equal(fetchCalls[0].request.headers.Authorization, 'Bearer app-only-token');
  assert.equal(fetchCalls[0].request.headers.Prefer, 'IdType="ImmutableId"');
  assert.throws(
    () => graph.validateGraphUrl('https://graph.microsoft.com/v1.0/users/director%40s-consulting.ba/messages'),
    (error) => error.code === 'INVALID_CURSOR' && error.status === 400
  );
});

test('Graph read retry postuje Retry-After, a transientni write se ne ponavlja', async () => {
  const sleeps = [];
  const readResponses = [
    graphResponse(429, { error: { message: 'throttled' } }, { 'Retry-After': '2' }),
    graphResponse(200, { value: [] })
  ];
  let readCalls = 0;
  const readGraph = createGraphClient({
    config: configuredConfig({ maxReadRetries: 2 }),
    msalClient: { async acquireTokenByClientCredential() { return { accessToken: 'token' }; } },
    async fetchImpl() {
      readCalls += 1;
      return readResponses.shift();
    },
    async sleep(milliseconds) { sleeps.push(milliseconds); }
  });

  await readGraph.request(readGraph.mailboxPath('/messages'));
  assert.equal(readCalls, 2);
  assert.deepEqual(sleeps, [2000]);

  let writeCalls = 0;
  const writeSleeps = [];
  const writeGraph = createGraphClient({
    config: configuredConfig({ maxReadRetries: 3 }),
    msalClient: { async acquireTokenByClientCredential() { return { accessToken: 'token' }; } },
    async fetchImpl() {
      writeCalls += 1;
      return graphResponse(503, { error: { message: 'temporarily unavailable' } }, { 'Retry-After': '1' });
    },
    async sleep(milliseconds) { writeSleeps.push(milliseconds); }
  });

  await assert.rejects(
    writeGraph.request(writeGraph.mailboxPath('/messages'), {
      method: 'POST',
      body: { subject: 'Do not duplicate' },
      idempotent: false
    }),
    (error) => error.code === 'OUTLOOK_GRAPH_ERROR' && error.status === 502
  );
  assert.equal(writeCalls, 1);
  assert.deepEqual(writeSleeps, []);
});

test('Graph 401 osvjezava app-only token samo jednom', async () => {
  const tokenRequests = [];
  const responses = [graphResponse(401, { error: { message: 'expired' } }), graphResponse(200, { id: 'message-id' })];
  const graph = createGraphClient({
    config: configuredConfig({ maxReadRetries: 0 }),
    msalClient: {
      async acquireTokenByClientCredential(request) {
        tokenRequests.push(request);
        return { accessToken: request.skipCache ? 'fresh-token' : 'cached-token' };
      }
    },
    async fetchImpl() { return responses.shift(); }
  });

  const result = await graph.request(graph.mailboxPath('/messages/message-id'));
  assert.equal(result.data.id, 'message-id');
  assert.deepEqual(tokenRequests.map((request) => request.skipCache), [false, true]);
});

test('HTML sanitizer uklanja aktivni sadrzaj i zadrzava sigurne linkove', () => {
  const dirty = [
    '<p onclick="steal()">Pozdrav <strong>tim</strong></p>',
    '<script>alert(1)</script>',
    '<iframe src="https://evil.example"></iframe>',
    '<img src="https://tracker.example/pixel.gif" onerror="steal()">',
    '<a href="javascript:alert(2)">opasan</a>',
    '<a href="https://s-consulting.ba/ponuda" title="Ponuda">siguran</a>'
  ].join('');

  const clean = sanitizeMessageHtml(dirty);
  assert.match(clean, /<strong>tim<\/strong>/);
  assert.match(clean, /href="https:\/\/s-consulting\.ba\/ponuda"/);
  assert.match(clean, /rel="noopener noreferrer"/);
  assert.match(clean, /target="_blank"/);
  assert.doesNotMatch(clean, /<script|<iframe|<img/i);
  assert.doesNotMatch(clean, /onclick|onerror|javascript:|tracker\.example/i);
});

test('attachment validacija provodi base64, broj, pojedinacni i ukupni limit', () => {
  const config = configuredConfig({
    maxAttachments: 2,
    maxAttachmentBytes: 5,
    maxTotalAttachmentBytes: 9
  });
  const fiveBytes = Buffer.from('12345').toString('base64');
  const valid = normalizeAttachments([{
    name: '../../ponuda"\r\n.pdf',
    contentType: 'application/pdf',
    contentBytes: fiveBytes,
    size: 5
  }], config);

  assert.equal(valid.length, 1);
  assert.equal(valid[0].size, 5);
  assert.equal(valid[0].contentBytes, fiveBytes);
  assert.doesNotMatch(valid[0].name, /[\\/"\r\n]/);
  assert.doesNotMatch(valid[0].name, /^\./);

  assert.throws(
    () => normalizeAttachments([{ name: 'bad.bin', contentBytes: '***=' }], config),
    (error) => error.code === 'OUTLOOK_INVALID_ATTACHMENT' && error.status === 400
  );
  assert.throws(
    () => normalizeAttachments([{
      name: 'large.bin',
      contentBytes: Buffer.from('123456').toString('base64')
    }], config),
    (error) => error.code === 'OUTLOOK_ATTACHMENT_TOO_LARGE' && error.status === 413
  );
  assert.throws(
    () => normalizeAttachments([
      { name: 'one.bin', contentBytes: fiveBytes },
      { name: 'two.bin', contentBytes: fiveBytes }
    ], config),
    (error) => error.code === 'OUTLOOK_ATTACHMENTS_TOO_LARGE' && error.status === 413
  );
  assert.throws(
    () => normalizeAttachments([
      { name: 'one.bin', contentBytes: fiveBytes },
      { name: 'two.bin', contentBytes: fiveBytes },
      { name: 'three.bin', contentBytes: fiveBytes }
    ], config),
    (error) => error.code === 'OUTLOOK_TOO_MANY_ATTACHMENTS' && error.status === 413
  );
  assert.throws(
    () => normalizeAttachments([{ name: 'wrong-size.bin', contentBytes: fiveBytes, size: 4 }], config),
    (error) => error.code === 'OUTLOOK_INVALID_ATTACHMENT' && error.status === 400
  );
});

test('cursor je potpisan, vezan za kontekst i ne moze usmjeriti Graph na drugi mailbox', async () => {
  const secret = 'cursor-secret-at-least-for-tests';
  const graphCalls = [];
  const graph = {
    mailboxPath: mailboxUrl,
    validateGraphUrl: (value) => validateGraphUrl(value, FIXED_MAILBOX),
    async request(url) {
      graphCalls.push(String(url));
      if (graphCalls.length === 1) {
        return {
          data: {
            value: [{ id: 'CaseSensitiveId', subject: 'Test' }],
            '@odata.nextLink': mailboxUrl('/mailFolders/inbox/messages?$skiptoken=opaque-state')
          }
        };
      }
      return { data: { value: [] } };
    }
  };
  const service = createOutlookService({
    config: configuredConfig({ cursorSecret: secret }),
    graphClient: graph
  });
  const query = { folder: 'inbox', search: 'firma', unreadOnly: true, limit: 10 };
  const first = await service.listMessages(query);
  assert.equal(first.items[0].id, 'CaseSensitiveId');
  assert.ok(first.nextCursor);

  await service.listMessages({ ...query, cursor: first.nextCursor });
  assert.equal(graphCalls.length, 2);
  assert.match(graphCalls[1], /\$skiptoken=opaque-state/);

  const [encoded, signature] = first.nextCursor.split('.');
  const changedFirstCharacter = signature[0] === 'A' ? 'B' : 'A';
  const tampered = `${encoded}.${changedFirstCharacter}${signature.slice(1)}`;
  await assert.rejects(
    service.listMessages({ ...query, cursor: tampered }),
    (error) => error.code === 'INVALID_CURSOR' && error.status === 400
  );
  await assert.rejects(
    service.listMessages({ ...query, search: 'drugi kontekst', cursor: first.nextCursor }),
    (error) => error.code === 'INVALID_CURSOR' && error.status === 400
  );

  const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  const expired = signCursor({ ...decoded, issuedAt: Date.now() - 3600001 }, secret);
  await assert.rejects(
    service.listMessages({ ...query, cursor: expired }),
    (error) => error.code === 'INVALID_CURSOR' && error.status === 400
  );
  assert.equal(graphCalls.length, 2);

  const crossMailboxGraph = {
    mailboxPath: mailboxUrl,
    validateGraphUrl: (value) => validateGraphUrl(value, FIXED_MAILBOX),
    async request() {
      return {
        data: {
          value: [],
          '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users/director%40s-consulting.ba/messages?$skiptoken=foreign'
        }
      };
    }
  };
  const crossMailboxService = createOutlookService({
    config: configuredConfig({ cursorSecret: secret }),
    graphClient: crossMailboxGraph
  });
  await assert.rejects(
    crossMailboxService.listMessages(query),
    (error) => error.code === 'INVALID_CURSOR' && error.status === 400
  );
});

test('getAccount cita samo Inbox i ne zahtijeva users mailbox root', async () => {
  const graphCalls = [];
  const graph = {
    mailboxPath: mailboxUrl,
    validateGraphUrl: (value) => validateGraphUrl(value, FIXED_MAILBOX),
    async request(url) {
      graphCalls.push(String(url));
      return {
        data: {
          id: 'inbox-id',
          displayName: 'Inbox',
          totalItemCount: 12,
          unreadItemCount: 3
        }
      };
    }
  };
  const service = createOutlookService({
    config: configuredConfig(),
    graphClient: graph
  });

  const account = await service.getAccount();

  assert.deepEqual(account, {
    mailbox: FIXED_MAILBOX,
    displayName: FIXED_MAILBOX,
    inbox: { totalCount: 12, unreadCount: 3 }
  });
  assert.equal(graphCalls.length, 1);
  assert.match(graphCalls[0], /\/mailFolders\/inbox\?/);
  assert.notEqual(graphCalls[0], mailboxUrl());
  assert.doesNotMatch(graphCalls[0], new RegExp(`/users/${encodeURIComponent(FIXED_MAILBOX)}/?(?:\\?|$)`));
});

test('folderi se citaju bez naleta i jedan Graph 429 ne obara dostupni Inbox', async () => {
  const graphCalls = [];
  const graph = {
    mailboxPath: mailboxUrl,
    validateGraphUrl: (value) => validateGraphUrl(value, FIXED_MAILBOX),
    async request(url) {
      const key = String(url).match(/\/mailFolders\/([^?]+)/)?.[1];
      graphCalls.push(key);
      if (key === 'drafts') {
        throw Object.assign(new Error('Microsoft Graph zahtjev nije uspio.'), {
          status: 429,
          code: 'OUTLOOK_GRAPH_ERROR'
        });
      }
      return {
        data: {
          id: `${key}-id`,
          displayName: key,
          totalItemCount: key === 'inbox' ? 12 : 2,
          unreadItemCount: key === 'inbox' ? 3 : 0
        }
      };
    }
  };
  const service = createOutlookService({ config: configuredConfig(), graphClient: graph });

  const [account, folders] = await Promise.all([service.getAccount(), service.listFolders()]);

  assert.deepEqual(account.inbox, { totalCount: 12, unreadCount: 3 });
  assert.equal(graphCalls.filter((key) => key === 'inbox').length, 1);
  assert.deepEqual(graphCalls, ['inbox', 'sentitems', 'drafts', 'archive', 'junkemail', 'deleteditems']);
  assert.equal(folders.partial, true);
  assert.deepEqual(folders.unavailable, ['drafts']);
  assert.deepEqual(folders.items.find((item) => item.key === 'drafts'), {
    key: 'drafts',
    name: 'Nacrti',
    totalCount: 0,
    unreadCount: 0,
    unavailable: true
  });
});

test('service send sanitizira HTML, kreira draft i odbija klijentski sender/mailbox', async () => {
  const graphCalls = [];
  const graph = {
    mailboxPath: mailboxUrl,
    validateGraphUrl: (value) => validateGraphUrl(value, FIXED_MAILBOX),
    async request(url, options = {}) {
      graphCalls.push({ url: String(url), options });
      if (String(url) === mailboxUrl('/messages')) {
        return { data: { id: 'DraftCaseSensitive', conversationId: 'conversation-id' } };
      }
      return { data: null };
    }
  };
  const service = createOutlookService({
    config: configuredConfig({ writeEnabled: true }),
    graphClient: graph
  });

  const result = await service.send({
    to: ['TEST@S-CONSULTING.BA'],
    subject: 'Sigurna poruka',
    bodyType: 'html',
    body: '<p onclick="steal()">Pozdrav</p><script>alert(1)</script><a href="https://s-consulting.ba">link</a>'
  });

  assert.equal(result.accepted, true);
  assert.equal(result.id, 'DraftCaseSensitive');
  assert.equal(graphCalls.length, 2);
  assert.equal(graphCalls[0].url, mailboxUrl('/messages'));
  assert.equal(graphCalls[0].options.method, 'POST');
  assert.equal(graphCalls[0].options.idempotent, false);
  assert.deepEqual(graphCalls[0].options.body.toRecipients, [
    { emailAddress: { address: 'test@s-consulting.ba' } }
  ]);
  assert.doesNotMatch(graphCalls[0].options.body.body.content, /script|onclick|alert\(1\)/i);
  assert.match(graphCalls[0].options.body.body.content, /rel="noopener noreferrer"/);
  assert.equal(graphCalls[0].options.body.body.contentType, 'HTML');
  assert.equal((graphCalls[0].options.body.body.content.match(new RegExp(SIGNATURE_MARKER, 'g')) || []).length, 1);
  assert.match(graphCalls[0].options.body.body.content, new RegExp(SIGNATURE_LOGO_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(graphCalls[0].options.body.body.content, /Ermina Siručić/);
  assert.match(graphCalls[0].options.body.body.content, /info@s-consulting\.ba/);
  assert.equal(graphCalls[1].url, mailboxUrl('/messages/DraftCaseSensitive/send'));
  assert.equal(graphCalls[1].options.idempotent, false);

  for (const key of ['from', 'sender', 'mailbox']) {
    await assert.rejects(
      service.send({
        to: ['test@s-consulting.ba'],
        subject: 'Nedozvoljeno polje',
        body: 'Tekst',
        [key]: 'director@s-consulting.ba'
      }),
      (error) => error.code === 'OUTLOOK_UNKNOWN_FIELD' && error.status === 400
    );
  }
  assert.equal(graphCalls.length, 2);
});

test('uređeni potpis se šalje tačno jednom i opasni sadržaj ostaje escaped', async () => {
  const graphCalls = [];
  const graph = {
    mailboxPath: mailboxUrl,
    validateGraphUrl: (value) => validateGraphUrl(value, FIXED_MAILBOX),
    async request(url, options = {}) {
      graphCalls.push({ url: String(url), options });
      if (String(url) === mailboxUrl('/messages')) {
        return { data: { id: 'CustomSignatureDraft', conversationId: 'custom-signature-conversation' } };
      }
      return { data: null };
    }
  };
  const service = createOutlookService({
    config: configuredConfig({ writeEnabled: true }),
    graphClient: graph
  });

  await service.send({
    to: ['test@s-consulting.ba'],
    subject: 'Uređeni potpis',
    bodyType: 'text',
    body: 'Poruka iz CRM-a',
    signature: {
      greeting: 'Srdačan pozdrav,',
      name: 'Komercijalista <script>alert(1)</script>',
      title: 'Prodaja | S-Consulting Group',
      mobile: '+387 61 111 222',
      phone: '',
      email: 'sales@s-consulting.ba',
      website: 'www.s-consulting.ba/prodaja',
      address: 'Tvornička 3, Sarajevo'
    }
  });

  const content = graphCalls[0].options.body.body.content;
  assert.equal((content.match(new RegExp(SIGNATURE_MARKER, 'g')) || []).length, 1);
  assert.match(content, /Srdačan pozdrav/);
  assert.match(content, /Komercijalista &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(content, /<script>/i);
  assert.doesNotMatch(content, /Ermina Siručić/);
  assert.match(content, /mailto:sales@s-consulting\.ba/);
  assert.match(content, /https:\/\/www\.s-consulting\.ba\/prodaja/);
  assert.match(content, new RegExp(SIGNATURE_LOGO_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(graphCalls.length, 2);

  await assert.rejects(
    service.send({
      to: ['test@s-consulting.ba'],
      subject: 'Neispravan potpis',
      body: 'Tekst',
      signature: { email: 'nije-email' }
    }),
    (error) => error.code === 'OUTLOOK_INVALID_SIGNATURE' && error.status === 400
  );
  assert.equal(graphCalls.length, 2, 'neispravan potpis ne smije kreirati Graph draft');
});

test('reply i forward workflow koriste server-side draft, a read-only service blokira sve write akcije', async () => {
  const graphCalls = [];
  let draftNumber = 0;
  const graph = {
    mailboxPath: mailboxUrl,
    validateGraphUrl: (value) => validateGraphUrl(value, FIXED_MAILBOX),
    async request(url, options = {}) {
      const call = { url: String(url), options };
      graphCalls.push(call);
      if (/\/(createReply|createReplyAll|createForward)$/.test(call.url)) {
        draftNumber += 1;
        return { data: { id: `ReplyDraft${draftNumber}`, conversationId: `conversation-${draftNumber}` } };
      }
      if (options.method === 'PATCH') {
        return { data: { id: call.url.split('/').pop(), conversationId: `conversation-${draftNumber}` } };
      }
      return { data: null };
    }
  };
  const service = createOutlookService({
    config: configuredConfig({ writeEnabled: true }),
    graphClient: graph
  });

  const reply = await service.reply('OriginalId', {
    bodyType: 'html',
    body: '<p>Odgovor</p><script>bad()</script>',
    cc: ['cc@s-consulting.ba']
  });
  assert.equal(reply.accepted, true);
  assert.deepEqual(graphCalls.slice(0, 3).map((call) => call.url), [
    mailboxUrl('/messages/OriginalId/createReply'),
    mailboxUrl('/messages/ReplyDraft1'),
    mailboxUrl('/messages/ReplyDraft1/send')
  ]);
  assert.doesNotMatch(graphCalls[1].options.body.body.content, /script|bad\(\)/i);
  assert.deepEqual(graphCalls[1].options.body.ccRecipients, [
    { emailAddress: { address: 'cc@s-consulting.ba' } }
  ]);

  const forward = await service.forward('OriginalId', {
    to: ['forward@s-consulting.ba'],
    bodyType: 'text',
    body: 'Proslijedjeno'
  });
  assert.equal(forward.accepted, true);
  assert.deepEqual(graphCalls.slice(3, 6).map((call) => call.url), [
    mailboxUrl('/messages/OriginalId/createForward'),
    mailboxUrl('/messages/ReplyDraft2'),
    mailboxUrl('/messages/ReplyDraft2/send')
  ]);
  assert.deepEqual(graphCalls[4].options.body.toRecipients, [
    { emailAddress: { address: 'forward@s-consulting.ba' } }
  ]);
  assert.equal(graphCalls[4].options.body.body.contentType, 'HTML');
  assert.match(graphCalls[4].options.body.body.content, /Proslijedjeno/);
  assert.equal((graphCalls[4].options.body.body.content.match(new RegExp(SIGNATURE_MARKER, 'g')) || []).length, 1);

  const callsBeforeInvalidReply = graphCalls.length;
  await assert.rejects(
    service.reply('OriginalId', { to: ['override@s-consulting.ba'], body: 'Nije dozvoljeno' }),
    (error) => error.code === 'OUTLOOK_INVALID_INPUT' && error.status === 400
  );
  assert.equal(graphCalls.length, callsBeforeInvalidReply, 'nevalidan reply ne smije kreirati orphan Graph draft');

  let readOnlyGraphCalls = 0;
  const readOnly = createOutlookService({
    config: configuredConfig({ writeEnabled: false }),
    graphClient: {
      mailboxPath: mailboxUrl,
      validateGraphUrl: (value) => validateGraphUrl(value, FIXED_MAILBOX),
      async request() { readOnlyGraphCalls += 1; return { data: {} }; }
    }
  });
  const writeAttempts = [
    () => readOnly.markRead('MessageId', true),
    () => readOnly.moveMessage('MessageId', 'archive'),
    () => readOnly.deleteMessage('MessageId'),
    () => readOnly.send({}),
    () => readOnly.reply('MessageId', {}),
    () => readOnly.replyAll('MessageId', {}),
    () => readOnly.forward('MessageId', {})
  ];
  for (const attempt of writeAttempts) {
    await assert.rejects(
      attempt(),
      (error) => error.code === 'OUTLOOK_WRITES_DISABLED' && error.status === 503
    );
  }
  assert.equal(readOnlyGraphCalls, 0);
});

test('message detail sanitizira HTML i attachment metadata ne iznosi contentBytes', async () => {
  const requestedUrls = [];
  const graph = {
    mailboxPath: mailboxUrl,
    validateGraphUrl: (value) => validateGraphUrl(value, FIXED_MAILBOX),
    async request(url) {
      requestedUrls.push(String(url));
      if (String(url).includes('/attachments?')) {
        return {
          data: {
            value: [{
              '@odata.type': '#microsoft.graph.fileAttachment',
              id: 'AttachmentId',
              name: 'ponuda.pdf',
              contentType: 'application/pdf',
              size: 123,
              isInline: false,
              contentId: null,
              contentBytes: 'SECRET-BASE64-MUST-NOT-LEAK'
            }]
          }
        };
      }
      return {
        data: {
          id: 'MessageId',
          subject: 'Detalj',
          hasAttachments: true,
          body: {
            contentType: 'HTML',
            content: '<p onmouseover="steal()">Sadrzaj</p><img src="https://tracker.example/pixel"><script>bad()</script>'
          },
          bccRecipients: [{ emailAddress: { name: 'Test', address: 'test@s-consulting.ba' } }]
        }
      };
    }
  };
  const service = createOutlookService({
    config: configuredConfig(),
    graphClient: graph
  });

  const detail = await service.getMessage('MessageId');

  assert.equal(detail.id, 'MessageId');
  assert.equal(detail.body.contentType, 'html');
  assert.match(detail.body.content, /Sadrzaj/);
  assert.doesNotMatch(detail.body.content, /script|onmouseover|tracker\.example|<img/i);
  assert.deepEqual(detail.attachments, [{
    id: 'AttachmentId',
    name: 'ponuda.pdf',
    contentType: 'application/pdf',
    size: 123,
    isInline: false,
    contentId: null,
    type: 'file'
  }]);
  assert.equal('contentBytes' in detail.attachments[0], false);
  assert.doesNotMatch(JSON.stringify(detail), /SECRET-BASE64-MUST-NOT-LEAK/);
  assert.equal(requestedUrls.length, 2);
  assert.equal(requestedUrls.some((url) => /[?&,]contentId(?:[&,]|$)/i.test(decodeURIComponent(url))), false);
});

test('message detail bez priloga radi jednim Graph zahtjevom', async () => {
  const requestedUrls = [];
  const graph = {
    mailboxPath: mailboxUrl,
    validateGraphUrl: (value) => validateGraphUrl(value, FIXED_MAILBOX),
    async request(url) {
      requestedUrls.push(String(url));
      return {
        data: {
          id: 'MessageWithoutAttachments',
          subject: 'Brza poruka',
          hasAttachments: false,
          body: { contentType: 'Text', content: 'Sadrzaj' }
        }
      };
    }
  };
  const service = createOutlookService({ config: configuredConfig(), graphClient: graph });

  const detail = await service.getMessage('MessageWithoutAttachments');

  assert.equal(detail.id, 'MessageWithoutAttachments');
  assert.deepEqual(detail.attachments, []);
  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0].includes('/attachments?'), false);
});

test('download service provjerava tip i limite prije raw fetcha', async () => {
  let rawFetches = 0;
  const requestedUrls = [];
  const metadata = {
    '@odata.type': '#microsoft.graph.fileAttachment',
    id: 'AttachmentId',
    name: 'ponuda.pdf',
    contentType: 'application/pdf',
    size: 6,
    isInline: false
  };
  const graph = {
    mailboxPath: mailboxUrl,
    validateGraphUrl: (value) => validateGraphUrl(value, FIXED_MAILBOX),
    async request(url) {
      requestedUrls.push(String(url));
      if (String(url).endsWith('/$value')) {
        rawFetches += 1;
        return { data: Buffer.from('123456') };
      }
      return { data: metadata };
    }
  };
  const service = createOutlookService({
    config: configuredConfig({ maxAttachmentBytes: 5 }),
    graphClient: graph
  });

  await assert.rejects(
    service.downloadAttachment('MessageId', 'AttachmentId'),
    (error) => error.code === 'OUTLOOK_ATTACHMENT_TOO_LARGE' && error.status === 413
  );
  assert.equal(rawFetches, 0);

  metadata.size = 4;
  await assert.rejects(
    service.downloadAttachment('MessageId', 'AttachmentId'),
    (error) => error.code === 'OUTLOOK_ATTACHMENT_TOO_LARGE' && error.status === 413
  );
  assert.equal(rawFetches, 1);

  metadata['@odata.type'] = '#microsoft.graph.referenceAttachment';
  metadata.size = 1;
  await assert.rejects(
    service.downloadAttachment('MessageId', 'AttachmentId'),
    (error) => error.code === 'OUTLOOK_ATTACHMENT_TYPE_UNSUPPORTED' && error.status === 415
  );
  assert.equal(rawFetches, 1);
  assert.equal(requestedUrls.some((url) => /[?&,]contentId(?:[&,]|$)/i.test(decodeURIComponent(url))), false);
});

test('router dozvoljava direktor i komercijala role, a odbija ostale', async (t) => {
  let statusCalls = 0;
  const service = {
    config: { writeEnabled: false },
    status() {
      statusCalls += 1;
      return { mailbox: FIXED_MAILBOX, status: 'read_only' };
    }
  };
  const baseUrl = await listenWithRouter(t, service);

  const director = await routerRequest(baseUrl, { role: 'direktor' });
  const commercial = await routerRequest(baseUrl, { role: 'komercijala' });
  const other = await routerRequest(baseUrl, { role: 'racunovodstvo' });

  assert.equal(director.status, 200);
  assert.equal(commercial.status, 200);
  assert.equal(other.status, 403);
  assert.equal(statusCalls, 2);
  assert.equal(director.headers['cache-control'], 'no-store');
});

test('router write gate radi prije JSON parsera i ne poziva servis', async (t) => {
  let sendCalls = 0;
  const service = {
    config: { writeEnabled: false },
    async send() {
      sendCalls += 1;
      return { success: true };
    }
  };
  const baseUrl = await listenWithRouter(t, service);
  const response = await routerRequest(baseUrl, {
    method: 'POST',
    path: '/api/outlook/send',
    rawBody: '{ ovo nije validan JSON'
  });

  assert.equal(response.status, 503);
  assert.equal(response.body.code, 'OUTLOOK_WRITES_DISABLED');
  assert.equal(sendCalls, 0);
});

test('download router postavlja sigurne attachment headere i ne iznosi filename direktno', async (t) => {
  const service = {
    config: { writeEnabled: false },
    async downloadAttachment(messageId, attachmentId) {
      assert.equal(messageId, 'MessageId');
      assert.equal(attachmentId, 'AttachmentId');
      return {
        data: Buffer.from('PDF!'),
        filename: 'ponuda ćš.pdf',
        contentType: 'application/pdf',
        size: 4
      };
    }
  };
  const baseUrl = await listenWithRouter(t, service);
  const response = await routerRequest(baseUrl, {
    path: '/api/outlook/messages/MessageId/attachments/AttachmentId'
  });

  assert.equal(response.status, 200);
  assert.equal(response.raw, 'PDF!');
  assert.equal(response.headers['content-type'], 'application/pdf');
  assert.equal(response.headers['content-length'], '4');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.match(response.headers['content-disposition'], /^attachment; filename="attachment"; filename\*=UTF-8''ponuda%20/);
  assert.doesNotMatch(response.headers['content-disposition'], /[\r\n]/);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('Outlook router prihvata autentikovan base64 JSON payload veci od 1 MB', async (t) => {
  let receivedPayload;
  const service = {
    config: { writeEnabled: true },
    async send(payload) {
      receivedPayload = payload;
      return { success: true, accepted: true, id: 'draft-id' };
    }
  };
  const baseUrl = await listenWithRouter(t, service);
  const contentBytes = Buffer.alloc(800000, 7).toString('base64');
  const payload = {
    to: ['test@s-consulting.ba'],
    subject: 'Veliki JSON prilog',
    body: 'Test',
    attachments: [{
      name: 'test.bin',
      contentType: 'application/octet-stream',
      contentBytes
    }]
  };
  assert.ok(Buffer.byteLength(JSON.stringify(payload)) > 1024 * 1024);

  const response = await routerRequest(baseUrl, {
    method: 'POST',
    path: '/api/outlook/send',
    body: payload
  });

  assert.equal(response.status, 202);
  assert.equal(response.body.accepted, true);
  assert.equal(receivedPayload.attachments[0].contentBytes.length, contentBytes.length);
});
