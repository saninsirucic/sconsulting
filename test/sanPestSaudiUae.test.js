const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');
const crmMigration = require('../migrations/20260813120000_create_commercial_crm');
const mailMigration = require('../migrations/20260815120000_add_commercial_mail_automation');
const manualCampaignMigration = require('../migrations/20260817130000_add_manual_commercial_mail_campaigns');
const scheduleReportMigration = require('../migrations/20260818100000_add_commercial_mail_schedule_reports');
const ccMigration = require('../migrations/20260818130000_add_commercial_recipient_cc');
const migration = require('../migrations/20260901120000_create_san_pest_saudi_uae_brands');
const seed = require('../data/sanPestSaudiUae20260901.json');
const {
  SANPEST_ENGLISH_URL,
  campaignAttachmentsForBrand,
  campaignBodyForBrand
} = require('../commercial/automation');
const { ensureDailyAssignments, normalizeBrandCode } = require('../commercial/service');

async function testDb(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await crmMigration.up(db);
  await mailMigration.up(db);
  await manualCampaignMigration.up(db);
  await scheduleReportMigration.up(db);
  await ccMigration.up(db);

  const now = new Date('2026-09-01T12:00:00.000Z');
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

test('Excel snapshot sadrži po 100 odvojenih zapisa za Saudijsku Arabiju i UAE', () => {
  assert.equal(migration.validateSeed(), true);
  assert.deepEqual(seed.source, {
    fileName: 'SANpest_TOP100_UAE_TOP100_Saudija.xlsx',
    sha256: 'A9E5565573D191CBDA47F85B2194125590F06B9A729A9B129FED0B335016D497',
    sheetName: 'TOP 200',
    usedRange: 'A1:Q204',
    dataRange: 'A5:Q204',
    importedRowCount: 200,
    extractedAt: '2026-09-01T00:00:00.000Z'
  });
  assert.deepEqual(seed.brands.map((brand) => [brand.code, brand.market, brand.rowCount]), [
    ['SAN_PEST_SAUDI', 'Saudijska Arabija', 100],
    ['SAN_PEST_UAE', 'UAE', 100]
  ]);
  assert.equal(seed.brands[0].rows.filter((row) => row.email).length, 46);
  assert.equal(seed.brands[1].rows.filter((row) => row.email).length, 94);
  assert.equal(seed.brands[0].rows.reduce((sum, row) => sum + row.additionalEmails.length, 0), 17);
  assert.equal(seed.brands[1].rows.reduce((sum, row) => sum + row.additionalEmails.length, 0), 3);

  for (const alias of ['SAN_PEST_SAUDI', 'san-pest-saudi-arabia', 'SANPESTSAUDIJSKAARABIJA']) {
    assert.equal(normalizeBrandCode(alias), 'SAN_PEST_SAUDI');
  }
  for (const alias of ['SAN_PEST_UAE', 'san-pest-uae', 'SANPESTEMIRATES']) {
    assert.equal(normalizeBrandCode(alias), 'SAN_PEST_UAE');
  }
});

test('Saudi i UAE kampanje dobijaju engleski link, ali nemaju banner prilog', () => {
  for (const code of ['SAN_PEST_SAUDI', 'SAN_PEST_UAE']) {
    const result = campaignBodyForBrand(
      { code },
      `Dear team,\n\n${migration.ENGLISH_COMMUNICATION_SENTENCE}`
    );
    assert.equal(result.bodyType, 'html');
    assert.match(result.body, new RegExp(`href="${SANPEST_ENGLISH_URL}"`));
    assert.ok(result.body.endsWith(migration.ENGLISH_COMMUNICATION_SENTENCE));
    assert.doesNotMatch(result.body, /<img|banner/i);
    assert.deepEqual(campaignAttachmentsForBrand({ code }), []);
  }
});

test('migracija uvozi i odvaja svih 200 zapisa, pristupe i ručne mail kampanje', async (t) => {
  const db = await testDb(t);
  await migration.up(db);
  await migration.up(db);

  const brands = await db('crm_brands').whereIn('code', ['SAN_PEST_SAUDI', 'SAN_PEST_UAE'])
    .select('*').orderBy('code');
  assert.deepEqual(brands.map((brand) => [brand.code, brand.name, brand.slug]), [
    ['SAN_PEST_SAUDI', 'SAN Pest Saudijska Arabija', 'san-pest-saudijska-arabija'],
    ['SAN_PEST_UAE', 'SAN Pest UAE', 'san-pest-uae']
  ]);

  const saudi = brands[0];
  const uae = brands[1];
  const saudiAccounts = await db('crm_accounts').where({ brand_id: saudi.id }).orderBy('source_row_number');
  const uaeAccounts = await db('crm_accounts').where({ brand_id: uae.id }).orderBy('source_row_number');
  assert.equal(saudiAccounts.length, 100);
  assert.equal(uaeAccounts.length, 100);
  assert.equal(saudiAccounts.filter((row) => row.email).length, 46);
  assert.equal(uaeAccounts.filter((row) => row.email).length, 94);

  assert.deepEqual(
    ['source_key', 'company_name', 'email', 'priority', 'status'].map((key) => saudiAccounts[0][key]),
    ['SAN_PEST_SAUDI:20260901:1', 'JAK Generation Pest Management', 'info@jakpest.com', 'HIGH', 'NEW']
  );
  assert.match(saudiAccounts[0].location, /Saudijska Arabija/);
  assert.match(saudiAccounts[0].source_data_json, /Tržište/);
  assert.deepEqual(
    ['source_key', 'company_name', 'email', 'priority', 'status'].map((key) => uaeAccounts[0][key]),
    ['SAN_PEST_UAE:20260901:1', '369 Pest Control & Disinfection Services LLC', 'adnan@369pestcontrol.com', 'HIGH', 'NEW']
  );
  assert.match(uaeAccounts[0].location, /Dubai.*UAE/);

  assert.deepEqual(countBy(await db('crm_accounts').where({ brand_id: saudi.id })
    .select('priority').count({ count: '*' }).groupBy('priority'), 'priority'), { HIGH: 42, LOW: 9, MEDIUM: 49 });
  assert.deepEqual(countBy(await db('crm_accounts').where({ brand_id: uae.id })
    .select('priority').count({ count: '*' }).groupBy('priority'), 'priority'), { HIGH: 50, MEDIUM: 50 });
  assert.deepEqual(countBy(await db('crm_accounts').where({ brand_id: saudi.id })
    .select('status').count({ count: '*' }).groupBy('status'), 'status'), { CALL_REQUIRED: 28, NEW: 72 });
  assert.deepEqual(countBy(await db('crm_accounts').where({ brand_id: uae.id })
    .select('status').count({ count: '*' }).groupBy('status'), 'status'), { CALL_REQUIRED: 6, NEW: 94 });

  const masa = saudiAccounts.find((row) => row.source_key.endsWith(':3'));
  assert.deepEqual(JSON.parse(masa.cc_emails_json), [
    'info@masapestcontrol.com.sa', 'jeddah@masapestcontrol.sa',
    'riyadh@masapestcontrol.sa', 'dammam@masapestcontrol.sa'
  ]);

  const settings = await db('crm_mail_automation_settings').whereIn('brand_id', [saudi.id, uae.id]);
  assert.equal(settings.length, 2);
  for (const row of settings) {
    assert.equal(Boolean(row.enabled), false);
    assert.equal(Boolean(row.paused), true);
    assert.equal(Boolean(row.auto_send), false);
    assert.equal(Number(row.daily_limit), 30);
    assert.equal(Number(row.send_interval_minutes), 5);
    assert.equal(row.report_recipient, 'info@s-consulting.ba');
    assert.match(row.subject, /Digitise your pest control operations/);
    assert.ok(row.body_text.endsWith(migration.ENGLISH_COMMUNICATION_SENTENCE));
  }
  assert.match(settings.find((row) => row.brand_id === saudi.id).body_text, /English and Arabic operational documents/);
  assert.match(settings.find((row) => row.brand_id === uae.id).body_text, /AMC contracts/);

  for (const brand of brands) {
    const access = await db('app_user_brand_access').where({ user_id: 'commercial-user', brand_id: brand.id }).first();
    assert.equal(Boolean(access.can_read), true);
    assert.equal(Boolean(access.can_write), false);
  }

  const daily = await ensureDailyAssignments(db, { id: 'daily-director', role: 'direktor' }, uae, { date: '2026-09-01' });
  assert.equal(daily.items.length, 30);
  assert.equal(daily.items.every((item) => item.account.brand_id === uae.id), true);
});
