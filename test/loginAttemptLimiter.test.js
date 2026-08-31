const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createLoginAttemptLimiter,
  limiterOptionsFromEnv,
  loginAttemptKey,
  sendRateLimitResponse
} = require('../security/loginAttemptLimiter');

test('login ključ normalizuje korisničko ime i kombinuje ga sa IP adresom', () => {
  const first = loginAttemptKey({ ip: '::FFFF:192.0.2.10' }, '  Komercijala ');
  const second = loginAttemptKey({ ip: '::ffff:192.0.2.10' }, 'komercijala');
  const otherIp = loginAttemptKey({ ip: '192.0.2.11' }, 'komercijala');
  assert.equal(first, second);
  assert.notEqual(first, otherIp);
});

test('peti neuspjeh blokira prijavu 15 minuta sa 429 i Retry-After, a uspjeh briše stanje', () => {
  let timestamp = 1_000_000;
  const limiter = createLoginAttemptLimiter({
    maxAttempts: 5,
    windowMs: 15 * 60 * 1000,
    maxKeys: 100,
    now: () => timestamp
  });
  const key = '["komercijala","192.0.2.10"]';
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const state = limiter.recordFailure(key);
    assert.equal(state.blocked, false);
    assert.equal(state.failures, attempt);
  }
  const blocked = limiter.recordFailure(key);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.failures, 5);
  assert.equal(blocked.retryAfterSeconds, 900);

  const response = {
    statusCode: null,
    headers: {},
    payload: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
  sendRateLimitResponse(response, blocked);
  assert.equal(response.statusCode, 429);
  assert.equal(response.headers['Retry-After'], '900');
  assert.equal(response.payload.code, 'LOGIN_RATE_LIMITED');

  // Login ruta poziva clear nakon uspješne autentikacije.
  limiter.clear(key);
  assert.equal(limiter.check(key).blocked, false);
  assert.equal(limiter.check(key).failures, 0);

  limiter.recordFailure(key);
  timestamp += 15 * 60 * 1000;
  assert.equal(limiter.check(key).failures, 0);
});

test('limiter ostaje memorijski ograničen i env vrijednosti su bounded', () => {
  let timestamp = 1;
  const limiter = createLoginAttemptLimiter({
    maxAttempts: 5,
    windowMs: 1000,
    maxKeys: 2,
    now: () => timestamp
  });
  limiter.recordFailure('a');
  timestamp += 1;
  limiter.recordFailure('b');
  timestamp += 1;
  limiter.recordFailure('c');
  assert.equal(limiter.size(), 2);
  assert.equal(limiter.check('a').failures, 0);

  assert.deepEqual(limiterOptionsFromEnv({
    AUTH_LOGIN_MAX_ATTEMPTS: '7',
    AUTH_LOGIN_WINDOW_MINUTES: '20',
    AUTH_LOGIN_RATE_LIMIT_MAX_KEYS: '500'
  }), { maxAttempts: 7, windowMs: 20 * 60 * 1000, maxKeys: 500 });
});
