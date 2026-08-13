export const OUTLOOK_MAILBOX = 'sales@s-consulting.ba';

export const FOLDER_DEFINITIONS = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'sentitems', label: 'Poslano' },
  { key: 'drafts', label: 'Nacrti' },
  { key: 'archive', label: 'Arhiva' },
  { key: 'junkemail', label: 'Neželjena pošta' },
  { key: 'deleteditems', label: 'Obrisano' },
];

const FOLDER_ALIASES = {
  inbox: 'inbox',
  sent: 'sentitems',
  sentitems: 'sentitems',
  drafts: 'drafts',
  archive: 'archive',
  junk: 'junkemail',
  junkemail: 'junkemail',
  deleted: 'deleteditems',
  deleteditems: 'deleteditems',
};

export function normalizeFolderKey(value) {
  return FOLDER_ALIASES[String(value || '').toLowerCase()] || 'inbox';
}

export function normalizeAddress(entry) {
  if (!entry) return { name: '', address: '' };
  if (typeof entry === 'string') return { name: '', address: entry };
  const source = entry.emailAddress || entry.email_address || entry;
  return {
    name: source.name || source.displayName || source.display_name || '',
    address: source.address || source.email || source.mail || '',
  };
}

export function normalizeAddresses(value) {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  return entries.map(normalizeAddress).filter((entry) => entry.address);
}

export function normalizeFolder(folder) {
  const key = normalizeFolderKey(folder?.key || folder?.id || folder?.wellKnownName || folder?.well_known_name);
  return {
    key,
    label: folder?.name || folder?.displayName || folder?.display_name || FOLDER_DEFINITIONS.find((item) => item.key === key)?.label || key,
    totalCount: Number(folder?.totalCount ?? folder?.total_count ?? folder?.count) || 0,
    unreadCount: Number(folder?.unreadCount ?? folder?.unread_count ?? folder?.unread) || 0,
  };
}

export function normalizeMessage(message = {}) {
  const from = normalizeAddress(message.from || message.sender || message.fromEmail || message.from_email);
  const to = normalizeAddresses(message.to || message.toRecipients || message.to_recipients || message.toEmail || message.to_email);
  const cc = normalizeAddresses(message.cc || message.ccRecipients || message.cc_recipients || message.ccEmail || message.cc_email);
  const bcc = normalizeAddresses(message.bcc || message.bccRecipients || message.bcc_recipients || message.bccEmail || message.bcc_email);
  const bodySource = message.body || {};
  const bodyHtml = message.safeHtml || message.safe_html || message.bodyHtml || message.body_html
    || (String(bodySource.contentType || bodySource.content_type).toLowerCase() === 'html' ? bodySource.content : '');
  const bodyText = message.bodyText || message.body_text
    || (typeof bodySource === 'string' ? bodySource : bodySource.contentType === 'text' ? bodySource.content : '');

  return {
    ...message,
    id: String(message.id || message.messageId || message.message_id || ''),
    subject: message.subject || '(Bez naslova)',
    preview: message.preview || message.bodyPreview || message.body_preview || bodyText || '',
    from,
    to,
    cc,
    bcc,
    receivedAt: message.receivedAt || message.received_at || message.receivedDateTime || message.received_date_time
      || message.sentAt || message.sent_at || message.sentDateTime || message.sent_date_time || '',
    isRead: Boolean(message.isRead ?? message.is_read),
    hasAttachments: Boolean(message.hasAttachments ?? message.has_attachments ?? (message.attachments?.length)),
    importance: String(message.importance || 'normal').toLowerCase(),
    bodyHtml,
    bodyText,
    attachments: Array.isArray(message.attachments) ? message.attachments.map(normalizeAttachment) : [],
  };
}

export function normalizeAttachment(attachment = {}) {
  return {
    ...attachment,
    id: String(attachment.id || attachment.attachmentId || attachment.attachment_id || ''),
    name: attachment.name || attachment.fileName || attachment.file_name || 'Prilog',
    contentType: attachment.contentType || attachment.content_type || attachment.mimeType || attachment.mime_type || 'application/octet-stream',
    size: Number(attachment.size) || 0,
    isInline: Boolean(attachment.isInline ?? attachment.is_inline),
  };
}

export function formatMailDate(value, compact = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (compact && sameDay) return date.toLocaleTimeString('bs-BA', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleString('bs-BA', compact
    ? { day: '2-digit', month: '2-digit', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' }
    : { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

export function parseRecipients(value) {
  return String(value || '').split(/[;,\n]+/).map((item) => item.trim()).filter(Boolean);
}

export function addressesToText(value) {
  return normalizeAddresses(value).map((entry) => entry.address).join('; ');
}

export function replySubject(subject, forward = false) {
  const prefix = forward ? 'Prosl: ' : 'Odgovor: ';
  const clean = String(subject || '').replace(/^(re|fw|fwd|odgovor|prosl)\s*:\s*/i, '');
  return `${prefix}${clean || '(Bez naslova)'}`;
}

const SAFE_STYLE_PROPERTIES = new Set([
  'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-decoration', 'text-align', 'line-height', 'white-space', 'vertical-align',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-color', 'border-style', 'border-width', 'border-collapse', 'border-radius',
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
  'display', 'table-layout', 'word-break', 'overflow-wrap',
]);

function sanitizeStyle(value) {
  if (/url\s*\(|expression\s*\(|@import|javascript|position\s*:|z-index\s*:|behavior\s*:|-moz-binding/i.test(value)) return '';
  return value.split(';').map((declaration) => {
    const separator = declaration.indexOf(':');
    if (separator < 1) return '';
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const propertyValue = declaration.slice(separator + 1).trim();
    return SAFE_STYLE_PROPERTIES.has(property) && propertyValue ? `${property}:${propertyValue}` : '';
  }).filter(Boolean).join(';');
}

export function sanitizeMailHtml(html) {
  const source = String(html || '');
  if (!source || typeof DOMParser === 'undefined') return '';
  const documentNode = new DOMParser().parseFromString(source, 'text/html');
  // V1 namjerno uklanja sve slike i ugrađene medije: remote URL može biti tracking pixel.
  documentNode.querySelectorAll('script, style, iframe, object, embed, form, input, button, textarea, select, meta, base, link, img, picture, source, video, audio, svg').forEach((node) => node.remove());
  documentNode.querySelectorAll('*').forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      const unsafeLink = name === 'href' && value && !/^(https?:|mailto:|tel:|#|\/)/i.test(value);
      if (name === 'style') {
        const safeStyle = sanitizeStyle(attribute.value);
        if (safeStyle) node.setAttribute('style', safeStyle);
        else node.removeAttribute('style');
      } else if (name.startsWith('on') || name === 'srcdoc' || name === 'src' || name === 'background' || unsafeLink) {
        node.removeAttribute(attribute.name);
      }
    });
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return documentNode.body.innerHTML;
}

export function attachmentFileKey(file) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}
