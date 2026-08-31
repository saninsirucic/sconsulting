exports.up = async function up(knex) {
  await knex.schema.alterTable('crm_accounts', (table) => {
    table.timestamp('admin_call_requested_at');
    // Actor IDs may also belong to temporary environment-backed users.
    table.string('admin_call_requested_by', 36);
    table.index(['brand_id', 'admin_call_requested_at'], 'crm_accounts_admin_call_idx');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('crm_accounts', (table) => {
    table.dropIndex(['brand_id', 'admin_call_requested_at'], 'crm_accounts_admin_call_idx');
    table.dropColumn('admin_call_requested_by');
    table.dropColumn('admin_call_requested_at');
  });
};
