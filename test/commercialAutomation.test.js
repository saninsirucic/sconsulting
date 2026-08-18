const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');
const crmMigration = require('../migrations/20260813120000_create_commercial_crm');
const automationMigration = require('../migrations/20260815120000_add_commercial_mail_automation');
const manualCampaignMigration = require('../migrations/20260817130000_add_manual_commercial_mail_campaigns');
const scheduleReportMigration = require('../migrations/20260818100000_add_commercial_mail_schedule_reports');
const recipientCcMigration = require('../migrations/20260818130000_add_commercial_recipient_cc');
const {
  getAutomationState,
  importApprovedDailyAssignments,
  prepareAutomationQueue,
  reviewAutomationCandidates,
  runAutomationTick,
  sendNextAutomatedMail,
  sendSelectedMails,
  updateCandidateRecipients,
  updateAutomationSettings
} = require('../commercial/automation');
const { businessDate, readDailyAssignments, updateDailyAssignment } = require('../commercial/service');

async function testDb(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await crmMigration.up(db);
  await automationMigration.up(db);
  await manualCampaignMigration.up(db);
  await scheduleReportMigration.up(db);
  await recipientCcMigration.up(db);
  return db;
}

async function addAccount(db, brand, suffix, overrides = {}) {
  const now = new Date();
  const row = {
    id: `automation-account-${suffix}`,
    brand_id: brand.id,
    source_key: `AUTO:${suffix}`,
    source_row_number: Number(suffix.replace(/\D/g, '')) || null,
    company_name: `Komitent ${suffix}`,
    email: `${suffix}@firma.ba`,
    status: 'NEW',
    priority: 'MEDIUM',
    currency: 'BAM',
    source_data_json: '{}',
    created_at: now,
    updated_at: now,
    ...overrides
  };
  await db('crm_accounts').insert(row);
  return row;
}

async function addAssignment(db, user, brand, account, suffix, overrides = {}) {
  const now = new Date();
  const row = {
    id: `assignment-${suffix}`,
    user_id: user.id,
    brand_id: brand.id,
    account_id: account.id,
    assignment_date: '2026-08-18',
    sequence_number: Number(String(suffix).replace(/\D/g, '')) || 1,
    status: 'PENDING',
    created_at: now,
    updated_at: now,
    ...overrides
  };
  await db('crm_daily_assignments').insert(row);
  return row;
}

const director = { id: 'director-sanin', username: 'sanin', role: 'direktor', displayName: 'Sanin' };

test('migracija kreira tri ugašena agenta i unaprijed priprema SAN Pest sadržaj', async (t) => {
  const db = await testDb(t);
  const rows = await db({ s: 'crm_mail_automation_settings' })
    .join({ b: 'crm_brands' }, 'b.id', 's.brand_id')
    .select('b.code', 's.*').orderBy('b.code');

  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => !Boolean(row.enabled) && Boolean(row.paused)));
  const sanPest = rows.find((row) => row.code === 'SAN_PEST');
  assert.equal(sanPest.subject, automationMigration.SAN_PEST_SUBJECT);
  assert.match(sanPest.body_text, /SanPest Platform/);
  assert.equal(Number(sanPest.daily_limit), 30);
  assert.equal(Boolean(sanPest.auto_send), false);
  assert.equal(Boolean(sanPest.report_enabled), true);
  assert.equal(sanPest.report_time, '16:00');
  assert.equal(sanPest.report_recipient, 'info@s-consulting.ba');
});

test('dnevni red bira samo poznate validne CRM adrese i ne ponavlja komitente', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  await addAccount(db, brand, '1', { email: 'prvi@firma.ba', priority: 'HIGH' });
  await addAccount(db, brand, '2', { email: 'drugi@firma.ba', status: 'CALL_REQUIRED' });
  await addAccount(db, brand, '3', { email: 'prvi@firma.ba' });
  await addAccount(db, brand, '4', { email: 'nije-mail' });
  await addAccount(db, brand, '5', { email: 'odbijen@firma.ba', status: 'REJECTED' });
  await addAccount(db, brand, '6', { email: 'arhiva@firma.ba', archived_at: new Date() });
  await updateAutomationSettings(db, brand, director, {
    subject: 'Digitalni HACCP za {{KOMITENT}}',
    body_text: 'Poštovani {{KOMITENT}}, ovo je prijedlog.',
    daily_limit: 30,
    enabled: false
  });

  const first = await prepareAutomationQueue(db, brand, director, { date: '2026-08-17' });
  const second = await prepareAutomationQueue(db, brand, director, { date: '2026-08-17' });

  assert.equal(first.queue.length, 2);
  assert.equal(second.queue.length, 2);
  assert.deepEqual(first.queue.map((row) => row.recipient_email), ['prvi@firma.ba', 'drugi@firma.ba']);
  assert.ok(first.queue.every((row) => row.status === 'PENDING'));
  assert.match(first.queue[0].subject, /Komitent 1/);
  assert.equal(await db('crm_mail_queue').count({ count: '*' }).first().then((row) => Number(row.count)), 2);
});

