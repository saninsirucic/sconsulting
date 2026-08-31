const { v4: uuidv4 } = require('uuid');
const manifest = require('../data/haccpPublicBihAccounts20260827.json');
const ownershipAudit = require('../data/fsAppOwnership20260827.json');

const MIGRATION_ID = '20260827172000_create_haccp_public_bih_brand';
const MIGRATION_ACTOR = 'migration:20260827172000';
const SOURCE_BRAND_CODE = 'FS_APP';
const TARGET_BRAND = Object.freeze({
  id: 'brand-haccp-public',
  code: 'HACCP_PUBLIC',
  slug: 'haccp-javni-sektor',
  name: 'HACCP javni sektor'
});
const EXPECTED_ACCOUNT_COUNT = 106;
const EXCLUDED_PUBLIC_HR_SOURCE_KEY = 'FS_APP:NEW_20260827:64';
const EXPECTED_RESET_SOURCE_KEYS = Object.freeze(['FS_APP:17', 'FS_APP:91', 'FS_APP:284']);
const UNSENT_QUEUE_STATUSES = Object.freeze([
  'PENDING', 'APPROVED', 'SCHEDULED', 'FAILED', 'NOT_APPROVED'
]);
const HACCP_ONLY_NOTE = 'HACCP javni sektor: nuditi isključivo klasičnu implementaciju, reviziju i održavanje HACCP sistema; bez FS App, digitalne platforme ili softverske ponude.';
const MAIL_SUBJECT = 'Implementacija i održavanje HACCP sistema – {{KOMITENT}}';
const MAIL_BODY = `Poštovani,

obraćamo Vam se ispred S-Consulting Group povodom stručne podrške pri uspostavljanju, reviziji i redovnom održavanju HACCP sistema za {{KOMITENT}}.

Usluga obuhvata snimanje postojećeg stanja, izradu ili usklađivanje HACCP dokumentacije, definisanje procedura i evidencija, obuku zaposlenih, periodične interne provjere i stručnu podršku u održavanju sistema.

Cilj je da HACCP sistem bude praktično primijenjen, ažuran i usklađen sa stvarnim procesima Vaše organizacije.

Ako Vam je tema aktuelna, predlažemo kratak razgovor radi pregleda potreba i dogovora o narednim koracima.`;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function countryCode(value) {
  const normalized = normalizeText(value);
  if (/bosna|hercegovina|(^|\W)bih(\W|$)/.test(normalized)) return 'BA';
  if (/hrvatska|croatia/.test(normalized)) return 'HR';
  if (/srbija|serbia/.test(normalized)) return 'RS';
  return 'UNKNOWN';
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

function accountCountry(account) {
  const source = parseJson(account && account.source_data_json);
  return source['Država'] ?? source['DRŽAVA'] ?? source.DRZAVA ?? source.country ?? '';
}

function validateManifest() {
  if (!Array.isArray(manifest) || manifest.length !== EXPECTED_ACCOUNT_COUNT) {
    throw new Error(`HACCP javni sektor manifest mora sadržavati tačno ${EXPECTED_ACCOUNT_COUNT} zapisa.`);
  }
  const ownershipBySourceKey = new Map(ownershipAudit.map((row) => [row.sourceKey, row]));
  const sourceKeys = new Set();
  for (const row of manifest) {
    if (!row || typeof row.sourceKey !== 'string' || !row.sourceKey.startsWith('FS_APP:')
      || typeof row.companyName !== 'string' || !row.companyName.trim()) {
      throw new Error(`Neispravan HACCP javni sektor zapis: ${JSON.stringify(row)}`);
    }
    if (sourceKeys.has(row.sourceKey)) {
      throw new Error(`Dupli HACCP javni sektor source_key: ${row.sourceKey}`);
    }
    if (row.sourceKey === EXCLUDED_PUBLIC_HR_SOURCE_KEY) {
      throw new Error('Pleter-usluge je hrvatski javni zapis i ne smije biti u BiH HACCP brendu.');
    }
    const audit = ownershipBySourceKey.get(row.sourceKey);
    if (!audit || audit.ownership !== 'PUBLIC' || audit.companyName !== row.companyName) {
      throw new Error(`Manifest nije usklađen sa vlasničkim auditom: ${row.sourceKey}`);
    }
    sourceKeys.add(row.sourceKey);
  }
  return sourceKeys;
}

function removeLegacyMailSentComment(comment) {
  const original = comment === null || comment === undefined ? null : String(comment);
  if (!original) return { comment: original, removedLine: null };
  const mailSent = /^mail\s+poslan\s+\d{1,2}\.\d{1,2}\.\d{4}\.?\s*[-–—]\s*fs\s*app\.$/i;
  const quickRecord = /^poslat\s+dopis\s+\d{1,2}\.\d{1,2}\.\d{4}\.?(?:\s+u\s+\d{1,2}:\d{2})?\.$/i;
  let removedLine = null;
  const kept = original.split(/\r?\n/).filter((line) => {
    if (!removedLine && (mailSent.test(line.trim()) || quickRecord.test(line.trim()))) {
      removedLine = line;
      return false;
    }
    return true;
  });
  const cleaned = kept.join('\n').trim();
  return { comment: cleaned || null, removedLine };
}

function appendHaccpOnlyNote(notes) {
  const original = String(notes || '').trim();
  if (original.includes(HACCP_ONLY_NOTE)) return original;
  return [original, HACCP_ONLY_NOTE].filter(Boolean).join('\n');
}

function chunks(values, size = 25) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function sameStringSet(left, right) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((value) => rightSet.has(value));
}

