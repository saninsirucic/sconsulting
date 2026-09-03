const { v4: uuidv4 } = require('uuid');
const seed = require('../data/sanPestGermany20260903.json');

const MIGRATION_ID = '20260903160000_create_san_pest_germany_brand';
const MIGRATION_ACTOR = 'migration-sanpest-germany-20260903';
const SOURCE_BRAND_CODE = 'SAN_PEST';
const TARGET_BRAND = Object.freeze({
  id: 'brand-san-pest-germany',
  code: 'SAN_PEST_GERMANY',
  slug: 'san-pest-njemacka',
  name: 'SAN Pest Njemačka'
});
const EXPECTED_ACCOUNT_COUNT = 255;
const GERMAN_PAGE_URL = 'https://www.s-consulting.ba/de/sanpest-plattform';
const MAIL_SUBJECT = 'Digitale Abläufe für die Schädlingsbekämpfung mit SANpest – {{KOMITENT}}';
const MAIL_BODY = `Sehr geehrte Damen und Herren,

ich wende mich im Namen der S-Consulting Group an Sie, um Ihnen SANpest vorzustellen – eine digitale Plattform, die speziell für Schädlingsbekämpfungsunternehmen entwickelt wurde.

SANpest verbindet die zentralen Arbeitsabläufe Ihres Unternehmens in einem System:
• zentrale Verwaltung von Kunden, Objekten und Filialen
• Behandlungsplanung und Einsatzplanung der Außendienstteams
• digitale Arbeitsaufträge mit QR- und GPS-Nachweis
• digitale Behandlungsnachweise, Berichte und PDF-Versand
• Übersicht über Lagerbestand und Materialverbrauch

Das Ziel ist klar: weniger manueller Verwaltungsaufwand, transparente Außendiensteinsätze und eine lückenlose Dokumentation für Ihre Kunden und Ihr Team.

Gerne präsentieren wir Ihnen SANpest in einer unverbindlichen Online-Demonstration von 15–20 Minuten und besprechen, wie die Plattform die Arbeitsabläufe von {{KOMITENT}} unterstützen kann.

Weitere Informationen finden Sie auf unserer deutschsprachigen Seite:
${GERMAN_PAGE_URL}`;

function chunks(rows, size = 50) {
  const result = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

function sourceBrand() {
  return seed.brands.find((brand) => brand.code === TARGET_BRAND.code);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || ''));
}

function additionalEmails(row) {
  const primary = String(row.email || '').trim().toLowerCase();
  return [...new Set((Array.isArray(row.additionalEmails) ? row.additionalEmails : [])
    .map((email) => String(email || '').trim().toLowerCase())
    .filter((email) => email && email !== primary))];
}

function validateSeed() {
  const brand = sourceBrand();
  if (!seed?.source
    || seed.source.fileName !== 'SANpest_Njemacka_DDD_baza_2026.xlsx'
    || seed.source.sha256 !== '43F1B1341E934B96E8267BF3F861C4287B7D4DBD0F51A20AA681B74187E90D58'
    || seed.source.sheetName !== 'NJEMAČKA'
    || seed.source.usedRange !== 'A1:S259'
    || seed.source.dataRange !== 'A5:S259'
    || Number(seed.source.importedRowCount) !== EXPECTED_ACCOUNT_COUNT
    || !brand
    || brand.market !== 'Deutschland'
    || brand.country !== 'Deutschland'
    || brand.sheetName !== 'NJEMAČKA'
    || brand.usedRange !== 'A1:S259'
    || Number(brand.rowCount) !== EXPECTED_ACCOUNT_COUNT
    || !Array.isArray(brand.rows)
    || brand.rows.length !== EXPECTED_ACCOUNT_COUNT) {
    throw new Error('SAN Pest Njemačka seed nema očekivani Excel izvor i strukturu.');
  }

  const primaryEmails = new Set();
  brand.rows.forEach((row, index) => {
    if (!row || row.nr !== index + 1 || !String(row.company || '').trim()) {
      throw new Error(`Neispravan SAN Pest Njemačka zapis na poziciji ${index + 1}.`);
    }
    if (!['A', 'B', 'C'].includes(row.priority)) {
      throw new Error(`Nepodržan prioritet ${row.priority} za SAN Pest Njemačka:${row.nr}.`);
    }
    if (row.email) {
      if (!validEmail(row.email) || primaryEmails.has(row.email)) {
        throw new Error(`Neispravan ili dupli glavni email za SAN Pest Njemačka:${row.nr}.`);
      }
      primaryEmails.add(row.email);
    }
    const extra = additionalEmails(row);
    if (extra.some((email) => !validEmail(email)) || new Set(extra).size !== extra.length) {
      throw new Error(`Neispravan dodatni email za SAN Pest Njemačka:${row.nr}.`);
    }
  });
  return true;
}

