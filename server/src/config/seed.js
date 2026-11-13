require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('./database');
const { generateInviteCode } = require('../services/inviteCode');

const seedData = async () => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const salt = await bcrypt.genSalt(10);
    const users = [
      {
        firstname: 'Demo',
        lastname: 'One',
        email: 'demo1@ebisudps.com',
        phone: null,
        password: 'DemoPass1!',
        must_change_password: false,
      },
      {
        firstname: 'Demo',
        lastname: 'Two',
        email: 'demo2@ebisudps.com',
        phone: null,
        password: 'DemoPass2!',
        must_change_password: false,
      },
    ];

    for (const u of users) {
      const hashed = await bcrypt.hash(u.password, salt);
      await client.query(
        `INSERT INTO users (firstname, lastname, email, phone, password_hash, must_change_password, is_active, role)
         VALUES ($1, $2, $3, $4, $5, $6, true, 'user')
         ON CONFLICT (email) DO UPDATE SET
           firstname            = EXCLUDED.firstname,
           lastname             = EXCLUDED.lastname,
           phone                = EXCLUDED.phone,
           password_hash        = EXCLUDED.password_hash,
           must_change_password = EXCLUDED.must_change_password,
           is_active            = true`,
        [u.firstname, u.lastname, u.email, u.phone, hashed, u.must_change_password]
      );
    }

    // Seed a handful of single-use invitation keys (GMAPS-XXXXXXXX) if none
    // exist yet. Codes are printed once — capture them for distribution.
    const inviteCount = await client.query('SELECT COUNT(*)::int AS n FROM invite_codes');
    if (inviteCount.rows[0].n === 0) {
      const codes = [];
      for (let i = 0; i < 5; i++) {
        const code = generateInviteCode();
        await client.query(
          `INSERT INTO invite_codes (code, max_uses, used_count) VALUES ($1, 1, 0)`,
          [code]
        );
        codes.push(code);
      }
      console.log('\nInvitation keys (single-use):');
      codes.forEach((c) => console.log(`  ${c}`));
    }

    console.log(`\n${users.length} users seeded successfully!`);
    console.log('\nTest credentials:');
    console.log(`  ${users[0].email} / ${users[0].password}`);
    console.log(`  ${users[1].email} / ${users[1].password}`);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

seedData()
  .then(() => {
    console.log('Seed completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
