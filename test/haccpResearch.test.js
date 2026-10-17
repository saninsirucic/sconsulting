const test = require('node:test');
const assert = require('node:assert/strict');
const knex = require('knex');
const express = require('express');
const crmMigration = require('../migrations/20260813120000_create_commercial_crm');
const migration = require('../migrations/20261017120000_create_haccp_research');
const { createHaccpResearchRouter } = require('../haccpResearch/router');
const { claimRun, executeRun, getState, listLeads, normalizeLead, recoverExpiredRun, updateLead, updateSettings } = require('../haccpResearch/service');
const { collectSources, publicUrl, researchWeb } = require('../haccpResearch/provider');
const { runResearchTick } = require('../scripts/haccpResearchTick');

const config = { configured: true, apiKey: 'test-only', model: 'test-model' };
const actor = { id: 'director', role: 'direktor' };
const contactUrl = 'https://restaurant.ba/kontakt';
const newsUrl = 'https://portal.ba/novi-restoran';
const sources = [{ url: contactUrl, title: 'Kontakt restorana' }, { url: newsUrl, title: 'Otvaranje' }];
const sourceMap = new Map(sources.map(source => [source.url, source]));
const defaults = { lookback_days: 90, max_results: 20, interval_hours: 24 };
const rawLead = (overrides = {}) => ({
  name: 'Test restoran', category: 'RESTORAN', municipality: 'Centar', address: 'Test ulica 1',
  email: 'info@restaurant.ba', phone: '+387 33 123 456', website: contactUrl,
  opening_status: 'OPENED', opening_date: new Date().toISOString().slice(0, 10), opening_evidence: 'Objekt je otvoren danas.',
  opening_source_url: newsUrl, email_source_url: contactUrl, phone_source_url: contactUrl,
  contact_evidence: 'Kontakt: info@restaurant.ba; +387 33 123 456', source_urls: [newsUrl, contactUrl], ...overrides,
});
const result = (leads = [rawLead()]) => ({ leads, sources, model: 'test-model', notes: 'Test izvori.', usage: { search_calls: 2 } });

async function database(t) {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await crmMigration.up(db);
  await migration.up(db);
  return db;
}
async function runResearch(db, payload = result()) {
  const run = await claimRun(db, { manual: true, actor, config });
  await executeRun(db, run, { provider: async () => payload });
  return run;
}
async function clearCooldown(db) {
  await db('haccp_research_settings').update({ last_started_at: new Date(Date.now() - 7200000) });
}

test('migration is paused, validates settings and does not enable paid research without configuration', async t => {
  const db = await database(t);
  assert.equal((await getState(db, config)).settings.enabled, false);
  assert.equal(await claimRun(db, { config }), null);
  await assert.rejects(updateSettings(db, { enabled: true }, actor, { configured: false }), /API ključ/);
  await assert.rejects(updateSettings(db, { enabled: 'false' }, actor, config), /true ili false/);
  await assert.rejects(updateSettings(db, { interval_hours: 1 }, actor, config), /24 do 168/);
  await assert.rejects(updateSettings(db, { max_results: 1000 }, actor, config), /1 do 25/);
  const updated = await updateSettings(db, { enabled: true }, actor, config);
  assert.equal(updated.settings.enabled, true);
  assert.ok(updated.settings.next_run_at);
  await migration.down(db);
  assert.equal(await db.schema.hasTable('haccp_research_leads'), false);
});

test('only sourced contacts survive; old/out-of-area entries and invented sources are excluded', () => {
  const now = new Date();
  const valid = normalizeLead(rawLead(), sourceMap, defaults, now);
  assert.equal(valid.email, 'info@restaurant.ba');
  assert.equal(valid.phone, '+387 33 123 456');
  assert.equal(valid.opening_status, 'OPENED');
  assert.equal(normalizeLead(rawLead({ municipality: 'Mostar' }), sourceMap, defaults, now), null);
  assert.equal(normalizeLead(rawLead({ opening_date: '2020-01-01' }), sourceMap, defaults, now), null);
  assert.equal(normalizeLead(rawLead({ source_urls: ['https://invented.ba/'] }), sourceMap, defaults, now), null);
  const guessed = normalizeLead(rawLead({ email_source_url: 'https://invented.ba/', phone_source_url: null, website: 'javascript:alert(1)' }), sourceMap, defaults, now);
  assert.equal(guessed.email, null);
  assert.equal(guessed.phone, null);
  assert.equal(guessed.website, null);
  assert.equal(normalizeLead(rawLead({ contact_evidence: 'Kontakt nije objavljen.' }), sourceMap, defaults, now).email, null);
  assert.equal(normalizeLead(rawLead({ opening_date: null }), sourceMap, defaults, now).opening_status, 'UNCONFIRMED');
  assert.equal(normalizeLead(rawLead({ opening_date: '2026-02-30' }), sourceMap, defaults, now).opening_status, 'UNCONFIRMED');
  assert.equal(publicUrl('http://127.0.0.1/secret'), null);
  assert.equal(publicUrl('https://user:pass@site.ba/'), null);
});

