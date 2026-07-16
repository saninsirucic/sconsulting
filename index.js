require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { authenticateCredentials, createAccessToken } = require('./aiEmail/auth');
const { createAiEmailRouter } = require('./aiEmail/router');

const knex = require("knex");
const environment = process.env.NODE_ENV || 'development';
const config = require("./knexfile")[environment];
const db = knex(config);

console.log("NODE_ENV =", process.env.NODE_ENV);

db.raw('select 1+1 as result')
  .then(() => {
    console.log('✅ Konekcija na bazu je uspješna');
  })
  .catch(err => {
    console.error('❌ Greška pri konekciji na bazu:', err);
  });

const { v4: uuidv4 } = require("uuid");

const app = express();

// CORS konfiguracija — dozvoli samo tvoju frontend adresu
const configuredOrigin = (() => {
  try {
    return process.env.APP_BASE_URL ? new URL(process.env.APP_BASE_URL).origin : null;
  } catch (error) {
    return null;
  }
})();
const allowedOrigins = new Set([
  'https://saninsirucic.github.io',
  'http://localhost:3000',
  'http://localhost:3002',
  configuredOrigin
].filter(Boolean));
const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('CORS origin nije dozvoljen'));
  },
  optionsSuccessStatus: 200
};

// PRVO postavi cors middleware
app.use(cors(corsOptions));
// Podrži OPTIONS preflight zahtjeve
app.options('*', cors(corsOptions));

app.use(bodyParser.json({ limit: '1mb' }));

// Ograniči broj istovremenih konekcija na bazu ako treba
// db.client.pool.max = 5; // opcionalno

// LOGIN
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await authenticateCredentials(username, password);
    if (!user) return res.status(401).json({ success: false, error: 'Pogrešno korisničko ime ili lozinka.' });
    return res.json({ success: true, token: createAccessToken(user), user });
  } catch (error) {
    console.error('Greška konfiguracije prijave:', error.message);
    return res.status(503).json({ success: false, error: 'Prijava trenutno nije dostupna.' });
  }
});

// Novi modul je izolovan i sve njegove rute zahtijevaju JWT.
app.use('/api/ai-email', createAiEmailRouter({ db }));

// --- CLIENTS ---
app.get('/api/clients', async (req, res) => {
  try {
    console.log("Poziv baze: dohvatanje klijenata");
    const clients = await db('clients').select('*');
    res.json(clients);
  } catch (error) {
    console.error("Greška pri dohvatu klijenata:", error);
    res.status(500).json({ error: "Greška pri dohvatu klijenata" });
  }
});

app.post('/api/clients', async (req, res) => {
  const {
    name, email, phone, address, postalCode, companyId, pib,
    contractNumber, paymentTerm, amountInWords
  } = req.body;

  if (!name || !email || !phone || !address) {
    return res.status(400).json({ error: "Nedostaju obavezni podaci" });
  }

  const id = uuidv4();

  try {
    console.log("Poziv baze: unos novog klijenta");
    await db('clients').insert({
      id, name, email, phone, address, postalCode,
      companyId, pib, contractNumber, paymentTerm, amountInWords
    });
    const client = await db('clients').where({ id }).first();
    res.json(client);
  } catch (error) {
    console.error("Greška pri unosu klijenta:", error);
    res.status(500).json({ error: "Greška pri unosu klijenta" });
  }
});

app.put('/api/clients/:id', async (req, res) => {
  const { id } = req.params;
  const {
    name, email, phone, address, postalCode,
    companyId, pib, contractNumber, paymentTerm, amountInWords
  } = req.body;

  try {
    console.log("Poziv baze: ažuriranje klijenta", id);
    const updated = await db('clients').where({ id }).update({
      name, email, phone, address, postalCode,
      companyId, pib, contractNumber, paymentTerm, amountInWords
    });
    if (!updated) return res.status(404).json({ error: "Klijent nije pronađen" });
    res.json({ success: true });
  } catch (error) {
    console.error("Greška pri ažuriranju klijenta:", error);
    res.status(500).json({ error: "Greška pri ažuriranju klijenta" });
  }
});

app.delete('/api/clients/:id', async (req, res) => {
  const { id } = req.params;
  try {
    console.log("Poziv baze: brisanje klijenta", id);
    const deleted = await db('clients').where({ id }).del();
    if (!deleted) return res.status(404).json({ error: "Klijent nije pronađen" });
    res.json({ success: true });
  } catch (error) {
    console.error("Greška pri brisanju klijenta:", error);
    res.status(500).json({ error: "Greška pri brisanju klijenta" });
  }
});

