const crypto = require('node:crypto');
const { createGraphClient, createOutlookConfig } = require('../outlookMail/graphClient');
const { classify, emails } = require('./inboundClassifier');
const { suppressAddressInTransaction } = require('./unsubscribe');
const { strictEmailAddress } = require('./email');

const ACTOR = 'mail-reply-worker';
const OWN = new Set(['sales@s-consulting.ba', 'prodaja@s-consulting.ba', 'info@s-consulting.ba']);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const parse = (value, fallback = {}) => { try { return JSON.parse(value || 'null') || fallback; } catch { return fallback; } };
const subjectKey = value => String(value || '').replace(/^(?:(?:re|fw|fwd|odg|aw):\s*)+/i, '').trim().toLowerCase();
function identity(message, mailbox) {
  const from = strictEmailAddress(message.from?.emailAddress?.address) || '';
  return hash(message.internetMessageId ? from + '\n' + message.internetMessageId.trim() : mailbox + '\n' + message.id);
}
async function loadContext(db) {
  const accounts = await db('crm_accounts').select('id', 'brand_id', 'company_name', 'email', 'raw_mail', 'cc_emails_json', 'status', 'archived_at', 'marketing_opt_out_at');
  const sent = await db('crm_mail_queue').where({ status: 'SENT' }).select('id', 'account_id', 'recipient_email', 'cc_emails_json', 'subject', 'provider_conversation_id');
  const activities = await db('crm_activities').where({ activity_type: 'COMMERCIAL_EMAIL_SENT' }).select('account_id', 'metadata_json');
  const byEmail = new Map(), byConversation = new Map(), byMessage = new Map();
  const add = (map, key, id) => { if (!key || !id) return; if (!map.has(key)) map.set(key, new Set()); map.get(key).add(id); };
  for (const a of accounts) for (const e of emails([a.email, a.raw_mail, a.cc_emails_json].join(' '))) add(byEmail, e, a.id);
  for (const q of sent) {
    for (const e of emails([q.recipient_email, q.cc_emails_json].join(' '))) add(byEmail, e, q.account_id);
    add(byConversation, q.provider_conversation_id, q.account_id);
  }
  for (const a of activities) {
    const m = parse(a.metadata_json);
    add(byMessage, m.providerInternetMessageId || m.internetMessageId, a.account_id);
    add(byConversation, m.providerConversationId || m.conversationId, a.account_id);
    for (const e of emails(m.recipient || m.to || '')) add(byEmail, e, a.account_id);
  }
  return { accounts, byEmail, byConversation, byMessage, subjects: new Set(sent.map(q => subjectKey(q.subject)).filter(Boolean)) };
}
function matchMessage(message, context) {
  const sender = strictEmailAddress(message.from?.emailAddress?.address), senderIds = [...(context.byEmail.get(sender) || [])];
  const headers = (message.internetMessageHeaders || []).filter(h => /^(in-reply-to|references)$/i.test(h.name)).map(h => h.value).join(' ');
  const referenced = [...headers.matchAll(/<[^<>\s]+>/g)].flatMap(m => [...(context.byMessage.get(m[0]) || [])]);
  const threadIds = [...new Set([...referenced, ...(context.byConversation.get(message.conversationId) || [])])];
  const intersection = senderIds.filter(id => threadIds.includes(id));
  if (intersection.length) return { accountIds: intersection, verifiedAccountIds: senderIds, method: 'SENDER_AND_THREAD' };
  if (senderIds.length) return { accountIds: senderIds, verifiedAccountIds: senderIds, method: 'EXACT_SENDER' };
  if (threadIds.length) return { accountIds: threadIds, verifiedAccountIds: [], method: 'THREAD_DIFFERENT_SENDER' };
  return { accountIds: [], verifiedAccountIds: [], method: 'UNMATCHED' };
}
async function recordMessage(db, message, mailbox, context, { dryRun = false } = {}) {
  const id = identity(message, mailbox);
  if (await db('crm_inbound_messages').where({ id }).first('id')) return { duplicate: true };
  let decision = classify(message), match = matchMessage(message, context);
  if (message.isDraft || OWN.has(decision.sender) || /@s-consulting\.ba$/i.test(decision.sender || '')) decision = { ...decision, kind: 'OWN_MESSAGE' };
  if (!decision.sender) decision = { ...decision, kind: 'MISSING_SENDER' };
  const automated = ['DELIVERY_NOTICE', 'AUTOMATIC_REPLY', 'OWN_MESSAGE', 'MISSING_SENDER'].includes(decision.kind);
  const authentication = (message.internetMessageHeaders || []).filter(h => /^authentication-results$/i.test(h.name)).map(h => h.value).join('\n');
  const authenticationFailed = /dmarc=fail/i.test(authentication) && /(?:spf|dkim)=fail/i.test(authentication);
  if (!automated && authenticationFailed) decision.kind = 'REPLY_REVIEW';
  if (!automated && match.method === 'THREAD_DIFFERENT_SENDER' && decision.kind !== 'UNSUBSCRIBE') decision.kind = 'REPLY_REVIEW';
  if (!automated && !match.accountIds.length && decision.kind !== 'UNSUBSCRIBE') {
    const replyToKnownSubject = context.subjects?.has(subjectKey(message.subject))
      && (/^(?:re|odg|aw):/i.test(message.subject || '') || (message.internetMessageHeaders || []).some(h => /^in-reply-to$/i.test(h.name)));
    // Keep actual campaign replies from an unfamiliar address for review without
    // guessing which customer owns the address or silently discarding the reply.
    decision.kind = replyToKnownSubject ? 'REPLY_REVIEW' : 'UNRELATED';
  }
  const relevant = ['UNSUBSCRIBE', 'HUMAN_REPLY', 'REPLY_REVIEW'].includes(decision.kind);
  if (dryRun) return { id, classification: decision.kind, matched: match.accountIds.length, method: match.method,
    ...(relevant ? { sender: decision.sender, subject: message.subject, excerpt: decision.text.slice(0, 600) } : {}) };
  return db.transaction(async trx => {
    const inserted = await trx('crm_inbound_messages').insert({ id, mailbox, provider_message_id: message.id,
      internet_message_id: message.internetMessageId || null, sender_email: relevant ? decision.sender : null,
      subject: relevant ? String(message.subject || '').slice(0, 2000) : null, body_text: relevant ? decision.text : null,
      received_at: message.receivedDateTime || new Date(), classification: decision.kind, match_method: match.method,
      account_ids_json: JSON.stringify(relevant ? match.accountIds : []),
      evidence_json: relevant ? JSON.stringify({ conversationId: message.conversationId, authenticationFailed,
        inReplyTo: (message.internetMessageHeaders || []).find(h => /^in-reply-to$/i.test(h.name))?.value || null,
        verifiedAccountIds: match.verifiedAccountIds, hasAttachments: Boolean(message.hasAttachments) }) : null,
      created_at: new Date() }).onConflict('id').ignore().returning('id');
    if (!inserted.length) return { duplicate: true };
    if (!relevant) return { classification: decision.kind };
    const now = new Date(), occurredAt = message.receivedDateTime || now;
    // Lock in a stable order. Bodies never supply recipient/account IDs or commands.
    const accounts = match.accountIds.length ? await trx('crm_accounts').whereIn('id', match.accountIds).orderBy('id').forUpdate() : [];
    const verified = accounts.filter(a => match.verifiedAccountIds.includes(a.id));
    if (decision.kind === 'UNSUBSCRIBE' && decision.sender) {
      const suppressed = [...new Set([decision.sender, ...verified.flatMap(a => emails([a.email, a.raw_mail, a.cc_emails_json].join(' ')))])]
        .filter(email => !/@s-consulting\.ba$/i.test(email));
      for (const email of suppressed) await suppressAddressInTransaction(trx, email, {
        source: 'INBOUND_EMAIL_REPLY', actor: ACTOR, recordActivity: false,
        notes: 'Odjava odgovorom na mail; izvor ' + id + '; pošiljalac ' + decision.sender + '.'
      });
    }
    for (const account of accounts) {
      const confirmedOptOut = decision.kind === 'UNSUBSCRIBE' && match.verifiedAccountIds.includes(account.id);
      const review = decision.kind === 'REPLY_REVIEW' || (decision.kind === 'UNSUBSCRIBE' && !confirmedOptOut);
      const type = confirmedOptOut ? 'EMAIL_UNSUBSCRIBED' : review ? 'EMAIL_REPLY_REVIEW' : 'EMAIL_REPLY_RECEIVED';
      const label = confirmedOptOut ? 'ODJAVA — zabrana daljnjeg slanja' : review ? 'ODGOVOR — potreban pregled' : 'PRIMLJEN ODGOVOR';
      const note = `${label}\nOd: ${decision.sender}\nPredmet: ${message.subject || ''}\nDatum: ${new Date(occurredAt).toISOString()}\n${decision.text.slice(0, 12000)}`;
      const status = confirmedOptOut ? 'REJECTED' : !account.marketing_opt_out_at && !review && ['NEW', 'CALL_REQUIRED', 'EMAIL_SENT'].includes(account.status) ? 'CONTACTED' : account.status;
      const patch = { status, comment: [account.comment, note].filter(Boolean).join('\n'), updated_at: now, updated_by: ACTOR };
      if (!account.last_contact_at || new Date(account.last_contact_at) < new Date(occurredAt)) patch.last_contact_at = occurredAt;
      if (confirmedOptOut) Object.assign(patch, { marketing_opt_out_at: account.marketing_opt_out_at || now, marketing_opt_out_reason: 'INBOUND_EMAIL_REPLY' });
      await trx('crm_accounts').where({ id: account.id }).update(patch);
      await trx('crm_activities').insert({ id: crypto.randomUUID(), account_id: account.id, brand_id: account.brand_id,
        user_id: ACTOR, activity_type: type, from_status: account.status, to_status: status, notes: note,
        metadata_json: JSON.stringify({ inboundId: id, mailbox, responseMessageId: message.id,
          internetMessageId: message.internetMessageId, sender: decision.sender, receivedAt: occurredAt,
          replyClassification: decision.kind, matchMethod: match.method, bodyText: decision.text }),
        occurred_at: occurredAt, created_at: now });
    }
    return { classification: decision.kind, matched: accounts.length };
  });
}
async function folders(graph) {
  const omit = new Set();
  for (const name of ['sentitems', 'drafts']) {
    const { data } = await graph.request(graph.mailboxPath('/mailFolders/' + name + '?$select=id')); omit.add(data.id);
  }
  const result = [], pending = [graph.mailboxPath('/mailFolders?$top=100&$select=id,displayName,childFolderCount')];
  let pages = 0;
  while (pending.length) {
    if (++pages > 100) throw Object.assign(new Error('Too many mail folders'), { code: 'FOLDER_LIMIT' });
    const { data } = await graph.request(pending.shift());
    for (const f of data.value || []) {
      if (!omit.has(f.id)) result.push(f);
      if (f.childFolderCount && !omit.has(f.id)) pending.push(graph.mailboxPath('/mailFolders/' + encodeURIComponent(f.id) + '/childFolders?$top=100&$select=id,displayName,childFolderCount'));
    }
    if (data['@odata.nextLink']) pending.push(data['@odata.nextLink']);
  }
  return result;
}
async function runInboundTick(db, options = {}) {
  const env = options.env || process.env, now = new Date(), started = Date.now(), maxMs = options.maxMs || 220000;
  const mailboxes = String(env.INBOUND_MAILBOXES || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!mailboxes.length || mailboxes.some(m => !OWN.has(m))) throw Error('Invalid inbound mailbox configuration');
  const since = env.INBOUND_START_AT || '2026-08-01T00:00:00Z';
  if (!Number.isFinite(Date.parse(since))) throw Error('Invalid inbound start date');
  const leaseId = 'inbound-worker', token = crypto.randomUUID();
  await db('crm_mail_sync_state').insert({ id: leaseId, mailbox: 'worker', updated_at: now }).onConflict('id').ignore();
  const locked = await db('crm_mail_sync_state').where({ id: leaseId }).where(q => q.whereNull('lease_until').orWhere('lease_until', '<', now))
    .update({ lease_token: token, lease_until: new Date(Date.now() + 300000), last_attempt_at: now, updated_at: now });
  if (!locked) return { busy: true };
  const report = { at: now.toISOString(), scanned: 0, recorded: 0, duplicates: 0, classifications: {}, mailboxes: [], errors: [] };
  try {
    const context = await loadContext(db);
    for (const mailbox of mailboxes) {
      if (Date.now() - started >= maxMs) break;
      const graph = options.graphFactory ? options.graphFactory(mailbox) : createGraphClient({ config: createOutlookConfig(env, { mailbox, readOnly: true }) });
      try {
        const discovered = await folders(graph);
        const states = await db('crm_mail_sync_state').where({ mailbox });
        // Resume the least recently checked folders first, including custom folders.
        discovered.sort((a, b) => Number(new Date(states.find(s => s.folder_id === a.id)?.last_attempt_at || 0)) - Number(new Date(states.find(s => s.folder_id === b.id)?.last_attempt_at || 0)));
        for (const folder of discovered) {
          if (Date.now() - started >= maxMs) break;
          const stateId = hash(mailbox + '\n' + folder.id);
          await db('crm_mail_sync_state').insert({ id: stateId, mailbox, folder_id: folder.id, updated_at: new Date() }).onConflict('id').ignore();
          let state = await db('crm_mail_sync_state').where({ id: stateId }).first();
          const params = new URLSearchParams({ '$top': '50', '$orderby': 'receivedDateTime desc', '$select': 'id,from,subject,receivedDateTime,internetMessageId,conversationId,isDraft,bodyPreview', '$filter': 'receivedDateTime ge ' + since });
          let url = state.cursor_url || graph.mailboxPath('/mailFolders/' + encodeURIComponent(folder.id) + '/messages/delta?' + params);
          await db('crm_mail_sync_state').where({ id: stateId }).update({ last_attempt_at: new Date() });
          for (let page = 0; page < (options.pagesPerFolder || 2); page++) {
            if (Date.now() - started >= maxMs) break;
            let data;
            try { ({ data } = await graph.request(url)); } catch (e) {
              // A stale delta token is recovered by a bounded backfill; event IDs deduplicate it.
              if (e.upstreamStatus === 410 || e.status === 410) await db('crm_mail_sync_state').where({ id: stateId }).update({ cursor_url: null });
              throw e;
            }
            let complete = true;
            for (const summary of data.value || []) {
              if (Date.now() - started >= maxMs) { complete = false; break; }
              if (summary['@removed']) continue;
              report.scanned++;
              if (await db('crm_inbound_messages').where({ id: identity(summary, mailbox) }).first('id')) { report.duplicates++; continue; }
              const sender = strictEmailAddress(summary.from?.emailAddress?.address);
              let message = summary;
              // Delta updates can omit from/other unchanged properties. Resolve
              // the full message before deciding that it is an incoming reply.
              if (!summary.isDraft && (!sender || !/@s-consulting\.ba$/i.test(sender))) {
                const select = 'id,from,subject,receivedDateTime,body,uniqueBody,internetMessageId,internetMessageHeaders,conversationId,isDraft,hasAttachments';
                try { ({ data: message } = await graph.request(graph.mailboxPath('/messages/' + encodeURIComponent(summary.id) + '?$select=' + select))); }
                catch (e) { if (e.status === 404) continue; throw e; }
              }
              const result = await recordMessage(db, message, mailbox, context);
              if (result.duplicate) report.duplicates++;
              else { report.recorded++; report.classifications[result.classification] = (report.classifications[result.classification] || 0) + 1; }
            }
            if (!complete) break;
            const next = data['@odata.nextLink'] || data['@odata.deltaLink'];
            if (!next) throw Object.assign(new Error('Missing delta cursor'), { code: 'DELTA_CURSOR_MISSING' });
            graph.validateGraphUrl(next);
            await db('crm_mail_sync_state').where({ id: stateId }).update({ cursor_url: next, last_success_at: new Date(), last_error: null, updated_at: new Date() });
            url = next;
            if (!data['@odata.nextLink']) break;
          }
        }
        report.mailboxes.push(mailbox);
      } catch (error) {
        report.errors.push({ mailbox, code: error.code || 'INBOUND_SYNC_ERROR' });
      }
    }
    await db('crm_mail_sync_state').where({ id: leaseId, lease_token: token }).update({ last_success_at: report.errors.length ? null : new Date(), last_error: report.errors.length ? JSON.stringify(report.errors).slice(0, 200) : null, stats_json: JSON.stringify(report), updated_at: new Date() });
    return report;
  } finally {
    await db('crm_mail_sync_state').where({ id: leaseId, lease_token: token }).update({ lease_token: null, lease_until: null, updated_at: new Date() });
  }
}
module.exports = { folders, identity, loadContext, matchMessage, recordMessage, runInboundTick };
