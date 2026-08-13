const visiocastRows = require('../data/visiocastSeed');

const BRAND_ROWS = [
  { id: 'brand-visiocast', code: 'VISIOCAST', slug: 'visiocast', name: 'Visiocast' },
  { id: 'brand-san-pest', code: 'SAN_PEST', slug: 'san-pest', name: 'SAN Pest' },
  { id: 'brand-fs-app', code: 'FS_APP', slug: 'fs-app', name: 'FS App' }
];

function extractFirstEmail(...values) {
  const text = values.filter(Boolean).join('\n');
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : null;
}

function extractFirstPhone(...values) {
  const text = values.filter(Boolean).join('\n')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ');
  const international = text.match(/\+?387(?:\s*\(0\))?[\s./()-]*\d(?:[\d\s./()-]{5,}\d)/);
  const local = text.match(/(?:^|\D)(0\d(?:[\d\s./()-]{5,}\d)|\d{8,})(?=\D|$)/);
  const match = international || local;
  if (!match) return null;
  return String(match[1] || match[0]).trim().replace(/\s+/g, ' ').slice(0, 100);
}

function inferStatus(comment) {
  const normalized = String(comment || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/odb[ui]l/.test(normalized)) return 'REJECTED';
  if (normalized.includes('sastanak') || normalized.includes('februar')) return 'MEETING_SCHEDULED';
  if (normalized.includes('poslao')) return 'EMAIL_SENT';
  if (normalized.includes('kontaktirala')) return 'CONTACTED';
  if (normalized.includes('zovi')) return 'CALL_REQUIRED';
  return 'NEW';
}

function rawVisiocastData(row) {
  return {
    'N/R': row.nr,
    KOMITENT: row.company,
    VRSTA: row.type,
    'BROJ POSLOVNICA': row.branches,
    IZNOS: row.amount,
    UKUPNO: row.total,
    PROFIT: row.profit,
    Mail: row.rawMail,
    Kontakt: row.rawContact,
    Komentar: row.comment,
    LOKACIJA: row.location
  };
}

