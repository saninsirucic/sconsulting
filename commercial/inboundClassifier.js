const sanitizeHtml = require('sanitize-html');
const { strictEmailAddress } = require('./email');

const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function emails(value) {
  return [...new Set((String(value || '').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [])
    .map(x => strictEmailAddress(x.replace(/[.,;]+$/, ''))).filter(Boolean))];
}
function plain(value, type) {
  if (String(type).toLowerCase() === 'text') return String(value || '').replace(/\r/g, '').trim();
  return sanitizeHtml(String(value || '').replace(/<(?:br\b[^>]*|\/(?:p|div|li|tr|h[1-6]))>/gi, '\n'), {
    allowedTags: [], allowedAttributes: {}
  }).replace(/&nbsp;|&#160;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').trim();
}
function newReply(message) {
  const source = message.uniqueBody?.content ? message.uniqueBody : message.body;
  let content = String(source?.content || message.bodyPreview || '');
  if (String(source?.contentType).toLowerCase() !== 'text') {
    content = content.split(/<blockquote\b|<[^>]+(?:class|id)\s*=\s*["'][^"']*(?:gmail_quote|divRplyFwdMsg|yahoo_quoted|moz-cite-prefix)/i)[0];
  }
  return plain(content, source?.contentType).split(/\n\s*(?:>{1,}|_{5,}|-{3,}\s*(?:Original|Forwarded|Izvorna|Proslijeđena)|(?:From|Od|Sent|Poslano|Šalje):\s|On .{0,250}wrote:|Dana .{0,250}(?:napisao|napisala)|Am .{0,250}schrieb)/i)[0]
    .split(/\n(?:--\s*$|_{5,})/m)[0].trim().slice(0, 20000);
}
function classify(message) {
  const headers = Object.fromEntries((message.internetMessageHeaders || []).map(h => [h.name.toLowerCase(), String(h.value)]));
  const sender = strictEmailAddress(message.from?.emailAddress?.address);
  const subject = String(message.subject || '').trim();
  const body = newReply(message), text = normalize(body), title = normalize(subject.replace(/^(?:(?:re|fw|fwd|odg|aw):\s*)+/i, ''));
  const automatic = /^auto-(?:replied|generated)(?:;|$)/i.test(headers['auto-submitted'] || '')
    || /^(?:bulk|list|junk|auto_reply)$/i.test(headers.precedence || '')
    || /^(?:yes|true|1)$/i.test(headers['x-autoreply'] || headers['x-autorespond'] || '')
    || Boolean(headers['list-id'] || headers['list-unsubscribe'])
    || /^(?:automatic reply|automatski odgovor|auto.?reply|out of office|abwesenheit)/i.test(subject);
  const bounce = /(?:postmaster|mailer-daemon|microsoftexchange)/i.test(sender || '')
    || /^(?:undeliver|delivery (?:status|failure)|mail delivery|failure notice|returned mail|non.?delivery)/i.test(subject);
  if (bounce || automatic) return { kind: bounce ? 'DELIVERY_NOTICE' : 'AUTOMATIC_REPLY', sender, text: body };
  // Only author-written requests count. Quoted footer, conditional guidance and
  // requests to keep receiving mail cannot create a marketing opt-out.
  const negative = /\b(?:do not|don.t|never)\s+(?:unsubscribe|remove)|\b(?:nemojte|ne zelim da|ne zelimo da)\b.{0,50}\b(?:odjav|uklon|bris)|\bkeep (?:me|us) (?:on|subscribed)|\bzelim(?:o)? (?:i dalje )?primati/.test(text);
  const lines = text.split(/\n/).filter(line => !/^(?:if you|to unsubscribe|unsubscribe: to|ako (?:zelite|ne zelite)|za odjavu|odjava:|this (?:message|email)|ova poruka|confidential)/.test(line.trim())).join('\n');
  const requestStart = lines.replace(/^(?:(?:hi|hello|dear (?:team|sir|madam)|postovani|pozdrav)[,!]?\s*\n\s*)/i, '').trim();
  const explicit = /^(?:unsubscribe|odjava|odjavi(?:te)?(?: me| nas)?|remove me|remove us)[.!\s]*$/.test(title)
    || /^(?:please )?unsubscribe[.!]?(?:\s*$|\s*\n)/.test(requestStart)
    || /(?:^|[\n.!?]\s*|\bplease\s+|\bmolim(?:o)?\s+(?:vas\s+)?)(?:unsubscribe(?: me| us)|odjavi(?:te)?(?: me| nas)?)(?:\b|$)/.test(lines)
    || /\b(?:zelim|zelimo) (?:se )?odjaviti\b/.test(lines)
    || /\b(?:remove|delete) (?:me|us|my (?:email|address)|our (?:company|email|address)) from (?:your |the |all )?(?:mailing |email |marketing |contact )?lists?\b/.test(lines)
    || /\b(?:uklonite|ukloniti|izbrisite|izbrisete|izbrisati|obrisite|obrisete|obrisati|skinite|skinete)\b.{0,90}\b(?:liste|spiska|baze|adresara)\b/.test(lines)
    || /\b(?:odjavite|odjaviti)\b.{0,50}\b(?:firmu|kompaniju|ustanovu|nas|me)\b/.test(lines)
    || /\b(?:do not|don.t|stop) (?:contact(?:ing)?|email(?:ing)?|send(?:ing)? (?:me |us )?(?:any |more )?(?:emails?|messages?))\b/.test(lines)
    || /\b(?:ne saljite|nemojte (?:nam |mi )?slati|prestanite (?:nam |mi )?slati|ne zelim(?:o)? (?:vise )?(?:primati|dobijati))\b/.test(lines)
    || /\b(?:bitte (?:abmelden|loschen)|keine weiteren (?:emails|e-mails)|bitte keine (?:werbung|emails|e-mails)|prosz[eę] (?:mnie |nas )?usun[aą][cć]|wypisz(?:cie)? mnie)\b/.test(lines);
  if (!negative && explicit) return { kind: 'UNSUBSCRIBE', sender, text: body };
  const needsReview = /\b(?:unsubscribe|odjav|abmelden|remove me|ne kontakt)/.test(text) || negative;
  return { kind: needsReview ? 'REPLY_REVIEW' : 'HUMAN_REPLY', sender, text: body };
}
module.exports = { classify, emails, newReply, plain };
