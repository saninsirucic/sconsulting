exports.up = function up(knex) {
  return knex.schema.alterTable('app_users', (table) => {
    table.integer('token_version').notNullable().defaultTo(0);
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('app_users', (table) => {
    table.dropColumn('token_version');
  });
};