test('uspješno slanje odmah ažurira komentar, status, follow-up, aktivnost i dnevni zadatak', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const account = await addAccount(db, brand, '10', {
    email: 'kontakt@firma.ba',
    cc_emails_json: JSON.stringify(['auto-copy@firma.ba']),
    comment: 'Stara napomena'
  });
  const date = businessDate();
  await updateAutomationSettings(db, brand, director, {
    subject: 'Prijedlog za {{KOMITENT}}',
    body_text: 'Poštovani, predstavljamo rješenje.',
    enabled: true,
    auto_send: true,
    follow_up_days: 7
  });
  await prepareAutomationQueue(db, brand, director, { date });
  await reviewAutomationCandidates(db, brand, [account.id], 'APPROVED', { date });
  await db('crm_daily_assignments').insert({
    id: 'daily-assignment-automation',
    user_id: 'commercial-user',
    brand_id: brand.id,
    account_id: account.id,
    assignment_date: date,
    sequence_number: 1,
    status: 'PENDING',
    created_at: new Date(),
    updated_at: new Date()
  });
  const payloads = [];
  const outlookService = {
    config: { writeEnabled: true, mailbox: 'sales@s-consulting.ba' },
    async send(payload) {
      payloads.push(payload);
      return { success: true, accepted: true, id: 'graph-draft-id', conversationId: 'graph-conversation-id' };
    }
  };

  const result = await sendNextAutomatedMail(db, brand, {
    outlookService,
    actor: director,
    ignoreInterval: true,
    now: new Date()
  });

  assert.equal(result.sent, true);
  assert.equal(payloads.length, 1);
  assert.deepEqual(payloads[0].to, ['kontakt@firma.ba']);
  assert.deepEqual(payloads[0].cc, ['auto-copy@firma.ba']);
  assert.equal(payloads[0].bodyType, 'text');
  const queue = await db('crm_mail_queue').where({ account_id: account.id }).first();
  const saved = await db('crm_accounts').where({ id: account.id }).first();
  const activity = await db('crm_activities').where({ account_id: account.id, activity_type: 'AUTOMATED_EMAIL_SENT' }).first();
  const assignment = await db('crm_daily_assignments').where({ id: 'daily-assignment-automation' }).first();
  assert.equal(queue.status, 'SENT');
  assert.equal(queue.provider_message_id, 'graph-draft-id');
  assert.equal(saved.status, 'EMAIL_SENT');
  assert.match(saved.comment, /Stara napomena/);
  assert.match(saved.comment, /Mail poslan/);
  assert.match(activity.notes, /sales@s-consulting\.ba/);
  assert.ok(saved.last_contact_at);
  assert.ok(saved.next_contact_at);
  assert.equal(activity.to_status, 'EMAIL_SENT');
  assert.equal(assignment.status, 'EMAIL_SENT');
  assert.match(assignment.notes, /Mail poslan/);
});

test('ručna kampanja trajno čuva prilog, šalje samo označenog i više ga ne predlaže', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const commercial = { id: 'commercial-user', username: 'prodaja', role: 'komercijala', displayName: 'Prodaja' };
  const account = await addAccount(db, brand, '30', {
    email: 'kontakt30@firma.ba',
    status: 'CONTACTED',
    comment: 'Raniji razgovor'
  });
  const attachmentBytes = Buffer.from('%PDF-test-prilog%');
  const settings = await updateAutomationSettings(db, brand, commercial, {
    subject: 'FS App za {{KOMITENT}}',
    body: 'Poštovani {KOMITENT}, šaljemo Vam prezentaciju.',
    daily_limit: 30,
    attachment: {
      name: 'FS-App-prezentacija.pdf',
      type: 'application/pdf',
      size: attachmentBytes.length,
      data_base64: attachmentBytes.toString('base64')
    }
  });
  assert.equal(settings.attachment_name, 'FS-App-prezentacija.pdf');
  assert.equal(settings.attachment_size, attachmentBytes.length);

  const date = businessDate();
  const prepared = await prepareAutomationQueue(db, brand, commercial, { date });
  assert.equal(prepared.today.candidates.length, 1);
  assert.equal(prepared.today.candidates[0].account_id, account.id);
  assert.match(prepared.queue[0].subject, /Komitent 30/);

  const payloads = [];
  const outlookService = {
    config: { writeEnabled: true, mailbox: 'sales@s-consulting.ba' },
    async send(payload) {
      payloads.push(payload);
      return { success: true, accepted: true, id: 'manual-draft', conversationId: 'manual-conversation' };
    }
  };
  const blocked = await sendSelectedMails(db, brand, [account.id], {
    confirmed: true,
    actor: commercial,
    outlookService
  });
  assert.equal(blocked.success, false);
  assert.equal(blocked.sent_count, 0);
  assert.equal(payloads.length, 0);
  assert.match(blocked.results[0].error, /odobrite/i);

  await reviewAutomationCandidates(db, brand, [account.id], 'APPROVED', { date });
  const result = await sendSelectedMails(db, brand, [account.id], {
    confirmed: true,
    actor: commercial,
    outlookService
  });
  assert.equal(result.success, true);
  assert.equal(result.sent_count, 1);
  assert.equal(payloads.length, 1);
  assert.deepEqual(payloads[0].to, ['kontakt30@firma.ba']);
  assert.equal(payloads[0].attachments[0].name, 'FS-App-prezentacija.pdf');
  assert.equal(Buffer.from(payloads[0].attachments[0].contentBytes, 'base64').toString(), attachmentBytes.toString());

  const saved = await db('crm_accounts').where({ id: account.id }).first();
  const activity = await db('crm_activities').where({
    account_id: account.id,
    activity_type: 'COMMERCIAL_EMAIL_SENT'
  }).first();
  assert.equal(saved.status, 'EMAIL_SENT');
  assert.match(saved.comment, /Raniji razgovor/);
  assert.match(saved.comment, /Mail poslan \d{2}\.\d{2}\.\d{4}\. – FS App\./);
  assert.ok(activity);

  const state = await getAutomationState(db, brand, { date });
  assert.equal(state.today.sent_count, 1);
  assert.equal(state.today.candidates.length, 0);
  const tomorrowDate = new Date(`${date}T12:00:00.000Z`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrow = await prepareAutomationQueue(db, brand, commercial, {
    date: tomorrowDate.toISOString().slice(0, 10)
  });
  assert.equal(tomorrow.queue.some((item) => item.account_id === account.id), false);
});

