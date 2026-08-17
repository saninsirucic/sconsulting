const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { createOutlookService } = require('../outlookMail/service');
const { businessDate, httpError } = require('./service');

const QUEUE_STATUSES = new Set(['PENDING', 'APPROVED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED']);
const EXCLUDED_CANDIDATE_STATUSES = ['REJECTED', 'WON', 'EMAIL_SENT'];
const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5];
const MAX_DAILY_LIMIT = 30;
const DEFAULT_MAX_ATTACHMENT_BYTES = 2500000;

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
    attachment_id: row.attachment_id || null,
    attachment_name: row.attachment_name || null,
    attachment_type: row.attachment_type || null,
    attachment_size: Number(row.attachment_size || 0),
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
    body_text: row.body_text,
    status: row.status,
    attempts: Number(row.attempts || 0),
    sent_at: row.sent_at || null,
    last_error: row.last_error || '',
    attachment_id: row.attachment_id || null,
    account_status: row.account_status || null,
    priority: row.priority || null,
    location: row.location || null,
    comment: row.comment || ''
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
    .replace(/\{\s*KOMITENT\s*\}/gi, account.company_name || '')
    .replace(/\{\{\s*NAZIV\s*\}\}/gi, account.company_name || '')
    .replace(/\{\s*NAZIV\s*\}/gi, account.company_name || '')
    .replace(/\{\{\s*LOKACIJA\s*\}\}/gi, account.location || '')
    .replace(/\{\s*LOKACIJA\s*\}/gi, account.location || '')
    .replace(/\{\{\s*KONTAKT_OSOBA\s*\}\}/gi, account.contact_person || '');
}

function safeAttachmentName(value) {
  const normalized = String(value || '')
    .replace(/[\u0000-\u001f\u007f"\\/]+/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 180);
  if (!normalized) throw httpError(400, 'Naziv priloga nije ispravan.', 'INVALID_CAMPAIGN_ATTACHMENT');
  return normalized;
}

function maxAttachmentBytes() {
  return integer(
    process.env.OUTLOOK_MAX_ATTACHMENT_BYTES,
    DEFAULT_MAX_ATTACHMENT_BYTES,
    1,
    2999999
  );
}

function normalizeAttachmentInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw httpError(400, 'Prilog nije ispravan.', 'INVALID_CAMPAIGN_ATTACHMENT');
  }
  const name = safeAttachmentName(input.name || input.filename);
  const mimeType = String(input.type || input.mime_type || input.contentType || 'application/octet-stream')
    .trim().toLowerCase();
  if (!mimeType || mimeType.length > 200 || /[\r\n]/.test(mimeType)) {
    throw httpError(400, 'Tip priloga nije ispravan.', 'INVALID_CAMPAIGN_ATTACHMENT');
  }
  const rawBase64 = String(input.data_base64 || input.base64 || input.contentBytes || '')
    .replace(/^data:[^;]+;base64,/i, '')
    .replace(/\s+/g, '');
  if (!rawBase64 || rawBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(rawBase64)) {
    throw httpError(400, 'Sadržaj priloga nije ispravan.', 'INVALID_CAMPAIGN_ATTACHMENT');
  }
  const content = Buffer.from(rawBase64, 'base64');
  if (!content.length || content.length > maxAttachmentBytes()) {
    throw httpError(413, 'Prilog može imati najviše 2,5 MB.', 'CAMPAIGN_ATTACHMENT_TOO_LARGE');
  }
  if (input.size !== undefined && Number(input.size) !== content.length) {
    throw httpError(400, 'Veličina priloga ne odgovara sadržaju.', 'INVALID_CAMPAIGN_ATTACHMENT');
  }
  return {
    name,
    mimeType,
    content,
    size: content.length,
    sha256: crypto.createHash('sha256').update(content).digest('hex')
  };
}

