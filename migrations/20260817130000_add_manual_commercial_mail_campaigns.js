exports.up = async function up(knex) {
  await knex.schema.createTable('crm_mail_attachments', (table) => {
    table.string('id', 36).primary();
    table.string('brand_id', 36).notNullable()
      .references('id').inTable('crm_brands').onDelete('CASCADE');
    table.string('filename', 500).notNullable();
    table.string('mime_type', 200).notNullable();
    table.integer('size_bytes').notNullable();
    table.string('sha256', 64).notNullable();
    table.binary('content').notNullable();
    table.string('created_by', 120);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['brand_id', 'created_at'], 'crm_mail_attachments_brand_idx');
  });

  await knex.schema.alterTable('crm_mail_automation_settings', (table) => {
    // Application-level references keep this migration portable across SQLite tests and PostgreSQL.
    table.string('attachment_id', 36);
  });
  await knex.schema.alterTable('crm_mail_queue', (table) => {
    // The queue keeps the immutable attachment version that was active when it was prepared.
    table.string('attachment_id', 36);
    table.index(['attachment_id'], 'crm_mail_queue_attachment_idx');
  });

  // Existing installations stay safely manual until a person explicitly selects recipients.
  await knex('crm_mail_automation_settings').update({
    enabled: false,
    paused: true,
    auto_send: false,
    daily_limit: 30,
    updated_at: new Date()
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('crm_mail_queue', (table) => {
    table.dropIndex(['attachment_id'], 'crm_mail_queue_attachment_idx');
    table.dropColumn('attachment_id');
  });
  await knex.schema.alterTable('crm_mail_automation_settings', (table) => {
    table.dropColumn('attachment_id');
  });
  await knex.schema.dropTableIfExists('crm_mail_attachments');
};
