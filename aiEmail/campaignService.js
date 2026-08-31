const { v4: uuidv4 } = require('uuid');
const { isValidEmail } = require('./contactUtils');
const { logActivity } = require('./activityLog');

const CAMPAIGN_TEXT_FIELDS = [
  'name', 'description', 'product_service', 'goal', 'language', 'market_country',
  'offer_information', 'tone', 'subject_guidance', 'call_to_action', 'signature',
  'allowed_facts', 'forbidden_claims', 'send_window_start', 'send_window_end', 'timezone'
];
const CAMPAIGN_NUMBER_FIELDS = [
  ['daily_limit', 1, 200],
  ['min_interval_minutes', 1, 1440],
  ['max_followups', 0, 10],
  ['first_followup_days', 1, 365],
  ['second_followup_days', 1, 365]
];

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

function optionalText(value, maxLength = 20000) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  return String(value).trim().slice(0, maxLength);
}

function boundedInteger(value, fallback, min, max, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    if (fallback !== undefined) return fallback;
    throw httpError(400, `${label} mora biti između ${min} i ${max}.`);
  }
  return parsed;
}

function normalizeCampaignInput(body, existing = {}) {
  const defaults = {
    language: 'bs',
    send_window_start: '09:00',
    send_window_end: '15:00',
    timezone: process.env.AI_EMAIL_TIMEZONE || 'Europe/Sarajevo',
    daily_limit: Number(process.env.AI_EMAIL_DAILY_LIMIT || 20),
    min_interval_minutes: Number(process.env.AI_EMAIL_MIN_INTERVAL_MINUTES || 5),
    max_followups: 2,
    first_followup_days: 5,
    second_followup_days: 7
  };
  const result = {};

  for (const field of CAMPAIGN_TEXT_FIELDS) {
    const current = Object.prototype.hasOwnProperty.call(body, field)
      ? body[field]
      : (existing[field] ?? defaults[field]);
    result[field] = optionalText(current, field === 'name' ? 200 : 20000);
  }
  if (!result.name) throw httpError(400, 'Naziv kampanje je obavezan.');
  result.language = result.language || 'bs';
  result.timezone = result.timezone || defaults.timezone;

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result.send_window_start || '')) {
    throw httpError(400, 'Početak perioda slanja mora biti u formatu HH:mm.');
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(result.send_window_end || '')) {
    throw httpError(400, 'Kraj perioda slanja mora biti u formatu HH:mm.');
  }

  for (const [field, min, max] of CAMPAIGN_NUMBER_FIELDS) {
    const source = Object.prototype.hasOwnProperty.call(body, field)
      ? body[field]
      : (existing[field] ?? defaults[field]);
    result[field] = boundedInteger(source, undefined, min, max, field);
  }

  const daySource = Object.prototype.hasOwnProperty.call(body, 'allowed_days')
    ? body.allowed_days
    : parseJson(existing.allowed_days_json, [1, 2, 3, 4, 5]);
  if (!Array.isArray(daySource)) throw httpError(400, 'Dozvoljeni dani moraju biti lista.');
  const allowedDays = [...new Set(daySource.map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);
  if (!allowedDays.length) throw httpError(400, 'Odaberite najmanje jedan dozvoljeni dan.');
  result.allowed_days_json = JSON.stringify(allowedDays);

  if (Object.prototype.hasOwnProperty.call(body, 'starts_at')) {
    result.starts_at = body.starts_at ? new Date(body.starts_at) : null;
    if (result.starts_at && Number.isNaN(result.starts_at.getTime())) {
      throw httpError(400, 'Datum početka kampanje nije ispravan.');
    }
  } else {
    result.starts_at = existing.starts_at || null;
  }

  return result;
}

function serializeCampaign(row) {
  return row ? {
    ...row,
    allowed_days: parseJson(row.allowed_days_json, [1, 2, 3, 4, 5]),
    allowed_days_json: undefined
  } : null;
}

function uniqueIds(values, max = 200) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(String).filter(Boolean))].slice(0, max);
}

function contactExclusionReason(contact, suppressedEmails = new Set()) {
  if (contact.archived_at) return 'ARCHIVED';
  if (suppressedEmails.has(contact.email_normalized)) return 'SUPPRESSED';
  if (!contact.sending_allowed) return 'SENDING_NOT_ALLOWED';
  if (!isValidEmail(contact.email_normalized || contact.email)) return 'INVALID_EMAIL';
  return null;
}

