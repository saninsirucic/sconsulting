const DEFAULT_REPORT_RECIPIENT = 'info@s-consulting.ba';

exports.up = async function up(knex) {
  await knex.schema.alterTable('crm_mail_automation_settings', (table) => {
    table.boolean('report_enabled').notNullable().defaultTo(true);
    table.string('report_time', 5).notNullable().defaultTo('16:00');
    table.string('report_recipient', 320).notNullable().defaultTo(DEFAULT_REPORT_RECIPIENT);
    table.timestamp('last_report_at');
    table.text('last_report_error');
  });

  await knex.schema.createTable('crm_mail_daily_reports', (table) => {
    table.string('id', 36).primary();
    table.string('brand_id', 36).notNullable()
      .references('id').inTable('crm_brands').onDelete('CASCADE');
    table.date('report_date').notNullable();
    table.string('recipient_email', 320).notNullable();
    table.string('status', 20).notNullable().defaultTo('SENDING');
    table.integer('prepared_count').notNullable().defaultTo(0);
    table.integer('sent_count').notNullable().defaultTo(0);
    table.integer('failed_count').notNullable().defaultTo(0);
    table.integer('remaining_count').notNullable().defaultTo(0);
    table.string('claim_token', 36).notNullable();
    table.timestamp('claimed_at').notNullable();
    table.timestamp('sent_at');
    table.string('provider_message_id', 1024);
    table.string('provider_conversation_id', 1024);
    table.text('last_error');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['brand_id', 'report_date'], {
      indexName: 'crm_mail_daily_reports_brand_date_unique'
    });
    table.index(['report_date', 'status'], 'crm_mail_daily_reports_date_status_idx');
  });

  await knex('crm_mail_automation_settings').update({
    report_enabled: true,
    report_time: '16:00',
    report_recipient: DEFAULT_REPORT_RECIPIENT,
    updated_at: new Date()
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('crm_mail_daily_reports');
  await knex.schema.alterTable('crm_mail_automation_settings', (table) => {
    table.dropColumn('report_enabled');
    table.dropColumn('report_time');
    table.dropColumn('report_recipient');
    table.dropColumn('last_report_at');
    table.dropColumn('last_report_error');
  });
};

exports.DEFAULT_REPORT_RECIPIENT = DEFAULT_REPORT_RECIPIENT;