test('recurring runs merge duplicates, preserve human notes/status and respect do-not-contact', async t => {
  const db = await database(t);
  await runResearch(db, result([rawLead(), rawLead({ name: 'Test restoran pod drugim nazivom' })]));
  let leads = await listLeads(db);
  assert.equal(leads.total, 1);
  const id = leads.items[0].id;
  await updateLead(db, id, { status: 'CONTACTED', notes: 'Javljen vlasniku, sačekati odgovor.' });
  await clearCooldown(db);
  await runResearch(db, result([rawLead({ email: null, email_source_url: null, opening_status: 'UNCONFIRMED' })]));
  leads = await listLeads(db, { status: 'CONTACTED', has_email: 'true' });
  assert.equal(leads.total, 1);
  assert.equal(leads.items[0].email, 'info@restaurant.ba');
  assert.equal(leads.items[0].opening_status, 'OPENED');
  assert.equal(leads.items[0].notes, 'Javljen vlasniku, sačekati odgovor.');
  assert.ok(leads.items[0].contacted_at);
  await updateLead(db, id, { status: 'DO_NOT_CONTACT' });
  await clearCooldown(db);
  await runResearch(db);
  assert.equal((await listLeads(db)).items[0].status, 'DO_NOT_CONTACT');
  assert.equal((await getState(db, config)).runs[0].skipped_count, 1);
  assert.equal(Number((await db('crm_accounts').where({ brand_id: 'brand-fs-app' }).count({ total: '*' }).first()).total), 0);
});

test('existing CRM contacts are marked without adding accounts or mail queue entries', async t => {
  const db = await database(t);
  await db('crm_accounts').insert({ id: 'existing-account', source_key: 'research-test', source_data_json: '{}', brand_id: 'brand-fs-app', company_name: 'Test restoran', email: 'INFO@RESTAURANT.BA', created_at: new Date(), updated_at: new Date() });
  await runResearch(db);
  assert.equal((await listLeads(db)).items[0].crm_account_id, 'existing-account');
  assert.equal((await db('crm_accounts').where({ brand_id: 'brand-fs-app' })).length, 1);
});

test('atomic claim prevents duplicate paid runs; restart recovery preserves next schedule', async t => {
  const db = await database(t);
  await updateSettings(db, { enabled: true }, actor, config);
  const claims = await Promise.all([claimRun(db, { config }), claimRun(db, { config })]);
  assert.equal(claims.filter(Boolean).length, 1);
  const run = claims.find(Boolean);
  await assert.rejects(claimRun(db, { manual: true, actor, config }), /već u toku/);
  const next = (await getState(db, config)).settings.next_run_at;
  await db('haccp_research_settings').update({ lease_until: new Date(Date.now() - 1000) });
  await recoverExpiredRun(db);
  assert.equal((await getState(db, config)).runs[0].status, 'INTERRUPTED');
  assert.equal((await getState(db, config)).settings.next_run_at, next);
  const stale = await executeRun(db, run, { provider: async () => result() });
  assert.equal(stale.interrupted, true);
  assert.equal((await listLeads(db)).total, 0);
  assert.equal(await claimRun(db, { config }), null);
});

test('provider failures are visible and sanitized, release the lease and do not retry in a loop', async t => {
  const db = await database(t);
  const run = await claimRun(db, { manual: true, actor, config });
  const done = await executeRun(db, run, { provider: async () => { throw Object.assign(new Error('secret-provider-key'), { status: 429 }); } });
  assert.equal(done.failed, true);
  const state = await getState(db, config);
  assert.equal(state.running, false);
  assert.equal(state.runs[0].status, 'FAILED');
  assert.match(state.runs[0].error, /limit/);
  assert.doesNotMatch(JSON.stringify(state), /secret-provider-key/);
  await assert.rejects(claimRun(db, { manual: true, actor, config }), /sat nakon/);
});

test('scheduler CLI researches only when enabled and due, including without a web request', async t => {
  const db = await database(t);
  let calls = 0;
  const options = { config, provider: async () => { calls++; return result(); } };
  assert.deepEqual(await runResearchTick(db, options), { skipped: true });
  await updateSettings(db, { enabled: true }, actor, config);
  assert.equal((await runResearchTick(db, options)).new_count, 1);
  assert.equal(calls, 1);
  const scheduled = (await getState(db, config)).settings;
  assert.equal(scheduled.interval_hours, 72);
  assert.equal(new Date(scheduled.next_run_at) - new Date(scheduled.last_started_at), 72 * 3600000);
  assert.equal(await claimRun(db, { config, now: new Date(new Date(scheduled.last_started_at).getTime() + 71 * 3600000) }), null);
  assert.deepEqual(await runResearchTick(db, options), { skipped: true });
  assert.equal(calls, 1);
  await updateSettings(db, { enabled: false }, actor, config);
  assert.deepEqual(await runResearchTick(db, options), { skipped: true });
});

