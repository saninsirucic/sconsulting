const { createHash, randomUUID } = require('node:crypto');
const { httpError } = require('../commercial/service');
const { CATEGORIES, MUNICIPALITIES, SOURCE_PLAN, configuration, publicUrl, researchWeb } = require('./provider');

const SETTINGS_ID = 'sarajevo-food';
const STATUSES = ['NEW', 'READY', 'CONTACTED', 'INTERESTED', 'REJECTED', 'DO_NOT_CONTACT'];
const HOUR = 3600000;
const normalize = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const iso = (value) => value === null || value === undefined ? null : new Date(value).toISOString();
const clipped = (value, max) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

function serializeLead(row) {
  return { ...row, sources: JSON.parse(row.sources_json), sources_json: undefined,
    first_seen_at: iso(row.first_seen_at), last_seen_at: iso(row.last_seen_at),
    updated_at: iso(row.updated_at), contacted_at: iso(row.contacted_at) };
}

async function getSettings(db) {
  const settings = await db('haccp_research_settings').where({ id: SETTINGS_ID }).first();
  if (!settings) throw httpError(503, 'Istraživanje još nije pripremljeno na serveru.', 'MIGRATION_REQUIRED');
  return settings;
}

async function getState(db, config = configuration()) {
  const settings = await getSettings(db);
  const runs = await db('haccp_research_runs').orderBy('started_at', 'desc').limit(10);
  const totals = await db('haccp_research_leads').select('status').count({ count: '*' }).groupBy('status');
  return {
    source_plan: SOURCE_PLAN.map(({ id, label, channels }) => ({ id, label, channels })),
    settings: { enabled: Boolean(settings.enabled), interval_hours: settings.interval_hours,
      lookback_days: settings.lookback_days, max_results: settings.max_results,
      next_run_at: iso(settings.next_run_at), last_started_at: iso(settings.last_started_at) },
    provider: { configured: config.configured, model: config.model || null,
      message: config.configured ? null : 'Za web pretragu potrebno je na serveru postaviti OPENAI_API_KEY i HACCP_RESEARCH_MODEL.' },
    running: Boolean(settings.lease_id && new Date(settings.lease_until).getTime() > Date.now()),
    counts: Object.fromEntries(totals.map(row => [row.status, Number(row.count)])),
    runs: runs.map(row => ({ ...row, started_at: iso(row.started_at), finished_at: iso(row.finished_at),
      usage: row.usage_json ? JSON.parse(row.usage_json) : null, usage_json: undefined })),
  };
}

async function updateSettings(db, body, actor, config = configuration(), now = new Date()) {
  const previous = await getSettings(db);
  if (Object.prototype.hasOwnProperty.call(body, 'enabled') && typeof body.enabled !== 'boolean') throw httpError(400, 'enabled mora biti true ili false.');
  const enabled = body.enabled ?? Boolean(previous.enabled);
  if (enabled && !config.configured) throw httpError(409, 'Prvo postavite API ključ i model za web pretragu na serveru.');
  const values = {};
  for (const [key, min, max] of [['interval_hours', 24, 168], ['lookback_days', 7, 180], ['max_results', 1, 25]]) {
    const value = body[key] ?? previous[key];
    if (!Number.isInteger(value) || value < min || value > max) throw httpError(400, `${key} mora biti cijeli broj od ${min} do ${max}.`);
    values[key] = value;
  }
  // Changing cadence does not trigger an extra paid run. Enabling an idle agent starts one soon.
  const nextRun = !enabled ? null : !previous.enabled ? now
    : values.interval_hours !== previous.interval_hours
      ? new Date(Math.max(now.getTime(), new Date(previous.last_started_at || now).getTime() + values.interval_hours * HOUR))
      : previous.next_run_at || now;
  await db('haccp_research_settings').where({ id: SETTINGS_ID }).update({
    ...values, enabled, next_run_at: nextRun, updated_by: actor.id, updated_at: now,
  });
  return getState(db, config);
}

