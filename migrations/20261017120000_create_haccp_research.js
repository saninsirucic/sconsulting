exports.up = async function up(db) {
  await db.schema.createTable('haccp_research_settings', (t) => {
    t.string('id', 40).primary();
    t.boolean('enabled').notNullable().defaultTo(false);
    t.integer('interval_hours').notNullable().defaultTo(72);
    t.integer('lookback_days').notNullable().defaultTo(90);
    t.integer('max_results').notNullable().defaultTo(20);
    t.timestamp('next_run_at');
    t.timestamp('last_started_at');
    t.string('lease_id', 36);
    t.timestamp('lease_until');
    t.string('updated_by', 120);
    t.timestamp('updated_at').notNullable();
  });
  await db.schema.createTable('haccp_research_runs', (t) => {
    t.string('id', 36).primary();
    t.string('status', 20).notNullable();
    t.string('trigger', 20).notNullable();
    t.string('created_by', 120);
    t.timestamp('started_at').notNullable();
    t.timestamp('finished_at');
    t.integer('new_count').notNullable().defaultTo(0);
    t.integer('updated_count').notNullable().defaultTo(0);
    t.integer('skipped_count').notNullable().defaultTo(0);
    t.string('model', 120);
    t.text('usage_json');
    t.text('notes');
    t.text('error');
    t.index(['started_at']);
  });
  await db.schema.createTable('haccp_research_leads', (t) => {
    t.string('id', 36).primary();
    t.string('identity_key', 64).notNullable().unique();
    t.string('name', 250).notNullable();
    t.string('category', 40).notNullable();
    t.string('municipality', 80).notNullable();
    t.string('address', 400);
    t.string('email', 320).index();
    t.string('phone', 100);
    t.text('website');
    t.string('opening_status', 30).notNullable();
    t.string('opening_date', 10);
    t.text('opening_evidence');
    t.text('sources_json').notNullable();
    t.text('contact_evidence');
    t.text('email_source_url');
    t.text('phone_source_url');
    t.text('opening_source_url');
    t.string('status', 30).notNullable().defaultTo('NEW');
    t.text('notes');
    t.timestamp('contacted_at');
    t.string('crm_account_id', 36);
    t.string('last_run_id', 36).notNullable();
    t.timestamp('first_seen_at').notNullable();
    t.timestamp('last_seen_at').notNullable();
    t.timestamp('updated_at').notNullable();
    t.index(['status', 'first_seen_at']);
  });
  await db('haccp_research_settings').insert({ id: 'sarajevo-food', updated_at: new Date() });
};

exports.down = async function down(db) {
  await db.schema.dropTableIfExists('haccp_research_leads');
  await db.schema.dropTableIfExists('haccp_research_runs');
  await db.schema.dropTableIfExists('haccp_research_settings');
};
