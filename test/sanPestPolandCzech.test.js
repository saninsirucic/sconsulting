const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');
const crmMigration = require('../migrations/20260813120000_create_commercial_crm');
const mailMigration = require('../migrations/20260815120000_add_commercial_mail_automation');
const manualCampaignMigration = require('../migrations/20260817130000_add_manual_commercial_mail_campaigns');
const scheduleReportMigration = require('../migrations/20260818100000_add_commercial_mail_schedule_reports');
const ccMigration = require('../migrations/20260818130000_add_commercial_recipient_cc');
const migration = require('../migrations/20260831170000_create_san_pest_poland_czech_brands');
const seed = require('../data/sanPestPolandCzech20260831.json');
const { ensureDailyAssignments, normalizeBrandCode } = require('../commercial/service');

async function testDb(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await crmMigration.up(db);
  await mailMigration.up(db);
  await manualCampaignMigration.up(db);
  await scheduleReportMigration.up(db);
  await ccMigration.up(db);

  const now = new Date('2026-08-31T12:00:00.000Z');
  await db('app_users').insert({
    id: 'commercial-user',
    username: 'komercijala',
    username_normalized: 'komercijala',
    password_hash: 'test-only',
    display_name: 'Komercijala',
    role: 'komercijala',
    active: true,
    must_change_password: false,
    created_at: now,
    updated_at: now
  });
  await db('app_user_brand_access').insert({
    id: 'commercial-san-pest-access',
    user_id: 'commercial-user',
    brand_id: 'brand-san-pest',
    can_read: true,
    can_write: false,
    created_at: now,
    updated_at: now
  });
  return db;
}

function countBy(rows, key) {
  return Object.fromEntries(rows.map((row) => [row[key], Number(row.count)]));
}

test('Excel snapshot je potpun, determinističan i odvojen po državama', () => {
  assert.equal(migration.validateSeed(), true);
  assert.equal(seed.source.fileName, 'SANpest_Poljska_Ceska_DDD_baza_2026.xlsx');
  assert.equal(seed.source.sha256, '459294C66EB936396C18526D837148439B296FBB4ABCBD985B74A0438BCC7CAD');
  assert.equal(seed.source.importedRowCount, 335);
  assert.deepEqual(seed.brands.map(({ code, sheetName, usedRange, rowCount }) => ({
    code, sheetName, usedRange, rowCount
  })), [
    { code: 'SAN_PEST_POLAND', sheetName: 'POLJSKA', usedRange: 'A1:S162', rowCount: 158 },
    { code: 'SAN_PEST_CZECH', sheetName: 'ČEŠKA', usedRange: 'A1:S181', rowCount: 177 }
  ]);
  assert.equal(seed.brands[0].rows.filter((row) => row.email).length, 137);
  assert.equal(seed.brands[1].rows.filter((row) => row.email).length, 133);
  for (const alias of ['SAN_PEST_POLAND', 'san-pest-poljska', 'SANPESTPOLSKA']) {
    assert.equal(normalizeBrandCode(alias), 'SAN_PEST_POLAND');
  }
  for (const alias of ['SAN_PEST_CZECH', 'san-pest-ceska', 'SANPESTCESKO']) {
    assert.equal(normalizeBrandCode(alias), 'SAN_PEST_CZECH');
  }
});

