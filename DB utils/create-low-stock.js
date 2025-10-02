const { pool } = require('./config/database');

(async () => {
  try {
    console.log('Creating low stock scenario...');
    
    // First, let's see current stock for Fresh Salmon Fillet
    const currentResult = await pool.query(`
      SELECT 
        ii.item_id, 
        ii.name, 
        ii.reorder_point,
        COALESCE(SUM(ib.quantity), 0) as current_stock_quantity
      FROM InventoryItems ii
      LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id
      WHERE ii.item_id = 3 AND ii.business_id = 1
      GROUP BY ii.item_id, ii.name, ii.reorder_point
    `);
    
    console.log('Current Fresh Salmon Fillet status:');
    console.log(currentResult.rows[0]);
    
    // Reduce the batch quantities to make it critically low
    await pool.query(`
      UPDATE InventoryBatches 
      SET quantity = 0.5 
      WHERE item_id = 3
    `);
    
    // Also set a higher reorder point to make it show as low stock
    await pool.query(`
      UPDATE InventoryItems 
      SET reorder_point = 5.0, manual_reorder_point = 5.0
      WHERE item_id = 3
    `);
    
    // Let's also create another low stock item - make Premium Chicken Breast low
    await pool.query(`
      UPDATE InventoryBatches 
      SET quantity = 1.0 
      WHERE item_id = 2
    `);
    
    await pool.query(`
      UPDATE InventoryItems 
      SET reorder_point = 8.0, manual_reorder_point = 8.0
      WHERE item_id = 2
    `);
    
    // Verify the changes
    const verifyResult = await pool.query(`
      SELECT 
        ii.item_id, 
        ii.name, 
        ii.reorder_point,
        COALESCE(SUM(ib.quantity), 0) as current_stock_quantity,
        CASE 
          WHEN COALESCE(SUM(ib.quantity), 0) < ii.reorder_point THEN 'LOW STOCK' 
          ELSE 'OK' 
        END as status
      FROM InventoryItems ii
      LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id
      WHERE ii.item_id IN (2, 3, 15, 33) AND ii.business_id = 1
      GROUP BY ii.item_id, ii.name, ii.reorder_point
      ORDER BY current_stock_quantity ASC
    `);
    
    console.log('\nUpdated stock status for key items:');
    console.log('=====================================');
    verifyResult.rows.forEach(item => {
      console.log(`${item.name}: ${item.current_stock_quantity} (Reorder: ${item.reorder_point}) - ${item.status}`);
    });
    
    // Count total low stock items
    const lowStockCount = await pool.query(`
      SELECT COUNT(*) as low_stock_count
      FROM (
        SELECT 
          ii.item_id,
          COALESCE(SUM(ib.quantity), 0) as current_stock_quantity,
          ii.reorder_point
        FROM InventoryItems ii
        LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id
        WHERE ii.business_id = 1 AND ii.is_active = true AND ii.reorder_point IS NOT NULL
        GROUP BY ii.item_id, ii.reorder_point
        HAVING COALESCE(SUM(ib.quantity), 0) < ii.reorder_point
      ) as low_stock_items
    `);
    
    console.log(`\nTotal low stock items: ${lowStockCount.rows[0].low_stock_count}`);
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
