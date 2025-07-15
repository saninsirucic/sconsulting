exports.up = function(knex) {
  return knex.schema.createTable("clients", (table) => {
    table.string("id").primary();
    table.string("name").notNullable();
    table.string("email").notNullable();
    table.string("phone").notNullable();
    table.string("address").notNullable();
    table.string("postalCode");
    table.string("companyId");
    table.string("pib");
    table.string("contractNumber");
    table.string("paymentTerm");
    table.string("amountInWords");
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists("clients");
};
