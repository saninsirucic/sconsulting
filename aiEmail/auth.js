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

async function authenticateCredentials(username, password) {
  const normalizedUsername = String(username || '').trim().toLowerCase();
  const user = getConfiguredUsers().find(
    (candidate) => candidate.active !== false
      && String(candidate.username || '').toLowerCase() === normalizedUsername
  );

  if (!user || !user.passwordHash || !password) return null;
  const passwordMatches = await bcrypt.compare(String(password), user.passwordHash);
  if (!passwordMatches) return null;

  return {
    id: String(user.id),
    username: user.username,
    role: user.role || 'komercijala'
  };
}

function createAccessToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
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
      role: payload.role
    };
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Prijava je istekla ili nije važeća.' });
  }
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
  createAccessToken,
  getConfiguredUsers
};