// --- EXECUTORS ---
app.get('/api/executors', async (req, res) => {
  try {
    console.log("Poziv baze: dohvatanje izvođača");
    const executors = await db('executors').select('*');
    res.json(executors);
  } catch (error) {
    console.error("Greška pri dohvatu izvođača:", error);
    res.status(500).json({ error: "Greška pri dohvatu izvođača" });
  }
});

app.post('/api/executors', async (req, res) => {
  const { name, email, phone, address } = req.body;
  if (!name) return res.status(400).json({ error: "Ime je obavezno" });
  const id = uuidv4();
  try {
    console.log("Poziv baze: unos novog izvođača");
    await db('executors').insert({ id, name, email, phone, address });
    const executor = await db('executors').where({ id }).first();
    res.json(executor);
  } catch (error) {
    console.error("Greška pri unosu izvođača:", error);
    res.status(500).json({ error: "Greška pri unosu izvođača" });
  }
});

app.put('/api/executors/:id', async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, address } = req.body;
  try {
    console.log("Poziv baze: ažuriranje izvođača", id);
    const updated = await db('executors').where({ id }).update({ name, email, phone, address });
    if (!updated) return res.status(404).json({ error: "Izvođač nije pronađen" });
    res.json({ success: true });
  } catch (error) {
    console.error("Greška pri ažuriranju izvođača:", error);
    res.status(500).json({ error: "Greška pri ažuriranju izvođača" });
  }
});

app.delete('/api/executors/:id', async (req, res) => {
  const { id } = req.params;
  try {
    console.log("Poziv baze: brisanje izvođača", id);
    const deleted = await db('executors').where({ id }).del();
    if (!deleted) return res.status(404).json({ error: "Izvođač nije pronađen" });
    res.json({ success: true });
  } catch (error) {
    console.error("Greška pri brisanju izvođača:", error);
    res.status(500).json({ error: "Greška pri brisanju izvođača" });
  }
});

// --- PLANS ---
app.get('/api/plans', async (req, res) => {
  try {
    console.log("Poziv baze: dohvatanje planova");
    const plans = await db('plans').select('id', 'clientId', 'executorId', 'service', 'date', 'recurrence', 'done', 'iznos as price');
    res.json(plans);
  } catch (error) {
    console.error("Greška pri dohvatu planova:", error);
    res.status(500).json({ error: "Greška pri dohvatu planova" });
  }
});

app.post('/api/plans', async (req, res) => {
  const { clientId, executorId, service, date, recurrence, done, price } = req.body;
  if (!clientId || !executorId || !service || !date) {
    return res.status(400).json({ error: "Nedostaju podaci za plan!" });
  }
  const id = uuidv4();
  try {
    console.log("Poziv baze: unos novog plana");
    await db('plans').insert({ id, clientId, executorId, service, date, recurrence, done: done || false, iznos: price });
    const plan = await db('plans').select('id', 'clientId', 'executorId', 'service', 'date', 'recurrence', 'done', 'iznos as price').where({ id }).first();
    res.json(plan);
  } catch (error) {
    console.error("Greška pri unosu plana:", error);
    res.status(500).json({ error: "Greška pri unosu plana" });
  }
});

app.put('/api/plans/:id', async (req, res) => {
  const { id } = req.params;
  const { clientId, executorId, service, date, done, price } = req.body;
  try {
    console.log("Poziv baze: ažuriranje plana", id);
    const updated = await db('plans').where({ id }).update({ clientId, executorId, service, date, done, iznos: price });
    if (!updated) return res.status(404).json({ error: "Plan nije pronađen" });
    res.json({ success: true });
  } catch (error) {
    console.error("Greška pri ažuriranju plana:", error);
    res.status(500).json({ error: "Greška pri ažuriranju plana" });
  }
});

app.delete('/api/plans/:id', async (req, res) => {
  const { id } = req.params;
  try {
    console.log("Poziv baze: brisanje plana", id);
    const deleted = await db('plans').where({ id }).del();
    if (!deleted) return res.status(404).json({ error: "Plan nije pronađen" });
    res.json({ success: true });
  } catch (error) {
    console.error("Greška pri brisanju plana:", error);
    res.status(500).json({ error: "Greška pri brisanju plana" });
  }
});

// --- NOVO: Brisanje planova po klijentu i periodu ---
app.post('/api/plans/delete-by-client-and-period', async (req, res) => {
  const { clientId, startDate, endDate } = req.body;

  if (!clientId || !startDate || !endDate) {
    return res.status(400).json({ success: false, error: "Nedostaju potrebni podaci." });
  }

  try {
    console.log(`Brisanje planova za klijenta ${clientId} od ${startDate} do ${endDate}`);

    const deletedCount = await db('plans')
      .where('clientId', clientId)
      .andWhere('date', '>=', startDate)
      .andWhere('date', '<=', endDate)
      .del();

    res.json({ success: true, deletedCount });
  } catch (error) {
    console.error("Greška pri brisanju planova po klijentu i periodu:", error);
    res.status(500).json({ success: false, error: "Greška pri brisanju planova" });
  }
});

