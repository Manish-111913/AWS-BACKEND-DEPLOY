const { pool } = require('./config/database');

(async () => {
  try {
    console.log('Creating MinimalStockTracking entries for our low stock items...');
    
    // Get the low stock items that need tracking entries
    const lowStockItems = await pool.query(`
      SELECT DISTINCT ii.item_id, ii.name
      FROM InventoryItems ii
      LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
      WHERE ii.business_id = 1 AND ii.is_active = true
      GROUP BY ii.item_id, ii.name, ii.reorder_point, ii.safety_stock
      HAVING 
        (COALESCE(SUM(ib.quantity), 0) < COALESCE(ii.reorder_point, 0) OR 
         COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0))
        AND (ii.reorder_point IS NOT NULL OR ii.safety_stock IS NOT NULL)
    `);
    
    console.log(`Found ${lowStockItems.rows.length} items that need tracking entries:`);
    
    // Create tracking entries for these items
    for (const item of lowStockItems.rows) {
      await pool.query(`
        INSERT INTO MinimalStockTracking (
          item_id, business_id, tracking_phase, is_learning_mode, 
          data_collection_start_date, phase_3_start_date, created_at, updated_at
        ) 
        VALUES ($1, 1, 3, false, NOW() - INTERVAL '60 days', NOW() - INTERVAL '30 days', NOW(), NOW())
        ON CONFLICT (item_id, business_id) DO UPDATE SET
          tracking_phase = 3,
          is_learning_mode = false,
          phase_3_start_date = NOW() - INTERVAL '30 days',
          updated_at = NOW()
      `, [item.item_id]);
      
      console.log(`✅ Created tracking entry for: ${item.name}`);
    }
    
    console.log('\n🎉 All MinimalStockTracking entries created successfully!');
    console.log('Now testing the critical-items endpoint...\n');
    
    // Test the critical items endpoint
    const criticalItems = await pool.query(`
      SELECT 
        ii.item_id,
        ii.name,
        ii.reorder_point,
        ii.safety_stock,
        COALESCE(SUM(ib.quantity), 0) as current_stock,
        CASE 
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0) THEN 'critical'
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) THEN 'low'
          ELSE 'sufficient'
        END as stock_status
      FROM InventoryItems ii
      LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
      LEFT JOIN MinimalStockTracking mst ON ii.item_id = mst.item_id
      WHERE ii.business_id = $1 AND ii.is_active = true AND mst.is_learning_mode = false
      GROUP BY ii.item_id, ii.name, ii.reorder_point, ii.safety_stock
      HAVING 
        (COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) OR 
         COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0))
      ORDER BY 
        CASE 
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0) THEN 1
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) THEN 2
          ELSE 3
        END,
        ii.name
    `, [1]);
    
    console.log(`\n📋 Critical items now available for CreateReorder: ${criticalItems.rows.length}`);
    console.log('=====================================================');
    criticalItems.rows.forEach(item => {
      console.log(`- ${item.name}: ${item.current_stock} (Reorder: ${item.reorder_point || 'N/A'}) - ${item.stock_status.toUpperCase()}`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
