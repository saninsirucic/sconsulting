const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');
const manifest = require('../data/haccpPublicBihAccounts20260827.json');
const baseMigration = require('../migrations/20260813120000_create_commercial_crm');
const tokenMigration = require('../migrations/20260813130000_add_app_user_token_version');
const sanPestMigration = require('../migrations/20260814110000_seed_san_pest_crm');
const mailMigration = require('../migrations/20260815120000_add_commercial_mail_automation');
const fsAppMigration = require('../migrations/20260817100000_import_fs_app_accounts');
const manualMailMigration = require('../migrations/20260817130000_add_manual_commercial_mail_campaigns');
const reportMigration = require('../migrations/20260818100000_add_commercial_mail_schedule_reports');
const ccMigration = require('../migrations/20260818130000_add_commercial_recipient_cc');
const intervalMigration = require('../migrations/20260818150000_set_commercial_mail_interval_five');
const adminCallMigration = require('../migrations/20260823130000_add_admin_call_request');
const calendarMigration = require('../migrations/20260825120000_create_crm_calendar_meetings');
const visiocastLeadsMigration = require('../migrations/20260827140000_import_visiocast_new_leads');
const fsAppLeadsMigration = require('../migrations/20260827160000_import_fs_app_new_leads');
const ownershipTypeMigration = require('../migrations/20260827170000_add_account_ownership_type');
const ownershipDataMigration = require('../migrations/20260827171000_classify_fs_app_ownership');
const haccpPublicMigration = require('../migrations/20260827172000_create_haccp_public_bih_brand');
const { manageUser } = require('../scripts/manageUser');
const {
  accountWithBrand,
  createAccount,
  normalizeBrandCode,
  transferAccount,
  updateAccount
} = require('../commercial/service');

const SOURCE_BRAND_ID = 'brand-fs-app';
const TARGET_BRAND_ID = haccpPublicMigration.TARGET_BRAND.id;
const FIXED_NOW = new Date('2026-08-27T11:38:00.000Z');

