const knex = require('knex');
const config = require('./knexfile').development;
const db = knex(config);

async function checkTables() {
  try {
    const tables = await db.raw("SELECT name FROM sqlite_master WHERE type='table'");
    console.log("Tabele u bazi:", tables);

    const clientsCount = await db('clients').count('id as count').first();
    console.log("Broj klijenata:", clientsCount.count);

    const sanitarneCount = await db('sanitarne').count('id as count').first();
    console.log("Broj sanitarki:", sanitarneCount.count);

    process.exit(0);
  } catch (error) {
    console.error("Greška:", error);
    process.exit(1);
  }
}

checkTables();
