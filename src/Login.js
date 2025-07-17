import React, { useState } from 'react';

const BACKEND_URL = "https://radiant-beach-27998-21e0f72a6a44.herokuapp.com";

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();

    fetch(`${BACKEND_URL}/api/auth/login`, {   // koristi Heroku URL
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          onLogin(); // Ako je uspješno, prijavi korisnika
        } else {
          setError('Pogrešan username ili password.');
        }
      })
      .catch(() => {
        setError('Neuspješno povezivanje sa serverom.');
      });
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Prijava</h2>
      <form onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Korisničko ime"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <br />
        <input
          type="password"
          placeholder="Lozinka"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <br />
        <button type="submit">Prijavi se</button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}

export default Login;
