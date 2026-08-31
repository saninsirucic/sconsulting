function strictEmailAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  const parts = address.split('@');
  const local = parts[0] || '';
  const domain = parts[1] || '';
  const labels = domain.split('.');
  const validLocal = local.length <= 64
    && /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)
    && !local.startsWith('.')
    && !local.endsWith('.')
    && !local.includes('..');
  const validDomain = domain.length <= 253
    && labels.length >= 2
    && labels.every((label) => label.length >= 1
      && label.length <= 63
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
  return address.length <= 254 && parts.length === 2 && validLocal && validDomain ? address : null;
}

module.exports = { strictEmailAddress };
