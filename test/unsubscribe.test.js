const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const knex = require('knex');
const { createUnsubscribeRouter, unsubscribeAddress } = require('../commercial/unsubscribe');
const { createOutlookService } = require('../outlookMail/service');
const { createOutlookConfig } = require('../outlookMail/graphClient');
const { UNSUBSCRIBE, LEGACY_UNSUBSCRIBE, usaCampaignBody } = require('../commercial/usaMail');

async function database(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  for (const migration of [
    '20260716150000_create_ai_email_module',
    '20260813120000_create_commercial_crm',
    '20260815120000_add_commercial_mail_automation',
    '20260818130000_add_commercial_recipient_cc'
  ]) await require(`../migrations/${migration}`).up(db);
  return db;
}

async function server(t, db, options = {}) {
  const app = express();
  app.use('/unsubscribe', createUnsubscribeRouter({ db, env: { JWT_SECRET: 'test-form-secret' }, ...options }));
  const listener = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => listener.close(resolve)));
  return `http://127.0.0.1:${listener.address().port}/unsubscribe`;
}

async function form(url) {
  const response = await fetch(url);
  const html = await response.text();
  assert.equal(response.status, 200);
  return { html, token: html.match(/name="token" value="([^"]+)"/)[1], cookie: response.headers.get('set-cookie').split(';')[0] };
}

function submit(url, session, email, overrides = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: session.cookie },
    body: new URLSearchParams({ token: session.token, email, ...overrides })
  });
}

test('Bosnian HACCP form preserves language through validation and successful opt-out', async t => {
  const db = await database(t), url = (await server(t, db)) + '?lang=bs', session = await form(url);
  assert.match(session.html, /lang="bs"/); assert.match(session.html, /action="\/unsubscribe\?lang=bs"/);
  assert.match(session.html, /Odjavi me iz svih marketinških poruka/);
  const invalid = await submit(url, session, 'invalid'); assert.equal(invalid.status, 400);
  assert.match(await invalid.text(), /Unesite ispravnu e-mail adresu/);
  const result = await submit(url, session, 'person@example.com'); assert.equal(result.status, 200);
  assert.match(await result.text(), /Vaša odjava je evidentirana/);
  assert.equal((await db('email_suppression_list')).length, 1);
});

async function queue(db, id, brand, email, cc = [], status = 'SCHEDULED') {
  await db('crm_accounts').insert({
    id: `a-${id}`, brand_id: brand, source_key: id, company_name: id, email,
    source_data_json: '{}'
  });
  await db('crm_mail_queue').insert({
    id, brand_id: brand, account_id: `a-${id}`, queue_date: '2026-10-20',
    sequence_number: 1, recipient_email: email, cc_emails_json: JSON.stringify(cc),
    subject: 'Offer', body_text: 'Offer', status
  });
}

