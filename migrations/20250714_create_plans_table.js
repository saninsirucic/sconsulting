exports.up = function(knex) {
  return knex.schema.createTable("plans", (table) => {
    table.string("id").primary();
    table.string("clientId").notNullable();
    table.string("executorId").notNullable();
    table.string("service").notNullable();
    table.date("date").notNullable();
    table.string("recurrence");
    table.boolean("done").defaultTo(false);
    table.float("iznos").defaultTo(0);  // Dodano polje iznos
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists("plans");
};
