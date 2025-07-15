exports.up = function(knex) {
  return knex.schema.createTable("kufs", (table) => {
    table.string("id").primary();
    table.string("brojKuf").notNullable();
    table.date("datumKuf").notNullable();
    table.date("datumPrijema");
    table.string("imeKomitenta").notNullable();
    table.string("idKomitenta");
    table.float("iznos").notNullable();
    table.boolean("placeno").defaultTo(false);
  });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists("kufs");
};
