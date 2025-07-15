import React, { useEffect, useState } from 'react';

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function Dashboard() {
  const [plans, setPlans] = useState([]);
  const [clients, setClients] = useState([]);
  const [executors, setExecutors] = useState([]);

  useEffect(() => {
    fetch("/api/plans")
      .then(res => res.json())
      .then(data => setPlans(data));
    fetch("/api/clients")
      .then(res => res.json())
      .then(data => setClients(data));
    fetch("/api/executors")
      .then(res => res.json())
      .then(data => setExecutors(data));
  }, []);

  const todaysPlans = plans.filter(p => p.date === todayISO());

  const stats = [
    { label: 'Ukupno klijenata', value: clients.length },
    { label: 'Ukupno izvođača', value: executors.length },
    { label: 'Ukupno tretmana', value: plans.length }
  ];

  return (
    <div style={{ padding: 20 }}>
      <h2>Radna ploča</h2>
      <div style={{ marginBottom: 30 }}>
        {stats.map(s => (
          <span key={s.label} style={{
            display: 'inline-block', marginRight: 30, padding: 10,
            background: '#f0f0f0', borderRadius: 10, fontWeight: 'bold'
          }}>{s.label}: {s.value}</span>
        ))}
      </div>

      <h3>Planirani tretmani za DANAS ({todayISO()})</h3>
      {todaysPlans.length === 0 && <p>Nema tretmana za danas.</p>}
      <table border="1" cellPadding="5" style={{ borderCollapse: "collapse", width: "100%", marginBottom: 30 }}>
        <thead>
          <tr>
            <th>Klijent</th>
            <th>Lokacija</th>
            <th>Izvođač</th>
            <th>Napomena</th>
          </tr>
        </thead>
        <tbody>
          {todaysPlans.map(plan => (
            <tr key={plan.id}>
              <td>{clients.find(c => c.id === plan.clientId)?.name || ''}</td>
              <td>{plan.location || ''}</td>
              <td>{executors.find(e => e.id === plan.executorId)?.name || ''}</td>
              <td>{plan.note || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4>Sljedećih 7 dana:</h4>
      <table border="1" cellPadding="5" style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th>Datum</th>
            <th>Klijent</th>
            <th>Lokacija</th>
            <th>Izvođač</th>
          </tr>
        </thead>
        <tbody>
          {plans
            .filter(p => {
              const now = new Date();
              const planDate = new Date(p.date);
              return planDate >= now && planDate <= new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
            })
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(plan => (
              <tr key={plan.id}>
                <td>{plan.date}</td>
                <td>{clients.find(c => c.id === plan.clientId)?.name || ''}</td>
                <td>{plan.location || ''}</td>
                <td>{executors.find(e => e.id === plan.executorId)?.name || ''}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

export default Dashboard;
