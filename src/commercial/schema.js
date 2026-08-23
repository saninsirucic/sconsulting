export const BRAND_DEFINITIONS = [
  {
    code: 'VISIOCAST',
    slug: 'visiocast',
    name: 'Visiocast',
    subtitle: 'Komercijalna baza i praćenje prodajnih kontakata',
    ready: true,
  },
  {
    code: 'SAN_PEST',
    slug: 'san-pest',
    name: 'SAN Pest',
    subtitle: 'Zasebna komercijalna baza za SAN Pest',
    ready: false,
  },
  {
    code: 'FS_APP',
    slug: 'fs-app',
    name: 'FS App',
    subtitle: 'Digitalni HACCP',
    ready: false,
  },
];

export const CRM_STATUSES = [
  'NEW',
  'CALL_REQUIRED',
  'CONTACTED',
  'EMAIL_SENT',
  'MEETING_SCHEDULED',
  'INTERESTED',
  'OFFER_SENT',
  'FOLLOW_UP',
  'WON',
  'REJECTED',
];

export const PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'];

export const STATUS_LABELS = {
  NEW: 'Novi',
  CALL_REQUIRED: 'Potrebno nazvati',
  CONTACTED: 'Kontaktiran',
  EMAIL_SENT: 'Mail poslan',
  MEETING_SCHEDULED: 'Sastanak zakazan',
  INTERESTED: 'Zainteresovan',
  OFFER_SENT: 'Ponuda poslana',
  FOLLOW_UP: 'Follow-up',
  WON: 'Prihvaćeno / ugovoreno',
  REJECTED: 'Odbijen',
  HIGH: 'Visok',
  MEDIUM: 'Srednji',
  NORMAL: 'Normalan',
  LOW: 'Nizak',
  PENDING: 'Na čekanju',
  COMPLETED: 'Obrađeno',
  SKIPPED: 'Preskočeno',
};

export const EDIT_FIELDS = [
  { key: 'source_row_number', label: 'N/R (izvorni red)', type: 'number', readOnly: true },
  { key: 'company_name', label: 'Naziv komitenta', required: true },
  { key: 'record_type', label: 'Vrsta' },
  { key: 'branch_count', label: 'Broj poslovnica', type: 'number' },
  { key: 'unit_amount', label: 'Iznos', type: 'number', step: '0.01' },
  { key: 'total_amount', label: 'Ukupno', type: 'number', step: '0.01' },
  { key: 'profit_amount', label: 'Profit', type: 'number', step: '0.01' },
  { key: 'location', label: 'Lokacija' },
  { key: 'status', label: 'CRM status', type: 'status' },
  { key: 'priority', label: 'Prioritet', type: 'priority' },
  { key: 'next_contact_at', label: 'Sljedeći kontakt', type: 'datetime-local' },
  { key: 'email', label: 'Glavni email za slanje', type: 'email', wide: true },
  { key: 'raw_mail', label: 'Izvorni mail podaci (arhiva)', type: 'textarea', wide: true, rows: 4 },
  { key: 'raw_contact', label: 'Kontakt — puni izvorni sadržaj', type: 'textarea', wide: true, rows: 4 },
  { key: 'comment', label: 'Komentar — puni izvorni sadržaj', type: 'textarea', wide: true, rows: 4 },
  { key: 'notes', label: 'CRM napomene', type: 'textarea', wide: true, rows: 4 },
];

export function normalizeBrandCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

export function displayStatus(value) {
  if (!value) return 'Novi';
  if (STATUS_LABELS[value]) return STATUS_LABELS[value];
  return String(value).replaceAll('_', ' ').toLocaleLowerCase('bs-BA').replace(/^./, (letter) => letter.toUpperCase());
}

export function recordValue(record, ...keys) {
  for (const key of keys) {
    if (record?.[key] !== undefined && record?.[key] !== null && record?.[key] !== '') return record[key];
  }
  return '';
}
