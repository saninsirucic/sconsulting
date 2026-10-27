exports.up = async function (knex) {
  await knex.schema.createTable('sanpest_meeting_requests', (table) => {
    table.uuid('id').primary();
    table.string('name', 120).notNullable();
    table.string('phone', 40).notNullable();
    table.string('company', 160).notNullable();
    table.text('comment').notNullable().defaultTo('');
    table.string('meeting_format', 20).notNullable().defaultTo('online');
    table.string('status', 24).notNullable().defaultTo('NEW');
    table.string('notification_status', 24).notNullable().defaultTo('PENDING');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
};
exports.down = async function (knex) { await knex.schema.dropTable('sanpest_meeting_requests'); };
