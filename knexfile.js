module.exports = {
  development: {
    client: "sqlite3",
    connection: {
      filename: "./data/mydb.sqlite"
    },
    useNullAsDefault: true,
    migrations: {
      directory: './migrations'
    },
    seeds: {
      directory: './seeds'
    }
  },

  production: {
    client: "pg",
    connection: process.env.DATABASE_URL, // Heroku automatski daje ovu env var
    migrations: {
      directory: './migrations'
    },
    seeds: {
      directory: './seeds'
    },
    // Ako koristis SSL u produkciji
    pool: {
      min: 2,
      max: 10,
      idleTimeoutMillis: 30000,
      reapIntervalMillis: 1000,
      createTimeoutMillis: 30000,
      acquireTimeoutMillis: 30000,
      propagateCreateError: false
    },
    ssl: { rejectUnauthorized: false },
  }
};
