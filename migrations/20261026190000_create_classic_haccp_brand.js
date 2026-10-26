const { randomUUID } = require('node:crypto');
const BRAND = Object.freeze({ id: 'brand-haccp-classic', code: 'HACCP_CLASSIC', slug: 'haccp', name: 'HACCP' });

exports.up = async function up(db) {
  const now = new Date();
  await db('crm_brands').insert({ ...BRAND, mailbox_address: 'prodaja@s-consulting.ba', daily_limit: 30, active: true, created_at: now, updated_at: now });
  await db('crm_mail_automation_settings').insert({
    brand_id: BRAND.id, enabled: false, paused: true, auto_send: false,
    daily_limit: 30, workdays_json: '[1,2,3,4,5]', send_window_start: '09:00', send_window_end: '15:00',
    send_interval_minutes: 5, follow_up_days: 7, report_enabled: false, report_time: '16:00',
    report_recipient: 'prodaja@s-consulting.ba', subject: '', body_text: '', created_at: now, updated_at: now
  });
  // The new register is available to the users who already manage the supplied registry.
  const users = await db('app_user_brand_access').where({ brand_id: 'brand-fs-app', can_read: true });
  if (users.length) await db('app_user_brand_access').insert(users.map(access => ({
    id: randomUUID(), user_id: access.user_id, brand_id: BRAND.id,
    can_read: access.can_read, can_write: access.can_write, created_at: now, updated_at: now
  })));
};

exports.down = async function down(db) {
  if (await db('crm_accounts').where({ brand_id: BRAND.id }).first('id')) throw new Error('HACCP registar je u upotrebi.');
  await db('app_user_brand_access').where({ brand_id: BRAND.id }).delete();
  await db('crm_mail_automation_settings').where({ brand_id: BRAND.id }).delete();
  await db('crm_brands').where({ id: BRAND.id }).delete();
};
exports.BRAND = BRAND;
