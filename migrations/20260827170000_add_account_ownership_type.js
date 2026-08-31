exports.up = async function up(knex) {
  await knex.schema.alterTable('crm_accounts', (table) => {
    table.string('ownership_type', 20).notNullable().defaultTo('UNKNOWN');
    table.string('ownership_confidence', 20);
    table.timestamp('ownership_verified_at');
    table.string('ownership_source_url', 1000);
    table.text('ownership_evidence_json');
    table.index(
      ['brand_id', 'archived_at', 'ownership_type'],
      'crm_accounts_brand_ownership_idx'
    );
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('crm_accounts', (table) => {
    table.dropIndex(
      ['brand_id', 'archived_at', 'ownership_type'],
      'crm_accounts_brand_ownership_idx'
    );
    table.dropColumn('ownership_evidence_json');
    table.dropColumn('ownership_source_url');
    table.dropColumn('ownership_verified_at');
    table.dropColumn('ownership_confidence');
    table.dropColumn('ownership_type');
  });
};
