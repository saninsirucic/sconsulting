const knex = require('knex');
const config = require('./knexfile').production;

const db = knex(config);

async function test() {
  try {
    const result = await db.raw('select 1+1 as result');
    console.log('DB connection OK:', result.rows || result);
  } catch (e) {
    console.error('DB connection failed:', e);
  } finally {
    await db.destroy();
  }
}

test();