async function listLeads(db, query = {}) {
  const page = Math.max(1, Math.min(100000, parseInt(query.page, 10) || 1));
  const pageSize = 20;
  let builder = db('haccp_research_leads');
  if (query.status) {
    if (!STATUSES.includes(query.status)) throw httpError(400, 'Nepoznat status.');
    builder = builder.where({ status: query.status });
  }
  if (query.opening_status) {
    if (!['OPENED', 'ANNOUNCED', 'UNCONFIRMED'].includes(query.opening_status)) throw httpError(400, 'Nepoznata potvrda otvaranja.');
    builder = builder.where({ opening_status: query.opening_status });
  }
  if (query.has_email === 'true') builder = builder.whereNotNull('email');
  if (query.search) {
    const term = `%${String(query.search).trim().toLowerCase().slice(0, 150)}%`;
    builder = builder.where(function search() {
      this.whereRaw('LOWER(name) LIKE ?', [term]).orWhereRaw('LOWER(municipality) LIKE ?', [term]).orWhereRaw('LOWER(email) LIKE ?', [term]);
    });
  }
  const count = await builder.clone().count({ total: '*' }).first();
  const items = await builder.orderBy('first_seen_at', 'desc').orderBy('name').limit(pageSize).offset((page - 1) * pageSize);
  return { items: items.map(serializeLead), total: Number(count.total), page, pages: Math.max(1, Math.ceil(Number(count.total) / pageSize)) };
}

async function updateLead(db, id, body, now = new Date()) {
  const previous = await db('haccp_research_leads').where({ id }).first();
  if (!previous) throw httpError(404, 'Objekt nije pronađen.');
  const changes = { updated_at: now };
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) throw httpError(400, 'Nepoznat status.');
    changes.status = body.status;
    if (body.status === 'CONTACTED' && !previous.contacted_at) changes.contacted_at = now;
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== 'string' || body.notes.length > 5000) throw httpError(400, 'Napomena može sadržavati najviše 5000 znakova.');
    changes.notes = body.notes.trim();
  }
  await db('haccp_research_leads').where({ id }).update(changes);
  return serializeLead(await db('haccp_research_leads').where({ id }).first());
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

function normalizeLead(raw, sourceMap, settings, now) {
  const name = clipped(raw.name, 250);
  if (!name || !CATEGORIES.includes(raw.category) || !MUNICIPALITIES.includes(raw.municipality)) return null;
  const source = (url) => { const normalized = publicUrl(url); return sourceMap.has(normalized) ? normalized : null; };
  const sources = [...new Set((raw.source_urls || []).map(source).filter(Boolean))].map(url => sourceMap.get(url));
  if (!sources.length) return null;
  const evidence = clipped(raw.contact_evidence, 2000);
  const emailSource = source(raw.email_source_url);
  const emailValue = String(raw.email || '').trim().toLowerCase();
  const email = emailValue.length <= 320 && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(emailValue)
    && emailSource && evidence?.toLowerCase().includes(emailValue) ? emailValue : null;
  const phoneSource = source(raw.phone_source_url);
  const phoneValue = clipped(raw.phone, 100);
  const phoneDigits = (phoneValue || '').replace(/\D/g, '');
  const phone = phoneSource && phoneDigits.length >= 6 && phoneDigits.length <= 18
    && (evidence || '').replace(/\D/g, '').includes(phoneDigits) ? phoneValue : null;
  const openingSource = source(raw.opening_source_url);
  const openingEvidence = clipped(raw.opening_evidence, 2000);
  let openingDate = validDate(raw.opening_date);
  let openingStatus = ['OPENED', 'ANNOUNCED'].includes(raw.opening_status) && openingSource && openingEvidence ? raw.opening_status : 'UNCONFIRMED';
  const today = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - settings.lookback_days * 86400000).toISOString().slice(0, 10);
  if (openingDate && openingDate < since) return null;
  if (openingDate && openingDate > today && openingStatus === 'OPENED') openingStatus = 'ANNOUNCED';
  if (!openingDate && openingStatus === 'OPENED') openingStatus = 'UNCONFIRMED';
  if (openingStatus === 'UNCONFIRMED') openingDate = null;
  for (const url of [emailSource, phoneSource, openingSource]) {
    if (url && !sources.some(item => item.url === url)) sources.push(sourceMap.get(url));
  }
  return { name, category: raw.category, municipality: raw.municipality,
    identity_key: createHash('sha256').update(`${normalize(name)}|${normalize(raw.municipality)}`).digest('hex'),
    address: clipped(raw.address, 400), email, phone, website: source(raw.website),
    opening_status: openingStatus, opening_date: openingDate, opening_evidence: openingEvidence,
    opening_source_url: openingSource, contact_evidence: evidence,
    email_source_url: email ? emailSource : null, phone_source_url: phone ? phoneSource : null,
    sources_json: JSON.stringify(sources),
  };
}

