const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');
const migration = require('../migrations/20260813120000_create_commercial_crm');
const ownership = require('../migrations/20260827170000_add_account_ownership_type');
const { listAccounts } = require('../commercial/service');

async function fixture(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await migration.up(db);
  await ownership.up(db);
  return { db, brand: { id: 'brand-san-pest' } };
}

test('pregledi rokova obuhvataju cijelu bazu, poštuju granice dana i isključuju zatvorene kontakte', async (t) => {
  const { db, brand } = await fixture(t);
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-28T09:00:00Z') });
  const rows = [
    ['late', '2026-10-27T22:59:59Z'],
    ['today-start', '2026-10-27T23:00:00Z'],
    ['today-end', '2026-10-28T22:59:59Z'],
    ['tomorrow', '2026-10-28T23:00:00Z'],
    ['week-end', '2026-11-04T22:59:59Z'],
    ['later', '2026-11-04T23:00:00Z'],
    ['unscheduled', null],
    ['closed', '2026-10-26T10:00:00Z', 'WON'],
    ['rejected', null, 'REJECTED'],
  ].map(([id, date, status]) => ({ id, brand_id: brand.id, source_key: id, company_name: id, source_data_json: '{}', status: status || 'FOLLOW_UP', next_contact_at: date ? new Date(date) : null }));
  await db('crm_accounts').insert(rows);
  await db('crm_accounts').insert({ ...rows[0], id: 'archived', source_key: 'archived', archived_at: new Date() });
  for (const [view, ids] of Object.entries({ overdue: ['late'], today: ['today-start', 'today-end'], upcoming: ['tomorrow', 'week-end'], unscheduled: ['unscheduled'] })) {
    const result = await listAccounts(db, brand, { contactView: view, sortBy: 'next_contact_at' });
    assert.deepEqual(result.items.map(item => item.id), ids);
    assert.deepEqual(result.contacts, { total: 9, overdue: 1, today: 2, upcoming: 2, unscheduled: 1 });
  }
  const page = await listAccounts(db, brand, { contactView: 'today', perPage: 1, page: 2, sortBy: 'next_contact_at' });
  assert.equal(page.pagination.total, 2);
  assert.equal(page.items[0].id, 'today-end');
  const searched = await listAccounts(db, brand, { contactView: 'today', search: 'start' });
  assert.equal(searched.items.length, 1);
  assert.equal(searched.contacts.today, 2);
  await assert.rejects(listAccounts(db, brand, { contactView: 'invalid' }), { status: 400 });
});

test('dan prelaska na zimsko računanje vremena uključuje svih 25 sati', async (t) => {
  const { db, brand } = await fixture(t);
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-25T10:00:00Z') });
  await db('crm_accounts').insert([
    ['before', '2026-10-24T21:59:59Z'],
    ['start', '2026-10-24T22:00:00Z'],
    ['end', '2026-10-25T22:59:59Z'],
    ['after', '2026-10-25T23:00:00Z'],
  ].map(([id, date]) => ({ id, brand_id: brand.id, source_key: id, company_name: id, source_data_json: '{}', next_contact_at: new Date(date) })));
  const result = await listAccounts(db, brand, { contactView: 'today', sortBy: 'next_contact_at' });
  assert.deepEqual(result.items.map(item => item.id), ['start', 'end']);
});