test('isti mail se može odvojeno kandidovati po brendu, a komercijalista može urediti raspored svog brenda', async (t) => {
  const db = await testDb(t);
  const fsBrand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const sanBrand = await db('crm_brands').where({ code: 'SAN_PEST' }).first();
  const commercial = { id: 'commercial-user', username: 'prodaja', role: 'komercijala' };
  await addAccount(db, fsBrand, '40', { email: 'zajednicki@firma.ba' });
  await addAccount(db, sanBrand, '41', { email: 'zajednicki@firma.ba' });
  await updateAutomationSettings(db, fsBrand, commercial, { subject: 'FS naslov', body: 'FS sadržaj' });
  await updateAutomationSettings(db, sanBrand, commercial, { subject: 'SAN naslov', body: 'SAN sadržaj' });

  const fs = await prepareAutomationQueue(db, fsBrand, commercial, { date: '2026-08-17' });
  const san = await prepareAutomationQueue(db, sanBrand, commercial, { date: '2026-08-17' });
  assert.equal(fs.today.candidates.length, 1);
  assert.equal(san.today.candidates.length, 1);
  const settings = await updateAutomationSettings(db, fsBrand, commercial, {
    subject: 'FS naslov',
    body: 'FS sadržaj',
    enabled: true,
    auto_send: true,
    daily_limit: 20,
    workdays: [1, 2, 3, 4, 5],
    send_window_start: '09:00',
    send_window_end: '15:00',
    send_interval_minutes: 10,
    report_enabled: true,
    report_time: '16:00',
    report_recipient: 'info@s-consulting.ba'
  });
  assert.equal(settings.enabled, true);
  assert.equal(settings.auto_send, true);
  assert.equal(settings.daily_limit, 20);
  assert.equal(settings.report_recipient, 'info@s-consulting.ba');
  assert.deepEqual(settings.workdays, [1, 2, 3, 4, 5]);
});

test('komercijalista može brzo odobriti ili samo ukloniti prijedlog iz današnjeg reda', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const commercial = { id: 'commercial-user', username: 'prodaja', role: 'komercijala' };
  const approvedAccount = await addAccount(db, brand, 'approval-60', { email: 'odobri@firma.ba' });
  const removedAccount = await addAccount(db, brand, 'approval-61', { email: 'ne-odobri@firma.ba' });
  await updateAutomationSettings(db, brand, commercial, {
    subject: 'FS App za {{KOMITENT}}',
    body: 'Poštovani {{KOMITENT}}, predstavljamo FS App.',
    enabled: false,
    auto_send: true,
    daily_limit: 2
  });
  const date = '2026-08-18';
  await prepareAutomationQueue(db, brand, commercial, { date });
  await updateAutomationSettings(db, brand, commercial, { enabled: true, auto_send: true });
  const stillWaiting = await getAutomationState(db, brand, { date });
  assert.ok(stillWaiting.today.candidates.every((candidate) => candidate.status === 'PENDING'));

  const approved = await reviewAutomationCandidates(
    db, brand, [approvedAccount.id], 'APPROVED', { date }
  );
  assert.equal(approved.review.status, 'APPROVED');
  assert.equal(approved.review.updated_count, 1);
  assert.equal(approved.queue.find((row) => row.account_id === approvedAccount.id).status, 'APPROVED');

  const notApproved = await reviewAutomationCandidates(
    db, brand, [removedAccount.id], 'REJECTED', { date }
  );
  assert.equal(notApproved.review.status, 'NOT_APPROVED');
  assert.equal(notApproved.review.updated_count, 1);
  assert.equal(notApproved.today.candidates.some((row) => row.account_id === removedAccount.id), false);
  assert.equal(notApproved.queue.find((row) => row.account_id === removedAccount.id).status, 'NOT_APPROVED');

  const unchangedAccount = await db('crm_accounts').where({ id: removedAccount.id }).first();
  assert.equal(unchangedAccount.status, 'NEW');
  assert.equal(await db('crm_activities').where({ account_id: removedAccount.id }).first(), undefined);
});

test('danas neodobren prijedlog nije trajno potisnut i može se pojaviti narednog dana', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const commercial = { id: 'commercial-user', username: 'prodaja', role: 'komercijala' };
  const account = await addAccount(db, brand, 'approval-70', { email: 'sutra@firma.ba' });
  const replacement = await addAccount(db, brand, 'approval-71', { email: 'zamjena@firma.ba' });
  await updateAutomationSettings(db, brand, commercial, {
    subject: 'FS App prijedlog',
    body: 'Poštovani, predstavljamo FS App.',
    enabled: false,
    daily_limit: 1
  });

  await prepareAutomationQueue(db, brand, commercial, { date: '2026-08-18' });
  await reviewAutomationCandidates(db, brand, [account.id], 'REJECTED', { date: '2026-08-18' });
  const sameDay = await prepareAutomationQueue(db, brand, commercial, { date: '2026-08-18' });
  assert.equal(sameDay.today.prepared_count, 1);
  assert.equal(sameDay.today.candidates.length, 1);
  assert.equal(sameDay.today.candidates[0].account_id, replacement.id);
  assert.equal(sameDay.queue.find((row) => row.account_id === account.id).status, 'NOT_APPROVED');

  const nextDay = await prepareAutomationQueue(db, brand, commercial, { date: '2026-08-19' });
  assert.equal(nextDay.today.candidates.length, 1);
  assert.equal(nextDay.today.candidates[0].account_id, account.id);
  assert.equal(nextDay.today.candidates[0].status, 'PENDING');
});

