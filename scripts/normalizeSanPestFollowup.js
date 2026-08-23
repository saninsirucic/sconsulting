require('dotenv').config();
const knex = require('knex');
const { v4: uuidv4 } = require('uuid');
const { extractLetterSentAt } = require('../commercial/service');

const BRAND_CODE = 'SAN_PEST';
const ACTOR_ID = 'codex-san-pest-reset-20260823';
const SENT_ACTIVITY_TYPES = ['COMMERCIAL_EMAIL_SENT', 'AUTOMATED_EMAIL_SENT'];

function cleanSeminarNotes(value) {
  if (!value) return null;
  const kept = String(value)
    .split(/\n\s*\n/)
    .filter((part) => !/^Stari komentar\s*\/\s*historija\s*:/i.test(part.trim()));
  return kept.join('\n\n').trim() || null;
}

async function analyze(db) {
  const brand = await db('crm_brands').where({ code: BRAND_CODE }).first();
  if (!brand) throw new Error('SAN Pest baza nije pronađena.');

  const accounts = await db('crm_accounts')
    .where({ brand_id: brand.id })
    .whereNull('archived_at')
    .orderBy('source_row_number');
  if (accounts.length > 250) throw new Error(`Sigurnosna provjera: pronađeno je neočekivanih ${accounts.length} aktivnih SAN Pest zapisa.`);

  const sentFromActivities = await db('crm_activities')
    .where({ brand_id: brand.id })
    .whereIn('activity_type', SENT_ACTIVITY_TYPES)
    .distinct('account_id');
  const sentFromQueue = await db('crm_mail_queue')
    .where({ brand_id: brand.id, status: 'SENT' })
    .distinct('account_id');
  const sentIds = new Set([
    ...sentFromActivities.map((row) => row.account_id),
    ...sentFromQueue.map((row) => row.account_id)
  ]);

  const preserved = [];
  const reset = [];
  for (const account of accounts) {
    const sent = sentIds.has(account.id) || account.status === 'EMAIL_SENT' || Boolean(extractLetterSentAt(account));
    if (sent) preserved.push(account);
    else reset.push(account);
  }

  return {
    brand,
    accounts,
    preserved,
    reset,
    summary: {
      brand: BRAND_CODE,
      active_total: accounts.length,
      sent_comments_preserved: preserved.length,
      accounts_to_reset: reset.length,
      comments_to_clear: reset.filter((row) => Boolean(String(row.comment || '').trim())).length,
      statuses_to_call_required: reset.filter((row) => row.status !== 'CALL_REQUIRED').length,
      seminar_note_blocks_to_remove: reset.filter((row) => cleanSeminarNotes(row.notes) !== (row.notes || null)).length,
      sample_to_reset: reset.slice(0, 10).map((row) => ({
        nr: row.source_row_number,
        company: row.company_name,
        old_status: row.status,
        old_comment: row.comment
      }))
    }
  };
}

async function applyReset(db, analysis) {
  const now = new Date();
  await db.transaction(async (trx) => {
    for (const account of analysis.reset) {
      const cleanedNotes = cleanSeminarNotes(account.notes);
      await trx('crm_accounts').where({ id: account.id, brand_id: analysis.brand.id }).update({
        status: 'CALL_REQUIRED',
        comment: null,
        notes: cleanedNotes,
        updated_by: ACTOR_ID,
        updated_at: now
      });
      await trx('crm_activities').insert({
        id: uuidv4(),
        account_id: account.id,
        brand_id: analysis.brand.id,
        user_id: ACTOR_ID,
        activity_type: 'SAN_PEST_SEMINAR_DATA_RESET',
        from_status: account.status,
        to_status: 'CALL_REQUIRED',
        notes: 'Uklonjen stari komentar vezan za seminar; komitent označen kao Potrebno nazvati.',
        metadata_json: JSON.stringify({
          previousStatus: account.status,
          previousComment: account.comment,
          previousNotes: account.notes,
          bulk: true,
          reason: 'Stari SAN Pest komentari odnosili su se na seminar.'
        }),
        occurred_at: now,
        created_at: now
      });
    }
  });
}

async function main() {
  const environment = process.env.DATABASE_URL ? 'production' : 'development';
  const db = knex(require('../knexfile')[environment]);
  try {
    const analysis = await analyze(db);
    const apply = process.argv.includes('--apply');
    if (apply) await applyReset(db, analysis);
    console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', ...analysis.summary }, null, 2));
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { analyze, applyReset, cleanSeminarNotes };
