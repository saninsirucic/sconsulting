const crypto = require('crypto');
const sanitizeHtml = require('sanitize-html');
const { OutlookError, createGraphClient, createOutlookConfig } = require('./graphClient');
const { appendAutomaticSignature, escapePlainText } = require('./signature');

const FOLDERS = Object.freeze({
  inbox: 'Inbox',
  sentitems: 'Poslano',
  drafts: 'Nacrti',
  archive: 'Arhiva',
  junkemail: 'Bezvrijedna pošta',
  deleteditems: 'Obrisano'
});
const MESSAGE_SELECT = [
  'id', 'conversationId', 'internetMessageId', 'subject', 'from', 'sender',
  'toRecipients', 'ccRecipients', 'receivedDateTime', 'sentDateTime',
  'hasAttachments', 'importance', 'isRead', 'isDraft', 'bodyPreview'
].join(',');
const DETAIL_SELECT = `${MESSAGE_SELECT},bccRecipients,body`;
// `contentId` exists only on the derived fileAttachment type. Selecting it on
// the generic attachment collection makes Microsoft Graph reject the whole
// request with BadRequest, even for messages without attachments.
const ATTACHMENT_SELECT = 'id,name,contentType,size,isInline';

function badRequest(message, code = 'OUTLOOK_INVALID_INPUT') {
  throw new OutlookError(message, { status: 400, code });
}

function sanitizeMessageHtml(value) {
  return sanitizeHtml(String(value || ''), {
    allowedTags: [
      'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'blockquote',
      'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'pre', 'code', 'hr',
      'table', 'thead', 'tbody', 'tr', 'th', 'td'
    ],
    allowedAttributes: { a: ['href', 'title', 'rel', 'target'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'discard',
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }, true)
    }
  });
}

function validateId(value, label = 'ID') {
  const id = String(value || '');
  if (!id || id.length > 1024 || /[\\/?#%\u0000-\u001f\u007f\s]/.test(id)) {
    badRequest(`${label} nije važeći.`, 'OUTLOOK_INVALID_ID');
  }
  return id;
}

function validateFolder(value) {
  const folder = String(value || 'inbox').trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(FOLDERS, folder)) {
    badRequest('Folder nije podržan.', 'OUTLOOK_INVALID_FOLDER');
  }
  return folder;
}

function validateLimit(value) {
  const raw = value === undefined || value === null || value === '' ? '50' : String(value);
  if (!/^\d+$/.test(raw)) badRequest('Limit nije važeći.');
  const parsed = Number.parseInt(raw, 10);
  return Math.min(100, Math.max(1, parsed));
}

function booleanQuery(value) {
  if (value === undefined || value === null || value === '') return false;
  if (value === true || String(value).toLowerCase() === 'true') return true;
  if (value === false || String(value).toLowerCase() === 'false') return false;
  badRequest('Boolean parametar nije važeći.');
}

function cleanSearch(value) {
  const search = String(value || '').trim();
  if (search.length > 200 || /[\u0000-\u001f\u007f]/.test(search)) badRequest('Pretraga nije važeća.');
  return search;
}

function emailAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  const parts = address.split('@');
  const local = parts[0] || '';
  const domain = parts[1] || '';
  const labels = domain.split('.');
  const validLocal = local.length <= 64
    && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)
    && !local.startsWith('.')
    && !local.endsWith('.')
    && !local.includes('..');
  const validDomain = domain.length <= 253
    && labels.length >= 2
    && labels.every((label) => label.length >= 1
      && label.length <= 63
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
  if (address.length > 254 || parts.length !== 2 || !validLocal || !validDomain) {
    badRequest('Jedna ili više email adresa nisu važeće.', 'OUTLOOK_INVALID_RECIPIENT');
  }
  return address;
}