async function replaceRecipients(trx, campaignId, contactIds) {
  const ids = uniqueIds(contactIds);
  if (!ids.length) throw httpError(400, 'Odaberite najmanje jednog primaoca.');

  const hasMessages = await trx('email_messages').where({ campaign_id: campaignId }).first('id');
  if (hasMessages) throw httpError(409, 'Primaoci se ne mogu mijenjati nakon generisanja nacrta.');

  const contacts = await trx('email_contacts').whereIn('id', ids);
  const emails = contacts.map((contact) => contact.email_normalized).filter(Boolean);
  const suppressedRows = emails.length
    ? await trx('email_suppression_list').whereIn('email_normalized', emails).select('email_normalized')
    : [];
  const suppressed = new Set(suppressedRows.map((row) => row.email_normalized));
  const now = new Date();
  const rows = contacts.map((contact) => {
    const excludedReason = contactExclusionReason(contact, suppressed);
    return {
      id: uuidv4(),
      campaign_id: campaignId,
      contact_id: contact.id,
      status: excludedReason ? 'EXCLUDED' : 'ACTIVE',
      excluded_reason: excludedReason,
      created_at: now,
      updated_at: now
    };
  });

  await trx('email_campaign_contacts').where({ campaign_id: campaignId }).del();
  if (rows.length) await trx('email_campaign_contacts').insert(rows);
  return {
    requested: ids.length,
    found: contacts.length,
    eligible: rows.filter((row) => row.status === 'ACTIVE').length,
    excluded: rows.filter((row) => row.status === 'EXCLUDED').length,
    missing: ids.length - contacts.length
  };
}

async function createCampaign({ db, user, body }) {
  const id = uuidv4();
  const now = new Date();
  const campaign = normalizeCampaignInput(body);
  let recipientReport;
  await db.transaction(async (trx) => {
    await trx('email_campaigns').insert({
      id,
      ...campaign,
      status: 'DRAFT',
      created_by: user.id,
      created_at: now,
      updated_at: now
    });
    recipientReport = await replaceRecipients(trx, id, body.contact_ids);
    if (!recipientReport.eligible) {
      throw httpError(400, 'Među odabranim kontaktima nema primaoca kojem je slanje dozvoljeno.');
    }
    await logActivity(trx, user, 'CAMPAIGN_CREATED', 'email_campaign', id, recipientReport);
  });
  return { campaign: await getCampaign(db, id), recipientReport };
}

async function updateCampaign({ db, user, campaignId, body }) {
  const existing = await db('email_campaigns').where({ id: campaignId }).first();
  if (!existing) throw httpError(404, 'Kampanja nije pronađena.');
  if (existing.status !== 'DRAFT') throw httpError(409, 'Mijenjati se može samo kampanja u pripremi.');
  const hasMessages = await db('email_messages').where({ campaign_id: campaignId }).first('id');
  if (hasMessages) throw httpError(409, 'Kampanja se ne može mijenjati nakon generisanja nacrta.');
  const update = normalizeCampaignInput(body, existing);
  let recipientReport;
  await db.transaction(async (trx) => {
    await trx('email_campaigns').where({ id: campaignId }).update({ ...update, updated_at: new Date() });
    if (Object.prototype.hasOwnProperty.call(body, 'contact_ids')) {
      recipientReport = await replaceRecipients(trx, campaignId, body.contact_ids);
      if (!recipientReport.eligible) throw httpError(400, 'Nema primaoca kojem je slanje dozvoljeno.');
    }
    await logActivity(trx, user, 'CAMPAIGN_UPDATED', 'email_campaign', campaignId, recipientReport || {});
  });
  return { campaign: await getCampaign(db, campaignId), recipientReport };
}

async function listCampaigns(db) {
  const campaigns = await db('email_campaigns').orderBy('created_at', 'desc');
  if (!campaigns.length) return [];
  const ids = campaigns.map((campaign) => campaign.id);
  const [recipientRows, messageRows] = await Promise.all([
    db('email_campaign_contacts').whereIn('campaign_id', ids)
      .select('campaign_id', 'status').count({ count: '*' }).groupBy('campaign_id', 'status'),
    db('email_messages').whereIn('campaign_id', ids)
      .select('campaign_id', 'status').count({ count: '*' }).groupBy('campaign_id', 'status')
  ]);
  return campaigns.map((campaign) => ({
    ...serializeCampaign(campaign),
    recipients: recipientRows
      .filter((row) => row.campaign_id === campaign.id)
      .reduce((acc, row) => ({ ...acc, [row.status]: Number(row.count) }), {}),
    messages: messageRows
      .filter((row) => row.campaign_id === campaign.id)
      .reduce((acc, row) => ({ ...acc, [row.status]: Number(row.count) }), {})
  }));
}