async function productionDb(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  for (const migration of [
    baseMigration, tokenMigration, sanPestMigration, mailMigration, fsAppMigration,
    manualMailMigration, reportMigration, ccMigration, intervalMigration, adminCallMigration,
    calendarMigration, visiocastLeadsMigration
  ]) await migration.up(db);
  await db('crm_accounts').where({ source_key: 'FS_APP:1', brand_id: SOURCE_BRAND_ID })
    .update({ brand_id: 'brand-visiocast' });
  await db('crm_accounts').where({ source_key: 'VISIOCAST:9', brand_id: 'brand-visiocast' })
    .update({ brand_id: SOURCE_BRAND_ID });
  await fsAppLeadsMigration.up(db);
  await ownershipTypeMigration.up(db);
  await ownershipDataMigration.up(db);

  await db('app_users').insert({
    id: 'existing-commercial-user',
    username: 'existing-commercial',
    username_normalized: 'existing-commercial',
    password_hash: 'unused-test-hash',
    display_name: 'Existing Commercial',
    role: 'komercijala',
    active: true,
    must_change_password: false,
    token_version: 0,
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW
  });
  await db('app_user_brand_access').insert({
    id: 'existing-fs-app-access',
    user_id: 'existing-commercial-user',
    brand_id: SOURCE_BRAND_ID,
    can_read: true,
    can_write: false,
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW
  });

  const resetComments = new Map([
    ['FS_APP:17', 'Sačuvati ovaj red.\nMail poslan 27.08.2026. – FS App.'],
    ['FS_APP:91', 'Mail poslan 27.08.2026. – FS App.'],
    ['FS_APP:284', 'Sačuvati i ovaj red.\nPoslat dopis 27.08.2026. u 13:38.']
  ]);
  for (const sourceKey of haccpPublicMigration.EXPECTED_RESET_SOURCE_KEYS) {
    await db('crm_accounts').where({ brand_id: SOURCE_BRAND_ID, source_key: sourceKey }).update({
      status: 'EMAIL_SENT',
      comment: resetComments.get(sourceKey),
      last_contact_at: FIXED_NOW,
      next_contact_at: new Date('2026-09-03T11:38:00.000Z'),
      updated_by: 'commercial-mail-bot',
      updated_at: FIXED_NOW
    });
  }

  const accounts = await db('crm_accounts').where({ brand_id: SOURCE_BRAND_ID })
    .whereIn('source_key', manifest.map((row) => row.sourceKey)).select('*');
  const bySourceKey = new Map(accounts.map((row) => [row.source_key, row]));
  assert.equal(bySourceKey.size, 106);

  const sentKeys = haccpPublicMigration.EXPECTED_RESET_SOURCE_KEYS;
  const unsentKeys = manifest.map((row) => row.sourceKey)
    .filter((sourceKey) => !sentKeys.includes(sourceKey)).slice(0, 5);
  const queueDefinitions = [
    ...sentKeys.map((sourceKey) => ({ sourceKey, status: 'SENT' })),
    ...unsentKeys.slice(0, 4).map((sourceKey) => ({ sourceKey, status: 'PENDING' })),
    { sourceKey: unsentKeys[4], status: 'NOT_APPROVED' }
  ];
  await db('crm_mail_queue').insert(queueDefinitions.map((definition, index) => ({
    id: `historic-queue-${index + 1}`,
    brand_id: SOURCE_BRAND_ID,
    account_id: bySourceKey.get(definition.sourceKey).id,
    queue_date: '2026-08-27',
    sequence_number: index + 1,
    recipient_email: `public-${index + 1}@example.ba`,
    cc_emails_json: '[]',
    subject: 'Stari FS App mail',
    body_text: 'Stari sadržaj',
    status: definition.status,
    attempts: definition.status === 'SENT' ? 1 : 0,
    sent_at: definition.status === 'SENT' ? FIXED_NOW : null,
    provider_message_id: definition.status === 'SENT' ? `provider-${index + 1}` : null,
    created_by: 'test-production-snapshot',
    created_at: FIXED_NOW,
    updated_at: FIXED_NOW
  })));
  await db('crm_activities').insert(sentKeys.map((sourceKey, index) => ({
    id: `historic-send-activity-${index + 1}`,
    account_id: bySourceKey.get(sourceKey).id,
    brand_id: SOURCE_BRAND_ID,
    user_id: 'commercial-mail-bot',
    activity_type: 'COMMERCIAL_EMAIL_SENT',
    from_status: 'NEW',
    to_status: 'EMAIL_SENT',
    notes: 'Historijski poslani FS App mail.',
    metadata_json: JSON.stringify({ queueId: `historic-queue-${index + 1}` }),
    occurred_at: FIXED_NOW,
    created_at: FIXED_NOW
  })));
  await db('crm_daily_assignments').insert([
    ...unsentKeys.map((sourceKey, index) => ({
      id: `pending-assignment-${index + 1}`,
      user_id: 'existing-commercial-user',
      brand_id: SOURCE_BRAND_ID,
      account_id: bySourceKey.get(sourceKey).id,
      assignment_date: '2026-08-27',
      sequence_number: index + 1,
      status: 'PENDING',
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW
    })),
    {
      id: 'historic-completed-assignment',
      user_id: 'existing-commercial-user',
      brand_id: SOURCE_BRAND_ID,
      account_id: bySourceKey.get(sentKeys[0]).id,
      assignment_date: '2026-08-27',
      sequence_number: 99,
      status: 'EMAIL_SENT',
      notes: 'Historijski završena FS App aktivnost.',
      completed_at: FIXED_NOW,
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW
    }
  ]);

  return {
    db,
    before: new Map(accounts.map((account) => [account.source_key, account])),
    resetComments,
    unsentKeys
  };
}

async function ownershipCounts(db, brandId) {
  const rows = await db('crm_accounts').where({ brand_id: brandId })
    .select('ownership_type').count({ count: '*' }).groupBy('ownership_type');
  return Object.fromEntries(rows.map((row) => [row.ownership_type, Number(row.count)]));
}

test('manifest, identitet i aliasi novog HACCP javni sektor brenda su deterministički', () => {
  const sourceKeys = haccpPublicMigration.validateManifest();
  assert.equal(sourceKeys.size, 106);
  assert.equal(manifest.length, 106);
  assert.equal(new Set(manifest.map((row) => row.sourceKey)).size, 106);
  assert.equal(sourceKeys.has('FS_APP:NEW_20260827:64'), false);
  assert.deepEqual(haccpPublicMigration.TARGET_BRAND, {
    id: 'brand-haccp-public',
    code: 'HACCP_PUBLIC',
    slug: 'haccp-javni-sektor',
    name: 'HACCP javni sektor'
  });
  for (const alias of [
    'HACCP_PUBLIC', 'haccp-public', 'HACCPPUBLIC', 'haccp-javni-sektor',
    'HACCP_PUBLIC_BIH', 'public-bih'
  ]) assert.equal(normalizeBrandCode(alias), 'HACCP_PUBLIC');

  const cleaned = haccpPublicMigration.removeLegacyMailSentComment(
    'Važna ručna napomena.\nMail poslan 27.08.2026. – FS App.'
  );
  assert.equal(cleaned.comment, 'Važna ručna napomena.');
  assert.match(cleaned.removedLine, /Mail poslan/);
  assert.equal(
    haccpPublicMigration.removeLegacyMailSentComment('Ručna napomena bez mail reda.').comment,
    'Ručna napomena bez mail reda.'
  );
});

