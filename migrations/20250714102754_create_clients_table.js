exports.up = async function(knex) {
  // The original production database predates Knex migration tracking for
  // this table. Treat an existing table as the reconciled baseline so later
  // migrations can run safely; fresh databases still create the table here.
  if (await knex.schema.hasTable("clients")) return;
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
