const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const knex = require('knex');
const crmMigration = require('../migrations/20260813120000_create_commercial_crm');
const mailMigration = require('../migrations/20260815120000_add_commercial_mail_automation');
const manualCampaignMigration = require('../migrations/20260817130000_add_manual_commercial_mail_campaigns');
const scheduleReportMigration = require('../migrations/20260818100000_add_commercial_mail_schedule_reports');
const ccMigration = require('../migrations/20260818130000_add_commercial_recipient_cc');
const migration = require('../migrations/20260903160000_create_san_pest_germany_brand');
const seed = require('../data/sanPestGermany20260903.json');
const {
  SANPEST_GERMAN_URL,
  SANPEST_MAIL_BANNERS,
  campaignAttachmentsForBrand,
  campaignBodyForBrand,
  campaignSignatureForBrand
} = require('../commercial/automation');
const { buildSignatureHtml } = require('../outlookMail/signature');
const { ensureDailyAssignments, normalizeBrandCode } = require('../commercial/service');

async function testDb(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await crmMigration.up(db);
  await mailMigration.up(db);
  await manualCampaignMigration.up(db);
  await scheduleReportMigration.up(db);
  await ccMigration.up(db);

  const now = new Date('2026-09-03T12:00:00.000Z');
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

test('Excel snapshot sadrži svih 255 njemačkih DDD firmi bez duplih glavnih emailova', () => {
  assert.equal(migration.validateSeed(), true);
  assert.deepEqual(seed.source, {
    fileName: 'SANpest_Njemacka_DDD_baza_2026.xlsx',
    sha256: '43F1B1341E934B96E8267BF3F861C4287B7D4DBD0F51A20AA681B74187E90D58',
    sheetName: 'NJEMAČKA',
    usedRange: 'A1:S259',
    dataRange: 'A5:S259',
    importedRowCount: 255,
    extractedAt: '2026-09-03T00:00:00.000Z'
  });
  const rows = seed.brands[0].rows;
  assert.equal(rows.length, 255);
  assert.equal(rows.filter((row) => row.email).length, 67);
  assert.equal(rows.filter((row) => !row.email).length, 188);
  assert.equal(rows.reduce((sum, row) => sum + row.additionalEmails.length, 0), 3);
  assert.equal(new Set(rows.map((row) => row.email).filter(Boolean)).size, 67);
  assert.deepEqual(rows.filter((row) => row.additionalEmails.length).map((row) => row.nr), [5, 11, 159]);

  for (const alias of ['SAN_PEST_GERMANY', 'san-pest-germany', 'SANPESTDEUTSCHLAND', 'SANPESTNJEMACKA']) {
    assert.equal(normalizeBrandCode(alias), 'SAN_PEST_GERMANY');
  }
});

test('njemačka kampanja koristi njemački link, dostavljeni DE banner kao prilog i njemački potpis', () => {
  const brand = { code: 'SAN_PEST_GERMANY' };
  const body = campaignBodyForBrand(brand, migration.MAIL_BODY);
  assert.equal(SANPEST_GERMAN_URL, migration.GERMAN_PAGE_URL);
  assert.equal(body.bodyType, 'html');
  assert.match(body.body, new RegExp(`href="${SANPEST_GERMAN_URL}"`));
  assert.match(body.body, /Sehr geehrte Damen und Herren/);
  assert.match(body.body, /Weitere Informationen finden Sie auf unserer deutschsprachigen Seite/);
  assert.doesNotMatch(body.body, /<img|banner/i);

  const attachments = campaignAttachmentsForBrand(brand);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, 'SANpest-Banner-DE.png');
  assert.equal(attachments[0].contentType, 'image/png');
  assert.equal(attachments[0].size, 1721117);
  assert.equal(
    crypto.createHash('sha256').update(Buffer.from(attachments[0].contentBytes, 'base64')).digest('hex').toUpperCase(),
    SANPEST_MAIL_BANNERS.SAN_PEST_GERMANY.sha256
  );

  const signature = campaignSignatureForBrand(brand);
  assert.deepEqual(signature, {
    greeting: 'Mit freundlichen Grüßen',
    title: 'Geschäftsführerin | S-Consulting Group',
    website: 'www.s-consulting.ba/de',
    address: 'Tvornička 3, Sarajevo, Bosnien und Herzegowina'
  });
  const html = buildSignatureHtml(signature);
  assert.match(html, /Mit freundlichen Grüßen/);
  assert.match(html, /Geschäftsführerin \| S-Consulting Group/);
  assert.match(html, /Bosnien und Herzegowina/);
  assert.match(html, /www\.s-consulting\.ba\/de/);
  assert.doesNotMatch(html, /Lijep pozdrav|Direktor \|/);
});