function normalizeRecipients(value, options = {}) {
  if (value === undefined || value === null) value = [];
  if (!Array.isArray(value)) badRequest('Primaoci moraju biti poslani kao niz email adresa.', 'OUTLOOK_INVALID_RECIPIENT');
  if (value.length > 100) badRequest('Previše primalaca.', 'OUTLOOK_INVALID_RECIPIENT');
  const seen = new Set();
  const recipients = [];
  for (const item of value) {
    const address = emailAddress(typeof item === 'string' ? item : item && item.address);
    if (!seen.has(address)) {
      seen.add(address);
      recipients.push({ emailAddress: { address } });
    }
  }
  if (options.required && recipients.length === 0) badRequest('Najmanje jedan primalac je obavezan.', 'OUTLOOK_INVALID_RECIPIENT');
  return recipients;
}

function mapRecipient(recipient) {
  const data = recipient && recipient.emailAddress;
  return data && data.address ? { name: data.name || '', address: data.address } : null;
}

function mapRecipients(recipients) {
  return (Array.isArray(recipients) ? recipients : []).map(mapRecipient).filter(Boolean);
}

function mapMessage(message, includeDetail = false) {
  const result = {
    id: message.id,
    conversationId: message.conversationId || null,
    internetMessageId: message.internetMessageId || null,
    subject: message.subject || '',
    from: mapRecipient(message.from),
    sender: mapRecipient(message.sender),
    toRecipients: mapRecipients(message.toRecipients),
    ccRecipients: mapRecipients(message.ccRecipients),
    receivedAt: message.receivedDateTime || null,
    sentAt: message.sentDateTime || null,
    hasAttachments: Boolean(message.hasAttachments),
    importance: message.importance || 'normal',
    isRead: Boolean(message.isRead),
    isDraft: Boolean(message.isDraft),
    bodyPreview: message.bodyPreview || ''
  };
  if (includeDetail) {
    const contentType = String(message.body && message.body.contentType || 'text').toLowerCase() === 'html' ? 'html' : 'text';
    result.bccRecipients = mapRecipients(message.bccRecipients);
    result.body = {
      contentType,
      content: contentType === 'html'
        ? sanitizeMessageHtml(message.body && message.body.content)
        : String(message.body && message.body.content || '')
    };
  }
  return result;
}

function mapAttachment(attachment) {
  const odataType = String(attachment['@odata.type'] || '');
  return {
    id: attachment.id,
    name: attachment.name || 'attachment',
    contentType: attachment.contentType || 'application/octet-stream',
    size: Number(attachment.size || 0),
    isInline: Boolean(attachment.isInline),
    contentId: attachment.contentId || null,
    type: odataType.endsWith('fileAttachment') ? 'file' : (odataType.endsWith('itemAttachment') ? 'item' : 'reference')
  };
}

function safeFilename(value) {
  const cleaned = String(value || 'attachment')
    .replace(/[\u0000-\u001f\u007f"\\/]+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 180);
  return cleaned || 'attachment';
}

function parseAttachment(input, config) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) badRequest('Prilog nije važeći.', 'OUTLOOK_INVALID_ATTACHMENT');
  assertPayloadKeys(input, ['name', 'contentType', 'size', 'contentBytes']);
  const name = safeFilename(input.name);
  const contentType = String(input.contentType || 'application/octet-stream').trim().toLowerCase();
  if (!contentType || contentType.length > 100 || /[\r\n]/.test(contentType)) badRequest('Tip priloga nije važeći.', 'OUTLOOK_INVALID_ATTACHMENT');
  const base64 = String(input.contentBytes || '');
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    badRequest('Sadržaj priloga nije važeći base64.', 'OUTLOOK_INVALID_ATTACHMENT');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > config.maxAttachmentBytes) {
    throw new OutlookError(`Prilog može imati najviše ${config.maxAttachmentBytes} bajtova.`, {
      status: 413,
      code: 'OUTLOOK_ATTACHMENT_TOO_LARGE'
    });
  }
  if (input.size !== undefined && Number(input.size) !== bytes.length) badRequest('Veličina priloga ne odgovara sadržaju.', 'OUTLOOK_INVALID_ATTACHMENT');
  return {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name,
    contentType,
    contentBytes: bytes.toString('base64'),
    size: bytes.length
  };
}

