const { UNSUBSCRIBE_URL } = require('./unsubscribe');
const HACCP_UNSUBSCRIBE_URL = UNSUBSCRIBE_URL + '?lang=bs';
const FOOTER = 'Ako ne želite primati naše promotivne poruke, odjavite se putem obrasca: ' + HACCP_UNSUBSCRIBE_URL + '\nOdjava vrijedi za sve naredne marketinške kampanje S-Consultinga. Možete i odgovoriti na ovaj mail sa zahtjevom za odjavu.';
function withHaccpUnsubscribe(body, type = 'text') {
  const source = String(body || '').trim();
  if (source.includes(UNSUBSCRIBE_URL)) return source;
  if (String(type).toLowerCase() !== 'html') return source + '\n\n' + FOOTER;
  const footer = `<div data-sconsult-unsubscribe="true" style="margin-top:24px;padding-top:14px;border-top:1px solid #dce7e4;font:12px/1.5 Arial,sans-serif;color:#546c66">Ako ne želite primati naše promotivne poruke, <a href="${HACCP_UNSUBSCRIBE_URL}">odjavite se ovdje</a>. Odjava vrijedi za sve naredne marketinške kampanje S-Consultinga. Možete i odgovoriti na ovaj mail sa zahtjevom za odjavu.</div>`;
  return /<\/body>/i.test(source) ? source.replace(/<\/body>/i, footer + '</body>') : source + footer;
}
module.exports = { FOOTER, HACCP_UNSUBSCRIBE_URL, withHaccpUnsubscribe };
