const seed = require('../data/visiocastNewLeads20260827.json');

const BRAND_CODE = 'VISIOCAST';
const SOURCE_PREFIX = 'VISIOCAST:NEW_20260827:';
const SOURCE_ROW_OFFSET = 1000;
const BATCH_SIZE = 20;

function clean(value, maxLength) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  if (!result) return null;
  return maxLength ? result.slice(0, maxLength) : result;
}

function mapStatus(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized.includes('ODBIJ')) return 'REJECTED';
  if (normalized.includes('SASTANAK')) return 'MEETING_SCHEDULED';
  if (normalized.includes('POSLAN') || normalized.includes('MAIL')) return 'EMAIL_SENT';
  if (normalized.includes('KONTAKT')) return 'CONTACTED';
  if (normalized.includes('ZVATI') || normalized.includes('POZIV')) return 'CALL_REQUIRED';
  return 'NEW';
}

function mapPriority(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'TOP' || normalized.startsWith('VISOK') || normalized === 'HIGH') return 'HIGH';
  if (normalized.startsWith('NIZAK') || normalized === 'LOW') return 'LOW';
  return 'MEDIUM';
}

function buildLocation(row) {
  return clean([clean(row['Grad / tržište']), clean(row['Država'])].filter(Boolean).join(', '), 250);
}

function buildRawMail(row) {
  return [
    clean(row['Primarni email']) && `Primarni: ${clean(row['Primarni email'])}`,
    clean(row['Sekundarni email']) && `Sekundarni: ${clean(row['Sekundarni email'])}`
  ].filter(Boolean).join('\n') || null;
}

function buildRawContact(row) {
  return [
    clean(row['Odjel / kontakt']) && `Odjel / kontakt: ${clean(row['Odjel / kontakt'])}`,
    clean(row['Telefon']) && `Telefon: ${clean(row['Telefon'])}`
  ].filter(Boolean).join('\n') || null;
}

function buildNotes(row) {
  const parts = [
    ['Preporučeni prvi kanal', row['Preporučeni prvi kanal']],
    ['Kvalitet kontakta', row['Kvalitet kontakta']],
    ['Potencijal', row['Potencijal (1-5)']],
    ['Admin rekao zvati', row['Admin rekao zvati']],
    ['Izvor kontakta', row['Izvor kontakta']],
    ['Drugi izvor / mreža', row['Drugi izvor / mreža']],
    ['Datum provjere', row['Datum provjere']],
    ['Napomena izvora', row['Napomena']]
  ];
  const lines = parts
    .filter(([, value]) => clean(value))
    .map(([label, value]) => `${label}: ${clean(value)}`);
  return lines.length ? lines.join('\n') : null;
}

function nextContact(value) {
  const cleaned = clean(value);
  if (!cleaned) return null;
  const parsed = new Date(cleaned);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function adminCallRequested(row) {
  return ['DA', 'YES', 'TRUE', '1'].includes(String(row['Admin rekao zvati'] || '').trim().toUpperCase());
}

function validateSeed() {
  const rows = seed.rows || [];
  if (rows.length !== seed.source.importedRowCount || rows.length !== 68) {
    throw new Error('VisioCast paket novih komitenata mora sadržavati tačno 68 redova.');
  }
  const numbers = new Set();
  const markets = new Set();
  for (const row of rows) {
    const nr = Number(row['Redni broj']);
    const company = clean(row['Naziv komitenta']);
    if (row.Program !== 'VisioCast' || !Number.isInteger(nr) || nr < 1 || !company) {
      throw new Error(`Neispravan VisioCast red: ${JSON.stringify(row)}`);
    }
    if (numbers.has(nr)) throw new Error(`Dupli VisioCast redni broj: ${nr}`);
    numbers.add(nr);
    const marketKey = `${company.toLocaleLowerCase('bs')}|${clean(row['Država']) || ''}`;
    if (markets.has(marketKey)) throw new Error(`Dupli VisioCast komitent na istom tržištu: ${company}`);
    markets.add(marketKey);
  }
}

function accountRow(row, brandId, now) {
  const nr = Number(row['Redni broj']);
  const primaryEmail = clean(row['Primarni email'], 320);
  return {
    id: `visiocast-new-20260827-${String(nr).padStart(3, '0')}`,
    brand_id: brandId,
    source_key: `${SOURCE_PREFIX}${nr}`,
    source_row_number: SOURCE_ROW_OFFSET + nr,
    company_name: clean(row['Naziv komitenta'], 300),
    record_type: clean(row['Segment'], 120),
    branch_count: null,
    unit_amount: null,
    total_amount: null,
    profit_amount: null,
    currency: 'BAM',
    contact_person: clean(row['Odjel / kontakt'], 250),
    email: primaryEmail ? primaryEmail.toLowerCase() : null,
    phone: clean(row['Telefon'], 100),
    website: clean(row['Web'], 500),
    location: buildLocation(row),
    status: mapStatus(row['CRM status']),
    priority: mapPriority(row['Prioritet']),
    comment: clean(row['Zašto je dobar za VisioCast']),
    notes: buildNotes(row),
    raw_mail: buildRawMail(row),
    raw_contact: buildRawContact(row),
    source_data_json: JSON.stringify(row),
    next_contact_at: nextContact(row['Sljedeći kontakt']),
    admin_call_requested_at: adminCallRequested(row) ? now : null,
    admin_call_requested_by: null,
    created_at: now,
    updated_at: now
  };
}

exports.up = async function up(knex) {
  validateSeed();
  const brand = await knex('crm_brands').where({ code: BRAND_CODE }).first();
  if (!brand) throw new Error('VisioCast CRM brend nije pronađen.');

  const now = new Date();
  const accounts = seed.rows.map((row) => accountRow(row, brand.id, now));
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
exports.accountRow = accountRow;
exports.adminCallRequested = adminCallRequested;
exports.buildLocation = buildLocation;
exports.buildNotes = buildNotes;
exports.mapPriority = mapPriority;
exports.mapStatus = mapStatus;
exports.validateSeed = validateSeed;