test('uvoz uz eksplicitnu potvrdu uzima samo današnje COMPLETED i APPROVED zadatke korisnika', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const commercial = { id: 'commercial-user', username: 'prodaja', role: 'komercijala' };
  const first = await addAccount(db, brand, 'daily-80', {
    email: 'daily80@firma.ba',
    cc_emails_json: JSON.stringify(['cc80@firma.ba'])
  });
  const second = await addAccount(db, brand, 'daily-81', { email: 'daily81@firma.ba' });
  const overLimit = await addAccount(db, brand, 'daily-82', { email: 'daily82@firma.ba' });
  const pending = await addAccount(db, brand, 'daily-83', { email: 'daily83@firma.ba' });
  const invalid = await addAccount(db, brand, 'daily-84', { email: 'nije-mail' });
  const otherUser = await addAccount(db, brand, 'daily-85', { email: 'daily85@firma.ba' });
  const assignments = [
    await addAssignment(db, commercial, brand, first, '80', { status: 'COMPLETED' }),
    await addAssignment(db, commercial, brand, second, '81', { status: 'APPROVED' }),
    await addAssignment(db, commercial, brand, overLimit, '82', { status: 'COMPLETED' }),
    await addAssignment(db, commercial, brand, pending, '83', { status: 'PENDING' }),
    await addAssignment(db, commercial, brand, invalid, '84', { status: 'COMPLETED' }),
    await addAssignment(db, { id: 'other-user' }, brand, otherUser, '85', { status: 'COMPLETED' })
  ];
  await updateAutomationSettings(db, brand, commercial, {
    subject: 'FS App za {{KOMITENT}}',
    body: 'Poštovani {{KOMITENT}}, predstavljamo FS App.',
    enabled: false,
    daily_limit: 2
  });
  const assignmentIds = assignments.map((assignment) => assignment.id);

  await assert.rejects(
    importApprovedDailyAssignments(db, brand, commercial, assignmentIds, { date: '2026-08-18' }),
    (error) => error.status === 400 && error.code === 'SEND_CONFIRMATION_REQUIRED'
  );
  const withoutLegacy = await importApprovedDailyAssignments(db, brand, commercial, assignmentIds, {
    date: '2026-08-18',
    confirmed: true
  });
  assert.equal(withoutLegacy.import.approved_count, 1);
  assert.deepEqual(withoutLegacy.import.eligible_account_ids, [second.id]);
  assert.equal(withoutLegacy.import.include_legacy_completed, false);
  const approvedSnapshot = await db('crm_mail_queue').where({ account_id: second.id, queue_date: '2026-08-18' }).first();
  await db('crm_accounts').where({ id: second.id }).update({
    cc_emails_json: JSON.stringify(['naknadni-cc@firma.ba'])
  });
  await db('crm_mail_automation_settings').where({ brand_id: brand.id }).update({
    subject: 'Naknadno promijenjen naslov',
    body_text: 'Naknadno promijenjen sadržaj'
  });

  const state = await importApprovedDailyAssignments(db, brand, commercial, assignmentIds, {
    date: '2026-08-18',
    confirmed: true,
    includeLegacyCompleted: true
  });

  assert.equal(state.import.requested_count, 6);
  assert.equal(state.import.approved_count, 4);
  assert.equal(state.import.eligible_count, 2);
  assert.equal(state.import.imported_count, 1);
  assert.equal(state.import.already_ready_count, 1);
  assert.equal(state.import.include_legacy_completed, true);
  assert.deepEqual(state.import.eligible_account_ids, [first.id, second.id]);
  assert.deepEqual(state.import.account_ids, [first.id, second.id]);
  assert.equal(state.import.skipped_counts.not_approved_or_unavailable, 2);
  assert.equal(state.import.skipped_counts.invalid_email, 1);
  assert.equal(state.import.skipped_counts.daily_limit, 1);
  assert.ok(state.queue.filter((row) => row.status === 'APPROVED').every((row) => [first.id, second.id].includes(row.account_id)));
  assert.deepEqual(state.queue.find((row) => row.account_id === first.id).cc_emails, ['cc80@firma.ba']);
  const approvedSnapshotAfter = await db('crm_mail_queue').where({ account_id: second.id, queue_date: '2026-08-18' }).first();
  assert.equal(approvedSnapshotAfter.recipient_email, approvedSnapshot.recipient_email);
  assert.equal(approvedSnapshotAfter.cc_emails_json, approvedSnapshot.cc_emails_json);
  assert.equal(approvedSnapshotAfter.subject, approvedSnapshot.subject);
  assert.equal(approvedSnapshotAfter.body_text, approvedSnapshot.body_text);
  assert.equal(approvedSnapshotAfter.attachment_id, approvedSnapshot.attachment_id);

  const daily = await readDailyAssignments(db, commercial, brand, '2026-08-18');
  assert.equal(daily.items.find((item) => item.assignment_id === assignments[0].id).mail_queue_status, 'APPROVED');
  assert.equal(daily.items.find((item) => item.assignment_id === assignments[3].id).mail_queue_status, null);
});

test('promjena dnevnog zadatka opoziva svaki neslani odobreni mail osim eksplicitnog APPROVED', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const commercial = { id: 'commercial-user', username: 'prodaja', role: 'komercijala' };
  let account = await addAccount(db, brand, 'revoke-86', { email: 'revoke86@firma.ba' });
  const assignment = await addAssignment(db, commercial, brand, account, '86', { status: 'APPROVED' });
  await updateAutomationSettings(db, brand, commercial, {
    subject: 'FS App prijedlog',
    body: 'Poštovani, predstavljamo FS App.',
    enabled: true,
    auto_send: true,
    daily_limit: 1
  });
  const date = '2026-08-18';
  await prepareAutomationQueue(db, brand, commercial, { date });
  await updateDailyAssignment(db, assignment, account, commercial, { status: 'APPROVED' });
  assert.equal((await db('crm_mail_queue').where({ account_id: account.id, queue_date: date }).first()).status,
    'PENDING');
  let sends = 0;
  const outlookService = {
    config: { writeEnabled: true, mailbox: 'sales@s-consulting.ba' },
    async send() { sends += 1; return { success: true, accepted: true }; }
  };

  for (const nextStatus of ['CONTACTED', 'COMPLETED', 'SKIPPED']) {
    await reviewAutomationCandidates(db, brand, [account.id], 'APPROVED', { date });
    await updateDailyAssignment(db, assignment, account, commercial, { status: nextStatus });
    assert.equal((await db('crm_mail_queue').where({ account_id: account.id, queue_date: date }).first()).status,
      'NOT_APPROVED');
    const automatic = await sendNextAutomatedMail(db, brand, {
      now: new Date('2026-08-18T08:00:00.000Z'),
      ignoreInterval: true,
      outlookService
    });
    assert.equal(automatic.sent, false);
    const manual = await sendSelectedMails(db, brand, [account.id], {
      confirmed: true,
      actor: commercial,
      now: new Date('2026-08-18T08:00:00.000Z'),
      outlookService
    });
    assert.equal(manual.sent_count, 0);
    assert.equal(sends, 0);
    await updateDailyAssignment(db, assignment, account, commercial, { status: 'PENDING' });
    assert.equal((await db('crm_mail_queue').where({ account_id: account.id, queue_date: date }).first()).status,
      'PENDING');
    account = await db('crm_accounts').where({ id: account.id }).first();
  }
});