test('migracija prenosi samo 106 PUBLIC BiH računa, čuva historiju i postavlja HACCP-only mail', async (t) => {
  const { db, before, resetComments } = await productionDb(t);
  await haccpPublicMigration.up(db);

  const brand = await db('crm_brands').where({ id: TARGET_BRAND_ID }).first();
  assert.equal(brand.code, 'HACCP_PUBLIC');
  assert.equal(brand.slug, 'haccp-javni-sektor');
  assert.equal(brand.name, 'HACCP javni sektor');
  assert.equal(Boolean(brand.active), true);
  assert.equal(Number(brand.daily_limit), 30);

  const settings = await db('crm_mail_automation_settings').where({ brand_id: TARGET_BRAND_ID }).first();
  assert.equal(Boolean(settings.enabled), false);
  assert.equal(Boolean(settings.paused), true);
  assert.equal(Boolean(settings.auto_send), false);
  assert.equal(Number(settings.daily_limit), 30);
  assert.equal(Number(settings.send_interval_minutes), 5);
  assert.equal(settings.report_recipient, 'info@s-consulting.ba');
  assert.match(settings.subject, /\{\{KOMITENT\}\}/);
  assert.match(`${settings.subject}\n${settings.body_text}`, /implementacij|održavanj/i);
  assert.doesNotMatch(`${settings.subject}\n${settings.body_text}`, /FS\s*App|digital|platform|softver|aplikacij/i);
  assert.doesNotMatch(settings.body_text, /Srdačan pozdrav|S-Consulting Group\s*$/i);

  const targetAccounts = await db('crm_accounts').where({ brand_id: TARGET_BRAND_ID })
    .select('*').orderBy('source_key');
  assert.equal(targetAccounts.length, 106);
  assert.deepEqual(new Set(targetAccounts.map((row) => row.source_key)), new Set(manifest.map((row) => row.sourceKey)));
  assert.equal(targetAccounts.every((row) => row.ownership_type === 'PUBLIC'), true);
  assert.equal(targetAccounts.every((row) => haccpPublicMigration.countryCode(
    haccpPublicMigration.accountCountry(row)
  ) === 'BA'), true);
  assert.equal(targetAccounts.every((row) => row.notes.includes(haccpPublicMigration.HACCP_ONLY_NOTE)), true);
  for (const row of targetAccounts) {
    const original = before.get(row.source_key);
    assert.equal(row.ownership_confidence, original.ownership_confidence);
    assert.equal(row.ownership_source_url, original.ownership_source_url);
    assert.equal(row.ownership_evidence_json, original.ownership_evidence_json);
  }

  assert.deepEqual(await ownershipCounts(db, SOURCE_BRAND_ID), { MIXED: 1, PRIVATE: 706, PUBLIC: 1 });
  const remainingPublic = await db('crm_accounts')
    .where({ brand_id: SOURCE_BRAND_ID, ownership_type: 'PUBLIC' }).select('*');
  assert.equal(remainingPublic.length, 1);
  assert.equal(remainingPublic[0].source_key, 'FS_APP:NEW_20260827:64');
  assert.equal(haccpPublicMigration.countryCode(haccpPublicMigration.accountCountry(remainingPublic[0])), 'HR');

  const resetRows = targetAccounts.filter((row) => haccpPublicMigration.EXPECTED_RESET_SOURCE_KEYS.includes(row.source_key));
  assert.equal(resetRows.length, 3);
  for (const row of resetRows) {
    assert.equal(row.status, 'NEW');
    assert.equal(row.last_contact_at, null);
    assert.equal(row.next_contact_at, null);
    assert.doesNotMatch(String(row.comment || ''), /mail\s+poslan|poslat\s+dopis/i);
    if (row.source_key === 'FS_APP:17') assert.equal(row.comment, 'Sačuvati ovaj red.');
    if (row.source_key === 'FS_APP:284') assert.equal(row.comment, 'Sačuvati i ovaj red.');
  }

  const sourceQueue = await db('crm_mail_queue').where({ brand_id: SOURCE_BRAND_ID })
    .whereIn('account_id', targetAccounts.map((row) => row.id)).select('status');
  assert.deepEqual(sourceQueue.map((row) => row.status).sort(), ['SENT', 'SENT', 'SENT']);
  assert.equal(Number((await db('crm_mail_queue').where({ brand_id: TARGET_BRAND_ID })
    .count({ count: '*' }).first()).count), 0);
  assert.equal(Number((await db('crm_daily_assignments')
    .where({ brand_id: SOURCE_BRAND_ID, status: 'PENDING' })
    .whereIn('account_id', targetAccounts.map((row) => row.id)).count({ count: '*' }).first()).count), 0);
  assert.ok(await db('crm_daily_assignments').where({ id: 'historic-completed-assignment' }).first());
  assert.equal(Number((await db('crm_activities')
    .where({ brand_id: SOURCE_BRAND_ID, activity_type: 'COMMERCIAL_EMAIL_SENT' })
    .count({ count: '*' }).first()).count), 3);

  const transferActivities = await db('crm_activities')
    .where({ brand_id: TARGET_BRAND_ID, activity_type: 'ACCOUNT_TRANSFERRED' }).select('*');
  assert.equal(transferActivities.length, 106);
  const transferAudits = transferActivities.map((row) => JSON.parse(row.metadata_json));
  assert.equal(transferAudits.reduce(
    (sum, metadata) => sum + metadata.deletedQueueRows.length, 0
  ), 5);
  assert.equal(transferAudits.reduce(
    (sum, metadata) => sum + metadata.deletedPendingAssignments.length, 0
  ), 5);
  const resetAudits = transferAudits
    .filter((metadata) => metadata.statusResetTo === 'NEW');
  assert.deepEqual(resetAudits.map((metadata) => metadata.sourceKey).sort(),
    [...haccpPublicMigration.EXPECTED_RESET_SOURCE_KEYS].sort());
  for (const metadata of resetAudits) {
    assert.equal(metadata.previousStatus, 'EMAIL_SENT');
    assert.equal(metadata.previousComment, resetComments.get(metadata.sourceKey));
    assert.ok(metadata.previousLastContactAt);
    assert.ok(metadata.previousNextContactAt);
    assert.deepEqual(metadata.preservedQueueStatuses, ['SENT']);
  }

  const clonedAccess = await db('app_user_brand_access').where({
    user_id: 'existing-commercial-user', brand_id: TARGET_BRAND_ID
  }).first();
  assert.equal(Boolean(clonedAccess.can_read), true);
  assert.equal(Boolean(clonedAccess.can_write), false);

  const previousRounds = process.env.BCRYPT_ROUNDS;
  process.env.BCRYPT_ROUNDS = '4';
  t.after(() => {
    if (previousRounds === undefined) delete process.env.BCRYPT_ROUNDS;
    else process.env.BCRYPT_ROUNDS = previousRounds;
  });
  const output = [];
  const managed = await manageUser({
    db,
    args: { username: 'haccp-commercial', password: 'ValidPass11!' },
    output: (message) => output.push(message)
  });
  assert.equal(Number((await db('app_user_brand_access').where({ user_id: managed.id })
    .count({ count: '*' }).first()).count), 4);
  assert.match(output.join('\n'), /HACCP_PUBLIC/);

  await haccpPublicMigration.up(db);
  assert.equal(Number((await db('crm_activities')
    .where({ brand_id: TARGET_BRAND_ID, activity_type: 'ACCOUNT_TRANSFERRED' })
    .count({ count: '*' }).first()).count), 106);

  await haccpPublicMigration.down(db);
  assert.equal(await db('crm_brands').where({ id: TARGET_BRAND_ID }).first(), undefined);
  assert.equal(await db('crm_mail_automation_settings').where({ brand_id: TARGET_BRAND_ID }).first(), undefined);
  assert.equal(Number((await db('crm_accounts').where({ brand_id: SOURCE_BRAND_ID })
    .count({ count: '*' }).first()).count), 814);
  for (const sourceKey of haccpPublicMigration.EXPECTED_RESET_SOURCE_KEYS) {
    const restored = await db('crm_accounts').where({ brand_id: SOURCE_BRAND_ID, source_key: sourceKey }).first();
    assert.equal(restored.status, 'EMAIL_SENT');
    assert.equal(restored.comment, resetComments.get(sourceKey));
    assert.equal(restored.notes, before.get(sourceKey).notes);
    assert.ok(restored.last_contact_at);
    assert.ok(restored.next_contact_at);
  }
  assert.equal(Number((await db('crm_mail_queue').where({ brand_id: SOURCE_BRAND_ID, status: 'SENT' })
    .count({ count: '*' }).first()).count), 3);
  const restoredQueue = await db('crm_mail_queue').where({ brand_id: SOURCE_BRAND_ID })
    .select('status').orderBy('id');
  assert.deepEqual(restoredQueue.map((row) => row.status).sort(), [
    'NOT_APPROVED', 'PENDING', 'PENDING', 'PENDING', 'PENDING', 'SENT', 'SENT', 'SENT'
  ]);
  assert.equal(Number((await db('crm_daily_assignments').where({
    brand_id: SOURCE_BRAND_ID, status: 'PENDING'
  }).count({ count: '*' }).first()).count), 5);
});

