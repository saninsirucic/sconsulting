const { v4: uuidv4 } = require('uuid');
const seed = require('../data/sanPestSaudiUae20260901.json');

const MIGRATION_ID = '20260901120000_create_san_pest_saudi_uae_brands';
const MIGRATION_ACTOR = 'migration-sanpest-gulf-20260901';
const SOURCE_BRAND_CODE = 'SAN_PEST';
const ENGLISH_COMMUNICATION_SENTENCE = 'For any further communication, we would be happy to continue in English.';
const MAIL_SUBJECT = 'A smarter way to manage pest control operations – {{KOMITENT}}';

const SAUDI_BODY = `Dear {{KOMITENT}} team,

I am contacting you on behalf of S-Consulting Group to introduce SANpest, a digital platform developed specifically for pest control companies.

SANpest brings your day-to-day operations into one system, including:
• customer, site and contract records
• treatment planning and team scheduling
• mobile work orders with QR and GPS verification
• chemical, stock and equipment records
• service certificates, reports, invoicing and payment tracking

For pest control companies in Saudi Arabia, SANpest can support multi-branch and multi-team operations, with operational documents available in both Arabic and English.

We would be pleased to arrange a brief 15–20 minute online presentation tailored to {{KOMITENT}}. We can show you the platform and discuss how it could support your current workflow.

The presentation is free of charge and without obligation.

${ENGLISH_COMMUNICATION_SENTENCE}`;

const UAE_BODY = `Dear {{KOMITENT}} team,

I am contacting you on behalf of S-Consulting Group to introduce SANpest, a digital platform developed specifically for pest control companies.

SANpest brings your day-to-day operations into one system, including:
• customer, site and AMC contract records
• treatment planning and team scheduling
• mobile work orders with QR and GPS verification
• chemical, stock and equipment records
• service certificates, reports, invoicing and payment tracking

For pest control companies in the UAE, SANpest can support AMC-based service delivery, multi-site contracts and multiple field teams, with clear digital documentation for customers, technicians and management.

We would be pleased to arrange a brief 15–20 minute online presentation tailored to {{KOMITENT}}. We can show you the platform and discuss how it could support your current workflow.

The presentation is free of charge and without obligation.

${ENGLISH_COMMUNICATION_SENTENCE}`;

const BRAND_SPECS = Object.freeze([
  Object.freeze({
    id: 'brand-san-pest-saudi',
    code: 'SAN_PEST_SAUDI',
    slug: 'san-pest-saudijska-arabija',
    name: 'SAN Pest Saudijska Arabija',
    market: 'Saudijska Arabija',
    country: 'Saudijska Arabija',
    currency: 'SAR',
    accountPrefix: 'san-pest-sa',
    expectedCount: 100,
    subject: MAIL_SUBJECT,
    body: SAUDI_BODY
  }),
  Object.freeze({
    id: 'brand-san-pest-uae',
    code: 'SAN_PEST_UAE',
    slug: 'san-pest-uae',
    name: 'SAN Pest UAE',
    market: 'UAE',
    country: 'UAE',
    currency: 'AED',
    accountPrefix: 'san-pest-uae',
    expectedCount: 100,
    subject: MAIL_SUBJECT,
    body: UAE_BODY
  })
]);

function chunks(rows, size = 50) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

function sourceBrand(spec) {
  return seed.brands.find((brand) => brand.code === spec.code);
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
  if (seed.source.fileName !== 'SANpest_TOP100_UAE_TOP100_Saudija.xlsx'
    || seed.source.sha256 !== 'A9E5565573D191CBDA47F85B2194125590F06B9A729A9B129FED0B335016D497'
    || seed.source.sheetName !== 'TOP 200'
    || seed.source.usedRange !== 'A1:Q204'
    || seed.source.dataRange !== 'A5:Q204'
    || Number(seed.source.importedRowCount) !== 200) {
    throw new Error('SAN Pest Gulf snapshot ne odgovara pregledanom Excel izvoru.');
  }

  for (const spec of BRAND_SPECS) {
    const brand = sourceBrand(spec);
    if (!brand || brand.market !== spec.market || Number(brand.rowCount) !== spec.expectedCount
      || !Array.isArray(brand.rows) || brand.rows.length !== spec.expectedCount) {
      throw new Error(`${spec.name} snapshot nema očekivanih ${spec.expectedCount} redova.`);
    }
    const ranks = new Set();
    for (const row of brand.rows) {
      if (!row.company || !Number.isInteger(row.marketRank) || row.marketRank < 1 || row.marketRank > 100
        || !['A', 'B', 'C'].includes(row.priority) || ranks.has(row.marketRank)) {
        throw new Error(`Neispravan ili dupliran red u ${spec.name} snapshotu.`);
      }
      ranks.add(row.marketRank);
      if (row.email && !validEmail(row.email)) throw new Error(`Neispravan email u ${spec.name}, rang ${row.marketRank}.`);
      if (additionalEmails(row).some((email) => !validEmail(email))) {
        throw new Error(`Neispravan dodatni email u ${spec.name}, rang ${row.marketRank}.`);
      }
    }
  }
  return true;
}

