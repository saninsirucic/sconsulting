const fsAppRows = require('../data/fsAppSeed.json');

const BRAND_ID = 'brand-fs-app';
const BATCH_SIZE = 25;

function accountRow(row, now) {
  return {
    id: `fs-app-account-${String(row.nr).padStart(4, '0')}`,
    brand_id: BRAND_ID,
    source_key: `FS_APP:${row.nr}`,
    source_row_number: row.nr,
    company_name: row.companyName,
    record_type: row.recordType,
    currency: 'BAM',
    contact_person: row.contactPerson,
    email: row.email,
    phone: row.phone,
    website: row.website,
    location: row.location,
    status: row.status,
    priority: row.priority,
    comment: row.comment,
    notes: row.notes,
    raw_mail: row.rawMail,
    raw_contact: row.rawContact,
    source_data_json: JSON.stringify(row.sourceData),
    created_at: now,
    updated_at: now
  };
}

exports.up = async function up(knex) {
  const brand = await knex('crm_brands').where({ id: BRAND_ID, code: 'FS_APP' }).first();
  if (!brand) throw new Error('FS App CRM brend nije pronađen; prvo pokrenite osnovnu CRM migraciju.');

  const now = new Date();
  const accounts = fsAppRows.map((row) => accountRow(row, now));
  for (let index = 0; index < accounts.length; index += BATCH_SIZE) {
    await knex('crm_accounts')
      .insert(accounts.slice(index, index + BATCH_SIZE))
      .onConflict(['brand_id', 'source_key'])
      .ignore();
  }
};

exports.down = async function down(knex) {
  const sourceKeys = fsAppRows.map((row) => `FS_APP:${row.nr}`);
  for (let index = 0; index < sourceKeys.length; index += BATCH_SIZE) {
    await knex('crm_accounts')
      .where({ brand_id: BRAND_ID })
      .whereIn('source_key', sourceKeys.slice(index, index + BATCH_SIZE))
      .del();
  }
};

exports.BRAND_ID = BRAND_ID;
exports.accountRow = accountRow;
