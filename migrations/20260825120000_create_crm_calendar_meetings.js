exports.up = async function up(knex) {
  if (await knex.schema.hasTable('crm_calendar_meetings')) return;

  await knex.schema.createTable('crm_calendar_meetings', (table) => {
    table.string('id', 36).primary();
    table.string('brand_id', 36).notNullable()
      .references('id').inTable('crm_brands').onDelete('CASCADE');
    // Environment-backed users are supported, so this intentionally has no FK.
    table.string('user_id', 36).notNullable();
    table.string('title', 300).notNullable();
    table.timestamp('starts_at').notNullable();
    table.integer('duration_minutes').notNullable().defaultTo(30);
    table.string('location', 500);
    table.text('notes');
    table.string('created_by', 36).notNullable();
    table.string('updated_by', 36).notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.index(['brand_id', 'starts_at'], 'crm_calendar_meetings_brand_start_idx');
    table.index(['user_id', 'starts_at'], 'crm_calendar_meetings_user_start_idx');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('crm_calendar_meetings');
};