test('provider forces bounded live web search and extracts only with explicit source context', async () => {
  const calls = [];
  const client = { responses: {
    create: async request => { calls.push(request); return { id: 'search-id', status: 'completed', output_text: 'Test restoran; javni kontakt.', output: [
      { type: 'web_search_call', status: 'completed', action: { type: 'search', sources } },
    ] }; },
    parse: async request => { calls.push(request); return { id: 'extract-id', status: 'completed', output_parsed: { leads: [rawLead()], notes: 'Test.' } }; },
  } };
  const found = await researchWeb({ settings: defaults, client, config });
  assert.equal(found.leads.length, 1);
  assert.equal(calls[0].tool_choice, 'required');
  const searches = calls.filter(c => c.tools);
  assert.equal(searches.length, 3);
  assert.equal(searches.reduce((n, c) => n + c.max_tool_calls, 0), 8);
  assert.deepEqual(searches[1].tools[0].filters.allowed_domains, ['facebook.com', 'instagram.com', 'tiktok.com', 'youtube.com', 'linkedin.com', 'x.com', 'twitter.com']);
  assert.match(searches[2].instructions, /Google Maps/);
  assert.match(JSON.parse(searches[2].input).discovery_notes[0].notes, /Test restoran/);
  assert.equal(calls[0].tools[0].external_web_access, true);
  assert.equal(calls[0].store, false);
  assert.equal(calls[3].store, false);
  assert.match(calls[3].input, /supplied_sources/);
  assert.equal(calls[3].text.format.type, 'json_schema');
  assert.equal(found.sources.length, 2);
  assert.equal(found.usage.coverage.length, 3);
  assert.equal(found.usage.search_calls, 3);
  assert.ok(found.usage.coverage.every(c => c.status === 'COMPLETED'));
  client.responses.create = async () => ({ status: 'completed', output_text: 'Unsourced memory.', output: [] });
  await assert.rejects(researchWeb({ settings: defaults, client, config }), /nije završena/);
  assert.deepEqual(collectSources({ output: [{ type: 'message', content: [{ annotations: [{ type: 'url_citation', url: contactUrl, title: 'Kontakt' }] }] }] }), [{ url: contactUrl, title: 'Kontakt' }]);
});

test('unavailable social search is reported while usable web evidence survives', async () => {
  const client = { responses: {
    create: async request => {
      if (request.tools[0].filters) throw Object.assign(new Error('secret-provider-key'), { status: 403 });
      return { id: 'web-id', status: 'completed', output_text: 'Test restoran; javni kontakt.', output: [
        { type: 'web_search_call', status: 'completed', action: { type: 'search', sources } },
      ] };
    },
    parse: async request => {
      assert.equal(JSON.parse(request.input).coverage.find(c => c.id === 'social').status, 'UNAVAILABLE');
      return { id: 'extract-id', status: 'completed', output_parsed: { leads: [rawLead()], notes: 'Ograničeni javni izvori.' } };
    },
  } };
  const found = await researchWeb({ settings: defaults, client, config });
  assert.equal(found.leads.length, 1);
  assert.match(found.notes, /Nepotpuna provjera.*Društvene mreže/);
  assert.equal(found.usage.coverage.find(c => c.id === 'social').source_count, 0);
  assert.doesNotMatch(JSON.stringify(found), /secret-provider-key/);
});

test('HTTP routes enforce role and FS_APP access, and return 202 before research completes', async t => {
  const db = await database(t);
  let finish;
  const providerWait = new Promise(resolve => { finish = resolve; });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { id: req.headers['x-test-user'] || 'director', role: req.headers['x-test-role'] || 'direktor' }; next(); });
  app.use('/research', createHaccpResearchRouter({ db, config, provider: () => providerWait }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/research`;
  const denied = await fetch(`${base}/state`, { headers: { 'x-test-role': 'komercijala', 'x-test-user': 'unassigned' } });
  assert.equal(denied.status, 403);
  await db('app_users').insert({ id: 'seller', username: 'seller', username_normalized: 'seller', password_hash: 'test', role: 'komercijala', created_at: new Date(), updated_at: new Date() });
  await db('app_user_brand_access').insert({ id: 'access', user_id: 'seller', brand_id: 'brand-fs-app', can_read: true, can_write: true, created_at: new Date(), updated_at: new Date() });
  const sellerHeaders = { 'x-test-user': 'seller', 'x-test-role': 'komercijala' };
  assert.equal((await fetch(`${base}/state`, { headers: sellerHeaders })).status, 200);
  assert.equal((await fetch(`${base}/runs`, { method: 'POST', headers: sellerHeaders })).status, 403);
  assert.equal((await fetch(`${base}/settings`, { method: 'PUT', headers: sellerHeaders })).status, 403);
  const started = await fetch(`${base}/runs`, { method: 'POST' });
  assert.equal(started.status, 202);
  assert.equal((await started.json()).status, 'RUNNING');
  assert.equal((await getState(db, config)).runs[0].status, 'RUNNING');
  finish(result());
  for (let i = 0; i < 60; i++) {
    if ((await getState(db, config)).runs[0].status !== 'RUNNING') break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal((await getState(db, config)).runs[0].status, 'COMPLETED');
});