async function recoverExpiredRun(db, now = new Date()) {
  await db.transaction(async trx => {
    const old = await trx('haccp_research_settings').where({ id: SETTINGS_ID }).whereNotNull('lease_id').where('lease_until', '<=', now).first();
    if (!old) return;
    const released = await trx('haccp_research_settings').where({ id: SETTINGS_ID, lease_id: old.lease_id }).update({ lease_id: null, lease_until: null });
    if (released) await trx('haccp_research_runs').where({ id: old.lease_id, status: 'RUNNING' }).update({
      status: 'INTERRUPTED', finished_at: now, error: 'Pretraga je prekinuta restartom ili istekom vremena. Sljedeća provjera ostaje po rasporedu.',
    });
  });
}

async function claimRun(db, { manual = false, actor, config = configuration(), now = new Date() } = {}) {
  if (!config.configured) {
    if (manual) throw httpError(409, 'Na serveru nedostaje API ključ ili odabrani model za web pretragu.');
    return null;
  }
  await recoverExpiredRun(db, now);
  return db.transaction(async trx => {
    const settings = await getSettings(trx);
    if (settings.lease_id) {
      if (manual) throw httpError(409, 'Pretraga je već u toku.');
      return null;
    }
    if (!manual && (!settings.enabled || !settings.next_run_at || new Date(settings.next_run_at) > now)) return null;
    if (settings.last_started_at && now.getTime() - new Date(settings.last_started_at).getTime() < HOUR) {
      if (manual) throw httpError(429, 'Nova ručna pretraga dostupna je sat nakon prethodne.');
      return null;
    }
    const id = randomUUID();
    let claim = trx('haccp_research_settings').where({ id: SETTINGS_ID }).whereNull('lease_id')
      .where(function cooldown() { this.whereNull('last_started_at').orWhere('last_started_at', '<=', new Date(now.getTime() - HOUR)); });
    if (!manual) claim = claim.where({ enabled: true }).where('next_run_at', '<=', now);
    const changed = await claim.update({ lease_id: id, lease_until: new Date(now.getTime() + 10 * 60000),
      last_started_at: now, next_run_at: settings.enabled ? new Date(now.getTime() + settings.interval_hours * HOUR) : null });
    if (!changed) {
      if (manual) throw httpError(409, 'Druga pretraga je upravo pokrenuta.');
      return null;
    }
    await trx('haccp_research_runs').insert({ id, status: 'RUNNING', trigger: manual ? 'MANUAL' : 'SCHEDULED',
      created_by: actor?.id || null, started_at: now, model: config.model });
    return { id, settings, started_at: now, config };
  });
}

function providerErrorMessage(error) {
  if (error.status === 401 || error.status === 403) return 'Servis pretrage je odbio pristup. Provjerite API ključ i pristup modelu.';
  if (error.status === 429) return 'Dosegnut je limit ili nema dostupnog API kredita. Provjerite API račun.';
  if (error.status === 400 || error.status === 404) return 'Odabrani model ili konfiguracija ne podržava ovaj zahtjev. Potreban je Responses model s web pretragom i strukturiranim izlazom.';
  if (['INCOMPLETE_SEARCH', 'INCOMPLETE_EXTRACTION', 'NOT_CONFIGURED'].includes(error.code)) return error.message;
  return 'Pretraga nije uspjela ili je isteklo vrijeme. Prethodni kontakti su sačuvani; pokušajte kasnije.';
}

