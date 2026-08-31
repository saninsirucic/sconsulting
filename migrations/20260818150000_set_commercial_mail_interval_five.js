exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('crm_mail_automation_settings'))) return;
  await knex('crm_mail_automation_settings')
    .where('send_interval_minutes', '>', 5)
    .update({ send_interval_minutes: 5, updated_at: new Date() });
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('crm_mail_automation_settings'))) return;
  await knex('crm_mail_automation_settings')
    .where({ send_interval_minutes: 5 })
    .update({ send_interval_minutes: 10, updated_at: new Date() });
};
