const { v4: uuidv4 } = require('uuid');
const seed = require('../data/sanPestBahrain20260901.json');

const MIGRATION_ID = '20260901140000_create_san_pest_bahrain_brand';
const MIGRATION_ACTOR = 'migration-sanpest-bahrain-20260901';
const SOURCE_BRAND_CODE = 'SAN_PEST';
const ENGLISH_COMMUNICATION_SENTENCE = 'For any further communication, we would be happy to continue in English.';
const MAIL_SUBJECT = 'A smarter way to manage pest control operations – {{KOMITENT}}';
const BAHRAIN_BODY = `Dear {{KOMITENT}} team,

I am contacting you on behalf of S-Consulting Group to introduce SANpest, a digital platform developed specifically for pest control companies.

SANpest brings your day-to-day operations into one system, including:
• customer, site and annual contract records
• treatment planning and team scheduling
• mobile work orders with QR and GPS verification
• chemical, stock and equipment records
• service certificates, reports, invoicing and payment tracking

For pest control companies in Bahrain, SANpest can support recurring commercial service agreements, multi-site clients and multiple field teams, with operational documents available in both English and Arabic.

We would be pleased to arrange a brief 15–20 minute online presentation tailored to {{KOMITENT}}. We can show you the platform and discuss how it could support your current workflow.

The presentation is free of charge and without obligation.

${ENGLISH_COMMUNICATION_SENTENCE}`;

const BRAND_SPEC = Object.freeze({
  id: 'brand-san-pest-bahrain',
  code: 'SAN_PEST_BAHRAIN',
  slug: 'san-pest-bahrain',
  name: 'SAN Pest Bahrain',
  market: 'Bahrain',
  country: 'Bahrain',
  currency: 'BHD',
  accountPrefix: 'san-pest-bh',
  expectedCount: 36,
  subject: MAIL_SUBJECT,
  body: BAHRAIN_BODY
});

function chunks(rows, size = 50) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

function sourceBrand() {
  return seed.brands.find((brand) => brand.code === BRAND_SPEC.code);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || ''));
}

function additionalEmails(row) {
  const primary = String(row.email || '').toLowerCase();
  return [...new Set((Array.isArray(row.additionalEmails) ? row.additionalEmails : [])
    .map((email) => String(email || '').trim().toLowerCase())
    .filter((email) => email && email !== primary))];
}

function validateSeed() {
  const brand = sourceBrand();
  if (seed.source.fileName !== 'SANpest_BAHREIN_firme_2026.xlsx'
    || seed.source.sha256 !== '8DB51114848DF4AEB31B88508CC173DEE78E3FDE8EF8C9F4218B0191B83ADCD4'
    || seed.source.sheetName !== 'BAHREIN'
    || seed.source.usedRange !== 'A1:S39'
    || seed.source.dataRange !== 'A2:S37'
    || Number(seed.source.importedRowCount) !== BRAND_SPEC.expectedCount
    || !brand || brand.market !== BRAND_SPEC.market
    || Number(brand.rowCount) !== BRAND_SPEC.expectedCount
    || !Array.isArray(brand.rows) || brand.rows.length !== BRAND_SPEC.expectedCount) {
    throw new Error('SAN Pest Bahrain snapshot ne odgovara pregledanom Excel izvoru.');
  }

  const ranks = new Set();
  for (const row of brand.rows) {
    if (!row.company || !Number.isInteger(row.marketRank) || row.marketRank < 1
      || row.marketRank > BRAND_SPEC.expectedCount || ranks.has(row.marketRank)
      || !['A+', 'A', 'B', 'C'].includes(row.priority)) {
      throw new Error('SAN Pest Bahrain snapshot sadrži neispravan ili dupliran red.');
    }
    ranks.add(row.marketRank);
    if (row.email && !validEmail(row.email)) throw new Error(`Neispravan email u Bahrain redu ${row.marketRank}.`);
    if (additionalEmails(row).some((email) => !validEmail(email))) {
      throw new Error(`Neispravan dodatni email u Bahrain redu ${row.marketRank}.`);
    }
  }
  return true;
}

function priorityFor(row) {
  if (row.priority === 'A+' || row.priority === 'A') return 'HIGH';
  if (row.priority === 'B') return 'MEDIUM';
  return 'LOW';
}

function statusFor(row) {
  return row.email ? 'NEW' : 'CALL_REQUIRED';
}