// --- INVOICES ---

async function getNextInvoiceNumber(date) {
  const currentYear = new Date(date).getFullYear();
  const yearSuffix = currentYear.toString().slice(-2);

  const lastInvoice = await db('invoices')
    .whereRaw('number LIKE ?', [`%/${yearSuffix}`])
    .orderByRaw("CAST(split_part(number, '/', 1) AS INTEGER) DESC")
    .first();

  if (!lastInvoice) {
    return 223;
  }

  const lastNumber = parseInt(lastInvoice.number.split('/')[0], 10);
  return lastNumber + 1;
}

// Funkcija za dobijanje sljedećeg fiskalnog broja (kreće od 913)
async function getNextFiscalNumber() {
  // Sad koristimo kolonu fiscal_number kako stvarno postoji u DB
  const lastInvoice = await db('invoices')
    .orderByRaw('CAST("fiscal_number" AS INTEGER) DESC')
    .first();

  if (!lastInvoice || !lastInvoice.fiscal_number) {
    return 913;
  }

  return parseInt(lastInvoice.fiscal_number, 10) + 1;
}


// ** OVJERENA RUTA SA JOINOM DA VRATI IME KLIJENTA **
app.get('/api/invoices', async (req, res) => {
  try {
    console.log("Poziv baze: dohvatanje faktura sa imenima klijenata");
    const invoices = await db('invoices')
      .select(
        'invoices.*',
        'clients.name as clientName'
      )
      .leftJoin('clients', 'invoices.clientId', 'clients.id');
    res.json(invoices);
  } catch (error) {
    console.error("Greška pri dohvatu faktura:", error);
    res.status(500).json({ error: "Greška pri dohvatu faktura" });
  }
});

app.post('/api/invoices', async (req, res) => {
  const {
    clientId, date, description, quantity, price, unit,
    totalNoVat, vat, total, amountInWords, contractNumber,
    paymentTerm, paymentDate, paymentOrderNumber
  } = req.body;

  if (!clientId || !date) {
    return res.status(400).json({ error: "Nedostaju obavezni podaci za fakturu" });
  }

  // Zamijeni prazne stringove sa null za datume i broj izvoda
  const safePaymentDate = paymentDate === '' ? null : paymentDate;
  const safePaymentOrderNumber = paymentOrderNumber === '' ? null : paymentOrderNumber;

  try {
    console.log("Poziv baze: unos nove fakture");
    const nextNumber = await getNextInvoiceNumber(date);
    const yearSuffix = new Date(date).getFullYear().toString().slice(-2);
    const invoiceNumber = `${nextNumber}/${yearSuffix}`;

    const nextFiscalNumber = await getNextFiscalNumber();

    const id = uuidv4();

    await db('invoices').insert({
  id,
  number: invoiceNumber,
  fiscal_number: nextFiscalNumber.toString(),
  clientId,
  date,
  description,
  quantity,
  price,
  unit,
  totalNoVat,
  vat,
  total,
  amountInWords,
  contractNumber,
  paymentTerm,
  paymentDate: safePaymentDate,
  paymentOrderNumber: safePaymentOrderNumber
});

    const invoice = await db('invoices').where({ id }).first();
    res.json(invoice);
  } catch (error) {
    console.error("Greška pri unosu fakture:", error);
    res.status(500).json({ error: "Greška pri unosu fakture" });
  }
});

app.put('/api/invoices/:id', async (req, res) => {
  const { id } = req.params;
  try {
    console.log("Poziv baze: ažuriranje fakture", id);
    const updated = await db('invoices').where({ id }).update(req.body);
    if (!updated) return res.status(404).json({ error: "Faktura nije pronađena" });
    res.json({ success: true });
  } catch (error) {
    console.error("Greška pri ažuriranju fakture:", error);
    res.status(500).json({ error: "Greška pri ažuriranju fakture" });
  }
});

app.delete('/api/invoices/:id', async (req, res) => {
  const { id } = req.params;
  try {
    console.log("Poziv baze: brisanje fakture", id);
    const deleted = await db('invoices').where({ id }).del();
    if (!deleted) return res.status(404).json({ error: "Faktura nije pronađena" });
    res.json({ success: true });
  } catch (error) {
    console.error("Greška pri brisanju fakture:", error);
    res.status(500).json({ error: "Greška pri brisanju fakture" });
  }
});

// --- SANITARNE ---
app.get('/api/sanitarne', async (req, res) => {
  try {
    console.log("Poziv baze: dohvatanje sanitarnjih zapisa");
    const sanitarne = await db('sanitarne').select('*');
    res.json(sanitarne);
  } catch (error) {
    console.error("Greška pri dohvatu sanitarnjih zapisa:", error);
    res.status(500).json({ error: "Greška pri dohvatu sanitarnjih knjižica" });
  }
});