async function getCampaign(db, campaignId) {
  const campaign = await db('email_campaigns').where({ id: campaignId }).first();
  if (!campaign) return null;
  const recipients = await db({ cc: 'email_campaign_contacts' })
    .join({ c: 'email_contacts' }, 'c.id', 'cc.contact_id')
    .where('cc.campaign_id', campaignId)
    .select(
      'cc.id', 'cc.contact_id', 'cc.status', 'cc.excluded_reason',
      'c.company_name', 'c.contact_person', 'c.email', 'c.country', 'c.city',
      'c.priority', 'c.sending_allowed', 'c.archived_at'
    )
    .orderBy('c.company_name');
  return { ...serializeCampaign(campaign), recipients };
}

async function recipientEligibility(db, contact) {
  const suppressed = contact.email_normalized
    ? await db('email_suppression_list').where({ email_normalized: contact.email_normalized }).first('id')
    : null;
  return contactExclusionReason(contact, new Set(suppressed ? [contact.email_normalized] : []));
}

async function nextVersionNumber(trx, messageId) {
  const row = await trx('email_message_versions').where({ message_id: messageId }).max({ max: 'version_number' }).first();
  return Number(row && row.max ? row.max : 0) + 1;
}

async function storeDraftVersion(trx, { messageId, draft, source, user, note }) {
  const versionNumber = await nextVersionNumber(trx, messageId);
  await trx('email_message_versions').insert({
    id: uuidv4(),
    message_id: messageId,
    version_number: versionNumber,
    source,
    subject: draft.subject,
    body_text: draft.body_text,
    body_html: draft.body_html || null,
    personalization_summary: draft.personalization_summary || null,
    warnings_json: JSON.stringify(draft.warnings || []),
    ai_model: draft.ai_model || null,
    ai_response_id: draft.ai_response_id || null,
    prompt_version: draft.prompt_version || null,
    changed_by: user.id,
    change_note: optionalText(note, 2000),
    created_at: new Date()
  });
  return versionNumber;
}

async function generateCampaignDrafts({ db, user, campaignId, contactIds, regenerate = false, confirmed = false, draftGenerator }) {
  if (!confirmed) throw httpError(400, 'Potvrdite trošak i kontrolisano AI generisanje nacrta.');
  const campaign = await db('email_campaigns').where({ id: campaignId }).first();
  if (!campaign) throw httpError(404, 'Kampanja nije pronađena.');
  if (campaign.status !== 'DRAFT') throw httpError(409, 'Nacrti se mogu generisati samo za kampanju u pripremi.');
  if (typeof draftGenerator !== 'function') throw httpError(503, 'AI generator nije dostupan.');

  let recipientsQuery = db({ cc: 'email_campaign_contacts' })
    .join({ c: 'email_contacts' }, 'c.id', 'cc.contact_id')
    .where({ 'cc.campaign_id': campaignId, 'cc.status': 'ACTIVE' })
    .select('cc.id as campaign_contact_id', 'cc.status as campaign_contact_status', 'c.*')
    .orderBy('c.company_name');
  const requestedIds = uniqueIds(contactIds, 50);
  if (requestedIds.length) recipientsQuery = recipientsQuery.whereIn('c.id', requestedIds);
  const recipientPool = await recipientsQuery.limit(200);
  if (!recipientPool.length) throw httpError(400, 'Kampanja nema odabranih aktivnih primalaca.');
  const report = { generated: 0, regenerated: 0, skipped: 0, excluded: 0, failed: 0, errors: [] };
  let recipients = recipientPool.slice(0, 50);
  if (!regenerate) {
    const existingRows = await db('email_messages')
      .where({ campaign_id: campaignId, message_type: 'INITIAL', sequence_number: 0 })
      .whereIn('contact_id', recipientPool.map((contact) => contact.id))
      .select('contact_id');
    const existingContactIds = new Set(existingRows.map((row) => row.contact_id));
    report.skipped = existingContactIds.size;
    recipients = recipientPool.filter((contact) => !existingContactIds.has(contact.id)).slice(0, 50);
  }

  for (const contact of recipients) {
    const exclusionReason = await recipientEligibility(db, contact);
    if (exclusionReason) {
      await db('email_campaign_contacts').where({ id: contact.campaign_contact_id }).update({
        status: 'EXCLUDED', excluded_reason: exclusionReason, updated_at: new Date()
      });
      report.excluded += 1;
      continue;
    }

    const existing = await db('email_messages').where({
      campaign_id: campaignId,
      contact_id: contact.id,
      message_type: 'INITIAL',
      sequence_number: 0
    }).first();
    if (existing && !regenerate) {
      continue;
    }

    try {
      const draft = await draftGenerator({ campaign, contact, actorId: user.id });
      const messageId = existing ? existing.id : uuidv4();
      await db.transaction(async (trx) => {
        const now = new Date();
        const messageData = {
          status: 'DRAFT',
          to_email: contact.email_normalized || contact.email,
          subject: draft.subject,
          body_text: draft.body_text,
          body_html: draft.body_html || null,
          personalization_summary: draft.personalization_summary || null,
          warnings_json: JSON.stringify(draft.warnings || []),
          ai_model: draft.ai_model || null,
          ai_response_id: draft.ai_response_id || null,
          prompt_version: draft.prompt_version || null,
          approved_by: null,
          approved_at: null,
          scheduled_at: null,
          test_mode: true,
          updated_at: now
        };
        if (existing) {
          await trx('email_messages').where({ id: messageId }).update(messageData);
        } else {
          await trx('email_messages').insert({
            id: messageId,
            campaign_id: campaignId,
            contact_id: contact.id,
            parent_message_id: null,
            message_type: 'INITIAL',
            sequence_number: 0,
            attempt_count: 0,
            created_at: now,
            ...messageData
          });
        }
        const versionNumber = await storeDraftVersion(trx, {
          messageId,
          draft,
          source: 'AI',
          user,
          note: existing ? 'Ponovno AI generisanje' : 'Prvo AI generisanje'
        });
        await logActivity(trx, user, existing ? 'DRAFT_REGENERATED' : 'DRAFT_GENERATED', 'email_message', messageId, {
          campaignId,
          contactId: contact.id,
          versionNumber,
          aiModel: draft.ai_model || null,
          promptVersion: draft.prompt_version || null
        });
      });
      if (existing) report.regenerated += 1;
      else report.generated += 1;
    } catch (error) {
      if (Number(error.status) === 503) throw error;
      report.failed += 1;
      report.errors.push({ contact_id: contact.id, company_name: contact.company_name, error: error.message });
      await logActivity(db, user, 'DRAFT_GENERATION_FAILED', 'email_campaign', campaignId, {
        contactId: contact.id,
        error: String(error.message || 'Nepoznata greška').slice(0, 1000)
      });
    }
  }
  return report;
}

