const crypto = require('node:crypto');
const zlib = require('node:zlib');
const ExcelJS = require('exceljs');
const { strictEmailAddress } = require('./email');
const { httpError, normalizeAccountInput, resolveBrand } = require('./service');

const IMPORT_BRAND = 'JAVNE_USTANOVE';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_COLUMNS = 100;
const HEADER_SCAN_ROWS = 20;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;

function canonical(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'dj').trim().toLowerCase().replace(/\s+/g, ' ');
}

const HEADER_ALIASES = {
  name: ['name', 'company', 'company name', 'company_name', 'institution', 'institution name',
    'naziv', 'naziv ustanove', 'naziv javne ustanove', 'naziv institucije', 'naziv komitenta', 'naziv firme',
    'naziv ustanove / institucije', 'naziv institucije / ustanove', 'naziv organizacije',
    'naziv poslovnog subjekta', 'ustanova', 'institucija', 'firma', 'organizacija', 'organization'],
  email: ['email', 'e-mail', 'mail', 'e-mail adresa', 'kontakt email', 'email address', 'adresa elektronske poste'],
  phone: ['phone', 'phone number', 'telephone', 'telefon', 'tel', 'broj telefona', 'kontakt telefon', 'mobitel', 'mobile'],
  city: ['city', 'town', 'grad', 'mjesto', 'opcina', 'opstina', 'municipality'],
  address: ['address', 'street address', 'adresa', 'ulica', 'ulica i broj', 'adresa sjedista', 'sjediste'],
  contact_person: ['contact person', 'contact_person', 'contact name', 'kontakt osoba',
    'kontakt', 'ime i prezime', 'odgovorna osoba', 'ime kontakt osobe']
};
const normalizeHeader = (value) => canonical(value).replace(/[^a-z0-9]/g, '');
const HEADER_FIELDS = new Map(Object.entries(HEADER_ALIASES)
  .flatMap(([field, names]) => names.map((name) => [normalizeHeader(name), field])));

function requireImportBrand(brand) {
  if (brand.code !== IMPORT_BRAND) {
    throw httpError(403, 'XLSX uvoz je dostupan samo za bazu Javne ustanove.', 'IMPORT_BRAND_DENIED');
  }
}

function sheetTooLarge() {
  return httpError(413, 'Svaki radni list smije imati najviše 5000 redova podataka i 100 kolona.', 'IMPORT_SHEET_TOO_LARGE');
}

function validateWorksheetXml(buffer) {
  const xml = buffer.toString('utf8');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw httpError(400, 'XML deklaracije nisu podržane.', 'IMPORT_FILE_INVALID');
  const coordinate = (value) => {
    const match = /^\$?([A-Z]+)\$?([1-9]\d*)$/i.exec(value);
    if (!match) throw httpError(400, 'Neispravna adresa ćelije u XLSX datoteci.', 'IMPORT_FILE_INVALID');
    let column = 0;
    for (const character of match[1].toUpperCase()) {
      column = column * 26 + character.charCodeAt(0) - 64;
      if (column > MAX_COLUMNS) throw sheetTooLarge();
    }
    if (Number(match[2]) > MAX_ROWS + HEADER_SCAN_ROWS) throw sheetTooLarge();
  };
  let rowCount = 0;
  let cellCount = 0;
  for (const match of xml.matchAll(/<(?:[\w]+:)?(row|c|col)\b([^>]*)>/g)) {
    const [, type, attributes] = match;
    const rowOrCell = /\br\s*=\s*["']([^"']+)["']/.exec(attributes);
    if (type === 'row') {
      rowCount += 1;
      if (rowCount > MAX_ROWS + HEADER_SCAN_ROWS) throw sheetTooLarge();
      if (rowOrCell && (!/^[1-9]\d*$/.test(rowOrCell[1]) || Number(rowOrCell[1]) > MAX_ROWS + HEADER_SCAN_ROWS)) throw sheetTooLarge();
    } else if (type === 'c') {
      cellCount += 1;
      if (cellCount > (MAX_ROWS + HEADER_SCAN_ROWS) * MAX_COLUMNS) throw sheetTooLarge();
      if (rowOrCell) coordinate(rowOrCell[1]);
    } else {
      for (const bound of attributes.matchAll(/\b(?:min|max)\s*=\s*["']([^"']+)["']/g)) {
        if (!/^[1-9]\d*$/.test(bound[1]) || Number(bound[1]) > MAX_COLUMNS) throw sheetTooLarge();
      }
    }
  }
  // Merged cells, hyperlinks and validations can allocate large ranges even with few rows.
  for (const match of xml.matchAll(/\b(?:ref|sqref)\s*=\s*["']([^"']+)["']/g)) {
    for (const range of match[1].trim().split(/\s+/)) {
      for (const end of range.split(':')) coordinate(end);
    }
  }
}