app.post('/api/sanitarne', async (req, res) => {
  const { clientId, employeeName, dateIssued, expiryDate } = req.body;
  if (!clientId || !employeeName || !dateIssued || !expiryDate) {
    return res.status(400).json({ error: "Nedostaju podaci" });
  }
  const id = uuidv4();
  try {
    console.log("Poziv baze: unos sanitarnog zapisa");
    await db('sanitarne').insert({ id, clientId, employeeName, dateIssued, expiryDate });
    const zapis = await db('sanitarne').where({ id }).first();
    res.json(zapis);
  } catch (error) {
    console.error("Greška pri unosu sanitarnog zapisa:", error);
    res.status(500).json({ error: "Greška pri unosu sanitarnog zapisa" });
  }
});

app.put('/api/sanitarne/:id', async (req, res) => {
  const { id } = req.params;
  try {
    console.log("Poziv baze: ažuriranje sanitarnog zapisa", id);
    const updated = await db('sanitarne').where({ id }).update(req.body);
    if (!updated) return res.status(404).json({ error: "Sanitarni zapis nije pronađen" });
    res.json({ success: true });
  } catch (error) {
    console.error("Greška pri ažuriranju sanitarnog zapisa:", error);
    res.status(500).json({ error: "Greška pri ažuriranju sanitarnog zapisa" });
  }
});

app.delete('/api/sanitarne/:id', async (req, res) => {
  const { id } = req.params;
  try {
    console.log("Poziv baze: brisanje sanitarnog zapisa", id);
    const deleted = await db('sanitarne').where({ id }).del();
    if (!deleted) return res.status(404).json({ error: "Sanitarni zapis nije pronađen" });
    res.json({ success: true });
  } catch (error) {
    console.error("Greška pri brisanju sanitarnog zapisa:", error);
    res.status(500).json({ error: "Greška pri brisanju sanitarnog zapisa" });
  }
});

// --- KUFS ---
app.get('/api/kufs', async (req, res) => {
  try {
    console.log("Poziv baze: dohvatanje kufova");
    const kufs = await db('kufs').select('*');
    res.json(kufs);
  } catch (error) {
    console.error("Greška pri dohvatu kufova:", error);
    res.status(500).json({ error: "Greška pri dohvatu kufova" });
  }
});

app.post('/api/kufs', async (req, res) => {
  const {
    brojKuf, datumKuf, datumPrijema, imeKomitenta,
    idKomitenta, iznos, placeno
  } = req.body;

  if (!brojKuf || !datumKuf || !imeKomitenta || !iznos) {
    return res.status(400).json({ error: "Nedostaju obavezni podaci za KUF." });
  }

  const id = uuidv4();

  try {
    console.log("Poziv baze: unos novog KUF-a");
    await db('kufs').insert({
      id, brojKuf, datumKuf, datumPrijema,
      imeKomitenta, idKomitenta, iznos, placeno: placeno || false
    });
    const kuf = await db('kufs').where({ id }).first();
    res.json(kuf);
  } catch (error) {
    console.error("Greška pri unosu kufa:", error);
    res.status(500).json({ error: "Greška pri unosu kufa" });
  }
});

app.put('/api/kufs/:id', async (req, res) => {
  const { id } = req.params;
  try {
    console.log("Poziv baze: ažuriranje KUF-a", id);
    const updated = await db('kufs').where({ id }).update(req.body);
    if (!updated) return res.status(404).json({ error: "KUF nije pronađen" });
    res.json({ success: true });
  } catch (error) {
    console.error("Greška pri ažuriranju kufa:", error);
    res.status(500).json({ error: "Greška pri ažuriranju kufa" });
  }
});

app.delete('/api/kufs/:id', async (req, res) => {
  const { id } = req.params;
  try {
    console.log("Poziv baze: brisanje KUF-a", id);
    const deleted = await db('kufs').where({ id }).del();
    if (!deleted) return res.status(404).json({ error: "KUF nije pronađen" });
    res.json({ success: true });
  } catch (error) {
    console.error("Greška pri brisanju kufa:", error);
    res.status(500).json({ error: "Greška pri brisanju kufa" });
  }
});

app.get('/', (req, res) => {
  res.send('✅ Backend server radi ispravno!');
});

// START SERVER
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number(error.status || (error.name === 'MulterError' ? 400 : 500));
  if (status >= 500) console.error('AI mail API greška:', error.message);
  return res.status(status).json({
    error: status >= 500 ? 'Došlo je do interne greške.' : error.message
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ Backend server radi na portu ${PORT}`));