test('uvoz ne prelazi dnevni limit kada drugi vidljivi PENDING red već zauzima mjesto', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const commercial = { id: 'commercial-user', username: 'prodaja', role: 'komercijala' };
  const existing = await addAccount(db, brand, 'limit-87', {
    email: 'limit87@firma.ba', source_row_number: 1
  });
  const approved = await addAccount(db, brand, 'limit-88', {
    email: 'limit88@firma.ba', source_row_number: 2
  });
  const assignment = await addAssignment(db, commercial, brand, approved, '88', { status: 'APPROVED' });
  await updateAutomationSettings(db, brand, commercial, {
    subject: 'FS App prijedlog',
    body: 'Poštovani, predstavljamo FS App.',
    enabled: false,
    daily_limit: 1
  });
  const prepared = await prepareAutomationQueue(db, brand, commercial, { date: '2026-08-18' });
  assert.equal(prepared.queue.length, 1);
  assert.equal(prepared.queue[0].account_id, existing.id);
  assert.equal(prepared.queue[0].status, 'PENDING');

  const imported = await importApprovedDailyAssignments(db, brand, commercial, [assignment.id], {
    date: '2026-08-18',
    confirmed: true
  });
  assert.equal(imported.import.eligible_count, 0);
  assert.equal(imported.import.skipped_counts.daily_limit, 1);
  assert.equal(imported.queue.length, 1);
  assert.equal(imported.today.prepared_count, 1);
});

test('uvoz ponovo zaključava i provjerava odobrenje nakon početnog pronalaska assignmenta', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const commercial = { id: 'commercial-user', username: 'prodaja', role: 'komercijala' };
  const account = await addAccount(db, brand, 'race-96', { email: 'race96@firma.ba' });
  const assignment = await addAssignment(db, commercial, brand, account, 'race-96', { status: 'APPROVED' });
  await updateAutomationSettings(db, brand, commercial, {
    subject: 'FS App prijedlog',
    body: 'Poštovani, predstavljamo FS App.',
    enabled: false,
    daily_limit: 1
  });

  const state = await importApprovedDailyAssignments(db, brand, commercial, [assignment.id], {
    date: '2026-08-18',
    confirmed: true,
    async afterAssignmentDiscovery(trx, candidates) {
      assert.deepEqual(candidates.map((candidate) => candidate.assignment_id), [assignment.id]);
      await trx('crm_daily_assignments').where({ id: assignment.id }).update({
        status: 'SKIPPED',
        updated_at: new Date()
      });
    }
  });

  assert.equal(state.import.approved_count, 0);
  assert.equal(state.import.eligible_count, 0);
  assert.equal(state.import.skipped_counts.not_approved_or_unavailable, 1);
  assert.equal(state.queue.length, 0);
  assert.equal((await db('crm_daily_assignments').where({ id: assignment.id }).first()).status, 'SKIPPED');
  assert.equal(await db('crm_mail_queue').where({ account_id: account.id }).first(), undefined);
});

test('reaktiviranje odbijenog prijedloga i smanjenje postavke ne mogu probiti dnevni limit', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const date = businessDate();
  const first = await addAccount(db, brand, 'limit-89', { email: 'limit89@firma.ba', source_row_number: 1 });
  const second = await addAccount(db, brand, 'limit-90', { email: 'limit90@firma.ba', source_row_number: 2 });
  const assignment = await addAssignment(db, director, brand, first, 'limit-89', {
    status: 'SKIPPED', assignment_date: date
  });
  await updateAutomationSettings(db, brand, director, {
    subject: 'FS App prijedlog',
    body: 'Poštovani, predstavljamo FS App.',
    enabled: false,
    daily_limit: 1
  });
  await prepareAutomationQueue(db, brand, director, { date });
  await reviewAutomationCandidates(db, brand, [first.id], 'REJECTED', { date });
  await prepareAutomationQueue(db, brand, director, { date });
  await assert.rejects(
    updateDailyAssignment(db, assignment, first, director, { status: 'PENDING' }),
    (error) => error.status === 409 && error.code === 'CAMPAIGN_DAILY_LIMIT_REACHED'
  );
  assert.equal((await db('crm_daily_assignments').where({ id: assignment.id }).first()).status, 'SKIPPED');
  await assert.rejects(
    reviewAutomationCandidates(db, brand, [first.id], 'APPROVED', { date }),
    (error) => error.status === 409 && error.code === 'CAMPAIGN_DAILY_LIMIT_REACHED'
  );
  const activeRows = await db('crm_mail_queue').where({ brand_id: brand.id, queue_date: date })
    .whereNot({ status: 'NOT_APPROVED' });
  assert.equal(activeRows.length, 1);
  assert.equal(activeRows[0].account_id, second.id);

  await updateAutomationSettings(db, brand, director, { daily_limit: 2 });
  await reviewAutomationCandidates(db, brand, [first.id], 'APPROVED', { date });
  await assert.rejects(
    updateAutomationSettings(db, brand, director, { daily_limit: 1 }),
    (error) => error.status === 409 && error.code === 'CAMPAIGN_DAILY_LIMIT_REACHED'
  );
  assert.equal(Number((await db('crm_mail_automation_settings').where({ brand_id: brand.id }).first()).daily_limit), 2);
});

test('promjena sadržaja resetuje odobreni snapshot, a auto slanje odbija zastarjeli account email', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const account = await addAccount(db, brand, 'snapshot-95', { email: 'snapshot95@firma.ba' });
  await updateAutomationSettings(db, brand, director, {
    subject: 'Prvobitni naslov',
    body: 'Prvobitni sadržaj',
    enabled: true,
    auto_send: true,
    daily_limit: 1
  });
  const date = businessDate();
  await prepareAutomationQueue(db, brand, director, { date });
  await reviewAutomationCandidates(db, brand, [account.id], 'APPROVED', { date });
  await updateAutomationSettings(db, brand, director, { body: 'Novi sadržaj' });
  let queue = await db('crm_mail_queue').where({ account_id: account.id, queue_date: date }).first();
  assert.equal(queue.status, 'PENDING');
  assert.equal(queue.body_text, 'Novi sadržaj');

  await reviewAutomationCandidates(db, brand, [account.id], 'APPROVED', { date });
  await updateAutomationSettings(db, brand, director, { send_interval_minutes: 11 });
  queue = await db('crm_mail_queue').where({ account_id: account.id, queue_date: date }).first();
  assert.equal(queue.status, 'APPROVED');
  await db('crm_accounts').where({ id: account.id }).update({ email: 'promijenjen95@firma.ba' });
  let sends = 0;
  const automatic = await sendNextAutomatedMail(db, brand, {
    now: new Date(),
    ignoreInterval: true,
    outlookService: {
      config: { writeEnabled: true, mailbox: 'sales@s-consulting.ba' },
      async send() { sends += 1; return { success: true, accepted: true }; }
    }
  });
  assert.equal(automatic.sent, false);
  assert.equal(sends, 0);
  queue = await db('crm_mail_queue').where({ account_id: account.id, queue_date: date }).first();
  assert.equal(queue.status, 'NOT_APPROVED');
});

