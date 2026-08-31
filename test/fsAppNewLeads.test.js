const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');
const baseMigration = require('../migrations/20260813120000_create_commercial_crm');
const fsAppMigration = require('../migrations/20260817100000_import_fs_app_accounts');
const adminCallMigration = require('../migrations/20260823130000_add_admin_call_request');
const newLeadsMigration = require('../migrations/20260827160000_import_fs_app_new_leads');

async function testDb(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await baseMigration.up(db);
  await fsAppMigration.up(db);
  await adminCallMigration.up(db);
  return db;
}

function sourceCountry(row) {
  return JSON.parse(row.source_data_json).Država;
}

test('uvozi 130 novih FS App komitenata, preskače AMKO duplikat i označava admin poziv', async (t) => {
  const db = await testDb(t);
  await newLeadsMigration.up(db);

  const allCount = await db('crm_accounts').where({ brand_id: 'brand-fs-app' }).count({ count: '*' }).first();
  const batch = await db('crm_accounts')
    .where({ brand_id: 'brand-fs-app' })
    .where('source_key', 'like', `${newLeadsMigration.SOURCE_PREFIX}%`)
    .orderBy('source_row_number');
  const first = batch[0];
  const last = batch[batch.length - 1];

  assert.equal(Number(allCount.count), 813);
  assert.equal(batch.length, 130);
  assert.equal(first.company_name, 'AS Holding d.o.o.');
  assert.equal(first.source_row_number, 2001);
  assert.equal(first.record_type, 'PREHRAMBENA GRUPACIJA');
  assert.equal(first.location, 'Jelah / Sarajevo, Bosna i Hercegovina');
  assert.equal(first.email, 'klasdd@klas.ba');
  assert.equal(first.website, 'https://www.asholding.ba/');
  assert.equal(first.status, 'NEW');
  assert.equal(first.priority, 'HIGH');
  assert.ok(first.admin_call_requested_at);
  assert.equal(first.admin_call_requested_by, null);
  assert.match(first.notes, /Svi javni e-mailovi: klasdd@klas\.ba; vispak@vispak\.ba; sprind@sprind\.ba/);
  assert.equal(JSON.parse(first.source_data_json).__SOURCE_ROW, 2);

  assert.equal(last.company_name, 'Voda Vrnjci a.d.');
  assert.equal(last.source_row_number, 2131);
  assert.equal(batch.filter((row) => row.priority === 'HIGH').length, 130);
  assert.equal(batch.filter((row) => row.status === 'NEW').length, 130);
  assert.equal(batch.filter((row) => row.admin_call_requested_at).length, 130);
  assert.equal(batch.filter((row) => sourceCountry(row) === 'Bosna i Hercegovina').length, 6);
  assert.equal(batch.filter((row) => sourceCountry(row) === 'Hrvatska').length, 61);
  assert.equal(batch.filter((row) => sourceCountry(row) === 'Srbija').length, 63);
  assert.equal(batch.some((row) => row.company_name === 'Amko Komerc d.o.o.'), false);

  const originalAmko = await db('crm_accounts').where({ brand_id: 'brand-fs-app', source_key: 'FS_APP:1' }).first();
  assert.equal(originalAmko.company_name, 'AMKO Komerc');

  await newLeadsMigration.up(db);
  const afterRepeat = await db('crm_accounts').where({ brand_id: 'brand-fs-app' }).count({ count: '*' }).first();
  assert.equal(Number(afterRepeat.count), 813);
});

test('rollback uklanja samo paket novih FS App komitenata', async (t) => {
  const db = await testDb(t);
  await newLeadsMigration.up(db);
  await newLeadsMigration.down(db);

  const remaining = await db('crm_accounts').where({ brand_id: 'brand-fs-app' }).count({ count: '*' }).first();
  const originalAmko = await db('crm_accounts').where({ source_key: 'FS_APP:1' }).first();
  assert.equal(Number(remaining.count), 683);
  assert.equal(originalAmko.company_name, 'AMKO Komerc');
});

test('normalizacija FS App naziva i tržišta prepoznaje samo stvarne duplikate', () => {
  assert.equal(newLeadsMigration.normalizeCompany('Amko Komerc d.o.o.'), 'amko komerc');
  assert.equal(newLeadsMigration.normalizeCompany('AMKO Komerc'), 'amko komerc');
  assert.equal(newLeadsMigration.normalizeCountry('Bosna i Hercegovina'), 'BA');
  assert.equal(newLeadsMigration.normalizeCountry('BiH | Sarajevo'), 'BA');
  assert.equal(newLeadsMigration.normalizeCountry('Hrvatska'), 'HR');
  assert.equal(newLeadsMigration.normalizeCountry('Srbija'), 'RS');
});