// Bound actual inflation and all sheets before ExcelJS allocates its workbook model.
function validateArchive(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_FILE_BYTES) {
    throw httpError(413, 'XLSX datoteka smije imati najviše 5 MB.', 'IMPORT_FILE_TOO_LARGE');
  }
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) {
      end = i;
      break;
    }
  }
  const invalid = () => httpError(400, 'Datoteka nije podržan XLSX dokument.', 'IMPORT_FILE_INVALID');
  const validateExtras = (start, length, boundary) => {
    const finish = start + length;
    if (finish > boundary) throw invalid();
    for (let position = start; position < finish;) {
      if (position + 4 > finish) throw invalid();
      const kind = buffer.readUInt16LE(position);
      const fieldLength = buffer.readUInt16LE(position + 2);
      // Do not let JSZip override the path or sizes already validated here.
      if (kind === 0x7075 || kind === 0x0001) throw invalid();
      position += 4 + fieldLength;
      if (position > finish) throw invalid();
    }
  };
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw invalid();
  const count = buffer.readUInt16LE(end + 10);
  const size = buffer.readUInt32LE(end + 12);
  let offset = buffer.readUInt32LE(end + 16);
  const centralStart = offset;
  const centralEnd = offset + size;
  if (!count || count > 1000 || buffer.readUInt16LE(end + 8) !== count || centralEnd !== end) throw invalid();
  let expandedBytes = 0;
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw invalid();
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const expectedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const nextOffset = offset + 46 + nameLength
      + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
    if (nextOffset > centralEnd || flags & 1 || ![0, 8].includes(method) || localOffset + 30 > centralStart) throw invalid();
    const nameBytes = buffer.subarray(offset + 46, offset + 46 + nameLength);
    validateExtras(offset + 46 + nameLength, buffer.readUInt16LE(offset + 30), centralEnd);
    const name = nameBytes.toString('utf8');
    const pathParts = name.split('/');
    if (!name || name.includes('\\') || pathParts.some((part, index) => part === '.' || part === '..'
      || (!part && index !== pathParts.length - 1))) throw invalid();
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50
      || buffer.readUInt16LE(localOffset + 6) !== flags
      || buffer.readUInt16LE(localOffset + 8) !== method) throw invalid();
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    validateExtras(localOffset + 30 + localNameLength, buffer.readUInt16LE(localOffset + 28), centralStart);
    const dataStart = localOffset + 30 + localNameLength + buffer.readUInt16LE(localOffset + 28);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralStart || !buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength).equals(nameBytes)) throw invalid();
    if (!(flags & 8) && (buffer.readUInt32LE(localOffset + 18) !== compressedSize
      || buffer.readUInt32LE(localOffset + 22) !== expectedSize)) throw invalid();
    if (expectedSize > MAX_EXPANDED_BYTES - expandedBytes) {
      throw httpError(413, 'Raspakovani XLSX dokument je prevelik.', 'IMPORT_WORKBOOK_TOO_LARGE');
    }
    let content;
    try {
      content = method === 0 ? buffer.subarray(dataStart, dataEnd)
        : zlib.inflateRawSync(buffer.subarray(dataStart, dataEnd), {
          maxOutputLength: Math.max(1, Math.min(expectedSize, MAX_EXPANDED_BYTES - expandedBytes))
        });
    } catch (error) {
      throw invalid();
    }
    if (content.length !== expectedSize) throw invalid();
    expandedBytes += content.length;
    if (/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) validateWorksheetXml(content);
    offset = nextOffset;
  }
  if (offset !== centralEnd) throw invalid();
}

function cellText(cell) {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.richText) return value.richText.map((part) => part.text || '').join('').trim();
    if (value.text !== undefined) return String(value.text).trim();
    // Do not evaluate formulas or trust cached formula results as contact details.
    return '';
  }
  return String(value).trim();
}

