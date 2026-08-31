const classifications = require('../data/fsAppOwnership20260827.json');

const BRAND_CODE = 'FS_APP';
const SOURCE_ROW_COUNT = 814;
const LEGACY_AMKO_SOURCE_KEY = 'FS_APP:1';
const CURRENT_AMKO_SOURCE_KEY = 'FS_APP:NEW_20260827:6';
const BATCH_SIZE = 25;
const OWNERSHIP_TYPES = new Set(['PUBLIC', 'PRIVATE', 'MIXED', 'UNKNOWN']);
const CONFIDENCE_LEVELS = new Set(['HIGH', 'MEDIUM', 'LOW']);
const EXPECTED_COUNTS = { PRIVATE: 706, PUBLIC: 107, MIXED: 1, UNKNOWN: 0 };

function validateClassifications() {
  if (!Array.isArray(classifications) || classifications.length !== SOURCE_ROW_COUNT) {
    throw new Error(`FS App klasifikacija mora sadržavati tačno ${SOURCE_ROW_COUNT} zapisa.`);
  }

  const sourceKeys = new Set();
  const counts = { PRIVATE: 0, PUBLIC: 0, MIXED: 0, UNKNOWN: 0 };
  for (const row of classifications) {
    if (!row.sourceKey || !row.companyName || !OWNERSHIP_TYPES.has(row.ownership)
      || !CONFIDENCE_LEVELS.has(row.confidence) || !/^\d{4}-\d{2}-\d{2}$/.test(row.checkedAt || '')
      || !row.evidenceUrl || row.evidenceUrl.length > 1000 || !row.evidenceTitle
      || !row.rationale || !row.method) {
      throw new Error(`Neispravna FS App klasifikacija: ${JSON.stringify(row)}`);
    }
    if (sourceKeys.has(row.sourceKey)) throw new Error(`Dupli FS App izvorni ključ: ${row.sourceKey}`);
    sourceKeys.add(row.sourceKey);
    counts[row.ownership] += 1;
  }

  for (const [ownership, expected] of Object.entries(EXPECTED_COUNTS)) {
    if (counts[ownership] !== expected) {
      throw new Error(`Neočekivan broj ${ownership} FS App zapisa: ${counts[ownership]} (očekivano ${expected}).`);
    }
  }
  return counts;
}

function evidenceJson(row) {
  return JSON.stringify({
    companyName: row.companyName,
    evidenceTitle: row.evidenceTitle,
    evidenceUrl: row.evidenceUrl,
    checkedAt: row.checkedAt,
    rationale: row.rationale,
    method: row.method,
  });
}

function classificationForAccount(row, bySourceKey) {
  if (bySourceKey.has(row.source_key)) return bySourceKey.get(row.source_key);
  if (row.source_key === LEGACY_AMKO_SOURCE_KEY) return bySourceKey.get(CURRENT_AMKO_SOURCE_KEY);
  return null;
}

exports.up = async function up(knex) {
  validateClassifications();
  const brand = await knex('crm_brands').where({ code: BRAND_CODE }).first();
  if (!brand) throw new Error('FS App CRM brend nije pronađen.');

  const bySourceKey = new Map(classifications.map((row) => [row.sourceKey, row]));
  const accounts = await knex('crm_accounts')
    .where({ brand_id: brand.id })
    .select('source_key', 'company_name');
  const resolved = accounts.map((account) => ({
    account,
    classification: classificationForAccount(account, bySourceKey),
  }));
  const uncovered = resolved.filter((entry) => !entry.classification);
  if (uncovered.length) {
    throw new Error(`FS App zapisi bez klasifikacije: ${uncovered.map((entry) => entry.account.source_key).join(', ')}`);
  }

  for (let index = 0; index < resolved.length; index += BATCH_SIZE) {
    const batch = resolved.slice(index, index + BATCH_SIZE);
    await Promise.all(batch.map(({ account, classification }) => knex('crm_accounts')
      .where({ brand_id: brand.id, source_key: account.source_key })
      .update({
        ownership_type: classification.ownership,
        ownership_confidence: classification.confidence,
        ownership_verified_at: new Date(`${classification.checkedAt}T00:00:00.000Z`),
        ownership_source_url: classification.evidenceUrl,
        ownership_evidence_json: evidenceJson(classification),
      })));
  }
};

exports.down = async function down(knex) {
  const brand = await knex('crm_brands').where({ code: BRAND_CODE }).first();
  if (!brand) return;
  const sourceKeys = [...new Set([
    ...classifications.map((row) => row.sourceKey),
    LEGACY_AMKO_SOURCE_KEY,
  ])];
  for (let index = 0; index < sourceKeys.length; index += 200) {
    await knex('crm_accounts')
      .where({ brand_id: brand.id })
      .whereIn('source_key', sourceKeys.slice(index, index + 200))
      .update({
        ownership_type: 'UNKNOWN',
        ownership_confidence: null,
        ownership_verified_at: null,
        ownership_source_url: null,
        ownership_evidence_json: null,
      });
  }
};

exports.BRAND_CODE = BRAND_CODE;
exports.SOURCE_ROW_COUNT = SOURCE_ROW_COUNT;
exports.EXPECTED_COUNTS = EXPECTED_COUNTS;
exports.classificationForAccount = classificationForAccount;
exports.evidenceJson = evidenceJson;
exports.validateClassifications = validateClassifications;
