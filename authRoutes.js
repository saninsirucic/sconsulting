const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');

const router = express.Router();

// Privremena baza korisnika (kasnije ćeš ovo iz baze)
const users = [
  { id: 1, username: 'samir', password: bcrypt.hashSync('pass123', 8), role: 'direktor' },
  { id: 2, username: 'selma', password: bcrypt.hashSync('selma123', 8), role: 'komercijala' },
  { id: 3, username: 'izvodjac1', password: bcrypt.hashSync('izvo123', 8), role: 'izvodjac' }
];

// Ruta za login
router.post(
  '/login',
  body('username').notEmpty(),
  body('password').notEmpty(),
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { username, password } = req.body;
    const user = users.find(u => u.username === username);

    if (!user) return res.status(400).json({ message: 'Neispravno korisničko ime' });

    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Neispravna lozinka' });

    const token = jwt.sign({ id: user.id, role: user.role }, 'tajna_lozinka', { expiresIn: '1h' });

    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  }
);

module.exports = router;