function priorityFor(row) {
  if (row.priority === 'A') return 'HIGH';
  if (row.priority === 'B') return 'MEDIUM';
  return 'LOW';
}

function statusFor(row) {
  return /TELEFON|WEB/i.test(String(row.sendNow || '')) ? 'CALL_REQUIRED' : 'NEW';
}

function accountNotes(row) {
  return [
    row.fitScore === null || row.fitScore === undefined ? null : `SANpest-Fit: ${row.fitScore}/10`,
    row.priority ? `Quellenpriorität: ${row.priority}` : null,
    row.sendNow ? `Kontaktempfehlung: ${row.sendNow}` : null,
    row.databaseStatus ? `Status in der Quelldatenbank: ${row.databaseStatus}` : null,
    row.certificateSignal ? `Zertifikat / Signal: ${row.certificateSignal}` : null,
    row.softwareSignal ? `Bestehende Software / Signal: ${row.softwareSignal}` : null
  ].filter(Boolean).join('\n') || null;
}

function rawContact(row) {
  return [
    row.contactPerson ? `Ansprechperson: ${row.contactPerson}` : null,
    row.phone ? `Telefon: ${row.phone}` : null,
    row.website ? `Webseite: ${row.website}` : null,
    row.city ? `Ort / Gebiet: ${row.city}` : null,
    row.region ? `Bundesland: ${row.region}` : null
  ].filter(Boolean).join('\n') || null;
}

function locationFor(row) {
  return [...new Set([row.city, row.region, 'Deutschland'].filter(Boolean))]
    .join(', ').slice(0, 250) || 'Deutschland';
}

