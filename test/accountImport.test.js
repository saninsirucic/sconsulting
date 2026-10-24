const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const knex = require('knex');
const crmMigration = require('../migrations/20260813120000_create_commercial_crm');
const ownershipMigration = require('../migrations/20260827170000_add_account_ownership_type');
const automationMigration = require('../migrations/20260815120000_add_commercial_mail_automation');
const importMigration = require('../migrations/20261024121000_create_crm_account_imports');
const { createAccount } = require('../commercial/service');
const { createCommercialRouter } = require('../commercial/router');
const { previewAccountImport, commitAccountImport, readWorkbook, MAX_FILE_BYTES } = require('../commercial/accountImport');

const director = { id: 'import-director', role: 'direktor', authSource: 'env' };
const headers = ['Naziv ustanove', 'E-mail', 'Telefon', 'Grad', 'Adresa', 'Kontakt osoba'];

async function fixture(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await crmMigration.up(db);
  await ownershipMigration.up(db);
  await automationMigration.up(db);
  await importMigration.up(db);
  const brand = { id: 'brand-javne-ustanove', code: 'JAVNE_USTANOVE', slug: 'javne-ustanove', name: 'Javne ustanove', active: true };
  await db('crm_brands').insert(brand);
  return { db, brand };
}

async function xlsx(rows, columns = headers, configure) {
  const workbook = new ExcelJS.Workbook();
  if (configure) configure(workbook);
  const sheet = workbook.addWorksheet('Ustanove');
  sheet.addRow(columns);
  sheet.addRows(rows);
  return { originalname: 'ustanove.xlsx', buffer: Buffer.from(await workbook.xlsx.writeBuffer()) };
}

