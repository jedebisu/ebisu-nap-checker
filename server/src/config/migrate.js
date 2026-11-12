// Account tables only. NAP facility data is NEVER stored here — the app reads
// it live from the Render API. All statements are idempotent so the build can
// run migrations on every start.
async function runMigrations(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      password_hash TEXT,
      status TEXT NOT NULL DEFAULT 'pending_otp'
        CHECK (status IN ('pending_otp', 'pending_first_login', 'active', 'expired')),
      temp_password_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS invite_codes (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      max_uses INTEGER NOT NULL DEFAULT 1,
      uses INTEGER NOT NULL DEFAULT 0,
      last_used_by TEXT,
      last_used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Where mail goes while SMTP is not configured. The mailer's file outbox is
  // useless on a hosted instance: the disk is wiped on every restart, so an OTP
  // written at registration would be gone before anyone could read it. Rows
  // here survive, and the admin page shows them.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mail_outbox (
      id SERIAL PRIMARY KEY,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS mail_outbox_created_at_idx
      ON mail_outbox (created_at DESC)
  `);

  // Bumped whenever the password changes; outstanding reset tokens carry the
  // old version and are rejected (single-use reset links). App tokens carry it
  // too, so a password change also logs out other devices.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0
  `);

  // When the last temporary password was emailed. Used only to throttle
  // /api/auth/forgot so it cannot be used to flood a mailbox.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_temp_password_sent_at TIMESTAMPTZ
  `);
}

// Run directly ("npm run db:migrate") against the dev database.
if (require.main === module) {
  const pool = require('./database');
  runMigrations(pool)
    .then(() => {
      console.log('Migrations complete');
      return pool.end();
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

module.exports = { runMigrations };
