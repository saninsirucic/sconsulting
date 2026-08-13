const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const knex = require('knex');
const migration = require('../migrations/20260813120000_create_commercial_crm');
const tokenVersionMigration = require('../migrations/20260813130000_add_app_user_token_version');
const {
  allowRoles,
  authenticateCredentials,
  changePassword,
  createAccessToken,
  authenticateRequest,
  refreshAuthenticatedUser,
  requirePasswordChangeCompleted
} = require('../aiEmail/auth');
const {
  accountWithBrand,
  archiveAccount,
  createAccount,
  dashboard,
  ensureDailyAssignments,
  listAccessibleBrands,
  listAccounts,
  listActivities,
  readDailyAssignments,
  resolveBrand,
  updateAccount
} = require('../commercial/service');
const { manageUser } = require('../scripts/manageUser');

async function testDb(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await migration.up(db);
  await tokenVersionMigration.up(db);
  return db;
}

async function insertUser(db, overrides = {}) {
  const username = overrides.username || `user-${Math.random().toString(16).slice(2)}`;
  const password = overrides.password || 'Privremena9!';
  const user = {
    id: overrides.id || `id-${username}`,
    username,
    username_normalized: username.toLowerCase(),
    password_hash: await bcrypt.hash(password, 4),
    display_name: overrides.display_name || username,
    email: overrides.email || null,
    role: overrides.role || 'komercijala',
    active: overrides.active ?? true,
    must_change_password: overrides.must_change_password ?? true,
    created_at: new Date(),
    updated_at: new Date()
  };
  await db('app_users').insert(user);
  return { ...user, password };
}

async function grantBrand(db, userId, brandCode) {
  const brand = await db('crm_brands').where({ code: brandCode }).first();
  await db('app_user_brand_access').insert({
    id: `access-${userId}-${brandCode}`,
    user_id: userId,
    brand_id: brand.id,
    can_read: true,
    can_write: true,
    created_at: new Date(),
    updated_at: new Date()
  });
  return brand;
}

test('CRM migracija idempotentno definiše 3 brenda i svih 49 Visiocast redova sa tačnim iznosima', async (t) => {
  const db = await testDb(t);
  const brands = await db('crm_brands').orderBy('code');
  const count = await db('crm_accounts').where({ brand_id: 'brand-visiocast' }).count({ count: '*' }).first();
  const sums = await db('crm_accounts').where({ brand_id: 'brand-visiocast' })
    .sum({ total: 'total_amount', profit: 'profit_amount' }).first();
  const first = await db('crm_accounts').where({ source_key: 'VISIOCAST:1' }).first();
  const unicode = await db('crm_accounts').where({ source_key: 'VISIOCAST:22' }).first();

  assert.deepEqual(brands.map((brand) => [brand.code, Number(brand.daily_limit)]), [
    ['FS_APP', 30], ['SAN_PEST', 30], ['VISIOCAST', 30]
  ]);
  assert.equal(Number(count.count), 49);
  assert.equal(Number(sums.total), 88562);
  assert.equal(Number(sums.profit), 65800);
  assert.equal(first.source_row_number, 1);
  assert.equal(first.status, 'REJECTED');
  assert.equal(unicode.company_name, 'ČAVKUNOVIĆ-BP 4');
  assert.equal(unicode.email, 'info@cavkunovic.ba');
  assert.match(unicode.phone, /387/);
  assert.equal(JSON.parse(unicode.source_data_json)['N/R'], 22);

  const before = Number(count.count);
  const duplicateRows = [{ ...first, id: 'should-not-insert' }];
  await db('crm_accounts').insert(duplicateRows).onConflict(['brand_id', 'source_key']).ignore();
  const after = await db('crm_accounts').count({ count: '*' }).first();
  assert.equal(Number(after.count), before);
});