async function startApi(t, db, user, outlookService = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = user; next(); });
  app.use('/api/commercial', createCommercialRouter({ db, outlookService }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    return res.status(error.status || 500).json({ error: error.message, code: error.code });
  });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}/api/commercial`;
}

const countAccounts = async (db, brand) => Number((await db('crm_accounts').where({ brand_id: brand.id }).count({ count: '*' }).first()).count);

test('preview recognizes Bosnian headers, skips auxiliary sheets, classifies rows and only saves a hashed token', async (t) => {
  const { db, brand } = await fixture(t);
  await createAccount(db, brand, director, { company_name: 'Postojeća ustanova', email: 'postojeca@ustanova.ba' });
  const other = await db('crm_brands').where({ code: 'VISIOCAST' }).first();
  await createAccount(db, other, director, { company_name: 'Druga baza', email: 'druga@ustanova.ba' });
  const file = await xlsx([
    ['Škola A', 'SKOLA@ustanova.ba', '+387 33 123 456', 'Sarajevo', 'Ulica 1', 'Ana'],
    [' skola a ', 'drugi@ustanova.ba', '', 'Sarajevo', 'Ulica 1'],
    ['Nova', 'postojeca@ustanova.ba'],
    ['Druga baza', 'druga@ustanova.ba'],
    ['Bez e-maila', '', '033 123 456'],
    ['Pogrešna adresa', 'not-email'],
    ['', 'bez-naziva@ustanova.ba']
  ], headers, (book) => book.addWorksheet('Upute').addRows([['Naziv', 'Email'], ['Preskoči me', 'ignore@example.com']]));
  const response = await previewAccountImport(db, brand, director, file);
  assert.equal(response.preview.worksheet_name, 'Ustanove');
  assert.equal(response.preview.total_rows, 7);
  assert.equal(response.preview.valid_rows, 4);
  assert.equal(response.preview.duplicate_rows, 1);
  assert.equal(response.preview.invalid_rows, 2);
  assert.equal(response.preview.rows[0].email, 'skola@ustanova.ba');
  assert.equal(response.preview.rows[0].row_number, 2);
  assert.equal(response.preview.rows[0].city, 'Sarajevo');
  assert.equal(response.preview.rows[0].address, 'Ulica 1');
  assert.equal(await countAccounts(db, brand), 1);
  const job = await db('crm_account_imports').first();
  assert.equal(job.token_hash, crypto.createHash('sha256').update(response.import_token).digest('hex'));
  assert.ok(!JSON.stringify(job).includes(response.import_token));
  assert.equal(new Date(job.expires_at) - new Date(job.created_at), 30 * 60 * 1000);
  assert.equal(await db('crm_mail_queue').count({ count: '*' }).first().then((row) => Number(row.count)), 0);
});

test('commit preserves CRM schema, source location and audit activity without approving or sending mail', async (t) => {
  const { db, brand } = await fixture(t);
  let sends = 0;
  const url = await startApi(t, db, director, { sendMail: () => { sends += 1; throw new Error('Must not send'); } });
  const file = await xlsx([
    ['JU Škola', 'info@skola.ba', '+387 33 123 456', 'Sarajevo', 'Ulica 1', 'Ana'],
    ['Biblioteka', '', '033 123 456'], ['Invalid', 'bad'], ['Duplikat', 'info@skola.ba']
  ]);
  const form = new FormData();
  form.append('file', new Blob([file.buffer]), file.originalname);
  const previewResponse = await fetch(`${url}/brands/JAVNE_USTANOVE/accounts/import/preview`, { method: 'POST', body: form });
  const preview = await previewResponse.json();
  assert.equal(previewResponse.status, 200, JSON.stringify(preview));
  assert.equal(await countAccounts(db, brand), 0);
  const commitResponse = await fetch(`${url}/brands/JAVNE_USTANOVE/accounts/import/commit`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ import_token: preview.import_token })
  });
  const result = await commitResponse.json();
  assert.equal(commitResponse.status, 200, JSON.stringify(result));
  assert.deepEqual({ imported: result.imported, skipped: result.skipped, errors: result.errors.length }, { imported: 3, skipped: 1, errors: 1 });
  const account = await db('crm_accounts').where({ brand_id: brand.id, company_name: 'JU Škola' }).first();
  assert.equal(account.status, 'NEW');
  assert.equal(account.ownership_type, 'PUBLIC');
  assert.equal(account.location, 'Ulica 1, Sarajevo');
  assert.equal(account.currency, 'BAM');
  assert.equal(account.created_by, director.id);
  assert.equal(JSON.parse(account.source_data_json).address, 'Ulica 1');
  assert.equal(JSON.parse(account.source_data_json).city, 'Sarajevo');
  assert.equal((await db('crm_activities').where({ brand_id: brand.id })).length, 3);
  assert.equal((await db('crm_daily_assignments').where({ brand_id: brand.id })).length, 0);
  assert.equal((await db('crm_mail_queue').where({ brand_id: brand.id })).length, 0);
  assert.equal(sends, 0);
});

test('tokens are user and brand bound; unauthorized multipart input is rejected before file parsing', async (t) => {
  const { db, brand } = await fixture(t);
  const file = await xlsx([['Ustanova', 'info@ustanova.ba']]);
  const preview = await previewAccountImport(db, brand, director, file);
  await assert.rejects(commitAccountImport(db, brand, { ...director, id: 'another-user' }, preview.import_token), { code: 'IMPORT_TOKEN_NOT_FOUND' });
  const other = await db('crm_brands').where({ code: 'VISIOCAST' }).first();
  await assert.rejects(commitAccountImport(db, other, director, preview.import_token), { code: 'IMPORT_BRAND_DENIED' });
  await assert.rejects(previewAccountImport(db, other, director, file), { code: 'IMPORT_BRAND_DENIED' });
  await assert.rejects(commitAccountImport(db, brand, director, 'guess'), { code: 'IMPORT_TOKEN_INVALID' });
  const user = { id: 'unauthorized', role: 'komercijala' };
  const url = await startApi(t, db, user);
  const response = await fetch(`${url}/brands/JAVNE_USTANOVE/accounts/import/preview`, {
    method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=broken' }, body: 'malformed upload'
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'BRAND_ACCESS_DENIED');
  assert.equal((await db('crm_account_imports')).length, 1);
  assert.equal(await countAccounts(db, brand), 0);
});

test('commit rechecks revoked access and expiration without consuming the preview', async (t) => {
  const { db, brand } = await fixture(t);
  const user = { id: 'import-user', role: 'komercijala', authSource: 'db' };
  await db('app_users').insert({ id: user.id, username: 'import-user', username_normalized: 'import-user', password_hash: 'unused', role: user.role });
  await db('app_user_brand_access').insert({ id: 'import-access', user_id: user.id, brand_id: brand.id, can_read: true, can_write: true });
  const preview = await previewAccountImport(db, brand, user, await xlsx([['Ustanova', 'info@ustanova.ba']]));
  await db('app_user_brand_access').where({ user_id: user.id }).update({ can_write: false });
  await assert.rejects(commitAccountImport(db, brand, user, preview.import_token), { code: 'BRAND_ACCESS_DENIED' });
  await db('app_user_brand_access').where({ user_id: user.id }).update({ can_write: true });
  await db('crm_account_imports').update({ expires_at: new Date(Date.now() - 1000) });
  await assert.rejects(commitAccountImport(db, brand, user, preview.import_token), { code: 'IMPORT_TOKEN_EXPIRED' });
  assert.equal((await db('crm_account_imports').first()).status, 'PREVIEW');
  assert.equal(await countAccounts(db, brand), 0);
});

test('commit checks new duplicates and concurrent token reuse is idempotent', async (t) => {
  const { db, brand } = await fixture(t);
  const preview = await previewAccountImport(db, brand, director, await xlsx([['Prva', 'prva@ustanova.ba'], ['Druga', 'druga@ustanova.ba']]));
  await createAccount(db, brand, director, { company_name: 'Prva', email: 'prva@ustanova.ba' });
  const results = await Promise.all([
    commitAccountImport(db, brand, director, preview.import_token),
    commitAccountImport(db, brand, director, preview.import_token)
  ]);
  assert.deepEqual(results[0], { imported: 1, skipped: 1, errors: [] });
  assert.deepEqual(results[1], results[0]);
  assert.equal(await countAccounts(db, brand), 2);
  assert.equal((await db('crm_activities').where({ brand_id: brand.id })).length, 2);
  assert.equal((await db('crm_account_imports').first()).payload_json, '{}');
});

test('different concurrent imports recheck the same brand and never duplicate contacts', async (t) => {
  const { db, brand } = await fixture(t);
  const file = await xlsx([['Ustanova', 'info@ustanova.ba']]);
  const one = await previewAccountImport(db, brand, director, file);
  const two = await previewAccountImport(db, brand, director, file);
  const results = await Promise.all([
    commitAccountImport(db, brand, director, one.import_token),
    commitAccountImport(db, brand, director, two.import_token)
  ]);
  assert.equal(results.reduce((sum, item) => sum + item.imported, 0), 1);
  assert.equal(results.reduce((sum, item) => sum + item.skipped, 0), 1);
  assert.equal(await countAccounts(db, brand), 1);
});

test('a failed commit rolls back contacts, activities and token claim and permits retry', async (t) => {
  const { db, brand } = await fixture(t);
  const preview = await previewAccountImport(db, brand, director, await xlsx([['Prva'], ['Druga']]));
  await db.raw("CREATE TRIGGER reject_import_activity BEFORE INSERT ON crm_activities WHEN NEW.brand_id = 'brand-javne-ustanove' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
  await assert.rejects(commitAccountImport(db, brand, director, preview.import_token), /audit unavailable/);
  assert.equal(await countAccounts(db, brand), 0);
  assert.equal((await db('crm_account_imports').first()).status, 'PREVIEW');
  await db.raw('DROP TRIGGER reject_import_activity');
  assert.equal((await commitAccountImport(db, brand, director, preview.import_token)).imported, 2);
});

test('invalid file, missing name header, row and column limits are enforced', async () => {
  await assert.rejects(readWorkbook(Buffer.from('not xlsx')), { code: 'IMPORT_FILE_INVALID' });
  await assert.rejects(readWorkbook(Buffer.alloc(MAX_FILE_BYTES + 1)), { code: 'IMPORT_FILE_TOO_LARGE' });
  await assert.rejects(readWorkbook((await xlsx([['info@ustanova.ba']], ['Email'])).buffer), { code: 'IMPORT_NAME_COLUMN_REQUIRED' });
  await assert.rejects(readWorkbook((await xlsx(Array.from({ length: 5001 }, (_, index) => [`Ustanova ${index}`]))).buffer), { code: 'IMPORT_SHEET_TOO_LARGE' });
  await assert.rejects(readWorkbook((await xlsx([['Ustanova']], ['Name', ...Array.from({ length: 100 }, (_, index) => `Other${index}`)])).buffer), { code: 'IMPORT_SHEET_TOO_LARGE' });
  const english = await readWorkbook((await xlsx([['Institution', 'contact@example.org', '+387', 'Mostar', 'Street 1', 'Ana']], ['name', 'email', 'phone', 'city', 'address', 'contact_person'])).buffer);
  assert.equal(english.rows[0].contact_person, 'Ana');
});

test('real inflation is bounded even if ZIP metadata lies about the expanded size', async () => {
  const file = await xlsx([['Ustanova', '', '', '', 'A'.repeat(120000)]]);
  const forged = Buffer.from(file.buffer);
  let patched = false;
  for (let offset = 0; offset < forged.length - 46; offset += 1) {
    if (forged.readUInt32LE(offset) !== 0x02014b50) continue;
    const nameLength = forged.readUInt16LE(offset + 28);
    const name = forged.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (name !== 'xl/sharedStrings.xml') continue;
    const localOffset = forged.readUInt32LE(offset + 42);
    forged.writeUInt32LE(16, offset + 24);
    forged.writeUInt32LE(16, localOffset + 22);
    patched = true;
    break;
  }
  assert.equal(patched, true);
  await assert.rejects(readWorkbook(forged), { code: 'IMPORT_FILE_INVALID' });
});

test('oversized hidden worksheets and ranges are rejected before ExcelJS workbook loading', async () => {
  const hiddenRows = await xlsx([['Good contact']], headers, (workbook) => {
    const hidden = workbook.addWorksheet('Hidden', { state: 'hidden' });
    hidden.getCell('A5021').value = 'too far';
  });
  const hiddenColumns = await xlsx([['Good contact']], headers, (workbook) => {
    const hidden = workbook.addWorksheet('Hidden', { state: 'hidden' });
    hidden.getCell('CW1').value = 'column101';
  });
  // Validation ranges can be huge even when a worksheet has only one populated cell.
  const hugeRange = await xlsx([['Good contact']], headers, (workbook) => {
    const hidden = workbook.addWorksheet('Hidden', { state: 'hidden' });
    hidden.getCell('A1').value = 'small';
    hidden.dataValidations.add('A1:A1048576', { type: 'whole', operator: 'greaterThan', formulae: [0] });
  });
  // These limits are enforced by preflight, before ExcelJS constructs any worksheet models.
  for (const file of [hiddenRows, hiddenColumns, hugeRange]) {
    await assert.rejects(readWorkbook(file.buffer), { code: 'IMPORT_SHEET_TOO_LARGE' });
  }
});

test('ZIP path normalization cannot hide an oversized worksheet from preflight', async () => {
  const file = await xlsx([['Good contact']], headers, (workbook) => {
    const hidden = workbook.addWorksheet('Hidden', { state: 'hidden' });
    hidden.getCell('A6000').value = 'too far';
  });
  const archive = await JSZip.loadAsync(file.buffer);
  const worksheet = await archive.file('xl/worksheets/sheet1.xml').async('nodebuffer');
  archive.remove('xl/worksheets/sheet1.xml');
  archive.file('xl/./worksheets/sheet1.xml', worksheet);
  const forged = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await assert.rejects(readWorkbook(forged), { code: 'IMPORT_FILE_INVALID' });
});

test('ZIP Unicode path overrides are rejected rather than bypassing worksheet validation', async () => {
  const file = await xlsx([['Good contact']]);
  const archive = await JSZip.loadAsync(file.buffer);
  // JSZip emits a 0x7075 path-override extra field for this non-ASCII entry.
  archive.file('drugi-šablon.xml', '<root/>');
  const forged = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await assert.rejects(readWorkbook(forged), { code: 'IMPORT_FILE_INVALID' });
});

test('multipart upload rejects files larger than 5MB without creating an import job', async (t) => {
  const { db } = await fixture(t);
  const url = await startApi(t, db, director);
  const form = new FormData();
  form.append('file', new Blob([Buffer.alloc(MAX_FILE_BYTES + 1)]), 'large.xlsx');
  const response = await fetch(`${url}/brands/JAVNE_USTANOVE/accounts/import/preview`, { method: 'POST', body: form });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).code, 'IMPORT_FILE_TOO_LARGE');
  assert.equal((await db('crm_account_imports')).length, 0);
});

test('shared institutional inboxes remain separate contacts and only the first listed email becomes To', async (t) => {
  const { db, brand } = await fixture(t);
  const raw = 'Zajednicki@ustanova.ba; druga@ustanova.ba';
  const file = await xlsx([
    ['Ustanova A', raw, '033 123', 'Sarajevo'],
    ['Ustanova B', 'zajednicki@ustanova.ba', '033 456', 'Sarajevo'],
    ['Ustanova A', 'zajednicki@ustanova.ba', '036 123', 'Mostar'],
    ['Ustanova A', 'nova@ustanova.ba', '033 123', 'Sarajevo']
  ]);
  const preview = await previewAccountImport(db, brand, director, file);
  assert.equal(preview.preview.valid_rows, 3);
  assert.equal(preview.preview.duplicate_rows, 1);
  const result = await commitAccountImport(db, brand, director, preview.import_token);
  assert.equal(result.imported, 3);
  const first = await db('crm_accounts').where({ brand_id: brand.id, company_name: 'Ustanova A', location: 'Sarajevo' }).first();
  assert.equal(first.email, 'zajednicki@ustanova.ba');
  assert.equal(first.raw_mail, raw);
  assert.equal(first.raw_contact, '033 123');
  assert.equal(first.cc_emails_json, undefined);
  assert.equal((await previewAccountImport(db, brand, director, file)).preview.valid_rows, 0);
});

test('prefixed OOXML, ISO date cells and absolute table targets preserve registry fields and hyperlinks', async (t) => {
  const { db, brand } = await fixture(t);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Registar');
  const registryHeaders = [
    'Institucija / organizaciona jedinica', 'E-mail ustanove', 'Telefon / telefoni', 'Grad / općina',
    'Kontakt / služba iz javnog izvora', 'Vrsta institucije', 'Web-stranica',
    'Obrazloženje / napomena za kontakt', 'Datum provjere', 'Javni izvor', 'Excel datum'
  ];
  const url = 'https://ustanova.example.org/dokaz?a=1&b=2';
  const literal = 'Tekst <x:workbook> & ns0:Relationship ostaje podatak.';
  sheet.addTable({ name: 'RegistarTest', ref: 'A1', headerRow: true,
    columns: registryHeaders.map((name) => ({ name })), rows: [[
      'JU Škola A', 'Prva@skola.ba; druga@skola.ba', '+387 33 123 456', 'Sarajevo', 'Uprava', 'Škola',
      { text: 'Web ustanove', hyperlink: 'https://skola.example.org/' }, literal,
      new Date('2026-10-24T00:00:00.000Z'), { text: 'Javni dokaz', hyperlink: url }, new Date('2026-10-23T00:00:00.000Z')
    ]] });
  const archive = await JSZip.loadAsync(await book.xlsx.writeBuffer());
  for (const entry of Object.values(archive.files)) {
    if (entry.dir || !/\.xml$|\.rels$/.test(entry.name) || /\/theme\//.test(entry.name)) continue;
    let xml = await entry.async('string');
    if (xml.includes('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')) {
      xml = xml.replace('xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"')
        .replace(/<(\/?)([A-Za-z][\w.-]*)(?=[\s/>])/g, '<$1x:$2');
    }
    if (entry.name === 'xl/workbook.xml') xml = xml.replace(/xmlns:r=/g, 'xmlns:relation=').replace(/r:id=/g, 'relation:id=');
    if (entry.name === 'xl/worksheets/sheet1.xml') {
      xml = xml.replace(/(<x:c\b[^>]*\br="I2"[^>]*>)([\s\S]*?)(<\/x:c>)/, (_, open, inside, close) => {
        const dateOpen = /\bt="/.test(open) ? open.replace(/\bt="[^"]*"/, 't="d"') : open.replace('>', ' t="d">');
        return dateOpen + inside.replace(/<x:v>[^<]*<\/x:v>/, '<x:v>2026-10-24T00:00:00Z</x:v>') + close;
      });
    }
    if (entry.name.endsWith('.rels')) {
      xml = xml.replace('xmlns="http://schemas.openxmlformats.org/package/2006/relationships"', 'xmlns:ns0="http://schemas.openxmlformats.org/package/2006/relationships"')
        .replace(/<(\/?)(Relationships?)(?=[\s/>])/g, '<$1ns0:$2')
        .replace('Target="../tables/table1.xml"', 'Target="/xl/tables/table1.xml"');
    }
    archive.file(entry.name, xml);
  }
  const buffer = await archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const before = crypto.createHash('sha256').update(buffer).digest('hex');
  const preview = await previewAccountImport(db, brand, director, { originalname: 'registar.xlsx', buffer });
  assert.equal(crypto.createHash('sha256').update(buffer).digest('hex'), before);
  assert.equal(preview.preview.worksheet_name, 'Registar');
  assert.equal(preview.preview.valid_rows, 1);
  assert.equal((await commitAccountImport(db, brand, director, preview.import_token)).imported, 1);
  const account = await db('crm_accounts').where({ brand_id: brand.id }).first();
  const source = JSON.parse(account.source_data_json);
  assert.equal(account.email, 'prva@skola.ba');
  assert.equal(account.raw_mail, 'Prva@skola.ba; druga@skola.ba');
  assert.equal(account.raw_contact, 'Uprava\n+387 33 123 456');
  assert.equal(account.record_type, 'Škola');
  assert.equal(account.website, 'https://skola.example.org/');
  assert.equal(account.notes, literal);
  assert.equal(source['9: Datum provjere'], '2026-10-24T00:00:00Z');
  assert.equal(source['11: Excel datum'], '2026-10-23T00:00:00.000Z');
  assert.equal(source['10: Javni izvor (URL)'], url);
  assert.equal(source['7: Web-stranica'], 'Web ustanove');
  assert.equal(source['8: Obrazloženje / napomena za kontakt'], literal);
  assert.ok(account.comment.includes(url));
  assert.ok(account.comment.includes('9: Datum provjere: 2026-10-24T00:00:00Z'));
  assert.ok(account.comment.includes(literal));
});

test('source comments over 20000 characters are rejected instead of truncated', async (t) => {
  const { db, brand } = await fixture(t);
  const file = await xlsx([['Ustanova', 'x'.repeat(20000)]], ['Naziv', 'Izvorna napomena']);
  const preview = await previewAccountImport(db, brand, director, file);
  assert.equal(preview.preview.valid_rows, 0);
  assert.equal(preview.preview.invalid_rows, 1);
  assert.match(preview.preview.rows[0].error, /20000/);
});

test('reimport identity uses the normalized stored location for long source addresses', async (t) => {
  const { db, brand } = await fixture(t);
  const address = 'a'.repeat(300);
  const file = await xlsx([['Ustanova', '', '', 'Sarajevo', address]]);
  const preview = await previewAccountImport(db, brand, director, file);
  assert.equal((await commitAccountImport(db, brand, director, preview.import_token)).imported, 1);
  const again = await previewAccountImport(db, brand, director, file);
  assert.equal(again.preview.duplicate_rows, 1);
  const account = await db('crm_accounts').where({ brand_id: brand.id }).first();
  assert.equal(account.location.length, 250);
  assert.equal(JSON.parse(account.source_data_json).address, address);
  assert.ok(account.comment.includes(address));
});
