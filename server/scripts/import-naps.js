require('dotenv').config();
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pool } = require('../src/config/database');

// Local copy of the Globe facility report export (task 1). Never fetched remotely.
const CSV_GZ_PATH = path.join(__dirname, '..', 'src', 'config', 'naps_export.csv.gz');

// Demo safety gate: the demo database is local-only. Importing into anything else
// (in particular a production DB reachable through DATABASE_URL) is never intended.
const EXPECTED_DATABASE = 'gmaps_demo';

// 3000 rows x 17 columns = 51,000 bind parameters, under PostgreSQL's 65,535 limit.
const BATCH_SIZE = 3000;

const importNaps = async () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run: NODE_ENV=production (demo import is local-only).');
  }
  if (!fs.existsSync(CSV_GZ_PATH)) {
    throw new Error(`Source export not found: ${CSV_GZ_PATH}`);
  }

  const client = await pool.connect();

  try {
    const dbName = (await client.query('SELECT current_database() AS name')).rows[0].name;
    if (dbName !== EXPECTED_DATABASE) {
      throw new Error(
        `Refusing to import into "${dbName}" — expected the local "${EXPECTED_DATABASE}" database.`
      );
    }

    console.log(`Importing NAPs from ${path.basename(CSV_GZ_PATH)} into ${dbName}...`);

    const stats = await loadRows(client);

    // Single summary only — the report has 320k+ rows, so nothing is printed per row.
    const distribution = await client.query(`
      SELECT COALESCE(naps_status, '(null)') AS status, count(*)::int AS count
      FROM naps
      GROUP BY 1
      ORDER BY 2 DESC
    `);
    const totalInDb = (await client.query('SELECT count(*)::int AS count FROM naps')).rows[0].count;

    console.log('');
    console.log(`Rows in report:       ${stats.rowsRead}`);
    console.log(`Rows upserted:        ${stats.upserted}`);
    if (stats.duplicates > 0) {
      console.log(`Duplicate NAP IDs:    ${stats.duplicates} (kept first occurrence)`);
    }
    if (stats.invalid > 0) {
      console.log(`Skipped rows:         ${stats.invalid} (missing/invalid NAP ID)`);
    }
    console.log(`Rows in naps table:   ${totalInDb}`);
    console.log('');
    console.log('NAP status distribution:');
    for (const row of distribution.rows) {
      console.log(`  ${row.status.padEnd(20)} ${row.count}`);
    }

    return totalInDb;
  } catch (error) {
    // loadRows opens a transaction; leaving it open would hand a dirty client
    // back to the pool once released.
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

// Decompresses the export in one pass and iterates the resulting lines.
// Deliberately not piping into readline while awaiting inserts: the async
// iterator over a live gzip stream silently ended early in testing (321,762
// rows on one run, 321,574 on the next, against 322,931 actual rows).
async function loadRows(client) {
  const lines = zlib
    .gunzipSync(fs.readFileSync(CSV_GZ_PATH))
    .toString('utf8')
    .split('\n');

  const stats = { rowsRead: 0, upserted: 0, duplicates: 0, invalid: 0 };
  const seenNapIds = new Set();
  let batch = [];

  await client.query('BEGIN');

  // First line is the report header.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '');
    if (!line.trim()) continue;

    const fields = parseCSVLine(line);
    if (fields.length < 17) {
      stats.invalid++;
      continue;
    }

    const record = mapRowToNaps(fields);
    if (!record.nap_id) {
      stats.invalid++;
      continue;
    }

    // PostgreSQL rejects an INSERT ... ON CONFLICT that touches the same key twice
    // in one statement, so in-file duplicates are dropped here (first row wins).
    if (seenNapIds.has(record.nap_id)) {
      stats.duplicates++;
      continue;
    }
    seenNapIds.add(record.nap_id);
    stats.rowsRead++;

    batch.push(record);
    if (batch.length >= BATCH_SIZE) {
      stats.upserted += await upsertBatch(client, batch);
      batch = [];
    }
  }

  if (batch.length > 0) {
    stats.upserted += await upsertBatch(client, batch);
  }

  await client.query('COMMIT');
  return stats;
}

