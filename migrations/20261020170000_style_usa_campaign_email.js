const { DISCLOSURE, UNSUBSCRIBE, POSTAL_ADDRESS, PRODUCT_URL } = require('../commercial/usaMail');

const SUBJECT = 'A smarter way to manage pest control operations – {{KOMITENT}}';
const BODY = `Dear {{KOMITENT}} team,

${DISCLOSURE}

I am contacting you on behalf of S-Consulting Group to introduce SANpest, a digital platform developed specifically for pest control companies.

SANpest brings your day-to-day operations into one system, including:
• customer, site and contract records
• treatment planning and team scheduling
• mobile work orders with QR and GPS verification
• chemical, stock and equipment records
• service certificates, reports, invoicing and payment tracking

For companies managing multiple teams or service locations, SANpest helps keep fieldwork, documentation and commercial activity connected.

We would be pleased to arrange a brief 15–20 minute online presentation tailored to {{KOMITENT}}. We can show you the platform and discuss how it could support your current workflow.

The presentation is free of charge and without obligation.

Learn more about SANpest Platform in English:
${PRODUCT_URL}

For any further communication, we would be happy to continue in English.

${UNSUBSCRIBE}

${POSTAL_ADDRESS}`;

exports.up = async function up(knex) {
  const brand = await knex('crm_brands').where({ code: 'SAN_PEST_USA' }).first('id');
  if (!brand) return;
  await knex('crm_mail_automation_settings').where({ brand_id: brand.id }).update({
    subject: SUBJECT, body_text: BODY, updated_at: new Date()
  });
};
// Preserve user-visible campaign copy if the code release is rolled back.
exports.down = async function down() {};
exports.SUBJECT = SUBJECT;
exports.BODY = BODY;