async function restoreDeletedRows(trx, table, rows) {
  if (!rows.length) return;
  const ids = rows.map((row) => row.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Rollback snapshot za ${table} sadrži duple ID vrijednosti.`);
  }
  const existing = await trx(table).whereIn('id', ids).select('id');
  if (existing.length) {
    throw new Error(`Rollback je zaustavljen jer ${table} već sadrži jedan od obrisanih redova.`);
  }
  for (const batch of chunks(rows, 100)) await trx(table).insert(batch);
}

async function ensureTargetBrand(trx, now) {
  const [byCode, byId, bySlug] = await Promise.all([
    trx('crm_brands').where({ code: TARGET_BRAND.code }).first(),
    trx('crm_brands').where({ id: TARGET_BRAND.id }).first(),
    trx('crm_brands').where({ slug: TARGET_BRAND.slug }).first()
  ]);
  if (!byCode) {
    if (byId || bySlug) {
      throw new Error('ID ili slug HACCP javni sektor brenda već koristi drugi brend.');
    }
    await trx('crm_brands').insert({
      ...TARGET_BRAND,
      daily_limit: 30,
      active: true,
      created_at: now,
      updated_at: now
    });
    return trx('crm_brands').where({ id: TARGET_BRAND.id }).first();
  }
  if (byCode.id !== TARGET_BRAND.id || byCode.slug !== TARGET_BRAND.slug) {
    throw new Error('Postojeći HACCP javni sektor brend nema očekivani ID i slug.');
  }
  return byCode;
}

async function ensureSettings(trx, now) {
  const existing = await trx('crm_mail_automation_settings')
    .where({ brand_id: TARGET_BRAND.id }).first();
  if (existing) return;
  await trx('crm_mail_automation_settings').insert({
    brand_id: TARGET_BRAND.id,
    enabled: false,
    paused: true,
    auto_send: false,
    daily_limit: 30,
    workdays_json: JSON.stringify([1, 2, 3, 4, 5]),
    send_window_start: '09:00',
    send_window_end: '15:00',
    send_interval_minutes: 5,
    follow_up_days: 7,
    subject: MAIL_SUBJECT,
    body_text: MAIL_BODY,
    report_enabled: true,
    report_time: '16:00',
    report_recipient: 'info@s-consulting.ba',
    updated_by: MIGRATION_ACTOR,
    created_at: now,
    updated_at: now
  });
}

async function cloneFsAppAccess(trx, sourceBrandId, now) {
  const sourceAccess = await trx('app_user_brand_access')
    .where({ brand_id: sourceBrandId })
    .select('user_id', 'can_read', 'can_write');
  for (const batch of chunks(sourceAccess, 100)) {
    if (!batch.length) continue;
    await trx('app_user_brand_access').insert(batch.map((row) => ({
      id: uuidv4(),
      user_id: row.user_id,
      brand_id: TARGET_BRAND.id,
      can_read: row.can_read,
      can_write: row.can_write,
      created_at: now,
      updated_at: now
    }))).onConflict(['user_id', 'brand_id']).ignore();
  }
}

function validateAccounts(accounts, manifestKeys, sourceBrandId) {
  const bySourceKey = new Map();
  for (const account of accounts) {
    const rows = bySourceKey.get(account.source_key) || [];
    rows.push(account);
    bySourceKey.set(account.source_key, rows);
  }
  for (const sourceKey of manifestKeys) {
    const matches = bySourceKey.get(sourceKey) || [];
    if (matches.length !== 1) {
      throw new Error(`Očekivan je tačno jedan CRM račun za ${sourceKey}, pronađeno ${matches.length}.`);
    }
    const account = matches[0];
    if (![sourceBrandId, TARGET_BRAND.id].includes(account.brand_id)) {
      throw new Error(`${sourceKey} se nalazi u neočekivanom CRM brendu.`);
    }
    if (account.archived_at) throw new Error(`${sourceKey} je arhiviran i ne može se automatski prenijeti.`);
    if (account.ownership_type !== 'PUBLIC') {
      throw new Error(`${sourceKey} nije potvrđen kao PUBLIC.`);
    }
    if (countryCode(accountCountry(account)) !== 'BA') {
      throw new Error(`${sourceKey} nema eksplicitno potvrđenu državu Bosnu i Hercegovinu.`);
    }
  }
}

exports.up = async function up(knex) {
  const manifestKeys = [...validateManifest()];
  for (const table of ['crm_mail_automation_settings', 'crm_mail_queue']) {
    if (!await knex.schema.hasTable(table)) {
      throw new Error(`Nedostaje obavezna tabela ${table} za HACCP javni sektor migraciju.`);
    }
  }

  await knex.transaction(async (trx) => {
    const now = new Date();
    const sourceBrand = await trx('crm_brands').where({ code: SOURCE_BRAND_CODE }).first();
    if (!sourceBrand) throw new Error('FS App CRM brend nije pronađen.');
    const targetBrand = await ensureTargetBrand(trx, now);
    await ensureSettings(trx, now);
    await cloneFsAppAccess(trx, sourceBrand.id, now);

    await trx('crm_mail_automation_settings')
      .whereIn('brand_id', [sourceBrand.id, targetBrand.id].sort())
      .orderBy('brand_id').forUpdate();
    const accounts = await trx('crm_accounts').whereIn('source_key', manifestKeys)
      .select('*').orderBy('source_key').forUpdate();
    validateAccounts(accounts, manifestKeys, sourceBrand.id);
    const moving = accounts.filter((account) => account.brand_id === sourceBrand.id);
    if (!moving.length) return;

    const emailSentSourceKeys = moving
      .filter((account) => account.status === 'EMAIL_SENT')
      .map((account) => account.source_key).sort();
    if (!sameStringSet(emailSentSourceKeys, EXPECTED_RESET_SOURCE_KEYS)) {
      throw new Error(`Neočekivani EMAIL_SENT HACCP javni sektor zapisi: ${emailSentSourceKeys.join(', ')}`);
    }

    const movingIds = moving.map((account) => account.id);
    const mailRows = await trx('crm_mail_queue')
      .where({ brand_id: sourceBrand.id }).whereIn('account_id', movingIds)
      .select('*').orderBy('id').forUpdate();
    if (mailRows.some((row) => row.status === 'SENDING')) {
      throw new Error('Slanje maila je u toku za jedan od HACCP javni sektor zapisa.');
    }
    const mailByAccount = new Map();
    for (const row of mailRows) {
      const rows = mailByAccount.get(row.account_id) || [];
      rows.push(row);
      mailByAccount.set(row.account_id, rows);
    }

    const pendingAssignments = await trx('crm_daily_assignments')
      .where({ brand_id: sourceBrand.id, status: 'PENDING' })
      .whereIn('account_id', movingIds).select('*').orderBy('id').forUpdate();
    const assignmentsByAccount = new Map();
    for (const row of pendingAssignments) {
      const rows = assignmentsByAccount.get(row.account_id) || [];
      rows.push(row);
      assignmentsByAccount.set(row.account_id, rows);
    }
    if (pendingAssignments.length) {
      await trx('crm_daily_assignments')
        .whereIn('id', pendingAssignments.map((row) => row.id)).delete();
    }
    const unsentMailRows = mailRows.filter((row) => UNSENT_QUEUE_STATUSES.includes(row.status));
    if (unsentMailRows.length) {
      await trx('crm_mail_queue').whereIn('id', unsentMailRows.map((row) => row.id)).delete();
    }

    const activities = [];
    for (const account of moving) {
      const resetEmailState = account.status === 'EMAIL_SENT';
      const cleaned = resetEmailState
        ? removeLegacyMailSentComment(account.comment)
        : { comment: account.comment, removedLine: null };
      if (resetEmailState && !cleaned.removedLine) {
        throw new Error(`${account.source_key} nema očekivani automatski mail-sent red u komentaru.`);
      }
      const relatedMailRows = mailByAccount.get(account.id) || [];
      const preservedQueueStatuses = relatedMailRows
        .filter((row) => ['SENT', 'SKIPPED'].includes(row.status))
        .map((row) => row.status);
      const deletedQueueStatuses = relatedMailRows
        .filter((row) => UNSENT_QUEUE_STATUSES.includes(row.status))
        .map((row) => row.status);
      const nextStatus = resetEmailState ? 'NEW' : account.status;
      const updated = await trx('crm_accounts').where({
        id: account.id,
        brand_id: sourceBrand.id
      }).update({
        brand_id: targetBrand.id,
        status: nextStatus,
        comment: cleaned.comment,
        notes: appendHaccpOnlyNote(account.notes),
        last_contact_at: resetEmailState ? null : account.last_contact_at,
        next_contact_at: resetEmailState ? null : account.next_contact_at,
        updated_by: MIGRATION_ACTOR,
        updated_at: now
      });
      if (Number(updated) !== 1) {
        throw new Error(`${account.source_key} je promijenjen tokom HACCP javni sektor migracije.`);
      }
      activities.push({
        id: uuidv4(),
        account_id: account.id,
        brand_id: targetBrand.id,
        user_id: null,
        activity_type: 'ACCOUNT_TRANSFERRED',
        from_status: account.status,
        to_status: nextStatus,
        notes: `Prebačeno iz ${sourceBrand.name} u ${targetBrand.name}; ponuda je isključivo klasična HACCP usluga.`,
        metadata_json: JSON.stringify({
          migrationId: MIGRATION_ID,
          reason: 'PUBLIC_BIH_CLASSICAL_HACCP_ONLY',
          sourceKey: account.source_key,
          fromBrandId: sourceBrand.id,
          fromBrandCode: sourceBrand.code,
          fromBrandName: sourceBrand.name,
          toBrandId: targetBrand.id,
          toBrandCode: targetBrand.code,
          toBrandName: targetBrand.name,
          previousStatus: account.status,
          statusResetTo: resetEmailState ? 'NEW' : null,
          previousComment: account.comment,
          removedMailSentCommentLine: cleaned.removedLine,
          previousNotes: account.notes,
          previousLastContactAt: account.last_contact_at,
          previousNextContactAt: account.next_contact_at,
          previousUpdatedBy: account.updated_by,
          previousUpdatedAt: account.updated_at,
          preservedQueueStatuses,
          deletedQueueStatuses,
          deletedQueueRows: relatedMailRows
            .filter((row) => UNSENT_QUEUE_STATUSES.includes(row.status)),
          deletedPendingAssignments: assignmentsByAccount.get(account.id) || [],
          historicalMailAndActivitiesRemainInBrand: sourceBrand.code
        }),
        occurred_at: now,
        created_at: now
      });
    }
    for (const batch of chunks(activities)) await trx('crm_activities').insert(batch);
  });
};

async function requireEmptyBrandTable(trx, table, brandId) {
  if (!await trx.schema.hasTable(table)) return;
  const row = await trx(table).where({ brand_id: brandId }).count({ count: '*' }).first();
  if (Number(row.count) > 0) {
    throw new Error(`Rollback je zaustavljen jer ${table} sadrži nove HACCP javni sektor podatke.`);
  }
}

exports.down = async function down(knex) {
  const manifestKeys = [...validateManifest()];
  await knex.transaction(async (trx) => {
    const targetBrand = await trx('crm_brands').where({ code: TARGET_BRAND.code }).first();
    if (!targetBrand) return;
    if (targetBrand.id !== TARGET_BRAND.id || targetBrand.slug !== TARGET_BRAND.slug) {
      throw new Error('Rollback je zaustavljen zbog neočekivanog HACCP javni sektor brenda.');
    }
    const sourceBrand = await trx('crm_brands').where({ code: SOURCE_BRAND_CODE }).first();
    if (!sourceBrand) throw new Error('FS App CRM brend nije pronađen za rollback.');

    const targetAccounts = await trx('crm_accounts')
      .where({ brand_id: targetBrand.id }).select('*').orderBy('source_key').forUpdate();
    if (targetAccounts.length !== EXPECTED_ACCOUNT_COUNT
      || !sameStringSet(targetAccounts.map((row) => row.source_key), manifestKeys)) {
      throw new Error('Rollback je zaustavljen jer HACCP javni sektor brend više nema izvornih 106 zapisa.');
    }
    for (const table of [
      'crm_mail_queue', 'crm_daily_assignments', 'crm_mail_attachments',
      'crm_mail_daily_reports', 'crm_calendar_meetings'
    ]) {
      await requireEmptyBrandTable(trx, table, targetBrand.id);
    }
    const settings = await trx('crm_mail_automation_settings')
      .where({ brand_id: targetBrand.id }).first();
    if (settings && settings.updated_by !== MIGRATION_ACTOR) {
      throw new Error('Rollback je zaustavljen jer su postavke HACCP javni sektor maila naknadno mijenjane.');
    }

    const targetActivities = await trx('crm_activities')
      .where({ brand_id: targetBrand.id }).select('*').orderBy('created_at').forUpdate();
    const auditByAccount = new Map();
    for (const activity of targetActivities) {
      const metadata = parseJson(activity.metadata_json);
      if (activity.activity_type !== 'ACCOUNT_TRANSFERRED' || metadata.migrationId !== MIGRATION_ID
        || auditByAccount.has(activity.account_id)) {
        throw new Error('Rollback je zaustavljen jer HACCP javni sektor ima naknadne aktivnosti.');
      }
      auditByAccount.set(activity.account_id, { activity, metadata });
    }
    if (auditByAccount.size !== EXPECTED_ACCOUNT_COUNT) {
      throw new Error('Rollback nema potpuni audit za svih 106 prenesenih zapisa.');
    }

    const deletedQueueRows = [];
    const deletedPendingAssignments = [];
    for (const account of targetAccounts) {
      const audit = auditByAccount.get(account.id);
      if (!audit || audit.metadata.sourceKey !== account.source_key) {
        throw new Error(`Rollback audit nije pronađen za ${account.source_key}.`);
      }
      const queueSnapshots = Array.isArray(audit.metadata.deletedQueueRows)
        ? audit.metadata.deletedQueueRows : [];
      const assignmentSnapshots = Array.isArray(audit.metadata.deletedPendingAssignments)
        ? audit.metadata.deletedPendingAssignments : [];
      if (queueSnapshots.some((row) => row.account_id !== account.id
        || row.brand_id !== sourceBrand.id || !UNSENT_QUEUE_STATUSES.includes(row.status))) {
        throw new Error(`Rollback mail snapshot nije ispravan za ${account.source_key}.`);
      }
      if (assignmentSnapshots.some((row) => row.account_id !== account.id
        || row.brand_id !== sourceBrand.id || row.status !== 'PENDING')) {
        throw new Error(`Rollback dnevni snapshot nije ispravan za ${account.source_key}.`);
      }
      deletedQueueRows.push(...queueSnapshots);
      deletedPendingAssignments.push(...assignmentSnapshots);
      await trx('crm_accounts').where({ id: account.id, brand_id: targetBrand.id }).update({
        brand_id: sourceBrand.id,
        status: audit.metadata.previousStatus,
        comment: audit.metadata.previousComment ?? null,
        notes: audit.metadata.previousNotes ?? null,
        last_contact_at: audit.metadata.previousLastContactAt ?? null,
        next_contact_at: audit.metadata.previousNextContactAt ?? null,
        updated_by: audit.metadata.previousUpdatedBy ?? null,
        updated_at: audit.metadata.previousUpdatedAt || new Date()
      });
    }
    await restoreDeletedRows(trx, 'crm_mail_queue', deletedQueueRows);
    await restoreDeletedRows(trx, 'crm_daily_assignments', deletedPendingAssignments);
    await trx('crm_activities').whereIn(
      'id', [...auditByAccount.values()].map(({ activity }) => activity.id)
    ).delete();
    await trx('app_user_brand_access').where({ brand_id: targetBrand.id }).delete();
    await trx('crm_mail_automation_settings').where({ brand_id: targetBrand.id }).delete();
    await trx('crm_brands').where({ id: targetBrand.id }).delete();
  });
};

exports.EXPECTED_ACCOUNT_COUNT = EXPECTED_ACCOUNT_COUNT;
exports.EXPECTED_RESET_SOURCE_KEYS = EXPECTED_RESET_SOURCE_KEYS;
exports.HACCP_ONLY_NOTE = HACCP_ONLY_NOTE;
exports.MAIL_BODY = MAIL_BODY;
exports.MAIL_SUBJECT = MAIL_SUBJECT;
exports.MIGRATION_ID = MIGRATION_ID;
exports.TARGET_BRAND = TARGET_BRAND;
exports.accountCountry = accountCountry;
exports.appendHaccpOnlyNote = appendHaccpOnlyNote;
exports.countryCode = countryCode;
exports.removeLegacyMailSentComment = removeLegacyMailSentComment;
exports.validateManifest = validateManifest;
