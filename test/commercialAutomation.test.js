const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');
const crmMigration = require('../migrations/20260813120000_create_commercial_crm');
const automationMigration = require('../migrations/20260815120000_add_commercial_mail_automation');
const {
  getAutomationState,
  prepareAutomationQueue,
  runAutomationTick,
  sendNextAutomatedMail,
  updateAutomationSettings
} = require('../commercial/automation');
const { businessDate } = require('../commercial/service');

async function testDb(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await crmMigration.up(db);
  await automationMigration.up(db);
  return db;
}

async function addAccount(db, brand, suffix, overrides = {}) {
  const now = new Date();
  const row = {
    id: `automation-account-${suffix}`,
    brand_id: brand.id,
    source_key: `AUTO:${suffix}`,
    source_row_number: Number(suffix.replace(/\D/g, '')) || null,
    company_name: `Komitent ${suffix}`,
    email: `${suffix}@firma.ba`,
    status: 'NEW',
    priority: 'MEDIUM',
    currency: 'BAM',
    source_data_json: '{}',
    created_at: now,
    updated_at: now,
    ...overrides
  };
  await db('crm_accounts').insert(row);
  return row;
}

const director = { id: 'director-sanin', username: 'sanin', role: 'direktor', displayName: 'Sanin' };

test('migracija kreira tri ugašena agenta i unaprijed priprema SAN Pest sadržaj', async (t) => {
  const db = await testDb(t);
  const rows = await db({ s: 'crm_mail_automation_settings' })
    .join({ b: 'crm_brands' }, 'b.id', 's.brand_id')
    .select('b.code', 's.*').orderBy('b.code');

  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => !Boolean(row.enabled) && Boolean(row.paused)));
  const sanPest = rows.find((row) => row.code === 'SAN_PEST');
  assert.equal(sanPest.subject, automationMigration.SAN_PEST_SUBJECT);
  assert.match(sanPest.body_text, /SanPest Platform/);
  assert.equal(Number(sanPest.daily_limit), 30);
});

test('dnevni red bira samo poznate validne CRM adrese i ne ponavlja komitente', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  await addAccount(db, brand, '1', { email: 'prvi@firma.ba', priority: 'HIGH' });
  await addAccount(db, brand, '2', { email: 'drugi@firma.ba', status: 'CALL_REQUIRED' });
  await addAccount(db, brand, '3', { email: 'prvi@firma.ba' });
  await addAccount(db, brand, '4', { email: 'nije-mail' });
  await addAccount(db, brand, '5', { email: 'odbijen@firma.ba', status: 'REJECTED' });
  await addAccount(db, brand, '6', { email: 'arhiva@firma.ba', archived_at: new Date() });
  await updateAutomationSettings(db, brand, director, {
    subject: 'Digitalni HACCP za {{KOMITENT}}',
    body_text: 'Poštovani {{KOMITENT}}, ovo je prijedlog.',
    daily_limit: 30,
    enabled: false
  });

  const first = await prepareAutomationQueue(db, brand, director, { date: '2026-08-17' });
  const second = await prepareAutomationQueue(db, brand, director, { date: '2026-08-17' });

  assert.equal(first.queue.length, 2);
  assert.equal(second.queue.length, 2);
  assert.deepEqual(first.queue.map((row) => row.recipient_email), ['prvi@firma.ba', 'drugi@firma.ba']);
  assert.ok(first.queue.every((row) => row.status === 'PENDING'));
  assert.match(first.queue[0].subject, /Komitent 1/);
  assert.equal(await db('crm_mail_queue').count({ count: '*' }).first().then((row) => Number(row.count)), 2);
});

test('uspješno slanje odmah ažurira komentar, status, follow-up, aktivnost i dnevni zadatak', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const account = await addAccount(db, brand, '10', { email: 'kontakt@firma.ba', comment: 'Stara napomena' });
  const date = businessDate();
  await updateAutomationSettings(db, brand, director, {
    subject: 'Prijedlog za {{KOMITENT}}',
    body_text: 'Poštovani, predstavljamo rješenje.',
    enabled: true,
    auto_send: true,
    follow_up_days: 7
  });
  await prepareAutomationQueue(db, brand, director, { date });
  await db('crm_daily_assignments').insert({
    id: 'daily-assignment-automation',
    user_id: 'commercial-user',
    brand_id: brand.id,
    account_id: account.id,
    assignment_date: date,
    sequence_number: 1,
    status: 'PENDING',
    created_at: new Date(),
    updated_at: new Date()
  });
  const payloads = [];
  const outlookService = {
    config: { writeEnabled: true, mailbox: 'sales@s-consulting.ba' },
    async send(payload) {
      payloads.push(payload);
      return { success: true, accepted: true, id: 'graph-draft-id', conversationId: 'graph-conversation-id' };
    }
  };

  const result = await sendNextAutomatedMail(db, brand, {
    outlookService,
    actor: director,
    ignoreInterval: true,
    now: new Date()
  });

  assert.equal(result.sent, true);
  assert.equal(payloads.length, 1);
  assert.deepEqual(payloads[0].to, ['kontakt@firma.ba']);
  assert.equal(payloads[0].bodyType, 'text');
  const queue = await db('crm_mail_queue').where({ account_id: account.id }).first();
  const saved = await db('crm_accounts').where({ id: account.id }).first();
  const activity = await db('crm_activities').where({ account_id: account.id, activity_type: 'AUTOMATED_EMAIL_SENT' }).first();
  const assignment = await db('crm_daily_assignments').where({ id: 'daily-assignment-automation' }).first();
  assert.equal(queue.status, 'SENT');
  assert.equal(queue.provider_message_id, 'graph-draft-id');
  assert.equal(saved.status, 'EMAIL_SENT');
  assert.match(saved.comment, /Stara napomena/);
  assert.match(saved.comment, /Automatski mail poslan/);
  assert.match(saved.comment, /sales@s-consulting\.ba/);
  assert.ok(saved.last_contact_at);
  assert.ok(saved.next_contact_at);
  assert.equal(activity.to_status, 'EMAIL_SENT');
  assert.equal(assignment.status, 'EMAIL_SENT');
  assert.match(assignment.notes, /Automatski mail poslan/);
});

test('scheduler pripremi red i u jednom ticku šalje najviše jedan mail po brendu', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  await addAccount(db, brand, '20', { email: 'dvadeset@firma.ba' });
  await addAccount(db, brand, '21', { email: 'dvadesetjedan@firma.ba' });
  await updateAutomationSettings(db, brand, director, {
    subject: 'FS App prijedlog',
    body_text: 'Pozdrav iz S Consultinga.',
    enabled: true,
    auto_send: true,
    send_window_start: '09:00',
    send_window_end: '15:00',
    send_interval_minutes: 10
  });
  let sends = 0;
  const outlookService = {
    config: { writeEnabled: true, mailbox: 'sales@s-consulting.ba' },
    async send() {
      sends += 1;
      return { success: true, accepted: true, id: `message-${sends}`, conversationId: `conversation-${sends}` };
    }
  };
  const mondayAtTenSarajevo = new Date('2026-08-17T08:00:00.000Z');

  const first = await runAutomationTick(db, { now: mondayAtTenSarajevo, outlookService });
  const second = await runAutomationTick(db, { now: mondayAtTenSarajevo, outlookService });

  assert.equal(first.results[0].sent, true);
  assert.equal(second.results[0].sent, false);
  assert.equal(sends, 1);
  const state = await getAutomationState(db, brand, { date: '2026-08-17' });
  assert.equal(state.counts.SENT, 1);
  assert.equal(state.counts.APPROVED, 1);
});
