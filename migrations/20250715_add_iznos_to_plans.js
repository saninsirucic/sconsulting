exports.up = function(knex) {
  return knex.schema.table("plans", (table) => {
    table.float("iznos").defaultTo(0);
  });
};

exports.down = function(knex) {
  return knex.schema.table("plans", (table) => {
    table.dropColumn("iznos");
  });
};