function priorityFor(row) {
  if (row.priority === 'A') return 'HIGH';
  if (row.priority === 'B') return 'MEDIUM';
  return 'LOW';
}

function statusFor(row) {
  const recommendation = String(row.sendNow || '').toLowerCase();
  if (recommendation.includes('whatsapp') && !recommendation.includes('email')) return 'CALL_REQUIRED';
  return 'NEW';
}

function accountNotes(row) {
  return [
    `Rang u tržištu: ${row.marketRank}/100`,
    row.fitScore === null || row.fitScore === undefined ? null : `SANpest fit: ${row.fitScore}/10`,
    row.priority ? `Prioritet izvora: ${row.priority}` : null,
    row.sendNow ? `Preporuka kontakta: ${row.sendNow}` : null,
    row.classification ? `Veličina / klasifikacija: ${row.classification}` : null,
    row.databaseStatus ? `Status u izvornoj bazi: ${row.databaseStatus}` : null,
    row.source ? `Izvor: ${row.source}` : null
  ].filter(Boolean).join('\n');
}

function rawContact(row) {
  return [
    row.contactPerson ? `Kontakt osoba: ${row.contactPerson}` : null,
    row.phone ? `Telefon / WhatsApp: ${row.phone}` : null,
    row.website ? `Web: ${row.website}` : null,
    row.city ? `Grad / područje: ${row.city}` : null,
    row.region ? `Regija / Emirat: ${row.region}` : null
  ].filter(Boolean).join('\n') || null;
}

function locationFor(row, spec) {
  return [...new Set([row.city, row.region, spec.country].filter(Boolean))].join(', ').slice(0, 250) || spec.country;
}

