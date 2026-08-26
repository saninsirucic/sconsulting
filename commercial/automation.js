const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { createOutlookService } = require('../outlookMail/service');
const { strictEmailAddress } = require('./email');
const { businessDate, httpError } = require('./service');

const QUEUE_STATUSES = new Set([
  'PENDING', 'APPROVED', 'SCHEDULED', 'NOT_APPROVED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED'
]);
const EXCLUDED_CANDIDATE_STATUSES = ['REJECTED', 'WON', 'EMAIL_SENT'];
const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5];
const MAX_DAILY_LIMIT = 30;
const MIN_SEND_INTERVAL_MINUTES = 5;
const MAX_SEND_INTERVAL_MINUTES = 60;
const SCHEDULED_SEND_INTERVAL_MINUTES = 5;
const MAX_CC_RECIPIENTS = 10;
const DEFAULT_REPORT_RECIPIENT = 'info@s-consulting.ba';
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
  return strictEmailAddress(value);
}

function rawMailAddresses(value) {
  const matches = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(matches.map(validEmail).filter(Boolean))];
}

function assertRecipientMatchesRawMail(account, recipientEmail) {
  const rawAddresses = rawMailAddresses(account?.raw_mail);
  if (rawAddresses.length === 1 && rawAddresses[0] !== recipientEmail) {
    throw httpError(
      409,
      `Glavni email za slanje (${recipientEmail}) razlikuje se od emaila u izvornim podacima (${rawAddresses[0]}). Sačuvajte ispravan glavni email prije slanja.`,
      'QUICK_SEND_EMAIL_MISMATCH'
    );
  }
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch (error) { return fallback; }
}

function storedCcEmails(value, toEmail) {
  const source = Array.isArray(value) ? value : parseJson(value, []);
  if (!Array.isArray(source)) return [];
  const to = String(toEmail || '').trim().toLowerCase();
  return [...new Set(source.map(strictEmailAddress).filter((email) => email && email !== to))]
    .slice(0, MAX_CC_RECIPIENTS);
}

function validatedCcEmails(value, toEmail) {
  if (!Array.isArray(value)) {
    throw httpError(400, 'CC adrese moraju biti poslane kao niz.', 'INVALID_CAMPAIGN_CC');
  }
  const normalized = value.map((item) => strictEmailAddress(item));
  if (normalized.some((email) => !email)) {
    throw httpError(400, 'Jedna ili više CC adresa nisu ispravne.', 'INVALID_CAMPAIGN_CC');
  }
  const to = String(toEmail || '').trim().toLowerCase();
  if (to && normalized.includes(to)) {
    throw httpError(400, 'Glavna To adresa ne može istovremeno biti CC.', 'INVALID_CAMPAIGN_CC');
  }
  const unique = [...new Set(normalized)];
  if (unique.length > MAX_CC_RECIPIENTS) {
    throw httpError(400, `Dozvoljeno je najviše ${MAX_CC_RECIPIENTS} CC adresa.`, 'INVALID_CAMPAIGN_CC');
  }
  return unique;
}

function strictQueueCcEmails(value, toEmail) {
  if (value === null || value === undefined || value === '') return [];
  let source;
  try { source = JSON.parse(value); } catch (error) {
    throw httpError(409, 'Sačuvani CC primaoci nisu ispravni.', 'CAMPAIGN_CC_SNAPSHOT_INVALID');
  }
  if (!Array.isArray(source) || source.length > MAX_CC_RECIPIENTS) {
    throw httpError(409, 'Sačuvani CC primaoci nisu ispravni.', 'CAMPAIGN_CC_SNAPSHOT_INVALID');
  }
  const normalized = source.map(strictEmailAddress);
  const to = String(toEmail || '').trim().toLowerCase();
  if (normalized.some((email) => !email || email === to) || new Set(normalized).size !== normalized.length) {
    throw httpError(409, 'Sačuvani CC primaoci nisu ispravni.', 'CAMPAIGN_CC_SNAPSHOT_INVALID');
  }
  return normalized;
}

function normalizeWorkdays(value) {
  const source = Array.isArray(value) ? value : parseJson(value, DEFAULT_WORKDAYS);
  const days = [...new Set(source.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort();
  return days.length ? days : DEFAULT_WORKDAYS;
}

function hasOwn(input, key) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function validatedInteger(input, key, fallback, minimum, maximum, label) {
  if (!hasOwn(input, key)) return fallback;
  const parsed = Number(input[key]);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw httpError(
      400,
      `${label} mora biti cijeli broj od ${minimum} do ${maximum}.`,
      'INVALID_AUTOMATION_SETTINGS'
    );
  }
  return parsed;
}

function validatedClock(input, key, fallback, label) {
  if (!hasOwn(input, key)) return fallback;
  const normalized = String(input[key] || '').trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw httpError(400, `${label} mora biti u formatu HH:MM.`, 'INVALID_AUTOMATION_SETTINGS');
  }
  return normalized;
}

function clockMinutes(value) {
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours * 60 + minutes;
}

