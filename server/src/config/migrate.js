require('dotenv').config();
const { pool } = require('./database');

const createTables = async () => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Users table (demo-adapted: no employee_id; name computed from
    // firstname || lastname in auth middleware). Pre-existing
    // production-shaped databases (id, employee_id, name, email, pin, ...)
    // are supported additively via the convergence ALTERs below.
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        firstname VARCHAR(100) NOT NULL,
        lastname VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE,
        phone VARCHAR(50),
        password_hash VARCHAR(255) NOT NULL,
        must_change_password BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        role VARCHAR(20) DEFAULT 'user',
        otp_fail_count INT DEFAULT 0,
        locked_until TIMESTAMPTZ,
        lockout_tier INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Convergence ALTERs for pre-existing production-shaped users tables
    // (id, employee_id, name, email, pin, is_active, is_admin, created_at,
    // updated_at, leave_balance, role). Additive only: every column is
    // nullable or defaulted so existing rows remain valid; nothing is
    // dropped, renamed, or constrained. Standalone ALTERs mirror the
    // registrations lockout pattern below.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS firstname VARCHAR(100);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lastname VARCHAR(100);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_fail_count INT DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS lockout_tier INT DEFAULT 0;`);
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;`);

    // Sessions table for JWT tracking.
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(500) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // NAP Deployments table — verbatim copy of selfie-attendance migrate.js:148-184.
    await client.query(`
      CREATE TABLE IF NOT EXISTS naps (
        id SERIAL PRIMARY KEY,
        nap_id VARCHAR(100) UNIQUE NOT NULL,
        cabinet VARCHAR(100),
        location_type VARCHAR(50),
        building_served VARCHAR(500),
        floors_served TEXT,
        working_lines INTEGER DEFAULT 0,
        vacant_lines INTEGER DEFAULT 0,
        total_capacity INTEGER DEFAULT 0,
        cfs_region VARCHAR(100),
        city_name VARCHAR(100),
        province_name VARCHAR(100),
        dp_nap_lat DECIMAL(10, 8),
        dp_nap_long DECIMAL(11, 8),
        naps_status VARCHAR(50),
        olt_id VARCHAR(100),
        sell_status VARCHAR(50),
        barangay_name VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      DO $$ BEGIN
        ALTER TABLE naps ADD COLUMN IF NOT EXISTS barangay_name VARCHAR(100);
      EXCEPTION WHEN duplicate_column THEN null;
      END $$;
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_naps_location ON naps(dp_nap_lat, dp_nap_long);
      CREATE INDEX IF NOT EXISTS idx_naps_city ON naps(city_name);
      CREATE INDEX IF NOT EXISTS idx_naps_status ON naps(naps_status);
      CREATE INDEX IF NOT EXISTS idx_naps_updated_at ON naps(updated_at);
    `);

    // Invite codes table.
    await client.query(`
      CREATE TABLE IF NOT EXISTS invite_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(16) UNIQUE NOT NULL,
        max_uses INT,
        used_count INT DEFAULT 0,
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Registrations table — one row per in-flight registration; replaced on re-register.
    await client.query(`
      CREATE TABLE IF NOT EXISTS registrations (
        id SERIAL PRIMARY KEY,
        email VARCHAR(100),
        firstname VARCHAR(100),
        lastname VARCHAR(100),
        phone VARCHAR(50),
        invite_code_id INT REFERENCES invite_codes(id),
        otp_hash VARCHAR(255),
        otp_expires_at TIMESTAMPTZ,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Lockout columns on registrations — needed during registration, before a
    // users row exists (Task 6). Added as standalone ALTERs so both fresh and
    // pre-existing databases converge.
    await client.query(`
      ALTER TABLE registrations ADD COLUMN IF NOT EXISTS otp_fail_count INT DEFAULT 0;
    `);
    await client.query(`
      ALTER TABLE registrations ADD COLUMN IF NOT EXISTS lockout_tier INT DEFAULT 0;
    `);
    await client.query(`
      ALTER TABLE registrations ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
    `);
    // Backfill defaults on any pre-existing rows.
    await client.query(`
      UPDATE registrations SET otp_fail_count = 0 WHERE otp_fail_count IS NULL;
    `);
    await client.query(`
      UPDATE registrations SET lockout_tier = 0 WHERE lockout_tier IS NULL;
    `);

    // One in-flight registration per email (register uses ON CONFLICT (email)).
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_email ON registrations(email);
    `);

    await client.query('COMMIT');
    console.log('Database tables created successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Run migration
createTables()
  .then(() => {
    console.log('Migration completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
