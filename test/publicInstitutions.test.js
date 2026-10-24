const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const knex = require('knex');
const { createOutlookConfig, validateGraphUrl } = require('../outlookMail/graphClient');
const { createOutlookRouter } = require('../outlookMail/router');
const { createOutlookService } = require('../outlookMail/service');
const { DEFAULT_MAILBOX, PUBLIC_INSTITUTIONS_MAILBOX } = require('../outlookMail/mailboxScope');
const { authenticateCredentials } = require('../aiEmail/auth');
const { listAccessibleBrands, resolveBrand } = require('../commercial/service');
const { manageUser } = require('../scripts/manageUser');
const {
  getAutomationState, updateAutomationSettings, prepareAutomationQueue, reviewAutomationCandidates,
  scheduleSelectedMails, sendSelectedMails, sendImmediateAccountMail, sendNextAutomatedMail, runAutomationTick
} = require('../commercial/automation');
const migration = require('../migrations/20261024120000_add_public_institutions_profile');

const pubUser = { id: 'public-user', username: 'javne-ustanove', role: 'komercijala', outlookMailbox: PUBLIC_INSTITUTIONS_MAILBOX };
const director = { id: 'director', username: 'director', role: 'direktor' };

async function testDb(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  for (const name of [
    '20260813120000_create_commercial_crm', '20260813130000_add_app_user_token_version',
    '20260815120000_add_commercial_mail_automation', '20260817130000_add_manual_commercial_mail_campaigns',
    '20260818100000_add_commercial_mail_schedule_reports', '20260818130000_add_commercial_recipient_cc',
    '20260818150000_set_commercial_mail_interval_five', '20260827170000_add_account_ownership_type'
  ]) await require(`../migrations/${name}`).up(db);
  await migration.up(db);
  return db;
}

function env(allowed = DEFAULT_MAILBOX) {
  return {
    NODE_ENV: 'production', MICROSOFT_TENANT_ID: 'tenant', MICROSOFT_CLIENT_ID: 'client',
    MICROSOFT_CLIENT_SECRET: 'test-credential', JWT_SECRET: 'test-jwt-secret',
    OUTLOOK_ALLOWED_MAILBOXES: allowed, OUTLOOK_MAIL_WRITES_ENABLED: 'true'
  };
}

async function addAccount(db, brand, id) {
  const row = {
    id, brand_id: brand.id, source_key: `ISOLATION:${id}`, company_name: id, email: `${id}@example.org`,
    status: 'NEW', priority: 'HIGH', currency: 'BAM', source_data_json: '{}', created_at: new Date(), updated_at: new Date()
  };
  await db('crm_accounts').insert(row);
  return row;
}

test('migration creates an empty paused public-institutions database without granting or sending', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'JAVNE_USTANOVE' }).first();
  assert.equal(brand.mailbox_address, PUBLIC_INSTITUTIONS_MAILBOX);
  assert.equal((await db('crm_accounts').where({ brand_id: brand.id })).length, 0);
  assert.equal((await db('app_user_brand_access').where({ brand_id: brand.id })).length, 0);
  assert.equal((await db('crm_mail_queue').where({ brand_id: brand.id })).length, 0);
  const state = await getAutomationState(db, brand);
  assert.equal(state.sender, PUBLIC_INSTITUTIONS_MAILBOX);
  assert.equal(state.settings.enabled, false);
  assert.equal(state.settings.paused, true);
  assert.equal(state.settings.auto_send, false);
  assert.equal(state.settings.report_enabled, false);
  assert.equal(state.template.body, '');
});