// Maps one report row -> naps columns, using the same field mapping as the
// upstream Globe importer (upload-nap-data-safe.js / regenerate-naps-export.py).
function mapRowToNaps(fields) {
  const address = parseNAPAddress(fields[4]);

  return {
    nap_id: clean(fields[1]),
    cabinet: clean(fields[0]),
    location_type: clean(fields[3]),
    building_served: null, // not present in this report format
    floors_served: null,   // not present in this report format
    working_lines: toInt(fields[11]),  // Ports Assigned
    vacant_lines: toInt(fields[15]),   // Ports Available
    total_capacity: toInt(fields[10]), // Ports Total
    cfs_region: address.state,
    city_name: address.city,
    province_name: address.state,
    dp_nap_lat: toFloat(fields[5]),
    dp_nap_long: toFloat(fields[6]),
    naps_status: clean(fields[2]),
    olt_id: clean(fields[8]),
    sell_status: null, // not present in this report format
    barangay_name: address.barangay,
  };
}

// "ZipCode: ...; State: NCR; City: QUEZON CITY; ... NORTHVIEW 1 BRGY. BATASAN HILLS"
function parseNAPAddress(addressField) {
  const parts = { state: null, city: null, barangay: null };
  if (!addressField) return parts;

  const state = addressField.match(/State:\s*([^;]+)/i);
  if (state) parts.state = clean(state[1]);
  const city = addressField.match(/City:\s*([^;]+)/i);
  if (city) parts.city = clean(city[1]);
  const barangay = addressField.match(/(?:BRGY\.|BARANGAY)\s*([^;,]+)/i);
  if (barangay) parts.barangay = clean(barangay[1]);

  return parts;
}

function clean(value) {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function toInt(value) {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
}

function toFloat(value) {
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

// Minimal CSV field splitter: this export quotes fields containing commas
// (225k of 322k rows are affected), and escapes inner quotes as "".
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

async function upsertBatch(client, batch) {
  const values = [];
  const placeholders = [];

  const columns = [
    'nap_id', 'cabinet', 'location_type', 'building_served', 'floors_served',
    'working_lines', 'vacant_lines', 'total_capacity', 'cfs_region', 'city_name',
    'province_name', 'dp_nap_lat', 'dp_nap_long', 'naps_status', 'olt_id',
    'sell_status', 'barangay_name',
  ];

  batch.forEach((record, i) => {
    const offset = i * columns.length;
    placeholders.push(
      `(${columns.map((_, j) => `$${offset + j + 1}`).join(',')})`
    );
    for (const column of columns) values.push(record[column]);
  });

  // UPSERT only: existing rows are refreshed, never deleted or pruned.
  const result = await client.query(
    `
    INSERT INTO naps (${columns.join(', ')})
    VALUES ${placeholders.join(',')}
    ON CONFLICT (nap_id) DO UPDATE SET
      cabinet         = EXCLUDED.cabinet,
      location_type   = EXCLUDED.location_type,
      building_served = EXCLUDED.building_served,
      floors_served   = EXCLUDED.floors_served,
      working_lines   = EXCLUDED.working_lines,
      vacant_lines    = EXCLUDED.vacant_lines,
      total_capacity  = EXCLUDED.total_capacity,
      cfs_region      = EXCLUDED.cfs_region,
      city_name       = EXCLUDED.city_name,
      province_name   = EXCLUDED.province_name,
      dp_nap_lat      = EXCLUDED.dp_nap_lat,
      dp_nap_long     = EXCLUDED.dp_nap_long,
      naps_status     = EXCLUDED.naps_status,
      olt_id          = EXCLUDED.olt_id,
      sell_status     = EXCLUDED.sell_status,
      barangay_name   = EXCLUDED.barangay_name,
      updated_at      = NOW()
    `,
    values
  );

  return result.rowCount;
}

importNaps()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('Import failed:', error.message);
    try {
      await pool.end();
    } catch (_) {
      // pool already closed
    }
    process.exit(1);
  });
