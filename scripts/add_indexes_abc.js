// Creates helpful indexes for fast ABC analysis and stock/wastage queries
// Usage: node scripts/add_indexes_abc.js
const path = require('path');
// Load backend/.env explicitly so CWD doesn't matter
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Client } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL not set in environment');
  process.exit(1);
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function addIndexes() {
  console.log('🚀 Adding indexes for ABC & stock performance...');
  await client.connect();
  try {
    // Use a single transaction for consistency
    await client.query('BEGIN');

    // ABCAnalysisResults: by business and analysis window (period), and by item
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_abca_business_period
        ON ABCAnalysisResults (business_id, end_date DESC, start_date DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_abca_item_business
        ON ABCAnalysisResults (item_id, business_id);
    `);

    // StockOutRecords: for usage aggregations by item/business/date and reason splits
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_sor_business_item_reason_date
        ON StockOutRecords (business_id, item_id, reason_type, deducted_date);
    `);

    // InventoryBatches: for expiry and on-the-fly stock queries
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ib_item_expiry
        ON InventoryBatches (item_id, expiry_date);
    `);

    await client.query('COMMIT');
    console.log('✅ Indexes created (or already existed)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to add indexes:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

addIndexes();
