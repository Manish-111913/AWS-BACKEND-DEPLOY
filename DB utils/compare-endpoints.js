const { pool } = require('./config/database');

(async () => {
  try {
    console.log('Comparing dashboard alerts vs critical items endpoints...\n');
    
    // Test dashboard alerts query
    console.log('1. DASHBOARD ALERTS (/api/minimal-stock/dashboard-alerts/1):');
    console.log('==========================================================');
    
    const dashboardAlerts = await pool.query(`
      SELECT 
        ii.item_id,
        ii.name,
        ii.reorder_point,
        ii.safety_stock,
        COALESCE(SUM(ib.quantity), 0) as current_stock,
        gu.unit_symbol as unit,
        v.name as vendor_name,
        CASE 
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0) THEN 'critical'
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) THEN 'low'
          ELSE 'sufficient'
        END as urgency_level
      FROM InventoryItems ii
      LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
      LEFT JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
      LEFT JOIN Vendors v ON ii.default_vendor_id = v.vendor_id
      WHERE ii.business_id = $1 AND ii.is_active = true
      GROUP BY ii.item_id, ii.name, ii.reorder_point, ii.safety_stock, gu.unit_symbol, v.name
      HAVING 
        (COALESCE(SUM(ib.quantity), 0) < COALESCE(ii.reorder_point, 0) OR 
         COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0))
        AND (ii.reorder_point IS NOT NULL OR ii.safety_stock IS NOT NULL)
      ORDER BY ii.name
    `, [1]);
    
    console.log(`Count: ${dashboardAlerts.rows.length} items`);
    dashboardAlerts.rows.forEach(item => {
      console.log(`- ${item.name}: ${item.current_stock} ${item.unit || 'units'} (${item.urgency_level})`);
    });
    
    // Test critical items query
    console.log('\n2. CRITICAL ITEMS (/api/minimal-stock/critical-items/1):');
    console.log('=====================================================');
    
    const criticalItems = await pool.query(`
      SELECT 
        ii.item_id,
        ii.name,
        ii.reorder_point,
        ii.safety_stock,
        COALESCE(SUM(ib.quantity), 0) as current_stock,
        mst.tracking_phase,
        mst.is_learning_mode,
        CASE 
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0) THEN 'critical'
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) THEN 'low'
          ELSE 'sufficient'
        END as stock_status
      FROM InventoryItems ii
      LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
      LEFT JOIN MinimalStockTracking mst ON ii.item_id = mst.item_id
      LEFT JOIN Vendors v ON ii.default_vendor_id = v.vendor_id
      WHERE ii.business_id = $1 AND ii.is_active = true
      GROUP BY ii.item_id, ii.name, ii.reorder_point, ii.safety_stock, mst.tracking_phase, 
               mst.is_learning_mode, v.name, v.contact_phone
      HAVING 
        (COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) OR 
         COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0))
        AND mst.is_learning_mode = false
      ORDER BY ii.name
    `, [1]);
    
    console.log(`Count: ${criticalItems.rows.length} items`);
    criticalItems.rows.forEach(item => {
      console.log(`- ${item.name}: ${item.current_stock} (${item.stock_status}) - Phase: ${item.tracking_phase}, Learning: ${item.is_learning_mode}`);
    });
    
    // Check if there are items without MinimalStockTracking
    console.log('\n3. ITEMS WITHOUT TRACKING:');
    console.log('=========================');
    
    const untracked = await pool.query(`
      SELECT 
        ii.item_id,
        ii.name,
        COALESCE(SUM(ib.quantity), 0) as current_stock,
        ii.reorder_point
      FROM InventoryItems ii
      LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
      LEFT JOIN MinimalStockTracking mst ON ii.item_id = mst.item_id
      WHERE ii.business_id = $1 AND ii.is_active = true AND mst.item_id IS NULL
      GROUP BY ii.item_id, ii.name, ii.reorder_point, ii.safety_stock
      HAVING 
        (COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) OR 
         COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0))
        AND (ii.reorder_point IS NOT NULL OR ii.safety_stock IS NOT NULL)
      ORDER BY ii.name
    `, [1]);
    
    console.log(`Count: ${untracked.rows.length} items without tracking`);
    untracked.rows.forEach(item => {
      console.log(`- ${item.name}: ${item.current_stock} (no tracking entry)`);
    });
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