test('auto slanje preskače arhivirane, završene i promijenjene komitente te šalje samo aktuelnog', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const archived = await addAccount(db, brand, 'auto-96', {
    email: 'auto96@firma.ba', source_row_number: 1
  });
  const finished = await addAccount(db, brand, 'auto-97', {
    email: 'auto97@firma.ba', source_row_number: 2
  });
  const changed = await addAccount(db, brand, 'auto-98', {
    email: 'auto98@firma.ba', source_row_number: 3
  });
  const current = await addAccount(db, brand, 'auto-99', {
    email: 'auto99@firma.ba', source_row_number: 4
  });
  await updateAutomationSettings(db, brand, director, {
    subject: 'FS App prijedlog',
    body: 'Poštovani, predstavljamo FS App.',
    enabled: true,
    auto_send: true,
    daily_limit: 4
  });
  const date = '2026-08-18';
  await prepareAutomationQueue(db, brand, director, { date });
  await reviewAutomationCandidates(db, brand, [archived.id, finished.id, changed.id, current.id], 'APPROVED', { date });
  await db('crm_accounts').where({ id: archived.id }).update({ archived_at: new Date() });
  await db('crm_accounts').where({ id: finished.id }).update({ status: 'WON' });
  await db('crm_accounts').where({ id: changed.id }).update({ email: 'nova98@firma.ba' });
  const payloads = [];

  const result = await sendNextAutomatedMail(db, brand, {
    now: new Date('2026-08-18T08:00:00.000Z'),
    ignoreInterval: true,
    outlookService: {
      config: { writeEnabled: true, mailbox: 'sales@s-consulting.ba' },
      async send(payload) {
        payloads.push(payload);
        return { success: true, accepted: true, id: 'auto-current', conversationId: 'auto-current-thread' };
      }
    }
  });

  assert.equal(result.sent, true);
  assert.equal(payloads.length, 1);
  assert.deepEqual(payloads[0].to, ['auto99@firma.ba']);
  const queueRows = await db('crm_mail_queue').where({ brand_id: brand.id, queue_date: date });
  for (const account of [archived, finished, changed]) {
    const row = queueRows.find((candidate) => candidate.account_id === account.id);
    assert.equal(row.status, 'NOT_APPROVED');
    assert.match(row.last_error, /Potrebna je nova provjera/);
  }
  assert.equal(queueRows.find((candidate) => candidate.account_id === current.id).status, 'SENT');
});

test('trajni CC se normalizuje, snapshotuje, resetuje odobrenje i koristi pri ručnom slanju', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const commercial = { id: 'commercial-user', username: 'prodaja', role: 'komercijala' };
  const account = await addAccount(db, brand, 'cc-90', { email: 'glavni@firma.ba' });
  await updateAutomationSettings(db, brand, commercial, {
    subject: 'FS App za {{KOMITENT}}',
    body: 'Poštovani {{KOMITENT}}, predstavljamo FS App.',
    enabled: false,
    daily_limit: 1
  });
  const date = '2026-08-18';
  await prepareAutomationQueue(db, brand, commercial, { date });
  await reviewAutomationCandidates(db, brand, [account.id], 'APPROVED', { date });

  const edited = await updateCandidateRecipients(db, brand, account.id, commercial, {
    cc_emails: ['COPY@firma.ba', 'copy@firma.ba', 'drugi@firma.ba']
  }, { date });
  const editedQueue = edited.queue.find((row) => row.account_id === account.id);
  assert.deepEqual(edited.recipients.cc_emails, ['copy@firma.ba', 'drugi@firma.ba']);
  assert.equal(editedQueue.status, 'PENDING');
  assert.deepEqual(editedQueue.cc_emails, ['copy@firma.ba', 'drugi@firma.ba']);
  const savedAccount = await db('crm_accounts').where({ id: account.id }).first();
  assert.deepEqual(JSON.parse(savedAccount.cc_emails_json), ['copy@firma.ba', 'drugi@firma.ba']);
  const activity = await db('crm_activities').where({
    account_id: account.id,
    activity_type: 'COMMERCIAL_RECIPIENTS_UPDATED'
  }).first();
  assert.equal(JSON.parse(activity.metadata_json).approvalReset, true);

  await assert.rejects(
    updateCandidateRecipients(db, brand, account.id, commercial, { cc_emails: ['glavni@firma.ba'] }, { date }),
    (error) => error.status === 400 && error.code === 'INVALID_CAMPAIGN_CC'
  );
  await assert.rejects(
    updateCandidateRecipients(db, brand, account.id, commercial, { cc_emails: ['a..b@firma.ba'] }, { date }),
    (error) => error.status === 400 && error.code === 'INVALID_CAMPAIGN_CC'
  );
  await assert.rejects(
    updateCandidateRecipients(db, brand, account.id, commercial, {
      cc_emails: Array.from({ length: 11 }, (_, index) => `cc${index}@firma.ba`)
    }, { date }),
    (error) => error.status === 400 && error.code === 'INVALID_CAMPAIGN_CC'
  );

  await reviewAutomationCandidates(db, brand, [account.id], 'APPROVED', { date });
  const payloads = [];
  const result = await sendSelectedMails(db, brand, [account.id], {
    confirmed: true,
    actor: commercial,
    now: new Date('2026-08-18T08:00:00.000Z'),
    outlookService: {
      config: { writeEnabled: true, mailbox: 'sales@s-consulting.ba' },
      async send(payload) {
        payloads.push(payload);
        return { success: true, accepted: true, id: 'cc-message', conversationId: 'cc-conversation' };
      }
    }
  });
  assert.equal(result.sent_count, 1);
  assert.deepEqual(payloads[0].to, ['glavni@firma.ba']);
  assert.deepEqual(payloads[0].cc, ['copy@firma.ba', 'drugi@firma.ba']);
  const sendActivity = await db('crm_activities').where({
    account_id: account.id,
    activity_type: 'COMMERCIAL_EMAIL_SENT'
  }).first();
  assert.deepEqual(JSON.parse(sendActivity.metadata_json).ccRecipients, ['copy@firma.ba', 'drugi@firma.ba']);
});

