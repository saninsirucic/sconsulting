const {
  MAIL_SUBJECT,
  SAUDI_BODY,
  UAE_BODY
} = require('./20260901120000_create_san_pest_saudi_uae_brands');

const MIGRATION_ACTOR = 'migration-sanpest-gulf-mail-20260901';
const BRAND_MAILS = Object.freeze([
  Object.freeze({ id: 'brand-san-pest-saudi', code: 'SAN_PEST_SAUDI', body: SAUDI_BODY }),
  Object.freeze({ id: 'brand-san-pest-uae', code: 'SAN_PEST_UAE', body: UAE_BODY })
]);

const PREVIOUS_SUBJECT = 'Digitise your pest control operations with SANpest – {{KOMITENT}}';
const PREVIOUS_SAUDI_BODY = `Dear {{KOMITENT}} team,

I am reaching out on behalf of S-Consulting Group regarding SANpest Platform, a digital operations system developed specifically for pest control companies.

SANpest brings the complete workflow into one place: customer and site records, contracts, treatment planning, team scheduling, mobile work orders, QR and GPS verification, chemical and stock records, service certificates, reports, invoicing and payment tracking.

For companies operating in Saudi Arabia, the platform can support multi-branch and multi-team operations as well as English and Arabic operational documents.

We would be pleased to arrange a short 15–20 minute online presentation and show how SANpest could fit your operating model. The presentation is informative and without obligation.

For any further communication, we would be happy to continue in English.`;
const PREVIOUS_UAE_BODY = `Dear {{KOMITENT}} team,

I am reaching out on behalf of S-Consulting Group regarding SANpest Platform, a digital operations system developed specifically for pest control companies.

SANpest brings the complete workflow into one place: customer and site records, AMC contracts, treatment planning, team scheduling, mobile work orders, QR and GPS verification, chemical and stock records, service certificates, reports, invoicing and payment tracking.

For companies operating in the UAE, the platform supports multi-site and multi-team operations with clear digital documentation for customers, technicians and management.

We would be pleased to arrange a short 15–20 minute online presentation and show how SANpest could fit your operating model. The presentation is informative and without obligation.

For any further communication, we would be happy to continue in English.`;

function renderTemplate(value, account) {
  return String(value || '')
    .replace(/\{\{\s*KOMITENT\s*\}\}/gi, account.company_name || '')
    .replace(/\{\s*KOMITENT\s*\}/gi, account.company_name || '');
}

async function updateUnsentQueue(trx, brand, subject, body, now) {
  if (!await trx.schema.hasTable('crm_mail_queue')) return;
  const rows = await trx({ q: 'crm_mail_queue' })
    .join({ a: 'crm_accounts' }, 'a.id', 'q.account_id')
    .where('q.brand_id', brand.id)
    .whereNotIn('q.status', ['SENDING', 'SENT'])
    .select('q.id', 'q.status', 'a.company_name');
  for (const row of rows) {
    await trx('crm_mail_queue').where({ id: row.id }).update({
      subject: renderTemplate(subject, row),
      body_text: renderTemplate(body, row),
      status: ['APPROVED', 'SCHEDULED'].includes(row.status) ? 'PENDING' : row.status,
      claim_token: null,
      claimed_at: null,
      last_error: null,
      updated_at: now
    });
  }
}

async function applyMailCopy(knex, mailDefinitions, subject, actor) {
  await knex.transaction(async (trx) => {
    const now = new Date();
    for (const definition of mailDefinitions) {
      const brand = await trx('crm_brands').where({ code: definition.code }).first();
      if (!brand || brand.id !== definition.id) {
        throw new Error(`SANpest mail migracija nije pronašla očekivani brend ${definition.code}.`);
      }
      const updated = await trx('crm_mail_automation_settings').where({ brand_id: brand.id }).update({
        subject,
        body_text: definition.body,
        enabled: false,
        paused: true,
        auto_send: false,
        updated_by: actor,
        updated_at: now
      });
      if (Number(updated) !== 1) throw new Error(`Nedostaju mail postavke za ${definition.code}.`);
      await updateUnsentQueue(trx, brand, subject, definition.body, now);
    }
  });
}

exports.up = async function up(knex) {
  await applyMailCopy(knex, BRAND_MAILS, MAIL_SUBJECT, MIGRATION_ACTOR);
};

exports.down = async function down(knex) {
  await applyMailCopy(knex, [
    { id: 'brand-san-pest-saudi', code: 'SAN_PEST_SAUDI', body: PREVIOUS_SAUDI_BODY },
    { id: 'brand-san-pest-uae', code: 'SAN_PEST_UAE', body: PREVIOUS_UAE_BODY }
  ], PREVIOUS_SUBJECT, 'migration-sanpest-gulf-20260901');
};

exports.BRAND_MAILS = BRAND_MAILS;
exports.MIGRATION_ACTOR = MIGRATION_ACTOR;
exports.PREVIOUS_SAUDI_BODY = PREVIOUS_SAUDI_BODY;
exports.PREVIOUS_SUBJECT = PREVIOUS_SUBJECT;
exports.PREVIOUS_UAE_BODY = PREVIOUS_UAE_BODY;
exports.renderTemplate = renderTemplate;
