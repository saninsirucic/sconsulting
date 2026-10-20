const crypto = require('node:crypto');
const express = require('express');
const { strictEmailAddress } = require('./email');

const UNSUBSCRIBE_URL = 'https://radiant-beach-27998-21e0f72a6a44.herokuapp.com/unsubscribe';
const COOKIE = 'sconsult_unsubscribe';
const FORM_TTL = 48 * 60 * 60 * 1000;
const WAITING = ['PENDING', 'APPROVED', 'SCHEDULED', 'NOT_APPROVED', 'FAILED'];

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function page({ token = '', email = '', error = '', success = false } = {}) {
  const content = success
    ? `<div class="check" aria-hidden="true">&#10003;</div>
       <h1>Thank you. You're unsubscribed.</h1>
       <p>Your request has been saved. We have stopped marketing emails from S-Consulting Group to this email address.</p>
       <p class="muted">No further action is needed. Thank you for letting us know your preference.</p>`
    : `<span class="eyebrow">EMAIL PREFERENCES</span>
       <h1>Unsubscribe from marketing emails</h1>
       <p>Enter the email address that received our message. We will stop all marketing emails from S-Consulting Group to this address.</p>
       ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
       <form method="post" action="/unsubscribe">
         <input type="hidden" name="token" value="${escapeHtml(token)}">
         <label for="email">Email address</label>
         <input id="email" name="email" type="email" autocomplete="email" inputmode="email"
           spellcheck="false" maxlength="254" required placeholder="you@company.com" value="${escapeHtml(email)}">
         <button type="submit">Unsubscribe from all marketing emails</button>
       </form>
       <p class="muted">Your request takes effect immediately. No account, fee or explanation is required.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow">
    <title>${success ? "You're unsubscribed" : 'Unsubscribe'} | S-Consulting Group</title>
    <style>
      *{box-sizing:border-box}body{margin:0;background:#f2f6f5;color:#182f32;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
      main{max-width:610px;margin:8vh auto;padding:0 20px}.brand{font-size:17px;font-weight:700;letter-spacing:.02em;margin:0 0 25px;color:#155c55}
      .card{background:#fff;border:1px solid #dce7e4;border-radius:20px;padding:38px;box-shadow:0 12px 40px #133f3510}
      .eyebrow{font-size:12px;font-weight:700;letter-spacing:.14em;color:#397269}h1{font-size:30px;line-height:1.2;letter-spacing:-.025em;margin:14px 0 20px}
      p{margin:0 0 22px}form{margin:28px 0 22px}label{display:block;font-weight:600;margin-bottom:8px}
      input[type=email]{width:100%;padding:14px;border:1px solid #92aaa4;border-radius:8px;font:inherit;color:inherit;background:white}
      button{width:100%;margin-top:18px;padding:15px 18px;border:0;border-radius:8px;background:#155c55;color:white;font:600 16px/1.4 system-ui;cursor:pointer}
      button:hover{background:#104a44}input:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid #418de0;outline-offset:3px}
      .muted,footer{font-size:14px;color:#546c66}.muted:last-child{margin-bottom:0}footer{margin-top:24px}a{color:#155c55;overflow-wrap:anywhere}
      .error{padding:12px 14px;border-radius:8px;background:#fff1ee;color:#8b2d19}.check{display:grid;place-items:center;width:54px;height:54px;border-radius:50%;background:#e4f3ec;color:#155c55;font-size:28px}
      @media(max-width:480px){main{margin:28px auto}.card{padding:25px}h1{font-size:27px}}
    </style></head><body><main><div class="brand">S-Consulting Group</div>
    <section class="card">${content}</section>
    <footer>Need help? You can also request an unsubscribe by emailing
      <a href="mailto:sales@s-consulting.ba?subject=Unsubscribe">sales@s-consulting.ba</a>.</footer>
    </main></body></html>`;
}

