require('dotenv').config();
const { pool } = require('./config/database');

async function demonstrateFiltering() {
  try {
    console.log('🎯 DEMONSTRATION: ABC Category Filtering for Critical Alerts');
    console.log('==========================================================');
    
    console.log('\n📊 ALL Low Stock Items (Before Filtering):');
    console.log('==========================================');
    
    const allItems = await pool.query(`
      SELECT 
        ii.name
        COALESCE(SUM(ib.quantity), 0) as current_stock,
        ii.reorder_point,
        ii.safety_stock,
        CASE 
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0) THEN 'critical'
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) THEN 'low'
          ELSE 'sufficient'
        END as urgency_level
      FROM InventoryItems ii
      LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
      WHERE ii.business_id = 1 AND ii.is_active = true
      GROUP BY ii.item_id, ii.name ii.reorder_point, ii.safety_stock
      HAVING 
        (COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) OR 
         COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0))
        AND (ii.reorder_point IS NOT NULL OR ii.safety_stock IS NOT NULL)
      ORDER BY urgency_level ii.name
    `);
    
    let criticalCount = 0;
    let lowCount = 0;
    
    allItems.rows.forEach(item => {
      const category = item. || 'NULL';
      const icon = item.urgency_level === 'critical' ? '🔴' : '🟡';
      console.log(`${icon} ${item.name} (${category}) - Stock: ${item.current_stock} - ${item.urgency_level.toUpperCase()}`);
      
      if (item.urgency_level === 'critical') criticalCount++;
      if (item.urgency_level === 'low') lowCount++;
    });
    
    console.log(`\nTotal: ${criticalCount} critical + ${lowCount} low = ${allItems.rows.length} items`);
    
    console.log('\n✅ FILTERED Results (After ABC Filtering):');
    console.log('=========================================');
    console.log('Critical alerts: Only A-category items');
    console.log('Low stock alerts: All categories (A, B, C)');
    console.log('');
    
    // Show what the API actually returns
    const filteredItems = await pool.query(`
      SELECT 
        ii.name
        COALESCE(SUM(ib.quantity), 0) as current_stock,
        ii.reorder_point,
        ii.safety_stock,
        CASE 
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0) THEN 'critical'
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) THEN 'low'
          ELSE 'sufficient'
        END as urgency_level
      FROM InventoryItems ii
      LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
      WHERE ii.business_id = 1 AND ii.is_active = true
      GROUP BY ii.item_id, ii.name ii.reorder_point, ii.safety_stock
      HAVING 
        (COALESCE(SUM(ib.quantity), 0) < COALESCE(ii.reorder_point, 0) OR 
         COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0))
        AND (ii.reorder_point IS NOT NULL OR ii.safety_stock IS NOT NULL)
        AND (
          -- Show critical items only if they are A category OR if urgency is just 'low'
          (COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0) AND = 'A') OR
          (COALESCE(SUM(ib.quantity), 0) > COALESCE(ii.safety_stock, 0) AND COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0))
        )
      ORDER BY urgency_level ii.name
    `);
    
    let filteredCritical = 0;
    let filteredLow = 0;
    
    filteredItems.rows.forEach(item => {
      const category = item. || 'NULL';
      const icon = item.urgency_level === 'critical' ? '✅🔴' : '✅🟡';
      console.log(`${icon} ${item.name} (${category}) - Stock: ${item.current_stock} - ${item.urgency_level.toUpperCase()}`);
      
      if (item.urgency_level === 'critical') filteredCritical++;
      if (item.urgency_level === 'low') filteredLow++;
    });
    
    console.log(`\nFiltered Total: ${filteredCritical} critical + ${filteredLow} low = ${filteredItems.rows.length} items`);
    
    console.log('\n🎯 Summary of Changes:');
    console.log('=====================');
    console.log(`Before: ${criticalCount} critical items (all categories)`);
    console.log(`After:  ${filteredCritical} critical items (A-category only)`);
    console.log(`Hidden: ${criticalCount - filteredCritical} non-A critical items`);
    console.log(`Low stock items remain unchanged: ${lowCount} items`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

demonstrateFiltering();
