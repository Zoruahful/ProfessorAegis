require('dotenv').config();

const { Pool } = require('pg');

function getPostgresConfigFromEnv() {
  const port = Number(process.env.PGPORT || 5432);
  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number.isFinite(port) ? port : 5432,
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    database: process.env.PGDATABASE || 'postgres',
    ssl: String(process.env.PGSSLMODE || '').toLowerCase() === 'require' ? { rejectUnauthorized: false } : false,
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PGPOOL_IDLE_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PGCONNECT_TIMEOUT_MS || 5000),
  };
}

function createPostgresPool(overrides = {}) {
  return new Pool({
    ...getPostgresConfigFromEnv(),
    ...overrides,
  });
}

async function testPostgresConnection(overrides = {}) {
  const pool = createPostgresPool(overrides);
  try {
    const result = await pool.query('SELECT current_database() AS database_name, current_user AS user_name, NOW() AS server_time');
    return result.rows?.[0] || null;
  } finally {
    await pool.end();
  }
}

module.exports = {
  createPostgresPool,
  getPostgresConfigFromEnv,
  testPostgresConnection,
};
