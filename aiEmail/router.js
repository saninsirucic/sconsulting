const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { allowRoles, authenticateRequest } = require('./auth');
const { FIELD_DEFINITIONS, isValidEmail, normalizeCompanyName, normalizeEmail } = require('./contactUtils');
const { analyzeExcel } = require('./excelService');
const { importContacts } = require('./importService');

const CONTACT_SORT_FIELDS = new Set([
  'company_name', 'email', 'country', 'city', 'priority', 'status', 'created_at', 'updated_at'
]);

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function boolFromQuery(value) {
  if (value === undefined) return undefined;
  return ['1', 'true', 'yes'].includes(String(value).toLowerCase());
}

function parsePositiveInt(value, fallback, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function normalizeContactInput(body, existing = {}) {
  const companyName = String(body.company_name ?? existing.company_name ?? '').trim();
  const email = normalizeEmail(body.email ?? existing.email);
  if (!companyName) throw Object.assign(new Error('Naziv firme je obavezan.'), { status: 400 });
  if (!isValidEmail(email)) throw Object.assign(new Error('Ispravna e-mail adresa je obavezna.'), { status: 400 });

  const optional = (key) => {
    if (!(key in body)) return existing[key] ?? null;
    const value = body[key];
    return value === null || value === undefined || String(value).trim() === '' ? null : String(value).trim();
  };

  return {
    company_name: companyName,
    company_name_normalized: normalizeCompanyName(companyName),
    contact_person: optional('contact_person'),
    email,
    email_normalized: email,
    additional_email: optional('additional_email'),
    phone: optional('phone'),
    website: optional('website'),
    country: optional('country'),
    city: optional('city'),
    postal_code: optional('postal_code'),
    address: optional('address'),
    industry: optional('industry'),
    source: optional('source'),
    priority: optional('priority'),
    status: optional('status'),
    notes: optional('notes'),
    previous_communication: optional('previous_communication'),
    last_contact_at: body.last_contact_at ?? existing.last_contact_at ?? null,
    next_contact_at: body.next_contact_at ?? existing.next_contact_at ?? null,
    sending_allowed: body.sending_allowed === undefined
      ? (existing.sending_allowed ?? true)
      : Boolean(body.sending_allowed),
    suppression_reason: optional('suppression_reason')
  };
}

async function audit(db, user, action, entityType, entityId, metadata = {}) {
  await db('email_activity_logs').insert({
    id: uuidv4(),
    actor_id: user.id,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata_json: JSON.stringify(metadata),
    created_at: new Date()
  });
}

async function scalarCount(query) {
  const row = await query.count({ count: '*' }).first();
  return Number(row ? row.count : 0);
}

function createAiEmailRouter({ db }) {
  const router = express.Router();
  const maxUploadBytes = parsePositiveInt(process.env.AI_EMAIL_MAX_UPLOAD_MB, 10, 25) * 1024 * 1024;
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadBytes, files: 1 },
    fileFilter: (req, file, callback) => {
      if (/\.xlsx$/i.test(file.originalname || '')) return callback(null, true);
      return callback(Object.assign(new Error('Dozvoljeni su samo sigurnije podržani .xlsx fajlovi.'), { status: 400 }));
    }
  });

  router.use(authenticateRequest, allowRoles('direktor', 'komercijala'));

  router.get('/metadata', (req, res) => {
    res.json({
      fields: FIELD_DEFINITIONS,
      defaults: {
        dailyLimit: Number(process.env.AI_EMAIL_DAILY_LIMIT || 20),
        minIntervalMinutes: Number(process.env.AI_EMAIL_MIN_INTERVAL_MINUTES || 5),
        timezone: process.env.AI_EMAIL_TIMEZONE || 'Europe/Sarajevo'
      },
      mail: {
        provider: process.env.MAIL_PROVIDER || 'microsoft_graph',
        senderAddress: process.env.MAIL_SENDER_ADDRESS || 'sales@s-consulting.ba',
        testMode: process.env.MAIL_TEST_MODE !== 'false',
        microsoftConfigured: Boolean(
          process.env.MICROSOFT_TENANT_ID
          && process.env.MICROSOFT_CLIENT_ID
          && process.env.MICROSOFT_CLIENT_SECRET
        ),
        openAiConfigured: Boolean(process.env.OPENAI_API_KEY)
      }
    });
  });

  router.get('/dashboard', asyncRoute(async (req, res) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const [
      totalContacts, activeCampaigns, drafts, pendingApproval, sentToday,
      totalSent, failed, replies, interested, pendingFollowups, suppressionRequests
    ] = await Promise.all([
      scalarCount(db('email_contacts').whereNull('archived_at')),
      scalarCount(db('email_campaigns').whereIn('status', ['ACTIVE', 'SCHEDULED', 'PAUSED'])),
      scalarCount(db('email_messages').where('status', 'DRAFT')),
      scalarCount(db('email_messages').where('status', 'PENDING_APPROVAL')),
      scalarCount(db('email_messages').where('status', 'SENT').andWhere('sent_at', '>=', today)),
      scalarCount(db('email_messages').where('status', 'SENT')),
      scalarCount(db('email_messages').where('status', 'FAILED')),
      scalarCount(db('email_replies')),
      scalarCount(db('email_replies').whereIn('classification', ['INTERESTED', 'REQUESTS_PRESENTATION', 'REQUESTS_PRICE'])),
      scalarCount(db('email_followups').where('status', 'SCHEDULED')),
      scalarCount(db('email_suppression_list'))
    ]);

    res.json({
      totalContacts,
      activeCampaigns,
      drafts,
      pendingApproval,
      sentToday,
      totalSent,
      failed,
      replies,
      interested,
      pendingFollowups,
      suppressionRequests,
      series: { sentByDay: [], repliesByDay: [] }
    });
  }));

  router.get('/contacts', asyncRoute(async (req, res) => {
    const page = parsePositiveInt(req.query.page, 1, 100000);
    const perPage = parsePositiveInt(req.query.perPage, 25, 100);
    const sortBy = CONTACT_SORT_FIELDS.has(req.query.sortBy) ? req.query.sortBy : 'company_name';
    const sortDirection = String(req.query.sortDirection).toLowerCase() === 'desc' ? 'desc' : 'asc';
    const base = db('email_contacts');

    if (!boolFromQuery(req.query.archived)) base.whereNull('archived_at');
    if (req.query.country) base.where('country', req.query.country);
    if (req.query.priority) base.where('priority', req.query.priority);
    if (req.query.status) base.where('status', req.query.status);
    if (req.query.sendingAllowed !== undefined) base.where('sending_allowed', boolFromQuery(req.query.sendingAllowed));
    if (req.query.search) {
      const search = `%${String(req.query.search).trim().toLowerCase()}%`;
      base.where((query) => query
        .whereRaw('LOWER(company_name) LIKE ?', [search])
        .orWhereRaw('LOWER(COALESCE(email, ?)) LIKE ?', ['', search])
        .orWhereRaw('LOWER(COALESCE(contact_person, ?)) LIKE ?', ['', search]));
    }

    const total = await scalarCount(base.clone());
    const items = await base.clone()
      .select('*')
      .orderBy(sortBy, sortDirection)
      .limit(perPage)
      .offset((page - 1) * perPage);
    const facets = await db('email_contacts').whereNull('archived_at')
      .select('country', 'priority', 'status');

    res.json({
      items,
      pagination: { page, perPage, total, pages: Math.ceil(total / perPage) },
      filters: {
        countries: [...new Set(facets.map((item) => item.country).filter(Boolean))].sort(),
        priorities: [...new Set(facets.map((item) => item.priority).filter(Boolean))].sort(),
        statuses: [...new Set(facets.map((item) => item.status).filter(Boolean))].sort()
      }
    });
  }));

  router.post('/contacts', asyncRoute(async (req, res) => {
    const contact = normalizeContactInput(req.body);
    const duplicate = await db('email_contacts').where({ email_normalized: contact.email_normalized }).first();
    if (duplicate) return res.status(409).json({ error: 'Kontakt sa ovom e-mail adresom već postoji.' });
    const suppressed = await db('email_suppression_list').where({ email_normalized: contact.email_normalized }).first();
    const id = uuidv4();
    const now = new Date();
    await db('email_contacts').insert({
      id,
      ...contact,
      sending_allowed: suppressed ? false : contact.sending_allowed,
      suppression_reason: suppressed ? suppressed.reason : contact.suppression_reason,
      created_at: now,
      updated_at: now
    });
    await audit(db, req.user, 'CONTACT_CREATED', 'email_contact', id);
    res.status(201).json(await db('email_contacts').where({ id }).first());
  }));

  router.put('/contacts/:id', asyncRoute(async (req, res) => {
    const existing = await db('email_contacts').where({ id: req.params.id }).first();
    if (!existing) return res.status(404).json({ error: 'Kontakt nije pronađen.' });
    const contact = normalizeContactInput(req.body, existing);
    const duplicate = await db('email_contacts')
      .where({ email_normalized: contact.email_normalized })
      .whereNot({ id: existing.id })
      .first();
    if (duplicate) return res.status(409).json({ error: 'Kontakt sa ovom e-mail adresom već postoji.' });
    await db('email_contacts').where({ id: existing.id }).update({ ...contact, updated_at: new Date() });
    await audit(db, req.user, 'CONTACT_UPDATED', 'email_contact', existing.id);
    res.json(await db('email_contacts').where({ id: existing.id }).first());
  }));

  router.post('/contacts/:id/archive', asyncRoute(async (req, res) => {
    const updated = await db('email_contacts').where({ id: req.params.id }).update({
      archived_at: new Date(),
      updated_at: new Date()
    });
    if (!updated) return res.status(404).json({ error: 'Kontakt nije pronađen.' });
    await audit(db, req.user, 'CONTACT_ARCHIVED', 'email_contact', req.params.id);
    res.json({ success: true });
  }));

  router.post('/contacts/:id/suppress', asyncRoute(async (req, res) => {
    const contact = await db('email_contacts').where({ id: req.params.id }).first();
    if (!contact) return res.status(404).json({ error: 'Kontakt nije pronađen.' });
    const reason = String(req.body.reason || 'Ručno zaustavljena komunikacija').trim();
    const now = new Date();
    await db.transaction(async (trx) => {
      const existing = await trx('email_suppression_list').where({ email_normalized: contact.email_normalized }).first();
      if (!existing) {
        await trx('email_suppression_list').insert({
          id: uuidv4(), email: contact.email, email_normalized: contact.email_normalized,
          reason, source: 'MANUAL', notes: req.body.notes || null, created_by: req.user.id, created_at: now
        });
      }
      await trx('email_contacts').where({ id: contact.id }).update({
        sending_allowed: false, suppression_reason: reason, updated_at: now
      });
      await trx('email_followups').where({ contact_id: contact.id, status: 'SCHEDULED' }).update({
        status: 'CANCELLED', cancel_reason: 'SUPPRESSED', updated_at: now
      });
    });
    await audit(db, req.user, 'CONTACT_SUPPRESSED', 'email_contact', contact.id, { reason });
    res.json({ success: true });
  }));

  router.post('/contacts/bulk-action', asyncRoute(async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(String))].slice(0, 100) : [];
    const action = String(req.body.action || '').toUpperCase();
    if (!ids.length) return res.status(400).json({ error: 'Odaberite najmanje jedan kontakt.' });
    if (!['ARCHIVE', 'SUPPRESS'].includes(action)) {
      return res.status(400).json({ error: 'Grupna akcija nije podržana.' });
    }
    const contacts = await db('email_contacts').whereIn('id', ids);
    const now = new Date();
    const reason = String(req.body.reason || 'Grupno zaustavljena komunikacija').trim();

    await db.transaction(async (trx) => {
      if (action === 'ARCHIVE') {
        await trx('email_contacts').whereIn('id', contacts.map((contact) => contact.id)).update({
          archived_at: now,
          updated_at: now
        });
      } else {
        for (const contact of contacts.filter((item) => item.email_normalized)) {
          const existing = await trx('email_suppression_list')
            .where({ email_normalized: contact.email_normalized }).first();
          if (!existing) {
            await trx('email_suppression_list').insert({
              id: uuidv4(),
              email: contact.email,
              email_normalized: contact.email_normalized,
              reason,
              source: 'MANUAL_BULK',
              notes: null,
              created_by: req.user.id,
              created_at: now
            });
          }
        }
        await trx('email_contacts').whereIn('id', contacts.map((contact) => contact.id)).update({
          sending_allowed: false,
          suppression_reason: reason,
          updated_at: now
        });
        await trx('email_followups')
          .whereIn('contact_id', contacts.map((contact) => contact.id))
          .where({ status: 'SCHEDULED' })
          .update({ status: 'CANCELLED', cancel_reason: 'SUPPRESSED', updated_at: now });
      }
    });

    await audit(db, req.user, action === 'ARCHIVE' ? 'CONTACTS_ARCHIVED' : 'CONTACTS_SUPPRESSED', 'email_contact_batch', null, {
      requested: ids.length,
      affected: contacts.length
    });
    res.json({ success: true, affected: contacts.length });
  }));

  router.post('/import/analyze', upload.single('file'), asyncRoute(async (req, res) => {
    res.json(await analyzeExcel(req.file));
  }));

  router.post('/import', upload.single('file'), asyncRoute(async (req, res) => {
    const report = await importContacts({
      db,
      file: req.file,
      user: req.user,
      sheetName: req.body.sheetName,
      headerRow: req.body.headerRow,
      mapping: req.body.mapping,
      duplicateStrategy: req.body.duplicateStrategy,
      mappingName: req.body.mappingName
    });
    res.status(201).json(report);
  }));

  router.get('/import/mappings', asyncRoute(async (req, res) => {
    const rows = await db('email_import_mappings')
      .where({ created_by: req.user.id })
      .orderBy('updated_at', 'desc');
    res.json(rows.map((row) => ({
      ...row,
      mapping: JSON.parse(row.mapping_json),
      mapping_json: undefined
    })));
  }));

  router.get('/imports', asyncRoute(async (req, res) => {
    const rows = await db('email_import_jobs')
      .where({ created_by: req.user.id })
      .orderBy('created_at', 'desc')
      .limit(25);
    res.json(rows);
  }));

  return router;
}

module.exports = { createAiEmailRouter, normalizeContactInput };