function accountNotes(row) {
  return [
    `Rang u tržištu: ${row.marketRank}/${BRAND_SPEC.expectedCount}`,
    row.fitScore === null || row.fitScore === undefined ? null : `SANpest fit: ${row.fitScore}/10`,
    row.priority ? `Prioritet izvora: ${row.priority}` : null,
    row.companyType ? `Tip firme: ${row.companyType}` : null,
    row.classification ? `Veličina / signal: ${row.classification}` : null,
    row.targetImplementationEur === null || row.targetImplementationEur === undefined
      ? null : `Cilj implementacije: ${row.targetImplementationEur} EUR`,
    row.targetMonthlyEur === null || row.targetMonthlyEur === undefined
      ? null : `Cilj mjesečno: ${row.targetMonthlyEur} EUR`,
    row.databaseStatus ? `Status u izvornoj bazi: ${row.databaseStatus}` : null,
    row.notes ? `Napomena izvora: ${row.notes}` : null,
    row.source ? `Izvor: ${row.source}` : null
  ].filter(Boolean).join('\n');
}

function rawContact(row) {
  return [
    row.contactPerson ? `Kontakt osoba: ${row.contactPerson}` : null,
    row.role ? `Funkcija: ${row.role}` : null,
    row.phone ? `Telefon / WhatsApp: ${row.phone}` : null,
    row.website ? `Web: ${row.website}` : null,
    row.city ? `Grad / područje: ${row.city}` : null
  ].filter(Boolean).join('\n') || null;
}

function accountRows(now) {
  return sourceBrand().rows.map((row) => ({
    id: `${BRAND_SPEC.accountPrefix}-account-${String(row.marketRank).padStart(3, '0')}`,
    brand_id: BRAND_SPEC.id,
    source_key: `${BRAND_SPEC.code}:20260901:${row.marketRank}`,
    source_row_number: row.sourceRow,
    company_name: row.company.slice(0, 300),
    record_type: row.companyType ? row.companyType.slice(0, 200) : 'DDD firma',
    branch_count: null,
    unit_amount: null,
    total_amount: null,
    profit_amount: null,
    currency: BRAND_SPEC.currency,
    contact_person: row.contactPerson ? row.contactPerson.slice(0, 250) : null,
    email: row.email,
    cc_emails_json: JSON.stringify(additionalEmails(row)),
    phone: row.phone ? row.phone.slice(0, 100) : null,
    website: row.website ? row.website.slice(0, 500) : null,
    location: [...new Set([row.city, BRAND_SPEC.country].filter(Boolean))].join(', ').slice(0, 250),
    status: statusFor(row),
    priority: priorityFor(row),
    comment: row.salesAngle,
    notes: accountNotes(row),
    raw_mail: row.rawEmail || [row.email, ...additionalEmails(row)].filter(Boolean).join('\n') || null,
    raw_contact: rawContact(row),
    source_data_json: JSON.stringify({
      ...row.original,
      _source_file: seed.source.fileName,
      _source_sheet: seed.source.sheetName,
      _source_row: row.sourceRow,
      _source_sha256: seed.source.sha256
    }),
    created_by: MIGRATION_ACTOR,
    updated_by: MIGRATION_ACTOR,
    created_at: now,
    updated_at: now
  }));
}

async function ensureBrand(trx, now) {
  const [byCode, byId, bySlug] = await Promise.all([
    trx('crm_brands').where({ code: BRAND_SPEC.code }).first(),
    trx('crm_brands').where({ id: BRAND_SPEC.id }).first(),
    trx('crm_brands').where({ slug: BRAND_SPEC.slug }).first()
  ]);
  if (!byCode) {
    if (byId || bySlug) throw new Error('ID ili slug za SAN Pest Bahrain već koristi drugi brend.');
    await trx('crm_brands').insert({
      id: BRAND_SPEC.id,
      code: BRAND_SPEC.code,
      slug: BRAND_SPEC.slug,
      name: BRAND_SPEC.name,
      daily_limit: 30,
      active: true,
      created_at: now,
      updated_at: now
    });
    return;
  }
  if (byCode.id !== BRAND_SPEC.id || byCode.slug !== BRAND_SPEC.slug) {
    throw new Error('Postojeći SAN Pest Bahrain brend nema očekivani ID i slug.');
  }
}

async function ensureSettings(trx, now) {
  await trx('crm_mail_automation_settings').insert({
    brand_id: BRAND_SPEC.id,
    enabled: false,
    paused: true,
    auto_send: false,
    daily_limit: 30,
    workdays_json: JSON.stringify([1, 2, 3, 4, 5]),
    send_window_start: '09:00',
    send_window_end: '15:00',
    send_interval_minutes: 5,
    follow_up_days: 7,
    subject: BRAND_SPEC.subject,
    body_text: BRAND_SPEC.body,
    report_enabled: true,
    report_time: '16:00',
    report_recipient: 'info@s-consulting.ba',
    updated_by: MIGRATION_ACTOR,
    created_at: now,
    updated_at: now
  }).onConflict('brand_id').ignore();
}

