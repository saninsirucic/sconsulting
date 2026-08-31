const { v4: uuidv4 } = require('uuid');
const seed = require('../data/sanPestPolandCzech20260831.json');

const MIGRATION_ID = '20260831170000_create_san_pest_poland_czech_brands';
const MIGRATION_ACTOR = 'migration:20260831170000';
const SOURCE_BRAND_CODE = 'SAN_PEST';
const ENGLISH_COMMUNICATION_SENTENCE = 'For any further communication, we would be happy to continue in English.';

const BRAND_SPECS = Object.freeze([
  Object.freeze({
    id: 'brand-san-pest-poland',
    code: 'SAN_PEST_POLAND',
    slug: 'san-pest-poljska',
    name: 'SAN Pest Poljska',
    country: 'Poljska',
    sheetName: 'POLJSKA',
    expectedCount: 158,
    subject: 'Cyfryzacja firmy DDD z platformą SANpest – {{KOMITENT}}',
    body: `Dzień dobry,

kontaktujemy się w imieniu S-Consulting Group w sprawie platformy SANpest — nowoczesnego rozwiązania cyfrowego stworzonego specjalnie dla firm zajmujących się dezynfekcją, dezynsekcją i deratyzacją.

Platforma SANpest pozwala zarządzać całą działalnością DDD w jednym systemie: bazą klientów i obiektów, harmonogramem zabiegów i zespołów, cyfrowymi zleceniami, potwierdzeniami z kodem QR, ewidencją pracy w terenie, magazynem, raportami oraz procesem fakturowania.

Celem jest ograniczenie administracji, lepsza kontrola pracy terenowej i bardziej profesjonalna obsługa klientów.

Jeżeli temat jest dla Państwa aktualny, chętnie zaproponujemy krótkie, niezobowiązujące spotkanie online trwające 15–20 minut, podczas którego pokażemy platformę w praktyce i omówimy jej dopasowanie do modelu pracy {{KOMITENT}}.

Więcej informacji:
https://www.s-consulting.ba/sanpest-platform

${ENGLISH_COMMUNICATION_SENTENCE}`
  }),
  Object.freeze({
    id: 'brand-san-pest-czech',
    code: 'SAN_PEST_CZECH',
    slug: 'san-pest-ceska',
    name: 'SAN Pest Češka',
    country: 'Češka',
    sheetName: 'ČEŠKA',
    expectedCount: 177,
    subject: 'Digitalizace provozu DDD s platformou SANpest – {{KOMITENT}}',
    body: `Dobrý den,

obracíme se na Vás jménem S-Consulting Group v souvislosti s platformou SANpest — moderním digitálním řešením vytvořeným speciálně pro společnosti působící v oblasti dezinfekce, dezinsekce a deratizace.

Platforma SANpest umožňuje řídit celý provoz DDD v jednom systému: evidenci klientů a objektů, plánování zásahů a týmů, digitální pracovní příkazy, potvrzení s QR kódem, evidenci práce v terénu, sklad, reporty i proces fakturace.

Cílem je omezit administrativu, zlepšit kontrolu terénních činností a poskytovat klientům profesionálnější služby.

Pokud je pro Vás toto téma aktuální, rádi navrhneme krátkou nezávaznou online schůzku v délce 15–20 minut, během níž platformu prakticky představíme a probereme její vhodnost pro způsob práce společnosti {{KOMITENT}}.

Více informací:
https://www.s-consulting.ba/sanpest-platform

${ENGLISH_COMMUNICATION_SENTENCE}`
  })
]);

function chunks(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function sourceBrand(spec) {
  return seed.brands.find((brand) => brand.code === spec.code);
}

function emailAddresses(value) {
  const matches = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(matches.map((email) => email.toLowerCase()))];
}

function additionalEmails(row) {
  return emailAddresses(row.additionalEmail).filter((email) => email !== row.email);
}

function validateSeed() {
  if (!seed || !seed.source || seed.source.fileName !== 'SANpest_Poljska_Ceska_DDD_baza_2026.xlsx') {
    throw new Error('SAN Pest Poljska/Češka seed nema očekivani Excel izvor.');
  }
  if (seed.source.sha256 !== '459294C66EB936396C18526D837148439B296FBB4ABCBD985B74A0438BCC7CAD') {
    throw new Error('SAN Pest Poljska/Češka seed nema očekivani SHA-256 izvora.');
  }
  if (Number(seed.source.importedRowCount) !== 335 || !Array.isArray(seed.brands)) {
    throw new Error('SAN Pest Poljska/Češka seed mora sadržavati tačno 335 zapisa.');
  }
  for (const spec of BRAND_SPECS) {
    const brand = sourceBrand(spec);
    if (!brand || brand.sheetName !== spec.sheetName || brand.country !== spec.country
      || brand.usedRange !== (spec.code === 'SAN_PEST_POLAND' ? 'A1:S162' : 'A1:S181')
      || brand.rowCount !== spec.expectedCount || !Array.isArray(brand.rows)
      || brand.rows.length !== spec.expectedCount) {
      throw new Error(`Seed za ${spec.name} nema očekivanu strukturu i broj redova.`);
    }
    const seen = new Set();
    brand.rows.forEach((row, index) => {
      if (!row || row.nr !== index + 1 || !row.company || seen.has(row.nr)) {
        throw new Error(`Neispravan ili dupli ${spec.name} zapis na poziciji ${index + 1}.`);
      }
      if (!['A', 'B', 'C', 'NE'].includes(row.priority)) {
        throw new Error(`Nepodržan prioritet ${row.priority} za ${spec.name}:${row.nr}.`);
      }
      if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(row.email)) {
        throw new Error(`Neispravan glavni email za ${spec.name}:${row.nr}.`);
      }
      if (row.additionalEmail && additionalEmails(row).length === 0) {
        throw new Error(`Dodatni email nije moguće pročitati za ${spec.name}:${row.nr}.`);
      }
      seen.add(row.nr);
    });
  }
  return true;
}

