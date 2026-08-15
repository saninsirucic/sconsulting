const { v4: uuidv4 } = require('uuid');
const { createOutlookService } = require('../outlookMail/service');
const { businessDate, httpError } = require('./service');

const QUEUE_STATUSES = new Set(['PENDING', 'APPROVED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED']);
const CANDIDATE_STATUSES = ['NEW', 'CALL_REQUIRED'];
const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5];

function bool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || String(value).toLowerCase() === 'true';
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function text(value, maximum = 200000) {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function validEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 320 ? email : null;
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch (error) { return fallback; }
}

function normalizeWorkdays(value) {
  const source = Array.isArray(value) ? value : parseJson(value, DEFAULT_WORKDAYS);
  const days = [...new Set(source.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
  return days.length ? days : DEFAULT_WORKDAYS;
}

function clock(value, fallback) {
  const normalized = String(value || '').trim();
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized) ? normalized : fallback;
}

function serializeSettings(row) {
  if (!row) return null;
  return {
    brand_id: row.brand_id,
    enabled: Boolean(row.enabled),
    paused: Boolean(row.paused),
    auto_send: Boolean(row.auto_send),
    daily_limit: Number(row.daily_limit) || 30,
    workdays: normalizeWorkdays(row.workdays_json),
    send_window_start: row.send_window_start,
    send_window_end: row.send_window_end,
    send_interval_minutes: Number(row.send_interval_minutes) || 10,
    follow_up_days: Number(row.follow_up_days) || 7,
    subject: row.subject || '',
    body_text: row.body_text || '',
    last_prepared_date: row.last_prepared_date || null,
    last_sent_at: row.last_sent_at || null,
    last_error: row.last_error || '',
    updated_by: row.updated_by || null,
    updated_at: row.updated_at || null
  };
}

function serializeQueue(row) {
  return {
    id: row.id,
    brand_id: row.brand_id,
    account_id: row.account_id,
    company_name: row.company_name,
    queue_date: row.queue_date,
    sequence_number: Number(row.sequence_number),
    recipient_email: row.recipient_email,
    subject: row.subject,
    status: row.status,
    attempts: Number(row.attempts || 0),
    sent_at: row.sent_at || null,
    last_error: row.last_error || ''
  };
}

function sarajevoParts(now = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sarajevo',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return {
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday),
    time: `${values.hour}:${values.minute}`
  };
}

