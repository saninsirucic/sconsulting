const { v4: uuidv4 } = require('uuid');
const seed = require('../data/sanPestAustria20260908.json');

const ACTOR = 'migration-sanpest-at-20260908';
const TARGET = { id: 'brand-san-pest-austria', code: 'SAN_PEST_AUSTRIA', slug: 'san-pest-austrija', name: 'SAN Pest Austrija' };
const PHONE_HEADER = 'Telefon iz ranije baze - nije ponovo sistematski provjeren';
const text = (value) => String(value || '').trim() || null;
const hasValue = (value) => Boolean(text(value)) && !/^(N\/J|N\/A|nije poznato)$/i.test(text(value));

function validateSeed() {
  if (seed.source.fileName !== 'SANpest_Austrija_128_kontakti_08-09-2026.csv'
    || seed.source.sha256 !== 'ec4ad49652faa7e720596c955fe771f43439f61dfc6beb24c9300dd48fb3cbb6'
    || seed.source.rowCount !== 128 || seed.rows.length !== 128) throw new Error('Neočekivani austrijski CSV izvor.');
  const names = new Set();
  for (const [index, row] of seed.rows.entries()) {
    const name = text(row.Firma);
    const email = text(row['Javno objavljen email']);
    if (Number(row.ID) !== index + 1 || !name || names.has(name.toLowerCase())) throw new Error('Neispravan ili dupli austrijski zapis.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new Error(`Neispravan email u redu ${row.ID}.`);
    if (!['A1', 'A2', 'B', 'C', 'STRATEGIC', 'PARTNER'].includes(row['Raniji prioritet'])) throw new Error('Nepoznat prioritet.');
    names.add(name.toLowerCase());
  }
  return true;
}

function accountRows(now) {
  return seed.rows.map((row) => {
    const email = text(row['Javno objavljen email'])?.toLowerCase() || null;
    const phone = hasValue(row[PHONE_HEADER]) ? text(row[PHONE_HEADER]) : null;
    const location = [...new Set([row['Grad/regija iz ranije baze'], row['Pokrajina iz ranije baze'], 'Österreich'].filter(Boolean))].join(', ');
    const notes = [
      `Status provjere: ${row['Status provjere']}`,
      `Datum provjere: ${row['Datum provjere']}`,
      `Izvorni prioritet: ${row['Raniji prioritet']}`,
      phone ? 'Telefon iz ranije baze; nije ponovo sistematski provjeren.' : null,
      row['Izvor URL'] ? `Izvor: ${row['Izvor URL']}` : null,
      row['Dodatni izvor URL'] ? `Dodatni izvor: ${row['Dodatni izvor URL']}` : null
    ].filter(Boolean).join('\n');
    const sourceUrl = text(row['Izvor URL']);
    let website = null;
    if (sourceUrl) {
      const parsed = new URL(sourceUrl);
      // Directory URLs remain provenance, not the company's own website.
      if (!/(^|\.)(wko\.at|herold\.at|firmenabc\.at)$/.test(parsed.hostname)) website = sourceUrl;
    }
    if (phone?.length > 100 || location.length > 250 || row.Firma.length > 300) throw new Error(`Predug podatak u redu ${row.ID}.`);
    return {
      id: `san-pest-at-account-${String(row.ID).padStart(3, '0')}`,
      brand_id: TARGET.id, source_key: `SAN_PEST_AUSTRIA:20260908:${row.ID}`, source_row_number: Number(row.ID),
      company_name: text(row.Firma), record_type: 'Schädlingsbekämpfung / poslovni kontakt', currency: 'EUR',
      email, cc_emails_json: '[]', phone, website, location,
      status: email ? 'NEW' : 'CALL_REQUIRED',
      priority: /^A/.test(row['Raniji prioritet']) ? 'HIGH' : row['Raniji prioritet'] === 'B' ? 'MEDIUM' : 'LOW',
      comment: text(row.Napomena), notes, raw_mail: email,
      raw_contact: [phone ? `Telefon: ${phone}` : null, `Lokacija: ${location}`].filter(Boolean).join('\n'),
      source_data_json: JSON.stringify({ ...row, _source_file: seed.source.fileName, _source_sha256: seed.source.sha256 }),
      created_by: ACTOR, updated_by: ACTOR, created_at: now, updated_at: now
    };
  });
}

exports.up = async function up(knex) {
  validateSeed();
  await knex.transaction(async (trx) => {
    const germany = await trx('crm_brands').where({ code: 'SAN_PEST_GERMANY' }).first();
    const poland = await trx('crm_brands').where({ code: 'SAN_PEST_POLAND' }).first();
    const germanSettings = germany && await trx('crm_mail_automation_settings').where({ brand_id: germany.id }).first();
    if (!germany || !poland || !germanSettings?.subject || !germanSettings?.body_text) throw new Error('Nedostaje postojeća njemačka kampanja ili Poljska.');
    const existing = await trx('crm_brands').where({ code: TARGET.code }).first();
    if (existing && (existing.id !== TARGET.id || existing.slug !== TARGET.slug)) throw new Error('Austrija već postoji pod drugim identitetom.');
    const now = new Date();
    await trx('crm_brands').insert({ ...TARGET, daily_limit: 30, active: true, created_at: now, updated_at: now }).onConflict('code').ignore();
    const existingAccounts = await trx('crm_accounts').where({ brand_id: TARGET.id }).select('source_key');
    const importedKeys = new Set(accountRows(now).map((row) => row.source_key));
    if (existingAccounts.some((row) => !importedKeys.has(row.source_key))) throw new Error('Austrija već sadrži druge podatke; potreban je zaseban pregled duplikata.');
    for (let i = 0, rows = accountRows(now); i < rows.length; i += 20) {
      await trx('crm_accounts').insert(rows.slice(i, i + 20)).onConflict(['brand_id', 'source_key']).ignore();
    }
    if (Number((await trx('crm_accounts').where({ brand_id: TARGET.id }).count({ count: '*' }).first()).count) !== 128) throw new Error('Austrija nema svih 128 kontakata.');
    const access = await trx('app_user_brand_access').where({ brand_id: germany.id });
    for (const row of access) {
      await trx('app_user_brand_access').insert({ id: uuidv4(), user_id: row.user_id, brand_id: TARGET.id, can_read: row.can_read, can_write: row.can_write, created_at: now, updated_at: now }).onConflict(['user_id', 'brand_id']).ignore();
    }
    if (!await trx('crm_mail_automation_settings').where({ brand_id: TARGET.id }).first()) {
      const settings = {};
      for (const key of ['daily_limit', 'workdays_json', 'send_window_start', 'send_window_end', 'send_interval_minutes', 'follow_up_days', 'subject', 'body_text', 'report_enabled', 'report_time', 'report_recipient']) settings[key] = germanSettings[key];
      let attachmentId = null;
      if (germanSettings.attachment_id) {
        const attachment = await trx('crm_mail_attachments').where({ id: germanSettings.attachment_id, brand_id: germany.id }).first();
        if (!attachment) throw new Error('Njemački prilog nije pronađen.');
        attachmentId = uuidv4();
        await trx('crm_mail_attachments').insert({ ...attachment, id: attachmentId, brand_id: TARGET.id, created_at: now });
      }
      await trx('crm_mail_automation_settings').insert({ ...settings, brand_id: TARGET.id, enabled: false, paused: true, auto_send: false, attachment_id: attachmentId, created_at: now, updated_at: now, updated_by: ACTOR });
    }
    await trx('crm_brands').where({ id: poland.id, active: true }).update({ active: false, updated_at: now });
  });
};

exports.down = async function down(knex) {
  await knex.transaction(async (trx) => {
    const brand = await trx('crm_brands').where({ code: TARGET.code }).first();
    if (!brand) return;
    const accounts = await trx('crm_accounts').where({ brand_id: TARGET.id });
    const settings = await trx('crm_mail_automation_settings').where({ brand_id: TARGET.id }).first();
    if (brand.id !== TARGET.id || accounts.length !== 128 || accounts.some((row) => row.updated_by !== ACTOR || row.last_contact_at || row.archived_at) || settings?.updated_by !== ACTOR) throw new Error('Austrija je naknadno mijenjana; automatski povrat nije dozvoljen.');
    for (const table of ['crm_mail_queue', 'crm_activities', 'crm_daily_assignments', 'crm_calendar_meetings', 'crm_mail_daily_reports']) {
      if (await trx.schema.hasTable(table) && await trx(table).where({ brand_id: TARGET.id }).first()) throw new Error('Austrija ima historiju; automatski povrat nije dozvoljen.');
    }
    for (const table of ['app_user_brand_access', 'crm_mail_automation_settings', 'crm_mail_attachments', 'crm_accounts']) await trx(table).where({ brand_id: TARGET.id }).delete();
    await trx('crm_brands').where({ id: TARGET.id }).delete();
    await trx('crm_brands').where({ code: 'SAN_PEST_POLAND' }).update({ active: true, updated_at: new Date() });
  });
};

exports.TARGET = TARGET;
exports.validateSeed = validateSeed;
exports.accountRows = accountRows;
