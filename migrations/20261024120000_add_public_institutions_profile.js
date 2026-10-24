const BRAND_ID = 'brand-javne-ustanove';
const MAILBOX = 'prodaja@s-consulting.ba';

exports.up = async function up(knex) {
  await knex.schema.alterTable('app_users', (table) => table.string('outlook_mailbox', 320).unique('app_users_outlook_mailbox_unique'));
  await knex.schema.alterTable('crm_brands', (table) => table.string('mailbox_address', 320));
  const now = new Date();
  await knex('crm_brands').insert({
    id: BRAND_ID, code: 'JAVNE_USTANOVE', slug: 'javne-ustanove', name: 'Javne ustanove',
    mailbox_address: MAILBOX, daily_limit: 30, active: true, created_at: now, updated_at: now
  });
  // No account grants, recipients, queue entries or sending are created by this migration.
  await knex('crm_mail_automation_settings').insert({
    brand_id: BRAND_ID, enabled: false, paused: true, auto_send: false,
    daily_limit: 30, workdays_json: '[1,2,3,4,5]',
    send_window_start: '09:00', send_window_end: '15:00', send_interval_minutes: 5,
    follow_up_days: 7, report_enabled: false, report_time: '16:00', report_recipient: MAILBOX,
    subject: 'Dopis za {{KOMITENT}}',
    body_text: '',
    created_at: now, updated_at: now
  });
};

exports.down = async function down(knex) {
  const account = await knex('crm_accounts').where({ brand_id: BRAND_ID }).first('id');
  const user = await knex('app_users').where({ outlook_mailbox: MAILBOX }).first('id');
  if (account || user) throw new Error('Profil Javne ustanove je u upotrebi; automatsko uklanjanje nije dozvoljeno.');
  await knex('crm_mail_automation_settings').where({ brand_id: BRAND_ID }).delete();
  await knex('crm_brands').where({ id: BRAND_ID }).delete();
  await knex.schema.alterTable('crm_brands', (table) => table.dropColumn('mailbox_address'));
  await knex.schema.alterTable('app_users', (table) => {
    table.dropUnique(['outlook_mailbox'], 'app_users_outlook_mailbox_unique');
    table.dropColumn('outlook_mailbox');
  });
};

exports.BRAND_ID = BRAND_ID;
