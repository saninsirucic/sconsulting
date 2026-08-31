const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');
const classifications = require('../data/fsAppOwnership20260827.json');
const baseMigration = require('../migrations/20260813120000_create_commercial_crm');
const fsAppMigration = require('../migrations/20260817100000_import_fs_app_accounts');
const adminCallMigration = require('../migrations/20260823130000_add_admin_call_request');
const newLeadsMigration = require('../migrations/20260827160000_import_fs_app_new_leads');
const ownershipTypeMigration = require('../migrations/20260827170000_add_account_ownership_type');
const ownershipDataMigration = require('../migrations/20260827171000_classify_fs_app_ownership');

async function baseDb(t, { productionTransfers = false } = {}) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await baseMigration.up(db);
  await fsAppMigration.up(db);
  await adminCallMigration.up(db);
  if (productionTransfers) {
    await db('crm_accounts').where({ source_key: 'FS_APP:1', brand_id: 'brand-fs-app' })
      .update({ brand_id: 'brand-visiocast' });
    await db('crm_accounts').where({ source_key: 'VISIOCAST:9', brand_id: 'brand-visiocast' })
      .update({ brand_id: 'brand-fs-app' });
  }
  await newLeadsMigration.up(db);
  await ownershipTypeMigration.up(db);
  return db;
}

async function ownershipCounts(db) {
  const rows = await db('crm_accounts')
    .where({ brand_id: 'brand-fs-app' })
    .select('ownership_type')
    .count({ count: '*' })
    .groupBy('ownership_type');
  return Object.fromEntries(rows.map((row) => [row.ownership_type, Number(row.count)]));
}

test('audit paket pojedinačno pokriva svih 814 produkcijskih FS App komitenata', async (t) => {
  const db = await baseDb(t, { productionTransfers: true });
  const before = await db('crm_accounts').where({ brand_id: 'brand-fs-app' }).count({ count: '*' }).first();
  assert.equal(Number(before.count), 814);
  assert.deepEqual(ownershipDataMigration.validateClassifications(), {
    PRIVATE: 706, PUBLIC: 107, MIXED: 1, UNKNOWN: 0
  });

  await ownershipDataMigration.up(db);

  assert.deepEqual(await ownershipCounts(db), { MIXED: 1, PRIVATE: 706, PUBLIC: 107 });
  const rows = await db('crm_accounts')
    .where({ brand_id: 'brand-fs-app' })
    .select('source_key', 'company_name', 'ownership_type', 'ownership_confidence',
      'ownership_verified_at', 'ownership_source_url', 'ownership_evidence_json');
  const bySourceKey = new Map(rows.map((row) => [row.source_key, row]));
  assert.equal(bySourceKey.size, 814);

  for (const classification of classifications) {
    const row = bySourceKey.get(classification.sourceKey);
    assert.ok(row, `Nedostaje produkcijski FS App zapis ${classification.sourceKey}`);
    assert.equal(row.company_name, classification.companyName);
    assert.equal(row.ownership_type, classification.ownership);
    assert.equal(row.ownership_confidence, classification.confidence);
    assert.ok(row.ownership_verified_at);
    assert.equal(row.ownership_source_url, classification.evidenceUrl);
    const evidence = JSON.parse(row.ownership_evidence_json);
    assert.equal(evidence.checkedAt, '2026-08-27');
    assert.equal(evidence.rationale, classification.rationale);
  }

  const zenit = bySourceKey.get('FS_APP:195');
  const angelusi = bySourceKey.get('FS_APP:361');
  const grude = bySourceKey.get('FS_APP:409');
  assert.deepEqual([zenit, angelusi, grude].map((row) => row.ownership_type), [
    'PRIVATE', 'PRIVATE', 'PRIVATE'
  ]);
  assert.match(zenit.ownership_source_url, /bizreg\.pravosudje\.ba/);

  await ownershipDataMigration.up(db);
  assert.deepEqual(await ownershipCounts(db), { MIXED: 1, PRIVATE: 706, PUBLIC: 107 });
});

test('audit migracija pokriva i čistu bazu prije produkcijskih transfera', async (t) => {
  const db = await baseDb(t);
  await ownershipDataMigration.up(db);

  assert.deepEqual(await ownershipCounts(db), { MIXED: 1, PRIVATE: 705, PUBLIC: 107 });
  const legacyAmko = await db('crm_accounts')
    .where({ brand_id: 'brand-fs-app', source_key: 'FS_APP:1' })
    .first();
  assert.equal(legacyAmko.company_name, 'AMKO Komerc');
  assert.equal(legacyAmko.ownership_type, 'PRIVATE');
  assert.match(legacyAmko.ownership_source_url, /amko\.ba/);

  await ownershipDataMigration.down(db);
  assert.deepEqual(await ownershipCounts(db), { UNKNOWN: 813 });
  const reset = await db('crm_accounts')
    .where({ brand_id: 'brand-fs-app', source_key: 'FS_APP:1' })
    .first();
  assert.equal(reset.ownership_confidence, null);
  assert.equal(reset.ownership_source_url, null);
  assert.equal(reset.ownership_evidence_json, null);
});
