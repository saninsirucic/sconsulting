exports.up = function(knex) {
  return knex.schema.createTable("sanitarne", (table) => {
    table.string("id").primary();
    table.string("clientId").notNullable();
    table.string("employeeName").notNullable();
    table.date("dateIssued").notNullable();
    table.date("expiryDate").notNullable();
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists("sanitarne");
};
