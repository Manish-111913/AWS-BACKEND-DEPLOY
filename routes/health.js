const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// Basic health check
router.get('/', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW() as server_time');
    client.release();

    res.status(200).json({
      success: true,
      message: 'Server is healthy',
      timestamp: new Date().toISOString(),
      database: 'Connected',
      server_time: result.rows[0].server_time
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({
      success: false,
      message: 'Server health check failed',
      error: error.message
    });
  }
});

// Database status check
router.get('/db-status', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query(`
      SELECT 
        NOW() as connected_at,
        current_database() as database,
        current_user as user,
        inet_server_addr() as host,
        inet_server_port() as port,
        version() as version
    `);
    client.release();

    const dbInfo = result.rows[0];
    
    // Determine if it's an online database (Neon, AWS RDS, etc.) or local
    const isOnlineDB = process.env.DATABASE_URL && (
      process.env.DATABASE_URL.includes('neon.tech') ||
      process.env.DATABASE_URL.includes('amazonaws.com') ||
      process.env.DATABASE_URL.includes('supabase.co') ||
      process.env.DATABASE_URL.includes('planetscale.com') ||
      !process.env.DATABASE_URL.includes('localhost')
    );

    console.log(`🗄️ Database Status Check - ${isOnlineDB ? 'ONLINE' : 'LOCAL'} DB`);
    console.log(`📍 Database: ${dbInfo.database}`);
    console.log(`👤 User: ${dbInfo.user}`);

    res.status(200).json({
      success: true,
      isOnlineDB,
      dbType: isOnlineDB ? 'Online Database' : 'Local Database',
      dbInfo: {
        database: dbInfo.database,
        user: dbInfo.user,
        host: dbInfo.host || 'localhost',
        port: dbInfo.port || '5432',
        connectedAt: dbInfo.connected_at,
        version: dbInfo.version
      },
      environment: {
        nodeEnv: process.env.NODE_ENV || 'development',
        port: process.env.PORT || 5000,
        hasDatabaseUrl: !!process.env.DATABASE_URL
      }
    });
  } catch (error) {
    console.error('Database status check failed:', error);
    res.status(500).json({
      success: false,
      message: 'Database status check failed',
      error: error.message,
      isOnlineDB: false
    });
  }
});

module.exports = router;