test('migracija uvozi 158 poljskih i 177 čeških zapisa sa pristupom i lokalizovanim mailovima', async (t) => {
  const db = await testDb(t);
  await migration.up(db);
  await migration.up(db);

  const brands = await db('crm_brands').whereIn('code', ['SAN_PEST_POLAND', 'SAN_PEST_CZECH'])
    .select('*').orderBy('code');
  assert.deepEqual(brands.map((brand) => [brand.code, brand.name, brand.slug]), [
    ['SAN_PEST_CZECH', 'SAN Pest Češka', 'san-pest-ceska'],
    ['SAN_PEST_POLAND', 'SAN Pest Poljska', 'san-pest-poljska']
  ]);

  const poland = brands.find((brand) => brand.code === 'SAN_PEST_POLAND');
  const czech = brands.find((brand) => brand.code === 'SAN_PEST_CZECH');
  const polishAccounts = await db('crm_accounts').where({ brand_id: poland.id }).orderBy('source_row_number');
  const czechAccounts = await db('crm_accounts').where({ brand_id: czech.id }).orderBy('source_row_number');
  assert.equal(polishAccounts.length, 158);
  assert.equal(czechAccounts.length, 177);
  assert.ok(polishAccounts.every((row) => !row.phone || row.phone.length <= 100));
  assert.ok(czechAccounts.every((row) => !row.phone || row.phone.length <= 100));
  assert.match(polishAccounts.find((row) => row.source_row_number === 131).raw_contact, /882 731 562/);
  assert.equal(polishAccounts.filter((row) => row.email).length, 137);
  assert.equal(czechAccounts.filter((row) => row.email).length, 133);

  expectAccount(polishAccounts[0], {
    source_key: 'SAN_PEST_POLAND:20260831:1',
    company_name: 'Protect24h.pl',
    contact_person: 'Paweł Matuszewicz',
    email: 'biuro@protect24h.pl',
    priority: 'MEDIUM',
    status: 'NEW'
  });
  assert.match(polishAccounts[0].location, /Wrocław.*Poljska/);
  assert.match(polishAccounts[0].source_data_json, /Województwo/);

  assert.equal(czechAccounts[0].source_key, 'SAN_PEST_CZECH:20260831:1');
  assert.equal(czechAccounts[0].company_name, 'PestCorp s.r.o.');
  assert.equal(czechAccounts[0].email, 'info@pestcorp.cz');
  assert.equal(czechAccounts[0].priority, 'HIGH');
  assert.match(czechAccounts[0].location, /Doubek.*Češka/);
  assert.match(czechAccounts[0].source_data_json, /Středočeský kraj/);

  const polishPriorities = countBy(await db('crm_accounts').where({ brand_id: poland.id })
    .select('priority').count({ count: '*' }).groupBy('priority'), 'priority');
  const czechPriorities = countBy(await db('crm_accounts').where({ brand_id: czech.id })
    .select('priority').count({ count: '*' }).groupBy('priority'), 'priority');
  assert.deepEqual(polishPriorities, { HIGH: 62, LOW: 21, MEDIUM: 75 });
  assert.deepEqual(czechPriorities, { HIGH: 72, LOW: 8, MEDIUM: 97 });

  const polishStatuses = countBy(await db('crm_accounts').where({ brand_id: poland.id })
    .select('status').count({ count: '*' }).groupBy('status'), 'status');
  const czechStatuses = countBy(await db('crm_accounts').where({ brand_id: czech.id })
    .select('status').count({ count: '*' }).groupBy('status'), 'status');
  assert.deepEqual(polishStatuses, { CALL_REQUIRED: 20, NEW: 138 });
  assert.deepEqual(czechStatuses, { CALL_REQUIRED: 15, NEW: 162 });

  const polishWithCc = polishAccounts.find((row) => JSON.parse(row.cc_emails_json).length > 0);
  const czechWithCc = czechAccounts.find((row) => JSON.parse(row.cc_emails_json).length > 0);
  assert.ok(polishWithCc);
  assert.ok(czechWithCc);
  assert.doesNotMatch(polishWithCc.cc_emails_json, new RegExp(polishWithCc.email, 'i'));
  assert.doesNotMatch(czechWithCc.cc_emails_json, new RegExp(czechWithCc.email, 'i'));

  const settings = await db('crm_mail_automation_settings').whereIn('brand_id', [poland.id, czech.id]);
  assert.equal(settings.length, 2);
  const polishSettings = settings.find((row) => row.brand_id === poland.id);
  const czechSettings = settings.find((row) => row.brand_id === czech.id);
  for (const row of settings) {
    assert.equal(Boolean(row.enabled), false);
    assert.equal(Boolean(row.paused), true);
    assert.equal(Boolean(row.auto_send), false);
    assert.equal(Number(row.daily_limit), 30);
    assert.equal(Number(row.send_interval_minutes), 5);
    assert.equal(row.report_recipient, 'info@s-consulting.ba');
    assert.ok(row.body_text.endsWith(migration.ENGLISH_COMMUNICATION_SENTENCE));
    assert.doesNotMatch(row.body_text, /Srdačan pozdrav|Ermina Siručić/);
  }
  assert.match(polishSettings.subject, /Cyfryzacja/);
  assert.match(polishSettings.body_text, /Dzień dobry|Jeżeli temat/);
  assert.match(czechSettings.subject, /Digitalizace/);
  assert.match(czechSettings.body_text, /Dobrý den|Pokud je pro Vás/);

  for (const brand of brands) {
    const access = await db('app_user_brand_access').where({
      user_id: 'commercial-user', brand_id: brand.id
    }).first();
    assert.equal(Boolean(access.can_read), true);
    assert.equal(Boolean(access.can_write), false);
  }

  const daily = await ensureDailyAssignments(
    db,
    { id: 'daily-director', role: 'direktor' },
    poland,
    { date: '2026-08-31' }
  );
  assert.equal(daily.items.length, 30);
  assert.equal(daily.items.every((item) => item.account.brand_id === poland.id), true);
});

function expectAccount(actual, expected) {
  for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], value);
  return actual;
}
