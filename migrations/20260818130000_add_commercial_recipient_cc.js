exports.up = async function up(knex) {
  await knex.schema.alterTable('crm_accounts', (table) => {
    table.text('cc_emails_json').notNullable().defaultTo('[]');
  });
  await knex.schema.alterTable('crm_mail_queue', (table) => {
    // Immutable recipient snapshot used by both manual and scheduled delivery.
    table.text('cc_emails_json').notNullable().defaultTo('[]');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('crm_mail_queue', (table) => {
    table.dropColumn('cc_emails_json');
  });
  await knex.schema.alterTable('crm_accounts', (table) => {
    table.dropColumn('cc_emails_json');
  });
};
