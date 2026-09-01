const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const knex = require('knex');
const crmMigration = require('../migrations/20260813120000_create_commercial_crm');
const mailMigration = require('../migrations/20260815120000_add_commercial_mail_automation');
const manualCampaignMigration = require('../migrations/20260817130000_add_manual_commercial_mail_campaigns');
const scheduleReportMigration = require('../migrations/20260818100000_add_commercial_mail_schedule_reports');
const ccMigration = require('../migrations/20260818130000_add_commercial_recipient_cc');
const migration = require('../migrations/20260901140000_create_san_pest_bahrain_brand');
const seed = require('../data/sanPestBahrain20260901.json');
const {
  SANPEST_ENGLISH_URL,
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

test('Excel snapshot sadrži svih 36 Bahrain firmi i njihove provjerene kontakte', () => {
  assert.equal(migration.validateSeed(), true);
  assert.deepEqual(seed.source, {
    fileName: 'SANpest_BAHREIN_firme_2026.xlsx',
    sha256: '8DB51114848DF4AEB31B88508CC173DEE78E3FDE8EF8C9F4218B0191B83ADCD4',
    sheetName: 'BAHREIN',
    usedRange: 'A1:S39',
    dataRange: 'A2:S37',
    importedRowCount: 36,
    extractedAt: '2026-09-01T00:00:00.000Z'
  });
  const rows = seed.brands[0].rows;
  assert.equal(rows.length, 36);
  assert.equal(rows.filter((row) => row.email).length, 26);
  assert.equal(rows.reduce((sum, row) => sum + row.additionalEmails.length, 0), 2);
  assert.deepEqual(rows.filter((row) => !row.email).map((row) => row.nr), [3, 9, 15, 19, 29, 30, 31, 32, 33, 36]);
  assert.deepEqual(rows.find((row) => row.nr === 23).additionalEmails, ['joz@jozgroup.com']);
  assert.deepEqual(rows.find((row) => row.nr === 25).additionalEmails, ['admin@ufsgroup.co']);

  for (const alias of ['SAN_PEST_BAHRAIN', 'san-pest-bahrain', 'SANPESTBAHREIN']) {
    assert.equal(normalizeBrandCode(alias), 'SAN_PEST_BAHRAIN');
  }
});

test('Bahrain kampanja koristi engleski link, EN banner kao prilog i engleski potpis', () => {
  const brand = { code: 'SAN_PEST_BAHRAIN' };
  const body = campaignBodyForBrand(brand, `Dear team,\n\n${migration.ENGLISH_COMMUNICATION_SENTENCE}`);
  assert.equal(body.bodyType, 'html');
  assert.match(body.body, new RegExp(`href="${SANPEST_ENGLISH_URL}"`));
  assert.ok(body.body.endsWith(migration.ENGLISH_COMMUNICATION_SENTENCE));
  assert.doesNotMatch(body.body, /<img|banner/i);

  const attachments = campaignAttachmentsForBrand(brand);
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].name, 'SANpest-Banner-EN.png');
  assert.equal(attachments[0].contentType, 'image/png');
  assert.equal(attachments[0].size, 1596868);
  assert.equal(
    crypto.createHash('sha256').update(Buffer.from(attachments[0].contentBytes, 'base64')).digest('hex').toUpperCase(),
    SANPEST_MAIL_BANNERS.SAN_PEST_BAHRAIN.sha256
  );

  const signature = campaignSignatureForBrand(brand);
  assert.deepEqual(signature, {
    greeting: 'Kind regards,',
    title: 'Director | S-Consulting Group',
    address: 'Tvornička 3, Sarajevo, Bosnia and Herzegovina'
  });
  const html = buildSignatureHtml(signature);
  assert.match(html, /Kind regards/);
  assert.doesNotMatch(html, /Lijep pozdrav/);
});

test('migracija odvaja Bahrain bazu, uvozi svih 36 firmi i postavlja ručnu kampanju', async (t) => {
  const db = await testDb(t);
  await migration.up(db);
  await migration.up(db);

  const brand = await db('crm_brands').where({ code: 'SAN_PEST_BAHRAIN' }).first();
  assert.deepEqual([brand.id, brand.slug, brand.name], [
    'brand-san-pest-bahrain', 'san-pest-bahrain', 'SAN Pest Bahrain'
  ]);

  const accounts = await db('crm_accounts').where({ brand_id: brand.id }).orderBy('source_row_number');
  assert.equal(accounts.length, 36);
  assert.equal(accounts.filter((row) => row.email).length, 26);
  assert.deepEqual(
    ['source_key', 'company_name', 'email', 'priority', 'status'].map((key) => accounts[0][key]),
    ['SAN_PEST_BAHRAIN:20260901:1', 'Verminex Co. W.L.L.', 'sales@verminexbahrain.com', 'HIGH', 'NEW']
  );
  assert.match(accounts[0].location, /Manama.*Bahrain/);
  assert.match(accounts[0].notes, /Cilj implementacije: 20000 EUR/);
  assert.match(accounts[0].source_data_json, /Cilj implementacija EUR/);
  assert.deepEqual(JSON.parse(accounts.find((row) => row.source_key.endsWith(':23')).cc_emails_json), ['joz@jozgroup.com']);

  assert.deepEqual(countBy(await db('crm_accounts').where({ brand_id: brand.id })
    .select('priority').count({ count: '*' }).groupBy('priority'), 'priority'), { HIGH: 23, LOW: 2, MEDIUM: 11 });
  assert.deepEqual(countBy(await db('crm_accounts').where({ brand_id: brand.id })
    .select('status').count({ count: '*' }).groupBy('status'), 'status'), { CALL_REQUIRED: 10, NEW: 26 });

  const settings = await db('crm_mail_automation_settings').where({ brand_id: brand.id }).first();
  assert.equal(Boolean(settings.enabled), false);
  assert.equal(Boolean(settings.paused), true);
  assert.equal(Boolean(settings.auto_send), false);
  assert.equal(Number(settings.daily_limit), 30);
  assert.equal(Number(settings.send_interval_minutes), 5);
  assert.equal(settings.subject, migration.MAIL_SUBJECT);
  assert.match(settings.body_text, /pest control companies in Bahrain/);
  assert.match(settings.body_text, /English and Arabic/);
  assert.ok(settings.body_text.endsWith(migration.ENGLISH_COMMUNICATION_SENTENCE));

  const access = await db('app_user_brand_access').where({ user_id: 'commercial-user', brand_id: brand.id }).first();
  assert.equal(Boolean(access.can_read), true);
  assert.equal(Boolean(access.can_write), false);

  const daily = await ensureDailyAssignments(db, { id: 'daily-director', role: 'direktor' }, brand, { date: '2026-09-01' });
  assert.equal(daily.items.length, 30);
  assert.equal(daily.items.every((item) => item.account.brand_id === brand.id), true);
});
