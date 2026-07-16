const express = require('express');
const { authenticateCredentials, createAccessToken } = require('./aiEmail/auth');

const router = express.Router();

// Zadržano radi kompatibilnosti ako se ovaj router kasnije montira zasebno.
router.post('/login', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) {
    return res.status(400).json({ error: 'Korisničko ime i lozinka su obavezni.' });
  }

  try {
    const user = await authenticateCredentials(username, password);
    if (!user) return res.status(401).json({ error: 'Pogrešno korisničko ime ili lozinka.' });
    return res.json({ token: createAccessToken(user), user });
  } catch (error) {
    return res.status(503).json({ error: 'Prijava trenutno nije dostupna.' });
  }
});

module.exports = router;
