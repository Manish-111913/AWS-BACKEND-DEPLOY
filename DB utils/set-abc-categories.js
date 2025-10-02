require('dotenv').config();
const { pool } = require('./config/database');

async function setABCCategories() {
  try {
    console.log('🎯 Setting ABC Categories for Key Items');
    console.log('======================================');
    
    // Set some critical items as A category for demonstration
    const updates = [
      { name: 'Fresh Salmon Fillet', category: 'A' },
      { name: 'Fresh Fish Fillet', category: 'A' },
      { name: 'Onions', category: 'B' },
      { name: 'Red Chili Powder', category: 'C' },
      { name: 'Cumin Seeds', category: 'B' }
    ];
    
    for (const update of updates) {
      await pool.query(`
        UPDATE InventoryItems 
        SET = $1 
        WHERE name = $2 AND business_id = 1
      `, [update.category, update.name]);
      
      console.log(`✅ Updated ${update.name} → Category ${update.category}`);
    }
    
    console.log('\n🔍 Updated Item Categories:');
    const result = await pool.query(`
      SELECT 
        ii.name 
        COALESCE(SUM(ib.quantity), 0) as current_stock,
        ii.reorder_point, 
        ii.safety_stock
      FROM InventoryItems ii
      LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
      WHERE ii.business_id = 1 AND ii.is_active = true
      GROUP BY ii.item_id, ii.name ii.reorder_point, ii.safety_stock
      HAVING 
        (COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) OR 
         COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0))
        AND (ii.reorder_point IS NOT NULL OR ii.safety_stock IS NOT NULL)
      ORDER BY ii.name
    `);
    
    result.rows.forEach(item => {
      const category = item. || 'NULL';
      const status = item.current_stock <= item.safety_stock ? 'CRITICAL' : 'LOW';
      console.log(`${category} - ${item.name} (${status}): Stock=${item.current_stock}`);
    });
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

setABCCategories();