function validatedWorkdays(input, fallback) {
  if (!hasOwn(input, 'workdays')) return normalizeWorkdays(fallback);
  if (!Array.isArray(input.workdays) || !input.workdays.length) {
    throw httpError(400, 'Odaberite najmanje jedan radni dan.', 'INVALID_AUTOMATION_SETTINGS');
  }
  const values = input.workdays.map(Number);
  if (values.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw httpError(400, 'Radni dani moraju biti brojevi od 0 do 6.', 'INVALID_AUTOMATION_SETTINGS');
  }
  return [...new Set(values)].sort();
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
    send_interval_minutes: Number(row.send_interval_minutes) || SCHEDULED_SEND_INTERVAL_MINUTES,
    report_enabled: row.report_enabled === undefined ? true : Boolean(row.report_enabled),
    report_time: row.report_time || '16:00',
    report_recipient: row.report_recipient || DEFAULT_REPORT_RECIPIENT,
    last_report_at: row.last_report_at || null,
    last_report_error: row.last_report_error || '',
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
    cc_emails: storedCcEmails(row.cc_emails_json, row.recipient_email),
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

function latestSentAt(settingsRows) {
  let latest = null;
  for (const row of settingsRows || []) {
    const parsed = new Date(row.last_sent_at || 0);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= 0) continue;
    if (!latest || parsed > latest) latest = parsed;
  }
  return latest;
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
    send_interval_minutes: SCHEDULED_SEND_INTERVAL_MINUTES,
    report_enabled: true,
    report_time: '16:00',
    report_recipient: DEFAULT_REPORT_RECIPIENT,
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
  await ensureAutomationSetting(db, brand);
  let attachment = null;
  if (hasOwn(input, 'attachment') && input.attachment) {
    attachment = normalizeAttachmentInput(input.attachment);
  }
  const removeAttachment = bool(input.remove_attachment, false);
  await db.transaction(async (trx) => {
    const current = await trx('crm_mail_automation_settings')
      .where({ brand_id: brand.id }).forUpdate().first();
    if (!current) throw httpError(409, 'Postavke automatizacije nisu dostupne.', 'AUTOMATION_SETTINGS_NOT_FOUND');
    const subject = hasOwn(input, 'subject') ? text(input.subject, 255) : current.subject;
    const bodyText = hasOwn(input, 'body')
      ? text(input.body)
      : (hasOwn(input, 'body_text') ? text(input.body_text) : current.body_text);
    if (subject && /[\r\n]/.test(subject)) {
      throw httpError(400, 'Naslov maila ne smije sadržavati novi red.', 'INVALID_AUTOMATION_SUBJECT');
    }
    if (!subject || !bodyText) {
      throw httpError(400, 'Naslov i sadržaj maila su obavezni.', 'AUTOMATION_TEMPLATE_REQUIRED');
    }
    const enabled = bool(input.enabled, Boolean(current.enabled));
    const workdays = validatedWorkdays(input, current.workdays_json);
    const sendWindowStart = validatedClock(
      input, 'send_window_start', current.send_window_start || '09:00', 'Početak slanja'
    );
    const sendWindowEnd = validatedClock(
      input, 'send_window_end', current.send_window_end || '15:00', 'Kraj slanja'
    );
    const reportTime = validatedClock(input, 'report_time', current.report_time || '16:00', 'Vrijeme izvještaja');
    const dailyLimit = validatedInteger(
      input, 'daily_limit', Number(current.daily_limit) || 30, 1, MAX_DAILY_LIMIT, 'Dnevni broj komitenata'
    );
    const sendIntervalMinutes = validatedInteger(
      input,
      'send_interval_minutes',
      Number(current.send_interval_minutes) || SCHEDULED_SEND_INTERVAL_MINUTES,
      MIN_SEND_INTERVAL_MINUTES,
      MAX_SEND_INTERVAL_MINUTES,
      'Razmak poruka'
    );
    if (sendWindowStart >= sendWindowEnd) {
      throw httpError(400, 'Početak slanja mora biti prije kraja slanja.', 'INVALID_AUTOMATION_SETTINGS');
    }
    const windowMinutes = clockMinutes(sendWindowEnd) - clockMinutes(sendWindowStart);
    if ((dailyLimit - 1) * sendIntervalMinutes > windowMinutes) {
      throw httpError(
        400,
        `Termin slanja nema dovoljno vremena za ${dailyLimit} poruka uz razmak od ${sendIntervalMinutes} minuta.`,
        'AUTOMATION_WINDOW_CAPACITY_EXCEEDED'
      );
    }
    if (reportTime < sendWindowEnd) {
      throw httpError(400, 'Vrijeme izvještaja mora biti nakon završetka slanja.', 'INVALID_AUTOMATION_SETTINGS');
    }
    const reportRecipient = hasOwn(input, 'report_recipient')
      ? validEmail(input.report_recipient)
      : (validEmail(current.report_recipient) || DEFAULT_REPORT_RECIPIENT);
    if (!reportRecipient) {
      throw httpError(400, 'Adresa primaoca izvještaja nije ispravna.', 'INVALID_AUTOMATION_SETTINGS');
    }
    const attachmentId = attachment ? uuidv4() : (removeAttachment ? null : current.attachment_id);
    const contentChanged = subject !== current.subject
      || bodyText !== current.body_text
      || attachmentId !== (current.attachment_id || null);
    const next = {
      enabled,
      paused: !enabled
        ? true
        : (hasOwn(input, 'paused')
          ? bool(input.paused, false)
          : (hasOwn(input, 'enabled') ? false : Boolean(current.paused))),
      auto_send: bool(input.auto_send, Boolean(current.auto_send)),
      daily_limit: dailyLimit,
      workdays_json: JSON.stringify(workdays),
      send_window_start: sendWindowStart,
      send_window_end: sendWindowEnd,
      send_interval_minutes: sendIntervalMinutes,
      report_enabled: bool(input.report_enabled, current.report_enabled === undefined ? true : Boolean(current.report_enabled)),
      report_time: reportTime,
      report_recipient: reportRecipient,
      follow_up_days: validatedInteger(
        input, 'follow_up_days', Number(current.follow_up_days) || 7, 1, 90, 'Follow-up period'
      ),
      subject,
      body_text: bodyText,
      attachment_id: attachmentId,
      last_error: null,
      updated_by: String(actor.displayName || actor.display_name || actor.username || actor.id || 'direktor').slice(0, 120),
      updated_at: new Date()
    };
    if (hasOwn(input, 'daily_limit') && dailyLimit < Number(current.daily_limit || MAX_DAILY_LIMIT)) {
      const activeRow = await trx('crm_mail_queue')
        .where({ brand_id: brand.id, queue_date: businessDate() })
        .whereNot({ status: 'NOT_APPROVED' })
        .count({ count: '*' }).first();
      if (Number(activeRow?.count || 0) > dailyLimit) {
        throw httpError(
          409,
          `Današnja lista već ima više od ${dailyLimit} aktivnih zapisa. Prvo uklonite višak prijedloga.`,
          'CAMPAIGN_DAILY_LIMIT_REACHED'
        );
      }
    }
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
    if (contentChanged) {
      const editableQueue = await trx({ q: 'crm_mail_queue' })
        .join({ a: 'crm_accounts' }, 'a.id', 'q.account_id')
        .where({ 'q.brand_id': brand.id, 'q.queue_date': businessDate() })
        .whereIn('q.status', ['PENDING', 'APPROVED', 'FAILED'])
        .select('q.id', 'q.status', 'a.company_name', 'a.location', 'a.contact_person');
      for (const queued of editableQueue) {
        const approvalReset = queued.status === 'APPROVED';
        const queueUpdate = {
          subject: renderTemplate(subject, queued),
          body_text: renderTemplate(bodyText, queued),
          attachment_id: attachmentId,
          status: approvalReset ? 'PENDING' : queued.status,
          updated_at: next.updated_at
        };
        if (approvalReset) Object.assign(queueUpdate, {
          claim_token: null,
          claimed_at: null,
          last_error: null
        });
        await trx('crm_mail_queue').where({ id: queued.id }).update(queueUpdate);
      }
    }
  });
  return serializeSettings(await automationSettingRow(db, brand.id));
}

async function suppressionSet(db) {
  if (!(await db.schema.hasTable('email_suppression_list'))) return new Set();
  const rows = await db('email_suppression_list').select('email_normalized', 'email');
  return new Set(rows.map((row) => validEmail(row.email_normalized || row.email)).filter(Boolean));
}

