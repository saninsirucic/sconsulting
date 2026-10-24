const { DEFAULT_SIGNATURE } = require('./signature');

const DEFAULT_MAILBOX = 'sales@s-consulting.ba';
const PUBLIC_INSTITUTIONS_MAILBOX = 'prodaja@s-consulting.ba';
const SUPPORTED_MAILBOXES = Object.freeze([DEFAULT_MAILBOX, PUBLIC_INSTITUTIONS_MAILBOX]);

function normalizeMailbox(value) {
  return String(value || '').trim().toLowerCase();
}

function userMailbox(user) {
  return normalizeMailbox(user?.outlookMailbox || user?.outlook_mailbox) || DEFAULT_MAILBOX;
}

function brandMailbox(brand) {
  return normalizeMailbox(brand?.mailbox_address) || DEFAULT_MAILBOX;
}

function assertBrandMailboxAccess(brand, user) {
  if (brandMailbox(brand) === DEFAULT_MAILBOX) return;
  if (userMailbox(user) !== brandMailbox(brand)) {
    throw Object.assign(new Error('Slanje iz ovog sandučića dostupno je samo povezanom profilu.'), {
      status: 403, code: 'BRAND_MAILBOX_ACCESS_DENIED'
    });
  }
}

function defaultSignatureForMailbox(mailbox) {
  return mailbox === PUBLIC_INSTITUTIONS_MAILBOX ? {
    ...DEFAULT_SIGNATURE,
    name: 'S-Consulting',
    title: 'Javne ustanove',
    mobile: '',
    email: PUBLIC_INSTITUTIONS_MAILBOX
  } : undefined;
}

module.exports = {
  DEFAULT_MAILBOX, PUBLIC_INSTITUTIONS_MAILBOX, SUPPORTED_MAILBOXES,
  normalizeMailbox, userMailbox, brandMailbox, assertBrandMailboxAccess, defaultSignatureForMailbox
};