test('migracija odvaja njemačku bazu, uvozi sve firme i postavlja sigurnu ručnu kampanju', async (t) => {
  const db = await testDb(t);
  await migration.up(db);
  await migration.up(db);

  const brand = await db('crm_brands').where({ code: 'SAN_PEST_GERMANY' }).first();
  assert.deepEqual([brand.id, brand.slug, brand.name], [
    'brand-san-pest-germany', 'san-pest-njemacka', 'SAN Pest Njemačka'
  ]);

  const accounts = await db('crm_accounts').where({ brand_id: brand.id }).orderBy('source_row_number');
  assert.equal(accounts.length, 255);
  assert.equal(accounts.filter((row) => row.email).length, 67);
  assert.deepEqual(
    ['source_key', 'company_name', 'email', 'priority', 'status'].map((key) => accounts[0][key]),
    ['SAN_PEST_GERMANY:20260903:1', '"Das" Kill-Team Schädlingsbekämpfung GmbH', 'info@kill-team.de', 'HIGH', 'NEW']
  );
  assert.match(accounts[0].location, /Hamburg, Deutschland/);
  assert.match(accounts[0].notes, /SANpest-Fit: 8\.7\/10/);
  assert.match(accounts[0].source_data_json, /Bundesland/);
  assert.deepEqual(JSON.parse(accounts.find((row) => row.source_key.endsWith(':5')).cc_emails_json), ['andreas.pusch@exem.de']);

  assert.deepEqual(countBy(await db('crm_accounts').where({ brand_id: brand.id })
    .select('priority').count({ count: '*' }).groupBy('priority'), 'priority'), {
    HIGH: 100, LOW: 14, MEDIUM: 141
  });
  assert.deepEqual(countBy(await db('crm_accounts').where({ brand_id: brand.id })
    .select('status').count({ count: '*' }).groupBy('status'), 'status'), {
    CALL_REQUIRED: 73, NEW: 182
  });

  const settings = await db('crm_mail_automation_settings').where({ brand_id: brand.id }).first();
  assert.equal(Boolean(settings.enabled), false);
  assert.equal(Boolean(settings.paused), true);
  assert.equal(Boolean(settings.auto_send), false);
  assert.equal(Number(settings.daily_limit), 30);
  assert.equal(Number(settings.send_interval_minutes), 5);
  assert.equal(settings.subject, migration.MAIL_SUBJECT);
  assert.equal(settings.body_text, migration.MAIL_BODY);
  assert.match(settings.body_text, /digitale Plattform/);
  assert.match(settings.body_text, new RegExp(migration.GERMAN_PAGE_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(settings.body_text, /Poštovani|javljam Vam|Kind regards|Dear /i);

  const access = await db('app_user_brand_access').where({ user_id: 'commercial-user', brand_id: brand.id }).first();
  assert.equal(Boolean(access.can_read), true);
  assert.equal(Boolean(access.can_write), false);

  const daily = await ensureDailyAssignments(db, { id: 'daily-director', role: 'direktor' }, brand, { date: '2026-09-03' });
  assert.equal(daily.items.length, 30);
  assert.equal(daily.items.every((item) => item.account.brand_id === brand.id), true);
});