function checkedQueueRecipients(queueItem, suppressed) {
  const toEmail = validEmail(queueItem?.recipient_email);
  if (!toEmail) {
    throw httpError(409, 'Glavna adresa primaoca nije ispravna.', 'CAMPAIGN_RECIPIENT_INVALID');
  }
  const ccEmails = strictQueueCcEmails(queueItem.cc_emails_json, toEmail);
  if (suppressed.has(toEmail) || ccEmails.some((email) => suppressed.has(email))) {
    throw httpError(409, 'Jedna od adresa primalaca je na listi zabrane slanja.', 'CAMPAIGN_RECIPIENT_SUPPRESSED');
  }
  return { toEmail, ccEmails };
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
    const activeCount = existing.filter((row) => row.status !== 'NOT_APPROVED').length;
    const needed = Math.max(0, settings.daily_limit - activeCount);
    if (needed > 0) {
      const [history, usedToday, suppressed] = await Promise.all([
        trx('crm_mail_queue').where({ brand_id: brand.id }).whereIn('status', ['SCHEDULED', 'SENT', 'SENDING', 'SKIPPED']).select('account_id', 'recipient_email'),
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
          cc_emails_json: JSON.stringify(storedCcEmails(account.cc_emails_json, email)),
          subject: renderTemplate(settings.subject, account),
          body_text: renderTemplate(settings.body_text, account),
          attachment_id: settings.attachment_id || null,
          status: 'PENDING',
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
  const dailyReport = await db('crm_mail_daily_reports')
    .where({ brand_id: brand.id, report_date: date })
    .select(
      'status', 'recipient_email', 'prepared_count', 'sent_count',
      'failed_count', 'remaining_count', 'sent_at', 'last_error'
    )
    .first();
  const counts = Object.fromEntries([...QUEUE_STATUSES].map((status) => [status, 0]));
  rows.forEach((row) => { counts[row.status] = (counts[row.status] || 0) + 1; });
  const sender = 'sales@s-consulting.ba';
  const candidates = rows.filter((row) => !['SENT', 'SKIPPED', 'NOT_APPROVED'].includes(row.status)).map((row) => ({
    id: row.account_id,
    candidate_id: row.id,
    account_id: row.account_id,
    name: row.company_name,
    company_name: row.company_name,
    email: row.recipient_email,
    cc_emails: row.cc_emails,
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
      prepared_count: rows.filter((row) => row.status !== 'NOT_APPROVED').length,
      sent_count: counts.SENT || 0,
      failed_count: counts.FAILED || 0,
      available_count: candidates.length,
      daily_limit: Math.min(MAX_DAILY_LIMIT, settings.daily_limit),
      report: dailyReport ? {
        status: dailyReport.status,
        recipient: dailyReport.recipient_email,
        prepared_count: Number(dailyReport.prepared_count || 0),
        sent_count: Number(dailyReport.sent_count || 0),
        failed_count: Number(dailyReport.failed_count || 0),
        remaining_count: Number(dailyReport.remaining_count || 0),
        sent_at: dailyReport.sent_at || null,
        last_error: dailyReport.last_error || ''
      } : null
    },
    source_policy: 'ONLY_EXISTING_CRM_EMAILS'
  };
}

async function reviewAutomationCandidates(db, brand, accountIds, decision, options = {}) {
  const ids = [...new Set((Array.isArray(accountIds) ? accountIds : [])
    .map((value) => String(value || '').trim()).filter(Boolean))];
  if (!ids.length) {
    throw httpError(400, 'Označite najmanje jednog prijedloga.', 'CAMPAIGN_SELECTION_REQUIRED');
  }
  if (ids.length > MAX_DAILY_LIMIT) {
    throw httpError(400, 'Odjednom možete označiti najviše 30 prijedloga.', 'CAMPAIGN_SELECTION_TOO_LARGE');
  }
  const normalizedDecision = String(decision || '').trim().toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(normalizedDecision)) {
    throw httpError(400, 'Odluka mora biti APPROVED ili REJECTED.', 'INVALID_CAMPAIGN_DECISION');
  }

  const date = options.date || businessDate();
  const targetStatus = normalizedDecision === 'APPROVED' ? 'APPROVED' : 'NOT_APPROVED';
  const now = new Date();
  await ensureAutomationSetting(db, brand);
  const result = await db.transaction(async (trx) => {
    const settings = serializeSettings(await trx('crm_mail_automation_settings')
      .where({ brand_id: brand.id }).forUpdate().first());
    const rows = await trx('crm_mail_queue')
      .where({ brand_id: brand.id, queue_date: date })
      .whereIn('status', ['PENDING', 'APPROVED', 'FAILED', 'NOT_APPROVED'])
      .andWhere((query) => query.whereIn('account_id', ids).orWhereIn('id', ids))
      .select('id', 'account_id', 'status').forUpdate();
    if (!rows.length) {
      throw httpError(
        409,
        'Označeni prijedlozi više nisu dostupni za odluku.',
        'CAMPAIGN_CANDIDATES_NOT_AVAILABLE'
      );
    }
    const changed = rows.filter((row) => row.status !== targetStatus);
    if (targetStatus === 'APPROVED') {
      const reactivatedCount = changed.filter((row) => row.status === 'NOT_APPROVED').length;
      if (reactivatedCount) {
        const activeRow = await trx('crm_mail_queue')
          .where({ brand_id: brand.id, queue_date: date })
          .whereNot({ status: 'NOT_APPROVED' })
          .count({ count: '*' }).first();
        const dailyLimit = Math.min(MAX_DAILY_LIMIT, Number(settings?.daily_limit) || MAX_DAILY_LIMIT);
        if (Number(activeRow?.count || 0) + reactivatedCount > dailyLimit) {
          throw httpError(
            409,
            `Dnevni limit od ${dailyLimit} prijedloga za ${brand.name} je dostignut.`,
            'CAMPAIGN_DAILY_LIMIT_REACHED'
          );
        }
      }
    }
    if (changed.length) {
      await trx('crm_mail_queue').whereIn('id', changed.map((row) => row.id)).update({
        status: targetStatus,
        claim_token: null,
        claimed_at: null,
        last_error: null,
        updated_at: now
      });
    }
    return {
      requested_count: ids.length,
      matched_count: rows.length,
      updated_count: changed.length,
      unavailable_count: Math.max(0, ids.length - rows.length),
      decision: normalizedDecision,
      status: targetStatus
    };
  });

  const state = await getAutomationState(db, brand, { date });
  return { ...state, review: result };
}

async function updateCandidateRecipients(db, brand, accountId, actor, input = {}, options = {}) {
  const date = options.date || businessDate();
  await ensureAutomationSetting(db, brand);
  const recipients = await db.transaction(async (trx) => {
    await trx('crm_mail_automation_settings').where({ brand_id: brand.id }).forUpdate().first();
    const account = await trx('crm_accounts').where({ id: accountId, brand_id: brand.id })
      .whereNull('archived_at').forUpdate().first();
    if (!account) throw httpError(404, 'Komitent nije pronađen.', 'ACCOUNT_NOT_FOUND');
    const toEmail = validEmail(account.email);
    if (!toEmail) {
      throw httpError(409, 'Komitent nema ispravnu glavnu e-mail adresu.', 'CAMPAIGN_RECIPIENT_INVALID');
    }
    const ccEmails = validatedCcEmails(input.cc_emails, toEmail);
    const previousCcEmails = storedCcEmails(account.cc_emails_json, toEmail);
    const now = new Date();
    const approvedQueue = await trx('crm_mail_queue')
      .where({ brand_id: brand.id, account_id: account.id, queue_date: date, status: 'APPROVED' })
      .first();
    await trx('crm_accounts').where({ id: account.id, brand_id: brand.id }).update({
      cc_emails_json: JSON.stringify(ccEmails),
      updated_by: actor.id || null,
      updated_at: now
    });
    await trx('crm_mail_queue')
      .where({ brand_id: brand.id, account_id: account.id, queue_date: date })
      .whereIn('status', ['PENDING', 'FAILED', 'NOT_APPROVED'])
      .update({ cc_emails_json: JSON.stringify(ccEmails), updated_at: now });
    await trx('crm_mail_queue')
      .where({ brand_id: brand.id, account_id: account.id, queue_date: date, status: 'APPROVED' })
      .update({
        cc_emails_json: JSON.stringify(ccEmails),
        status: 'PENDING',
        claim_token: null,
        claimed_at: null,
        last_error: null,
        updated_at: now
      });
    await trx('crm_activities').insert({
      id: uuidv4(),
      account_id: account.id,
      brand_id: brand.id,
      user_id: actor.id || null,
      activity_type: 'COMMERCIAL_RECIPIENTS_UPDATED',
      from_status: account.status,
      to_status: account.status,
      notes: 'Ažurirani CC primaoci komercijalnog maila.',
      metadata_json: JSON.stringify({
        oldCcEmails: previousCcEmails,
        newCcEmails: ccEmails,
        approvalReset: Boolean(approvedQueue)
      }),
      occurred_at: now,
      created_at: now
    });
    return { account_id: account.id, to_email: toEmail, cc_emails: ccEmails };
  });
  const state = await getAutomationState(db, brand, { date });
  return {
    ...state,
    recipients
  };
}

async function importApprovedDailyAssignments(db, brand, actor, assignmentIds, options = {}) {
  if (options.confirmed !== true) {
    throw httpError(400, 'Potvrdite pripremu odobrenih komitenata sa confirm: true.', 'SEND_CONFIRMATION_REQUIRED');
  }
  const allowedAssignmentStatuses = options.includeLegacyCompleted === true
    ? ['APPROVED', 'COMPLETED']
    : ['APPROVED'];
  if (!Array.isArray(assignmentIds)) {
    throw httpError(400, 'Pošaljite označene zapise iz današnje liste.', 'DAILY_ASSIGNMENT_SELECTION_REQUIRED');
  }
  const ids = [...new Set(assignmentIds.map((value) => String(value || '').trim()).filter(Boolean))];
  if (!ids.length) {
    throw httpError(400, 'Označite najmanje jednog odobrenog komitenta.', 'DAILY_ASSIGNMENT_SELECTION_REQUIRED');
  }
  if (ids.length > MAX_DAILY_LIMIT) {
    throw httpError(400, 'Odjednom možete uvesti najviše 30 odobrenih komitenata.', 'CAMPAIGN_SELECTION_TOO_LARGE');
  }
  const date = options.date || businessDate();
  await ensureAutomationSetting(db, brand);
  const imported = await db.transaction(async (trx) => {
    const rawSettings = await trx('crm_mail_automation_settings')
      .where({ brand_id: brand.id }).forUpdate().first();
    const settings = serializeSettings(rawSettings);
    if (!settings?.subject || !settings?.body_text) {
      throw httpError(409, 'Prvo sačuvajte naslov i sadržaj maila.', 'AUTOMATION_TEMPLATE_REQUIRED');
    }
    const assignmentCandidates = await trx({ d: 'crm_daily_assignments' })
      .where({
        'd.user_id': actor.id,
        'd.brand_id': brand.id,
        'd.assignment_date': date
      })
      .whereIn('d.id', ids)
      .select(
        'd.id as assignment_id', 'd.account_id',
        'd.sequence_number as assignment_sequence'
      )
      .orderBy('d.sequence_number')
      .orderBy('d.id');
    if (typeof options.afterAssignmentDiscovery === 'function') {
      await options.afterAssignmentDiscovery(trx, assignmentCandidates);
    }
    // Re-read under a row lock so a concurrent revoke either wins here or waits and revokes the queue after commit.
    const assignments = [];
    for (const candidate of assignmentCandidates) {
      const locked = await trx('crm_daily_assignments').where({
        id: candidate.assignment_id,
        user_id: actor.id,
        brand_id: brand.id,
        assignment_date: date
      }).whereIn('status', allowedAssignmentStatuses).forUpdate().first();
      if (locked) {
        assignments.push({
          assignment_id: locked.id,
          account_id: locked.account_id,
          assignment_sequence: Number(locked.sequence_number)
        });
      }
    }

    const [existingRows, historyRows, suppressed] = await Promise.all([
      trx('crm_mail_queue').where({ brand_id: brand.id, queue_date: date }).orderBy('sequence_number'),
      trx('crm_mail_queue').where({ brand_id: brand.id })
        .whereIn('status', ['SCHEDULED', 'SENT', 'SENDING', 'SKIPPED'])
        .select('account_id', 'recipient_email', 'queue_date', 'status'),
      suppressionSet(trx)
    ]);
    const existingByAccount = new Map(existingRows.map((row) => [row.account_id, row]));
    const todayEmailOwner = new Map(existingRows
      .map((row) => [validEmail(row.recipient_email), row.account_id])
      .filter(([email]) => email));
    const historicalAccounts = new Set(historyRows
      .filter((row) => row.queue_date !== date)
      .map((row) => row.account_id));
    const historicalEmails = new Set(historyRows
      .filter((row) => row.queue_date !== date)
      .map((row) => validEmail(row.recipient_email)).filter(Boolean));
    let activeSlots = existingRows.filter((row) => row.status !== 'NOT_APPROVED').length;
    let nextSequence = existingRows.reduce((maximum, row) => Math.max(maximum, Number(row.sequence_number) || 0), 0);
    const selectedEmails = new Set();
    const eligibleAccountIds = [];
    const eligibleAssignmentIds = [];
    let importedCount = 0;
    let alreadyReadyCount = 0;
    let replacedPendingCount = 0;
    const skippedCounts = {
      not_approved_or_unavailable: Math.max(0, ids.length - assignments.length),
      invalid_account: 0,
      invalid_email: 0,
      suppressed: 0,
      already_processed: 0,
      duplicate_email: 0,
      invalid_snapshot: 0,
      daily_limit: 0
    };
    const now = new Date();
    const requestedAccountIds = new Set(assignments.map((row) => row.account_id));
    const replaceableRows = existingRows
      .filter((row) => ['PENDING', 'FAILED'].includes(row.status) && !requestedAccountIds.has(row.account_id))
      .sort((left, right) => Number(right.sequence_number || 0) - Number(left.sequence_number || 0));

    const replacePendingRow = async (preferredRow = null) => {
      const index = preferredRow
        ? replaceableRows.findIndex((row) => row.id === preferredRow.id)
        : 0;
      if (index < 0 || !replaceableRows[index]) return false;
      const [row] = replaceableRows.splice(index, 1);
      const updated = await trx('crm_mail_queue').where({ id: row.id })
        .whereIn('status', ['PENDING', 'FAILED'])
        .update({
          status: 'NOT_APPROVED',
          claim_token: null,
          claimed_at: null,
          last_error: 'Zamijenjen ručno odabranim komitentom iz Današnjih 30.',
          updated_at: now
        });
      if (!updated) return false;
      row.status = 'NOT_APPROVED';
      const rowEmail = validEmail(row.recipient_email);
      if (rowEmail && todayEmailOwner.get(rowEmail) === row.account_id) todayEmailOwner.delete(rowEmail);
      activeSlots = Math.max(0, activeSlots - 1);
      replacedPendingCount += 1;
      return true;
    };

    for (const assignmentRow of assignments) {
      const account = await trx('crm_accounts').where({
        id: assignmentRow.account_id,
        brand_id: brand.id
      }).whereNull('archived_at').forUpdate().first();
      if (!account) {
        skippedCounts.invalid_account += 1;
        continue;
      }
      const assignment = { ...account, assignment_id: assignmentRow.assignment_id };
      const email = validEmail(assignment.email);
      const current = existingByAccount.get(assignment.id);
      if (EXCLUDED_CANDIDATE_STATUSES.includes(assignment.status)) {
        skippedCounts.invalid_account += 1;
        continue;
      }
      if (current && ['SCHEDULED', 'SENT', 'SENDING', 'SKIPPED'].includes(current.status)) {
        skippedCounts.already_processed += 1;
        continue;
      }
      if (historicalAccounts.has(assignment.id) || historicalEmails.has(email)) {
        skippedCounts.already_processed += 1;
        continue;
      }
      if (current?.status === 'APPROVED') {
        const snapshotEmail = validEmail(current.recipient_email);
        if (!email || snapshotEmail !== email) {
          skippedCounts.invalid_account += 1;
          continue;
        }
        try {
          checkedQueueRecipients(current, suppressed);
        } catch (error) {
          if (error.code === 'CAMPAIGN_RECIPIENT_SUPPRESSED') skippedCounts.suppressed += 1;
          else skippedCounts.invalid_snapshot += 1;
          continue;
        }
        const emailOwner = todayEmailOwner.get(snapshotEmail);
        if ((emailOwner && emailOwner !== assignment.id) || selectedEmails.has(snapshotEmail)) {
          skippedCounts.duplicate_email += 1;
          continue;
        }
        alreadyReadyCount += 1;
        selectedEmails.add(snapshotEmail);
        eligibleAccountIds.push(assignment.id);
        eligibleAssignmentIds.push(assignment.assignment_id);
        continue;
      }
      const ccEmails = storedCcEmails(assignment.cc_emails_json, email);
      if (!email) {
        skippedCounts.invalid_email += 1;
        continue;
      }
      if (suppressed.has(email) || ccEmails.some((ccEmail) => suppressed.has(ccEmail))) {
        skippedCounts.suppressed += 1;
        continue;
      }
      if (selectedEmails.has(email)) {
        skippedCounts.duplicate_email += 1;
        continue;
      }
      const emailOwner = todayEmailOwner.get(email);
      if (emailOwner && emailOwner !== assignment.id) {
        const ownerRow = existingByAccount.get(emailOwner);
        if (!await replacePendingRow(ownerRow)) {
          skippedCounts.duplicate_email += 1;
          continue;
        }
      }
      const needsAdditionalSlot = !current || current.status === 'NOT_APPROVED';
      if (needsAdditionalSlot && activeSlots >= Math.min(MAX_DAILY_LIMIT, settings.daily_limit)) {
        if (!await replacePendingRow()) {
          skippedCounts.daily_limit += 1;
          continue;
        }
      }
      const queueValues = {
        recipient_email: email,
        cc_emails_json: JSON.stringify(ccEmails),
        subject: renderTemplate(settings.subject, assignment),
        body_text: renderTemplate(settings.body_text, assignment),
        attachment_id: settings.attachment_id || null,
        status: 'APPROVED',
        claim_token: null,
        claimed_at: null,
        last_error: null,
        updated_at: now
      };
      if (current) {
        await trx('crm_mail_queue').where({ id: current.id })
          .whereIn('status', ['PENDING', 'FAILED', 'NOT_APPROVED'])
          .update(queueValues);
      } else {
        nextSequence += 1;
        await trx('crm_mail_queue').insert({
          id: uuidv4(),
          brand_id: brand.id,
          account_id: assignment.id,
          queue_date: date,
          sequence_number: nextSequence,
          ...queueValues,
          attempts: 0,
          created_by: String(actor.id || actor.username || 'commercial-mail-user').slice(0, 120),
          created_at: now
        });
      }
      if (needsAdditionalSlot) activeSlots += 1;
      importedCount += 1;
      selectedEmails.add(email);
      todayEmailOwner.set(email, assignment.id);
      eligibleAccountIds.push(assignment.id);
      eligibleAssignmentIds.push(assignment.assignment_id);
    }

    await trx('crm_mail_automation_settings').where({ brand_id: brand.id }).update({
      last_prepared_date: date,
      updated_at: now
    });
    return {
      requested_count: ids.length,
      approved_count: assignments.length,
      eligible_count: eligibleAccountIds.length,
      imported_count: importedCount,
      already_ready_count: alreadyReadyCount,
      replaced_pending_count: replacedPendingCount,
      skipped_count: Math.max(0, ids.length - eligibleAccountIds.length),
      skipped_counts: skippedCounts,
      eligible_account_ids: eligibleAccountIds,
      account_ids: eligibleAccountIds,
      eligible_assignment_ids: eligibleAssignmentIds,
      assignment_ids: eligibleAssignmentIds,
      include_legacy_completed: options.includeLegacyCompleted === true
    };
  });
  return { ...(await getAutomationState(db, brand, { date })), import: imported };
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
    const allSettings = await trx('crm_mail_automation_settings').orderBy('brand_id').forUpdate();
    const raw = allSettings.find((row) => row.brand_id === brand.id);
    const settings = serializeSettings(raw);
    if (!settings || !settings.enabled || settings.paused || !settings.auto_send) return null;
    if (!ignoreInterval && minutesSince(latestSentAt(allSettings), now) < settings.send_interval_minutes) return null;
    const usedRow = await trx('crm_mail_queue')
      .where({ brand_id: brand.id, queue_date: businessDate('Europe/Sarajevo', now) })
      .whereIn('status', ['SENT', 'SENDING', 'SKIPPED'])
      .count({ count: '*' }).first();
    if (Number(usedRow?.count || 0) >= Math.min(MAX_DAILY_LIMIT, settings.daily_limit)) return null;
    while (true) {
      const item = await trx('crm_mail_queue').where({
        brand_id: brand.id,
        queue_date: businessDate('Europe/Sarajevo', now),
        status: 'APPROVED'
      })
        .orderBy('sequence_number').forUpdate().first();
      if (!item) return null;
      const account = await trx('crm_accounts').where({ id: item.account_id, brand_id: brand.id })
        .whereNull('archived_at').forUpdate().first();
      const currentEmail = validEmail(account?.email);
      const snapshotEmail = validEmail(item.recipient_email);
      if (!account || EXCLUDED_CANDIDATE_STATUSES.includes(account.status)
        || !currentEmail || currentEmail !== snapshotEmail) {
        await trx('crm_mail_queue').where({ id: item.id, status: 'APPROVED' }).update({
          status: 'NOT_APPROVED',
          claim_token: null,
          claimed_at: null,
          last_error: 'Podaci komitenta su promijenjeni nakon odobrenja. Potrebna je nova provjera.',
          updated_at: now
        });
        continue;
      }
      const claimToken = uuidv4();
      const updated = await trx('crm_mail_queue').where({ id: item.id, status: 'APPROVED' }).update({
        status: 'SENDING',
        attempts: Number(item.attempts || 0) + 1,
        claim_token: claimToken,
        claimed_at: now,
        last_error: null,
        updated_at: now
      });
      return updated ? { ...item, claim_token: claimToken, settings, account } : null;
    }
  });
}

function formatSarajevoDate(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Sarajevo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.day}.${parts.month}.${parts.year}.`;
}

function formatSarajevoDateTime(value) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Sarajevo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.day}.${parts.month}.${parts.year}. u ${parts.hour}:${parts.minute}`;
}

function formatBusinessDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}.` : String(value || '');
}

async function claimDailyReport(db, brand, settings, date, now) {
  const recipient = validEmail(settings.report_recipient) || DEFAULT_REPORT_RECIPIENT;
  return db.transaction(async (trx) => {
    const grouped = await trx('crm_mail_queue')
      .where({ brand_id: brand.id, queue_date: date })
      .select('status')
      .count({ count: '*' })
      .groupBy('status');
    const counts = Object.fromEntries(grouped.map((row) => [row.status, Number(row.count || 0)]));
    const preparedCount = Object.entries(counts)
      .filter(([status]) => status !== 'NOT_APPROVED')
      .reduce((sum, [, count]) => sum + count, 0);
    const sentCount = counts.SENT || 0;
    const failedCount = counts.FAILED || 0;
    const remainingCount = (counts.PENDING || 0) + (counts.APPROVED || 0)
      + (counts.SCHEDULED || 0) + (counts.SENDING || 0);
    const id = uuidv4();
    const claimToken = uuidv4();
    await trx('crm_mail_daily_reports').insert({
      id,
      brand_id: brand.id,
      report_date: date,
      recipient_email: recipient,
      status: 'SENDING',
      prepared_count: preparedCount,
      sent_count: sentCount,
      failed_count: failedCount,
      remaining_count: remainingCount,
      claim_token: claimToken,
      claimed_at: now,
      created_at: now,
      updated_at: now
    }).onConflict(['brand_id', 'report_date']).ignore();
    const claimed = await trx('crm_mail_daily_reports').where({ brand_id: brand.id, report_date: date }).first();
    return claimed?.claim_token === claimToken ? claimed : null;
  });
}

function dailyReportMessage(brand, report) {
  return {
    subject: `[${brand.name}] Dnevni izvještaj komercijale – ${formatBusinessDate(report.report_date)}`,
    body: [
      'Poštovani,',
      '',
      `dnevni izvještaj automatske komercijale za program ${brand.name}, ${formatBusinessDate(report.report_date)}`,
      '',
      `Pripremljeno: ${Number(report.prepared_count || 0)}`,
      `Poslano: ${Number(report.sent_count || 0)}`,
      `Neuspjelo: ${Number(report.failed_count || 0)}`,
      `Preostalo: ${Number(report.remaining_count || 0)}`,
      '',
      'Ovo je automatski generisan izvještaj S-Consulting komercijale.'
    ].join('\n')
  };
}

async function sendDailyReport(db, brand, settings, options = {}) {
  const now = options.now || new Date();
  const date = options.date || businessDate('Europe/Sarajevo', now);
  const outlook = options.outlookService || createOutlookService();
  assertOutlookReady(outlook);
  const claimed = await claimDailyReport(db, brand, settings, date, now);
  if (!claimed) return { sent: false, reason: 'Dnevni izvještaj je već obrađen.' };
  const message = dailyReportMessage(brand, claimed);
  let accepted = false;
  try {
    const result = await outlook.send({
      to: [claimed.recipient_email],
      subject: message.subject,
      body: message.body,
      bodyType: 'text',
      attachments: []
    });
    accepted = true;
    const updated = await db('crm_mail_daily_reports').where({
      id: claimed.id,
      claim_token: claimed.claim_token,
      status: 'SENDING'
    }).update({
      status: 'SENT',
      sent_at: now,
      provider_message_id: result.id || null,
      provider_conversation_id: result.conversationId || null,
      last_error: null,
      updated_at: now
    });
    if (!updated) throw httpError(409, 'Izgubljena je potvrda dnevnog izvještaja.', 'DAILY_REPORT_CLAIM_LOST');
    await db('crm_mail_automation_settings').where({ brand_id: brand.id }).update({
      last_report_at: now,
      last_report_error: null,
      updated_at: now
    });
    return {
      sent: true,
      recipient: claimed.recipient_email,
      sent_count: Number(claimed.sent_count || 0),
      failed_count: Number(claimed.failed_count || 0),
      remaining_count: Number(claimed.remaining_count || 0)
    };
  } catch (error) {
    if (!accepted) {
      const messageText = String(error?.message || 'Slanje izvještaja nije uspjelo.').slice(0, 2000);
      await db.transaction(async (trx) => {
        await trx('crm_mail_daily_reports').where({
          id: claimed.id,
          claim_token: claimed.claim_token,
          status: 'SENDING'
        }).update({ status: 'FAILED', last_error: messageText, updated_at: now });
        await trx('crm_mail_automation_settings').where({ brand_id: brand.id }).update({
          last_report_error: messageText,
          updated_at: now
        });
      });
    }
    throw error;
  }
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
    await trx('crm_mail_automation_settings').where({ brand_id: brand.id }).forUpdate().first();
    const item = await trx('crm_mail_queue').where({ id: claimed.id, claim_token: claimed.claim_token, status: 'SENDING' }).forUpdate().first();
    if (!item) throw httpError(409, 'Red slanja je promijenjen tokom obrade.', 'AUTOMATION_CLAIM_LOST');
    const account = await trx('crm_accounts').where({ id: item.account_id, brand_id: brand.id }).forUpdate().first();
    if (!account) throw httpError(404, 'Komitent više ne postoji.', 'ACCOUNT_NOT_FOUND');
    const nextContactAt = new Date(sentAt.getTime() + claimed.settings.follow_up_days * 86400000);
    const quickRecordSend = claimed.delivery_mode === 'QUICK_RECORD_BUTTON';
    const commentNote = quickRecordSend
      ? `Poslat dopis ${formatSarajevoDateTime(sentAt)}.`
      : `Mail poslan ${formatSarajevoDate(sentAt)} – ${brand.name}.`;
    const ccEmails = strictQueueCcEmails(item.cc_emails_json, item.recipient_email);
    const ccNote = ccEmails.length ? ` CC: ${ccEmails.join(', ')}.` : '';
    const auditNote = `${commentNote} Sa ${sender} na ${item.recipient_email}.${ccNote} Naslov: ${item.subject}.`;
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
        ccRecipients: ccEmails,
        subject: item.subject,
        attachmentId: item.attachment_id || null,
        mode: quickRecordSend ? 'QUICK_RECORD_BUTTON' : (claimed.manual ? 'MANUAL_SELECTED' : 'AUTOMATED'),
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
    await trx('crm_mail_automation_settings').where({ brand_id: brand.id }).forUpdate().first();
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
    await trx('crm_mail_automation_settings').where({ brand_id: brand.id }).forUpdate().first();
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

async function claimImmediateAccountMail(db, brand, accountId, actor, now) {
  const date = businessDate('Europe/Sarajevo', now);
  await ensureAutomationSetting(db, brand);
  return db.transaction(async (trx) => {
    const rawSettings = await trx('crm_mail_automation_settings')
      .where({ brand_id: brand.id }).forUpdate().first();
    const settings = serializeSettings(rawSettings);
    if (!settings?.subject || !settings?.body_text) {
      throw httpError(409, 'Prvo sačuvajte naslov i sadržaj dopisa u mail kampanji iznad.', 'AUTOMATION_TEMPLATE_REQUIRED');
    }

    const account = await trx('crm_accounts')
      .where({ id: accountId, brand_id: brand.id }).whereNull('archived_at').forUpdate().first();
    if (!account) throw httpError(404, 'Komitent nije pronađen.', 'ACCOUNT_NOT_FOUND');
    if (EXCLUDED_CANDIDATE_STATUSES.includes(account.status)) {
      throw httpError(409, 'Ovom komitentu dopis nije moguće poslati zbog trenutnog CRM statusa.', 'QUICK_SEND_ACCOUNT_INELIGIBLE');
    }
    const recipientEmail = validEmail(account.email);
    if (!recipientEmail) {
      throw httpError(409, 'Komitent nema ispravnu glavnu email adresu.', 'QUICK_SEND_EMAIL_REQUIRED');
    }
    assertRecipientMatchesRawMail(account, recipientEmail);
    const ccEmails = strictQueueCcEmails(account.cc_emails_json, recipientEmail);

    const existing = await trx('crm_mail_queue')
      .where({ brand_id: brand.id, queue_date: date, account_id: account.id }).forUpdate().first();
    if (existing?.status === 'SENT') {
      throw httpError(409, 'Dopis je ovom komitentu već poslan danas.', 'QUICK_SEND_ALREADY_SENT');
    }
    if (existing?.status === 'SENDING') {
      throw httpError(409, 'Slanje dopisa ovom komitentu je već u toku.', 'QUICK_SEND_IN_PROGRESS');
    }
    if (existing?.status === 'SCHEDULED') {
      throw httpError(409, 'Dopis je ovom komitentu već zakazan za slanje.', 'QUICK_SEND_ALREADY_SCHEDULED');
    }
    if (existing?.status === 'SKIPPED') {
      throw httpError(409, 'Prethodni ishod slanja nije potvrđen. Ne ponavljajte slanje bez provjere Outlooka.', 'QUICK_SEND_OUTCOME_UNCONFIRMED');
    }

    const duplicateRecipient = await trx('crm_mail_queue')
      .where({ brand_id: brand.id, queue_date: date, recipient_email: recipientEmail })
      .whereNot({ account_id: account.id })
      .whereIn('status', ['PENDING', 'APPROVED', 'SCHEDULED', 'SENDING', 'SENT'])
      .forUpdate().first();
    if (duplicateRecipient) {
      throw httpError(409, 'Ova email adresa je već u današnjem redu slanja.', 'QUICK_SEND_DUPLICATE_RECIPIENT');
    }

    const dailyLimit = Math.min(MAX_DAILY_LIMIT, Number(settings.daily_limit) || MAX_DAILY_LIMIT);
    const usedRow = await trx('crm_mail_queue').where({ brand_id: brand.id, queue_date: date })
      .whereIn('status', ['SENT', 'SENDING', 'SKIPPED']).count({ count: '*' }).first();
    if (Number(usedRow?.count || 0) >= dailyLimit) {
      throw httpError(409, `Dnevni limit od ${dailyLimit} mailova za ${brand.name} je dostignut.`, 'CAMPAIGN_DAILY_LIMIT_REACHED');
    }

    const claimToken = uuidv4();
    const queueData = {
      recipient_email: recipientEmail,
      cc_emails_json: JSON.stringify(ccEmails),
      subject: renderTemplate(settings.subject, account),
      body_text: renderTemplate(settings.body_text, account),
      attachment_id: settings.attachment_id || null,
      status: 'SENDING',
      attempts: Number(existing?.attempts || 0) + 1,
      claim_token: claimToken,
      claimed_at: now,
      sent_at: null,
      provider_message_id: null,
      provider_conversation_id: null,
      last_error: null,
      updated_at: now
    };
    let queueId;
    let sequenceNumber;
    if (existing) {
      queueId = existing.id;
      sequenceNumber = Number(existing.sequence_number);
      await trx('crm_mail_queue').where({ id: existing.id, status: existing.status }).update(queueData);
    } else {
      const maxRow = await trx('crm_mail_queue').where({ brand_id: brand.id, queue_date: date })
        .max({ maximum: 'sequence_number' }).first();
      sequenceNumber = Number(maxRow?.maximum || 0) + 1;
      queueId = uuidv4();
      await trx('crm_mail_queue').insert({
        id: queueId,
        brand_id: brand.id,
        account_id: account.id,
        queue_date: date,
        sequence_number: sequenceNumber,
        ...queueData,
        created_by: String(actor.id || actor.username || 'commercial-mail-user').slice(0, 120),
        created_at: now
      });
    }
    return {
      id: queueId,
      brand_id: brand.id,
      account_id: account.id,
      queue_date: date,
      sequence_number: sequenceNumber,
      ...queueData,
      settings,
      account,
      manual: true,
      delivery_mode: 'QUICK_RECORD_BUTTON'
    };
  });
}

async function sendImmediateAccountMail(db, brand, accountId, options = {}) {
  if (options.confirmed !== true) {
    throw httpError(400, 'Potvrdite stvarno slanje sa confirm: true.', 'SEND_CONFIRMATION_REQUIRED');
  }
  const identifier = String(accountId || '').trim();
  if (!identifier) throw httpError(400, 'Komitent je obavezan.', 'ACCOUNT_ID_REQUIRED');
  const actor = options.actor || { id: 'commercial-mail-user', username: 'Komercijala' };
  const outlook = options.outlookService || createOutlookService();
  assertOutlookReady(outlook);
  const nowProvider = typeof options.now === 'function' ? options.now : () => (options.now || new Date());
  await markStaleClaims(db, brand.id, new Date(nowProvider()));
  let claimed = null;
  let accepted = false;
  try {
    claimed = await claimImmediateAccountMail(db, brand, identifier, actor, new Date(nowProvider()));
    const recipients = checkedQueueRecipients(claimed, await suppressionSet(db));
    const attachment = await queueAttachment(db, claimed.attachment_id, brand.id);
    const result = await outlook.send({
      to: [recipients.toEmail],
      cc: recipients.ccEmails,
      subject: claimed.subject,
      body: claimed.body_text,
      bodyType: 'text',
      attachments: attachment ? [attachment] : []
    });
    accepted = true;
    const sentAt = new Date(nowProvider());
    await recordSuccessfulSend(db, brand, claimed, result, actor, outlook.config.mailbox, sentAt);
    const account = await db('crm_accounts').where({ id: claimed.account_id }).first();
    return {
      success: true,
      sent: true,
      account_id: claimed.account_id,
      recipient: recipients.toEmail,
      cc_count: recipients.ccEmails.length,
      sent_at: sentAt,
      letter_sent_at: sentAt,
      status: account?.status || 'EMAIL_SENT',
      comment: account?.comment || '',
      last_contact_at: account?.last_contact_at || sentAt,
      next_contact_at: account?.next_contact_at || null,
      updated_at: account?.updated_at || sentAt
    };
  } catch (error) {
    if (claimed) {
      if (accepted) await recordUnconfirmedAcceptedSend(db, brand, claimed, error, new Date(nowProvider()));
      else await recordFailedSend(db, brand, claimed, error, new Date(nowProvider()));
    }
    throw error;
  }
}

async function scheduleSelectedMails(db, brand, accountIds, options = {}) {
  if (options.confirmed !== true) {
    throw httpError(400, 'Potvrdite zakazivanje sa confirm: true.', 'SCHEDULE_CONFIRMATION_REQUIRED');
  }
  const ids = [...new Set((Array.isArray(accountIds) ? accountIds : [])
    .map((value) => String(value || '').trim()).filter(Boolean))];
  if (!ids.length) {
    throw httpError(400, 'Označite najmanje jednog odobrenog kandidata.', 'CAMPAIGN_SELECTION_REQUIRED');
  }
  if (ids.length > MAX_DAILY_LIMIT) {
    throw httpError(400, 'Odjednom možete zakazati najviše 30 kandidata.', 'CAMPAIGN_SELECTION_TOO_LARGE');
  }
  const actor = options.actor || { id: 'commercial-mail-user', username: 'Komercijala' };
  const date = options.date || businessDate();
  const now = options.now || new Date();
  await ensureAutomationSetting(db, brand);
  const outcome = await db.transaction(async (trx) => {
    await trx('crm_mail_automation_settings').where({ brand_id: brand.id }).forUpdate().first();
    const rows = await trx('crm_mail_queue')
      .where({ brand_id: brand.id, queue_date: date })
      .whereIn('status', ['APPROVED', 'SCHEDULED'])
      .andWhere((query) => query.whereIn('account_id', ids).orWhereIn('id', ids))
      .orderBy('sequence_number').forUpdate();
    const rowsByAccount = new Map(rows.map((row) => [String(row.account_id), row]));
    const rowsById = new Map(rows.map((row) => [String(row.id), row]));
    const accountIdsToLock = [...new Set(rows.map((row) => row.account_id))].sort();
    const accounts = accountIdsToLock.length
      ? await trx('crm_accounts').whereIn('id', accountIdsToLock).orderBy('id').forUpdate()
      : [];
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    const suppressed = await suppressionSet(trx);
    const scheduled = [];
    const alreadyScheduled = [];
    const rejected = [];

    for (const identifier of ids) {
      const row = rowsByAccount.get(identifier) || rowsById.get(identifier);
      if (!row) {
        rejected.push({ id: identifier, code: 'NOT_APPROVED_OR_UNAVAILABLE' });
        continue;
      }
      const account = accountsById.get(row.account_id);
      const currentEmail = validEmail(account?.email);
      if (!account || account.brand_id !== brand.id || account.archived_at
        || EXCLUDED_CANDIDATE_STATUSES.includes(account.status)
        || !currentEmail || currentEmail !== validEmail(row.recipient_email)) {
        rejected.push({ id: identifier, code: 'ACCOUNT_CHANGED' });
        continue;
      }
      try {
        checkedQueueRecipients(row, suppressed);
      } catch (error) {
        rejected.push({ id: identifier, code: error.code || 'RECIPIENT_INVALID' });
        continue;
      }
      if (row.status === 'SCHEDULED') {
        alreadyScheduled.push(row.account_id);
        continue;
      }
      scheduled.push(row);
    }

    if (scheduled.length) {
      await trx('crm_mail_queue').whereIn('id', scheduled.map((row) => row.id)).update({
        status: 'SCHEDULED',
        claim_token: null,
        claimed_at: null,
        last_error: null,
        updated_at: now
      });
      await trx('crm_activities').insert(scheduled.map((row) => {
        const account = accountsById.get(row.account_id);
        return {
          id: uuidv4(),
          account_id: row.account_id,
          brand_id: brand.id,
          user_id: actor.id || null,
          activity_type: 'COMMERCIAL_EMAIL_SCHEDULED',
          from_status: account?.status || null,
          to_status: account?.status || null,
          notes: 'Mail zakazan za slanje u razmaku od 5 minuta.',
          metadata_json: JSON.stringify({
            queueId: row.id,
            intervalMinutes: SCHEDULED_SEND_INTERVAL_MINUTES
          }),
          occurred_at: now,
          created_at: now
        };
      }));
    }
    return {
      requested_count: ids.length,
      scheduled_count: scheduled.length,
      already_scheduled_count: alreadyScheduled.length,
      rejected_count: rejected.length,
      scheduled_account_ids: scheduled.map((row) => row.account_id),
      already_scheduled_account_ids: alreadyScheduled,
      rejected,
      interval_minutes: SCHEDULED_SEND_INTERVAL_MINUTES
    };
  });
  return { ...(await getAutomationState(db, brand, { date })), schedule: outcome };
}

async function claimNextScheduled(db, brand, now) {
  return db.transaction(async (trx) => {
    const allSettings = await trx('crm_mail_automation_settings').orderBy('brand_id').forUpdate();
    const rawSettings = allSettings.find((row) => row.brand_id === brand.id);
    const settings = serializeSettings(rawSettings);
    if (!settings?.subject || !settings?.body_text) return null;
    if (minutesSince(latestSentAt(allSettings), now) < SCHEDULED_SEND_INTERVAL_MINUTES) return null;
    const date = businessDate('Europe/Sarajevo', now);
    const usedRow = await trx('crm_mail_queue').where({ brand_id: brand.id, queue_date: date })
      .whereIn('status', ['SENT', 'SENDING', 'SKIPPED']).count({ count: '*' }).first();
    if (Number(usedRow?.count || 0) >= Math.min(MAX_DAILY_LIMIT, settings.daily_limit)) return null;
    while (true) {
      const item = await trx('crm_mail_queue').where({
        brand_id: brand.id,
        queue_date: date,
        status: 'SCHEDULED'
      }).orderBy('sequence_number').forUpdate().first();
      if (!item) return null;
      const account = await trx('crm_accounts').where({ id: item.account_id, brand_id: brand.id })
        .whereNull('archived_at').forUpdate().first();
      const currentEmail = validEmail(account?.email);
      if (!account || EXCLUDED_CANDIDATE_STATUSES.includes(account.status)
        || !currentEmail || currentEmail !== validEmail(item.recipient_email)) {
        await trx('crm_mail_queue').where({ id: item.id, status: 'SCHEDULED' }).update({
          status: 'NOT_APPROVED',
          claim_token: null,
          claimed_at: null,
          last_error: 'Podaci komitenta su promijenjeni nakon zakazivanja. Potrebna je nova provjera.',
          updated_at: now
        });
        continue;
      }
      const claimToken = uuidv4();
      const updated = await trx('crm_mail_queue').where({ id: item.id, status: 'SCHEDULED' }).update({
        status: 'SENDING',
        attempts: Number(item.attempts || 0) + 1,
        claim_token: claimToken,
        claimed_at: now,
        last_error: null,
        updated_at: now
      });
      return updated ? { ...item, claim_token: claimToken, settings, account, manual: true } : null;
    }
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
      .whereIn('status', ['SENT', 'SENDING', 'SKIPPED']).count({ count: '*' }).first();
    if (Number(usedRow?.count || 0) >= dailyLimit) {
      throw httpError(409, `Dnevni limit od ${dailyLimit} mailova za ${brand.name} je dostignut.`, 'CAMPAIGN_DAILY_LIMIT_REACHED');
    }
    const item = await trx('crm_mail_queue')
      .where({ brand_id: brand.id, queue_date: date, status: 'APPROVED' })
      .andWhere((query) => query.where({ account_id: identifier }).orWhere({ id: identifier }))
      .orderBy('sequence_number').forUpdate().first();
    if (!item) {
      const waiting = await trx('crm_mail_queue')
        .where({ brand_id: brand.id, queue_date: date })
        .whereIn('status', ['PENDING', 'FAILED'])
        .andWhere((query) => query.where({ account_id: identifier }).orWhere({ id: identifier }))
        .first();
      if (waiting) {
        throw httpError(409, 'Prvo odobrite prijedlog prije slanja.', 'CAMPAIGN_APPROVAL_REQUIRED');
      }
      throw httpError(409, 'Kandidat više nije dostupan za današnje slanje.', 'CAMPAIGN_CANDIDATE_NOT_AVAILABLE');
    }
    const account = await trx('crm_accounts').where({ id: item.account_id, brand_id: brand.id })
      .whereNull('archived_at').forUpdate().first();
    const currentEmail = validEmail(account?.email);
    if (!account || EXCLUDED_CANDIDATE_STATUSES.includes(account.status)
      || !currentEmail || currentEmail !== validEmail(item.recipient_email)) {
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
  const results = [];

  for (const identifier of ids) {
    let claimed = null;
    let accepted = false;
    try {
      const now = new Date(nowProvider());
      claimed = await claimSelectedQueueItem(db, brand, identifier, now);
      const attachment = await queueAttachment(db, claimed.attachment_id, brand.id);
      const recipients = checkedQueueRecipients(claimed, await suppressionSet(db));
      const result = await outlook.send({
        to: [recipients.toEmail],
        cc: recipients.ccEmails,
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
        cc_count: recipients.ccEmails.length,
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

async function sendNextScheduledMail(db, brand, options = {}) {
  const now = options.now || new Date();
  const actor = options.actor || { id: 'commercial-mail-scheduler', username: 'Zakazano slanje' };
  const outlook = options.outlookService || createOutlookService();
  assertOutlookReady(outlook);
  await markStaleClaims(db, brand.id, now);
  const claimed = await claimNextScheduled(db, brand, now);
  if (!claimed) return { sent: false, reason: 'Nema zakazane poruke spremne za slanje.' };
  let accepted = false;
  try {
    const attachment = await queueAttachment(db, claimed.attachment_id, brand.id);
    const recipients = checkedQueueRecipients(claimed, await suppressionSet(db));
    const result = await outlook.send({
      to: [recipients.toEmail],
      cc: recipients.ccEmails,
      subject: claimed.subject,
      body: claimed.body_text,
      bodyType: 'text',
      attachments: attachment ? [attachment] : []
    });
    accepted = true;
    await recordSuccessfulSend(db, brand, claimed, result, actor, outlook.config.mailbox, now);
    return {
      sent: true,
      queueId: claimed.id,
      accountId: claimed.account_id,
      recipient: claimed.recipient_email,
      ccCount: recipients.ccEmails.length,
      sentAt: now,
      mode: 'SCHEDULED'
    };
  } catch (error) {
    if (accepted) await recordUnconfirmedAcceptedSend(db, brand, claimed, error, new Date());
    else await recordFailedSend(db, brand, claimed, error, new Date());
    throw error;
  }
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
    const recipients = checkedQueueRecipients(claimed, await suppressionSet(db));
    const result = await outlook.send({
      to: [recipients.toEmail],
      cc: recipients.ccEmails,
      subject: claimed.subject,
      body: claimed.body_text,
      bodyType: 'text',
      attachments: attachment ? [attachment] : []
    });
    accepted = true;
    const sentAt = now;
    await recordSuccessfulSend(db, brand, claimed, result, actor, outlook.config.mailbox, sentAt);
    return {
      sent: true,
      queueId: claimed.id,
      accountId: claimed.account_id,
      recipient: claimed.recipient_email,
      ccCount: recipients.ccEmails.length,
      sentAt
    };
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
  const scheduledRows = await db({ q: 'crm_mail_queue' })
    .join({ b: 'crm_brands' }, 'b.id', 'q.brand_id')
    .where({ 'q.queue_date': date, 'q.status': 'SCHEDULED', 'b.active': true })
    .select('b.*')
    .distinct();
  const scheduledResults = [];
  for (const brand of scheduledRows) {
    try {
      const result = await sendNextScheduledMail(db, brand, { now, outlookService: outlook });
      scheduledResults.push({
        brand: brand.code,
        ...result,
        recipient: result.recipient ? '[evidentirano]' : undefined
      });
    } catch (error) {
      scheduledResults.push({ brand: brand.code, sent: false, error: String(error.message || error).slice(0, 500) });
    }
  }

  const rows = await db({ s: 'crm_mail_automation_settings' })
    .join({ b: 'crm_brands' }, 'b.id', 's.brand_id')
    .where({ 's.enabled': true, 's.paused': false, 's.auto_send': true, 'b.active': true })
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
      let sendResult;
      if (time < state.settings.send_window_start || time > state.settings.send_window_end) {
        sendResult = { sent: false, reason: 'Izvan termina slanja.', prepared: state.queue.length };
      } else {
        try {
          sendResult = await sendNextAutomatedMail(db, brand, { now, outlookService: outlook });
        } catch (error) {
          sendResult = { sent: false, error: String(error.message || error).slice(0, 500) };
        }
      }
      let report = { sent: false, reason: 'Izvještaj još nije na rasporedu.' };
      if (state.settings.report_enabled && time >= state.settings.report_time) {
        try {
          report = await sendDailyReport(db, brand, state.settings, { now, date, outlookService: outlook });
        } catch (error) {
          report = { sent: false, error: String(error.message || error).slice(0, 500) };
        }
      }
      results.push({
        brand: brand.code,
        ...sendResult,
        recipient: sendResult.recipient ? '[evidentirano]' : undefined,
        report: { ...report, recipient: report.recipient ? '[evidentirano]' : undefined }
      });
    } catch (error) {
      results.push({ brand: brand.code, sent: false, error: String(error.message || error).slice(0, 500) });
    }
  }
  return { date, time, scheduled: scheduledResults, results };
}

async function needsFiveMinuteFollowUp(db, options = {}) {
  const now = options.now || new Date();
  const date = businessDate('Europe/Sarajevo', now);
  const scheduled = await db({ q: 'crm_mail_queue' })
    .join({ b: 'crm_brands' }, 'b.id', 'q.brand_id')
    .where({ 'q.queue_date': date, 'q.status': 'SCHEDULED', 'b.active': true })
    .first('q.id');
  if (scheduled) return true;

  const { weekday, time } = sarajevoParts(now);
  const fastBrands = await db({ s: 'crm_mail_automation_settings' })
    .join({ b: 'crm_brands' }, 'b.id', 's.brand_id')
    .where({
      's.enabled': true,
      's.paused': false,
      's.auto_send': true,
      's.send_interval_minutes': SCHEDULED_SEND_INTERVAL_MINUTES,
      'b.active': true
    })
    .select('s.brand_id', 's.workdays_json', 's.send_window_start', 's.send_window_end');
  for (const row of fastBrands) {
    if (!normalizeWorkdays(row.workdays_json).includes(weekday)
      || time < row.send_window_start || time > row.send_window_end) continue;
    const approved = await db('crm_mail_queue').where({
      brand_id: row.brand_id,
      queue_date: date,
      status: 'APPROVED'
    }).first('id');
    if (approved) return true;
  }
  return false;
}

async function runAutomationJob(db, options = {}) {
  const nowProvider = options.nowProvider || (() => new Date());
  const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const firstNow = new Date(nowProvider());
  const first = await runAutomationTick(db, { now: firstNow, outlookService: options.outlookService });
  const followUpNeeded = await needsFiveMinuteFollowUp(db, { now: firstNow });
  if (!followUpNeeded) return { first, follow_up: null };
  await sleep(SCHEDULED_SEND_INTERVAL_MINUTES * 60000);
  const second = await runAutomationTick(db, {
    now: new Date(nowProvider()),
    outlookService: options.outlookService
  });
  return { first, follow_up: second };
}

module.exports = {
  EXCLUDED_CANDIDATE_STATUSES,
  QUEUE_STATUSES,
  ensureAutomationSetting,
  getAutomationState,
  importApprovedDailyAssignments,
  pauseAutomation,
  prepareAutomationQueue,
  reviewAutomationCandidates,
  runAutomationJob,
  runAutomationTick,
  scheduleSelectedMails,
  sendDailyReport,
  sendNextAutomatedMail,
  sendNextScheduledMail,
  sendImmediateAccountMail,
  sendSelectedMails,
  updateCandidateRecipients,
  updateAutomationSettings,
  validEmail
};
