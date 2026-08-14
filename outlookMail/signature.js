const SIGNATURE_MARKER = 'data-sconsulting-signature="v1"';
const SIGNATURE_LOGO_URL = 'https://www.s-consulting.ba/logo-wordmark.png';

const DEFAULT_SIGNATURE = Object.freeze({
  greeting: 'Lijep pozdrav,',
  name: 'Ermina Siručić',
  title: 'Direktor | S-Consulting Group',
  mobile: '+387 62 528 870 | +387 62 366 515',
  phone: '+387 33 848 871',
  email: 'info@s-consulting.ba',
  website: 'www.s-consulting.ba',
  address: 'Tvornička 3, Sarajevo'
});

function escapePlainText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '<br>');
}

function escapeAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function websiteHref(value) {
  const website = String(value || '').trim();
  if (!website) return null;
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

function buildSignatureHtml(overrides = {}) {
  const signature = { ...DEFAULT_SIGNATURE, ...(overrides || {}) };
  const lines = [
    `<div ${SIGNATURE_MARKER} style="margin-top:24px;font-family:Arial,Helvetica,sans-serif;color:#111827;font-size:14px;line-height:1.45;">`
  ];
  if (signature.greeting) lines.push(`<p style="margin:0 0 18px 0;">${escapePlainText(signature.greeting)}</p>`);
  lines.push(
    '<a href="https://www.s-consulting.ba/" target="_blank" rel="noopener noreferrer" style="display:inline-block;text-decoration:none;">',
    `<img src="${SIGNATURE_LOGO_URL}" width="320" height="48" alt="S-Consulting Group" style="display:block;width:320px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">`,
    '</a>',
    '<div style="width:420px;max-width:100%;border-top:2px solid #f97316;margin:12px 0 14px 0;"></div>'
  );
  if (signature.name) lines.push(`<p style="margin:0 0 5px 0;"><strong>${escapePlainText(signature.name)}</strong></p>`);
  if (signature.title) lines.push(`<p style="margin:0 0 8px 0;">${escapePlainText(signature.title)}</p>`);
  if (signature.mobile) lines.push(`<p style="margin:0 0 3px 0;"><strong>M:</strong> ${escapePlainText(signature.mobile)}</p>`);
  if (signature.phone) lines.push(`<p style="margin:0 0 3px 0;"><strong>T:</strong> ${escapePlainText(signature.phone)}</p>`);
  if (signature.email || signature.website) {
    const contact = [];
    if (signature.email) {
      contact.push(`<strong>E:</strong> <a href="mailto:${escapeAttribute(signature.email)}" style="color:#0f3d63;text-decoration:underline;">${escapePlainText(signature.email)}</a>`);
    }
    if (signature.website) {
      contact.push(`<strong>W:</strong> <a href="${escapeAttribute(websiteHref(signature.website))}" target="_blank" rel="noopener noreferrer" style="color:#0f3d63;text-decoration:underline;">${escapePlainText(signature.website)}</a>`);
    }
    lines.push(`<p style="margin:0 0 3px 0;">${contact.join(' | ')}</p>`);
  }
  if (signature.address) lines.push(`<p style="margin:0;"><strong>A:</strong> ${escapePlainText(signature.address)}</p>`);
  lines.push('</div>');
  return lines.join('');
}

const SIGNATURE_HTML = buildSignatureHtml();

function appendAutomaticSignature(body, signature) {
  const source = body && typeof body === 'object' ? body : { contentType: 'Text', content: '' };
  const isHtml = String(source.contentType || '').toLowerCase() === 'html';
  const messageHtml = isHtml ? String(source.content || '') : escapePlainText(source.content);
  return {
    contentType: 'HTML',
    content: `${messageHtml}<br><br>${buildSignatureHtml(signature)}`
  };
}

module.exports = {
  DEFAULT_SIGNATURE,
  SIGNATURE_HTML,
  SIGNATURE_LOGO_URL,
  SIGNATURE_MARKER,
  appendAutomaticSignature,
  buildSignatureHtml,
  escapeAttribute,
  escapePlainText
};