function minutesSince(value, now) {
  const parsed = new Date(value || 0);
  if (Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
  return Math.floor((now.getTime() - parsed.getTime()) / 60000);
}

function renderTemplate(value, account) {
  return String(value || '')
    .replace(/\{\{\s*KOMITENT\s*\}\}/gi, account.company_name || '')
    .replace(/\{\{\s*LOKACIJA\s*\}\}/gi, account.location || '')
    .replace(/\{\{\s*KONTAKT_OSOBA\s*\}\}/gi, account.contact_person || '');
}

async function ensureAutomationSetting(db, brand) {
  let row = await db('crm_mail_automation_settings').where({ brand_id: brand.id }).first();
  if (row) return row;
  const now = new Date();
  await db('crm_mail_automation_settings').insert({
    brand_id: brand.id,
    enabled: false,
    paused: true,
    auto_send: true,
    daily_limit: 30,
    workdays_json: JSON.stringify(DEFAULT_WORKDAYS),
    send_window_start: '09:00',
    send_window_end: '15:00',
    send_interval_minutes: 10,
    follow_up_days: 7,
    created_at: now,
    updated_at: now
  }).onConflict('brand_id').ignore();
  row = await db('crm_mail_automation_settings').where({ brand_id: brand.id }).first();
  return row;
}

async function updateAutomationSettings(db, brand, actor, input = {}) {
  const current = await ensureAutomationSetting(db, brand);
  const subject = Object.prototype.hasOwnProperty.call(input, 'subject') ? text(input.subject, 255) : current.subject;
  const bodyText = Object.prototype.hasOwnProperty.call(input, 'body_text') ? text(input.body_text) : current.body_text;
  if (subject && /[\r\n]/.test(subject)) throw httpError(400, 'Naslov maila ne smije sadržavati novi red.', 'INVALID_AUTOMATION_SUBJECT');
  const enabled = bool(input.enabled, Boolean(current.enabled));
  if (enabled && (!subject || !bodyText)) {
    throw httpError(400, 'Prije aktivacije unesite naslov i sadržaj maila.', 'AUTOMATION_TEMPLATE_REQUIRED');
  }
  const workdays = normalizeWorkdays(input.workdays ?? current.workdays_json);
  const next = {
    enabled,
    paused: enabled ? bool(input.paused, false) : true,
    auto_send: bool(input.auto_send, Boolean(current.auto_send)),
    daily_limit: integer(input.daily_limit, Number(current.daily_limit) || 30, 1, 30),
    workdays_json: JSON.stringify(workdays),
    send_window_start: clock(input.send_window_start, current.send_window_start || '09:00'),
    send_window_end: clock(input.send_window_end, current.send_window_end || '15:00'),
    send_interval_minutes: integer(input.send_interval_minutes, Number(current.send_interval_minutes) || 10, 10, 60),
    follow_up_days: integer(input.follow_up_days, Number(current.follow_up_days) || 7, 1, 90),
    subject,
    body_text: bodyText,
    last_error: null,
    updated_by: String(actor.displayName || actor.display_name || actor.username || actor.id || 'direktor').slice(0, 120),
    updated_at: new Date()
  };
  await db('crm_mail_automation_settings').where({ brand_id: brand.id }).update(next);
  if (enabled && next.auto_send) {
    await db('crm_mail_queue').where({ brand_id: brand.id, queue_date: businessDate(), status: 'PENDING' })
      .update({ status: 'APPROVED', updated_at: new Date() });
  }
  return serializeSettings(await db('crm_mail_automation_settings').where({ brand_id: brand.id }).first());
}

async function suppressionSet(db) {
  if (!(await db.schema.hasTable('email_suppression_list'))) return new Set();
  const rows = await db('email_suppression_list').select('email_normalized', 'email');
  return new Set(rows.map((row) => validEmail(row.email_normalized || row.email)).filter(Boolean));
}

async function queueRows(db, brandId, date) {
  return db({ q: 'crm_mail_queue' })
    .join({ a: 'crm_accounts' }, 'a.id', 'q.account_id')
    .where({ 'q.brand_id': brandId, 'q.queue_date': date })
    .select('q.*', 'a.company_name')
    .orderBy('q.sequence_number');
}

async function prepareAutomationQueue(db, brand, actor = { id: 'commercial-mail-bot' }, options = {}) {
  const date = options.date || businessDate();
  await ensureAutomationSetting(db, brand);
  await db.transaction(async (trx) => {
    const settingsRow = await trx('crm_mail_automation_settings').where({ brand_id: brand.id }).forUpdate().first();
    const settings = serializeSettings(settingsRow);
    if (!settings.subject || !settings.body_text) {
      throw httpError(409, 'Unesite naslov i sadržaj maila prije pripreme liste.', 'AUTOMATION_TEMPLATE_REQUIRED');
    }
    const existing = await trx('crm_mail_queue').where({ brand_id: brand.id, queue_date: date }).orderBy('sequence_number');
    const needed = Math.max(0, settings.daily_limit - existing.length);
    if (needed > 0) {
      const [history, usedToday, suppressed] = await Promise.all([
        trx('crm_mail_queue').where({ brand_id: brand.id }).whereIn('status', ['SENT', 'SENDING', 'FAILED']).select('account_id', 'recipient_email'),
        trx('crm_mail_queue').where({ queue_date: date }).whereNotIn('status', ['SKIPPED']).select('recipient_email'),
        suppressionSet(trx)
      ]);
      const usedAccounts = new Set(history.map((row) => row.account_id));
      const usedEmails = new Set([
        ...history.map((row) => validEmail(row.recipient_email)),
        ...usedToday.map((row) => validEmail(row.recipient_email))
      ].filter(Boolean));
      existing.forEach((row) => {
        usedAccounts.add(row.account_id);
        const email = validEmail(row.recipient_email);
        if (email) usedEmails.add(email);
      });
      const accounts = await trx('crm_accounts').where({ brand_id: brand.id })
        .whereNull('archived_at').whereIn('status', CANDIDATE_STATUSES)
        .whereNotNull('email').select('*');
      const priority = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      const selectedEmails = new Set(usedEmails);
      const selected = accounts
        .map((account) => ({ account, email: validEmail(account.email) }))
        .sort((left, right) => {
          const priorityDifference = (priority[left.account.priority] ?? 3) - (priority[right.account.priority] ?? 3);
          if (priorityDifference) return priorityDifference;
          const rowDifference = Number(left.account.source_row_number ?? Number.MAX_SAFE_INTEGER) - Number(right.account.source_row_number ?? Number.MAX_SAFE_INTEGER);
          if (rowDifference) return rowDifference;
          return String(left.account.company_name).localeCompare(String(right.account.company_name), 'bs');
        })
        .filter(({ account, email }) => {
          if (!email || usedAccounts.has(account.id) || selectedEmails.has(email) || suppressed.has(email)) return false;
          selectedEmails.add(email);
          return true;
        })
        .slice(0, needed);
      const now = new Date();
      if (selected.length) {
        await trx('crm_mail_queue').insert(selected.map(({ account, email }, index) => ({
          id: uuidv4(),
          brand_id: brand.id,
          account_id: account.id,
          queue_date: date,
          sequence_number: existing.length + index + 1,
          recipient_email: email,
          subject: renderTemplate(settings.subject, account),
          body_text: renderTemplate(settings.body_text, account),
          status: settings.enabled && !settings.paused && settings.auto_send ? 'APPROVED' : 'PENDING',
          attempts: 0,
          created_by: String(actor.id || actor.username || 'commercial-mail-bot').slice(0, 120),
          created_at: now,
          updated_at: now
        })))
          .onConflict(['brand_id', 'queue_date', 'account_id']).ignore();
      }
    }
    await trx('crm_mail_automation_settings').where({ brand_id: brand.id }).update({
      last_prepared_date: date,
      updated_at: new Date()
    });
  });
  return getAutomationState(db, brand, { date });
}

async function getAutomationState(db, brand, options = {}) {
  const date = options.date || businessDate();
  const settings = serializeSettings(await ensureAutomationSetting(db, brand));
  const rows = (await queueRows(db, brand.id, date)).map(serializeQueue);
  const counts = Object.fromEntries([...QUEUE_STATUSES].map((status) => [status, 0]));
  rows.forEach((row) => { counts[row.status] = (counts[row.status] || 0) + 1; });
  return {
    brand: { id: brand.id, code: brand.code, name: brand.name },
    date,
    settings,
    counts,
    queue: rows,
    sender: process.env.OUTLOOK_MAILBOX_ADDRESS || process.env.MAIL_SENDER_ADDRESS || 'sales@s-consulting.ba',
    source_policy: 'ONLY_EXISTING_CRM_EMAILS'
  };
}

async function pauseAutomation(db, brand, actor) {
  await ensureAutomationSetting(db, brand);
  await db('crm_mail_automation_settings').where({ brand_id: brand.id }).update({
    paused: true,
    last_error: null,
    updated_by: String(actor.displayName || actor.display_name || actor.username || actor.id || 'direktor').slice(0, 120),
    updated_at: new Date()
  });
  return getAutomationState(db, brand);
}

async function markStaleClaims(db, brandId, now) {
  const cutoff = new Date(now.getTime() - 30 * 60000);
  await db('crm_mail_queue').where({ brand_id: brandId, status: 'SENDING' }).where('claimed_at', '<', cutoff).update({
    status: 'FAILED',
    claim_token: null,
    last_error: 'Ishod slanja nije potvrđen. Zapis je zaustavljen radi zaštite od duplikata.',
    updated_at: now
  });
}

async function claimNext(db, brand, now, { ignoreInterval = false } = {}) {
  return db.transaction(async (trx) => {
    const raw = await trx('crm_mail_automation_settings').where({ brand_id: brand.id }).forUpdate().first();
    const settings = serializeSettings(raw);
    if (!settings || !settings.enabled || settings.paused || !settings.auto_send) return null;
    if (!ignoreInterval && minutesSince(settings.last_sent_at, now) < settings.send_interval_minutes) return null;
    const item = await trx('crm_mail_queue').where({
      brand_id: brand.id,
      queue_date: businessDate('Europe/Sarajevo', now),
      status: 'APPROVED'
    })
      .orderBy('sequence_number').first();
    if (!item) return null;
    const claimToken = uuidv4();
    const updated = await trx('crm_mail_queue').where({ id: item.id, status: 'APPROVED' }).update({
      status: 'SENDING',
      attempts: Number(item.attempts || 0) + 1,
      claim_token: claimToken,
      claimed_at: now,
      last_error: null,
      updated_at: now
    });
    return updated ? { ...item, claim_token: claimToken, settings } : null;
  });
}

function formatSarajevoDateTime(value) {
  return new Intl.DateTimeFormat('bs-BA', {
    timeZone: 'Europe/Sarajevo', dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date(value));
}

async function recordSuccessfulSend(db, brand, claimed, result, actor, sender, sentAt) {
  await db.transaction(async (trx) => {
    const item = await trx('crm_mail_queue').where({ id: claimed.id, claim_token: claimed.claim_token, status: 'SENDING' }).forUpdate().first();
    if (!item) throw httpError(409, 'Red slanja je promijenjen tokom obrade.', 'AUTOMATION_CLAIM_LOST');
    const account = await trx('crm_accounts').where({ id: item.account_id, brand_id: brand.id }).forUpdate().first();
    if (!account) throw httpError(404, 'Komitent više ne postoji.', 'ACCOUNT_NOT_FOUND');
    const nextContactAt = new Date(sentAt.getTime() + claimed.settings.follow_up_days * 86400000);
    const note = `Automatski mail poslan ${formatSarajevoDateTime(sentAt)} sa ${sender} na ${item.recipient_email}. Naslov: ${item.subject}.`;
    const comment = [String(account.comment || '').trim(), note].filter(Boolean).join('\n');
    await trx('crm_mail_queue').where({ id: item.id }).update({
      status: 'SENT',
      sent_at: sentAt,
      provider_message_id: result.id || null,
      provider_conversation_id: result.conversationId || null,
      claim_token: null,
      last_error: null,
      updated_at: sentAt
    });
    await trx('crm_accounts').where({ id: account.id }).update({
      status: 'EMAIL_SENT',
      comment,
      last_contact_at: sentAt,
      next_contact_at: nextContactAt,
      updated_by: actor.id || 'commercial-mail-bot',
      updated_at: sentAt
    });
    await trx('crm_activities').insert({
      id: uuidv4(),
      account_id: account.id,
      brand_id: brand.id,
      user_id: actor.id || 'commercial-mail-bot',
      activity_type: 'AUTOMATED_EMAIL_SENT',
      from_status: account.status,
      to_status: 'EMAIL_SENT',
      notes: note,
      metadata_json: JSON.stringify({
        queueId: item.id,
        sender,
        recipient: item.recipient_email,
        subject: item.subject,
        providerMessageId: result.id || null,
        providerConversationId: result.conversationId || null
      }),
      occurred_at: sentAt,
      created_at: sentAt
    });
    const assignments = await trx('crm_daily_assignments').where({
      account_id: account.id,
      brand_id: brand.id,
      assignment_date: item.queue_date
    }).select('id', 'notes');
    for (const assignment of assignments) {
      await trx('crm_daily_assignments').where({ id: assignment.id }).update({
        status: 'EMAIL_SENT',
        notes: [String(assignment.notes || '').trim(), note].filter(Boolean).join('\n'),
        completed_at: sentAt,
        updated_at: sentAt
      });
    }
    await trx('crm_mail_automation_settings').where({ brand_id: brand.id }).update({
      last_sent_at: sentAt,
      last_error: null,
      updated_at: sentAt
    });
  });
}

async function recordFailedSend(db, brand, claimed, error, now) {
  const message = String(error && error.message || 'Slanje nije uspjelo.').slice(0, 2000);
  await db.transaction(async (trx) => {
    await trx('crm_mail_queue').where({ id: claimed.id, claim_token: claimed.claim_token }).update({
      status: 'FAILED',
      claim_token: null,
      last_error: message,
      updated_at: now
    });
    await trx('crm_mail_automation_settings').where({ brand_id: brand.id }).update({
      last_error: message,
      updated_at: now
    });
  });
}

async function sendNextAutomatedMail(db, brand, options = {}) {
  const now = options.now || new Date();
  const actor = options.actor || { id: 'commercial-mail-bot', username: 'Automatska komercijala' };
  const outlook = options.outlookService || createOutlookService();
  if (!outlook.config.writeEnabled) {
    throw httpError(503, 'Outlook slanje je isključeno na serveru.', 'OUTLOOK_WRITES_DISABLED');
  }
  await markStaleClaims(db, brand.id, now);
  const claimed = await claimNext(db, brand, now, { ignoreInterval: options.ignoreInterval === true });
  if (!claimed) return { sent: false, reason: 'Nema poruke spremne za slanje.' };
  try {
    const result = await outlook.send({
      to: [claimed.recipient_email],
      subject: claimed.subject,
      body: claimed.body_text,
      bodyType: 'text'
    });
    const sentAt = now;
    await recordSuccessfulSend(db, brand, claimed, result, actor, outlook.config.mailbox, sentAt);
    return { sent: true, queueId: claimed.id, accountId: claimed.account_id, recipient: claimed.recipient_email, sentAt };
  } catch (error) {
    await recordFailedSend(db, brand, claimed, error, new Date());
    throw error;
  }
}

async function runAutomationTick(db, options = {}) {
  const now = options.now || new Date();
  const outlook = options.outlookService || createOutlookService();
  const { weekday, time } = sarajevoParts(now);
  const date = businessDate('Europe/Sarajevo', now);
  const rows = await db({ s: 'crm_mail_automation_settings' })
    .join({ b: 'crm_brands' }, 'b.id', 's.brand_id')
    .where({ 's.enabled': true, 's.paused': false, 'b.active': true })
    .select('b.*');
  const results = [];
  for (const brand of rows) {
    try {
      let state = await getAutomationState(db, brand, { date });
      if (!state.settings.workdays.includes(weekday)) {
        results.push({ brand: brand.code, sent: false, reason: 'Nije radni dan.' });
        continue;
      }
      if (time >= state.settings.send_window_start && state.queue.length === 0) {
        state = await prepareAutomationQueue(db, brand, { id: 'commercial-mail-bot' }, { date });
      }
      if (time < state.settings.send_window_start || time > state.settings.send_window_end) {
        results.push({ brand: brand.code, sent: false, reason: 'Izvan termina slanja.', prepared: state.queue.length });
        continue;
      }
      const result = await sendNextAutomatedMail(db, brand, { now, outlookService: outlook });
      results.push({ brand: brand.code, ...result, recipient: result.recipient ? '[evidentirano]' : undefined });
    } catch (error) {
      results.push({ brand: brand.code, sent: false, error: String(error.message || error).slice(0, 500) });
    }
  }
  return { date, time, results };
}

module.exports = {
  CANDIDATE_STATUSES,
  QUEUE_STATUSES,
  ensureAutomationSetting,
  getAutomationState,
  pauseAutomation,
  prepareAutomationQueue,
  runAutomationTick,
  sendNextAutomatedMail,
  updateAutomationSettings,
  validEmail
};
