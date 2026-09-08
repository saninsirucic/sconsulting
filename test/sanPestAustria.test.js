const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');
const migration = require('../migrations/20260908110000_create_san_pest_austria_hide_poland');
const germanyMigration = require('../migrations/20260903160000_create_san_pest_germany_brand');
const { campaignAttachmentsForBrand, campaignBodyForBrand, campaignSignatureForBrand } = require('../commercial/automation');
const { listAccessibleBrands, resolveBrand } = require('../commercial/service');

async function testDb(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  for (const name of [
    '20260813120000_create_commercial_crm', '20260815120000_add_commercial_mail_automation',
    '20260817130000_add_manual_commercial_mail_campaigns', '20260818100000_add_commercial_mail_schedule_reports',
    '20260818130000_add_commercial_recipient_cc', '20260903160000_create_san_pest_germany_brand'
  ]) await require(`../migrations/${name}`).up(db);
  const now = new Date();
  await db('crm_brands').insert({ id: 'brand-san-pest-poland', code: 'SAN_PEST_POLAND', slug: 'san-pest-poljska', name: 'SAN Pest Poljska', active: true, created_at: now, updated_at: now });
  await db('crm_accounts').insert({ id: 'poland-sent', brand_id: 'brand-san-pest-poland', source_key: 'existing', company_name: 'Existing Polish company', email: 'existing@example.pl', status: 'EMAIL_SENT', source_data_json: '{}', created_at: now, updated_at: now });
  await db('crm_activities').insert({ id: 'poland-history', account_id: 'poland-sent', brand_id: 'brand-san-pest-poland', activity_type: 'COMMERCIAL_EMAIL_SENT', notes: 'Preserve this history', occurred_at: now, created_at: now });
  await db('app_users').insert({ id: 'user-at', username: 'user-at', username_normalized: 'user-at', password_hash: 'test-only', role: 'komercijala', created_at: now, updated_at: now });
  await db('app_user_brand_access').insert({ id: 'germany-access', user_id: 'user-at', brand_id: 'brand-san-pest-germany', can_read: true, can_write: false, created_at: now, updated_at: now });
  await db('crm_mail_automation_settings').where({ brand_id: 'brand-san-pest-germany' }).update({ subject: 'Aktuell: {{KOMITENT}}', body_text: `${germanyMigration.MAIL_BODY}\nAktueller gespeicherter Text.`, last_prepared_date: '2026-09-08', last_sent_at: now });
  return db;
}

test('Austria renders exactly the German message, signature, link and banner', () => {
  const de = { code: 'SAN_PEST_GERMANY' }, at = { code: 'SAN_PEST_AUSTRIA' };
  assert.deepEqual(campaignBodyForBrand(at, germanyMigration.MAIL_BODY), campaignBodyForBrand(de, germanyMigration.MAIL_BODY));
  assert.deepEqual(campaignSignatureForBrand(at), campaignSignatureForBrand(de));
  assert.deepEqual(campaignAttachmentsForBrand(at), campaignAttachmentsForBrand(de));
});

test('imports all 128 source contacts, copies live German mail, hides Poland and preserves existing data', async (t) => {
  const db = await testDb(t);
  const oldAccounts = await db('crm_accounts').orderBy('id');
  const oldHistory = await db('crm_activities').orderBy('id');
  const germanSettings = await db('crm_mail_automation_settings').where({ brand_id: 'brand-san-pest-germany' }).first();
  await migration.up(db);
  await migration.up(db);
  const accounts = await db('crm_accounts').where({ brand_id: migration.TARGET.id }).orderBy('source_row_number');
  assert.equal(accounts.length, 128);
  assert.equal(accounts.filter(a => a.email).length, 120);
  assert.equal(new Set(accounts.map(a => a.email).filter(Boolean)).size, 118);
  assert.equal(accounts.filter(a => a.status === 'CALL_REQUIRED').length, 8);
  assert.equal(new Set(accounts.map(a => a.company_name)).size, 128);
  assert.equal(accounts[0].email, 'team@biotech.at');
  assert.equal(accounts.at(-1).email, null);
  assert.equal(accounts.at(-1).phone, null);
  assert.equal(accounts[75].email, null, 'A different person mentioned in notes must not become the email recipient');
  for (const a of accounts) assert.equal(JSON.parse(a.source_data_json).ID, String(a.source_row_number));
  assert.deepEqual(await db('crm_accounts').whereNot({ brand_id: migration.TARGET.id }).orderBy('id'), oldAccounts);
  assert.deepEqual(await db('crm_activities').orderBy('id'), oldHistory);
  assert.deepEqual(await db('crm_mail_automation_settings').where({ brand_id: 'brand-san-pest-germany' }).first(), germanSettings);
  const settings = await db('crm_mail_automation_settings').where({ brand_id: migration.TARGET.id }).first();
  assert.equal(settings.subject, germanSettings.subject);
  assert.equal(settings.body_text, germanSettings.body_text);
  assert.equal(Boolean(settings.enabled), false);
  assert.equal(Boolean(settings.auto_send), false);
  assert.equal(Boolean(settings.paused), true);
  assert.equal(settings.last_sent_at, null);
  assert.equal(settings.last_prepared_date, null);
  assert.equal((await db('crm_mail_queue').where({ brand_id: migration.TARGET.id })).length, 0);
  const director = { id: 'director', role: 'direktor' };
  const brands = await listAccessibleBrands(db, director);
  assert.ok(brands.some(b => b.code === 'SAN_PEST_AUSTRIA' && b.record_count === 128));
  assert.ok(!brands.some(b => b.code === 'SAN_PEST_POLAND'));
  assert.equal((await resolveBrand(db, director, 'san-pest-austrija')).id, migration.TARGET.id);
  const access = await db('app_user_brand_access').where({ brand_id: migration.TARGET.id, user_id: 'user-at' }).first();
  assert.equal(Boolean(access.can_read), true);
  assert.equal(Boolean(access.can_write), false);
  await assert.rejects(resolveBrand(db, { id: 'user-at', role: 'komercijala' }, 'SAN_PEST_AUSTRIA', { write: true }), /pristup/);
});
