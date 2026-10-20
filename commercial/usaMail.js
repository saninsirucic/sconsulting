const { escapePlainText } = require('../outlookMail/signature');
const { UNSUBSCRIBE_URL } = require('./unsubscribe');

const DISCLOSURE = 'This is a commercial advertisement from S-Consulting Group, based in Sarajevo, Bosnia and Herzegovina.';
const LEGACY_UNSUBSCRIBE = 'Unsubscribe: To stop all marketing emails from S-Consulting Group, reply with "unsubscribe" or send your request to sales@s-consulting.ba. No payment, account or explanation is required. We will honor your request within 10 business days.';
const UNSUBSCRIBE = `Unsubscribe: To stop all marketing emails from S-Consulting Group, use our unsubscribe form: ${UNSUBSCRIBE_URL}\nRequests submitted through the form take effect immediately. You can also reply with "unsubscribe" or email sales@s-consulting.ba; we will honor these requests within 10 business days. No payment, account or explanation is required.`;
const POSTAL_ADDRESS = 'S-Consulting Group\nTvornička 3, Sarajevo, Bosnia and Herzegovina';
const PRODUCT_URL = 'https://www.s-consulting.ba/en/sanpest-platform';

// Keep the working form and required disclosures even when the offer is edited.
// Reply requests still require a human to record the address in the suppression list.
function usaCampaignBody(value) {
  let source = String(value || '').trim().split(LEGACY_UNSUBSCRIBE).join(UNSUBSCRIBE);
  if (!source.includes(DISCLOSURE)) source = `${DISCLOSURE}\n\n${source}`;
  if (!source.includes(UNSUBSCRIBE)) source += `\n\n${UNSUBSCRIBE}`;
  if (!source.includes(POSTAL_ADDRESS)) source += `\n\n${POSTAL_ADDRESS}`;
  let body = escapePlainText(source);
  body = body.split(PRODUCT_URL).join(`<a href="${PRODUCT_URL}">${PRODUCT_URL}</a>`);
  body = body.split(UNSUBSCRIBE_URL).join(`<a href="${UNSUBSCRIBE_URL}">Unsubscribe from all marketing emails</a>`);
  const unsubscribeLink = '<a href="mailto:sales@s-consulting.ba?subject=Unsubscribe">sales@s-consulting.ba</a>';
  body = body.split('sales@s-consulting.ba').join(unsubscribeLink);
  return { body, bodyType: 'html' };
}

module.exports = { DISCLOSURE, UNSUBSCRIBE, LEGACY_UNSUBSCRIBE, POSTAL_ADDRESS, usaCampaignBody };