async function ensureAutomationSetting(db, brand) {
  let row = await db('crm_mail_automation_settings').where({ brand_id: brand.id }).first();
  if (row) return row;
  const now = new Date();
  await db('crm_mail_automation_settings').insert({
    brand_id: brand.id,
    enabled: false,
    paused: true,
    auto_send: false,
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

async function automationSettingRow(db, brandId) {
  return db({ s: 'crm_mail_automation_settings' })
    .leftJoin({ attachment: 'crm_mail_attachments' }, 'attachment.id', 's.attachment_id')
    .where({ 's.brand_id': brandId })
    .select(
      's.*',
      'attachment.filename as attachment_name',
      'attachment.mime_type as attachment_type',
      'attachment.size_bytes as attachment_size'
    )
    .first();
}

async function updateAutomationSettings(db, brand, actor, input = {}) {
  const current = await ensureAutomationSetting(db, brand);
  const subject = Object.prototype.hasOwnProperty.call(input, 'subject') ? text(input.subject, 255) : current.subject;
  const bodyText = Object.prototype.hasOwnProperty.call(input, 'body')
    ? text(input.body)
    : (Object.prototype.hasOwnProperty.call(input, 'body_text') ? text(input.body_text) : current.body_text);
  if (subject && /[\r\n]/.test(subject)) throw httpError(400, 'Naslov maila ne smije sadržavati novi red.', 'INVALID_AUTOMATION_SUBJECT');
  if (!subject || !bodyText) {
    throw httpError(400, 'Naslov i sadržaj maila su obavezni.', 'AUTOMATION_TEMPLATE_REQUIRED');
  }
  const automationFields = [
    'enabled', 'paused', 'auto_send', 'workdays', 'send_window_start',
    'send_window_end', 'send_interval_minutes', 'follow_up_days'
  ];
  if (String(actor.role || '').toLowerCase() !== 'direktor'
    && automationFields.some((key) => Object.prototype.hasOwnProperty.call(input, key))) {
    throw httpError(403, 'Komercijalista može mijenjati formu i prilog, ali ne automatsko slanje.', 'AUTOMATION_ADMIN_REQUIRED');
  }
  const enabled = bool(input.enabled, Boolean(current.enabled));
  const workdays = normalizeWorkdays(input.workdays ?? current.workdays_json);
  let attachment = null;
  if (Object.prototype.hasOwnProperty.call(input, 'attachment') && input.attachment) {
    attachment = normalizeAttachmentInput(input.attachment);
  }
  const removeAttachment = bool(input.remove_attachment, false);
  const attachmentId = attachment ? uuidv4() : (removeAttachment ? null : current.attachment_id);
  const next = {
    enabled,
    paused: !enabled
      ? true
      : (Object.prototype.hasOwnProperty.call(input, 'paused')
        ? bool(input.paused, false)
        : (Object.prototype.hasOwnProperty.call(input, 'enabled') ? false : Boolean(current.paused))),
    auto_send: bool(input.auto_send, Boolean(current.auto_send)),
    daily_limit: integer(input.daily_limit, Number(current.daily_limit) || 30, 1, 30),
    workdays_json: JSON.stringify(workdays),
    send_window_start: clock(input.send_window_start, current.send_window_start || '09:00'),
    send_window_end: clock(input.send_window_end, current.send_window_end || '15:00'),
    send_interval_minutes: integer(input.send_interval_minutes, Number(current.send_interval_minutes) || 10, 10, 60),
    follow_up_days: integer(input.follow_up_days, Number(current.follow_up_days) || 7, 1, 90),
    subject,
    body_text: bodyText,
    attachment_id: attachmentId,
    last_error: null,
    updated_by: String(actor.displayName || actor.display_name || actor.username || actor.id || 'direktor').slice(0, 120),
    updated_at: new Date()
  };
  await db.transaction(async (trx) => {
    if (attachment) {
      await trx('crm_mail_attachments').insert({
        id: attachmentId,
        brand_id: brand.id,
        filename: attachment.name,
        mime_type: attachment.mimeType,
        size_bytes: attachment.size,
        sha256: attachment.sha256,
        content: attachment.content,
        created_by: String(actor.id || actor.username || 'commercial-user').slice(0, 120),
        created_at: next.updated_at
      });
    }
    await trx('crm_mail_automation_settings').where({ brand_id: brand.id }).update(next);
    const editableQueue = await trx({ q: 'crm_mail_queue' })
      .join({ a: 'crm_accounts' }, 'a.id', 'q.account_id')
      .where({ 'q.brand_id': brand.id, 'q.queue_date': businessDate() })
      .whereIn('q.status', ['PENDING', 'APPROVED', 'FAILED'])
      .select('q.id', 'a.company_name', 'a.location', 'a.contact_person');
    for (const queued of editableQueue) {
      await trx('crm_mail_queue').where({ id: queued.id }).update({
        subject: renderTemplate(subject, queued),
        body_text: renderTemplate(bodyText, queued),
        attachment_id: attachmentId,
        updated_at: next.updated_at
      });
    }
    if (enabled && next.auto_send) {
      await trx('crm_mail_queue').where({ brand_id: brand.id, queue_date: businessDate(), status: 'PENDING' })
        .update({ status: 'APPROVED', updated_at: new Date() });
    }
  });
  return serializeSettings(await automationSettingRow(db, brand.id));
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
    .select(
      'q.*', 'a.company_name', 'a.status as account_status',
      'a.priority', 'a.location', 'a.comment'
    )
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
        trx('crm_mail_queue').where({ brand_id: brand.id }).whereIn('status', ['SENT', 'SENDING', 'SKIPPED']).select('account_id', 'recipient_email'),
        trx('crm_mail_queue').where({ brand_id: brand.id, queue_date: date }).whereNotIn('status', ['SKIPPED']).select('recipient_email'),
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
        .whereNull('archived_at').whereNotIn('status', EXCLUDED_CANDIDATE_STATUSES)
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
          attachment_id: settings.attachment_id || null,
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
  await ensureAutomationSetting(db, brand);
  const settings = serializeSettings(await automationSettingRow(db, brand.id));
  const rows = (await queueRows(db, brand.id, date)).map(serializeQueue);
  const counts = Object.fromEntries([...QUEUE_STATUSES].map((status) => [status, 0]));
  rows.forEach((row) => { counts[row.status] = (counts[row.status] || 0) + 1; });
  const sender = 'sales@s-consulting.ba';
  const candidates = rows.filter((row) => !['SENT', 'SKIPPED'].includes(row.status)).map((row) => ({
    id: row.account_id,
    candidate_id: row.id,
    account_id: row.account_id,
    name: row.company_name,
    company_name: row.company_name,
    email: row.recipient_email,
    status: row.status,
    account_status: row.account_status,
    priority: row.priority,
    location: row.location,
    comment: row.comment,
    last_error: row.last_error
  }));
  return {
    brand: { id: brand.id, code: brand.code, name: brand.name },
    date,
    settings,
    counts,
    queue: rows,
    sender,
    sender_email: sender,
    daily_limit: Math.min(MAX_DAILY_LIMIT, settings.daily_limit),
    template: {
      subject: settings.subject,
      body: settings.body_text,
      attachment_id: settings.attachment_id,
      attachment_name: settings.attachment_name,
      attachment_type: settings.attachment_type,
      attachment_size: settings.attachment_size,
      updated_at: settings.updated_at
    },
    today: {
      date,
      candidates,
      prepared_count: rows.length,
      sent_count: counts.SENT || 0,
      failed_count: counts.FAILED || 0,
      available_count: candidates.length,
      daily_limit: Math.min(MAX_DAILY_LIMIT, settings.daily_limit)
    },
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
    status: 'SKIPPED',
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

function formatSarajevoDate(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Sarajevo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.day}.${parts.month}.${parts.year}.`;
}

async function queueAttachment(db, attachmentId, brandId) {
  if (!attachmentId) return null;
  const row = await db('crm_mail_attachments').where({ id: attachmentId, brand_id: brandId }).first();
  if (!row) throw httpError(409, 'Sačuvani prilog više nije dostupan. Ponovo sačuvajte formu.', 'CAMPAIGN_ATTACHMENT_MISSING');
  const content = Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content || '');
  if (!content.length || content.length !== Number(row.size_bytes)) {
    throw httpError(409, 'Sačuvani prilog nije ispravan. Ponovo ga učitajte.', 'CAMPAIGN_ATTACHMENT_INVALID');
  }
  return {
    name: row.filename,
    contentType: row.mime_type,
    size: content.length,
    contentBytes: content.toString('base64')
  };
}

async function recordSuccessfulSend(db, brand, claimed, result, actor, sender, sentAt) {
  await db.transaction(async (trx) => {
    const item = await trx('crm_mail_queue').where({ id: claimed.id, claim_token: claimed.claim_token, status: 'SENDING' }).forUpdate().first();
    if (!item) throw httpError(409, 'Red slanja je promijenjen tokom obrade.', 'AUTOMATION_CLAIM_LOST');
    const account = await trx('crm_accounts').where({ id: item.account_id, brand_id: brand.id }).forUpdate().first();
    if (!account) throw httpError(404, 'Komitent više ne postoji.', 'ACCOUNT_NOT_FOUND');
    const nextContactAt = new Date(sentAt.getTime() + claimed.settings.follow_up_days * 86400000);
    const commentNote = `Mail poslan ${formatSarajevoDate(sentAt)} – ${brand.name}.`;
    const auditNote = `${commentNote} Sa ${sender} na ${item.recipient_email}. Naslov: ${item.subject}.`;
    const comment = [String(account.comment || '').trim(), commentNote].filter(Boolean).join('\n');
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
      activity_type: claimed.manual ? 'COMMERCIAL_EMAIL_SENT' : 'AUTOMATED_EMAIL_SENT',
      from_status: account.status,
      to_status: 'EMAIL_SENT',
      notes: auditNote,
      metadata_json: JSON.stringify({
        queueId: item.id,
        sender,
        recipient: item.recipient_email,
        subject: item.subject,
        attachmentId: item.attachment_id || null,
        mode: claimed.manual ? 'MANUAL_SELECTED' : 'AUTOMATED',
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
        notes: [String(assignment.notes || '').trim(), commentNote].filter(Boolean).join('\n'),
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

function assertOutlookReady(outlook) {
  if (!outlook?.config?.writeEnabled) {
    throw httpError(503, 'Outlook slanje je isključeno na serveru.', 'OUTLOOK_WRITES_DISABLED');
  }
  if (String(outlook.config.mailbox || '').trim().toLowerCase() !== 'sales@s-consulting.ba') {
    throw httpError(503, 'Pošiljalac mora biti sales@s-consulting.ba.', 'OUTLOOK_SENDER_MISMATCH');
  }
}

async function recordUnconfirmedAcceptedSend(db, brand, claimed, error, now) {
  const message = `Microsoft je prihvatio poruku, ali završni upis nije potvrđen. Ne ponavljati slanje. ${String(error?.message || '').slice(0, 1200)}`.trim();
  await db.transaction(async (trx) => {
    await trx('crm_mail_queue').where({ id: claimed.id, claim_token: claimed.claim_token }).update({
      last_error: message,
      updated_at: now
    });
    await trx('crm_mail_automation_settings').where({ brand_id: brand.id }).update({
      last_error: message,
      updated_at: now
    });
  });
}

async function claimSelectedQueueItem(db, brand, identifier, now) {
  const date = businessDate('Europe/Sarajevo', now);
  return db.transaction(async (trx) => {
    const rawSettings = await trx('crm_mail_automation_settings')
      .where({ brand_id: brand.id }).forUpdate().first();
    const settings = serializeSettings(rawSettings);
    if (!settings?.subject || !settings?.body_text) {
      throw httpError(409, 'Prvo sačuvajte naslov i sadržaj maila.', 'AUTOMATION_TEMPLATE_REQUIRED');
    }
    const dailyLimit = Math.min(MAX_DAILY_LIMIT, Number(settings.daily_limit) || MAX_DAILY_LIMIT);
    const usedRow = await trx('crm_mail_queue').where({ brand_id: brand.id, queue_date: date })
      .whereIn('status', ['SENT', 'SENDING']).count({ count: '*' }).first();
    if (Number(usedRow?.count || 0) >= dailyLimit) {
      throw httpError(409, `Dnevni limit od ${dailyLimit} mailova za ${brand.name} je dostignut.`, 'CAMPAIGN_DAILY_LIMIT_REACHED');
    }
    const item = await trx('crm_mail_queue')
      .where({ brand_id: brand.id, queue_date: date })
      .whereIn('status', ['PENDING', 'APPROVED', 'FAILED'])
      .andWhere((query) => query.where({ account_id: identifier }).orWhere({ id: identifier }))
      .orderBy('sequence_number').forUpdate().first();
    if (!item) {
      throw httpError(409, 'Kandidat više nije dostupan za današnje slanje.', 'CAMPAIGN_CANDIDATE_NOT_AVAILABLE');
    }
    const account = await trx('crm_accounts').where({ id: item.account_id, brand_id: brand.id })
      .whereNull('archived_at').forUpdate().first();
    const currentEmail = validEmail(account?.email);
    if (!account || EXCLUDED_CANDIDATE_STATUSES.includes(account.status) || currentEmail !== validEmail(item.recipient_email)) {
      throw httpError(409, 'Podaci kandidata su promijenjeni. Osvježite listu prije slanja.', 'CAMPAIGN_CANDIDATE_CHANGED');
    }
    const claimToken = uuidv4();
    const updated = await trx('crm_mail_queue').where({ id: item.id, status: item.status }).update({
      status: 'SENDING',
      attempts: Number(item.attempts || 0) + 1,
      claim_token: claimToken,
      claimed_at: now,
      last_error: null,
      updated_at: now
    });
    if (!updated) throw httpError(409, 'Kandidat je već preuzet za slanje.', 'CAMPAIGN_CANDIDATE_CLAIMED');
    return { ...item, claim_token: claimToken, settings, account, manual: true };
  });
}

async function sendSelectedMails(db, brand, accountIds, options = {}) {
  if (options.confirmed !== true) {
    throw httpError(400, 'Potvrdite stvarno slanje sa confirm: true.', 'SEND_CONFIRMATION_REQUIRED');
  }
  const ids = [...new Set((Array.isArray(accountIds) ? accountIds : []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!ids.length) throw httpError(400, 'Označite najmanje jednog kandidata.', 'CAMPAIGN_SELECTION_REQUIRED');
  if (ids.length > MAX_DAILY_LIMIT) throw httpError(400, 'Odjednom možete označiti najviše 30 kandidata.', 'CAMPAIGN_SELECTION_TOO_LARGE');
  const actor = options.actor || { id: 'commercial-mail-user', username: 'Komercijala' };
  const outlook = options.outlookService || createOutlookService();
  assertOutlookReady(outlook);
  const nowProvider = typeof options.now === 'function' ? options.now : () => (options.now || new Date());
  const firstNow = new Date(nowProvider());
  await markStaleClaims(db, brand.id, firstNow);
  const suppressed = await suppressionSet(db);
  const results = [];

  for (const identifier of ids) {
    let claimed = null;
    let accepted = false;
    try {
      const now = new Date(nowProvider());
      claimed = await claimSelectedQueueItem(db, brand, identifier, now);
      if (suppressed.has(validEmail(claimed.recipient_email))) {
        throw httpError(409, 'Adresa je na listi zabrane slanja.', 'CAMPAIGN_RECIPIENT_SUPPRESSED');
      }
      const attachment = await queueAttachment(db, claimed.attachment_id, brand.id);
      const result = await outlook.send({
        to: [claimed.recipient_email],
        subject: claimed.subject,
        body: claimed.body_text,
        bodyType: 'text',
        attachments: attachment ? [attachment] : []
      });
      accepted = true;
      const sentAt = new Date(nowProvider());
      await recordSuccessfulSend(db, brand, claimed, result, actor, outlook.config.mailbox, sentAt);
      results.push({
        account_id: claimed.account_id,
        candidate_id: claimed.id,
        status: 'SENT',
        sent_at: sentAt
      });
    } catch (error) {
      if (claimed) {
        if (accepted) await recordUnconfirmedAcceptedSend(db, brand, claimed, error, new Date(nowProvider()));
        else await recordFailedSend(db, brand, claimed, error, new Date(nowProvider()));
      }
      results.push({
        account_id: claimed?.account_id || identifier,
        candidate_id: claimed?.id || null,
        status: accepted ? 'UNCONFIRMED' : 'FAILED',
        error: String(error?.message || 'Slanje nije uspjelo.').slice(0, 500)
      });
    }
  }

  const sentCount = results.filter((item) => item.status === 'SENT').length;
  const failedCount = results.length - sentCount;
  return {
    success: failedCount === 0,
    sent_count: sentCount,
    failed_count: failedCount,
    summary: { requested: ids.length, sent: sentCount, failed: failedCount },
    results
  };
}

async function sendNextAutomatedMail(db, brand, options = {}) {
  const now = options.now || new Date();
  const actor = options.actor || { id: 'commercial-mail-bot', username: 'Automatska komercijala' };
  const outlook = options.outlookService || createOutlookService();
  assertOutlookReady(outlook);
  await markStaleClaims(db, brand.id, now);
  const claimed = await claimNext(db, brand, now, { ignoreInterval: options.ignoreInterval === true });
  if (!claimed) return { sent: false, reason: 'Nema poruke spremne za slanje.' };
  let accepted = false;
  try {
    const attachment = await queueAttachment(db, claimed.attachment_id, brand.id);
    const result = await outlook.send({
      to: [claimed.recipient_email],
      subject: claimed.subject,
      body: claimed.body_text,
      bodyType: 'text',
      attachments: attachment ? [attachment] : []
    });
    accepted = true;
    const sentAt = now;
    await recordSuccessfulSend(db, brand, claimed, result, actor, outlook.config.mailbox, sentAt);
    return { sent: true, queueId: claimed.id, accountId: claimed.account_id, recipient: claimed.recipient_email, sentAt };
  } catch (error) {
    if (accepted) await recordUnconfirmedAcceptedSend(db, brand, claimed, error, new Date());
    else await recordFailedSend(db, brand, claimed, error, new Date());
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
  EXCLUDED_CANDIDATE_STATUSES,
  QUEUE_STATUSES,
  ensureAutomationSetting,
  getAutomationState,
  pauseAutomation,
  prepareAutomationQueue,
  runAutomationTick,
  sendNextAutomatedMail,
  sendSelectedMails,
  updateAutomationSettings,
  validEmail
};
