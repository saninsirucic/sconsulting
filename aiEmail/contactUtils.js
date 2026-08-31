const FIELD_DEFINITIONS = [
  { key: 'company_name', label: 'Naziv firme', required: true },
  { key: 'contact_person', label: 'Kontakt osoba' },
  { key: 'email', label: 'E-mail', required: true },
  { key: 'additional_email', label: 'Dodatni e-mail' },
  { key: 'phone', label: 'Telefon' },
  { key: 'website', label: 'Web stranica' },
  { key: 'country', label: 'Država' },
  { key: 'city', label: 'Grad' },
  { key: 'postal_code', label: 'Poštanski broj' },
  { key: 'address', label: 'Adresa' },
  { key: 'industry', label: 'Djelatnost' },
  { key: 'source', label: 'Izvor' },
  { key: 'priority', label: 'Prioritet' },
  { key: 'status', label: 'Status' },
  { key: 'notes', label: 'Napomena' },
  { key: 'previous_communication', label: 'Ranija komunikacija' }
];

const HEADER_ALIASES = {
  company_name: ['naziv firme', 'naziv kandidat', 'firma', 'company', 'company name'],
  contact_person: ['kontakt osoba', 'ime kontakta', 'contact person'],
  email: ['email', 'e mail', 'kontakt mail', 'kontakt mail web fax', 'mail'],
  additional_email: ['dodatni email', 'secondary email', 'drugi email'],
  phone: ['telefon', 'kontakt broj', 'broj telefona', 'phone'],
  website: ['web', 'web stranica', 'kontakt web', 'kontakt mail web fax', 'website'],
  country: ['drzava', 'country'],
  city: ['grad', 'grad postanski broj', 'city'],
  postal_code: ['postanski broj', 'grad postanski broj', 'zip', 'postal code'],
  address: ['adresa', 'address'],
  industry: ['djelatnost', 'usluge tip', 'industry', 'usluge'],
  source: ['izvorni sheet', 'kontakt web izvor', 'finansijski izvor', 'izvor finansija url'],
  priority: ['prioritet', 'prioritet za app', 'prioritet za kontakt app a'],
  status: ['status', 'status iz komentara', 'status u postojecoj tabeli'],
  notes: ['napomena', 'komentar napomena', 'napomena finansije', 'napomena filtriranja'],
  previous_communication: ['ranija komunikacija', 'komentar sa seminara 2023']
};

function normalizeComparable(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[‘’“”'"`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeCompanyName(value) {
  return normalizeComparable(value)
    .replace(/\b(d o o|doo|a d|ad|d d|j p|jp)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function extractEmails(value) {
  const matches = String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(matches.map(normalizeEmail))];
}

function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
    && !email.includes('..');
}

function extractWebsite(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const urlMatch = text.match(/https?:\/\/[^\s,;]+/i);
  if (urlMatch) return urlMatch[0].replace(/[.)]+$/, '');
  const withoutEmails = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ');
  const domainMatch = withoutEmails.match(/(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+/i);
  if (!domainMatch) return null;
  return domainMatch[0];
}

function splitCityAndPostalCode(value) {
  const original = String(value || '').trim();
  const postalMatch = original.match(/\b\d(?:[\s-]?\d){3,5}\b/);
  if (!postalMatch) return { city: original || null, postalCode: null };
  const postalCode = postalMatch[0].replace(/\D/g, '');
  const city = original.replace(postalMatch[0], '').replace(/[,;-]+/g, ' ').trim();
  return { city: city || null, postalCode };
}

function suggestMapping(headers) {
  const mapping = {};
  for (const field of FIELD_DEFINITIONS) {
    const aliases = HEADER_ALIASES[field.key] || [];
    const exact = headers.find((header) => aliases.includes(normalizeComparable(header.label)));
    const partial = exact || headers.find((header) => {
      const normalized = normalizeComparable(header.label);
      return aliases.some((alias) => normalized.includes(alias));
    });
    if (partial) mapping[field.key] = partial.index;
  }
  return mapping;
}

function mappedValue(row, mapping, field) {
  const index = Number(mapping[field]);
  if (!Number.isInteger(index) || index < 0) return null;
  const value = row[index];
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function buildContactFromRow(row, mapping, sourceFallback) {
  const rawEmailValue = mappedValue(row, mapping, 'email');
  const mappedAdditional = mappedValue(row, mapping, 'additional_email');
  const emails = extractEmails([rawEmailValue, mappedAdditional].filter(Boolean).join(' '));
  const companyName = mappedValue(row, mapping, 'company_name');
  const cityPostalRaw = mappedValue(row, mapping, 'city');
  const explicitPostal = mappedValue(row, mapping, 'postal_code');
  const cityPostal = splitCityAndPostalCode(cityPostalRaw);
  const email = emails[0] || normalizeEmail(rawEmailValue);

  const errors = [];
  if (!companyName) errors.push({ code: 'MISSING_COMPANY', message: 'Nedostaje naziv firme.' });
  if (!rawEmailValue) errors.push({ code: 'MISSING_EMAIL', message: 'Nedostaje e-mail adresa.' });
  else if (!isValidEmail(email)) errors.push({ code: 'INVALID_EMAIL', message: 'E-mail adresa nije ispravna.' });

  const contact = {
    company_name: companyName,
    company_name_normalized: normalizeCompanyName(companyName),
    contact_person: mappedValue(row, mapping, 'contact_person'),
    email: isValidEmail(email) ? email : null,
    email_normalized: isValidEmail(email) ? normalizeEmail(email) : null,
    additional_email: emails[1] || null,
    phone: mappedValue(row, mapping, 'phone'),
    website: extractWebsite(mappedValue(row, mapping, 'website')),
    country: mappedValue(row, mapping, 'country'),
    city: cityPostal.city,
    postal_code: explicitPostal
      ? String(explicitPostal).replace(/\D/g, '') || explicitPostal
      : cityPostal.postalCode,
    address: mappedValue(row, mapping, 'address'),
    industry: mappedValue(row, mapping, 'industry'),
    source: mappedValue(row, mapping, 'source') || sourceFallback || null,
    priority: mappedValue(row, mapping, 'priority'),
    status: mappedValue(row, mapping, 'status'),
    notes: mappedValue(row, mapping, 'notes'),
    previous_communication: mappedValue(row, mapping, 'previous_communication')
  };

  return { contact, errors };
}

module.exports = {
  FIELD_DEFINITIONS,
  buildContactFromRow,
  extractEmails,
  isValidEmail,
  normalizeCompanyName,
  normalizeComparable,
  normalizeEmail,
  splitCityAndPostalCode,
  suggestMapping
};
