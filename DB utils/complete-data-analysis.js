const { pool } = require('./config/database');

(async () => {
  try {
    console.log('🔍 COMPLETE DATA FLOW ANALYSIS: Stock Items & Reorder Points\n');
    console.log('=' * 80);
    
    // 1. Check InventoryItems table structure
    console.log('1. INVENTORYITEMS TABLE (Master Data):');
    console.log('=====================================');
    
    const inventoryItemsSchema = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'inventoryitems' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    console.log('Columns in InventoryItems:');
    inventoryItemsSchema.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : '(NULLABLE)'}`);
    });
    
    // 2. Check InventoryBatches table structure  
    console.log('\n2. INVENTORYBATCHES TABLE (Current Stock):');
    console.log('==========================================');
    
    const inventoryBatchesSchema = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'inventorybatches' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    console.log('Columns in InventoryBatches:');
    inventoryBatchesSchema.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : '(NULLABLE)'}`);
    });
    
    // 3. Check ReorderPointCalculations table
    console.log('\n3. REORDERPOINTCALCULATIONS TABLE (Calculated Reorder Points):');
    console.log('==============================================================');
    
    const reorderPointSchema = await pool.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'reorderpointcalculations' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    console.log('Columns in ReorderPointCalculations:');
    reorderPointSchema.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : '(NULLABLE)'}`);
    });
    
    // 4. Sample data from each table
    console.log('\n4. SAMPLE DATA FROM KEY TABLES:');
    console.log('===============================');
    
    console.log('\nInventoryItems Sample (first 3 low stock items):');
    const sampleInventoryItems = await pool.query(`
      SELECT item_id, name, reorder_point, safety_stock, manual_reorder_point, default_vendor_id, is_active
      FROM InventoryItems 
      WHERE business_id = 1 AND is_active = true 
      AND (reorder_point IS NOT NULL OR safety_stock IS NOT NULL)
      ORDER BY item_id LIMIT 3
    `);
    
    sampleInventoryItems.rows.forEach(item => {
      console.log(`  ID: ${item.item_id} | Name: ${item.name} | ROP: ${item.reorder_point} | Safety: ${item.safety_stock} | Manual ROP: ${item.manual_reorder_point}`);
    });
    
    console.log('\nInventoryBatches Sample (first 3 items):');
    const sampleBatches = await pool.query(`
      SELECT ib.batch_id, ib.item_id, ib.quantity, ib.is_expired, ii.name
      FROM InventoryBatches ib
      JOIN InventoryItems ii ON ib.item_id = ii.item_id
      WHERE ii.business_id = 1
      ORDER BY ib.item_id LIMIT 3
    `);
    
    sampleBatches.rows.forEach(batch => {
      console.log(`  Batch: ${batch.batch_id} | Item: ${batch.name} (ID: ${batch.item_id}) | Qty: ${batch.quantity} | Expired: ${batch.is_expired}`);
    });
    
    console.log('\nReorderPointCalculations Sample:');
    const sampleReorderCalcs = await pool.query(`
      SELECT rpc.item_id, ii.name, rpc.average_daily_consumption, rpc.average_lead_time_days, 
             rpc.safety_stock_quantity, rpc.reorder_point_quantity
      FROM ReorderPointCalculations rpc
      JOIN InventoryItems ii ON rpc.item_id = ii.item_id
      WHERE ii.business_id = 1
      ORDER BY rpc.item_id LIMIT 3
    `);
    
    if (sampleReorderCalcs.rows.length > 0) {
      sampleReorderCalcs.rows.forEach(calc => {
        console.log(`  Item: ${calc.name} | Daily Consumption: ${calc.average_daily_consumption} | Lead Time: ${calc.average_lead_time_days} days | Calculated ROP: ${calc.reorder_point_quantity}`);
      });
    } else {
      console.log('  No calculated reorder points found');
    }
    
    // 5. Show how current stock is calculated
    console.log('\n5. CURRENT STOCK CALCULATION:');
    console.log('=============================');
    
    const stockCalculation = await pool.query(`
      SELECT 
        ii.item_id,
        ii.name,
        ii.reorder_point as manual_reorder_point,
        ii.safety_stock as manual_safety_stock,
        COUNT(ib.batch_id) as total_batches,
        COALESCE(SUM(ib.quantity), 0) as current_stock_total,
        COALESCE(SUM(CASE WHEN ib.is_expired = false THEN ib.quantity ELSE 0 END), 0) as current_stock_non_expired
      FROM InventoryItems ii
      LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id
      WHERE ii.business_id = 1 AND ii.is_active = true
      AND (ii.reorder_point IS NOT NULL OR ii.safety_stock IS NOT NULL)
      GROUP BY ii.item_id, ii.name, ii.reorder_point, ii.safety_stock
      ORDER BY current_stock_non_expired ASC
      LIMIT 5
    `);
    
    console.log('Stock calculation for lowest 5 items:');
    stockCalculation.rows.forEach(item => {
      console.log(`  ${item.name}: ${item.current_stock_non_expired} units (from ${item.total_batches} batches) | ROP: ${item.manual_reorder_point} | Safety: ${item.manual_safety_stock}`);
    });
    
    // 6. Check MinimalStockTracking table
    console.log('\n6. MINIMALSTOCKTRACKING TABLE (Automation System):');
    console.log('=================================================');
    
    const trackingSchema = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'minimalstocktracking' AND table_schema = 'public'
      ORDER BY ordinal_position
    `);
    
    console.log('Columns in MinimalStockTracking:');
    trackingSchema.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? '(NOT NULL)' : '(NULLABLE)'}`);
    });
    
    console.log('\nMinimalStockTracking Sample:');
    const sampleTracking = await pool.query(`
      SELECT mst.item_id, ii.name, mst.tracking_phase, mst.is_learning_mode, 
             mst.preliminary_daily_consumption, mst.refined_daily_consumption
      FROM MinimalStockTracking mst
      JOIN InventoryItems ii ON mst.item_id = ii.item_id
      WHERE ii.business_id = 1
      ORDER BY mst.item_id LIMIT 3
    `);
    
    if (sampleTracking.rows.length > 0) {
      sampleTracking.rows.forEach(track => {
        console.log(`  ${track.name}: Phase ${track.tracking_phase} | Learning: ${track.is_learning_mode} | Consumption: ${track.refined_daily_consumption || track.preliminary_daily_consumption || 'Not calculated'}`);
      });
    } else {
      console.log('  No tracking data found');
    }
    
    console.log('\n7. DATA FLOW SUMMARY:');
    console.log('====================');
    console.log('Frontend Request → /api/minimal-stock/dashboard-alerts/1');
    console.log('↓');
    console.log('Backend Query Joins:');
    console.log('  • InventoryItems (ii) - Master item data, manual reorder_point, safety_stock');
    console.log('  • InventoryBatches (ib) - Current stock quantities (SUM of non-expired batches)');
    console.log('  • GlobalUnits (gu) - Unit symbols (kg, L, g, etc.)');
    console.log('  • Vendors (v) - Vendor information for default suppliers');
    console.log('↓');
    console.log('Logic:');
    console.log('  • current_stock = SUM(ib.quantity) WHERE is_expired = false');
    console.log('  • urgency_level = CRITICAL if current_stock <= safety_stock');
    console.log('  • urgency_level = LOW if current_stock <= reorder_point');
    console.log('  • Only items with reorder_point OR safety_stock NOT NULL are included');
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
})();
