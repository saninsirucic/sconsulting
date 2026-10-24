exports.up = async function up(knex) {
  await knex.schema.createTable('crm_account_imports', (table) => {
    table.string('id', 36).primary();
    table.string('token_hash', 64).notNullable().unique();
    // Environment-backed directors also have stable actor IDs, without app_users rows.
    table.string('user_id', 36).notNullable();
    table.string('brand_id', 36).notNullable()
      .references('id').inTable('crm_brands').onDelete('CASCADE');
    table.string('status', 20).notNullable().defaultTo('PREVIEW');
    table.text('payload_json').notNullable();
    table.text('result_json');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('expires_at').notNullable();
    table.timestamp('committed_at');
    table.index(['user_id', 'brand_id'], 'crm_account_imports_owner_brand_idx');
    table.index(['expires_at'], 'crm_account_imports_expiry_idx');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('crm_account_imports');
};
