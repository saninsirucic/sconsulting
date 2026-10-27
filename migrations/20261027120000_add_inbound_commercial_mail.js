exports.up = async (db) => {
  await db.schema.alterTable('crm_accounts', t => {
    t.timestamp('marketing_opt_out_at');
    t.text('marketing_opt_out_reason');
  });
  await db.schema.createTable('crm_inbound_messages', t => {
    t.string('id', 64).primary();
    t.string('mailbox', 320).notNullable();
    t.text('provider_message_id').notNullable();
    t.text('internet_message_id');
    t.string('sender_email', 320);
    t.text('subject');
    t.text('body_text');
    t.timestamp('received_at');
    t.string('classification', 40).notNullable();
    t.string('match_method', 80);
    t.text('account_ids_json').notNullable().defaultTo('[]');
    t.text('evidence_json');
    t.timestamp('created_at').notNullable().defaultTo(db.fn.now());
    t.index(['classification', 'received_at'], 'crm_inbound_classification_idx');
  });
  await db.schema.createTable('crm_mail_sync_state', t => {
    t.string('id', 64).primary();
    t.string('mailbox', 320).notNullable();
    t.text('folder_id');
    t.text('cursor_url');
    t.string('lease_token', 36);
    t.timestamp('lease_until');
    t.timestamp('last_success_at');
    t.timestamp('last_attempt_at');
    t.string('last_error', 200);
    t.text('stats_json');
    t.timestamp('updated_at').notNullable().defaultTo(db.fn.now());
  });
  // Preserve earlier opt-outs on the account as well as the global address list.
  const previous = await db('email_suppression_list').where(q => q.where({ reason: 'UNSUBSCRIBED' })
    .orWhereIn('source', ['PUBLIC_UNSUBSCRIBE_FORM', 'INBOUND_EMAIL', 'INBOUND_EMAIL_REPLY']))
    .select('email_normalized', 'source', 'created_at');
  for (const entry of previous) await db('crm_accounts').whereRaw('LOWER(TRIM(email)) = ?', [entry.email_normalized])
    .whereNull('marketing_opt_out_at').update({ marketing_opt_out_at: entry.created_at || new Date(),
      marketing_opt_out_reason: entry.source || 'EXISTING_UNSUBSCRIBE', status: 'REJECTED', updated_at: new Date() });
  const { withHaccpUnsubscribe } = require('../commercial/haccpMail');
  const brands = await db('crm_brands').whereIn('code', ['HACCP_CLASSIC', 'HACCP_PUBLIC']).select('id');
  for (const brand of brands) {
    const settings = await db('crm_mail_automation_settings').where({ brand_id: brand.id }).first();
    if (settings?.body_text) await db('crm_mail_automation_settings').where({ brand_id: brand.id })
      .update({ body_text: withHaccpUnsubscribe(settings.body_text), updated_at: new Date() });
  }
};
exports.down = async (db) => {
  await db.schema.dropTableIfExists('crm_mail_sync_state');
  await db.schema.dropTableIfExists('crm_inbound_messages');
  await db.schema.alterTable('crm_accounts', t => {
    t.dropColumn('marketing_opt_out_at'); t.dropColumn('marketing_opt_out_reason');
  });
};
