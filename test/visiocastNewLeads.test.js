const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');
const baseMigration = require('../migrations/20260813120000_create_commercial_crm');
const adminCallMigration = require('../migrations/20260823130000_add_admin_call_request');
const newLeadsMigration = require('../migrations/20260827140000_import_visiocast_new_leads');

async function testDb(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await baseMigration.up(db);
  await adminCallMigration.up(db);
  return db;
}

test('uvozi 68 novih VisioCast komitenata sa kontaktima, TOP prioritetom i admin pozivom', async (t) => {
  const db = await testDb(t);
  await newLeadsMigration.up(db);

  const allCount = await db('crm_accounts').where({ brand_id: 'brand-visiocast' }).count({ count: '*' }).first();
  const batch = await db('crm_accounts')
    .where({ brand_id: 'brand-visiocast' })
    .where('source_key', 'like', `${newLeadsMigration.SOURCE_PREFIX}%`)
    .orderBy('source_row_number');
  const first = batch[0];
  const last = batch[batch.length - 1];

  assert.equal(Number(allCount.count), 117);
  assert.equal(batch.length, 68);
  assert.equal(first.company_name, 'Bingo d.o.o. Tuzla');
  assert.equal(first.source_row_number, 1001);
  assert.equal(first.record_type, 'Supermarket / hipermarket');
  assert.equal(first.location, 'Cijela BiH / mreža poslovnica, Bosna i Hercegovina');
  assert.equal(first.email, 'info@bingotuzla.ba');
  assert.equal(first.website, 'https://www.bingotuzla.ba/');
  assert.equal(first.status, 'NEW');
  assert.equal(first.priority, 'HIGH');
  assert.ok(first.admin_call_requested_at);
  assert.equal(first.admin_call_requested_by, null);
  assert.match(first.notes, /Admin rekao zvati: DA/);
  assert.match(first.notes, /Datum provjere: 2026-08-26/);
  assert.equal(JSON.parse(first.source_data_json)['Kvalitet kontakta'], 'Službeni kontakt centrale');

  assert.equal(last.company_name, 'Inter Cars Srbija');
  assert.equal(last.source_row_number, 1068);
  assert.equal(batch.filter((row) => row.priority === 'HIGH').length, 68);
  assert.equal(batch.filter((row) => row.status === 'NEW').length, 68);
  assert.equal(batch.filter((row) => row.admin_call_requested_at).length, 68);

  await newLeadsMigration.up(db);
  const afterRepeat = await db('crm_accounts').where({ brand_id: 'brand-visiocast' }).count({ count: '*' }).first();
  assert.equal(Number(afterRepeat.count), 117);
});

test('rollback uklanja samo paket od 68 novih VisioCast komitenata', async (t) => {
  const db = await testDb(t);
  await newLeadsMigration.up(db);
  await newLeadsMigration.down(db);

  const remaining = await db('crm_accounts').where({ brand_id: 'brand-visiocast' }).count({ count: '*' }).first();
  const legacy = await db('crm_accounts').where({ source_key: 'VISIOCAST:1' }).first();
  assert.equal(Number(remaining.count), 49);
  assert.equal(legacy.company_name, 'GAZPROM');
});
