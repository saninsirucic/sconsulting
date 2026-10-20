const { escapePlainText } = require('../outlookMail/signature');

const DISCLOSURE = 'This is a commercial advertisement from S-Consulting Group, based in Sarajevo, Bosnia and Herzegovina.';
const UNSUBSCRIBE = 'Unsubscribe: To stop all marketing emails from S-Consulting Group, reply with "unsubscribe" or send your request to sales@s-consulting.ba. No payment, account or explanation is required. We will honor your request within 10 business days.';
const POSTAL_ADDRESS = 'S-Consulting Group\nTvornička 3, Sarajevo, Bosnia and Herzegovina';
const PRODUCT_URL = 'https://www.s-consulting.ba/en/sanpest-platform';

// Keep required disclosures when an operator edits the offer. Reply requests
// still require a human to record the address in the global suppression list.
function usaCampaignBody(value) {
  let source = String(value || '').trim();
  if (!source.includes(DISCLOSURE)) source = `${DISCLOSURE}\n\n${source}`;
  if (!source.includes(UNSUBSCRIBE)) source += `\n\n${UNSUBSCRIBE}`;
  if (!source.includes(POSTAL_ADDRESS)) source += `\n\n${POSTAL_ADDRESS}`;
  let body = escapePlainText(source);
  body = body.split(PRODUCT_URL).join(`<a href="${PRODUCT_URL}">${PRODUCT_URL}</a>`);
  const unsubscribeLink = '<a href="mailto:sales@s-consulting.ba?subject=Unsubscribe">sales@s-consulting.ba</a>';
  body = body.split('sales@s-consulting.ba').join(unsubscribeLink);
  return { body, bodyType: 'html' };
}

module.exports = { DISCLOSURE, UNSUBSCRIBE, POSTAL_ADDRESS, usaCampaignBody };
