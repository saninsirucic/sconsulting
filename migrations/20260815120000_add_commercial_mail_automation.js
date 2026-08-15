const SAN_PEST_SUBJECT = 'Digitalizacija DDD poslovanja kroz SanPest Platformu';

const SAN_PEST_BODY = `Poštovani,

javljam Vam se ispred S-Consulting Group povodom SanPest Platforme — savremenog digitalnog rješenja razvijenog posebno za firme koje se bave dezinfekcijom, dezinsekcijom i deratizacijom.

SanPest Platform omogućava da se kompletna DDD operativa vodi kroz jedan moderan sistem: od evidencije klijenata i objekata, planiranja tretmana i rasporeda ekipa, do digitalnih radnih naloga, potvrda sa QR verifikacijom, GPS evidencije terenskog rada i izvještaja.

Cilj platforme je jednostavan: manje administracije, bolja kontrola terena i profesionalniji odnos prema klijentima.

Ukoliko Vam je tema interesantna, predložili bismo kratak online sastanak od 15–20 minuta, gdje bismo Vam pokazali kako platforma izgleda u praksi i na koji način može odgovarati Vašem modelu rada.

Prezentacija je informativna i bez obaveze.

Više informacija možete pogledati ovdje:
https://www.s-consulting.ba/sanpest-platform`;

exports.up = async function up(knex) {
  await knex.schema.createTable('crm_mail_automation_settings', (table) => {
    table.string('brand_id', 36).primary()
      .references('id').inTable('crm_brands').onDelete('CASCADE');
    table.boolean('enabled').notNullable().defaultTo(false);
    table.boolean('paused').notNullable().defaultTo(true);
    table.boolean('auto_send').notNullable().defaultTo(true);
    table.integer('daily_limit').notNullable().defaultTo(30);
    table.text('workdays_json').notNullable().defaultTo('[1,2,3,4,5]');
    table.string('send_window_start', 5).notNullable().defaultTo('09:00');
    table.string('send_window_end', 5).notNullable().defaultTo('15:00');
    table.integer('send_interval_minutes').notNullable().defaultTo(10);
    table.integer('follow_up_days').notNullable().defaultTo(7);
    table.string('subject', 255);
    table.text('body_text');
    table.date('last_prepared_date');
    table.timestamp('last_sent_at');
    table.text('last_error');
    table.string('updated_by', 120);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.index(['enabled', 'paused'], 'crm_mail_automation_active_idx');
  });

  await knex.schema.createTable('crm_mail_queue', (table) => {
    table.string('id', 36).primary();
    table.string('brand_id', 36).notNullable()
      .references('id').inTable('crm_brands').onDelete('CASCADE');
    table.string('account_id', 36).notNullable()
      .references('id').inTable('crm_accounts').onDelete('CASCADE');
    table.date('queue_date').notNullable();
    table.integer('sequence_number').notNullable();
    table.string('recipient_email', 320).notNullable();
    table.string('subject', 255).notNullable();
    table.text('body_text').notNullable();
    table.string('status', 40).notNullable().defaultTo('PENDING');
    table.integer('attempts').notNullable().defaultTo(0);
    table.string('claim_token', 36);
    table.timestamp('claimed_at');
    table.timestamp('sent_at');
    table.string('provider_message_id', 1024);
    table.string('provider_conversation_id', 1024);
    table.text('last_error');
    table.string('created_by', 120);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['brand_id', 'queue_date', 'account_id'], {
      indexName: 'crm_mail_queue_brand_date_account_unique'
    });
    table.index(['brand_id', 'queue_date', 'status', 'sequence_number'], 'crm_mail_queue_daily_idx');
    table.index(['account_id', 'status'], 'crm_mail_queue_account_idx');
    table.index(['recipient_email', 'queue_date'], 'crm_mail_queue_recipient_date_idx');
  });

  const brands = await knex('crm_brands').select('id', 'code');
  const now = new Date();
  const rows = brands.map((brand) => ({
    brand_id: brand.id,
    enabled: false,
    paused: true,
    auto_send: true,
    daily_limit: 30,
    workdays_json: JSON.stringify([1, 2, 3, 4, 5]),
    send_window_start: '09:00',
    send_window_end: '15:00',
    send_interval_minutes: 10,
    follow_up_days: 7,
    subject: brand.code === 'SAN_PEST' ? SAN_PEST_SUBJECT : null,
    body_text: brand.code === 'SAN_PEST' ? SAN_PEST_BODY : null,
    created_at: now,
    updated_at: now
  }));
  if (rows.length) await knex('crm_mail_automation_settings').insert(rows).onConflict('brand_id').ignore();
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('crm_mail_queue');
  await knex.schema.dropTableIfExists('crm_mail_automation_settings');
};

exports.SAN_PEST_BODY = SAN_PEST_BODY;
exports.SAN_PEST_SUBJECT = SAN_PEST_SUBJECT;
