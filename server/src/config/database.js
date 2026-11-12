// Database connection. Follows the selfie-attendance pattern: local dev uses
// discrete DB_* settings, and DATABASE_URL is only honored in production
// (NODE_ENV=production) so a stray .env can never point local work at a
// remote/production database by accident.
require('dotenv').config();
const { Pool } = require('pg');

const isProduction = process.env.NODE_ENV === 'production';

const pool = isProduction
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      user: process.env.DB_USER || 'yanggee',
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'napcheck',
      password: process.env.DB_PASSWORD || undefined,
      port: process.env.DB_PORT || 5432,
    });

module.exports = pool;
