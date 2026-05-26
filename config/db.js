require('dotenv').config();
const { Pool, types } = require('pg');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Force pg to interpret TIMESTAMP WITHOUT TIME ZONE as UTC
// OID 1114 = timestamp without time zone
// Without this, pg uses the local machine timezone, causing offset bugs
types.setTypeParser(1114, (str) => new Date(str + 'Z'));

// Debug: Log what DATABASE_URL looks like
const dbUrl = process.env.DATABASE_URL;
logger.info(`DATABASE_URL type: ${typeof dbUrl}`);
logger.info(`DATABASE_URL length: ${dbUrl ? dbUrl.length : 0}`);
logger.info(`DATABASE_URL starts with: ${dbUrl ? dbUrl.substring(0, 30) : 'undefined'}...`);

const pool = new Pool({
  connectionString: dbUrl,
  ssl: dbUrl && dbUrl.includes('railway') ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  logger.error('Unexpected PostgreSQL pool error', err);
});

async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug(`Query executed in ${duration}ms: ${text.substring(0, 80)}`);
    return result;
  } catch (err) {
    logger.error(`Query error: ${err.message}`, { text, params });
    throw err;
  }
}

async function initDatabase() {
  try {
    const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    await pool.query(schema);
    logger.info('Database schema initialized successfully');
  } catch (err) {
    logger.error('Failed to initialize database schema', err);
    throw err;
  }
}

async function getClient() {
  return pool.connect();
}

module.exports = { query, initDatabase, getClient, pool };