function findHeader(workbook) {
  for (const sheet of workbook.worksheets) {
    if (sheet.state && sheet.state !== 'visible') continue;
    if (/^(upute|uputstvo|instructions?|pomoc|sifarnik|lookup|legend|statistika|summary|rezime)(\b|_)/.test(canonical(sheet.name))) continue;
    let found;
    sheet.eachRow((row) => {
      if (found || row.number > HEADER_SCAN_ROWS) return;
      const columns = {};
      row.eachCell((cell, index) => {
        const field = HEADER_FIELDS.get(normalizeHeader(cellText(cell)));
        if (field && !columns[field]) columns[field] = index;
      });
      if (columns.name) found = { sheet, header: row, columns };
    });
    if (found) return found;
  }
  throw httpError(400, 'Nije pronađena kolona Naziv / Name u prvih 20 redova radnog lista.', 'IMPORT_NAME_COLUMN_REQUIRED');
}

function accountInput(row) {
  return {
    company_name: row.name,
    email: row.email,
    phone: row.phone,
    contact_person: row.contact_person,
    location: [row.address, row.city].filter(Boolean).join(', '),
    source_row_number: row.row_number,
    ownership_type: 'PUBLIC',
    status: 'NEW',
    priority: 'MEDIUM'
  };
}

function rowError(row) {
  if (!row.name) return 'Naziv ustanove je obavezan.';
  const limits = { name: 300, email: 254, phone: 100, city: 250, address: 500, contact_person: 250 };
  for (const [key, maximum] of Object.entries(limits)) {
    if (row[key].length > maximum) return `Polje ${key} ima više od ${maximum} znakova.`;
  }
  if (row.email && !strictEmailAddress(row.email)) return 'E-mail adresa nije ispravna.';
  try {
    normalizeAccountInput(accountInput(row));
    return null;
  } catch (error) {
    return error.message;
  }
}

async function readWorkbook(buffer) {
  validateArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch (error) {
    throw httpError(400, 'XLSX datoteka se ne može pročitati.', 'IMPORT_FILE_INVALID');
  }
  const { sheet, header, columns } = findHeader(workbook);
  if (sheet.columnCount > MAX_COLUMNS || sheet.rowCount > MAX_ROWS + HEADER_SCAN_ROWS) {
    throw httpError(413, 'Radni list smije imati najviše 5000 redova podataka i 100 kolona.', 'IMPORT_SHEET_TOO_LARGE');
  }
  const headers = [];
  header.eachCell((cell, index) => { headers[index - 1] = cellText(cell); });
  const rows = [];
  sheet.eachRow((sourceRow) => {
    if (sourceRow.number <= header.number) return;
    const row = { row_number: sourceRow.number };
    for (const field of Object.keys(HEADER_ALIASES)) {
      row[field] = columns[field] ? cellText(sourceRow.getCell(columns[field])) : '';
    }
    if (!Object.keys(HEADER_ALIASES).some((field) => row[field])) return;
    row.email = row.email.toLowerCase();
    row.source_data = {};
    sourceRow.eachCell((cell, index) => {
      const text = cellText(cell);
      if (text) row.source_data[`${index}: ${headers[index - 1] || 'Kolona'}`] = text;
    });
    rows.push(row);
  });
  if (rows.length > MAX_ROWS) throw httpError(413, 'Najviše 5000 redova po uvozu.', 'IMPORT_SHEET_TOO_LARGE');
  if (!rows.length) throw httpError(400, 'Radni list ne sadrži kontakte za uvoz.', 'IMPORT_EMPTY');
  return { rows, worksheet_name: sheet.name, header_row: header.number, headers };
}

async function duplicateIndex(db, brandId) {
  // Include archived accounts to avoid silently restoring an archived contact by import.
  const accounts = await db('crm_accounts').where({ brand_id: brandId }).select('company_name', 'email');
  return {
    names: new Set(accounts.map((row) => canonical(row.company_name)).filter(Boolean)),
    emails: new Set(accounts.map((row) => canonical(row.email)).filter(Boolean))
  };
}

