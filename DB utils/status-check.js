const { Pool } = require('pg');
require('dotenv').config();

async function checkSystemStatus() {
  console.log('=== SYSTEM STATUS CHECK ===\n');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });
  
  try {
    // Test database connection
    await pool.query('SELECT NOW()');
    console.log('✅ Database: Connected');
    
    // Check vendors table
    const vendorCount = await pool.query('SELECT COUNT(*) FROM vendors WHERE business_id = 1');
    console.log(`📊 Vendors in DB: ${vendorCount.rows[0].count}`);
    
    // Check vendor categories
    const categories = await pool.query('SELECT DISTINCT category FROM vendors WHERE business_id = 1 ORDER BY category');
    console.log('📋 Categories:', categories.rows.map(r => r.category).join(', ') || 'None');
    
    // Add sample vendors if none exist
    if (vendorCount.rows[0].count === '0') {
      console.log('\n🔧 Adding sample vendors...');
      
      const sampleVendors = [
        ['Ocean Fresh Seafood', 'Premium seafood supplier', 'Seafood'],
        ['Tropical Fruits Co.', 'Fresh fruits supplier', 'Fruits'],
        ['Wholesale Mart', 'Bulk goods supplier', 'Wholesale'],
        ['Green Valley Vegetables', 'Fresh vegetables supplier', 'Vegetables'],
        ['Premium Meats', 'Quality meat supplier', 'Meat'],
        ['Dairy Express', 'Fresh dairy supplier', 'Dairy']
      ];
      
      for (const [name, description, category] of sampleVendors) {
        await pool.query(`
          INSERT INTO vendors (business_id, name, description, category, is_active) 
          VALUES (1, $1, $2, $3, true)
        `, [name, description, category]);
      }
      
      console.log('✅ Sample vendors added');
    }
    
    // Final check
    const finalVendors = await pool.query('SELECT name, category FROM vendors WHERE business_id = 1 ORDER BY category, name');
    console.log('\n📋 Final vendor list:');
    finalVendors.rows.forEach(v => console.log(`  ${v.category}: ${v.name}`));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

checkSystemStatus();
