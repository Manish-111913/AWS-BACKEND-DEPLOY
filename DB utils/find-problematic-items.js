const { pool } = require('./config/database');

async function findProblematicItems() {
  try {
    console.log('🕵️ Looking for items that might incorrectly show badges...\n');
    
    // Find all recent manual items that might be causing issues
    const recentManualItems = await pool.query(`
      SELECT 
        name, 
        source, 
        created_at,
        CURRENT_DATE - created_at::date as days_since_added,
        item_id
      FROM inventoryitems 
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
      AND source = 'manual'
      ORDER BY created_at DESC
    `);
    
    console.log(`📦 Manual items created in last 7 days (${recentManualItems.rows.length} total):`);
    recentManualItems.rows.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.name} (ID: ${item.item_id}) - ${item.days_since_added} days ago`);
    });
    
    // Check specific items from screenshot
    const screenshotItems = ['Coconut Chutney', 'Cream', 'Fresh Fish Fillet'];
    console.log('\n🖼️ Screenshot items analysis:');
    
    for (const itemName of screenshotItems) {
      const item = await pool.query(`
        SELECT 
          name, 
          source, 
          created_at,
          CURRENT_DATE - created_at::date as days_since_added,
          item_id,
          CASE 
            WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' 
                 AND source = 'ingredient_mapping' THEN true
            ELSE false
          END as should_have_badge
        FROM inventoryitems 
        WHERE name = $1 AND business_id = 1
      `, [itemName]);
      
      if (item.rows.length > 0) {
        const itemData = item.rows[0];
        console.log(`  - ${itemName}:`);
        console.log(`    * Source: ${itemData.source}`);
        console.log(`    * Days ago: ${itemData.days_since_added}`);
        console.log(`    * Should have badge: ${itemData.should_have_badge ? 'YES' : 'NO'}`);
        console.log(`    * Problem: ${itemData.source === 'manual' && itemData.days_since_added <= 7 ? '⚠️ Recent manual item' : '✅ OK'}`);
      } else {
        console.log(`  - ${itemName}: Not found in database`);
      }
    }
    
    // Test the exact query logic from minimalStock.js
    console.log('\n🔬 Testing exact minimalStock.js logic:');
    const testLogic = await pool.query(`
      SELECT 
        name,
        source,
        created_at,
        CASE 
          WHEN created_at >= CURRENT_DATE - INTERVAL '7 days' 
               AND source = 'ingredient_mapping' THEN true
          ELSE false
        END as is_newly_added,
        CURRENT_DATE - created_at::date as days_since_added
      FROM inventoryitems 
      WHERE name IN ('Coconut Chutney', 'Cream', 'Fresh Fish Fillet', 'chicken legs', 'chicken pepper')
      AND business_id = 1
      ORDER BY source, name
    `);
    
    testLogic.rows.forEach(item => {
      const status = item.is_newly_added ? '🏷️ HAS BADGE' : '🚫 NO BADGE';
      console.log(`  ${item.name} (${item.source}) - Days: ${item.days_since_added} - ${status}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

findProblematicItems();
