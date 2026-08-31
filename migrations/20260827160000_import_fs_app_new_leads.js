const seed = require('../data/fsAppNewLeads20260827.json');

const BRAND_CODE = 'FS_APP';
const SOURCE_PREFIX = 'FS_APP:NEW_20260827:';
const SOURCE_ROW_OFFSET = 2000;
const SOURCE_ROW_COUNT = 131;
const BATCH_SIZE = 20;

function clean(value, maxLength) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  if (!result) return null;
  return maxLength ? result.slice(0, maxLength) : result;
}

function normalizeCompany(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:j d o o|d o o|a d|d d|k d|doo|jdoo|llc|ltd|inc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCountry(value) {
  const text = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/bosna|hercegovina|\bbih\b/.test(text)) return 'BA';
  if (/hrvatska|croatia/.test(text)) return 'HR';
  if (/srbija|serbia/.test(text)) return 'RS';
  return text.replace(/[^a-z0-9]+/g, '');
}

function parseSourceData(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function accountCountry(row) {
  const source = parseSourceData(row.source_data_json);
  return normalizeCountry(source.Država || source['DRŽAVA'] || source.DRZAVA || row.location);
}

function rowCountry(row) {
  return normalizeCountry(row.sourceData?.Država || row.sourceData?.['DRŽAVA'] || row.location);
}

function marketKey(companyName, country) {
  return `${normalizeCompany(companyName)}|${country}`;
}

function validateSeed() {
  if (!Array.isArray(seed) || seed.length !== SOURCE_ROW_COUNT) {
    throw new Error(`FS App paket mora sadržavati tačno ${SOURCE_ROW_COUNT} izvornih redova.`);
  }

  const indexes = new Set();
  const markets = new Set();
  const countryCounts = { BA: 0, HR: 0, RS: 0 };
  for (const row of seed) {
    const index = Number(row.batchIndex);
    const company = clean(row.companyName);
    const country = rowCountry(row);
    if (!Number.isInteger(index) || index < 1 || index > SOURCE_ROW_COUNT || !company) {
      throw new Error(`Neispravan FS App red: ${JSON.stringify(row)}`);
    }
    if (indexes.has(index)) throw new Error(`Dupli FS App indeks: ${index}`);
    indexes.add(index);
    const key = marketKey(company, country);
    if (markets.has(key)) throw new Error(`Dupli FS App komitent na istom tržištu: ${company}`);
    markets.add(key);
    if (!(country in countryCounts)) throw new Error(`Nepodržano FS App tržište: ${country || 'prazno'}`);
    countryCounts[country] += 1;
    if (row.sourceData?.Program !== 'FS App' || row.status !== 'NEW' || row.priority !== 'HIGH'
      || !row.email || !row.phone || !row.website || !row.adminCallRequested) {
      throw new Error(`FS App red nema očekivani program, status, prioritet, kontakt ili admin poziv: ${company}`);
    }
  }

  if (countryCounts.BA !== 7 || countryCounts.HR !== 61 || countryCounts.RS !== 63) {
    throw new Error(`Neočekivana raspodjela FS App tržišta: ${JSON.stringify(countryCounts)}`);
  }
}

function accountRow(row, brandId, now) {
  const index = Number(row.batchIndex);
  return {
    id: `fs-app-new-20260827-${String(index).padStart(3, '0')}`,
    brand_id: brandId,
    source_key: `${SOURCE_PREFIX}${index}`,
    source_row_number: SOURCE_ROW_OFFSET + index,
    company_name: clean(row.companyName, 300),
    record_type: clean(row.recordType, 120),
    branch_count: null,
    unit_amount: null,
    total_amount: null,
    profit_amount: null,
    currency: 'BAM',
    contact_person: clean(row.contactPerson, 250),
    email: clean(row.email, 320)?.toLowerCase() || null,
    phone: clean(row.phone, 100),
    website: clean(row.website, 500),
    location: clean(row.location, 250),
    status: 'NEW',
    priority: 'HIGH',
    comment: clean(row.comment),
    notes: clean(row.notes),
    raw_mail: clean(row.rawMail),
    raw_contact: clean(row.rawContact),
    source_data_json: JSON.stringify(row.sourceData),
    next_contact_at: row.nextContactAt ? new Date(row.nextContactAt) : null,
    admin_call_requested_at: row.adminCallRequested ? now : null,
    admin_call_requested_by: null,
    created_at: now,
    updated_at: now
  };
}

exports.up = async function up(knex) {
  validateSeed();
  const brand = await knex('crm_brands').where({ code: BRAND_CODE }).first();
  if (!brand) throw new Error('FS App CRM brend nije pronađen.');

  const existingRows = await knex('crm_accounts')
    .where({ brand_id: brand.id })
    .select('company_name', 'location', 'source_data_json');
  const existingMarkets = new Set(existingRows.map((row) => marketKey(row.company_name, accountCountry(row))));
  const rowsToInsert = seed.filter((row) => !existingMarkets.has(marketKey(row.companyName, rowCountry(row))));

  const now = new Date();
  const accounts = rowsToInsert.map((row) => accountRow(row, brand.id, now));
  for (let index = 0; index < accounts.length; index += BATCH_SIZE) {
    await knex('crm_accounts')
      .insert(accounts.slice(index, index + BATCH_SIZE))
      .onConflict(['brand_id', 'source_key'])
      .ignore();
  }
};

exports.down = async function down(knex) {
  const brand = await knex('crm_brands').where({ code: BRAND_CODE }).first();
  if (!brand) return;
  await knex('crm_accounts')
    .where({ brand_id: brand.id })
    .where('source_key', 'like', `${SOURCE_PREFIX}%`)
    .delete();
};

exports.BRAND_CODE = BRAND_CODE;
exports.SOURCE_PREFIX = SOURCE_PREFIX;
exports.SOURCE_ROW_OFFSET = SOURCE_ROW_OFFSET;
exports.SOURCE_ROW_COUNT = SOURCE_ROW_COUNT;
exports.accountRow = accountRow;
exports.normalizeCompany = normalizeCompany;
exports.normalizeCountry = normalizeCountry;
exports.rowCountry = rowCountry;
exports.validateSeed = validateSeed;
