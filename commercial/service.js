const { v4: uuidv4 } = require('uuid');
const { strictEmailAddress } = require('./email');

const CRM_STATUSES = new Set([
  'NEW', 'CALL_REQUIRED', 'CONTACTED', 'EMAIL_SENT', 'MEETING_SCHEDULED',
  'INTERESTED', 'OFFER_SENT', 'FOLLOW_UP', 'WON', 'REJECTED'
]);
const CRM_PRIORITIES = new Set(['HIGH', 'MEDIUM', 'LOW']);
const ASSIGNMENT_STATUSES = new Set([
  'PENDING', 'APPROVED', 'COMPLETED', 'SKIPPED', ...CRM_STATUSES
]);

function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

function normalizeBrandCode(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const aliases = {
    VISIOCAST: 'VISIOCAST',
    SANPEST: 'SAN_PEST',
    SAN_PEST: 'SAN_PEST',
    FSAPP: 'FS_APP',
    FS_APP: 'FS_APP'
  };
  return aliases[normalized] || normalized;
}

function serializeBrand(brand) {
  return brand ? {
    id: brand.id,
    code: brand.code,
    slug: brand.slug,
    name: brand.name,
    daily_limit: Number(brand.daily_limit),
    active: Boolean(brand.active),
    record_count: Number(brand.record_count || 0)
  } : null;
}

async function listAccessibleBrands(db, user) {
  let query = db({ b: 'crm_brands' }).where('b.active', true)
    .leftJoin({ c: 'crm_accounts' }, function joinActiveAccounts() {
      this.on('c.brand_id', '=', 'b.id').andOnNull('c.archived_at');
    })
    .select('b.*').count({ record_count: 'c.id' }).groupBy('b.id').orderBy('b.name');
  if (user.role !== 'direktor') {
    query = query.join({ a: 'app_user_brand_access' }, 'a.brand_id', 'b.id')
      .where({ 'a.user_id': user.id, 'a.can_read': true });
  }
  return (await query).map(serializeBrand);
}

async function resolveBrand(db, user, rawCode, { write = false } = {}) {
  const code = normalizeBrandCode(rawCode);
  const brand = await db('crm_brands').where({ code, active: true }).first();
  if (!brand) throw httpError(404, 'Traženi komercijalni brend ne postoji.', 'BRAND_NOT_FOUND');
  if (user.role === 'direktor') return brand;
  const access = await db('app_user_brand_access').where({
    user_id: user.id,
    brand_id: brand.id,
    [write ? 'can_write' : 'can_read']: true
  }).first();
  if (!access) throw httpError(403, 'Nemate pristup ovom komercijalnom brendu.', 'BRAND_ACCESS_DENIED');
  return brand;
}

function optionalString(body, key, existing = {}, maxLength = 20000) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return existing[key] ?? null;
  const value = body[key];
  if (value === null || value === undefined || String(value).trim() === '') return null;
  return String(value).trim().slice(0, maxLength);
}

function optionalNumber(body, key, existing = {}) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return existing[key] ?? null;
  const value = body[key];
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw httpError(400, `${key} mora biti broj.`);
  return parsed;
}

function optionalInteger(body, key, existing = {}) {
  const value = optionalNumber(body, key, existing);
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0) throw httpError(400, `${key} mora biti cijeli nenegativan broj.`);
  return value;
}

function optionalTimestamp(body, key, existing = {}) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return existing[key] ?? null;
  if (!body[key]) return null;
  const value = new Date(body[key]);
  if (Number.isNaN(value.getTime())) throw httpError(400, `${key} nije ispravan datum.`);
  return value;
}

function normalizeAccountInput(body, existing = {}) {
  const companyName = optionalString(body, 'company_name', existing, 300);
  if (!companyName) throw httpError(400, 'Naziv komitenta je obavezan.');
  const email = optionalString(body, 'email', existing, 320);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw httpError(400, 'E-mail adresa nije ispravna.');
  }
  const status = String(body.status ?? existing.status ?? 'NEW').trim().toUpperCase();
  if (!CRM_STATUSES.has(status)) throw httpError(400, 'Status komitenta nije podržan.');
  const priority = String(body.priority ?? existing.priority ?? 'MEDIUM').trim().toUpperCase();
  if (!CRM_PRIORITIES.has(priority)) throw httpError(400, 'Prioritet mora biti HIGH, MEDIUM ili LOW.');
  const sourceRowValue = Object.prototype.hasOwnProperty.call(body, 'source_row_number')
    ? body.source_row_number
    : (Object.prototype.hasOwnProperty.call(body, 'nr') ? body.nr : existing.source_row_number);
  let sourceRowNumber = sourceRowValue ?? null;
  if (sourceRowNumber !== null && sourceRowNumber !== '') {
    sourceRowNumber = Number(sourceRowNumber);
    if (!Number.isInteger(sourceRowNumber) || sourceRowNumber < 0) {
      throw httpError(400, 'source_row_number mora biti cijeli nenegativan broj.');
    }
  } else sourceRowNumber = null;

  return {
    source_row_number: sourceRowNumber,
    company_name: companyName,
    record_type: optionalString(body, 'record_type', existing, 120),
    branch_count: optionalInteger(body, 'branch_count', existing),
    unit_amount: optionalNumber(body, 'unit_amount', existing),
    total_amount: optionalNumber(body, 'total_amount', existing),
    profit_amount: optionalNumber(body, 'profit_amount', existing),
    currency: optionalString(body, 'currency', existing, 10) || 'BAM',
    contact_person: optionalString(body, 'contact_person', existing, 250),
    email: email ? email.toLowerCase() : null,
    phone: optionalString(body, 'phone', existing, 100),
    website: optionalString(body, 'website', existing, 500),
    location: optionalString(body, 'location', existing, 250),
    status,
    priority,
    comment: optionalString(body, 'comment', existing),
    notes: optionalString(body, 'notes', existing),
    raw_mail: optionalString(body, 'raw_mail', existing),
    raw_contact: optionalString(body, 'raw_contact', existing),
    last_contact_at: optionalTimestamp(body, 'last_contact_at', existing),
    next_contact_at: optionalTimestamp(body, 'next_contact_at', existing)
  };
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function referenceYear(row) {
  const reference = new Date(row.created_at || row.updated_at || Date.now());
  return Number.isNaN(reference.getTime()) ? new Date().getUTCFullYear() : reference.getUTCFullYear();
}

