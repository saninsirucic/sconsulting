const { escapePlainText, buildSignatureHtml } = require('../outlookMail/signature');
const { UNSUBSCRIBE_URL } = require('./unsubscribe');

const DISCLOSURE = 'This is a commercial advertisement from S-Consulting Group, based in Sarajevo, Bosnia and Herzegovina.';
const LEGACY_UNSUBSCRIBE = 'Unsubscribe: To stop all marketing emails from S-Consulting Group, reply with "unsubscribe" or send your request to sales@s-consulting.ba. No payment, account or explanation is required. We will honor your request within 10 business days.';
const UNSUBSCRIBE = `Unsubscribe: To stop all marketing emails from S-Consulting Group, use our unsubscribe form: ${UNSUBSCRIBE_URL}\nRequests submitted through the form take effect immediately. You can also reply with "unsubscribe" or email sales@s-consulting.ba; we will honor these requests within 10 business days. No payment, account or explanation is required.`;
const POSTAL_ADDRESS = 'S-Consulting Group\nTvornička 3, Sarajevo, Bosnia and Herzegovina';
const PRODUCT_URL = 'https://www.s-consulting.ba/en/sanpest-platform';
const BANNER_CID = 'sanpest-usa-banner-20261020';

// Keep the working form and required disclosures even when the offer is edited.
// Reply requests still require a human to record the address in the suppression list.
function usaCampaignBody(value) {
  let source = String(value || '').trim().split(LEGACY_UNSUBSCRIBE).join(UNSUBSCRIBE);
  if (!source.includes(DISCLOSURE)) source = `${DISCLOSURE}\n\n${source}`;
  if (!source.includes(UNSUBSCRIBE)) source += `\n\n${UNSUBSCRIBE}`;
  if (!source.includes(POSTAL_ADDRESS)) source += `\n\n${POSTAL_ADDRESS}`;
  let body = source.split(/\r?\n\s*\r?\n/).map((paragraph) => {
    const lines = paragraph.split(/\r?\n/);
    const firstBullet = lines.findIndex((line) => /^•\s/.test(line));
    if (firstBullet >= 0 && lines.slice(firstBullet).every((line) => /^•\s/.test(line))) {
      const intro = lines.slice(0, firstBullet).join('\n');
      return `${intro ? `<p>${escapePlainText(intro)}</p>` : ''}<ul>${lines.slice(firstBullet).map((line) => `<li>${escapePlainText(line.replace(/^•\s*/, ''))}</li>`).join('')}</ul>`;
    }
    return `<p>${escapePlainText(paragraph)}</p>`;
  }).join('');
  body = body.split(PRODUCT_URL).join(`<a href="${PRODUCT_URL}">${PRODUCT_URL}</a>`);
  body = body.split(UNSUBSCRIBE_URL).join(`<a href="${UNSUBSCRIBE_URL}">Unsubscribe from all marketing emails</a>`);
  const unsubscribeLink = '<a href="mailto:sales@s-consulting.ba?subject=Unsubscribe">sales@s-consulting.ba</a>';
  body = body.split('sales@s-consulting.ba').join(unsubscribeLink);
  return { body, bodyType: 'html', layout: 'sanpest-usa' };
}

// Called only after the message body and editable signature have been sanitized.
// Layout CSS and the CID image come from server code, never from arbitrary HTML.
function renderUsaEmail(sanitizedBody, signature) {
  let content = sanitizedBody.replace(`<p>${DISCLOSURE}</p>`, '');
  const footerStart = content.indexOf('<p>Unsubscribe:');
  const footer = footerStart >= 0 ? content.slice(footerStart) : '';
  if (footerStart >= 0) content = content.slice(0, footerStart);
  const styled = (html) => html
    .replace(/<p>/g, '<p style="margin:0 0 18px;">')
    .replace(/<ul>/g, '<ul style="margin:0 0 22px;padding-left:22px;">')
    .replace(/<li>/g, '<li style="margin:0 0 8px;padding-left:3px;">');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f1f5f7;"><tr><td align="center" style="padding:24px 8px;">
    <table role="presentation" width="720" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:720px;background-color:#ffffff;border:1px solid #dce5ec;font-family:Arial,Helvetica,sans-serif;">
      <tr><td style="padding:12px 24px;font-size:12px;line-height:18px;color:#526474;background-color:#f7fafb;">${DISCLOSURE}</td></tr>
      <tr><td style="padding:0;"><a href="${PRODUCT_URL}" target="_blank" style="text-decoration:none;"><img src="cid:${BANNER_CID}" width="720" alt="SANpest — Your operation. Connected. Book a 20-minute demo." style="display:block;width:100%;max-width:720px;height:auto;border:0;"></a></td></tr>
      <tr><td style="padding:28px 28px 8px;color:#153047;font-size:16px;line-height:26px;">${styled(content)}</td></tr>
      <tr><td style="padding:0 28px 26px;">${buildSignatureHtml(signature)}</td></tr>
      <tr><td style="padding:22px 28px;background-color:#f1f6f8;border-top:1px solid #dce5ec;font-size:13px;line-height:21px;color:#40576a;">${styled(footer)}</td></tr>
    </table>
    </td></tr></table>`;
}

module.exports = { DISCLOSURE, UNSUBSCRIBE, LEGACY_UNSUBSCRIBE, POSTAL_ADDRESS, PRODUCT_URL, BANNER_CID, usaCampaignBody, renderUsaEmail };
