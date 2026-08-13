function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function limiterOptionsFromEnv(env = process.env) {
  const maxAttempts = boundedInteger(env.AUTH_LOGIN_MAX_ATTEMPTS, 5, 1, 100);
  const windowMinutes = boundedInteger(env.AUTH_LOGIN_WINDOW_MINUTES, 15, 1, 1440);
  const maxKeys = boundedInteger(env.AUTH_LOGIN_RATE_LIMIT_MAX_KEYS, 10000, 100, 100000);
  return { maxAttempts, windowMs: windowMinutes * 60 * 1000, maxKeys };
}

function normalizeLoginIp(req) {
  return String(
    (req && req.ip)
    || (req && req.socket && req.socket.remoteAddress)
    || (req && req.connection && req.connection.remoteAddress)
    || 'unknown'
  ).trim().toLowerCase();
}

function loginAttemptKey(req, username) {
  return JSON.stringify([
    String(username || '').trim().toLowerCase(),
    normalizeLoginIp(req)
  ]);
}

function createLoginAttemptLimiter(options = {}) {
  const maxAttempts = boundedInteger(options.maxAttempts, 5, 1, 100);
  const windowMs = boundedInteger(options.windowMs, 15 * 60 * 1000, 1000, 24 * 60 * 60 * 1000);
  const maxKeys = boundedInteger(options.maxKeys, 10000, 1, 100000);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const attempts = new Map();

  function pruneExpired(timestamp = now()) {
    for (const [key, entry] of attempts) {
      if (entry.expiresAt <= timestamp) attempts.delete(key);
    }
  }

  function enforceCapacity(timestamp) {
    pruneExpired(timestamp);
    while (attempts.size >= maxKeys) {
      let oldestKey;
      let oldestSeen = Infinity;
      for (const [key, entry] of attempts) {
        if (entry.lastSeenAt < oldestSeen) {
          oldestSeen = entry.lastSeenAt;
          oldestKey = key;
        }
      }
      if (oldestKey === undefined) break;
      attempts.delete(oldestKey);
    }
  }

  function stateFor(entry, timestamp) {
    if (!entry) return { blocked: false, failures: 0, retryAfterSeconds: 0 };
    const blocked = entry.failures >= maxAttempts && entry.expiresAt > timestamp;
    return {
      blocked,
      failures: entry.failures,
      retryAfterSeconds: blocked
        ? Math.max(1, Math.ceil((entry.expiresAt - timestamp) / 1000))
        : 0
    };
  }

  function check(key) {
    const timestamp = now();
    const entry = attempts.get(key);
    if (entry && entry.expiresAt <= timestamp) {
      attempts.delete(key);
      return stateFor(null, timestamp);
    }
    if (entry) entry.lastSeenAt = timestamp;
    return stateFor(entry, timestamp);
  }

  function recordFailure(key) {
    const timestamp = now();
    let entry = attempts.get(key);
    if (!entry || entry.expiresAt <= timestamp) {
      enforceCapacity(timestamp);
      entry = { failures: 0, expiresAt: timestamp + windowMs, lastSeenAt: timestamp };
      attempts.set(key, entry);
    }
    entry.failures += 1;
    entry.lastSeenAt = timestamp;
    return stateFor(entry, timestamp);
  }

  function clear(key) {
    attempts.delete(key);
  }

  return {
    check,
    clear,
    recordFailure,
    size() { pruneExpired(); return attempts.size; }
  };
}

function sendRateLimitResponse(res, state) {
  const retryAfterSeconds = Math.max(1, Number(state.retryAfterSeconds) || 1);
  res.set('Retry-After', String(retryAfterSeconds));
  return res.status(429).json({
    success: false,
    error: 'Previše neuspjelih pokušaja prijave. Pokušajte ponovo kasnije.',
    code: 'LOGIN_RATE_LIMITED',
    retryAfterSeconds
  });
}

module.exports = {
  createLoginAttemptLimiter,
  limiterOptionsFromEnv,
  loginAttemptKey,
  normalizeLoginIp,
  sendRateLimitResponse
};