test('user provisioning assigns only the requested database and rejects cross-mailbox grants', async (t) => {
  const db = await testDb(t);
  const oldRounds = process.env.BCRYPT_ROUNDS;
  process.env.BCRYPT_ROUNDS = '4';
  t.after(() => { if (oldRounds === undefined) delete process.env.BCRYPT_ROUNDS; else process.env.BCRYPT_ROUNDS = oldRounds; });
  const created = await manageUser({ db, output() {}, args: {
    username: 'javne-ustanove', displayName: 'Javne ustanove', brands: 'JAVNE_USTANOVE',
    mailbox: PUBLIC_INSTITUTIONS_MAILBOX, generatePassword: true
  } });
  const authenticated = await authenticateCredentials(db, created.username, created.generatedPassword);
  assert.equal(authenticated.outlookMailbox, PUBLIC_INSTITUTIONS_MAILBOX);
  assert.equal(authenticated.mustChangePassword, true);
  assert.deepEqual((await listAccessibleBrands(db, authenticated)).map((brand) => brand.code), ['JAVNE_USTANOVE']);
  assert.equal((await listAccessibleBrands(db, authenticated))[0].sender_email, PUBLIC_INSTITUTIONS_MAILBOX);
  await assert.rejects(resolveBrand(db, authenticated, 'FS_APP'), { code: 'BRAND_ACCESS_DENIED' });
  await assert.rejects(manageUser({ db, output() {}, args: {
    username: 'bad-user', brands: 'JAVNE_USTANOVE', generatePassword: true
  } }), /moraju pripadati/);
  assert.equal(await db('app_users').where({ username: 'bad-user' }).first(), undefined);
  await assert.rejects(manageUser({ db, output() {}, args: {
    username: 'second-public', brands: 'JAVNE_USTANOVE', mailbox: PUBLIC_INSTITUTIONS_MAILBOX, generatePassword: true
  } }), /drugim profilom/);
  const regular = await manageUser({ db, output() {}, args: { username: 'regular', generatePassword: true } });
  const brands = await listAccessibleBrands(db, { id: regular.id, role: 'komercijala' });
  assert.equal(brands.length, 3);
  assert.ok(brands.every((brand) => brand.code !== 'JAVNE_USTANOVE'));
  await assert.rejects(migration.down(db), /u upotrebi/);
});

test('secondary mailbox requires explicit server allowlisting and Graph rejects cross-mailbox paths', () => {
  assert.equal(createOutlookConfig(env(), { mailbox: PUBLIC_INSTITUTIONS_MAILBOX }).configured, false);
  const cfg = createOutlookConfig(env(`${DEFAULT_MAILBOX},${PUBLIC_INSTITUTIONS_MAILBOX}`), { mailbox: PUBLIC_INSTITUTIONS_MAILBOX });
  assert.equal(cfg.configured, true);
  assert.equal(cfg.mailbox, PUBLIC_INSTITUTIONS_MAILBOX);
  assert.equal(createOutlookConfig(env(`${DEFAULT_MAILBOX},${PUBLIC_INSTITUTIONS_MAILBOX}`)).mailbox, DEFAULT_MAILBOX);
  assert.equal(createOutlookConfig(env(`${DEFAULT_MAILBOX},stranger@example.org`)).configured, false);
  assert.throws(() => validateGraphUrl(`https://graph.microsoft.com/v1.0/users/${DEFAULT_MAILBOX}/messages`, cfg.mailbox), { code: 'INVALID_CURSOR' });
});

test('Outlook router resolves mailbox from authenticated user, ignoring URL mailbox selectors', async (t) => {
  const requested = [];
  const app = express();
  app.use((req, res, next) => {
    req.user = req.get('x-public-profile') === 'yes' ? pubUser : director;
    next();
  });
  app.use('/api/outlook', createOutlookRouter({
    env: env(`${DEFAULT_MAILBOX},${PUBLIC_INSTITUTIONS_MAILBOX}`),
    serviceFactory({ config }) {
      requested.push(config.mailbox);
      return { config, status() { return { mailbox: config.mailbox }; }, listMessages() { return { mailbox: config.mailbox }; } };
    }
  }));
  const server = await new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const normal = await (await fetch(`${base}/api/outlook/messages?mailbox=${PUBLIC_INSTITUTIONS_MAILBOX}`)).json();
  const pub = await (await fetch(`${base}/api/outlook/status?mailbox=${DEFAULT_MAILBOX}`, { headers: { 'x-public-profile': 'yes' } })).json();
  assert.equal(normal.mailbox, DEFAULT_MAILBOX);
  assert.equal(pub.mailbox, PUBLIC_INSTITUTIONS_MAILBOX);
  assert.deepEqual(requested, [DEFAULT_MAILBOX, PUBLIC_INSTITUTIONS_MAILBOX]);
});

