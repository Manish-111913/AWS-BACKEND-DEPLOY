const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

// Load environment variables. Prefer backend/.env (next to this config file)
// so scripts run from project root or other CWDs can still pick up backend config.
const backendEnv = path.join(__dirname, '..', '.env');
if (fs.existsSync(backendEnv)) {
  require('dotenv').config({ path: backendEnv });
  console.log('Loaded environment from:', backendEnv);
} else {
  // Fallback to process.cwd()/.env or system envs
  require('dotenv').config();
  console.log('Loaded environment from project root .env or system environment');
}

// Prefer RUNTIME_DATABASE_URL (non-bypass runtime role) over DATABASE_URL (may be owner)
const ACTIVE_DATABASE_URL = process.env.RUNTIME_DATABASE_URL || process.env.DATABASE_URL;

if (!ACTIVE_DATABASE_URL) {
  console.error('❌ Neither RUNTIME_DATABASE_URL nor DATABASE_URL is set!');
  console.log('Set at least DATABASE_URL (owner) or preferably RUNTIME_DATABASE_URL (restricted role).');
  process.exit(1);
}

// Parse the connection string to handle SSL properly
const toInt = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

const connectionConfig = {
  connectionString: ACTIVE_DATABASE_URL,
  max: toInt(process.env.PG_POOL_MAX, 20),
  idleTimeoutMillis: toInt(process.env.PG_IDLE_TIMEOUT_MS, 30000),
  connectionTimeoutMillis: toInt(process.env.PG_CONN_TIMEOUT_MS, 20000),
  // Driver-level timeout for queries
  query_timeout: toInt(process.env.PG_QUERY_TIMEOUT_MS, 120000),
  // Server-side statement timeout (ms)
  statement_timeout: toInt(process.env.PG_STATEMENT_TIMEOUT_MS, 120000),
  // Keep TCP connections alive to reduce reconnect churn on some hosts
  keepAlive: true,
};

// Add SSL configuration for Neon
if (ACTIVE_DATABASE_URL.includes('neon.tech')) {
  connectionConfig.ssl = {
    rejectUnauthorized: false
  };
} else {
  // For other providers, use minimal SSL
  connectionConfig.ssl = false;
}

const pool = new Pool(connectionConfig);

// Handle pool errors (non-fatal). Log and allow process to continue.
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  // Do not exit the process; transient network/idle errors can occur.
});

// Test database connection with retry logic
const testConnection = async (retries = 3) => {
  console.log('🔗 Testing database connection...');
  console.log('📍 Using URL preference: RUNTIME_DATABASE_URL' + (process.env.RUNTIME_DATABASE_URL ? ' ✅' : ' ❌') + ' | DATABASE_URL ' + (process.env.DATABASE_URL ? '✅' : '❌'));
  
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`🔄 Connection attempt ${i + 1}/${retries}...`);
      const client = await pool.connect();
  const result = await client.query(`SELECT NOW(), current_database(), current_user, (SELECT r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user) AS bypass_rls`);
      client.release();
      
      console.log('✅ Database connection successful!');
      console.log(`📅 Connected at: ${result.rows[0].now}`);
      console.log(`🗄️ Database: ${result.rows[0].current_database}`);
      console.log(`👤 User: ${result.rows[0].current_user} (bypass_rls=${result.rows[0].bypass_rls})`);
      if (result.rows[0].bypass_rls) {
        console.log('⚠️  WARNING: Connected role can BYPASS RLS. Multi-tenant leak tests will NOT be reliable.');
      }
      return true;
    } catch (error) {
      console.error(`❌ Connection attempt ${i + 1} failed:`, error.message);
      
      // Provide specific error guidance
      if (error.message.includes('SSL')) {
        console.log('💡 SSL Error - This might be a Neon database SSL configuration issue');
      } else if (error.message.includes('authentication')) {
        console.log('💡 Authentication Error - Check your username/password in DATABASE_URL');
      } else if (error.message.includes('timeout')) {
        console.log('💡 Timeout Error - The database server might be slow to respond');
      }
      
      if (i === retries - 1) {
        throw new Error(`Failed to connect to database after ${retries} attempts: ${error.message}`);
      }
      
      const waitTime = 2000 * (i + 1);
      console.log(`⏳ Waiting ${waitTime}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await pool.end();
  process.exit(0);
});

module.exports = { pool, testConnection };
