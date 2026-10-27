const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const knex = require('knex');
const { createSanpestMeetingRouter } = require('../commercial/sanpestMeeting');

async function setup(t, notify = async () => {}) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  await require('../migrations/20261027160000_create_sanpest_meeting_requests').up(db);
  const app = express();
  app.use('/sanpest-sastanak', createSanpestMeetingRouter({ db, env: { JWT_SECRET: 'local-test-secret' }, notify }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(async () => { await new Promise(r => server.close(r)); await db.destroy(); });
  const url = `http://127.0.0.1:${server.address().port}/sanpest-sastanak`;
  const form = async () => { const r = await fetch(url); return (await r.text()).match(/name="token" value="([^"]+)"/)[1]; };
  const post = (token, changes = {}, headers = {}) => fetch(url, { method: 'POST', headers, body: new URLSearchParams({ token, name: 'Test osoba', phone: '+387 33 123 456', company: 'Test & firma', comment: 'Online prikaz', interested: 'yes', ...changes }) });
  return { db, url, form, post };
}
test('online request is saved once, notifies once, and ignores an attempted onsite override', async t => {
  const notifications = []; const { db, form, post } = await setup(t, async data => notifications.push(data));
  const token = await form();
  const results = await Promise.all([post(token, { meeting_format: 'onsite' }), post(token)]);
  for (const r of results) { assert.equal(r.status, 200); assert.match(await r.text(), /Hvala na interesu/); }
  const rows = await db('sanpest_meeting_requests');
  assert.equal(rows.length, 1); assert.equal(rows[0].meeting_format, 'online');
  assert.equal(rows[0].notification_status, 'SENT'); assert.equal(notifications.length, 1);
  assert.match(notifications[0].text, /Telefon: \+387 33 123 456/);
});
test('invalid, forged, expired and cross-origin submissions do not save or send; fields are escaped', async t => {
  let calls = 0; const { db, form, post } = await setup(t, async () => calls++); const token = await form();
  for (const change of [{ name: '' }, { company: '' }, { phone: 'abc' }, { interested: '' }, { website: 'spam' }, { comment: 'x'.repeat(2001) }, { company: 'x\nBcc: victim@example.com' }]) assert.equal((await post(token, change)).status, 400);
  assert.equal((await post(token + 'tamper')).status, 400);
  assert.equal((await post(token.replace(/\.\d{13}\./, '.1000000000000.'))).status, 400);
  assert.equal((await post(token, {}, { Origin: 'https://evil.example' })).status, 403);
  const r = await post(token, { name: '<script>attack</script>', phone: '' });
  const html = await r.text(); assert.match(html, /&lt;script&gt;/); assert.ok(!html.includes('<script>attack'));
  assert.equal((await db('sanpest_meeting_requests')).length, 0); assert.equal(calls, 0);
});
test('notification failure preserves a durable request without duplicate notification on retry', async t => {
  let calls = 0; const { db, form, post } = await setup(t, async () => { calls++; throw Error('simulated'); }); const token = await form();
  assert.equal((await post(token)).status, 200); assert.equal((await post(token)).status, 200);
  const row = await db('sanpest_meeting_requests').first(); assert.equal(row.notification_status, 'REVIEW_REQUIRED'); assert.equal(calls, 1);
});
test('database failure reports failure and preserves form input', async t => {
  const { db, form, post } = await setup(t); const token = await form(); await db.schema.dropTable('sanpest_meeting_requests');
  const r = await post(token); assert.equal(r.status, 503); const html = await r.text(); assert.match(html, /Zahtjev nije sačuvan/); assert.match(html, /Test &amp; firma/);
});
