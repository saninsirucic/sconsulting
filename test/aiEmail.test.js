const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');
const ExcelJS = require('exceljs');
const migration = require('../migrations/20260716150000_create_ai_email_module');
const { authenticateRequest } = require('../aiEmail/auth');
const {
  buildContactFromRow,
  isValidEmail,
  normalizeCompanyName,
  suggestMapping
} = require('../aiEmail/contactUtils');
const { analyzeExcel } = require('../aiEmail/excelService');
const { importContacts } = require('../aiEmail/importService');

async function workbookFile(rows, sheetName = 'Privatne firme') {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet(sheetName).addRows(rows);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, originalname: 'test-kontakti.xlsx', size: buffer.length };
}

function mapping() {
  return { company_name: 0, email: 1, country: 2, priority: 3, status: 4 };
}

test('Excel analiza pronalazi fizički red zaglavlja, preview i pomoćni sheet', async () => {
  const workbook = new ExcelJS.Workbook();
  const primarySheet = workbook.addWorksheet('Privatne firme');
  primarySheet.addRows([
    ['DDD registar'],
    [],
    ['Naziv firme', 'Kontakt mail / web / fax', 'Država', 'Prioritet za kontakt app-a'],
    ['Alfa d.o.o.', 'prodaja@alfa.ba / https://alfa.ba', 'BiH', 'Visok']
  ]);
  primarySheet.mergeCells('A1:D1');
  workbook.addWorksheet('Sažetak').addRows([
    ['Sažetak'],
    ['Država', 'Broj'],
    ['BiH', 1]
  ]);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const result = await analyzeExcel({ buffer, originalname: 'registar.xlsx', size: buffer.length });

  assert.equal(result.sheets[0].detectedHeaderRow, 3);
  assert.equal(result.sheets[0].preview.length, 1);
  assert.equal(result.sheets[0].suggestedMapping.company_name, 0);
  assert.equal(result.sheets[0].suggestedMapping.email, 1);
  assert.equal(result.sheets[1].auxiliary, true);
});

test('mapiranje zaglavlja nije vezano za slova kolona', () => {
  const headers = [
    { index: 7, label: 'Kontakt broj' },
    { index: 2, label: 'Naziv firme' },
    { index: 11, label: 'Komentar sa seminara 2023' }
  ];
  assert.deepEqual(suggestMapping(headers), {
    company_name: 2,
    phone: 7,
    previous_communication: 11
  });
});

test('validacija i ekstrakcija kontakta prihvata e-mail iz mješovite ćelije', () => {
  assert.equal(isValidEmail('prodaja@firma.ba'), true);
  assert.equal(isValidEmail('firma.example.com'), false);
  const { contact, errors } = buildContactFromRow(
    ['Firma d.o.o.', 'info@firma.ba; https://firma.ba', 'Sarajevo 71 000'],
    { company_name: 0, email: 1, website: 1, city: 2, postal_code: 2 },
    'Test'
  );
  assert.equal(errors.length, 0);
  assert.equal(contact.email, 'info@firma.ba');
  assert.equal(contact.website, 'https://firma.ba');
  assert.equal(contact.city, 'Sarajevo');
  assert.equal(contact.postal_code, '71000');
  assert.equal(normalizeCompanyName('„Firma“ d.o.o.'), 'firma');
  const emailOnly = buildContactFromRow(
    ['Firma', 'info@firma.ba'],
    { company_name: 0, email: 1, website: 1 },
    'Test'
  );
  assert.equal(emailOnly.contact.website, null);
});

test('import preskače duplikate i neispravne redove te pamti mapiranje', async (t) => {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await migration.up(db);
  const file = await workbookFile([
    ['Naziv firme', 'Email', 'Država', 'Prioritet', 'Status'],
    ['Alfa d.o.o.', 'info@alfa.ba', 'BiH', 'Visok', 'Novi'],
    ['Alfa duplikat', 'INFO@ALFA.BA', 'BiH', 'Nizak', 'Novi'],
    ['Bez maila', '', 'BiH', 'Nizak', 'Novi']
  ]);

  const report = await importContacts({
    db, file, user: { id: 'test-user' }, sheetName: 'Privatne firme', headerRow: 1,
    mapping: mapping(), duplicateStrategy: 'skip', mappingName: 'Test mapiranje'
  });
  assert.equal(report.imported, 1);
  assert.equal(report.duplicates, 1);
  assert.equal(report.skipped, 1);
  assert.equal(report.invalid, 1);
  assert.equal(await db('email_contacts').count({ count: '*' }).first().then((row) => Number(row.count)), 1);
  assert.equal(await db('email_import_mappings').count({ count: '*' }).first().then((row) => Number(row.count)), 1);
});

test('update strategija ažurira postojeći kontakt bez kreiranja duplikata', async (t) => {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await migration.up(db);
  const user = { id: 'test-user' };
  await importContacts({
    db,
    file: await workbookFile([['Naziv firme', 'Email', 'Država', 'Prioritet', 'Status'], ['Alfa', 'info@alfa.ba', 'BiH', 'Nizak', 'Novi']]),
    user, sheetName: 'Privatne firme', headerRow: 1, mapping: mapping(), duplicateStrategy: 'skip'
  });
  const report = await importContacts({
    db,
    file: await workbookFile([['Naziv firme', 'Email', 'Država', 'Prioritet', 'Status'], ['Alfa', 'info@alfa.ba', 'BiH', 'Visok', 'Kontaktirati']]),
    user, sheetName: 'Privatne firme', headerRow: 1, mapping: mapping(), duplicateStrategy: 'update'
  });
  assert.equal(report.updated, 1);
  assert.equal(report.imported, 0);
  const contacts = await db('email_contacts');
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].priority, 'Visok');
  assert.equal(contacts[0].status, 'Kontaktirati');
});

test('suppression lista uvijek nadjačava dozvolu slanja pri importu', async (t) => {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await migration.up(db);
  await db('email_suppression_list').insert({
    id: 'suppression-1',
    email: 'stop@firma.ba',
    email_normalized: 'stop@firma.ba',
    reason: 'Odjava',
    source: 'TEST',
    created_by: 'test-user'
  });
  await importContacts({
    db,
    file: await workbookFile([['Naziv firme', 'Email', 'Država', 'Prioritet', 'Status'], ['Stop firma', 'stop@firma.ba', 'BiH', 'Nizak', 'Novi']]),
    user: { id: 'test-user' }, sheetName: 'Privatne firme', headerRow: 1,
    mapping: mapping(), duplicateStrategy: 'skip'
  });
  const contact = await db('email_contacts').first();
  assert.equal(Boolean(contact.sending_allowed), false);
  assert.equal(contact.suppression_reason, 'SUPPRESSION_LIST');
});

test('neautorizovan zahtjev dobija 401 prije pristupa AI mail ruti', () => {
  const req = { get: () => '' };
  let statusCode;
  let payload;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; }
  };
  authenticateRequest(req, res, () => assert.fail('next ne smije biti pozvan'));
  assert.equal(statusCode, 401);
  assert.match(payload.error, /prijava/i);
});
