const { pool } = require('./config/database.js');

async function analyzeCategorization() {
  try {
    console.log('🔍 CATEGORIZATION ANALYSIS\n');
    console.log('========================================\n');
    
    // Check what inventory categories exist
    const categories = await pool.query(`
      SELECT ic.name as category_name, COUNT(ii.item_id) as item_count
      FROM InventoryCategories ic
      LEFT JOIN InventoryItems ii ON ic.category_id = ii.category_id AND ii.business_id = 1
      WHERE ic.business_id = 1
      GROUP BY ic.category_id, ic.name
      ORDER BY item_count DESC
    `);
    
    console.log('📋 EXISTING INVENTORY CATEGORIES:');
    categories.rows.forEach(cat => {
      console.log(`   ${cat.category_name}: ${cat.item_count} items`);
    });
    
    // Check items without categories
    const uncategorized = await pool.query(`
      SELECT COUNT(*) as count
      FROM InventoryItems ii
      WHERE ii.business_id = 1 AND ii.category_id IS NULL
    `);
    
    console.log(`\n❌ UNCATEGORIZED ITEMS: ${uncategorized.rows[0].count}`);
    
    // Show sample items by category
    const itemsByCategory = await pool.query(`
      SELECT ic.name as category_name, ii.name as item_name
      FROM InventoryItems ii
      LEFT JOIN InventoryCategories ic ON ii.category_id = ic.category_id
      WHERE ii.business_id = 1 AND ii.is_active = true
      ORDER BY ic.name, ii.name
      LIMIT 50
    `);
    
    console.log('\n📦 SAMPLE ITEMS BY CATEGORY:');
    let currentCategory = '';
    itemsByCategory.rows.forEach(item => {
      const category = item.category_name || 'UNCATEGORIZED';
      if (category !== currentCategory) {
        console.log(`\n  📁 ${category}:`);
        currentCategory = category;
      }
      console.log(`     • ${item.item_name}`);
    });
    
    // Check the current category mapping logic
    console.log('\n🔄 CURRENT CATEGORY MAPPING:');
    console.log('   Auto Ingredients → wholesale');
    console.log('   Spices & Seasonings → wholesale');
    console.log('   Grains & Cereals → wholesale');
    console.log('   Vegetables → vegetables');
    console.log('   Dairy Products → dairy');
    console.log('   Meat & Seafood → meat');
    console.log('   Seafood → seafood');
    console.log('   [anything else] → wholesale (default)');
    
    // Check what vendor categories are available
    const vendorCategories = await pool.query(`
      SELECT vendor_category, COUNT(*) as vendor_count, 
             array_agg(name ORDER BY name) as vendors
      FROM Vendors 
      WHERE business_id = 1 AND is_active = true
      GROUP BY vendor_category
      ORDER BY vendor_count DESC
    `);
    
    console.log('\n🏪 AVAILABLE VENDOR CATEGORIES:');
    vendorCategories.rows.forEach(cat => {
      console.log(`   ${cat.vendor_category}: ${cat.vendor_count} vendors (${cat.vendors.join(', ')})`);
    });
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    await pool.end();
  }
}

analyzeCategorization();
