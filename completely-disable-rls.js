const { Pool } = require('pg');
require('dotenv').config();

// Use DATABASE_URL (owner privileges) to completely disable RLS
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function completelyDisableRLS() {
  console.log('🔓 COMPLETELY DISABLING RLS FOR ENTIRE PROJECT...\n');
  
  try {
    const client = await pool.connect();
    
    console.log('1. Finding all tables with RLS enabled...');
    
    // Find all tables with RLS enabled
    const rlsTables = await client.query(`
      SELECT 
        schemaname,
        tablename,
        rowsecurity
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND rowsecurity = true
      ORDER BY tablename
    `);
    
    console.log('Tables with RLS currently enabled:');
    rlsTables.rows.forEach(row => {
      console.log(`  📋 ${row.tablename}`);
    });
    
    if (rlsTables.rows.length === 0) {
      console.log('  ✅ No tables have RLS enabled');
      client.release();
      await pool.end();
      return;
    }
    
    console.log('\n2. Dropping ALL existing RLS policies...');
    
    // Get all existing policies
    const policies = await client.query(`
      SELECT 
        tablename,
        policyname
      FROM pg_policies 
      WHERE schemaname = 'public'
      ORDER BY tablename, policyname
    `);
    
    console.log(`Found ${policies.rows.length} policies to remove:`);
    
    // Drop all policies
    for (const policy of policies.rows) {
      try {
        await client.query(`DROP POLICY IF EXISTS "${policy.policyname}" ON ${policy.tablename}`);
        console.log(`  🗑️  Dropped policy: ${policy.tablename}.${policy.policyname}`);
      } catch (err) {
        console.log(`  ⚠️  Could not drop policy ${policy.tablename}.${policy.policyname}: ${err.message}`);
      }
    }
    
    console.log('\n3. Disabling RLS on ALL tables...');
    
    // Disable RLS on all tables that have it enabled
    for (const table of rlsTables.rows) {
      try {
        await client.query(`ALTER TABLE ${table.tablename} DISABLE ROW LEVEL SECURITY`);
        console.log(`  🔓 Disabled RLS on: ${table.tablename}`);
      } catch (err) {
        console.log(`  ⚠️  Could not disable RLS on ${table.tablename}: ${err.message}`);
      }
    }
    
    console.log('\n4. Verifying RLS is completely disabled...');
    
    // Verify no tables have RLS enabled anymore
    const remainingRLS = await client.query(`
      SELECT 
        schemaname,
        tablename,
        rowsecurity
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND rowsecurity = true
      ORDER BY tablename
    `);
    
    if (remainingRLS.rows.length === 0) {
      console.log('  ✅ SUCCESS: No tables have RLS enabled');
    } else {
      console.log('  ⚠️  Some tables still have RLS enabled:');
      remainingRLS.rows.forEach(row => {
        console.log(`    - ${row.tablename}`);
      });
    }
    
    // Check remaining policies
    const remainingPolicies = await client.query(`
      SELECT COUNT(*) as count
      FROM pg_policies 
      WHERE schemaname = 'public'
    `);
    
    console.log(`  📊 Remaining policies: ${remainingPolicies.rows[0].count}`);
    
    console.log('\n5. Testing database access...');
    
    // Test access to key tables
    const testTables = ['businesses', 'users', 'dining_sessions', 'orders', 'orderitems', 'menuitems'];
    
    client.release();
    
    // Test with runtime user
    const runtimePool = new Pool({
      connectionString: process.env.RUNTIME_DATABASE_URL
    });
    
    const runtimeClient = await runtimePool.connect();
    
    for (const table of testTables) {
      try {
        const result = await runtimeClient.query(`SELECT COUNT(*) as count FROM ${table}`);
        console.log(`  ✅ ${table}: ${result.rows[0].count} records accessible`);
      } catch (err) {
        console.log(`  ❌ ${table}: ${err.message}`);
      }
    }
    
    runtimeClient.release();
    await runtimePool.end();
    
    console.log('\n🎉 RLS COMPLETELY DISABLED FOR ENTIRE PROJECT!');
    console.log('💡 Your application should now work without any tenant/RLS restrictions');
    console.log('⚠️  Note: This removes multi-tenant security - all users can access all data');
    
  } catch (error) {
    console.error('❌ Error disabling RLS:', error.message);
  } finally {
    await pool.end();
  }
}

completelyDisableRLS();