async function cloneAccess(trx, sourceBrandId, now) {
  const accessRows = await trx('app_user_brand_access').where({ brand_id: sourceBrandId })
    .select('user_id', 'can_read', 'can_write');
  for (const batch of chunks(accessRows)) {
    await trx('app_user_brand_access').insert(batch.map((row) => ({
      id: uuidv4(),
      user_id: row.user_id,
      brand_id: BRAND_SPEC.id,
      can_read: row.can_read,
      can_write: row.can_write,
      created_at: now,
      updated_at: now
    }))).onConflict(['user_id', 'brand_id']).ignore();
  }
}

exports.up = async function up(knex) {
  validateSeed();
  for (const table of ['crm_brands', 'crm_accounts', 'app_user_brand_access', 'crm_mail_automation_settings']) {
    if (!await knex.schema.hasTable(table)) throw new Error(`Nedostaje obavezna tabela ${table} za SAN Pest Bahrain migraciju.`);
  }
  if (!await knex.schema.hasColumn('crm_accounts', 'cc_emails_json')) {
    throw new Error('Nedostaje crm_accounts.cc_emails_json za dodatne primaoce.');
  }

  await knex.transaction(async (trx) => {
    const now = new Date();
    const source = await trx('crm_brands').where({ code: SOURCE_BRAND_CODE }).first();
    if (!source) throw new Error('Izvorni SAN Pest brend nije pronađen.');
    await ensureBrand(trx, now);
    await ensureSettings(trx, now);
    await cloneAccess(trx, source.id, now);
    for (const batch of chunks(accountRows(now))) {
      await trx('crm_accounts').insert(batch).onConflict(['brand_id', 'source_key']).ignore();
    }
    const count = await trx('crm_accounts').where({ brand_id: BRAND_SPEC.id }).count({ count: '*' }).first();
    if (Number(count.count) !== BRAND_SPEC.expectedCount) {
      throw new Error(`SAN Pest Bahrain mora nakon uvoza sadržavati tačno ${BRAND_SPEC.expectedCount} zapisa.`);
    }
  });
};

exports.down = async function down(knex) {
  await knex.transaction(async (trx) => {
    const brand = await trx('crm_brands').where({ code: BRAND_SPEC.code }).first();
    if (!brand) return;
    if (brand.id !== BRAND_SPEC.id || brand.slug !== BRAND_SPEC.slug) {
      throw new Error('Rollback je zaustavljen zbog neočekivanog identiteta SAN Pest Bahrain brenda.');
    }
    const accounts = await trx('crm_accounts').where({ brand_id: BRAND_SPEC.id }).select('source_key');
    if (accounts.length !== BRAND_SPEC.expectedCount
      || accounts.some((row) => !row.source_key.startsWith(`${BRAND_SPEC.code}:20260901:`))) {
      throw new Error('Rollback je zaustavljen jer SAN Pest Bahrain više nema samo izvorne zapise.');
    }
    for (const table of [
      'crm_mail_queue', 'crm_daily_assignments', 'crm_activities', 'crm_mail_attachments',
      'crm_mail_daily_reports', 'crm_calendar_meetings'
    ]) {
      if (!await trx.schema.hasTable(table)) continue;
      const count = await trx(table).where({ brand_id: BRAND_SPEC.id }).count({ count: '*' }).first();
      if (Number(count.count) > 0) throw new Error(`Rollback je zaustavljen jer ${table} sadrži Bahrain podatke.`);
    }
    const settings = await trx('crm_mail_automation_settings').where({ brand_id: BRAND_SPEC.id }).first();
    if (settings && settings.updated_by !== MIGRATION_ACTOR) {
      throw new Error('Rollback je zaustavljen jer su Bahrain mail postavke naknadno promijenjene.');
    }
    await trx('app_user_brand_access').where({ brand_id: BRAND_SPEC.id }).delete();
    await trx('crm_mail_automation_settings').where({ brand_id: BRAND_SPEC.id }).delete();
    await trx('crm_accounts').where({ brand_id: BRAND_SPEC.id }).delete();
    await trx('crm_brands').where({ id: BRAND_SPEC.id }).delete();
  });
};

exports.BAHRAIN_BODY = BAHRAIN_BODY;
exports.BRAND_SPEC = BRAND_SPEC;
exports.ENGLISH_COMMUNICATION_SENTENCE = ENGLISH_COMMUNICATION_SENTENCE;
exports.MAIL_SUBJECT = MAIL_SUBJECT;
exports.MIGRATION_ACTOR = MIGRATION_ACTOR;
exports.MIGRATION_ID = MIGRATION_ID;
exports.accountRows = accountRows;
exports.additionalEmails = additionalEmails;
exports.priorityFor = priorityFor;
exports.statusFor = statusFor;
exports.validateSeed = validateSeed;