test('DB autentikacija, JWT mustChangePassword i promjena lozinke rade uz bcrypt', async (t) => {
  const db = await testDb(t);
  const inserted = await insertUser(db, { id: 'commercial-auth', username: 'prodaja' });
  const previousRounds = process.env.BCRYPT_ROUNDS;
  process.env.BCRYPT_ROUNDS = '4';
  t.after(() => {
    if (previousRounds === undefined) delete process.env.BCRYPT_ROUNDS;
    else process.env.BCRYPT_ROUNDS = previousRounds;
  });

  const authenticated = await authenticateCredentials(db, inserted.username, inserted.password);
  assert.equal(authenticated.id, inserted.id);
  assert.equal(authenticated.role, 'komercijala');
  assert.equal(authenticated.mustChangePassword, true);
  assert.equal(authenticated.authSource, 'db');

  const token = createAccessToken(authenticated);
  const req = { get: () => `Bearer ${token}` };
  let nextCalled = false;
  authenticateRequest(req, {
    status() { return this; },
    json() { assert.fail('Validan JWT ne smije biti odbijen'); }
  }, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.user.mustChangePassword, true);
  assert.equal(req.user.tokenVersion, 0);

  const changed = await changePassword(db, authenticated, inserted.password, 'NovaSigurna10!');
  assert.equal(changed.mustChangePassword, false);
  assert.equal(changed.tokenVersion, 1);
  assert.equal(await authenticateCredentials(db, inserted.username, inserted.password), null);
  assert.equal((await authenticateCredentials(db, inserted.username, 'NovaSigurna10!')).mustChangePassword, false);

  const oldTokenReq = { get: () => `Bearer ${token}` };
  authenticateRequest(oldTokenReq, {
    status() { return this; },
    json() { assert.fail('Potpis starog tokena je validan prije DB provjere verzije'); }
  }, () => {});
  const revokedResponse = {
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  let revokedNext = false;
  await refreshAuthenticatedUser(db)(oldTokenReq, revokedResponse, () => { revokedNext = true; });
  assert.equal(revokedNext, false);
  assert.equal(revokedResponse.statusCode, 401);
  assert.equal(revokedResponse.payload.code, 'TOKEN_REVOKED');

  const newTokenReq = { get: () => `Bearer ${createAccessToken(changed)}` };
  authenticateRequest(newTokenReq, {
    status() { return this; },
    json() { assert.fail('Novi token mora imati validan potpis'); }
  }, () => {});
  let newTokenNext = false;
  await refreshAuthenticatedUser(db)(newTokenReq, {
    status() { return this; },
    json() { assert.fail('Novi token mora proći DB provjeru verzije'); }
  }, () => { newTokenNext = true; });
  assert.equal(newTokenNext, true);
  assert.equal(newTokenReq.user.tokenVersion, 1);
});

test('forced-password gate blokira poslovni API, a direktor-only legacy middleware vraća 403 komercijalisti', () => {
  const response = () => ({
    statusCode: null,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  });
  const passwordResponse = response();
  let passwordNext = false;
  requirePasswordChangeCompleted(
    { user: { role: 'komercijala', mustChangePassword: true } },
    passwordResponse,
    () => { passwordNext = true; }
  );
  assert.equal(passwordNext, false);
  assert.equal(passwordResponse.statusCode, 403);
  assert.equal(passwordResponse.payload.code, 'PASSWORD_CHANGE_REQUIRED');

  const legacyResponse = response();
  let commercialNext = false;
  allowRoles('direktor')(
    { user: { role: 'komercijala' } },
    legacyResponse,
    () => { commercialNext = true; }
  );
  assert.equal(commercialNext, false);
  assert.equal(legacyResponse.statusCode, 403);

  let directorNext = false;
  allowRoles('direktor')(
    { user: { role: 'direktor' } },
    response(),
    () => { directorNext = true; }
  );
  assert.equal(directorNext, true);
});

test('komercijalista vidi samo dodijeljene brendove, direktor sva tri', async (t) => {
  const db = await testDb(t);
  const inserted = await insertUser(db, { id: 'limited-user', username: 'limited' });
  await grantBrand(db, inserted.id, 'VISIOCAST');
  const commercial = { id: inserted.id, role: 'komercijala', authSource: 'db' };
  const director = { id: 'env-director', role: 'direktor', authSource: 'env' };

  assert.deepEqual((await listAccessibleBrands(db, commercial)).map((brand) => brand.code), ['VISIOCAST']);
  assert.equal((await listAccessibleBrands(db, director)).length, 3);
  assert.equal((await resolveBrand(db, commercial, 'visiocast')).code, 'VISIOCAST');
  await assert.rejects(
    resolveBrand(db, commercial, 'san-pest'),
    (error) => error.status === 403 && error.code === 'BRAND_ACCESS_DENIED'
  );
});

test('CRM CRUD čuva audit aktivnosti, podržava filtere i radi soft delete', async (t) => {
  const db = await testDb(t);
  const user = { id: 'env-director', role: 'direktor', authSource: 'env' };
  const brand = await resolveBrand(db, user, 'fs-app');
  const created = await createAccount(db, brand, user, {
    company_name: 'Digitalni HACCP test',
    email: 'kontakt@example.ba',
    branch_count: 4,
    unit_amount: 100,
    total_amount: 400,
    profit_amount: 250,
    priority: 'HIGH',
    status: 'NEW',
    notes: 'Prvi unos'
  });
  assert.equal(created.priority, 'HIGH');
  assert.equal(created.total_amount, 400);

  const updated = await updateAccount(db, await accountWithBrand(db, created.id), user, {
    company_name: created.company_name,
    status: 'INTERESTED',
    next_contact_at: '2026-08-20T08:00:00.000Z',
    activity_note: 'Traži ponudu'
  });
  assert.equal(updated.status, 'INTERESTED');
  assert.equal((await listActivities(db, created.id)).length, 2);

  const filtered = await listAccounts(db, brand, { search: 'HACCP', priority: 'HIGH' });
  assert.equal(filtered.pagination.total, 1);
  assert.equal(filtered.items[0].id, created.id);
  assert.equal((await dashboard(db, brand, user)).totals.total_amount, 400);

  await archiveAccount(db, await accountWithBrand(db, created.id), user);
  assert.equal((await listAccounts(db, brand, {})).pagination.total, 0);
  const archived = await listAccounts(db, brand, { archived: 'true' });
  assert.equal(archived.pagination.total, 1);
  assert.ok(archived.items[0].archived_at);
});

test('dnevna lista je read-only na GET, POST rotacija je idempotentna i ne ponavlja dok ima neviđenih', async (t) => {
  const db = await testDb(t);
  const user = { id: 'env-director', role: 'direktor', authSource: 'env' };
  const brand = await resolveBrand(db, user, 'VISIOCAST');

  const empty = await readDailyAssignments(db, user, brand, '2026-08-13');
  assert.equal(empty.items.length, 0);
  assert.equal(Number((await db('crm_daily_assignments').count({ count: '*' }).first()).count), 0);

  const dayOne = await ensureDailyAssignments(db, user, brand, { date: '2026-08-13' });
  const dayOneAgain = await ensureDailyAssignments(db, user, brand, { date: '2026-08-13' });
  assert.equal(dayOne.items.length, 30);
  assert.deepEqual(dayOneAgain.items.map((item) => item.id), dayOne.items.map((item) => item.id));
  assert.equal(dayOne.items.some((item) => ['REJECTED', 'WON'].includes(item.account.status)), false);

  const dayOneAccounts = new Set(dayOne.items.map((item) => item.account.id));
  const dayTwo = await ensureDailyAssignments(db, user, brand, { date: '2026-08-14' });
  const unseenOnDayTwo = dayTwo.items.filter((item) => !dayOneAccounts.has(item.account.id));
  // Workbook contains 3 rejected rows, so 46 are eligible for rotation.
  assert.equal(unseenOnDayTwo.length, 16);
  assert.equal(new Set([...dayOneAccounts, ...dayTwo.items.map((item) => item.account.id)]).size, 46);
  assert.deepEqual(unseenOnDayTwo.map((item) => item.account.nr),
    [...unseenOnDayTwo.map((item) => item.account.nr)].sort((a, b) => a - b));
});

test('manage-user kreira komercijalistu sa pristupom sva tri brenda i prisilnom promjenom lozinke', async (t) => {
  const db = await testDb(t);
  const previousRounds = process.env.BCRYPT_ROUNDS;
  process.env.BCRYPT_ROUNDS = '4';
  t.after(() => {
    if (previousRounds === undefined) delete process.env.BCRYPT_ROUNDS;
    else process.env.BCRYPT_ROUNDS = previousRounds;
  });
  const messages = [];
  const result = await manageUser({
    db,
    args: { username: 'novi-komercijalista', displayName: 'Novi Komercijalista', generatePassword: true },
    output: (message) => messages.push(message)
  });
  const user = await db('app_users').where({ id: result.id }).first();
  const accessCount = await db('app_user_brand_access').where({ user_id: result.id }).count({ count: '*' }).first();
  assert.equal(user.role, 'komercijala');
  assert.equal(Boolean(user.must_change_password), true);
  assert.equal(Number(accessCount.count), 3);
  assert.equal(user.token_version, 0);
  assert.ok(result.generatedPassword);
  assert.equal((await authenticateCredentials(db, user.username, result.generatedPassword)).id, result.id);
  assert.match(messages.join('\n'), /prikazuje se samo sada/i);

  const originalToken = createAccessToken(await authenticateCredentials(db, user.username, result.generatedPassword));
  await manageUser({
    db,
    args: { username: user.username, password: 'AdminReset11!' },
    output: () => {}
  });
  const resetUser = await db('app_users').where({ id: result.id }).first();
  assert.equal(resetUser.token_version, 1);
  const oldReq = { get: () => `Bearer ${originalToken}` };
  authenticateRequest(oldReq, { status() { return this; }, json() {} }, () => {});
  const revoked = { statusCode: null, payload: null, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; } };
  await refreshAuthenticatedUser(db)(oldReq, revoked, () => assert.fail('Admin reset mora opozvati prethodni token'));
  assert.equal(revoked.statusCode, 401);
  assert.equal(revoked.payload.code, 'TOKEN_REVOKED');
});