function accountRows(spec, now) {
  return sourceBrand(spec).rows.map((row) => ({
    id: `${spec.accountPrefix}-account-${String(row.marketRank).padStart(3, '0')}`,
    brand_id: spec.id,
    source_key: `${spec.code}:20260901:${row.marketRank}`,
    source_row_number: row.sourceRow,
    company_name: row.company.slice(0, 300),
    record_type: 'DDD firma',
    branch_count: null,
    unit_amount: null,
    total_amount: null,
    profit_amount: null,
    currency: spec.currency,
    contact_person: row.contactPerson ? row.contactPerson.slice(0, 250) : null,
    email: row.email,
    cc_emails_json: JSON.stringify(additionalEmails(row)),
    phone: row.phone ? row.phone.slice(0, 100) : null,
    website: row.website ? row.website.slice(0, 500) : null,
    location: locationFor(row, spec),
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

async function ensureBrand(trx, spec, now) {
  const [byCode, byId, bySlug] = await Promise.all([
    trx('crm_brands').where({ code: spec.code }).first(),
    trx('crm_brands').where({ id: spec.id }).first(),
    trx('crm_brands').where({ slug: spec.slug }).first()
  ]);
  if (!byCode) {
    if (byId || bySlug) throw new Error(`ID ili slug za ${spec.name} već koristi drugi brend.`);
    await trx('crm_brands').insert({
      id: spec.id,
      code: spec.code,
      slug: spec.slug,
      name: spec.name,
      daily_limit: 30,
      active: true,
      created_at: now,
      updated_at: now
    });
    return;
  }
  if (byCode.id !== spec.id || byCode.slug !== spec.slug) {
    throw new Error(`Postojeći ${spec.name} brend nema očekivani ID i slug.`);
  }
}

async function ensureSettings(trx, spec, now) {
  await trx('crm_mail_automation_settings').insert({
    brand_id: spec.id,
    enabled: false,
    paused: true,
    auto_send: false,
    daily_limit: 30,
    workdays_json: JSON.stringify([1, 2, 3, 4, 5]),
    send_window_start: '09:00',
    send_window_end: '15:00',
    send_interval_minutes: 5,
    follow_up_days: 7,
    subject: spec.subject,
    body_text: spec.body,
    report_enabled: true,
    report_time: '16:00',
    report_recipient: 'info@s-consulting.ba',
    updated_by: MIGRATION_ACTOR,
    created_at: now,
    updated_at: now
  }).onConflict('brand_id').ignore();
}

async function cloneAccess(trx, sourceBrandId, spec, now) {
  const accessRows = await trx('app_user_brand_access').where({ brand_id: sourceBrandId })
    .select('user_id', 'can_read', 'can_write');
  for (const batch of chunks(accessRows)) {
    await trx('app_user_brand_access').insert(batch.map((row) => ({
      id: uuidv4(),
      user_id: row.user_id,
      brand_id: spec.id,
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
    if (!await knex.schema.hasTable(table)) throw new Error(`Nedostaje obavezna tabela ${table} za SAN Pest Gulf migraciju.`);
  }
  if (!await knex.schema.hasColumn('crm_accounts', 'cc_emails_json')) {
    throw new Error('Nedostaje crm_accounts.cc_emails_json za dodatne primaoce.');
  }

  await knex.transaction(async (trx) => {
    const now = new Date();
    const source = await trx('crm_brands').where({ code: SOURCE_BRAND_CODE }).first();
    if (!source) throw new Error('Izvorni SAN Pest brend nije pronađen.');
    for (const spec of BRAND_SPECS) {
      await ensureBrand(trx, spec, now);
      await ensureSettings(trx, spec, now);
      await cloneAccess(trx, source.id, spec, now);
      for (const batch of chunks(accountRows(spec, now))) {
        await trx('crm_accounts').insert(batch).onConflict(['brand_id', 'source_key']).ignore();
      }
      const count = await trx('crm_accounts').where({ brand_id: spec.id }).count({ count: '*' }).first();
      if (Number(count.count) !== spec.expectedCount) {
        throw new Error(`${spec.name} mora nakon uvoza sadržavati tačno ${spec.expectedCount} zapisa.`);
      }
    }
  });
};

exports.down = async function down(knex) {
  await knex.transaction(async (trx) => {
    for (const spec of [...BRAND_SPECS].reverse()) {
      const brand = await trx('crm_brands').where({ code: spec.code }).first();
      if (!brand) continue;
      if (brand.id !== spec.id || brand.slug !== spec.slug) {
        throw new Error(`Rollback je zaustavljen zbog neočekivanog identiteta brenda ${spec.name}.`);
      }
      const accounts = await trx('crm_accounts').where({ brand_id: spec.id }).select('source_key');
      if (accounts.length !== spec.expectedCount
        || accounts.some((row) => !row.source_key.startsWith(`${spec.code}:20260901:`))) {
        throw new Error(`Rollback je zaustavljen jer ${spec.name} više nema samo izvorne zapise.`);
      }
      for (const table of [
        'crm_mail_queue', 'crm_daily_assignments', 'crm_activities', 'crm_mail_attachments',
        'crm_mail_daily_reports', 'crm_calendar_meetings'
      ]) {
        if (!await trx.schema.hasTable(table)) continue;
        const count = await trx(table).where({ brand_id: spec.id }).count({ count: '*' }).first();
        if (Number(count.count) > 0) throw new Error(`Rollback je zaustavljen jer ${table} sadrži podatke za ${spec.name}.`);
      }
      const settings = await trx('crm_mail_automation_settings').where({ brand_id: spec.id }).first();
      if (settings && settings.updated_by !== MIGRATION_ACTOR) {
        throw new Error(`Rollback je zaustavljen jer su mail postavke za ${spec.name} naknadno promijenjene.`);
      }
      await trx('app_user_brand_access').where({ brand_id: spec.id }).delete();
      await trx('crm_mail_automation_settings').where({ brand_id: spec.id }).delete();
      await trx('crm_accounts').where({ brand_id: spec.id }).delete();
      await trx('crm_brands').where({ id: spec.id }).delete();
    }
  });
};

exports.BRAND_SPECS = BRAND_SPECS;
exports.ENGLISH_COMMUNICATION_SENTENCE = ENGLISH_COMMUNICATION_SENTENCE;
exports.MIGRATION_ACTOR = MIGRATION_ACTOR;
exports.MIGRATION_ID = MIGRATION_ID;
exports.MAIL_SUBJECT = MAIL_SUBJECT;
exports.SAUDI_BODY = SAUDI_BODY;
exports.UAE_BODY = UAE_BODY;
exports.accountRows = accountRows;
exports.additionalEmails = additionalEmails;
exports.priorityFor = priorityFor;
exports.statusFor = statusFor;
exports.validateSeed = validateSeed;
