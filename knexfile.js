// backend/knexfile.js
const path = require('path');

module.exports = {
  development: {
    client: 'sqlite3',
    connection: {
      filename: path.resolve(__dirname, 'data', 'mydb.sqlite')
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.resolve(__dirname, 'migrations'),
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: path.resolve(__dirname, 'seeds')
    }
  },

  production: {
    client: 'pg',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    },
    migrations: {
      directory: path.resolve(__dirname, 'migrations'),
      tableName: 'knex_migrations'
    },
    seeds: {
      directory: path.resolve(__dirname, 'seeds')
    },
    pool: {
      min: 0,
      max: 2,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createTimeoutMillis: 30000,
      acquireTimeoutMillis: 30000,
      propagateCreateError: false
    },
    debug: true
  }
};
