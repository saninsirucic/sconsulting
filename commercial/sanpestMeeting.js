const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { createGraphClient } = require('../outlookMail/graphClient');

const ROOT = '/sanpest-sastanak';
const TABLE = 'sanpest_meeting_requests';
const escape = (s) => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function validate(body) {
  const data = Object.fromEntries(['name', 'phone', 'company', 'comment'].map(k => [k, typeof body[k] === 'string' ? body[k].trim() : '']));
  const errors = [];
  if (!data.name || data.name.length > 120 || /[\x00-\x1f\x7f]/.test(data.name)) errors.push('Upišite ime i prezime (do 120 znakova).');
  if (!data.company || data.company.length > 160 || /[\x00-\x1f\x7f]/.test(data.company)) errors.push('Upišite naziv firme (do 160 znakova).');
  const digits = data.phone.replace(/\D/g, '');
  if (!/^\+?[0-9 ()/.-]+$/.test(data.phone) || data.phone.length > 40 || digits.length < 6 || digits.length > 15) errors.push('Upišite ispravan broj telefona.');
  if (data.comment.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(data.comment)) errors.push('Komentar može sadržavati do 2.000 znakova.');
  if (body.interested !== 'yes') errors.push('Označite interes za online sastanak.');
  if (body.website) errors.push('Zahtjev nije poslan. Osvježite stranicu i pokušajte ponovo.');
  return { data, errors };
}

