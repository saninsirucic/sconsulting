exports.up = function(knex) {
  return knex.schema.createTable("executors", (table) => {
    table.string("id").primary();
    table.string("name").notNullable();
    table.string("email");
    table.string("phone");
    table.string("address");
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists("executors");
};