test('public GET/HEAD are read-only, need no login, and do not echo a URL email', async (t) => {
  const db = await database(t);
  const url = await server(t, db);
  const response = await fetch(`${url}?email=private@example.com`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /type="email"/);
  assert.doesNotMatch(html, /private@example.com|<script/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(response.headers.get('content-security-policy'), /form-action 'self'/);
  assert.equal((await fetch(url, { method: 'HEAD' })).status, 200);
  assert.equal((await db('email_suppression_list')).length, 0);
});

test('form commits global opt-out, cancels waiting primary/CC messages and followups, and thanks recipient', async (t) => {
  const db = await database(t);
  const brands = await db('crm_brands').select('id');
  await queue(db, 'primary', brands[0].id, 'Person@Example.com');
  await queue(db, 'cc', brands[1].id, 'other@example.com', ['PERSON@example.com']);
  await queue(db, 'unrelated', brands[0].id, 'other@example.com');
  await queue(db, 'sent', brands[0].id, 'person@example.com', [], 'SENT');
  await db('email_contacts').insert({
    id: 'contact', company_name: 'Example', company_name_normalized: 'example',
    email: 'person@example.com', email_normalized: 'person@example.com', sending_allowed: true
  });
  await db('email_followups').insert({
    id: 'followup', campaign_id: 'campaign', contact_id: 'contact', original_message_id: 'message',
    sequence_number: 1, scheduled_at: new Date(), status: 'SCHEDULED'
  });
  const url = await server(t, db);
  const session = await form(url);
  const response = await submit(url, session, ' Person@Example.COM ');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Thank you\. You're unsubscribed/);
  const suppression = await db('email_suppression_list').first();
  assert.equal(suppression.email_normalized, 'person@example.com');
  assert.equal(suppression.source, 'PUBLIC_UNSUBSCRIBE_FORM');
  assert.equal((await db('email_contacts').first()).sending_allowed, 0);
  assert.equal((await db('email_followups').first()).status, 'CANCELLED');
  const statuses = Object.fromEntries((await db('crm_mail_queue')).map((row) => [row.id, row.status]));
  assert.deepEqual(statuses, { primary: 'SKIPPED', cc: 'SKIPPED', unrelated: 'SCHEDULED', sent: 'SENT' });
  assert.equal((await submit(url, session, 'person@example.com')).status, 200);
  assert.equal((await db('email_suppression_list')).length, 1);
  assert.equal((await db('email_suppression_list').first()).id, suppression.id);
});

test('tampered/expired forms, missing cookies and invalid emails never record suppression', async (t) => {
  const db = await database(t);
  let now = Date.now();
  const url = await server(t, db, { now: () => now });
  const session = await form(url);
  for (const [current, email] of [
    [{ ...session, token: `${session.token}bad` }, 'person@example.com'],
    [{ ...session, cookie: '' }, 'person@example.com'],
    [session, 'a@example.com,b@example.com'],
    [session, '"><script>alert(1)</script>']
  ]) {
    const response = await submit(url, current, email);
    assert.equal(response.status, 400);
    assert.doesNotMatch(await response.text(), /<script>|You're unsubscribed/);
  }
  now += 49 * 60 * 60 * 1000;
  assert.equal((await submit(url, session, 'person@example.com')).status, 400);
  // The emailed URL never expires: opening it always issues a fresh form.
  assert.equal((await submit(url, await form(url), 'person@example.com')).status, 200);
  assert.equal((await db('email_suppression_list')).length, 1);
});

test('database failure rolls back suppression and displays an error instead of a false success', async (t) => {
  const db = await database(t);
  await db.schema.dropTable('crm_mail_queue');
  const url = await server(t, db);
  const response = await submit(url, await form(url), 'person@example.com');
  assert.equal(response.status, 503);
  assert.match(await response.text(), /could not save your request/);
  assert.equal((await db('email_suppression_list')).length, 0);
});

test('existing suppression reason remains intact and unknown addresses can opt out without enumeration', async (t) => {
  const db = await database(t);
  await db('email_suppression_list').insert({
    id: 'existing', email: 'person@example.com', email_normalized: 'person@example.com',
    reason: 'MANUAL_REQUEST', source: 'MANUAL', created_by: 'director'
  });
  await unsubscribeAddress(db, 'PERSON@example.com');
  assert.equal((await db('email_suppression_list').where({ id: 'existing' }).first()).reason, 'MANUAL_REQUEST');
  await unsubscribeAddress(db, 'unknown@example.com');
  assert.equal((await db('email_suppression_list')).length, 2);
});

test('Outlook new-message/forward paths block suppressed To, CC and BCC before Graph and recheck just before send', async (t) => {
  const db = await database(t);
  await unsubscribeAddress(db, 'blocked@example.com');
  const calls = [];
  const config = createOutlookConfig({
    NODE_ENV: 'production', MICROSOFT_TENANT_ID: 'tenant', MICROSOFT_CLIENT_ID: 'client',
    MICROSOFT_CLIENT_SECRET: 'secret', OUTLOOK_CURSOR_SECRET: 'cursor-secret',
    OUTLOOK_MAILBOX_ADDRESS: 'sales@s-consulting.ba', OUTLOOK_ALLOWED_MAILBOXES: 'sales@s-consulting.ba',
    OUTLOOK_WRITE_ENABLED: 'true'
  });
  config.writeEnabled = true;
  const service = createOutlookService({
    db, config,
    graphClient: {
      mailboxPath: (suffix) => suffix,
      async request(path) {
        calls.push(path);
        if (path === '/messages') await unsubscribeAddress(db, 'late@example.com');
        return { data: { id: 'draft-test' } };
      }
    }
  });
  const body = { to: ['ok@example.com'], subject: 'Offer', body: 'Offer' };
  for (const field of ['to', 'cc', 'bcc']) {
    await assert.rejects(service.send({ ...body, [field]: ['BLOCKED@example.com'] }), { code: 'RECIPIENT_SUPPRESSED' });
  }
  await assert.rejects(service.forward('source-message', { to: ['blocked@example.com'], body: 'Offer' }), { code: 'RECIPIENT_SUPPRESSED' });
  assert.equal(calls.length, 0);
  await assert.rejects(service.send({ ...body, to: ['late@example.com'] }), { code: 'RECIPIENT_SUPPRESSED' });
  assert.deepEqual(calls, ['/messages']);
});

test('USA legacy and edited offers retain the form link; migration keeps sending disabled', async (t) => {
  const db = await database(t);
  const brand = await db('crm_brands').first();
  await db('crm_brands').where({ id: brand.id }).update({ code: 'SAN_PEST_USA' });
  await db('crm_mail_automation_settings').where({ brand_id: brand.id }).update({
    body_text: `My custom offer.\n\n${LEGACY_UNSUBSCRIBE}`, enabled: false, paused: true, auto_send: false
  });
  const migration = require('../migrations/20261020150000_add_usa_unsubscribe_form');
  await migration.up(db);
  await migration.up(db);
  const settings = await db('crm_mail_automation_settings').where({ brand_id: brand.id }).first();
  assert.equal(settings.body_text, `My custom offer.\n\n${UNSUBSCRIBE}`);
  assert.equal(settings.enabled, 0);
  assert.equal(settings.auto_send, 0);
  assert.equal(settings.paused, 1);
  for (const text of ['Edited offer', LEGACY_UNSUBSCRIBE, UNSUBSCRIBE]) {
    const html = usaCampaignBody(text).body;
    assert.equal((html.match(/href="https:\/\/[^"]+\/unsubscribe"/g) || []).length, 1);
  }
});
