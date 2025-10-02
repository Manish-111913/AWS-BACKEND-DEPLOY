const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.RUNTIME_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function addPreparationTrackingColumns() {
  const client = await pool.connect();
  try {
    console.log('🔧 Adding preparation tracking columns to Orders table...');
    
    // Add preparation tracking columns to Orders table
    await client.query(`
      DO $$
      BEGIN
        -- Add preparation_started_at column
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='orders' AND column_name='preparation_started_at'
        ) THEN
          ALTER TABLE Orders ADD COLUMN preparation_started_at TIMESTAMP;
          RAISE NOTICE 'Added preparation_started_at column';
        END IF;
        
        -- Add preparation_completed_at column
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name='orders' AND column_name='preparation_completed_at'
        ) THEN
          ALTER TABLE Orders ADD COLUMN preparation_completed_at TIMESTAMP;
          RAISE NOTICE 'Added preparation_completed_at column';
        END IF;
      END
      $$;
    `);

    console.log('✅ Preparation tracking columns added successfully');

    // Create order status logs table for audit trail
    console.log('📋 Creating order status logs table...');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_status_logs (
        log_id SERIAL PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES Orders(order_id) ON DELETE CASCADE,
        old_status VARCHAR(50),
        new_status VARCHAR(50) NOT NULL,
        changed_by_user_id INTEGER REFERENCES Users(user_id),
        changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Add index for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_order_status_logs_order_id 
      ON order_status_logs(order_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_order_status_logs_changed_at 
      ON order_status_logs(changed_at);
    `);

    console.log('✅ Order status logs table created successfully');

    // Test the new columns
    console.log('🧪 Testing new columns...');
    
    const testResult = await client.query(`
      SELECT 
        column_name,
        data_type,
        is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'orders' 
        AND column_name IN ('preparation_started_at', 'preparation_completed_at')
      ORDER BY column_name;
    `);
    
    console.log('📊 New columns in Orders table:');
    testResult.rows.forEach(col => {
      console.log(`   ${col.column_name}: ${col.data_type} (${col.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });

  } catch (error) {
    console.error('❌ Error adding preparation tracking:', error.message);
  } finally {
    client.release();
    await pool.end();
  }
}

addPreparationTrackingColumns();