// This record is global: imports, new campaigns, primary recipients and CC checks
// all consult the same suppression list. Repeated requests preserve the first record.
async function unsubscribeAddress(db, value) {
  const email = strictEmailAddress(value);
  if (!email) throw Object.assign(new Error('Please enter a valid email address.'), { status: 400 });
  const now = new Date();
  await db.transaction(async (trx) => {
    await trx('email_suppression_list').insert({
      id: crypto.randomUUID(), email, email_normalized: email,
      reason: 'UNSUBSCRIBED', source: 'PUBLIC_UNSUBSCRIBE_FORM',
      notes: 'Recipient requested an opt-out from all S-Consulting Group marketing emails.',
      created_by: 'public-unsubscribe', created_at: now
    }).onConflict('email_normalized').ignore();

    const contacts = await trx('email_contacts').whereRaw('LOWER(TRIM(email_normalized)) = ?', [email]).select('id');
    if (contacts.length) {
      const ids = contacts.map((contact) => contact.id);
      await trx('email_contacts').whereIn('id', ids).update({
        sending_allowed: false, suppression_reason: 'UNSUBSCRIBED', updated_at: now
      });
      await trx('email_followups').whereIn('contact_id', ids).where({ status: 'SCHEDULED' }).update({
        status: 'CANCELLED', cancel_reason: 'SUPPRESSED', updated_at: now
      });
    }

    const queued = await trx('crm_mail_queue').whereIn('status', WAITING)
      .select('id', 'recipient_email', 'cc_emails_json');
    const ids = queued.filter((row) => {
      if (strictEmailAddress(row.recipient_email) === email) return true;
      let cc = [];
      try { cc = JSON.parse(row.cc_emails_json || '[]'); } catch (_) { /* Send validation rejects corrupt CC. */ }
      return Array.isArray(cc) && cc.some((value) => strictEmailAddress(value) === email);
    }).map((row) => row.id);
    for (let offset = 0; offset < ids.length; offset += 100) {
      // Never rewrite an item already claimed by a concurrent sender.
      await trx('crm_mail_queue').whereIn('id', ids.slice(offset, offset + 100)).whereIn('status', WAITING).update({
        status: 'SKIPPED', last_error: 'UNSUBSCRIBED: recipient requested no marketing emails.', updated_at: now
      });
    }
  });
  return email;
}

async function assertRecipientsNotSuppressed(db, recipients) {
  const emails = [...new Set(recipients.map((recipient) => strictEmailAddress(recipient)).filter(Boolean))];
  if (!emails.length) return;
  const suppressed = await db('email_suppression_list').whereIn('email_normalized', emails).first('id');
  if (suppressed) {
    throw Object.assign(new Error('Jedna od adresa primalaca je na listi zabrane slanja.'), {
      status: 409, code: 'RECIPIENT_SUPPRESSED'
    });
  }
}

function createUnsubscribeRouter({ db, env = process.env, now = Date.now } = {}) {
  const router = express.Router();
  const secret = env.UNSUBSCRIBE_FORM_SECRET || env.JWT_SECRET;
  if (!secret && env.NODE_ENV === 'production') throw new Error('Unsubscribe form signing secret is required.');
  const key = crypto.createHmac('sha256', secret || crypto.randomBytes(32)).update('unsubscribe-form-v1').digest();
  const sign = (value) => crypto.createHmac('sha256', key).update(value).digest('base64url');
  const attempts = new Map();

  router.use((req, res, next) => {
    res.set({
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    });
    next();
  });
  function form(req, res, status = 200, error = '', email = '') {
    const nonce = crypto.randomBytes(24).toString('base64url');
    const value = `${now()}.${nonce}`;
    res.cookie(COOKIE, nonce, {
      httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'strict',
      path: '/unsubscribe', maxAge: FORM_TTL
    });
    return res.status(status).type('html').send(page({ token: `${value}.${sign(value)}`, error, email }));
  }
  function validToken(req) {
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const [issued, nonce, signature, extra] = token.split('.');
    if (!issued || !nonce || !signature || extra || token.length > 200) return false;
    const age = now() - Number(issued);
    if (!Number.isFinite(age) || age < 0 || age > FORM_TTL) return false;
    const cookie = String(req.headers.cookie || '').split(';').map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`));
    if (cookie !== `${COOKIE}=${nonce}`) return false;
    const expected = Buffer.from(sign(`${issued}.${nonce}`));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }
  // GET and HEAD only display the form: email security scanners cannot unsubscribe.
  router.get('/', (req, res) => form(req, res));
  router.post('/', express.urlencoded({ extended: false, limit: '4kb', parameterLimit: 5 }), async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email : '';
    if (!validToken(req)) return form(req, res, 400, 'Please submit this refreshed form to save your request.', email);
    const time = now();
    for (const [ip, entry] of attempts) if (entry.until <= time) attempts.delete(ip);
    const ip = req.ip;
    const entry = attempts.get(ip) || { count: 0, until: time + 60 * 60 * 1000 };
    if (entry.count >= 60) {
      res.set('Retry-After', String(Math.ceil((entry.until - time) / 1000)));
      return form(req, res, 429, 'Too many requests. Please try again later or email sales@s-consulting.ba.', email);
    }
    entry.count += 1;
    if (attempts.size < 10000 || attempts.has(ip)) attempts.set(ip, entry);
    if (!strictEmailAddress(email)) return form(req, res, 400, 'Please enter a valid email address.', email);
    try {
      await unsubscribeAddress(db, email);
      return res.type('html').send(page({ success: true }));
    } catch (_) {
      // Never show a success page until the entire suppression transaction commits.
      return form(req, res, 503, 'We could not save your request. Please try again or email sales@s-consulting.ba.', email);
    }
  });
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    return form(req, res, error.status === 413 ? 413 : 400, 'Please submit a valid email address using this form.');
  });
  return router;
}

module.exports = { UNSUBSCRIBE_URL, createUnsubscribeRouter, unsubscribeAddress, assertRecipientsNotSuppressed };
