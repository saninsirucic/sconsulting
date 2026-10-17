const { claimRun, executeRun, recoverExpiredRun } = require('../haccpResearch/service');

async function runResearchTick(db, options = {}) {
  await recoverExpiredRun(db);
  const run = await claimRun(db, options);
  if (!run) return { skipped: true };
  return executeRun(db, run, { provider: options.provider });
}

if (require.main === module) {
  require('dotenv').config();
  const knex = require('knex');
  const environment = process.env.DATABASE_URL ? 'production' : 'development';
  const db = knex(require('../knexfile')[environment]);
  runResearchTick(db)
    .then(result => { console.log(JSON.stringify(result)); if (result.failed) process.exitCode = 1; })
    .catch(() => { console.error('HACCP istraživanje: provjerite bazu, migracije i konfiguraciju.'); process.exitCode = 1; })
    .finally(() => db.destroy());
}

module.exports = { runResearchTick };