test('suppressed ili oštećen CC snapshot blokira slanje prije Outlook poziva', async (t) => {
  const db = await testDb(t);
  await db.schema.createTable('email_suppression_list', (table) => {
    table.string('email_normalized');
    table.string('email');
  });
  await db('email_suppression_list').insert({ email_normalized: 'zabrana@firma.ba', email: 'zabrana@firma.ba' });
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const commercial = { id: 'commercial-user', username: 'prodaja', role: 'komercijala' };
  const suppressedAccount = await addAccount(db, brand, 'cc-91', {
    email: 'glavni91@firma.ba',
    cc_emails_json: JSON.stringify(['zabrana@firma.ba'])
  });
  const corruptAccount = await addAccount(db, brand, 'cc-92', {
    email: 'glavni92@firma.ba',
    cc_emails_json: JSON.stringify(['ispravan@firma.ba'])
  });
  await updateAutomationSettings(db, brand, commercial, {
    subject: 'FS App prijedlog',
    body: 'Poštovani, predstavljamo FS App.',
    enabled: false,
    daily_limit: 2
  });
  const date = '2026-08-18';
  await prepareAutomationQueue(db, brand, commercial, { date });
  await reviewAutomationCandidates(db, brand, [suppressedAccount.id, corruptAccount.id], 'APPROVED', { date });
  await db('crm_mail_queue').where({ account_id: corruptAccount.id, queue_date: date })
    .update({ cc_emails_json: '{oštećeno' });
  let sends = 0;
  const outcome = await sendSelectedMails(db, brand, [suppressedAccount.id, corruptAccount.id], {
    confirmed: true,
    actor: commercial,
    now: new Date('2026-08-18T08:00:00.000Z'),
    outlookService: {
      config: { writeEnabled: true, mailbox: 'sales@s-consulting.ba' },
      async send() { sends += 1; return { success: true, accepted: true }; }
    }
  });
  assert.equal(outcome.sent_count, 0);
  assert.equal(outcome.failed_count, 2);
  assert.equal(sends, 0);
  assert.ok(outcome.results.some((item) => /listi zabrane/i.test(item.error)));
  assert.ok(outcome.results.some((item) => /CC primaoci nisu ispravni/i.test(item.error)));
});

test('ručni batch ponovo učitava suppression listu neposredno prije svake poruke', async (t) => {
  const db = await testDb(t);
  await db.schema.createTable('email_suppression_list', (table) => {
    table.string('email_normalized');
    table.string('email');
  });
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const commercial = { id: 'commercial-user', username: 'prodaja', role: 'komercijala' };
  const first = await addAccount(db, brand, 'late-93', { email: 'late93@firma.ba' });
  const second = await addAccount(db, brand, 'late-94', { email: 'late94@firma.ba' });
  await updateAutomationSettings(db, brand, commercial, {
    subject: 'FS App prijedlog',
    body: 'Poštovani, predstavljamo FS App.',
    enabled: false,
    daily_limit: 2
  });
  const date = '2026-08-18';
  await prepareAutomationQueue(db, brand, commercial, { date });
  await reviewAutomationCandidates(db, brand, [first.id, second.id], 'APPROVED', { date });
  let outlookCalls = 0;
  const outcome = await sendSelectedMails(db, brand, [first.id, second.id], {
    confirmed: true,
    actor: commercial,
    now: new Date('2026-08-18T08:00:00.000Z'),
    outlookService: {
      config: { writeEnabled: true, mailbox: 'sales@s-consulting.ba' },
      async send() {
        outlookCalls += 1;
        await db('email_suppression_list').insert({
          email_normalized: 'late94@firma.ba',
          email: 'late94@firma.ba'
        });
        return { success: true, accepted: true, id: 'late-first', conversationId: 'late-conversation' };
      }
    }
  });
  assert.equal(outcome.sent_count, 1);
  assert.equal(outcome.failed_count, 1);
  assert.equal(outlookCalls, 1);
  assert.equal((await db('crm_mail_queue').where({ account_id: second.id }).first()).status, 'FAILED');
  assert.match(outcome.results.find((item) => item.account_id === second.id).error, /listi zabrane/i);
});

test('postavke odbijaju neispravan raspored, adresu izvještaja i nedovoljan kapacitet prozora', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  const base = { subject: 'FS naslov', body: 'FS sadržaj' };

  await assert.rejects(
    updateAutomationSettings(db, brand, director, { ...base, send_interval_minutes: 2 }),
    (error) => error.status === 400 && error.code === 'INVALID_AUTOMATION_SETTINGS'
  );
  await assert.rejects(
    updateAutomationSettings(db, brand, director, { ...base, report_recipient: 'pogresna-adresa' }),
    (error) => error.status === 400 && error.code === 'INVALID_AUTOMATION_SETTINGS'
  );
  await assert.rejects(
    updateAutomationSettings(db, brand, director, {
      ...base,
      send_window_start: '15:00',
      send_window_end: '09:00'
    }),
    (error) => error.status === 400 && error.code === 'INVALID_AUTOMATION_SETTINGS'
  );
  await assert.rejects(
    updateAutomationSettings(db, brand, director, {
      ...base,
      daily_limit: 30,
      send_window_start: '09:00',
      send_window_end: '12:00',
      send_interval_minutes: 10
    }),
    (error) => error.status === 400 && error.code === 'AUTOMATION_WINDOW_CAPACITY_EXCEEDED'
  );
  await assert.rejects(
    updateAutomationSettings(db, brand, director, { ...base, workdays: [] }),
    (error) => error.status === 400 && error.code === 'INVALID_AUTOMATION_SETTINGS'
  );
});