function createSanpestMeetingRouter({ db, env = process.env, notify }) {
  const router = express.Router();
  const secret = env.SANPEST_FORM_SECRET || env.JWT_SECRET;
  if (!secret) throw Error('SANpest form signing secret is missing');
  const template = fs.readFileSync(path.join(__dirname, 'assets/sanpest-meeting.html'), 'utf8');
  const sign = v => crypto.createHmac('sha256', secret).update(v).digest('base64url');
  const issue = () => { const p = crypto.randomUUID() + '.' + Date.now(); return p + '.' + sign(p); };
  function verify(token) {
    if (typeof token !== 'string' || token.length > 200) return null;
    const p = token.split('.');
    if (p.length !== 3 || !/^[0-9a-f-]{36}$/.test(p[0]) || !/^\d{13}$/.test(p[1])) return null;
    const age = Date.now() - Number(p[1]);
    const expected = Buffer.from(sign(p[0] + '.' + p[1])); const received = Buffer.from(p[2]);
    if (age < 0 || age > 24 * 3600000 || expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return null;
    return p[0];
  }
  const attempts = new Map();
  function page(res, { token = issue(), data = {}, errors = [], success = false, status = 200 } = {}) {
    let html = template;
    const form = success ? `<div class="success" role="status"><span class="success-icon">✓</span><p class="eyebrow">ZAHTJEV JE ZAPRIMLJEN</p><h2>Hvala na interesu.</h2><p>Javit ćemo vam se na ostavljeni broj telefona da dogovorimo termin online prezentacije SANpest aplikacije.</p><p class="small">Termin još nije rezervisan. Dogovorit ćemo ga zajedno s vama.</p><a class="button" href="https://www.s-consulting.ba/sanpest-platform">Više o SANpest platformi ↗</a></div>` : `<p class="eyebrow">POGLEDAJTE APLIKACIJU U RADU</p><h2>Dogovorimo online prezentaciju.</h2><p class="form-intro">Ostavite kontakt i javit ćemo vam se radi dogovora termina. Kratko, konkretno i prilagođeno vašoj firmi.</p>${errors.length ? `<div class="error" role="alert">${errors.map(e => `<p>${escape(e)}</p>`).join('')}</div>` : ''}<form method="post" action="${ROOT}#zahtjev"><input type="hidden" name="token" value="${escape(token)}"><div class="trap" aria-hidden="true"><label>Ostavite prazno<input name="website" tabindex="-1" autocomplete="off"></label></div><label for="name">Ime i prezime <span>*</span></label><input id="name" name="name" autocomplete="name" maxlength="120" required value="${escape(data.name)}" placeholder="Vaše ime i prezime"><div class="fields"><div><label for="phone">Telefon <span>*</span></label><input id="phone" name="phone" type="tel" autocomplete="tel" maxlength="40" required value="${escape(data.phone)}" placeholder="+387 ..."></div><div><label for="company">Naziv firme <span>*</span></label><input id="company" name="company" autocomplete="organization" maxlength="160" required value="${escape(data.company)}" placeholder="Naziv vaše firme"></div></div><label for="comment">Komentar <span class="optional">— neobavezno</span></label><textarea id="comment" name="comment" rows="3" maxlength="2000" placeholder="Šta biste željeli vidjeti u aplikaciji? Možete navesti i željeni termin.">${escape(data.comment)}</textarea><label class="check"><input type="checkbox" name="interested" value="yes" required ${data.interested === 'yes' ? 'checked' : ''}><span>Zainteresovan/a sam za <strong>online sastanak i prezentaciju SANpest aplikacije.</strong></span></label><button class="button" type="submit">Pošalji interes za online sastanak <span aria-hidden="true">↗</span></button><p class="privacy">Podatke koristimo za odgovor na ovaj zahtjev i dogovor sastanka. Slanje ne predstavlja rezervaciju termina niti obavezu kupovine.</p></form>`;
    html = html.replace('<!-- FORM -->', form);
    return res.status(status).type('html').send(html);
  }
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" }); next();
  });
  router.get('/app.jpg', (req, res) => res.sendFile(path.join(__dirname, 'assets/sanpest-newsletter-app.jpg')));
  router.get('/logo.png', (req, res) => res.sendFile(path.join(__dirname, 'assets/sanpest-newsletter-logo.png')));
  router.get('/', (req, res) => page(res));
  router.post('/', express.urlencoded({ extended: false, limit: '12kb' }), async (req, res) => {
    const origin = req.get('origin');
    if (origin && origin !== `${req.protocol}://${req.get('host')}`) return page(res, { errors: ['Osvježite obrazac i pokušajte ponovo.'], status: 403 });
    const body = req.body || {}; const id = verify(body.token);
    const { data, errors } = validate(body);
    if (!id) errors.push('Obrazac je istekao. Provjerite podatke i pošaljite ponovo.');
    if (errors.length) return page(res, { token: id ? body.token : issue(), data: { ...data, interested: body.interested }, errors, status: 400 });
    const ip = req.ip; const now = Date.now();
    for (const [key, item] of attempts) if (item.until < now) attempts.delete(key);
    const item = attempts.get(ip) || { until: now + 600000, count: 0 };
    if (item.count >= 6 || attempts.size > 10000) return page(res, { data, errors: ['Previše pokušaja. Pokušajte za deset minuta ili nas pozovite.'], status: 429 });
    item.count++; attempts.set(ip, item);
    try {
      const inserted = await db(TABLE).insert({ id, ...data, meeting_format: 'online', status: 'NEW', notification_status: 'PENDING' }).onConflict('id').ignore().returning('id');
      if (inserted.length) {
        try {
          const text = ['Nova prijava za SANpest online prezentaciju', '', `Ime i prezime: ${data.name}`, `Telefon: ${data.phone}`, `Naziv firme: ${data.company}`, 'Format sastanka: isključivo ONLINE', 'Interes za online sastanak: DA', '', 'Komentar:', data.comment || '(bez komentara)', '', `ID zahtjeva: ${id}`, 'Izvor: SANpest newsletter /sanpest-sastanak'].join('\n');
          if (notify) await notify({ id, data, text });
          else {
            const graph = createGraphClient({ env, mailbox: 'sales@s-consulting.ba' });
            await graph.request(graph.mailboxPath('/sendMail'), { method: 'POST', idempotent: false, body: { message: { subject: `SANpest | Online prezentacija — ${data.company}`, body: { contentType: 'Text', content: text }, toRecipients: [{ emailAddress: { address: 'info@s-consulting.ba' } }] }, saveToSentItems: true } });
          }
          await db(TABLE).where({ id }).update({ notification_status: 'SENT' });
        } catch {
          await db(TABLE).where({ id }).update({ notification_status: 'REVIEW_REQUIRED' });
          console.error('SANpest request saved; notification requires review:', id);
        }
      }
      return page(res, { success: true });
    } catch {
      return page(res, { token: body.token, data: { ...data, interested: body.interested }, errors: ['Zahtjev nije sačuvan. Pokušajte ponovo ili nas pozovite na +387 62 528 870.'], status: 503 });
    }
  });
  return router;
}
module.exports = { createSanpestMeetingRouter, validate };
