require('dotenv').config();
const knex = require('knex');
const { runAutomationTick } = require('../commercial/automation');

const environment = process.env.DATABASE_URL ? 'production' : 'development';
const db = knex(require('../knexfile')[environment]);

runAutomationTick(db)
  .then((result) => {
    console.log(JSON.stringify(result));
  })
  .catch((error) => {
    console.error('Automatska komercijala nije izvršena:', error.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