test('scheduler pripremi red i u jednom ticku šalje najviše jedan mail po brendu', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  await addAccount(db, brand, '20', { email: 'dvadeset@firma.ba' });
  await addAccount(db, brand, '21', { email: 'dvadesetjedan@firma.ba' });
  await updateAutomationSettings(db, brand, director, {
    subject: 'FS App prijedlog',
    body_text: 'Pozdrav iz S Consultinga.',
    enabled: true,
    auto_send: true,
    send_window_start: '09:00',
    send_window_end: '15:00',
    send_interval_minutes: 10
  });
  let sends = 0;
  const outlookService = {
    config: { writeEnabled: true, mailbox: 'sales@s-consulting.ba' },
    async send() {
      sends += 1;
      return { success: true, accepted: true, id: `message-${sends}`, conversationId: `conversation-${sends}` };
    }
  };
  const mondayAtTenSarajevo = new Date('2026-08-17T08:00:00.000Z');

  await prepareAutomationQueue(db, brand, director, { date: '2026-08-17' });
  const waiting = await getAutomationState(db, brand, { date: '2026-08-17' });
  assert.ok(waiting.today.candidates.every((candidate) => candidate.status === 'PENDING'));
  const beforeApproval = await runAutomationTick(db, { now: mondayAtTenSarajevo, outlookService });
  assert.equal(beforeApproval.results[0].sent, false);
  assert.equal(sends, 0);
  await reviewAutomationCandidates(
    db,
    brand,
    waiting.today.candidates.map((candidate) => candidate.account_id),
    'APPROVED',
    { date: '2026-08-17' }
  );

  const first = await runAutomationTick(db, { now: mondayAtTenSarajevo, outlookService });
  const second = await runAutomationTick(db, { now: mondayAtTenSarajevo, outlookService });

  assert.equal(first.results[0].sent, true);
  assert.equal(second.results[0].sent, false);
  assert.equal(sends, 1);
  const state = await getAutomationState(db, brand, { date: '2026-08-17' });
  assert.equal(state.counts.SENT, 1);
  assert.equal(state.counts.APPROVED, 1);
});

test('scheduler nakon termina šalje samo jedan dnevni izvještaj sa sažetkom', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  await addAccount(db, brand, '50', { email: 'pedeset@firma.ba' });
  await addAccount(db, brand, '51', { email: 'pedesetjedan@firma.ba' });
  await addAccount(db, brand, '52', { email: 'pedesetdva@firma.ba' });
  await updateAutomationSettings(db, brand, director, {
    subject: 'FS App prijedlog',
    body: 'Pozdrav iz S Consultinga.',
    enabled: true,
    auto_send: true,
    daily_limit: 2,
    send_window_start: '09:00',
    send_window_end: '15:00',
    send_interval_minutes: 10,
    report_enabled: true,
    report_time: '16:00',
    report_recipient: 'info@s-consulting.ba'
  });
  const reportDate = '2026-08-17';
  const prepared = await prepareAutomationQueue(db, brand, director, { date: reportDate });
  await reviewAutomationCandidates(
    db, brand, [prepared.today.candidates[0].account_id], 'REJECTED', { date: reportDate }
  );
  const replenished = await prepareAutomationQueue(db, brand, director, { date: reportDate });
  assert.equal(replenished.today.prepared_count, 2);
  assert.equal(replenished.counts.NOT_APPROVED, 1);
  const payloads = [];
  const outlookService = {
    config: { writeEnabled: true, mailbox: 'sales@s-consulting.ba' },
    async send(payload) {
      payloads.push(payload);
      return { success: true, accepted: true, id: 'report-message', conversationId: 'report-conversation' };
    }
  };
  const mondayAtFourSarajevo = new Date('2026-08-17T14:00:00.000Z');

  const first = await runAutomationTick(db, { now: mondayAtFourSarajevo, outlookService });
  const second = await runAutomationTick(db, { now: mondayAtFourSarajevo, outlookService });

  assert.equal(payloads.length, 1);
  assert.deepEqual(payloads[0].to, ['info@s-consulting.ba']);
  assert.match(payloads[0].subject, /FS App.*17\.08\.2026/);
  assert.match(payloads[0].body, /Pripremljeno: 2/);
  assert.match(payloads[0].body, /Poslano: 0/);
  assert.match(payloads[0].body, /Neuspjelo: 0/);
  assert.match(payloads[0].body, /Preostalo: 2/);
  assert.equal(first.results[0].report.sent, true);
  assert.equal(second.results[0].report.sent, false);
  const reports = await db('crm_mail_daily_reports').where({ brand_id: brand.id, report_date: '2026-08-17' });
  assert.equal(reports.length, 1);
  assert.equal(reports[0].status, 'SENT');
  assert.equal(Number(reports[0].remaining_count), 2);
});

test('izvještaj se ne šalje dok automatsko slanje nije aktivno', async (t) => {
  const db = await testDb(t);
  const brand = await db('crm_brands').where({ code: 'FS_APP' }).first();
  await updateAutomationSettings(db, brand, director, {
    subject: 'FS App prijedlog',
    body: 'Pozdrav iz S Consultinga.',
    enabled: true,
    auto_send: false,
    report_enabled: true,
    report_time: '16:00',
    report_recipient: 'info@s-consulting.ba'
  });
  let sends = 0;
  const outlookService = {
    config: { writeEnabled: true, mailbox: 'sales@s-consulting.ba' },
    async send() {
      sends += 1;
      return { success: true, accepted: true };
    }
  };

  const result = await runAutomationTick(db, {
    now: new Date('2026-08-17T14:00:00.000Z'),
    outlookService
  });

  assert.equal(sends, 0);
  assert.deepEqual(result.results, []);
  assert.equal(await db('crm_mail_daily_reports').where({ brand_id: brand.id }).first(), undefined);
});
