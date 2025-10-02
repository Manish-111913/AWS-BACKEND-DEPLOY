#!/usr/bin/env node
/**
 * force-rls.js
 * -------------------------------------------------
 * Applies FORCE ROW LEVEL SECURITY to every table that:
 *  1. Exists in the current database
 *  2. Has a column named business_id
 *  3. Already has RLS enabled (if not, it enables it)
 *
 * WHY:
 *  - Table owners and superusers bypass RLS unless FORCE is applied.
 *  - Your isolation tests showed leakage because the connection user owns the tables.
 *
 * SAFE:
 *  - Idempotent: skips if already forced.
 *  - Logs actions; errors per table are non-fatal unless critical.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set. Aborting.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('neon.tech') ? { rejectUnauthorized: false } : false
});

(async () => {
  const client = await pool.connect();
  try {
    console.log('🔒 Forcing RLS on tenant tables...');

    const tablesResult = await client.query(`
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON c.table_name = t.table_name AND t.table_schema='public'
      WHERE c.column_name = 'business_id'
        AND t.table_type='BASE TABLE'
      GROUP BY c.table_name
      ORDER BY c.table_name;
    `);

    for (const row of tablesResult.rows) {
      const table = row.table_name;
      try {
        // Enable RLS if not already
        await client.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
        // Force enforcement even for owner / bypass roles
        await client.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`);
        console.log(`✅ FORCED RLS: ${table}`);
      } catch (e) {
        console.log(`⚠️  Could not force RLS on ${table}: ${e.message}`);
      }
    }

    console.log('\n🎉 Completed FORCE RLS pass. Re-run multi-tenancy test now:');
    console.log('   node backend/scripts/test-multitenancy.js');
  } catch (e) {
    console.error('❌ Fatal error:', e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