test('migracija prekida bez djelimičnih izmjena ako produkcijska tri mail statusa više nisu očekivana', async (t) => {
  const { db } = await productionDb(t);
  await db('crm_accounts')
    .where({ brand_id: SOURCE_BRAND_ID })
    .whereIn('source_key', haccpPublicMigration.EXPECTED_RESET_SOURCE_KEYS)
    .update({ status: 'NEW' });

  await assert.rejects(
    haccpPublicMigration.up(db),
    /Neočekivani EMAIL_SENT HACCP javni sektor zapisi/
  );
  assert.equal(await db('crm_brands').where({ id: TARGET_BRAND_ID }).first(), undefined);
  assert.equal(Number((await db('crm_accounts').where({ brand_id: SOURCE_BRAND_ID })
    .count({ count: '*' }).first()).count), 814);
});

test('HACCP_PUBLIC invariant prisiljava PUBLIC i odbija nepotvrđene ili ne-BiH transfere', async (t) => {
  const { db } = await productionDb(t);
  await haccpPublicMigration.up(db);
  const targetBrand = await db('crm_brands').where({ id: TARGET_BRAND_ID }).first();
  const fsAppBrand = await db('crm_brands').where({ id: SOURCE_BRAND_ID }).first();
  const user = { id: 'director-test', role: 'direktor', authSource: 'env' };

  const created = await createAccount(db, targetBrand, user, {
    company_name: 'Nova javna ustanova',
    ownership_type: 'PRIVATE'
  });
  assert.equal(created.ownership_type, 'PUBLIC');
  assert.equal(haccpPublicMigration.accountCountry(
    await db('crm_accounts').where({ id: created.id }).first()
  ), 'Bosna i Hercegovina');
  const updated = await updateAccount(db, await accountWithBrand(db, created.id), user, {
    company_name: 'Nova javna ustanova',
    ownership_type: 'MIXED'
  });
  assert.equal(updated.ownership_type, 'PUBLIC');

  const privateAccount = await db('crm_accounts')
    .where({ brand_id: SOURCE_BRAND_ID, ownership_type: 'PRIVATE' }).first();
  await assert.rejects(
    transferAccount(db, await accountWithBrand(db, privateAccount.id), targetBrand, user),
    (error) => error.code === 'HACCP_PUBLIC_OWNERSHIP_REQUIRED'
  );
  const pleter = await db('crm_accounts').where({
    brand_id: SOURCE_BRAND_ID, source_key: 'FS_APP:NEW_20260827:64'
  }).first();
  await assert.rejects(
    transferAccount(db, await accountWithBrand(db, pleter.id), targetBrand, user),
    (error) => error.code === 'HACCP_PUBLIC_COUNTRY_REQUIRED'
  );

  const explicitSerbia = await createAccount(db, fsAppBrand, user, {
    company_name: 'Eksplicitno strani javni račun',
    ownership_type: 'PUBLIC'
  });
  await db('crm_accounts').where({ id: explicitSerbia.id }).update({
    source_data_json: JSON.stringify({ source: 'MANUAL', DRŽAVA: 'Srbija' })
  });
  await assert.rejects(
    transferAccount(db, await accountWithBrand(db, explicitSerbia.id), targetBrand, user),
    (error) => error.code === 'HACCP_PUBLIC_COUNTRY_REQUIRED'
  );

  const manual = await createAccount(db, fsAppBrand, user, {
    company_name: 'Bolnica Srbija',
    location: 'mreža RS',
    ownership_type: 'PUBLIC'
  });
  await assert.rejects(
    transferAccount(db, await accountWithBrand(db, manual.id), targetBrand, user),
    (error) => error.code === 'HACCP_PUBLIC_COUNTRY_REQUIRED'
  );
  await db('crm_accounts').where({ id: manual.id }).update({
    source_data_json: JSON.stringify({ source: 'MANUAL', DRŽAVA: 'Bosna i Hercegovina' })
  });
  const moved = await transferAccount(
    db, await accountWithBrand(db, manual.id), targetBrand, user
  );
  assert.equal(moved.account.brand_id, TARGET_BRAND_ID);
  assert.equal(moved.account.ownership_type, 'PUBLIC');
});