function classifyRows(rows, index) {
  return rows.map((row) => {
    const error = rowError(row);
    if (error) return { ...row, error };
    const name = canonical(row.name);
    const email = canonical(row.email);
    if (index.names.has(name) || (email && index.emails.has(email))) return { ...row, duplicate: true };
    index.names.add(name);
    if (email) index.emails.add(email);
    return row;
  });
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function previewAccountImport(db, brand, user, file) {
  requireImportBrand(brand);
  await resolveBrand(db, user, brand.code, { write: true });
  if (!file || !/\.xlsx$/i.test(file.originalname || '')) {
    throw httpError(400, 'Odaberite XLSX datoteku za uvoz.', 'IMPORT_FILE_REQUIRED');
  }
  const payload = await readWorkbook(file.buffer);
  const classified = classifyRows(payload.rows, await duplicateIndex(db, brand.id));
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  await db('crm_account_imports').insert({
    id: crypto.randomUUID(), token_hash: hashToken(token), user_id: user.id, brand_id: brand.id,
    status: 'PREVIEW', payload_json: JSON.stringify(payload), created_at: now,
    expires_at: new Date(now.getTime() + TOKEN_TTL_MS)
  });
  const invalid = classified.filter((row) => row.error).length;
  const duplicates = classified.filter((row) => row.duplicate).length;
  return {
    import_token: token,
    preview: {
      rows: classified.map(({ source_data, ...row }) => row),
      total_rows: classified.length, valid_rows: classified.length - invalid - duplicates,
      invalid_rows: invalid, duplicate_rows: duplicates,
      worksheet_name: payload.worksheet_name, header_row: payload.header_row,
      headers: payload.headers
    }
  };
}

async function commitAccountImport(db, brand, user, token) {
  requireImportBrand(brand);
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw httpError(400, 'Token uvoza nije ispravan.', 'IMPORT_TOKEN_INVALID');
  }
  return db.transaction(async (trx) => {
    // Serialize imports of the same brand, including different preview tokens.
    await trx('crm_brands').where({ id: brand.id }).forUpdate().first();
    await resolveBrand(trx, user, brand.code, { write: true });
    const job = await trx('crm_account_imports').where({
      token_hash: hashToken(token), user_id: user.id, brand_id: brand.id
    }).forUpdate().first();
    if (!job) throw httpError(404, 'Pregled uvoza nije pronađen.', 'IMPORT_TOKEN_NOT_FOUND');
    const now = new Date();
    if (new Date(job.expires_at).getTime() <= now.getTime()) {
      throw httpError(410, 'Pregled uvoza je istekao. Ponovo učitajte datoteku.', 'IMPORT_TOKEN_EXPIRED');
    }
    if (job.status === 'COMPLETED') return JSON.parse(job.result_json);
    const claimed = await trx('crm_account_imports').where({ id: job.id, status: 'PREVIEW' })
      .update({ status: 'COMMITTING' });
    if (!claimed) throw httpError(409, 'Uvoz je već u obradi.', 'IMPORT_IN_PROGRESS');
    const payload = JSON.parse(job.payload_json);
    const rows = classifyRows(payload.rows, await duplicateIndex(trx, brand.id));
    const result = { imported: 0, skipped: 0, errors: [] };
    for (const row of rows) {
      if (row.error || row.duplicate) {
        result.skipped += 1;
        if (row.error) result.errors.push({ row_number: row.row_number, error: row.error });
        continue;
      }
      const id = crypto.randomUUID();
      const account = {
        id, brand_id: brand.id, source_key: `XLSX:${job.id}:${row.row_number}`,
        ...normalizeAccountInput(accountInput(row)),
        source_data_json: JSON.stringify({
          ...row.source_data, source: 'XLSX_IMPORT', import_id: job.id,
          __SOURCE_SHEET: payload.worksheet_name, __HEADER_ROW: payload.header_row,
          city: row.city, address: row.address
        }),
        owner_user_id: user.authSource === 'db' ? user.id : null,
        created_by: user.id, updated_by: user.id, created_at: now, updated_at: now
      };
      await trx('crm_accounts').insert(account);
      await trx('crm_activities').insert({
        id: crypto.randomUUID(), account_id: id, brand_id: brand.id, user_id: user.id,
        activity_type: 'ACCOUNT_CREATED', to_status: 'NEW', occurred_at: now, created_at: now,
        metadata_json: JSON.stringify({ source: 'XLSX_IMPORT', import_id: job.id, row_number: row.row_number })
      });
      result.imported += 1;
    }
    await trx('crm_account_imports').where({ id: job.id }).update({
      status: 'COMPLETED', result_json: JSON.stringify(result), committed_at: now,
      payload_json: '{}' // Discard uploaded contact data after the atomic commit.
    });
    return result;
  });
}

module.exports = {
  IMPORT_BRAND, MAX_FILE_BYTES, MAX_ROWS, MAX_COLUMNS, TOKEN_TTL_MS,
  requireImportBrand, previewAccountImport, commitAccountImport, readWorkbook
};