async function executeRun(db, run, { provider = researchWeb } = {}) {
  try {
    const known = await db('haccp_research_leads').select('name').orderBy('last_seen_at', 'desc').limit(300);
    const result = await provider({ settings: run.settings, now: run.started_at, config: run.config, knownNames: known.map(row => row.name) });
    const sourceMap = new Map((result.sources || []).map(s => [publicUrl(s.url), { url: publicUrl(s.url), title: clipped(s.title, 400) || s.url }]).filter(([url]) => url));
    const now = new Date();
    return await db.transaction(async trx => {
      // An expired/replaced worker cannot publish after another worker acquired the lease.
      const owned = await trx('haccp_research_settings').where({ id: SETTINGS_ID, lease_id: run.id }).where('lease_until', '>', now)
        .update({ lease_until: new Date(now.getTime() + 60000) });
      if (!owned) return { interrupted: true };
      const existing = await trx('haccp_research_leads').select('*');
      const crm = await trx('crm_accounts').where({ brand_id: 'brand-fs-app' }).select('id', 'company_name', 'email');
      const counts = { new_count: 0, updated_count: 0, skipped_count: 0 };
      for (const raw of (result.leads || []).slice(0, run.settings.max_results)) {
        const lead = normalizeLead(raw, sourceMap, run.settings, run.started_at);
        if (!lead) { counts.skipped_count++; continue; }
        const old = existing.find(row => row.identity_key === lead.identity_key
          || (lead.email && row.email === lead.email)
          || (normalize(row.name) === normalize(lead.name) && (row.municipality === 'Sarajevo' || lead.municipality === 'Sarajevo')));
        if (old) {
          if (['DO_NOT_CONTACT', 'REJECTED'].includes(old.status)) { counts.skipped_count++; continue; }
          const patch = { last_seen_at: now, last_run_id: run.id };
          for (const key of ['address', 'email', 'email_source_url', 'phone', 'phone_source_url', 'website', 'contact_evidence']) if (lead[key]) patch[key] = lead[key];
          if (lead.opening_status !== 'UNCONFIRMED') for (const key of ['opening_status', 'opening_date', 'opening_evidence', 'opening_source_url']) patch[key] = lead[key];
          const sources = new Map([...JSON.parse(old.sources_json), ...JSON.parse(lead.sources_json)].map(s => [s.url, s]));
          patch.sources_json = JSON.stringify([...sources.values()].slice(-40));
          await trx('haccp_research_leads').where({ id: old.id }).update(patch);
          Object.assign(old, patch);
          counts.updated_count++;
        } else {
          const matched = crm.find(row => (lead.email && String(row.email || '').toLowerCase() === lead.email) || normalize(row.company_name) === normalize(lead.name));
          const row = { ...lead, id: randomUUID(), status: 'NEW', crm_account_id: matched?.id || null,
            first_seen_at: now, last_seen_at: now, updated_at: now, last_run_id: run.id };
          await trx('haccp_research_leads').insert(row);
          existing.push(row);
          counts.new_count++;
        }
      }
      await trx('haccp_research_runs').where({ id: run.id }).update({ status: 'COMPLETED', finished_at: now,
        ...counts, notes: clipped(result.notes, 4000), usage_json: JSON.stringify(result.usage || {}), model: result.model || run.config.model });
      await trx('haccp_research_settings').where({ id: SETTINGS_ID, lease_id: run.id }).update({ lease_id: null, lease_until: null });
      return counts;
    });
  } catch (error) {
    await db.transaction(async trx => {
      const owned = await trx('haccp_research_settings').where({ id: SETTINGS_ID, lease_id: run.id }).update({ lease_id: null, lease_until: null });
      if (owned) await trx('haccp_research_runs').where({ id: run.id, status: 'RUNNING' }).update({ status: 'FAILED', finished_at: new Date(), error: providerErrorMessage(error) });
    });
    return { failed: true };
  }
}

function startScheduler(db, { intervalMs = 60000, provider, config } = {}) {
  let busy = false;
  let warned = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await recoverExpiredRun(db);
      const run = await claimRun(db, { config: config || configuration() });
      if (run) await executeRun(db, run, { provider });
      warned = false;
    } catch {
      if (!warned) console.error('HACCP istraživanje: provjerite bazu i migracije; raspored trenutno nije dostupan.');
      warned = true;
    } finally { busy = false; }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}

module.exports = { STATUSES, SETTINGS_ID, claimRun, executeRun, getState, listLeads, normalizeLead,
  recoverExpiredRun, startScheduler, updateLead, updateSettings };
