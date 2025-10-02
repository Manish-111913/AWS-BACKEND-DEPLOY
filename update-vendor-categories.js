const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function updateVendorCategories() {
  try {
    console.log('Starting vendor category update...');
    
    // Update existing vendor categories to match new filter system
    await pool.query(`
      UPDATE vendors 
      SET category = CASE 
        WHEN category = 'Produce' THEN 'Vegetables'
        WHEN category = 'Beverages' THEN 'Wholesale'
        ELSE category 
      END 
      WHERE business_id = 1
    `);
    
    // Insert sample vendors for each new category if they don't exist
    const sampleVendors = [
      ['Ocean Fresh Seafood', 'Premium quality fresh seafood supplier', 'Seafood'],
      ['Tropical Fruits Co.', 'Fresh seasonal fruits from local farms', 'Fruits'],
      ['Wholesale Mart', 'Bulk supplies and dry goods distributor', 'Wholesale'],
      ['Green Valley Vegetables', 'Farm fresh vegetables daily delivery', 'Vegetables'],
      ['Premium Meats', 'High quality meat and poultry supplier', 'Meat'],
      ['Dairy Express', 'Fresh dairy products and milk supplier', 'Dairy']
    ];
    
    for (const [name, description, category] of sampleVendors) {
      await pool.query(`
        INSERT INTO vendors (business_id, name, description, category, is_active) 
        VALUES (1, $1, $2, $3, true)
        ON CONFLICT (business_id, name) DO UPDATE SET category = EXCLUDED.category
      `, [name, description, category]);
    }
    
    console.log('Vendor categories updated successfully!');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
  }
}

updateVendorCategories();