function letterTimestamp(row, dayValue, monthValue, yearValue, timeValue) {
  const day = Number(dayValue);
  const month = Number(monthValue);
  let year = yearValue ? Number(yearValue) : referenceYear(row);
  if (String(yearValue || '').length === 2) year += year >= 70 ? 1900 : 2000;
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    !Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)
    || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
  ) return null;
  const datePart = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (!timeValue) return datePart;
  const [hour, minute] = String(timeValue).split(':').map(Number);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return datePart;
  }
  return `${datePart}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

function extractLetterSentAt(row) {
  if (!row) return null;
  const explicit = row.letter_sent_at || row.letterSentAt;
  if (explicit) {
    const explicitDate = new Date(explicit);
    if (!Number.isNaN(explicitDate.getTime())) {
      return explicit instanceof Date ? explicit.toISOString() : String(explicit);
    }
  }
  const text = [row.comment, row.notes].filter(Boolean).join('\n');
  const datedPatterns = [
    /poslat\s+dopis\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})\.?(?:\s+u\s+(\d{1,2}:\d{2}))?/i,
    /mail\s+poslan\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})\.?(?:\s+u\s+(\d{1,2}:\d{2}))?/i,
    /poslao\s+mail\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})\.?(?:\s+u\s+(\d{1,2}:\d{2}))?/i,
    /(\d{1,2})\.(\d{1,2})\.(\d{2,4})\.?\s*[-–—]\s*poslan\s+(?:e-?mail|mail)/i
  ];
  for (const pattern of datedPatterns) {
    const match = text.match(pattern);
    if (match) return letterTimestamp(row, match[1], match[2], match[3], match[4]);
  }
  const legacy = text.match(/poslao\s+(\d{1,2})\.(\d{1,2})\.(?!\d)/i);
  return legacy ? letterTimestamp(row, legacy[1], legacy[2], null, null) : null;
}

function serializeAccount(row) {
  const rawCcEmails = parseJson(row?.cc_emails_json, []);
  const ccEmails = Array.isArray(rawCcEmails)
    ? [...new Set(rawCcEmails.map((email) => String(email || '').trim().toLowerCase())
      .map(strictEmailAddress).filter(Boolean))].slice(0, 10)
    : [];
  return row ? {
    ...row,
    nr: row.source_row_number,
    branch_count: numberOrNull(row.branch_count),
    unit_amount: numberOrNull(row.unit_amount),
    total_amount: numberOrNull(row.total_amount),
    profit_amount: numberOrNull(row.profit_amount),
    letter_sent_at: extractLetterSentAt(row),
    admin_call_requested: Boolean(row.admin_call_requested_at),
    cc_emails: ccEmails,
    cc_emails_json: undefined,
    source_data: parseJson(row.source_data_json, {}),
    source_data_json: undefined
  } : null;
}

async function logActivity(db, { account, user, type, fromStatus, toStatus, notes, metadata }) {
  const id = uuidv4();
  const now = new Date();
  await db('crm_activities').insert({
    id,
    account_id: account.id,
    brand_id: account.brand_id,
    user_id: user.id,
    activity_type: type,
    from_status: fromStatus || null,
    to_status: toStatus || null,
    notes: notes ? String(notes).slice(0, 20000) : null,
    metadata_json: metadata ? JSON.stringify(metadata) : null,
    occurred_at: now,
    created_at: now
  });
  return id;
}

function parsePositiveInt(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function parseFilterDate(value, label) {
  if (!value) return null;
  const normalized = String(value).trim();
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match || !letterTimestamp({}, match[3], match[2], match[1], null)) {
    throw httpError(400, `${label} nije ispravan datum.`);
  }
  return normalized;
}

function requestedLetterHistory(params, sortBy) {
  return String(params.lettersOnly || params.letters_only || '').toLowerCase() === 'true'
    || Boolean(params.sentFrom || params.sent_from || params.sentTo || params.sent_to)
    || sortBy === 'letter_sent_at';
}

function compareAccounts(left, right, field, direction) {
  const leftValue = left[field];
  const rightValue = right[field];
  if ((leftValue === null || leftValue === undefined || leftValue === '') && (rightValue === null || rightValue === undefined || rightValue === '')) return 0;
  if (leftValue === null || leftValue === undefined || leftValue === '') return 1;
  if (rightValue === null || rightValue === undefined || rightValue === '') return -1;
  const numeric = ['source_row_number', 'branch_count', 'total_amount', 'profit_amount'].includes(field);
  const result = numeric
    ? Number(leftValue) - Number(rightValue)
    : String(leftValue).localeCompare(String(rightValue), 'bs');
  return direction === 'desc' ? -result : result;
}

function countryFromLocation(value) {
  const parts = String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : null;
}

function applyAccountFilters(query, params) {
  if (String(params.archived || '').toLowerCase() === 'true') query.whereNotNull('archived_at');
  else query.whereNull('archived_at');
  if (params.status) {
    const status = String(params.status).toUpperCase();
    if (!CRM_STATUSES.has(status)) throw httpError(400, 'Filter statusa nije podržan.');
    query.where('status', status);
  }
  if (params.priority) {
    const priority = String(params.priority).toUpperCase();
    if (!CRM_PRIORITIES.has(priority)) throw httpError(400, 'Filter prioriteta nije podržan.');
    query.where('priority', priority);
  }
  if (params.record_type) query.where('record_type', String(params.record_type));
  if (params.location) query.where('location', String(params.location));
  if (String(params.adminCallRequested || params.admin_call_requested || '').toLowerCase() === 'true') {
    query.whereNotNull('admin_call_requested_at');
  }
  if (params.country) {
    const country = String(params.country).trim().toLowerCase();
    if (country.length > 100) throw httpError(400, 'Filter države nije podržan.');
    query.where((builder) => builder
      .whereRaw("LOWER(TRIM(COALESCE(location, ''))) = ?", [country])
      .orWhereRaw("LOWER(TRIM(COALESCE(location, ''))) LIKE ?", [`%, ${country}`]));
  }
  if (params.search) {
    const search = `%${String(params.search).trim().toLowerCase()}%`;
    query.where((builder) => builder
      .whereRaw("LOWER(COALESCE(company_name, '')) LIKE ?", [search])
      .orWhereRaw("LOWER(COALESCE(email, '')) LIKE ?", [search])
      .orWhereRaw("LOWER(COALESCE(phone, '')) LIKE ?", [search])
      .orWhereRaw("LOWER(COALESCE(location, '')) LIKE ?", [search])
      .orWhereRaw("LOWER(COALESCE(comment, '')) LIKE ?", [search])
      .orWhereRaw("LOWER(COALESCE(raw_mail, '')) LIKE ?", [search])
      .orWhereRaw("LOWER(COALESCE(raw_contact, '')) LIKE ?", [search])
      .orWhereRaw("LOWER(COALESCE(notes, '')) LIKE ?", [search]));
  }
  return query;
}

async function listAccounts(db, brand, params = {}) {
  const page = parsePositiveInt(params.page, 1, 100000);
  const perPage = parsePositiveInt(params.perPage || params.per_page, 25, 100);
  const base = applyAccountFilters(db('crm_accounts').where({ brand_id: brand.id }), params);
  const sortFields = new Set([
    'source_row_number', 'company_name', 'record_type', 'branch_count', 'total_amount',
    'profit_amount', 'location', 'status', 'priority', 'next_contact_at', 'updated_at',
    'letter_sent_at', 'admin_call_requested_at'
  ]);
  const sortBy = sortFields.has(params.sortBy || params.sort_by)
    ? (params.sortBy || params.sort_by) : 'source_row_number';
  const sortDirection = String(params.sortDirection || params.sort_direction).toLowerCase() === 'desc' ? 'desc' : 'asc';
  const facets = await db('crm_accounts').where({ brand_id: brand.id }).whereNull('archived_at')
    .select('status', 'priority', 'location', 'record_type');
  const unique = (key) => [...new Set(facets.map((row) => row[key]).filter(Boolean))].sort();
  const countries = [...new Set(facets.map((row) => countryFromLocation(row.location)).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'bs'));
  const filters = {
    statuses: unique('status'),
    priorities: unique('priority'),
    locations: unique('location'),
    recordTypes: unique('record_type'),
    countries
  };

  if (requestedLetterHistory(params, sortBy)) {
    const sentFrom = parseFilterDate(params.sentFrom || params.sent_from, 'Početni datum');
    const sentTo = parseFilterDate(params.sentTo || params.sent_to, 'Završni datum');
    if (sentFrom && sentTo && sentFrom > sentTo) {
      throw httpError(400, 'Početni datum ne može biti nakon završnog datuma.');
    }
    const lettersOnly = String(params.lettersOnly || params.letters_only || '').toLowerCase() === 'true';
    let historyItems = (await base.clone().select('*')).map(serializeAccount);
    if (lettersOnly) {
      historyItems = historyItems.filter((account) => account.letter_sent_at || account.status === 'EMAIL_SENT');
    }
    if (sentFrom) historyItems = historyItems.filter((account) => account.letter_sent_at && account.letter_sent_at.slice(0, 10) >= sentFrom);
    if (sentTo) historyItems = historyItems.filter((account) => account.letter_sent_at && account.letter_sent_at.slice(0, 10) <= sentTo);
    historyItems.sort((left, right) => (
      compareAccounts(left, right, sortBy, sortDirection)
      || String(left.company_name || '').localeCompare(String(right.company_name || ''), 'bs')
    ));
    const total = historyItems.length;
    const start = (page - 1) * perPage;
    return {
      items: historyItems.slice(start, start + perPage),
      pagination: { page, perPage, total, pages: Math.ceil(total / perPage) },
      filters
    };
  }

  const countRow = await base.clone().count({ count: '*' }).first();
  const items = await base.clone().select('*')
    .orderByRaw(`CASE WHEN ?? IS NULL THEN 1 ELSE 0 END`, [sortBy])
    .orderBy(sortBy, sortDirection)
    .orderBy('company_name', 'asc')
    .limit(perPage).offset((page - 1) * perPage);
  const total = Number(countRow ? countRow.count : 0);
  return {
    items: items.map(serializeAccount),
    pagination: { page, perPage, total, pages: Math.ceil(total / perPage) },
    filters
  };
}

async function listCallCalendar(db, user, params = {}) {
  const from = parseFilterDate(params.from, 'Početni datum kalendara');
  const to = parseFilterDate(params.to, 'Završni datum kalendara');
  if (!from || !to) {
    throw httpError(400, 'Početni i završni datum kalendara su obavezni.', 'CALENDAR_RANGE_REQUIRED');
  }
  if (from > to) {
    throw httpError(400, 'Početni datum kalendara ne može biti nakon završnog datuma.');
  }
  const rangeDays = Math.round((new Date(`${to}T00:00:00.000Z`) - new Date(`${from}T00:00:00.000Z`)) / 86400000);
  if (rangeDays > 92) {
    throw httpError(400, 'Kalendar se može učitati za najviše 93 dana.', 'CALENDAR_RANGE_TOO_LARGE');
  }

  let brands = await listAccessibleBrands(db, user);
  const requestedBrand = params.brand ? normalizeBrandCode(params.brand) : '';
  if (requestedBrand) {
    brands = brands.filter((brand) => brand.code === requestedBrand);
    if (!brands.length) {
      throw httpError(403, 'Nemate pristup traženom programu u kalendaru.', 'BRAND_ACCESS_DENIED');
    }
  }
  if (!brands.length) return { items: [], range: { from, to }, brands: [] };

  const fromTimestamp = new Date(`${from}T00:00:00.000Z`);
  const toExclusive = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 86400000);
  const rows = await db({ a: 'crm_accounts' })
    .join({ b: 'crm_brands' }, 'b.id', 'a.brand_id')
    .whereIn('a.brand_id', brands.map((brand) => brand.id))
    .whereNull('a.archived_at')
    .whereNotNull('a.next_contact_at')
    .where('a.next_contact_at', '>=', fromTimestamp)
    .where('a.next_contact_at', '<', toExclusive)
    .select('a.*', 'b.code as brand_code', 'b.name as brand_name')
    .orderBy('a.next_contact_at', 'asc')
    .orderBy('a.company_name', 'asc')
    .limit(2000);

  return {
    items: rows.map(serializeAccount),
    range: { from, to },
    brands: brands.map(serializeBrand)
  };
}

async function createAccount(db, brand, user, body) {
  const id = uuidv4();
  const now = new Date();
  const normalized = normalizeAccountInput(body || {});
  const row = {
    id,
    brand_id: brand.id,
    source_key: `MANUAL:${id}`,
    ...normalized,
    source_data_json: JSON.stringify({ source: 'MANUAL' }),
    owner_user_id: user.authSource === 'db' ? user.id : null,
    created_by: user.id,
    updated_by: user.id,
    created_at: now,
    updated_at: now
  };
  await db.transaction(async (trx) => {
    await trx('crm_accounts').insert(row);
    await logActivity(trx, { account: row, user, type: 'ACCOUNT_CREATED', toStatus: row.status });
  });
  return serializeAccount(await db('crm_accounts').where({ id }).first());
}

async function accountWithBrand(db, id) {
  return db({ a: 'crm_accounts' }).join({ b: 'crm_brands' }, 'b.id', 'a.brand_id')
    .where('a.id', id).select('a.*', 'b.code as brand_code', 'b.slug as brand_slug').first();
}

async function updateAccount(db, account, user, body) {
  if (account.archived_at) throw httpError(409, 'Arhivirani komitent se ne može mijenjati.');
  const update = normalizeAccountInput(body || {}, account);
  const changedFields = Object.keys(update).filter((key) => {
    const oldValue = account[key] instanceof Date ? account[key].toISOString() : account[key];
    const newValue = update[key] instanceof Date ? update[key].toISOString() : update[key];
    return String(oldValue ?? '') !== String(newValue ?? '');
  });
  const now = new Date();
  await db.transaction(async (trx) => {
    await trx('crm_accounts').where({ id: account.id }).update({
      ...update,
      updated_by: user.id,
      updated_at: now
    });
    await logActivity(trx, {
      account,
      user,
      type: account.status !== update.status ? 'STATUS_CHANGED' : 'ACCOUNT_UPDATED',
      fromStatus: account.status,
      toStatus: update.status,
      notes: body && body.activity_note,
      metadata: { changedFields }
    });
  });
  return serializeAccount(await db('crm_accounts').where({ id: account.id }).first());
}

async function transferAccount(db, account, targetBrand, user) {
  if (account.archived_at) throw httpError(409, 'Arhivirani komitent se ne može prebaciti.');
  if (!targetBrand || targetBrand.id === account.brand_id) {
    throw httpError(400, 'Odaberite drugu ciljnu bazu.', 'SAME_BRAND_TRANSFER');
  }
  const hasMailQueue = await db.schema.hasTable('crm_mail_queue');
  const hasAutomationSettings = hasMailQueue
    && await db.schema.hasTable('crm_mail_automation_settings');
  const now = new Date();
  let sourceBrand;
  await db.transaction(async (trx) => {
    if (hasAutomationSettings) {
      const brandIds = [...new Set([account.brand_id, targetBrand.id])].sort();
      await trx('crm_mail_automation_settings').whereIn('brand_id', brandIds)
        .orderBy('brand_id').forUpdate();
    }
    const lockedAccount = await trx('crm_accounts').where({ id: account.id }).forUpdate().first();
    if (!lockedAccount) throw httpError(404, 'Komitent nije pronađen.', 'ACCOUNT_NOT_FOUND');
    if (lockedAccount.archived_at) throw httpError(409, 'Arhivirani komitent se ne može prebaciti.');
    if (lockedAccount.brand_id !== account.brand_id) {
      throw httpError(409, 'Komitent je u međuvremenu prebačen. Osvježite prikaz.', 'ACCOUNT_TRANSFER_STALE');
    }
    sourceBrand = await trx('crm_brands').where({ id: lockedAccount.brand_id }).first();
    if (!sourceBrand) throw httpError(404, 'Izvorna baza komitenta nije pronađena.', 'BRAND_NOT_FOUND');
    const duplicateSource = await trx('crm_accounts').where({
      brand_id: targetBrand.id,
      source_key: lockedAccount.source_key
    }).whereNot({ id: lockedAccount.id }).forUpdate().first();
    if (duplicateSource) {
      throw httpError(409, 'U ciljnoj bazi već postoji ovaj izvorni zapis.', 'TRANSFER_SOURCE_CONFLICT');
    }
    let mailRows = [];
    if (hasMailQueue) {
      mailRows = await trx('crm_mail_queue').where({
        account_id: lockedAccount.id,
        brand_id: sourceBrand.id
      }).orderBy('id').forUpdate();
      if (mailRows.some((row) => row.status === 'SENDING')) {
        throw httpError(
          409,
          'Slanje maila ovom komitentu je u toku. Sačekajte završetak prije prebacivanja.',
          'ACCOUNT_MAIL_SEND_IN_PROGRESS'
        );
      }
    }
    await trx('crm_daily_assignments')
      .where({ account_id: lockedAccount.id, brand_id: sourceBrand.id, status: 'PENDING' })
      .delete();
    if (mailRows.length) {
      const unsentIds = mailRows
        .filter((row) => ['PENDING', 'APPROVED', 'SCHEDULED', 'FAILED', 'NOT_APPROVED'].includes(row.status))
        .map((row) => row.id);
      if (unsentIds.length) await trx('crm_mail_queue').whereIn('id', unsentIds).delete();
    }
    const updated = await trx('crm_accounts').where({
      id: lockedAccount.id,
      brand_id: sourceBrand.id
    }).update({
      brand_id: targetBrand.id,
      updated_by: user.id,
      updated_at: now
    });
    if (!updated) {
      throw httpError(409, 'Komitent je u međuvremenu promijenjen. Osvježite prikaz.', 'ACCOUNT_TRANSFER_STALE');
    }
    await logActivity(trx, {
      account: { ...lockedAccount, brand_id: targetBrand.id },
      user,
      type: 'ACCOUNT_TRANSFERRED',
      fromStatus: lockedAccount.status,
      toStatus: lockedAccount.status,
      notes: `Prebačeno iz ${sourceBrand.name} u ${targetBrand.name}.`,
      metadata: {
        fromBrandId: sourceBrand.id,
        fromBrandCode: sourceBrand.code,
        fromBrandName: sourceBrand.name,
        toBrandId: targetBrand.id,
        toBrandCode: targetBrand.code,
        toBrandName: targetBrand.name
      }
    });
  });

  const moved = await db('crm_accounts').where({ id: account.id }).first();
  return {
    account: serializeAccount(moved),
    from_brand: serializeBrand(sourceBrand),
    to_brand: serializeBrand(targetBrand)
  };
}

async function archiveAccount(db, account, user) {
  if (account.archived_at) return { success: true, alreadyArchived: true };
  const hasMailQueue = await db.schema.hasTable('crm_mail_queue');
  const hasAutomationSettings = hasMailQueue
    && await db.schema.hasTable('crm_mail_automation_settings');
  const now = new Date();
  await db.transaction(async (trx) => {
    if (hasAutomationSettings) {
      await trx('crm_mail_automation_settings')
        .where({ brand_id: account.brand_id }).forUpdate().first();
    }
    const lockedAccount = await trx('crm_accounts').where({ id: account.id }).forUpdate().first();
    if (!lockedAccount) throw httpError(404, 'Komitent nije pronađen.', 'ACCOUNT_NOT_FOUND');
    if (lockedAccount.archived_at) return;
    if (hasMailQueue) {
      const mailRows = await trx('crm_mail_queue').where({
        account_id: lockedAccount.id,
        brand_id: lockedAccount.brand_id
      }).orderBy('id').forUpdate();
      const unsentIds = mailRows
        .filter((row) => ['PENDING', 'APPROVED', 'SCHEDULED', 'FAILED', 'NOT_APPROVED'].includes(row.status))
        .map((row) => row.id);
      if (unsentIds.length) await trx('crm_mail_queue').whereIn('id', unsentIds).delete();
    }
    await trx('crm_accounts').where({ id: lockedAccount.id }).update({
      archived_at: now,
      updated_by: user.id,
      updated_at: now
    });
    await logActivity(trx, {
      account: lockedAccount,
      user,
      type: 'ACCOUNT_ARCHIVED',
      fromStatus: lockedAccount.status
    });
  });
  return { success: true };
}

async function setAdminCallRequested(db, account, user, requested) {
  if (account.archived_at) throw httpError(409, 'Arhivirani komitent se ne može označiti za poziv.');
  if (typeof requested !== 'boolean') {
    throw httpError(400, 'Polje requested mora biti true ili false.', 'ADMIN_CALL_REQUEST_INVALID');
  }
  const now = new Date();
  await db.transaction(async (trx) => {
    const lockedAccount = await trx('crm_accounts').where({ id: account.id }).forUpdate().first();
    if (!lockedAccount) throw httpError(404, 'Komitent nije pronađen.', 'ACCOUNT_NOT_FOUND');
    if (lockedAccount.archived_at) throw httpError(409, 'Arhivirani komitent se ne može označiti za poziv.');
    const alreadyRequested = Boolean(lockedAccount.admin_call_requested_at);
    if (alreadyRequested === requested) return;
    await trx('crm_accounts').where({ id: lockedAccount.id }).update({
      admin_call_requested_at: requested ? now : null,
      admin_call_requested_by: requested ? user.id : null,
      updated_by: user.id,
      updated_at: now
    });
    await logActivity(trx, {
      account: lockedAccount,
      user,
      type: requested ? 'ADMIN_CALL_REQUESTED' : 'ADMIN_CALL_CLEARED',
      fromStatus: lockedAccount.status,
      toStatus: lockedAccount.status,
      notes: requested ? 'Admin označio komitenta za poziv.' : 'Oznaka za poziv je uklonjena.',
      metadata: { requested }
    });
  });
  return serializeAccount(await db('crm_accounts').where({ id: account.id }).first());
}

async function listActivities(db, accountId) {
  const rows = await db('crm_activities').where({ account_id: accountId })
    .orderBy('occurred_at', 'desc').limit(200);
  return rows.map((row) => ({
    ...row,
    metadata: parseJson(row.metadata_json, {}),
    metadata_json: undefined
  }));
}

async function addManualActivity(db, account, user, body) {
  const type = String(body.activity_type || 'NOTE').trim().toUpperCase().slice(0, 80);
  const notes = optionalString(body, 'notes', {}, 20000);
  if (!notes && type === 'NOTE') throw httpError(400, 'Tekst aktivnosti je obavezan.');
  const requestedStatus = body.status ? String(body.status).toUpperCase() : null;
  if (requestedStatus && !CRM_STATUSES.has(requestedStatus)) throw httpError(400, 'Status nije podržan.');
  const now = new Date();
  let activityId;
  await db.transaction(async (trx) => {
    if (requestedStatus && requestedStatus !== account.status) {
      await trx('crm_accounts').where({ id: account.id }).update({
        status: requestedStatus,
        last_contact_at: now,
        updated_by: user.id,
        updated_at: now
      });
    }
    activityId = await logActivity(trx, {
      account,
      user,
      type,
      fromStatus: account.status,
      toStatus: requestedStatus || account.status,
      notes
    });
  });
  return db('crm_activities').where({ id: activityId }).first();
}

function businessDate(timezone = 'Europe/Sarajevo', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function dailyListItems(db, userId, brandId, date) {
  const hasMailQueue = await db.schema.hasTable('crm_mail_queue');
  let query = db({ d: 'crm_daily_assignments' })
    .join({ a: 'crm_accounts' }, 'a.id', 'd.account_id');
  if (hasMailQueue) {
    query = query.leftJoin({ q: 'crm_mail_queue' }, function joinDailyMailQueue() {
      this.on('q.account_id', '=', 'd.account_id')
        .andOn('q.brand_id', '=', 'd.brand_id')
        .andOn('q.queue_date', '=', 'd.assignment_date');
    });
  }
  const selectColumns = [
    'd.id as assignment_id', 'd.assignment_date', 'd.sequence_number',
    'd.status as assignment_status', 'd.notes as assignment_notes', 'd.completed_at',
    'a.*'
  ];
  if (hasMailQueue) selectColumns.push('q.status as mail_queue_status');
  const rows = await query
    .where({ 'd.user_id': userId, 'd.brand_id': brandId, 'd.assignment_date': date })
    .select(selectColumns).orderBy('d.sequence_number');
  return rows.map((row) => ({
    id: row.assignment_id,
    assignment_id: row.assignment_id,
    assignment_date: row.assignment_date,
    sequence_number: Number(row.sequence_number),
    assignment_status: row.assignment_status,
    assignment_notes: row.assignment_notes,
    completed_at: row.completed_at,
    mail_queue_status: row.mail_queue_status || null,
    account: serializeAccount(Object.fromEntries(
      Object.entries(row).filter(([key]) => ![
        'assignment_id', 'assignment_date', 'sequence_number', 'assignment_status',
        'assignment_notes', 'completed_at', 'mail_queue_status'
      ].includes(key))
    ))
  }));
}

async function readDailyAssignments(db, user, brand, date = businessDate()) {
  return {
    brand: serializeBrand(brand),
    date,
    limit: Number(brand.daily_limit) || 30,
    items: await dailyListItems(db, user.id, brand.id, date)
  };
}

async function ensureDailyAssignments(db, user, brand, { date = businessDate(), limit } = {}) {
  const dailyLimit = Math.min(Number(brand.daily_limit) || 30, parsePositiveInt(limit, Number(brand.daily_limit) || 30, 100));
  await db.transaction(async (trx) => {
    // Serializes list preparation for this brand in PostgreSQL; SQLite serializes writes itself.
    await trx('crm_brands').where({ id: brand.id }).forUpdate().first();
    const existing = await trx('crm_daily_assignments').where({
      user_id: user.id,
      brand_id: brand.id,
      assignment_date: date
    }).orderBy('sequence_number');
    if (existing.length >= dailyLimit) return;

    const accounts = await trx('crm_accounts').where({ brand_id: brand.id })
      .whereNull('archived_at')
      .whereNotIn('status', ['REJECTED', 'WON'])
      .select('id', 'source_row_number', 'company_name');
    if (!accounts.length) return;
    const history = await trx('crm_daily_assignments').where({
      user_id: user.id,
      brand_id: brand.id
    }).select('account_id').max({ last_assigned: 'assignment_date' }).groupBy('account_id');
    const lastAssigned = new Map(history.map((row) => [row.account_id, row.last_assigned]));
    const alreadyToday = new Set(existing.map((row) => row.account_id));
    const candidates = accounts.filter((account) => !alreadyToday.has(account.id)).sort((left, right) => {
      const leftDate = lastAssigned.get(left.id) || null;
      const rightDate = lastAssigned.get(right.id) || null;
      if (leftDate === null && rightDate !== null) return -1;
      if (leftDate !== null && rightDate === null) return 1;
      if (leftDate !== rightDate) return String(leftDate || '').localeCompare(String(rightDate || ''));
      const leftRow = left.source_row_number === null ? Number.MAX_SAFE_INTEGER : Number(left.source_row_number);
      const rightRow = right.source_row_number === null ? Number.MAX_SAFE_INTEGER : Number(right.source_row_number);
      if (leftRow !== rightRow) return leftRow - rightRow;
      return String(left.company_name).localeCompare(String(right.company_name), 'bs');
    });
    const selected = candidates.slice(0, Math.max(0, dailyLimit - existing.length));
    const now = new Date();
    if (selected.length) {
      await trx('crm_daily_assignments').insert(selected.map((account, index) => ({
        id: uuidv4(),
        user_id: user.id,
        brand_id: brand.id,
        account_id: account.id,
        assignment_date: date,
        sequence_number: existing.length + index + 1,
        status: 'PENDING',
        created_at: now,
        updated_at: now
      })));
    }
  });
  return {
    brand: serializeBrand(brand),
    date,
    limit: dailyLimit,
    items: await dailyListItems(db, user.id, brand.id, date)
  };
}

async function updateDailyAssignment(db, assignment, account, user, body) {
  const status = String(body.status || body.assignment_status || '').trim().toUpperCase();
  if (!ASSIGNMENT_STATUSES.has(status)) throw httpError(400, 'Status dnevnog zadatka nije podržan.');
  const notes = optionalString(body, 'notes', { notes: assignment.notes }, 20000);
  const accountStatus = body.account_status
    ? String(body.account_status).trim().toUpperCase()
    : (CRM_STATUSES.has(status) ? status : null);
  if (accountStatus && !CRM_STATUSES.has(accountStatus)) throw httpError(400, 'Status komitenta nije podržan.');
  const now = new Date();
  const hasMailQueue = await db.schema.hasTable('crm_mail_queue');
  await db.transaction(async (trx) => {
    let automationSettings = null;
    if (hasMailQueue) {
      automationSettings = await trx('crm_mail_automation_settings')
        .where({ brand_id: assignment.brand_id }).forUpdate().first();
      if (status === 'PENDING') {
        const targetRows = await trx('crm_mail_queue').where({
          brand_id: assignment.brand_id,
          account_id: assignment.account_id,
          queue_date: assignment.assignment_date
        }).whereIn('status', ['PENDING', 'APPROVED', 'SCHEDULED', 'FAILED', 'NOT_APPROVED'])
          .select('id', 'status').forUpdate();
        const reactivatedCount = targetRows.filter((row) => row.status === 'NOT_APPROVED').length;
        if (reactivatedCount) {
          const activeRow = await trx('crm_mail_queue').where({
            brand_id: assignment.brand_id,
            queue_date: assignment.assignment_date
          }).whereNot({ status: 'NOT_APPROVED' }).count({ count: '*' }).first();
          const dailyLimit = Math.min(30, Number(automationSettings?.daily_limit) || 30);
          if (Number(activeRow?.count || 0) + reactivatedCount > dailyLimit) {
            throw httpError(
              409,
              `Dnevni limit od ${dailyLimit} prijedloga je dostignut.`,
              'CAMPAIGN_DAILY_LIMIT_REACHED'
            );
          }
        }
      }
    }
    await trx('crm_daily_assignments').where({ id: assignment.id }).update({
      status,
      notes,
      completed_at: status === 'PENDING' ? null : now,
      updated_at: now
    });
    if (accountStatus && accountStatus !== account.status) {
      await trx('crm_accounts').where({ id: account.id }).update({
        status: accountStatus,
        last_contact_at: now,
        updated_by: user.id,
        updated_at: now
      });
    }
    if (hasMailQueue && status !== 'APPROVED') {
      await trx('crm_mail_queue').where({
        brand_id: assignment.brand_id,
        account_id: assignment.account_id,
        queue_date: assignment.assignment_date
      }).whereIn('status', ['PENDING', 'APPROVED', 'SCHEDULED', 'FAILED', 'NOT_APPROVED']).update({
        status: status === 'PENDING' ? 'PENDING' : 'NOT_APPROVED',
        claim_token: null,
        claimed_at: null,
        last_error: null,
        updated_at: now
      });
    }
    await logActivity(trx, {
      account,
      user,
      type: 'DAILY_ASSIGNMENT_UPDATED',
      fromStatus: account.status,
      toStatus: accountStatus || account.status,
      notes,
      metadata: { assignmentId: assignment.id, assignmentStatus: status }
    });
  });
  return db('crm_daily_assignments').where({ id: assignment.id }).first();
}

async function approveDailyAssignments(db, user, brand, assignmentIds, decision, options = {}) {
  if (!Array.isArray(assignmentIds)) {
    throw httpError(400, 'Označeni dnevni zadaci moraju biti poslani kao niz.', 'DAILY_ASSIGNMENT_SELECTION_INVALID');
  }
  const ids = [];
  const seenIds = new Set();
  for (const value of assignmentIds) {
    const id = String(value || '').trim();
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    ids.push(id);
    if (ids.length > 30) {
      throw httpError(
        400,
        'Odjednom možete odobriti najviše 30 komitenata.',
        'DAILY_ASSIGNMENT_SELECTION_TOO_LARGE'
      );
    }
  }
  if (!ids.length) {
    throw httpError(400, 'Označite najmanje jednog komitenta.', 'DAILY_ASSIGNMENT_SELECTION_REQUIRED');
  }
  const normalizedDecision = String(decision || '').trim().toUpperCase();
  if (normalizedDecision !== 'APPROVED') {
    throw httpError(400, 'Odluka mora biti APPROVED.', 'DAILY_ASSIGNMENT_DECISION_INVALID');
  }

  const date = options.date || businessDate();
  const [hasMailQueue, hasAutomationSettings] = await Promise.all([
    db.schema.hasTable('crm_mail_queue'),
    db.schema.hasTable('crm_mail_automation_settings')
  ]);
  const outcome = await db.transaction(async (trx) => {
    // The per-brand settings row is the common first lock for queue/import/send mutations.
    if (hasAutomationSettings) {
      await trx('crm_mail_automation_settings')
        .where({ brand_id: brand.id }).forUpdate().first();
    }
    const assignments = await trx('crm_daily_assignments').where({
      user_id: user.id,
      brand_id: brand.id,
      assignment_date: date
    }).whereIn('id', ids).orderBy('id').forUpdate();
    const assignmentsById = new Map(assignments.map((row) => [row.id, row]));
    const accountIds = [...new Set(assignments.map((row) => row.account_id))].sort();
    const accounts = accountIds.length
      ? await trx('crm_accounts').whereIn('id', accountIds).orderBy('id').forUpdate()
      : [];
    const accountsById = new Map(accounts.map((row) => [row.id, row]));
    const queueRows = hasMailQueue && accountIds.length
      ? await trx('crm_mail_queue').where({ brand_id: brand.id, queue_date: date })
        .whereIn('account_id', accountIds).orderBy('id').forUpdate()
      : [];
    const queueByAccount = new Map(queueRows.map((row) => [row.account_id, row]));

    const changed = [];
    const unchanged = [];
    const rejections = [];
    for (const id of ids) {
      const assignment = assignmentsById.get(id);
      if (!assignment) {
        rejections.push({ assignment_id: id, code: 'NOT_FOUND_OR_OUT_OF_SCOPE' });
        continue;
      }
      const account = accountsById.get(assignment.account_id);
      if (!account || account.brand_id !== brand.id || account.archived_at) {
        rejections.push({ assignment_id: id, code: 'ACCOUNT_UNAVAILABLE' });
        continue;
      }
      if (['REJECTED', 'WON', 'EMAIL_SENT'].includes(account.status)) {
        rejections.push({ assignment_id: id, code: 'ACCOUNT_NOT_ELIGIBLE' });
        continue;
      }
      if (!strictEmailAddress(account.email)) {
        rejections.push({ assignment_id: id, code: 'INVALID_EMAIL' });
        continue;
      }
      const queue = queueByAccount.get(account.id);
      if (queue && ['SCHEDULED', 'SENDING', 'SENT', 'SKIPPED'].includes(queue.status)) {
        const code = queue.status === 'SENDING'
          ? 'MAIL_SEND_IN_PROGRESS'
          : (queue.status === 'SCHEDULED'
            ? 'MAIL_ALREADY_SCHEDULED'
            : (queue.status === 'SENT' ? 'MAIL_ALREADY_SENT' : 'MAIL_ALREADY_PROCESSED'));
        rejections.push({ assignment_id: id, code });
        continue;
      }
      if (assignment.status === 'APPROVED') {
        unchanged.push(id);
        continue;
      }
      changed.push({ assignment, account });
    }

    const now = new Date();
    if (changed.length) {
      await trx('crm_daily_assignments').whereIn('id', changed.map(({ assignment }) => assignment.id)).update({
        status: 'APPROVED',
        completed_at: now,
        updated_at: now
      });
      for (const { assignment, account } of changed) {
        await logActivity(trx, {
          account,
          user,
          type: 'DAILY_ASSIGNMENT_UPDATED',
          fromStatus: account.status,
          toStatus: account.status,
          notes: 'Odobreno grupnim odabirom za mail.',
          metadata: {
            assignmentId: assignment.id,
            assignmentStatus: 'APPROVED',
            approvalDecision: normalizedDecision,
            bulk: true
          }
        });
      }
    }
    return {
      requested_count: ids.length,
      matched_count: assignments.length,
      updated_count: changed.length,
      unchanged_count: unchanged.length,
      rejected_count: rejections.length,
      decision: normalizedDecision,
      rejections
    };
  });

  return {
    ...outcome,
    updated: outcome.updated_count,
    unchanged: outcome.unchanged_count,
    rejected: outcome.rejected_count,
    assignments: await readDailyAssignments(db, user, brand, date)
  };
}

async function dashboard(db, brand, user, date = businessDate()) {
  const base = db('crm_accounts').where({ brand_id: brand.id }).whereNull('archived_at');
  const [totalsRow, statusRows, todayRows] = await Promise.all([
    base.clone().count({ count: '*' }).sum({
      total_amount: 'total_amount',
      profit_amount: 'profit_amount',
      branch_count: 'branch_count'
    }).first(),
    base.clone().select('status').count({ count: '*' }).groupBy('status'),
    db('crm_daily_assignments').where({
      user_id: user.id,
      brand_id: brand.id,
      assignment_date: date
    }).select('status')
  ]);
  const statusCounts = Object.fromEntries([...CRM_STATUSES].map((status) => [status, 0]));
  statusRows.forEach((row) => { statusCounts[row.status] = Number(row.count); });
  const completed = todayRows.filter((row) => row.status !== 'PENDING').length;
  return {
    brand: serializeBrand(brand),
    totals: {
      count: Number(totalsRow ? totalsRow.count : 0),
      total_amount: numberOrNull(totalsRow && totalsRow.total_amount) || 0,
      profit_amount: numberOrNull(totalsRow && totalsRow.profit_amount) || 0,
      branch_count: numberOrNull(totalsRow && totalsRow.branch_count) || 0
    },
    statusCounts,
    today: {
      date,
      assignments: todayRows.length,
      assigned: todayRows.length,
      completed,
      pending: todayRows.length - completed,
      daily_limit: Number(brand.daily_limit)
    }
  };
}

module.exports = {
  ASSIGNMENT_STATUSES,
  CRM_PRIORITIES,
  CRM_STATUSES,
  accountWithBrand,
  addManualActivity,
  archiveAccount,
  businessDate,
  createAccount,
  dashboard,
  ensureDailyAssignments,
  extractLetterSentAt,
  httpError,
  listAccessibleBrands,
  listAccounts,
  listCallCalendar,
  listActivities,
  normalizeAccountInput,
  normalizeBrandCode,
  resolveBrand,
  readDailyAssignments,
  serializeAccount,
  serializeBrand,
  setAdminCallRequested,
  transferAccount,
  updateAccount,
  approveDailyAssignments,
  updateDailyAssignment
};
