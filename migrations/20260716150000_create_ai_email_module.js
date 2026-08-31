const addTimestamps = (table, knex) => {
  table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
};

exports.up = async function up(knex) {
  await knex.schema.createTable('email_contacts', (table) => {
    table.string('id', 36).primary();
    table.string('company_name').notNullable();
    table.string('company_name_normalized').notNullable();
    table.string('contact_person');
    table.string('email');
    table.string('email_normalized');
    table.string('additional_email');
    table.string('phone');
    table.string('website');
    table.string('country');
    table.string('city');
    table.string('postal_code');
    table.string('address');
    table.string('industry');
    table.string('source');
    table.string('priority');
    table.string('status');
    table.text('notes');
    table.text('previous_communication');
    table.timestamp('last_contact_at');
    table.timestamp('next_contact_at');
    table.boolean('sending_allowed').notNullable().defaultTo(true);
    table.string('suppression_reason');
    table.timestamp('archived_at');
    addTimestamps(table, knex);
    table.index(['email_normalized'], 'email_contacts_email_idx');
    table.index(['company_name_normalized'], 'email_contacts_company_idx');
    table.index(['country', 'priority', 'status'], 'email_contacts_filters_idx');
  });

  await knex.schema.createTable('email_import_jobs', (table) => {
    table.string('id', 36).primary();
    table.string('created_by').notNullable();
    table.string('file_name').notNullable();
    table.integer('file_size').notNullable();
    table.string('sheet_name').notNullable();
    table.integer('header_row').notNullable();
    table.text('mapping_json').notNullable();
    table.string('duplicate_strategy').notNullable();
    table.string('status').notNullable().defaultTo('PROCESSING');
    table.integer('total_rows').notNullable().defaultTo(0);
    table.integer('imported_count').notNullable().defaultTo(0);
    table.integer('updated_count').notNullable().defaultTo(0);
    table.integer('skipped_count').notNullable().defaultTo(0);
    table.integer('invalid_count').notNullable().defaultTo(0);
    table.integer('duplicate_count').notNullable().defaultTo(0);
    table.timestamp('completed_at');
    addTimestamps(table, knex);
    table.index(['created_by', 'created_at'], 'email_import_jobs_user_idx');
  });

  await knex.schema.createTable('email_import_errors', (table) => {
    table.string('id', 36).primary();
    table.string('import_job_id', 36).notNullable()
      .references('id').inTable('email_import_jobs').onDelete('CASCADE');
    table.integer('row_number').notNullable();
    table.string('error_code').notNullable();
    table.text('error_message').notNullable();
    table.text('raw_data_json');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['import_job_id'], 'email_import_errors_job_idx');
  });

  await knex.schema.createTable('email_import_mappings', (table) => {
    table.string('id', 36).primary();
    table.string('created_by').notNullable();
    table.string('name').notNullable();
    table.string('sheet_name');
    table.string('header_signature').notNullable();
    table.text('mapping_json').notNullable();
    table.boolean('is_default').notNullable().defaultTo(false);
    addTimestamps(table, knex);
    table.unique(['created_by', 'header_signature'], {
      indexName: 'email_import_mappings_user_header_unique'
    });
  });

  await knex.schema.createTable('email_campaigns', (table) => {
    table.string('id', 36).primary();
    table.string('name').notNullable();
    table.text('description');
    table.string('product_service');
    table.string('goal');
    table.string('language').notNullable().defaultTo('bs');
    table.string('market_country');
    table.string('status').notNullable().defaultTo('DRAFT');
    table.text('offer_information');
    table.string('tone');
    table.string('subject_guidance');
    table.string('call_to_action');
    table.text('signature');
    table.text('allowed_facts');
    table.text('forbidden_claims');
    table.timestamp('starts_at');
    table.text('allowed_days_json').notNullable().defaultTo('[1,2,3,4,5]');
    table.string('send_window_start').notNullable().defaultTo('09:00');
    table.string('send_window_end').notNullable().defaultTo('15:00');
    table.string('timezone').notNullable().defaultTo('Europe/Sarajevo');
    table.integer('daily_limit').notNullable().defaultTo(20);
    table.integer('min_interval_minutes').notNullable().defaultTo(5);
    table.integer('max_followups').notNullable().defaultTo(2);
    table.integer('first_followup_days').notNullable().defaultTo(5);
    table.integer('second_followup_days').notNullable().defaultTo(7);
    table.string('created_by').notNullable();
    addTimestamps(table, knex);
    table.index(['status', 'starts_at'], 'email_campaigns_status_idx');
  });

  await knex.schema.createTable('email_campaign_contacts', (table) => {
    table.string('id', 36).primary();
    table.string('campaign_id', 36).notNullable()
      .references('id').inTable('email_campaigns').onDelete('CASCADE');
    table.string('contact_id', 36).notNullable()
      .references('id').inTable('email_contacts').onDelete('CASCADE');
    table.string('status').notNullable().defaultTo('ACTIVE');
    table.string('excluded_reason');
    addTimestamps(table, knex);
    table.unique(['campaign_id', 'contact_id'], {
      indexName: 'email_campaign_contacts_unique'
    });
    table.index(['contact_id'], 'email_campaign_contacts_contact_idx');
  });

  await knex.schema.createTable('email_templates', (table) => {
    table.string('id', 36).primary();
    table.string('name').notNullable();
    table.string('language').notNullable().defaultTo('bs');
    table.string('subject');
    table.text('body_text');
    table.text('body_html');
    table.string('created_by').notNullable();
    addTimestamps(table, knex);
  });

  await knex.schema.createTable('email_messages', (table) => {
    table.string('id', 36).primary();
    table.string('campaign_id', 36).notNullable()
      .references('id').inTable('email_campaigns').onDelete('CASCADE');
    table.string('contact_id', 36).notNullable()
      .references('id').inTable('email_contacts').onDelete('CASCADE');
    table.string('parent_message_id', 36)
      .references('id').inTable('email_messages').onDelete('SET NULL');
    table.string('message_type').notNullable().defaultTo('INITIAL');
    table.integer('sequence_number').notNullable().defaultTo(0);
    table.string('status').notNullable().defaultTo('DRAFT');
    table.string('to_email').notNullable();
    table.string('subject');
    table.text('body_text');
    table.text('body_html');
    table.text('personalization_summary');
    table.text('warnings_json');
    table.string('approved_by');
    table.timestamp('approved_at');
    table.timestamp('scheduled_at');
    table.timestamp('sent_at');
    table.string('provider_message_id');
    table.string('provider_thread_id');
    table.integer('attempt_count').notNullable().defaultTo(0);
    table.text('last_error');
    table.boolean('test_mode').notNullable().defaultTo(true);
    addTimestamps(table, knex);
    table.index(['campaign_id'], 'email_messages_campaign_idx');
    table.index(['contact_id'], 'email_messages_contact_idx');
    table.index(['status', 'scheduled_at'], 'email_messages_queue_idx');
    table.index(['provider_message_id'], 'email_messages_provider_message_idx');
    table.index(['provider_thread_id'], 'email_messages_provider_thread_idx');
  });

  await knex.schema.createTable('email_followups', (table) => {
    table.string('id', 36).primary();
    table.string('campaign_id', 36).notNullable()
      .references('id').inTable('email_campaigns').onDelete('CASCADE');
    table.string('contact_id', 36).notNullable()
      .references('id').inTable('email_contacts').onDelete('CASCADE');
    table.string('original_message_id', 36).notNullable()
      .references('id').inTable('email_messages').onDelete('CASCADE');
    table.string('message_id', 36)
      .references('id').inTable('email_messages').onDelete('SET NULL');
    table.integer('sequence_number').notNullable();
    table.string('status').notNullable().defaultTo('SCHEDULED');
    table.timestamp('scheduled_at').notNullable();
    table.string('cancel_reason');
    addTimestamps(table, knex);
    table.index(['status', 'scheduled_at'], 'email_followups_schedule_idx');
    table.index(['contact_id'], 'email_followups_contact_idx');
  });

  await knex.schema.createTable('email_replies', (table) => {
    table.string('id', 36).primary();
    table.string('campaign_id', 36)
      .references('id').inTable('email_campaigns').onDelete('SET NULL');
    table.string('contact_id', 36)
      .references('id').inTable('email_contacts').onDelete('SET NULL');
    table.string('message_id', 36)
      .references('id').inTable('email_messages').onDelete('SET NULL');
    table.string('provider_message_id');
    table.string('provider_thread_id');
    table.string('from_email').notNullable();
    table.string('subject');
    table.text('body_text');
    table.string('classification').notNullable().defaultTo('NEEDS_REVIEW');
    table.string('ai_suggested_classification');
    table.text('ai_draft_reply');
    table.timestamp('received_at').notNullable();
    addTimestamps(table, knex);
    table.index(['campaign_id'], 'email_replies_campaign_idx');
    table.index(['contact_id'], 'email_replies_contact_idx');
    table.index(['provider_thread_id'], 'email_replies_thread_idx');
  });

  await knex.schema.createTable('email_suppression_list', (table) => {
    table.string('id', 36).primary();
    table.string('email').notNullable();
    table.string('email_normalized').notNullable().unique();
    table.string('reason').notNullable();
    table.string('source').notNullable();
    table.text('notes');
    table.string('created_by').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['email_normalized'], 'email_suppression_email_idx');
  });

  await knex.schema.createTable('email_provider_accounts', (table) => {
    table.string('id', 36).primary();
    table.string('provider').notNullable();
    table.string('sender_address').notNullable();
    table.text('configuration_json');
    table.boolean('is_active').notNullable().defaultTo(false);
    table.boolean('test_mode').notNullable().defaultTo(true);
    addTimestamps(table, knex);
    table.unique(['provider', 'sender_address'], {
      indexName: 'email_provider_accounts_unique'
    });
  });

  await knex.schema.createTable('email_activity_logs', (table) => {
    table.string('id', 36).primary();
    table.string('actor_id').notNullable();
    table.string('action').notNullable();
    table.string('entity_type').notNullable();
    table.string('entity_id', 36);
    table.text('metadata_json');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['entity_type', 'entity_id'], 'email_activity_entity_idx');
    table.index(['actor_id', 'created_at'], 'email_activity_actor_idx');
  });
};

exports.down = async function down(knex) {
  const tables = [
    'email_activity_logs',
    'email_provider_accounts',
    'email_suppression_list',
    'email_replies',
    'email_followups',
    'email_messages',
    'email_templates',
    'email_campaign_contacts',
    'email_campaigns',
    'email_import_mappings',
    'email_import_errors',
    'email_import_jobs',
    'email_contacts'
  ];

  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
};