function priorityFor(row) {
  if (row.priority === 'A') return 'HIGH';
  if (row.priority === 'B') return 'MEDIUM';
  return 'LOW';
}

function statusFor(row) {
  const salesStatus = String(row.salesStatus || '').toLowerCase();
  if (/odbij|zamít|odmít/.test(salesStatus)) return 'REJECTED';
  if (/sastan|schůz|spotkan/.test(salesStatus)) return 'MEETING_SCHEDULED';
  if (/mail|email/.test(salesStatus) && !/nije|nebyl|nie/.test(salesStatus)) return 'EMAIL_SENT';
  if (/kontakt/.test(salesStatus) && !/nije|nebyl|nie/.test(salesStatus)) return 'CONTACTED';
  if (/zvati|telefon/.test(String(row.sendNow || '').toLowerCase())) return 'CALL_REQUIRED';
  return 'NEW';
}

function accountNotes(row) {
  return [
    row.fitScore === null || row.fitScore === undefined ? null : `SANpest fit: ${row.fitScore}/10`,
    row.priority ? `Prioritet izvora: ${row.priority}` : null,
    row.sendNow ? `Preporuka kontakta: ${row.sendNow}` : null,
    row.databaseStatus ? `Status u izvornoj bazi: ${row.databaseStatus}` : null,
    row.certificateSignal ? `Certifikat / signal: ${row.certificateSignal}` : null,
    row.softwareSignal ? `Postojeći software / signal: ${row.softwareSignal}` : null
  ].filter(Boolean).join('\n') || null;
}

function rawContact(row) {
  return [
    row.contactPerson ? `Kontakt osoba: ${row.contactPerson}` : null,
    row.phone ? `Telefon: ${row.phone}` : null,
    row.website ? `Web: ${row.website}` : null,
    row.city ? `Grad: ${row.city}` : null,
    row.region ? `Regija: ${row.region}` : null
  ].filter(Boolean).join('\n') || null;
}

function locationFor(row, spec) {
  return [...new Set([row.city, row.region, spec.country].filter(Boolean))].join(', ').slice(0, 250) || spec.country;
}

function accountRows(spec, now) {
  return sourceBrand(spec).rows.map((row) => ({
    id: `${spec.code === 'SAN_PEST_POLAND' ? 'san-pest-pl' : 'san-pest-cz'}-account-${String(row.nr).padStart(3, '0')}`,
    brand_id: spec.id,
    source_key: `${spec.code}:20260831:${row.nr}`,
    source_row_number: row.nr,
    company_name: row.company.slice(0, 300),
    record_type: 'DDD firma',
    branch_count: null,
    unit_amount: null,
    total_amount: null,
    profit_amount: null,
    currency: 'EUR',
    contact_person: row.contactPerson,
    email: row.email,
    cc_emails_json: JSON.stringify(additionalEmails(row)),
    // crm_accounts.phone is varchar(100). Keep the full spreadsheet value in
    // raw_contact/source_data_json and fit only the searchable display field.
    phone: row.phone ? row.phone.slice(0, 100) : null,
    website: row.website,
    location: locationFor(row, spec),
    status: statusFor(row),
    priority: priorityFor(row),
    comment: row.salesAngle,
    notes: accountNotes(row),
    raw_mail: [row.email, ...additionalEmails(row)].filter(Boolean).join('\n') || null,
    raw_contact: rawContact(row),
    source_data_json: JSON.stringify({
      ...row.original,
      _source_file: seed.source.fileName,
      _source_sheet: spec.sheetName,
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
  for (const table of [
    'crm_brands', 'crm_accounts', 'app_user_brand_access', 'crm_mail_automation_settings'
  ]) {
    if (!await knex.schema.hasTable(table)) {
      throw new Error(`Nedostaje obavezna tabela ${table} za SAN Pest Poljska/Češka migraciju.`);
    }
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
      const count = await trx('crm_accounts').where({ brand_id: spec.id })
        .count({ count: '*' }).first();
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
        || accounts.some((row) => !row.source_key.startsWith(`${spec.code}:20260831:`))) {
        throw new Error(`Rollback je zaustavljen jer ${spec.name} više nema samo izvorne zapise.`);
      }
      for (const table of [
        'crm_mail_queue', 'crm_daily_assignments', 'crm_activities', 'crm_mail_attachments',
        'crm_mail_daily_reports', 'crm_calendar_meetings'
      ]) {
        if (await trx.schema.hasTable(table)) {
          const count = await trx(table).where({ brand_id: spec.id }).count({ count: '*' }).first();
          if (Number(count.count) > 0) {
            throw new Error(`Rollback je zaustavljen jer ${table} sadrži podatke za ${spec.name}.`);
          }
        }
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
exports.accountRows = accountRows;
exports.additionalEmails = additionalEmails;
exports.priorityFor = priorityFor;
exports.statusFor = statusFor;
exports.validateSeed = validateSeed;