function accountRows(now) {
  return sourceBrand().rows.map((row) => ({
    id: `san-pest-de-account-${String(row.nr).padStart(3, '0')}`,
    brand_id: TARGET_BRAND.id,
    source_key: `${TARGET_BRAND.code}:20260903:${row.nr}`,
    source_row_number: row.nr,
    company_name: row.company.slice(0, 300),
    record_type: 'Schädlingsbekämpfungsbetrieb',
    branch_count: null,
    unit_amount: null,
    total_amount: null,
    profit_amount: null,
    currency: 'EUR',
    contact_person: row.contactPerson,
    email: row.email,
    cc_emails_json: JSON.stringify(additionalEmails(row)),
    phone: row.phone ? row.phone.slice(0, 100) : null,
    website: row.website,
    location: locationFor(row),
    status: statusFor(row),
    priority: priorityFor(row),
    comment: row.salesAngle,
    notes: accountNotes(row),
    raw_mail: [row.email, ...additionalEmails(row)].filter(Boolean).join('\n') || null,
    raw_contact: rawContact(row),
    source_data_json: JSON.stringify({
      ...row.original,
      _source_file: seed.source.fileName,
      _source_sheet: seed.source.sheetName,
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
    trx('crm_brands').where({ code: TARGET_BRAND.code }).first(),
    trx('crm_brands').where({ id: TARGET_BRAND.id }).first(),
    trx('crm_brands').where({ slug: TARGET_BRAND.slug }).first()
  ]);
  if (!byCode) {
    if (byId || bySlug) throw new Error('ID ili slug za SAN Pest Njemačka već koristi drugi brend.');
    await trx('crm_brands').insert({
      ...TARGET_BRAND,
      daily_limit: 30,
      active: true,
      created_at: now,
      updated_at: now
    });
    return;
  }
  if (byCode.id !== TARGET_BRAND.id || byCode.slug !== TARGET_BRAND.slug) {
    throw new Error('Postojeći SAN Pest Njemačka brend nema očekivani ID i slug.');
  }
}

async function ensureSettings(trx, now) {
  await trx('crm_mail_automation_settings').insert({
    brand_id: TARGET_BRAND.id,
    enabled: false,
    paused: true,
    auto_send: false,
    daily_limit: 30,
    workdays_json: JSON.stringify([1, 2, 3, 4, 5]),
    send_window_start: '09:00',
    send_window_end: '15:00',
    send_interval_minutes: 5,
    follow_up_days: 7,
    subject: MAIL_SUBJECT,
    body_text: MAIL_BODY,
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
  for (const batch of chunks(accessRows, 100)) {
    await trx('app_user_brand_access').insert(batch.map((row) => ({
      id: uuidv4(),
      user_id: row.user_id,
      brand_id: TARGET_BRAND.id,
      can_read: row.can_read,
      can_write: row.can_write,
      created_at: now,
      updated_at: now
    }))).onConflict(['user_id', 'brand_id']).ignore();
  }
}

exports.up = async function up(knex) {
  validateSeed();
  for (const table of [
    'crm_brands', 'crm_accounts', 'app_user_brand_access', 'crm_mail_automation_settings'
  ]) {
    if (!await knex.schema.hasTable(table)) {
      throw new Error(`Nedostaje obavezna tabela ${table} za SAN Pest Njemačka migraciju.`);
    }
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
    const count = await trx('crm_accounts').where({ brand_id: TARGET_BRAND.id })
      .count({ count: '*' }).first();
    if (Number(count.count) !== EXPECTED_ACCOUNT_COUNT) {
      throw new Error(`SAN Pest Njemačka mora nakon uvoza sadržavati tačno ${EXPECTED_ACCOUNT_COUNT} zapisa.`);
    }
  });
};

exports.down = async function down(knex) {
  await knex.transaction(async (trx) => {
    const brand = await trx('crm_brands').where({ code: TARGET_BRAND.code }).first();
    if (!brand) return;
    if (brand.id !== TARGET_BRAND.id || brand.slug !== TARGET_BRAND.slug) {
      throw new Error('Rollback je zaustavljen zbog neočekivanog identiteta brenda SAN Pest Njemačka.');
    }
    const accounts = await trx('crm_accounts').where({ brand_id: TARGET_BRAND.id }).select('source_key');
    if (accounts.length !== EXPECTED_ACCOUNT_COUNT
      || accounts.some((row) => !row.source_key.startsWith(`${TARGET_BRAND.code}:20260903:`))) {
      throw new Error('Rollback je zaustavljen jer SAN Pest Njemačka više nema samo izvorne zapise.');
    }
    for (const table of [
      'crm_mail_queue', 'crm_daily_assignments', 'crm_activities', 'crm_mail_attachments',
      'crm_mail_daily_reports', 'crm_calendar_meetings'
    ]) {
      if (await trx.schema.hasTable(table)) {
        const count = await trx(table).where({ brand_id: TARGET_BRAND.id }).count({ count: '*' }).first();
        if (Number(count.count) > 0) {
          throw new Error(`Rollback je zaustavljen jer ${table} sadrži podatke za SAN Pest Njemačka.`);
        }
      }
    }
    const settings = await trx('crm_mail_automation_settings').where({ brand_id: TARGET_BRAND.id }).first();
    if (settings && settings.updated_by !== MIGRATION_ACTOR) {
      throw new Error('Rollback je zaustavljen jer su mail postavke za SAN Pest Njemačka naknadno promijenjene.');
    }
    await trx('app_user_brand_access').where({ brand_id: TARGET_BRAND.id }).delete();
    await trx('crm_mail_automation_settings').where({ brand_id: TARGET_BRAND.id }).delete();
    await trx('crm_accounts').where({ brand_id: TARGET_BRAND.id }).delete();
    await trx('crm_brands').where({ id: TARGET_BRAND.id }).delete();
  });
};

exports.EXPECTED_ACCOUNT_COUNT = EXPECTED_ACCOUNT_COUNT;
exports.GERMAN_PAGE_URL = GERMAN_PAGE_URL;
exports.MAIL_BODY = MAIL_BODY;
exports.MAIL_SUBJECT = MAIL_SUBJECT;
exports.MIGRATION_ACTOR = MIGRATION_ACTOR;
exports.MIGRATION_ID = MIGRATION_ID;
exports.TARGET_BRAND = TARGET_BRAND;
exports.accountRows = accountRows;
exports.additionalEmails = additionalEmails;
exports.priorityFor = priorityFor;
exports.statusFor = statusFor;
exports.validateSeed = validateSeed;
