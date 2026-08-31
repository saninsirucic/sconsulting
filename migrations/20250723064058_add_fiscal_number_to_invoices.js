exports.up = function(knex) {
  return knex.schema.alterTable('invoices', table => {
    table.string('fiscal_number');
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('invoices', table => {
    table.dropColumn('fiscal_number');
  });
};
