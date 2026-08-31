const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const DEVELOPMENT_PASSWORD_HASH = '$2b$10$4bmJNbqSbjzCpnvmvPfpr.tyGaGkEh6ePSskKHC3AudDqDr5fo01W';

function getJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is required in production');
  }
  return 'sconsulting-development-only-secret';
}

function getConfiguredUsers() {
  if (process.env.AUTH_USERS_JSON) {
    const users = JSON.parse(process.env.AUTH_USERS_JSON);
    if (!Array.isArray(users)) throw new Error('AUTH_USERS_JSON must be a JSON array');
    return users;
  }

  if (process.env.NODE_ENV === 'production') return [];

  return [
    {
      id: 'local-admin',
      username: 'admin',
      passwordHash: DEVELOPMENT_PASSWORD_HASH,
      role: 'direktor',
      active: true
    },
    {
      id: 'local-sanin',
      username: 'sanin',
      passwordHash: DEVELOPMENT_PASSWORD_HASH,
      role: 'direktor',
      active: true
    }
  ];
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function publicUser(user, authSource) {
  return {
    id: String(user.id),
    username: user.username,
    displayName: user.display_name || user.displayName || user.username,
    email: user.email || null,
    role: user.role || 'komercijala',
    mustChangePassword: Boolean(user.must_change_password ?? user.mustChangePassword),
    tokenVersion: Number(user.token_version ?? user.tokenVersion ?? 0),
    authSource: authSource || user.authSource || 'env'
  };
}

async function hasDbUsers(db) {
  return Boolean(db && db.schema && await db.schema.hasTable('app_users'));
}

async function findDbUserByUsername(db, normalizedUsername) {
  if (!await hasDbUsers(db)) return null;
  return db('app_users').where({ username_normalized: normalizedUsername }).first();
}

async function authenticateCredentials(db, username, password) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || !password) return null;

  const dbUser = await findDbUserByUsername(db, normalizedUsername);
  if (dbUser) {
    if (!dbUser.active || !dbUser.password_hash) return null;
    const passwordMatches = await bcrypt.compare(String(password), dbUser.password_hash);
    if (!passwordMatches) return null;
    await db('app_users').where({ id: dbUser.id }).update({ last_login_at: new Date() });
    return publicUser(dbUser, 'db');
  }

  const user = getConfiguredUsers().find(
    (candidate) => candidate.active !== false
      && normalizeUsername(candidate.username) === normalizedUsername
  );
  if (!user || !user.passwordHash) return null;
  const passwordMatches = await bcrypt.compare(String(password), user.passwordHash);
  return passwordMatches ? publicUser(user, 'env') : null;
}

function createAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      mustChangePassword: Boolean(user.mustChangePassword),
      tokenVersion: Number(user.tokenVersion || 0),
      authSource: user.authSource || 'env'
    },
    getJwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
}

function authenticateRequest(req, res, next) {
  const authorization = req.get('authorization') || '';
  const [scheme, token] = authorization.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Potrebna je prijava.' });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());
    req.user = {
      id: String(payload.sub),
      username: payload.username,
      role: payload.role,
      mustChangePassword: Boolean(payload.mustChangePassword),
      tokenVersion: Number(payload.tokenVersion || 0),
      authSource: payload.authSource || null
    };
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Prijava je istekla ili nije važeća.' });
  }
}

function refreshAuthenticatedUser(db) {
  return async (req, res, next) => {
    try {
      if (await hasDbUsers(db)) {
        const dbUser = await db('app_users').where({ id: req.user.id }).first();
        if (dbUser) {
          if (!dbUser.active) return res.status(401).json({ error: 'Korisnički nalog nije aktivan.' });
          if (Number(dbUser.token_version || 0) !== Number(req.user.tokenVersion || 0)) {
            return res.status(401).json({
              error: 'Prijava više nije važeća. Prijavite se ponovo.',
              code: 'TOKEN_REVOKED'
            });
          }
          req.user = publicUser(dbUser, 'db');
          return next();
        }
      }

      const configured = getConfiguredUsers().find(
        (candidate) => String(candidate.id) === String(req.user.id) && candidate.active !== false
      );
      if (!configured) return res.status(401).json({ error: 'Korisnički nalog više nije dostupan.' });
      req.user = publicUser(configured, 'env');
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

function requirePasswordChangeCompleted(req, res, next) {
  if (req.user && req.user.mustChangePassword) {
    return res.status(403).json({
      error: 'Prije nastavka morate promijeniti početnu lozinku.',
      code: 'PASSWORD_CHANGE_REQUIRED'
    });
  }
  return next();
}

function validateNewPassword(password) {
  const value = String(password || '');
  if (value.length < 10 || !/[A-Za-zČĆŽŠĐčćžšđ]/.test(value) || !/\d/.test(value)) {
    throw Object.assign(new Error('Nova lozinka mora imati najmanje 10 znakova, slovo i broj.'), { status: 400 });
  }
  return value;
}

async function changePassword(db, user, currentPassword, newPassword) {
  if (!db || !await hasDbUsers(db)) {
    throw Object.assign(new Error('Promjena lozinke trenutno nije dostupna.'), { status: 503 });
  }
  const existing = await db('app_users').where({ id: user.id, active: true }).first();
  if (!existing || user.authSource === 'env') {
    throw Object.assign(new Error('Lozinku ovog naloga administrira konfiguracija servera.'), { status: 409 });
  }
  const currentMatches = await bcrypt.compare(String(currentPassword || ''), existing.password_hash);
  if (!currentMatches) {
    throw Object.assign(new Error('Trenutna lozinka nije ispravna.'), { status: 400 });
  }
  const validated = validateNewPassword(newPassword);
  if (await bcrypt.compare(validated, existing.password_hash)) {
    throw Object.assign(new Error('Nova lozinka mora biti drugačija od trenutne.'), { status: 400 });
  }
  const configuredRounds = Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
  const rounds = Number.isFinite(configuredRounds) ? Math.min(15, Math.max(4, configuredRounds)) : 12;
  const passwordHash = await bcrypt.hash(validated, rounds);
  const now = new Date();
  await db('app_users').where({ id: existing.id }).update({
    password_hash: passwordHash,
    must_change_password: false,
    password_changed_at: now,
    token_version: db.raw('COALESCE(??, 0) + 1', ['token_version']),
    updated_at: now
  });
  const updated = await db('app_users').where({ id: existing.id }).first();
  return publicUser(updated, 'db');
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Nemate dozvolu za ovu akciju.' });
    }
    return next();
  };
}

module.exports = {
  allowRoles,
  authenticateCredentials,
  authenticateRequest,
  changePassword,
  createAccessToken,
  getConfiguredUsers,
  normalizeUsername,
  publicUser,
  refreshAuthenticatedUser,
  requirePasswordChangeCompleted,
  validateNewPassword
};
