exports.up = function(knex) {
  return knex.schema.createTable("invoices", (table) => {
    table.string("id").primary();
    table.integer("number").notNullable();
    table.string("clientId").notNullable();
    table.date("date").notNullable();
    table.string("description");
    table.integer("quantity");
    table.float("price");
    table.string("unit");
    table.float("totalNoVat");
    table.float("vat");
    table.float("total");
    table.string("amountInWords");
    table.string("contractNumber");
    table.string("paymentTerm");
    table.date("paymentDate");
    table.string("paymentOrderNumber");
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists("invoices");
};
