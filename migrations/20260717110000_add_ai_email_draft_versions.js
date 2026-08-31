exports.up = async function up(knex) {
  await knex.schema.alterTable('email_messages', (table) => {
    table.string('ai_model');
    table.string('ai_response_id');
    table.string('prompt_version');
  });

  await knex.schema.createTable('email_message_versions', (table) => {
    table.string('id', 36).primary();
    table.string('message_id', 36).notNullable()
      .references('id').inTable('email_messages').onDelete('CASCADE');
    table.integer('version_number').notNullable();
    table.string('source').notNullable();
    table.string('subject').notNullable();
    table.text('body_text').notNullable();
    table.text('body_html');
    table.text('personalization_summary');
    table.text('warnings_json');
    table.string('ai_model');
    table.string('ai_response_id');
    table.string('prompt_version');
    table.string('changed_by').notNullable();
    table.text('change_note');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['message_id', 'version_number'], {
      indexName: 'email_message_versions_number_unique'
    });
    table.index(['message_id', 'created_at'], 'email_message_versions_message_idx');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('email_message_versions');
  await knex.schema.alterTable('email_messages', (table) => {
    table.dropColumn('ai_model');
    table.dropColumn('ai_response_id');
    table.dropColumn('prompt_version');
  });
};
