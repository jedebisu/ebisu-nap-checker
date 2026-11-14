require('dotenv').config();
const { pool } = require('./database');

const addSearchIndexes = async () => {
  const client = await pool.connect();

  try {
    // CREATE INDEX CONCURRENTLY cannot run inside a transaction, so we run
    // each one individually outside of BEGIN/COMMIT. For the 322K-row naps
    // table this takes a few seconds and does not block writes.
    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_naps_upper_nap_id
      ON naps (UPPER(nap_id));
    `);
    console.log('Created idx_naps_upper_nap_id');

    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_naps_upper_building
      ON naps (UPPER(building_served));
    `);
    console.log('Created idx_naps_upper_building');

    await client.query(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_naps_upper_city
      ON naps (UPPER(city_name));
    `);
    console.log('Created idx_naps_upper_city');

    console.log('Search indexes created successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
};

addSearchIndexes()
  .then(() => {
    console.log('Migration completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
