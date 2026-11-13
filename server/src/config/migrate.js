require('dotenv').config();
const { pool } = require('./database');

const createTables = async () => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Users table (demo-adapted: no employee_id column; name computed from
    // firstname || lastname in auth middleware).
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

    // Backward-compat: add demo columns if they're missing (e.g. when migrating
    // an existing selfie-attendance users table that still has employee_id/name/pin).
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS firstname VARCHAR(100);
      EXCEPTION WHEN duplicate_column THEN null;
      END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS lastname VARCHAR(100);
      EXCEPTION WHEN duplicate_column THEN null;
      END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
      EXCEPTION WHEN duplicate_column THEN null;
      END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
      EXCEPTION WHEN duplicate_column THEN null;
      END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;
      EXCEPTION WHEN duplicate_column THEN null;
      END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS otp_fail_count INT DEFAULT 0;
      EXCEPTION WHEN duplicate_column THEN null;
      END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
      EXCEPTION WHEN duplicate_column THEN null;
      END $$;
    `);
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS lockout_tier INT DEFAULT 0;
      EXCEPTION WHEN duplicate_column THEN null;
      END $$;
    `);

    // Make name nullable — demo uses firstname/lastname instead.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN name DROP NOT NULL;
      EXCEPTION WHEN undefined_column OR others THEN null;
      END $$;
    `);

    // Make pin nullable — demo uses password_hash for bcrypt auth.
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE users ALTER COLUMN pin DROP NOT NULL;
      EXCEPTION WHEN undefined_column OR others THEN null;
      END $$;
    `);

    // Sessions table for JWT tracking. Shape mirrors EBISU's original.
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

    // Add barangay_name column if it doesn't exist (for existing databases)
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