function normalizeAttachments(value, config) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) badRequest('Prilozi moraju biti poslani kao niz.', 'OUTLOOK_INVALID_ATTACHMENT');
  if (value.length > config.maxAttachments) {
    throw new OutlookError(`Dozvoljeno je najviše ${config.maxAttachments} priloga.`, { status: 413, code: 'OUTLOOK_TOO_MANY_ATTACHMENTS' });
  }
  const attachments = value.map((item) => parseAttachment(item, config));
  const total = attachments.reduce((sum, attachment) => sum + attachment.size, 0);
  if (total > config.maxTotalAttachmentBytes) {
    throw new OutlookError(`Prilozi ukupno mogu imati najviše ${config.maxTotalAttachmentBytes} bajtova.`, {
      status: 413,
      code: 'OUTLOOK_ATTACHMENTS_TOO_LARGE'
    });
  }
  return attachments;
}

function normalizeBody(payload, required = true) {
  const bodyType = String(payload.bodyType || payload.contentType || 'html').trim().toLowerCase();
  if (!['html', 'text'].includes(bodyType)) badRequest('bodyType mora biti html ili text.');
  const raw = payload.body;
  if ((raw === undefined || raw === null) && required) badRequest('Sadržaj poruke je obavezan.');
  const text = String(raw || '');
  if (text.length > 200000) badRequest('Sadržaj poruke je predug.');
  return { contentType: bodyType === 'html' ? 'HTML' : 'Text', content: bodyType === 'html' ? sanitizeMessageHtml(text) : text };
}

function assertPayloadKeys(payload, allowed) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) badRequest('JSON payload nije važeći.');
  const unexpected = Object.keys(payload).filter((key) => !allowed.includes(key));
  if (unexpected.length) {
    badRequest(`Nepodržano polje: ${unexpected[0]}.`, 'OUTLOOK_UNKNOWN_FIELD');
  }
}

const SIGNATURE_FIELD_LIMITS = Object.freeze({
  greeting: 200,
  name: 200,
  title: 250,
  mobile: 200,
  phone: 100,
  email: 320,
  website: 500,
  address: 300
});

function normalizeEditableSignature(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    badRequest('Potpis mora biti JSON objekat.', 'OUTLOOK_INVALID_SIGNATURE');
  }
  assertPayloadKeys(value, Object.keys(SIGNATURE_FIELD_LIMITS));
  const signature = {};
  for (const [field, limit] of Object.entries(SIGNATURE_FIELD_LIMITS)) {
    const text = value[field] === undefined || value[field] === null ? '' : String(value[field]).trim();
    if (text.length > limit) badRequest(`Polje potpisa ${field} je predugo.`, 'OUTLOOK_INVALID_SIGNATURE');
    signature[field] = text;
  }
  if (signature.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(signature.email)) {
    badRequest('E-mail u potpisu nije ispravan.', 'OUTLOOK_INVALID_SIGNATURE');
  }
  if (signature.website) {
    try {
      const parsed = new URL(/^https?:\/\//i.test(signature.website) ? signature.website : `https://${signature.website}`);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
    } catch (error) {
      badRequest('Web adresa u potpisu nije ispravna.', 'OUTLOOK_INVALID_SIGNATURE');
    }
  }
  return signature;
}

function requireWrites(config) {
  if (!config.writeEnabled) {
    throw new OutlookError('Outlook izmjene su trenutno isključene na serveru.', {
      status: 503,
      code: 'OUTLOOK_WRITES_DISABLED'
    });
  }
}

