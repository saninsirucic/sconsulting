require('dotenv').config();
const knex = require('knex');
const { runInboundTick } = require('../commercial/inboundMail');
const db = knex(require('../knexfile')[process.env.DATABASE_URL ? 'production' : 'development']);
(async () => {
  if (process.env.INBOUND_AUTOMATION_ENABLED !== 'true') throw Object.assign(new Error('Disabled'), { code: 'INBOUND_DISABLED' });
  const report = await runInboundTick(db);
  console.log(JSON.stringify(report));
  if (report.errors?.length) process.exitCode = 1;
})().catch(error => { console.error(JSON.stringify({ code: error.code || 'INBOUND_WORKER_FAILED' })); process.exitCode = 1; })
  .finally(() => db.destroy());
