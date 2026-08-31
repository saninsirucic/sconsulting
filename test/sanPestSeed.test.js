const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');
const crmMigration = require('../migrations/20260813120000_create_commercial_crm');
const sanPestMigration = require('../migrations/20260814110000_seed_san_pest_crm');
const sanPestSeed = require('../data/sanPestSeed.json');
const { ensureDailyAssignments } = require('../commercial/service');

async function testDb(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await crmMigration.up(db);
  return db;
}

test('SAN Pest snapshot odgovara pregledanom Excel izvoru', () => {
  assert.equal(sanPestSeed.source.fileName, 'DDD_Komercijala_final.xlsx');
  assert.equal(sanPestSeed.source.sheetName, 'DDD komercijala');
  assert.equal(sanPestSeed.source.usedRange, 'A1:O157');
  assert.equal(sanPestSeed.source.sha256, 'E6F264D98DCD61C661558E0D6F8527BE197D822D6324EDF1D961E219D88C348D');
  assert.equal(sanPestSeed.source.importedRowCount, 156);
  assert.equal(sanPestSeed.rows.length, 156);
  assert.deepEqual(sanPestSeed.rows.map((row) => row.nr), Array.from({ length: 156 }, (_, index) => index + 1));
  sanPestMigration.validateSeed();
});

test('SAN Pest migracija uvozi svih 156 zapisa i čuva originalne kolone', async (t) => {
  const db = await testDb(t);
  await sanPestMigration.up(db);

  const brand = await db('crm_brands').where({ code: 'SAN_PEST' }).first();
  const records = await db('crm_accounts').where({ brand_id: brand.id }).orderBy('source_row_number');
  assert.equal(records.length, 156);

  const first = records[0];
  assert.equal(first.source_key, 'SAN_PEST:DDD_KOMERCIJALA_FINAL:1');
  assert.equal(first.company_name, 'AD LIBITUM d.o.o.');
  assert.equal(first.location, 'Zagreb, Hrvatska');
  assert.equal(first.email, 'adlibitum@adlibitum.hr');
  assert.equal(first.phone, '098577759');
  assert.equal(first.website, 'http://www.adlibitum.hr');
  assert.equal(first.status, 'NEW');
  assert.equal(first.priority, 'HIGH');
  assert.equal(first.unit_amount, null);
  assert.equal(first.total_amount, null);
  assert.equal(first.profit_amount, null);
  assert.match(first.notes, /Miškinina ulica 2/);

  const original = JSON.parse(first.source_data_json);
  assert.equal(original['DRŽAVA'], 'Hrvatska');
  assert.equal(original.ADRESA, 'Miškinina ulica 2, 10000 Zagreb');
  assert.equal(original['FINANSIJSKI STATUS'], 'Preuzeto iz postojeće dopune');

  const statusRows = await db('crm_accounts').where({ brand_id: brand.id })
    .select('status').count({ count: '*' }).groupBy('status');
  const statuses = Object.fromEntries(statusRows.map((row) => [row.status, Number(row.count)]));
  assert.deepEqual(statuses, {
    CALL_REQUIRED: 20,
    EMAIL_SENT: 25,
    FOLLOW_UP: 42,
    INTERESTED: 3,
    NEW: 22,
    REJECTED: 44
  });

  const priorityRows = await db('crm_accounts').where({ brand_id: brand.id })
    .select('priority').count({ count: '*' }).groupBy('priority');
  const priorities = Object.fromEntries(priorityRows.map((row) => [row.priority, Number(row.count)]));
  assert.deepEqual(priorities, { HIGH: 62, LOW: 58, MEDIUM: 36 });
});

test('SAN Pest import je idempotentan, dnevna lista ima 30 i odbijeni se ne predlažu', async (t) => {
  const db = await testDb(t);
  await sanPestMigration.up(db);
  await sanPestMigration.up(db);

  const brand = await db('crm_brands').where({ code: 'SAN_PEST' }).first();
  const count = await db('crm_accounts').where({ brand_id: brand.id }).count({ count: '*' }).first();
  assert.equal(Number(count.count), 156);

  const daily = await ensureDailyAssignments(
    db,
    { id: 'san-pest-test-user', role: 'direktor' },
    brand,
    { date: '2026-08-14' }
  );
  assert.equal(daily.items.length, 30);
  assert.ok(daily.items.every((item) => item.account_status !== 'REJECTED'));

  await sanPestMigration.down(db);
  const after = await db('crm_accounts').where({ brand_id: brand.id }).count({ count: '*' }).first();
  const visiocast = await db('crm_accounts').where({ brand_id: 'brand-visiocast' }).count({ count: '*' }).first();
  assert.equal(Number(after.count), 0);
  assert.equal(Number(visiocast.count), 49);
});
