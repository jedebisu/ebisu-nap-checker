// Database connection. Follows the selfie-attendance pattern: local dev uses
// discrete DB_* settings, and DATABASE_URL is only honored in production
// (NODE_ENV=production) so a stray .env can never point local work at a
// remote/production database by accident. Jest sets NODE_ENV=test, so tests
// (and the app under test) use TEST_DATABASE_URL.
require('dotenv').config();
const { Pool } = require('pg');

const isProduction = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

function connectionStringOrUndefined() {
  return isProduction ? process.env.DATABASE_URL : isTest ? process.env.TEST_DATABASE_URL : undefined;
}

const pool = isProduction
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      ...(connectionStringOrUndefined()
        ? { connectionString: connectionStringOrUndefined() }
        : {}),
      user: process.env.DB_USER || 'yanggee',
      host: process.env.DB_HOST || 'localhost',
      database: isTest ? 'napcheck_test' : process.env.DB_NAME || 'napcheck',
      password: process.env.DB_PASSWORD || undefined,
      port: process.env.DB_PORT || 5432,
    });

module.exports = pool;