function serializeMessage(row) {
  return row ? { ...row, warnings: parseJson(row.warnings_json, []), warnings_json: undefined } : null;
}

function draftBaseQuery(db) {
  return db({ m: 'email_messages' })
    .join({ cp: 'email_campaigns' }, 'cp.id', 'm.campaign_id')
    .join({ c: 'email_contacts' }, 'c.id', 'm.contact_id')
    .select(
      'm.*',
      'cp.name as campaign_name',
      'c.company_name',
      'c.contact_person',
      'c.email as contact_email',
      'c.sending_allowed',
      'c.archived_at as contact_archived_at'
    );
}

async function listDrafts(db, { campaignId, status } = {}) {
  const query = draftBaseQuery(db);
  if (campaignId) query.where('m.campaign_id', campaignId);
  if (status) query.where('m.status', String(status).toUpperCase());
  const rows = await query.orderBy('m.updated_at', 'desc').limit(200);
  return rows.map(serializeMessage);
}

async function getDraft(db, messageId) {
  const row = await draftBaseQuery(db).where('m.id', messageId).first();
  if (!row) return null;
  const versions = await db('email_message_versions')
    .where({ message_id: messageId })
    .orderBy('version_number', 'desc');
  return {
    ...serializeMessage(row),
    versions: versions.map(serializeMessage)
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function textToHtml(value) {
  return String(value).split(/\n{2,}/).map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
}

async function saveDraft({ db, user, messageId, body }) {
  const existing = await db('email_messages').where({ id: messageId }).first();
  if (!existing) throw httpError(404, 'Nacrt nije pronađen.');
  if (!['DRAFT', 'PENDING_APPROVAL'].includes(existing.status)) {
    throw httpError(409, 'Odobreni nacrt prvo vratite na doradu.');
  }
  const subject = optionalText(body.subject ?? existing.subject, 180);
  const bodyText = optionalText(body.body_text ?? existing.body_text, 12000);
  if (!subject || !bodyText) throw httpError(400, 'Predmet i tekst poruke su obavezni.');
  const draft = {
    subject,
    body_text: bodyText,
    body_html: optionalText(body.body_html, 20000) || textToHtml(bodyText),
    personalization_summary: optionalText(body.personalization_summary ?? existing.personalization_summary, 2000),
    warnings: Array.isArray(body.warnings) ? body.warnings.map((item) => String(item).slice(0, 500)).slice(0, 10) : parseJson(existing.warnings_json, [])
  };
  let versionNumber;
  await db.transaction(async (trx) => {
    await trx('email_messages').where({ id: messageId }).update({
      subject: draft.subject,
      body_text: draft.body_text,
      body_html: draft.body_html,
      personalization_summary: draft.personalization_summary,
      warnings_json: JSON.stringify(draft.warnings),
      status: 'DRAFT',
      approved_by: null,
      approved_at: null,
      scheduled_at: null,
      updated_at: new Date()
    });
    versionNumber = await storeDraftVersion(trx, {
      messageId,
      draft,
      source: 'MANUAL',
      user,
      note: body.change_note || 'Ručna izmjena nacrta'
    });
    await logActivity(trx, user, 'DRAFT_EDITED', 'email_message', messageId, { versionNumber });
  });
  return getDraft(db, messageId);
}

async function assertDraftEligible(db, message) {
  const contact = await db('email_contacts').where({ id: message.contact_id }).first();
  if (!contact) throw httpError(409, 'Kontakt više ne postoji.');
  const exclusionReason = await recipientEligibility(db, contact);
  if (exclusionReason) throw httpError(409, `Nacrt se ne može odobriti: ${exclusionReason}.`);
  const campaignContact = await db('email_campaign_contacts').where({
    campaign_id: message.campaign_id,
    contact_id: message.contact_id,
    status: 'ACTIVE'
  }).first();
  if (!campaignContact) throw httpError(409, 'Primalac više nije aktivan u kampanji.');
}

async function submitDraft({ db, user, messageId }) {
  const message = await db('email_messages').where({ id: messageId }).first();
  if (!message) throw httpError(404, 'Nacrt nije pronađen.');
  if (message.status !== 'DRAFT') throw httpError(409, 'Samo nacrt u pripremi može biti poslan na odobrenje.');
  if (!message.subject || !message.body_text) throw httpError(400, 'Predmet i tekst poruke su obavezni.');
  await assertDraftEligible(db, message);
  await db.transaction(async (trx) => {
    await trx('email_messages').where({ id: messageId }).update({
      status: 'PENDING_APPROVAL',
      approved_by: null,
      approved_at: null,
      scheduled_at: null,
      updated_at: new Date()
    });
    await logActivity(trx, user, 'DRAFT_SUBMITTED_FOR_APPROVAL', 'email_message', messageId);
  });
  return getDraft(db, messageId);
}

async function approveDraft({ db, user, messageId }) {
  const message = await db('email_messages').where({ id: messageId }).first();
  if (!message) throw httpError(404, 'Nacrt nije pronađen.');
  if (message.status !== 'PENDING_APPROVAL') throw httpError(409, 'Nacrt mora prvo biti poslan na odobrenje.');
  await assertDraftEligible(db, message);
  await db.transaction(async (trx) => {
    await trx('email_messages').where({ id: messageId }).update({
      status: 'APPROVED',
      approved_by: user.id,
      approved_at: new Date(),
      scheduled_at: null,
      test_mode: true,
      updated_at: new Date()
    });
    await logActivity(trx, user, 'DRAFT_APPROVED', 'email_message', messageId, {
      safetyBoundary: 'APPROVED_NOT_QUEUED'
    });
  });
  return getDraft(db, messageId);
}

async function returnDraftForEditing({ db, user, messageId, reason }) {
  const message = await db('email_messages').where({ id: messageId }).first();
  if (!message) throw httpError(404, 'Nacrt nije pronađen.');
  if (!['PENDING_APPROVAL', 'APPROVED'].includes(message.status)) {
    throw httpError(409, 'Nacrt nije u statusu koji se može vratiti na doradu.');
  }
  if (message.status === 'APPROVED' && user.role !== 'direktor') {
    throw httpError(403, 'Samo direktor može povući već odobren nacrt.');
  }
  await db.transaction(async (trx) => {
    await trx('email_messages').where({ id: messageId }).update({
      status: 'DRAFT',
      approved_by: null,
      approved_at: null,
      scheduled_at: null,
      updated_at: new Date()
    });
    await logActivity(trx, user, 'DRAFT_RETURNED_FOR_EDITING', 'email_message', messageId, {
      reason: optionalText(reason, 1000)
    });
  });
  return getDraft(db, messageId);
}

module.exports = {
  approveDraft,
  contactExclusionReason,
  createCampaign,
  generateCampaignDrafts,
  getCampaign,
  getDraft,
  listCampaigns,
  listDrafts,
  normalizeCampaignInput,
  returnDraftForEditing,
  saveDraft,
  serializeCampaign,
  submitDraft,
  updateCampaign
};
