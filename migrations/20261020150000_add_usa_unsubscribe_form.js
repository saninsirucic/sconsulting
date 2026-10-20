const { LEGACY_UNSUBSCRIBE, UNSUBSCRIBE } = require('../commercial/usaMail');

async function replaceFooter(knex, from, to) {
  const brand = await knex('crm_brands').where({ code: 'SAN_PEST_USA' }).first('id');
  if (!brand) return;
  const settings = await knex('crm_mail_automation_settings').where({ brand_id: brand.id }).first();
  if (settings?.body_text?.includes(from)) {
    await knex('crm_mail_automation_settings').where({ brand_id: brand.id }).update({
      body_text: settings.body_text.split(from).join(to), updated_at: new Date()
    });
  }
}

exports.up = (knex) => replaceFooter(knex, LEGACY_UNSUBSCRIBE, UNSUBSCRIBE);
exports.down = (knex) => replaceFooter(knex, UNSUBSCRIBE, LEGACY_UNSUBSCRIBE);
