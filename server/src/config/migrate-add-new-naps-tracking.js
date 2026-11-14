require('dotenv').config();
const { pool } = require('./database');

const addNewNapTracking = async () => {
  const client = await pool.connect();
  try {
    // Column to hold the total NAP count from the *previous* import run.
    // NULL = never imported; 0 = first import ever; >0 = used as baseline.
    await client.query(`
      ALTER TABLE naps ADD COLUMN IF NOT EXISTS prev_import_count INT DEFAULT NULL
    `);
    console.log('prev_import_count column ready.');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

addNewNapTracking()
  .then(() => { console.log('Done'); process.exit(0); })
  .catch(e => { console.error(e); process.exit(1); });