function encodeCursor(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function decodeCursor(cursor, secret, context, graphClient) {
  const value = String(cursor || '');
  const [encoded, signature, extra] = value.split('.');
  if (!encoded || !signature || extra || value.length > 12000) badRequest('Cursor nije važeći.', 'INVALID_CURSOR');
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest();
  let actual;
  try { actual = Buffer.from(signature, 'base64url'); } catch (error) { badRequest('Cursor nije važeći.', 'INVALID_CURSOR'); }
  if (!actual || expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) badRequest('Cursor nije važeći.', 'INVALID_CURSOR');
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch (error) { badRequest('Cursor nije važeći.', 'INVALID_CURSOR'); }
  const issuedAt = Number(payload && payload.issuedAt);
  if (!payload
    || payload.context !== context
    || !Number.isFinite(issuedAt)
    || issuedAt > Date.now() + 60000
    || Date.now() - issuedAt > 3600000
    || typeof payload.nextLink !== 'string') {
    badRequest('Cursor je istekao ili ne odgovara pretrazi.', 'INVALID_CURSOR');
  }
  graphClient.validateGraphUrl(payload.nextLink);
  return payload.nextLink;
}

function createOutlookService(options = {}) {
  const config = options.config || createOutlookConfig(options.env);
  const graph = options.graphClient || createGraphClient({ ...options, config });

  function status() {
    const state = !config.configured ? 'not_configured' : (config.writeEnabled ? 'ready' : 'read_only');
    return {
      configured: config.configured,
      writeEnabled: config.writeEnabled,
      mailbox: config.mailbox,
      status: state,
      message: config.configurationMessage || (config.writeEnabled ? 'Outlook mailbox je spreman.' : 'Outlook je dostupan samo za čitanje.'),
      limits: {
        maxAttachments: config.maxAttachments,
        maxAttachmentBytes: config.maxAttachmentBytes,
        maxTotalAttachmentBytes: config.maxTotalAttachmentBytes
      }
    };
  }

  async function getFolder(folder) {
    const key = validateFolder(folder);
    const params = new URLSearchParams({ '$select': 'id,displayName,totalItemCount,unreadItemCount' });
    const { data } = await graph.request(graph.mailboxPath(`/mailFolders/${key}?${params}`));
    return { key, name: data.displayName || FOLDERS[key], totalCount: Number(data.totalItemCount || 0), unreadCount: Number(data.unreadItemCount || 0) };
  }

  async function getAccount() {
    // Avoid /users/{id}: that endpoint would require broad directory permissions.
    // Mail.ReadWrite is sufficient for the well-known Inbox folder below.
    const inbox = await getFolder('inbox');
    return { mailbox: config.mailbox, displayName: config.mailbox, inbox: { totalCount: inbox.totalCount, unreadCount: inbox.unreadCount } };
  }

  async function listFolders() {
    const items = await Promise.all(Object.keys(FOLDERS).map(getFolder));
    return { items };
  }

  async function listMessages(query = {}) {
    const folder = validateFolder(query.folder);
    const search = cleanSearch(query.search);
    const unreadOnly = booleanQuery(query.unreadOnly);
    const limit = validateLimit(query.limit);
    const context = JSON.stringify({ folder, search, unreadOnly, limit });
    let url;
    if (query.cursor) {
      url = decodeCursor(query.cursor, config.cursorSecret, context, graph);
    } else {
      const params = new URLSearchParams({ '$top': String(limit), '$select': MESSAGE_SELECT });
      if (search) params.set('$search', `"${search.replace(/[\\"]/g, '\\$&')}"`);
      // Graph ne podržava $search i $filter zajedno; search rezultate filtriramo ispod.
      if (unreadOnly && !search) params.set('$filter', 'isRead eq false');
      if (!search) params.set('$orderby', 'receivedDateTime desc');
      url = graph.mailboxPath(`/mailFolders/${folder}/messages?${params}`);
    }
    const { data } = await graph.request(url);
    const nextLink = data && data['@odata.nextLink'];
    if (nextLink) graph.validateGraphUrl(nextLink);
    const nextCursor = nextLink ? encodeCursor({ nextLink, context, issuedAt: Date.now() }, config.cursorSecret) : null;
    const sourceItems = data && data.value || [];
    const visibleItems = search && unreadOnly ? sourceItems.filter((item) => !item.isRead) : sourceItems;
    return { items: visibleItems.map((item) => mapMessage(item)), nextCursor, next_cursor: nextCursor };
  }

  async function getMessage(id) {
    const messageId = validateId(id, 'ID poruke');
    const messageParams = new URLSearchParams({ '$select': DETAIL_SELECT });
    const { data: message } = await graph.request(
      graph.mailboxPath(`/messages/${encodeURIComponent(messageId)}?${messageParams}`)
    );
    let attachments = [];
    if (message && message.hasAttachments) {
      const attachmentParams = new URLSearchParams({ '$select': ATTACHMENT_SELECT });
      const { data: attachmentData } = await graph.request(
        graph.mailboxPath(`/messages/${encodeURIComponent(messageId)}/attachments?${attachmentParams}`)
      );
      attachments = (attachmentData.value || []).map(mapAttachment);
    }
    return { ...mapMessage(message, true), attachments };
  }

  async function downloadAttachment(messageId, attachmentId) {
    const safeMessageId = validateId(messageId, 'ID poruke');
    const safeAttachmentId = validateId(attachmentId, 'ID priloga');
    const base = `/messages/${encodeURIComponent(safeMessageId)}/attachments/${encodeURIComponent(safeAttachmentId)}`;
    const { data: metadata } = await graph.request(graph.mailboxPath(`${base}?$select=${ATTACHMENT_SELECT}`));
    const mapped = mapAttachment(metadata);
    if (mapped.type !== 'file') throw new OutlookError('Ovaj tip priloga nije podržan za preuzimanje.', { status: 415, code: 'OUTLOOK_ATTACHMENT_TYPE_UNSUPPORTED' });
    if (mapped.size > config.maxAttachmentBytes) throw new OutlookError('Prilog je prevelik za sigurno preuzimanje.', { status: 413, code: 'OUTLOOK_ATTACHMENT_TOO_LARGE' });
    const { data } = await graph.request(graph.mailboxPath(`${base}/$value`), {
      responseType: 'buffer',
      maxResponseBytes: config.maxAttachmentBytes
    });
    if (!Buffer.isBuffer(data) || data.length > config.maxAttachmentBytes) throw new OutlookError('Prilog je prevelik za sigurno preuzimanje.', { status: 413, code: 'OUTLOOK_ATTACHMENT_TOO_LARGE' });
    return { data, filename: safeFilename(mapped.name), contentType: mapped.contentType, size: data.length };
  }

  async function markRead(id, isRead) {
    requireWrites(config);
    if (typeof isRead !== 'boolean') badRequest('isRead mora biti boolean vrijednost.');
    const messageId = validateId(id, 'ID poruke');
    const { data } = await graph.request(graph.mailboxPath(`/messages/${encodeURIComponent(messageId)}`), {
      method: 'PATCH', body: { isRead }, idempotent: false
    });
    return { success: true, message: data ? mapMessage(data) : { id: messageId, isRead } };
  }

  async function moveMessage(id, destination) {
    requireWrites(config);
    const messageId = validateId(id, 'ID poruke');
    const folder = validateFolder(destination);
    const { data } = await graph.request(graph.mailboxPath(`/messages/${encodeURIComponent(messageId)}/move`), {
      method: 'POST', body: { destinationId: folder }, idempotent: false
    });
    return { success: true, destination: folder, message: mapMessage(data || { id: messageId }) };
  }

  async function addAttachments(draftId, attachments) {
    for (const attachment of attachments) {
      const { size, ...graphAttachment } = attachment;
      await graph.request(graph.mailboxPath(`/messages/${encodeURIComponent(draftId)}/attachments`), {
        method: 'POST', body: graphAttachment, idempotent: false
      });
    }
  }

  async function sendDraft(draft, attachments) {
    const draftId = validateId(draft.id, 'ID nacrta');
    await addAttachments(draftId, attachments);
    await graph.request(graph.mailboxPath(`/messages/${encodeURIComponent(draftId)}/send`), { method: 'POST', idempotent: false });
    return { success: true, accepted: true, id: draftId, conversationId: draft.conversationId || null };
  }

  async function send(payload = {}) {
    requireWrites(config);
    assertPayloadKeys(payload, ['to', 'cc', 'bcc', 'subject', 'body', 'bodyType', 'contentType', 'attachments', 'signature']);
    const subject = String(payload.subject || '').trim();
    if (!subject || subject.length > 255 || /[\r\n]/.test(subject)) badRequest('Naslov poruke je obavezan i može imati najviše 255 znakova.');
    const attachments = normalizeAttachments(payload.attachments, config);
    const message = {
      subject,
      body: appendAutomaticSignature(normalizeBody(payload), normalizeEditableSignature(payload.signature)),
      toRecipients: normalizeRecipients(payload.to, { required: true }),
      ccRecipients: normalizeRecipients(payload.cc),
      bccRecipients: normalizeRecipients(payload.bcc)
    };
    const { data: draft } = await graph.request(graph.mailboxPath('/messages'), { method: 'POST', body: message, idempotent: false });
    return sendDraft(draft, attachments);
  }

  async function respond(kind, id, payload = {}) {
    requireWrites(config);
    assertPayloadKeys(payload, ['to', 'cc', 'bcc', 'body', 'bodyType', 'contentType', 'attachments', 'signature']);
    const messageId = validateId(id, 'ID poruke');
    const action = kind === 'reply-all' ? 'createReplyAll' : (kind === 'forward' ? 'createForward' : 'createReply');
    const attachments = normalizeAttachments(payload.attachments, config);
    const requestedBody = appendAutomaticSignature(normalizeBody(payload), normalizeEditableSignature(payload.signature));
    let requestedTo;
    if (kind === 'forward') requestedTo = normalizeRecipients(payload.to, { required: true });
    else if (payload.to !== undefined) badRequest('Polje to nije dozvoljeno za reply akciju.');
    const requestedCc = payload.cc !== undefined ? normalizeRecipients(payload.cc) : undefined;
    const requestedBcc = payload.bcc !== undefined ? normalizeRecipients(payload.bcc) : undefined;
    const { data: draft } = await graph.request(graph.mailboxPath(`/messages/${encodeURIComponent(messageId)}/${action}`), {
      method: 'POST', body: {}, idempotent: false
    });
    const existingBody = draft && draft.body || null;
    let combinedBody = requestedBody;
    if (existingBody && existingBody.content) {
      const existingType = String(existingBody.contentType || '').toLowerCase();
      if (requestedBody.contentType === 'HTML' || existingType === 'html') {
        const requestedHtml = requestedBody.contentType === 'HTML' ? requestedBody.content : escapePlainText(requestedBody.content);
        const existingHtml = existingType === 'html' ? sanitizeMessageHtml(existingBody.content) : escapePlainText(existingBody.content);
        combinedBody = { contentType: 'HTML', content: `${requestedHtml}<br><br>${existingHtml}` };
      } else {
        combinedBody = { contentType: 'Text', content: `${requestedBody.content}\n\n${String(existingBody.content)}` };
      }
    }
    const patch = { body: combinedBody };
    if (kind === 'forward') patch.toRecipients = requestedTo;
    if (requestedCc !== undefined) patch.ccRecipients = requestedCc;
    if (requestedBcc !== undefined) patch.bccRecipients = requestedBcc;
    const { data: updatedDraft } = await graph.request(graph.mailboxPath(`/messages/${encodeURIComponent(validateId(draft.id, 'ID nacrta'))}`), {
      method: 'PATCH', body: patch, idempotent: false
    });
    return sendDraft(updatedDraft || draft, attachments);
  }

  return {
    config,
    status,
    getAccount,
    listFolders,
    listMessages,
    getMessage,
    downloadAttachment,
    markRead,
    moveMessage,
    deleteMessage: (id) => moveMessage(id, 'deleteditems'),
    send,
    reply: (id, payload) => respond('reply', id, payload),
    replyAll: (id, payload) => respond('reply-all', id, payload),
    forward: (id, payload) => respond('forward', id, payload)
  };
}

module.exports = {
  FOLDERS,
  createOutlookService,
  mapMessage,
  normalizeAttachments,
  sanitizeMessageHtml,
  validateId
};