exports.up = async function up(knex) {
  await knex.schema.createTable('app_users', (table) => {
    table.string('id', 36).primary();
    table.string('username', 120).notNullable();
    table.string('username_normalized', 120).notNullable().unique();
    table.string('password_hash', 255).notNullable();
    table.string('display_name', 200);
    table.string('email', 320);
    table.string('role', 50).notNullable().defaultTo('komercijala');
    table.boolean('active').notNullable().defaultTo(true);
    table.boolean('must_change_password').notNullable().defaultTo(true);
    table.timestamp('password_changed_at');
    table.timestamp('last_login_at');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.index(['role', 'active'], 'app_users_role_active_idx');
  });

  await knex.schema.createTable('crm_brands', (table) => {
    table.string('id', 36).primary();
    table.string('code', 40).notNullable().unique();
    table.string('slug', 80).notNullable().unique();
    table.string('name', 120).notNullable();
    table.integer('daily_limit').notNullable().defaultTo(30);
    table.boolean('active').notNullable().defaultTo(true);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('app_user_brand_access', (table) => {
    table.string('id', 36).primary();
    table.string('user_id', 36).notNullable()
      .references('id').inTable('app_users').onDelete('CASCADE');
    table.string('brand_id', 36).notNullable()
      .references('id').inTable('crm_brands').onDelete('CASCADE');
    table.boolean('can_read').notNullable().defaultTo(true);
    table.boolean('can_write').notNullable().defaultTo(true);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['user_id', 'brand_id'], { indexName: 'user_brand_access_unique' });
    table.index(['brand_id', 'user_id'], 'user_brand_access_lookup_idx');
  });

  await knex.schema.createTable('crm_accounts', (table) => {
    table.string('id', 36).primary();
    table.string('brand_id', 36).notNullable()
      .references('id').inTable('crm_brands').onDelete('CASCADE');
    table.string('source_key', 160).notNullable();
    table.integer('source_row_number');
    table.string('company_name', 300).notNullable();
    table.string('record_type', 120);
    table.integer('branch_count');
    table.decimal('unit_amount', 14, 2);
    table.decimal('total_amount', 14, 2);
    table.decimal('profit_amount', 14, 2);
    table.string('currency', 10).notNullable().defaultTo('BAM');
    table.string('contact_person', 250);
    table.string('email', 320);
    table.string('phone', 100);
    table.string('website', 500);
    table.string('location', 250);
    table.string('status', 80).notNullable().defaultTo('NEW');
    table.string('priority', 40).notNullable().defaultTo('MEDIUM');
    table.text('comment');
    table.text('notes');
    table.text('raw_mail');
    table.text('raw_contact');
    table.text('source_data_json').notNullable();
    table.string('owner_user_id', 36);
    table.timestamp('last_contact_at');
    table.timestamp('next_contact_at');
    table.timestamp('archived_at');
    // Actor IDs also accept temporary AUTH_USERS_JSON principals during migration.
    table.string('created_by', 36);
    table.string('updated_by', 36);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['brand_id', 'source_key'], { indexName: 'crm_accounts_brand_source_unique' });
    table.index(['brand_id', 'archived_at', 'status'], 'crm_accounts_brand_status_idx');
    table.index(['brand_id', 'company_name'], 'crm_accounts_brand_company_idx');
    table.index(['owner_user_id', 'brand_id'], 'crm_accounts_owner_brand_idx');
  });

  await knex.schema.createTable('crm_activities', (table) => {
    table.string('id', 36).primary();
    table.string('account_id', 36).notNullable()
      .references('id').inTable('crm_accounts').onDelete('CASCADE');
    table.string('brand_id', 36).notNullable()
      .references('id').inTable('crm_brands').onDelete('CASCADE');
    table.string('user_id', 36);
    table.string('activity_type', 80).notNullable();
    table.string('from_status', 80);
    table.string('to_status', 80);
    table.text('notes');
    table.text('metadata_json');
    table.timestamp('occurred_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.index(['account_id', 'occurred_at'], 'crm_activities_account_idx');
    table.index(['brand_id', 'occurred_at'], 'crm_activities_brand_idx');
  });

  await knex.schema.createTable('crm_daily_assignments', (table) => {
    table.string('id', 36).primary();
    // No FK: environment-backed directors remain compatible during auth migration.
    table.string('user_id', 36).notNullable();
    table.string('brand_id', 36).notNullable()
      .references('id').inTable('crm_brands').onDelete('CASCADE');
    table.string('account_id', 36).notNullable()
      .references('id').inTable('crm_accounts').onDelete('CASCADE');
    table.date('assignment_date').notNullable();
    table.integer('sequence_number').notNullable();
    table.string('status', 80).notNullable().defaultTo('PENDING');
    table.text('notes');
    table.timestamp('completed_at');
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
    table.unique(['user_id', 'brand_id', 'assignment_date', 'account_id'], {
      indexName: 'crm_daily_assignment_unique'
    });
    table.index(['user_id', 'brand_id', 'assignment_date'], 'crm_daily_user_date_idx');
    table.index(['user_id', 'brand_id', 'account_id'], 'crm_daily_history_idx');
  });

  const now = new Date();
  await knex('crm_brands').insert(BRAND_ROWS.map((brand) => ({
    ...brand,
    daily_limit: 30,
    active: true,
    created_at: now,
    updated_at: now
  }))).onConflict('code').ignore();

  const accounts = visiocastRows.map((row) => ({
    id: `visiocast-account-${String(row.nr).padStart(3, '0')}`,
    brand_id: 'brand-visiocast',
    source_key: `VISIOCAST:${row.nr}`,
    source_row_number: row.nr,
    company_name: String(row.company || '').trim(),
    record_type: row.type,
    branch_count: row.branches,
    unit_amount: row.amount,
    total_amount: row.total,
    profit_amount: row.profit,
    currency: 'BAM',
    email: extractFirstEmail(row.rawMail, row.rawContact),
    phone: extractFirstPhone(row.rawMail, row.rawContact),
    location: row.location,
    status: inferStatus(row.comment),
    priority: 'MEDIUM',
    comment: row.comment,
    raw_mail: row.rawMail,
    raw_contact: row.rawContact,
    source_data_json: JSON.stringify(rawVisiocastData(row)),
    created_at: now,
    updated_at: now
  }));
  await knex('crm_accounts').insert(accounts)
    .onConflict(['brand_id', 'source_key']).ignore();
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('crm_daily_assignments');
  await knex.schema.dropTableIfExists('crm_activities');
  await knex.schema.dropTableIfExists('crm_accounts');
  await knex.schema.dropTableIfExists('app_user_brand_access');
  await knex.schema.dropTableIfExists('crm_brands');
  await knex.schema.dropTableIfExists('app_users');
};

exports.BRAND_ROWS = BRAND_ROWS;
exports.extractFirstEmail = extractFirstEmail;
exports.extractFirstPhone = extractFirstPhone;
exports.inferStatus = inferStatus;
