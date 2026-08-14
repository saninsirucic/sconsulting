const sanPestSeed = require('../data/sanPestSeed.json');

const BRAND_CODE = 'SAN_PEST';
const SOURCE_PREFIX = 'SAN_PEST:DDD_KOMERCIJALA_FINAL:';

function clean(value) {
  if (value === null || value === undefined) return null;
  const result = String(value).trim();
  return result || null;
}

function extractFirstEmail(...values) {
  const text = values.filter(Boolean).join('\n');
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function extractFirstPhone(...values) {
  const text = values.filter(Boolean).join('\n')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ');
  const candidates = text.match(/\+?\d[\d\s./()-]{5,}\d/g) || [];
  const match = candidates.find((candidate) => {
    const digitCount = candidate.replace(/\D/g, '').length;
    return digitCount >= 7 && digitCount <= 15;
  });
  return match ? match.trim().replace(/\s+/g, ' ').slice(0, 100) : null;
}

function extractWebsite(...values) {
  const text = values.filter(Boolean).join('\n');
  const match = text.match(/(?:https?:\/\/|www\.)[^\s;,|]+/i);
  if (!match) return null;
  return (match[0].toLowerCase().startsWith('www.') ? `https://${match[0]}` : match[0]).slice(0, 500);
}

function mapStatus(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized.includes('ODBILI')) return 'REJECTED';
  if (normalized.includes('POSLAN MAIL')) return 'EMAIL_SENT';
  if (normalized.includes('PONOVO KONTAKTIRATI') || normalized.includes('NIJE DOBIJEN ODGOVOR')) return 'FOLLOW_UP';
  if (normalized.includes('JAK INTERES')) return 'INTERESTED';
  if (normalized.includes('PROVJERITI')) return 'CALL_REQUIRED';
  return 'NEW';
}

function mapPriority(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized.startsWith('VISOK')) return 'HIGH';
  if (normalized.startsWith('NIZAK')) return 'LOW';
  return 'MEDIUM';
}

function buildLocation(row) {
  return [clean(row.location), clean(row.country)].filter(Boolean).join(', ') || null;
}

function buildNotes(row) {
  const parts = [];
  if (clean(row.address)) parts.push(`Adresa: ${clean(row.address)}`);
  if (clean(row.saninComment) && clean(row.oldHistory)) {
    parts.push(`Stari komentar / historija:\n${clean(row.oldHistory)}`);
  }
  if (clean(row.financialStatus)) parts.push(`Finansijski status: ${clean(row.financialStatus)}`);
  if (clean(row.blockStatus)) parts.push(`Blokada / stečaj: ${clean(row.blockStatus)}`);
  if (clean(row.financeNote)) parts.push(`Napomena finansije:\n${clean(row.financeNote)}`);
  return parts.length ? parts.join('\n\n') : null;
}

function sourceData(row) {
  return {
    'N/R': row.nr,
    KOMITENT: row.company,
    'DRŽAVA': row.country,
    VRSTA: row.type,
    LOKACIJA: row.location,
    ADRESA: row.address,
    Mail: row.rawMail,
    Kontakt: row.rawContact,
    'Komentar Sanin': row.saninComment,
    STATUS: row.sourceStatus,
    PRIORITET: row.sourcePriority,
    'STARI KOMENTAR / HISTORIJA': row.oldHistory,
    'FINANSIJSKI STATUS': row.financialStatus,
    'BLOKADA / STEČAJ': row.blockStatus,
    'NAPOMENA FINANSIJE': row.financeNote
  };
}

function validateSeed() {
  const rows = sanPestSeed.rows || [];
  if (rows.length !== sanPestSeed.source.importedRowCount || rows.length !== 156) {
    throw new Error('SAN Pest seed mora sadržavati tačno 156 redova.');
  }
  const numbers = new Set();
  for (const row of rows) {
    if (!Number.isInteger(row.nr) || row.nr < 1 || !clean(row.company)) {
      throw new Error(`Neispravan SAN Pest seed red: ${JSON.stringify(row)}`);
    }
    if (numbers.has(row.nr)) throw new Error(`Dupli SAN Pest N/R: ${row.nr}`);
    numbers.add(row.nr);
  }
}

exports.up = async function up(knex) {
  validateSeed();
  const brand = await knex('crm_brands').where({ code: BRAND_CODE }).first();
  if (!brand) throw new Error('SAN Pest CRM brend nije pronađen.');

  const now = new Date();
  const accounts = sanPestSeed.rows.map((row) => ({
    id: `san-pest-account-${String(row.nr).padStart(3, '0')}`,
    brand_id: brand.id,
    source_key: `${SOURCE_PREFIX}${row.nr}`,
    source_row_number: row.nr,
    company_name: clean(row.company),
    record_type: clean(row.type),
    branch_count: null,
    unit_amount: null,
    total_amount: null,
    profit_amount: null,
    currency: 'BAM',
    contact_person: null,
    email: extractFirstEmail(row.rawMail, row.rawContact),
    phone: extractFirstPhone(row.rawContact, row.rawMail),
    website: extractWebsite(row.rawMail, row.rawContact),
    location: buildLocation(row),
    status: mapStatus(row.sourceStatus),
    priority: mapPriority(row.sourcePriority),
    comment: clean(row.saninComment) || clean(row.oldHistory),
    notes: buildNotes(row),
    raw_mail: clean(row.rawMail),
    raw_contact: clean(row.rawContact),
    source_data_json: JSON.stringify(sourceData(row)),
    created_at: now,
    updated_at: now
  }));

  // Keep each insert comfortably below SQLite's binding limit while also
  // remaining efficient on PostgreSQL in production.
  for (let index = 0; index < accounts.length; index += 20) {
    await knex('crm_accounts').insert(accounts.slice(index, index + 20))
      .onConflict(['brand_id', 'source_key']).ignore();
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
exports.extractFirstEmail = extractFirstEmail;
exports.extractFirstPhone = extractFirstPhone;
exports.extractWebsite = extractWebsite;
exports.mapStatus = mapStatus;
exports.mapPriority = mapPriority;
exports.buildLocation = buildLocation;
exports.buildNotes = buildNotes;
exports.sourceData = sourceData;
exports.validateSeed = validateSeed;
