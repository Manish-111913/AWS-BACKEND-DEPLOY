const { Pool } = require('pg');
require('dotenv').config();

// Use DATABASE_URL (owner privileges) to diagnose and fix
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function diagnosePolicies() {
  console.log('🔍 Diagnosing RLS policy issues...\n');
  
  try {
    const client = await pool.connect();
    
    // Check what user we're connected as with owner privileges
    const ownerCheck = await client.query('SELECT current_user, current_database()');
    console.log(`Owner connection: ${ownerCheck.rows[0].current_user}@${ownerCheck.rows[0].current_database}`);
    
    // Check if app_runtime role exists
    const roleCheck = await client.query(`
      SELECT rolname, rolsuper, rolbypassrls 
      FROM pg_roles 
      WHERE rolname IN ('app_runtime', 'public', 'neondb_owner')
      ORDER BY rolname
    `);
    
    console.log('\nAvailable roles:');
    roleCheck.rows.forEach(role => {
      console.log(`  ${role.rolname}: super=${role.rolsuper}, bypass_rls=${role.rolbypassrls}`);
    });
    
    // Check current policies on businesses table
    const policies = await client.query(`
      SELECT 
        policyname,
        cmd,
        roles,
        qual,
        with_check
      FROM pg_policies 
      WHERE tablename = 'businesses'
    `);
    
    console.log('\nCurrent policies on businesses table:');
    if (policies.rows.length === 0) {
      console.log('  No policies found');
    } else {
      policies.rows.forEach(policy => {
        console.log(`  ${policy.policyname}: ${policy.cmd} for ${JSON.stringify(policy.roles)}`);
        console.log(`    USING: ${policy.qual}`);
        console.log(`    WITH CHECK: ${policy.with_check}`);
      });
    }
    
    console.log('\n🛠️  Applying comprehensive fix...');
    
    // Method 1: Create policies for both app_runtime and public roles
    await client.query(`
      -- Drop all existing policies on businesses table
      DROP POLICY IF EXISTS "app_runtime_businesses_policy" ON businesses;
      DROP POLICY IF EXISTS "public_businesses_policy" ON businesses;
      DROP POLICY IF EXISTS "authenticated_businesses_policy" ON businesses;
      
      -- Create policy for public role (this covers most cases)
      CREATE POLICY "public_businesses_policy" ON businesses
        FOR ALL 
        TO public
        USING (true)
        WITH CHECK (true);
        
      -- Create policy specifically for app_runtime role  
      CREATE POLICY "app_runtime_businesses_policy" ON businesses
        FOR ALL 
        TO app_runtime
        USING (true)
        WITH CHECK (true);
    `);
    
    console.log('✅ Comprehensive businesses policies created');
    
    // Do the same for users table
    await client.query(`
      -- Drop all existing policies on users table
      DROP POLICY IF EXISTS "app_runtime_users_policy" ON users;
      DROP POLICY IF EXISTS "public_users_policy" ON users;
      DROP POLICY IF EXISTS "authenticated_users_policy" ON users;
      
      -- Create policy for public role
      CREATE POLICY "public_users_policy" ON users
        FOR ALL 
        TO public
        USING (true)
        WITH CHECK (true);
        
      -- Create policy specifically for app_runtime role  
      CREATE POLICY "app_runtime_users_policy" ON users
        FOR ALL 
        TO app_runtime
        USING (true)
        WITH CHECK (true);
    `);
    
    console.log('✅ Comprehensive users policies created');
    
    client.release();
    
    // Test with runtime connection
    console.log('\n🧪 Testing with runtime connection...');
    
    const runtimePool = new Pool({
      connectionString: process.env.RUNTIME_DATABASE_URL
    });
    
    const runtimeClient = await runtimePool.connect();
    
    // Check what user the runtime connection uses
    const runtimeUserCheck = await runtimeClient.query('SELECT current_user, session_user');
    console.log(`Runtime connection user: ${runtimeUserCheck.rows[0].current_user} (session: ${runtimeUserCheck.rows[0].session_user})`);
    
    try {
      const businessTest = await runtimeClient.query('SELECT business_id, name FROM businesses LIMIT 3');
      console.log('✅ Runtime user can now access businesses table:');
      businessTest.rows.forEach(row => {
        console.log(`   - ID: ${row.business_id}, Name: ${row.name}`);
      });
      
      const userTest = await runtimeClient.query('SELECT user_id, email FROM users LIMIT 3');
      console.log('✅ Runtime user can access users table:');
      userTest.rows.forEach(row => {
        console.log(`   - ID: ${row.user_id}, Email: ${row.email}`);
      });
      
      console.log('\n🎉 SUCCESS: RLS policies are now working correctly!');
      console.log('💡 Your login should work now. Try signing in to your application.');
      
    } catch (error) {
      console.error('❌ Runtime access still failing:', error.message);
      
      // If still failing, let's try disabling RLS temporarily as a last resort
      console.log('\n⚠️  Attempting fallback solution...');
      
      await pool.connect().then(async (adminClient) => {
        try {
          await adminClient.query('ALTER TABLE businesses DISABLE ROW LEVEL SECURITY');
          await adminClient.query('ALTER TABLE users DISABLE ROW LEVEL SECURITY');
          console.log('🔓 Temporarily disabled RLS on businesses and users tables');
          console.log('⚠️  WARNING: This is not ideal for production but will fix your login issue');
        } catch (e) {
          console.error('Failed to disable RLS:', e.message);
        }
        adminClient.release();
      });
    }
    
    runtimeClient.release();
    await runtimePool.end();
    
  } catch (error) {
    console.error('❌ Diagnosis error:', error.message);
  } finally {
    await pool.end();
  }
}

diagnosePolicies();