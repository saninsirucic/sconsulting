const SIGNATURE_MARKER = 'data-sconsulting-signature="v1"';
const SIGNATURE_LOGO_URL = 'https://www.s-consulting.ba/logo-wordmark.png';

const SIGNATURE_HTML = [
  `<div ${SIGNATURE_MARKER} style="margin-top:24px;font-family:Arial,Helvetica,sans-serif;color:#111827;font-size:14px;line-height:1.45;">`,
  '<p style="margin:0 0 18px 0;">Lijep pozdrav,</p>',
  '<a href="https://www.s-consulting.ba/" target="_blank" rel="noopener noreferrer" style="display:inline-block;text-decoration:none;">',
  `<img src="${SIGNATURE_LOGO_URL}" width="320" height="48" alt="S-Consulting Group" style="display:block;width:320px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">`,
  '</a>',
  '<div style="width:420px;max-width:100%;border-top:2px solid #f97316;margin:12px 0 14px 0;"></div>',
  '<p style="margin:0 0 5px 0;"><strong>Ermina Siručić</strong></p>',
  '<p style="margin:0 0 8px 0;">Direktor&nbsp; | &nbsp;S-Consulting Group</p>',
  '<p style="margin:0 0 3px 0;"><strong>M:</strong> <a href="tel:+38762528870" style="color:#111827;text-decoration:none;">+387 62 528 870</a> | <a href="tel:+38762366515" style="color:#111827;text-decoration:none;">+387 62 366 515</a></p>',
  '<p style="margin:0 0 3px 0;"><strong>T:</strong> <a href="tel:+38733848871" style="color:#111827;text-decoration:none;">+387 33 848 871</a></p>',
  '<p style="margin:0 0 3px 0;"><strong>E:</strong> <a href="mailto:info@s-consulting.ba" style="color:#0f3d63;text-decoration:underline;">info@s-consulting.ba</a> | <strong>W:</strong> <a href="https://www.s-consulting.ba/" target="_blank" rel="noopener noreferrer" style="color:#0f3d63;text-decoration:underline;">www.s-consulting.ba</a></p>',
  '<p style="margin:0;"><strong>A:</strong> Tvornička 3, Sarajevo</p>',
  '</div>'
].join('');

function escapePlainText(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '<br>');
}

function appendAutomaticSignature(body) {
  const source = body && typeof body === 'object' ? body : { contentType: 'Text', content: '' };
  const isHtml = String(source.contentType || '').toLowerCase() === 'html';
  const messageHtml = isHtml ? String(source.content || '') : escapePlainText(source.content);
  return {
    contentType: 'HTML',
    content: `${messageHtml}<br><br>${SIGNATURE_HTML}`
  };
}

module.exports = {
  SIGNATURE_HTML,
  SIGNATURE_LOGO_URL,
  SIGNATURE_MARKER,
  appendAutomaticSignature,
  escapePlainText
};