test('public mailbox sends use its path and neutral signature and reject client-selected from', async () => {
  const mailbox = PUBLIC_INSTITUTIONS_MAILBOX;
  const calls = [];
  const service = createOutlookService({
    config: createOutlookConfig(env(`${DEFAULT_MAILBOX},${mailbox}`), { mailbox }),
    graphClient: {
      mailboxPath(suffix) { return `/v1.0/users/${mailbox}${suffix}`; },
      async request(path, options = {}) {
        calls.push({ path, ...options });
        return { data: { id: 'draft', conversationId: 'conversation' } };
      }
    }
  });
  await assert.rejects(service.send({ from: DEFAULT_MAILBOX, to: ['recipient@example.org'], subject: 'Test', body: 'Text' }), { code: 'OUTLOOK_UNKNOWN_FIELD' });
  assert.equal(calls.length, 0);
  await service.send({ to: ['recipient@example.org'], subject: 'Test', body: 'Text' });
  assert.ok(calls.every((call) => call.path.startsWith(`/v1.0/users/${mailbox}/`)));
  const draft = calls.find((call) => call.path.endsWith('/messages'));
  assert.match(draft.body.body.content, /Javne ustanove/);
  assert.match(draft.body.body.content, /prodaja@s-consulting.ba/);
  assert.doesNotMatch(draft.body.body.content, /Ermina/);
});

test('unbound users including directors cannot send, schedule or enable public mailbox campaigns', async () => {
  const brand = { id: 'public-brand', code: 'JAVNE_USTANOVE', mailbox_address: PUBLIC_INSTITUTIONS_MAILBOX };
  for (const operation of [
    () => updateAutomationSettings(null, brand, director, { enabled: true }),
    () => scheduleSelectedMails(null, brand, ['account'], { confirmed: true, actor: director }),
    () => sendSelectedMails(null, brand, ['account'], { confirmed: true, actor: director }),
    () => sendImmediateAccountMail(null, brand, 'account', { confirmed: true, actor: director }),
    () => sendNextAutomatedMail(null, brand, { actor: director })
  ]) await assert.rejects(operation(), { code: 'BRAND_MAILBOX_ACCESS_DENIED' });
  await assert.rejects(sendImmediateAccountMail(null, brand, 'account', {
    confirmed: true, actor: pubUser, outlookService: { config: { mailbox: DEFAULT_MAILBOX, writeEnabled: true } }
  }), { code: 'OUTLOOK_SENDER_MISMATCH' });
});

test('new database cannot prepare or send a letter until its content has been written', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'JAVNE_USTANOVE' }).first();
  const account = await addAccount(db, brand, 'empty-letter');
  await assert.rejects(prepareAutomationQueue(db, brand, pubUser), { code: 'AUTOMATION_TEMPLATE_REQUIRED' });
  let calls = 0;
  await assert.rejects(sendImmediateAccountMail(db, brand, account.id, {
    confirmed: true, actor: pubUser,
    outlookService: { config: { mailbox: PUBLIC_INSTITUTIONS_MAILBOX, writeEnabled: true }, async send() { calls += 1; } }
  }), { code: 'AUTOMATION_TEMPLATE_REQUIRED' });
  assert.equal(calls, 0);
});

test('worker resolves the correct sender independently for each scheduled database', async (t) => {
  const db = await testDb(t);
  const pubBrand = await db('crm_brands').where({ code: 'JAVNE_USTANOVE' }).first();
  const salesBrand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const date = '2026-10-26';
  for (const [brand, user, id] of [[pubBrand, pubUser, 'public-test'], [salesBrand, director, 'sales-test']]) {
    const account = await addAccount(db, brand, id);
    await updateAutomationSettings(db, brand, user, { subject: 'Dopis', body: 'Sadržaj odobrenog dopisa', enabled: false, auto_send: false, report_enabled: false });
    await prepareAutomationQueue(db, brand, user, { date });
    await reviewAutomationCandidates(db, brand, [account.id], 'APPROVED', { date });
    await scheduleSelectedMails(db, brand, [account.id], { confirmed: true, actor: user, date, now: new Date(`${date}T08:00:00Z`) });
  }
  const sends = [];
  const resolved = [];
  const options = {
    outlookServiceFactory({ mailbox }) {
      resolved.push(mailbox);
      return { config: { mailbox, writeEnabled: true }, async send(payload) {
        sends.push({ mailbox, to: payload.to[0] });
        return { id: `sent-${sends.length}`, accepted: true };
      } };
    }
  };
  await runAutomationTick(db, { ...options, now: new Date(`${date}T08:00:00Z`) });
  await runAutomationTick(db, { ...options, now: new Date(`${date}T08:06:00Z`) });
  assert.ok(resolved.includes(DEFAULT_MAILBOX));
  assert.ok(resolved.includes(PUBLIC_INSTITUTIONS_MAILBOX));
  assert.deepEqual(sends.sort((a, b) => a.to.localeCompare(b.to)), [
    { mailbox: PUBLIC_INSTITUTIONS_MAILBOX, to: 'public-test@example.org' },
    { mailbox: DEFAULT_MAILBOX, to: 'sales-test@example.org' }
  ]);
});
