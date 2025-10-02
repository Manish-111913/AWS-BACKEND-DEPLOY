const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const fetch = require('node-fetch');
const MinimalStockService = require('../services/MinimalStockService');

// =================== PHASE 1: AUTOMATED DATA COLLECTION LOGIC ===================

// Initialize tracking for new inventory items (Day 1-7)
const initializeItemTracking = async (itemId, businessId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Check if item tracking already exists
    const existingTracking = await client.query(`
      SELECT * FROM MinimalStockTracking 
      WHERE item_id = $1 AND business_id = $2
    `, [itemId, businessId]);
    
    if (existingTracking.rows.length === 0) {
      // Initialize new item tracking with Phase 1 status
      await client.query(`
        INSERT INTO MinimalStockTracking (
          item_id, business_id, tracking_phase, data_collection_start_date,
          is_learning_mode, total_consumption_recorded, total_usage_days
        ) VALUES ($1, $2, 1, CURRENT_DATE, true, 0, 0)
      `, [itemId, businessId]);
      
      console.log(`🎯 Phase 1 initiated for item ${itemId}: 7-day learning mode started`);
    }
    
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Record usage/wastage during data collection (Phase 1)
const recordItemUsage = async (itemId, businessId, quantity, usageType = 'usage') => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get current tracking status
    const trackingResult = await client.query(`
      SELECT * FROM MinimalStockTracking 
      WHERE item_id = $1 AND business_id = $2
    `, [itemId, businessId]);
    
    if (trackingResult.rows.length === 0) {
      // Initialize tracking if doesn't exist
      await initializeItemTracking(itemId, businessId);
    }
    
    const tracking = trackingResult.rows[0];
    
    // Record the usage event
    await client.query(`
      INSERT INTO ItemUsageHistory (
        item_id, business_id, usage_date, quantity_used, usage_type,
        tracking_phase, recorded_at
      ) VALUES ($1, $2, CURRENT_DATE, $3, $4, $5, NOW())
    `, [itemId, businessId, quantity, usageType, tracking.tracking_phase || 1]);
    
    // Update tracking statistics
    await client.query(`
      UPDATE MinimalStockTracking 
      SET 
        total_consumption_recorded = total_consumption_recorded + $3,
        total_usage_days = (
          SELECT COUNT(DISTINCT usage_date) 
          FROM ItemUsageHistory 
          WHERE item_id = $1 AND business_id = $2
        ),
        last_usage_recorded = NOW()
      WHERE item_id = $1 AND business_id = $2
    `, [itemId, businessId, quantity]);
    
    await client.query('COMMIT');
    console.log(`📊 Usage recorded: ${quantity} units of item ${itemId} (${usageType})`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// =================== PHASE 2: TRANSITION TO PRELIMINARY AUTOMATION ===================

// Calculate preliminary average daily consumption after 7 days
const calculatePreliminaryConsumption = async (itemId, businessId) => {
  const client = await pool.connect();
  try {
    // Get usage data from the past 7 days
    const usageData = await client.query(`
      SELECT 
        SUM(quantity_used) as total_consumption,
        COUNT(DISTINCT usage_date) as usage_days
      FROM ItemUsageHistory 
      WHERE item_id = $1 AND business_id = $2 
        AND usage_date >= CURRENT_DATE - INTERVAL '7 days'
    `, [itemId, businessId]);
    
    const { total_consumption, usage_days } = usageData.rows[0];
    
    if (usage_days >= 5) { // Need at least 5 days of data for reliability
      const preliminaryAverage = parseFloat(total_consumption) / parseInt(usage_days);
      
      // Update tracking to Phase 2
      await client.query(`
        UPDATE MinimalStockTracking 
        SET 
          tracking_phase = 2,
          preliminary_daily_consumption = $3,
          phase_2_start_date = CURRENT_DATE,
          is_learning_mode = false
        WHERE item_id = $1 AND business_id = $2
      `, [itemId, businessId, preliminaryAverage]);
      
      console.log(`🔄 Phase 2 activated for item ${itemId}: Preliminary consumption ${preliminaryAverage}/day`);
      return preliminaryAverage;
    }
    
    return null;
  } finally {
    client.release();
  }
};

// =================== PHASE 3: FULL AUTOMATION & REFINED ANALYSIS ===================

// Calculate refined average daily consumption after 14 days
const calculateRefinedConsumption = async (itemId, businessId) => {
  const client = await pool.connect();
  try {
    // Get usage data from the past 30 days (or available data if less)
    const usageData = await client.query(`
      SELECT 
        SUM(quantity_used) as total_consumption,
        COUNT(DISTINCT usage_date) as usage_days,
        AVG(daily_consumption) as rolling_average
      FROM (
        SELECT 
          usage_date,
          SUM(quantity_used) as daily_consumption
        FROM ItemUsageHistory 
        WHERE item_id = $1 AND business_id = $2 
          AND usage_date >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY usage_date
      ) daily_usage
    `, [itemId, businessId]);
    
    const { total_consumption, usage_days, rolling_average } = usageData.rows[0];
    
    if (usage_days >= 14) { // Need at least 14 days for Phase 3
      const refinedAverage = parseFloat(rolling_average);
      
      // Update tracking to Phase 3
      await client.query(`
        UPDATE MinimalStockTracking 
        SET 
          tracking_phase = 3,
          refined_daily_consumption = $3,
          phase_3_start_date = CURRENT_DATE
        WHERE item_id = $1 AND business_id = $2
      `, [itemId, businessId, refinedAverage]);
      
      console.log(`⚡ Phase 3 activated for item ${itemId}: Refined consumption ${refinedAverage}/day`);
      return refinedAverage;
    }
    
    return null;
  } finally {
    client.release();
  }
};

// =================== LEAD TIME CALCULATION LOGIC ===================

// Calculate average lead time for vendor-item combination
const calculateAverageLeadTime = async (itemId, vendorId, businessId) => {
  const client = await pool.connect();
  try {
    const leadTimeData = await client.query(`
      SELECT 
        AVG(EXTRACT(DAY FROM (sir.received_date - po.order_date))) as avg_lead_time_days,
        COUNT(*) as order_count
      FROM PurchaseOrders po
      JOIN PurchaseOrderLineItems poli ON po.po_id = poli.po_id
      JOIN StockInRecords sir ON po.vendor_id = sir.vendor_id
      WHERE poli.item_id = $1 
        AND po.vendor_id = $2 
        AND po.business_id = $3
        AND po.status = 'Received'
        AND sir.received_date >= CURRENT_DATE - INTERVAL '6 months'
    `, [itemId, vendorId, businessId]);
    
    const { avg_lead_time_days, order_count } = leadTimeData.rows[0];
    
    if (order_count >= 2) { // Need at least 2 orders for reliability
      const averageLeadTime = parseFloat(avg_lead_time_days) || 3; // Default 3 days if null
      
      // Store lead time calculation
      await client.query(`
        INSERT INTO VendorLeadTimes (item_id, vendor_id, business_id, avg_lead_time_days, order_count, calculated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (item_id, vendor_id, business_id) 
        DO UPDATE SET 
          avg_lead_time_days = EXCLUDED.avg_lead_time_days,
          order_count = EXCLUDED.order_count,
          calculated_at = EXCLUDED.calculated_at
      `, [itemId, vendorId, businessId, averageLeadTime, order_count]);
      
      return averageLeadTime;
    }
    
    return 3; // Default lead time if insufficient data
  } finally {
    client.release();
  }
};

// =================== SAFETY STOCK & REORDER POINT CALCULATION ===================

// Calculate comprehensive reorder point
const calculateReorderPoint = async (itemId, businessId) => {
  const client = await pool.connect();
  try {
    // Get current tracking data
    const trackingResult = await client.query(`
      SELECT * FROM MinimalStockTracking 
      WHERE item_id = $1 AND business_id = $2
    `, [itemId, businessId]);
    
    if (trackingResult.rows.length === 0) {
      return null; // Item not tracked yet
    }
    
    const tracking = trackingResult.rows[0];
    
    // Skip calculation if still in Phase 1 learning mode
    if (tracking.is_learning_mode) {
      return null;
    }
    
    // Get appropriate daily consumption based on phase
    let dailyConsumption;
    if (tracking.tracking_phase === 2) {
      dailyConsumption = tracking.preliminary_daily_consumption;
    } else if (tracking.tracking_phase >= 3) {
      dailyConsumption = tracking.refined_daily_consumption;
    } else {
      return null;
    }
    
    // Get item details including default vendor
    const itemResult = await client.query(`
      SELECT default_vendor_id, safety_stock FROM InventoryItems 
      WHERE item_id = $1 AND business_id = $2
    `, [itemId, businessId]);
    
    if (itemResult.rows.length === 0) {
      return null;
    }
    
    const { default_vendor_id, safety_stock } = itemResult.rows[0];
    
    // Calculate average lead time
    const averageLeadTime = await calculateAverageLeadTime(itemId, default_vendor_id, businessId);
    
    // Calculate lead time consumption
    const leadTimeConsumption = dailyConsumption * averageLeadTime;
    
    // Calculate safety stock (use database value or 50% of daily consumption)
    const safetyStockAmount = safety_stock || (dailyConsumption * 0.5);
    
    // Final reorder point calculation
    const reorderPoint = leadTimeConsumption + safetyStockAmount;
    
    // Update reorder point calculations table
    await client.query(`
      INSERT INTO ReorderPointCalculations (
        item_id, average_daily_consumption, average_lead_time_days,
        safety_stock_quantity, reorder_point_quantity, last_calculated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (item_id) 
      DO UPDATE SET 
        average_daily_consumption = EXCLUDED.average_daily_consumption,
        average_lead_time_days = EXCLUDED.average_lead_time_days,
        safety_stock_quantity = EXCLUDED.safety_stock_quantity,
        reorder_point_quantity = EXCLUDED.reorder_point_quantity,
        last_calculated_at = EXCLUDED.last_calculated_at
    `, [itemId, dailyConsumption, averageLeadTime, safetyStockAmount, reorderPoint]);
    
    // Fetch old reorder point to compare
    const oldRes = await client.query('SELECT reorder_point FROM InventoryItems WHERE item_id = $1', [itemId]);
    const oldRP = Number(oldRes.rows[0]?.reorder_point || 0);

    // Update inventory item with calculated reorder point
    await client.query(`
      UPDATE InventoryItems 
      SET reorder_point = $2, updated_at = NOW()
      WHERE item_id = $1
    `, [itemId, reorderPoint]);

    // Trigger reorder point change notification if significant (>10% change)
    try {
      const denom = oldRP === 0 ? (reorderPoint === 0 ? 1 : reorderPoint) : oldRP;
      const deltaPct = Math.abs(reorderPoint - oldRP) / denom;
      if (deltaPct >= 0.10) {
        const nameRes = await client.query(
          `SELECT ii.name, COALESCE(NULLIF(TRIM(gu.unit_symbol), ''), gu.unit_name) AS unit_label
           FROM InventoryItems ii JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
           WHERE ii.item_id = $1 LIMIT 1`, [itemId]
        );
        const itemName = nameRes.rows[0]?.name || `Item ${itemId}`;
        const unitLabel = nameRes.rows[0]?.unit_label || '';
        await fetch(`${process.env.API_BASE_URL || 'http://localhost:5000'}/api/notifications/minimal-stock/reorder-point-change`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessId, userId: 1, itemName, oldQuantity: oldRP, newQuantity: reorderPoint, unitLabel })
        });
      }
    } catch (_) {}
    
    console.log(`📊 Reorder point calculated for item ${itemId}: ${reorderPoint} units`);
    console.log(`   - Daily consumption: ${dailyConsumption}`);
    console.log(`   - Lead time: ${averageLeadTime} days`);
    console.log(`   - Safety stock: ${safetyStockAmount}`);
    
    return {
      itemId,
      dailyConsumption,
      averageLeadTime,
      leadTimeConsumption,
      safetyStockAmount,
      reorderPoint,
      trackingPhase: tracking.tracking_phase
    };
    
  } finally {
    client.release();
  }
};

// =================== API ENDPOINTS ===================

// POST /api/minimal-stock/record-usage - Record item usage from Stock Out
router.post('/record-usage', async (req, res) => {
  try {
    const { itemId, businessId, quantity, usageType = 'usage' } = req.body;
    
    if (!itemId || !businessId || !quantity) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: itemId, businessId, quantity'
      });
    }
    
    await recordItemUsage(itemId, businessId, parseFloat(quantity), usageType);
    
    res.json({
      success: true,
      message: 'Usage recorded successfully',
      data: { itemId, quantity, usageType }
    });
    
  } catch (error) {
    console.error('Error recording usage:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record usage',
      details: error.message
    });
  }
});

// POST /api/minimal-stock/initialize-item - Initialize tracking for new items
router.post('/initialize-item', async (req, res) => {
  try {
    const { itemId, businessId } = req.body;
    
    if (!itemId || !businessId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: itemId, businessId'
      });
    }
    
    await initializeItemTracking(itemId, businessId);
    
    res.json({
      success: true,
      message: 'Item tracking initialized - Phase 1 learning mode started',
      data: { itemId, phase: 1, learningMode: true }
    });
    
  } catch (error) {
    console.error('Error initializing item tracking:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to initialize item tracking',
      details: error.message
    });
  }
});

// POST /api/minimal-stock/calculate-reorder-points - Calculate reorder points for all items
router.post('/calculate-reorder-points', async (req, res) => {
  try {
    const { businessId } = req.body;
    
    if (!businessId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: businessId'
      });
    }
    
    // Get all items that need reorder point calculation
    const itemsResult = await pool.query(`
      SELECT ii.item_id, ii.name, mst.tracking_phase, mst.is_learning_mode
      FROM InventoryItems ii
      LEFT JOIN MinimalStockTracking mst ON ii.item_id = mst.item_id
      WHERE ii.business_id = $1 AND ii.is_active = true
    `, [businessId]);
    
    const calculations = [];
    let phase1Count = 0;
    let phase2Count = 0;
    let phase3Count = 0;
    
    for (const item of itemsResult.rows) {
      if (item.is_learning_mode) {
        phase1Count++;
        continue; // Skip Phase 1 items
      }
      
      const calculation = await calculateReorderPoint(item.item_id, businessId);
      if (calculation) {
        calculations.push({
          ...calculation,
          itemName: item.name
        });
        
        if (calculation.trackingPhase === 2) phase2Count++;
        if (calculation.trackingPhase === 3) phase3Count++;
      }
    }

    // After calculations, run no-reorder-point check notification (for items still missing values)
    try {
      await fetch(`${process.env.API_BASE_URL || 'http://localhost:5000'}/api/notifications/minimal-stock/no-reorder-point/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, userId: 1, days: 7 })
      });
    } catch (_) {}
    
    res.json({
      success: true,
      message: 'Reorder points calculated successfully',
      data: {
        calculations,
        summary: {
          totalItems: itemsResult.rows.length,
          phase1Learning: phase1Count,
          phase2Preliminary: phase2Count,
          phase3Refined: phase3Count,
          calculationsCompleted: calculations.length
        }
      }
    });
    
  } catch (error) {
    console.error('Error calculating reorder points:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate reorder points',
      details: error.message
    });
  }
});

// GET /api/minimal-stock/critical-items/:businessId - Get critical low stock items
router.get('/critical-items/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    const criticalItems = await pool.query(`
      SELECT 
        ii.item_id,
        ii.name,
        ii.reorder_point,
        ii.safety_stock,
        COALESCE(abc.abc_category, 'C') as abc_category,
        ii.created_at,
        ii.source,
        COALESCE(SUM(ib.quantity), 0) as current_stock,
        mst.tracking_phase,
        mst.is_learning_mode,
        rpc.average_daily_consumption,
        rpc.average_lead_time_days,
        v.name as vendor_name,
        v.contact_phone as vendor_phone,
        CASE 
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0) THEN 'critical'
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) THEN 'low'
          ELSE 'sufficient'
        END as stock_status,
        -- Check if item is newly added from ingredient mapping (within 7 days)
        CASE 
          WHEN ii.created_at >= CURRENT_DATE - INTERVAL '7 days' 
               AND ii.source = 'ingredient_mapping' THEN true
          ELSE false
        END as is_newly_added,
        -- Calculate days since item was added
        CURRENT_DATE - ii.created_at::date as days_since_added,
        -- Check if business is in first 7 days
        b.created_at as business_created_at,
        CASE 
          WHEN b.created_at >= CURRENT_DATE - INTERVAL '7 days' THEN true
          ELSE false
        END as is_business_first_7_days
      FROM InventoryItems ii
      LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
      LEFT JOIN MinimalStockTracking mst ON ii.item_id = mst.item_id
      LEFT JOIN ReorderPointCalculations rpc ON ii.item_id = rpc.item_id
      LEFT JOIN Vendors v ON ii.default_vendor_id = v.vendor_id
      LEFT JOIN Businesses b ON ii.business_id = b.business_id
      LEFT JOIN ABCAnalysisResults abc ON ii.item_id = abc.item_id
      WHERE ii.business_id = $1 AND ii.is_active = true 
        AND (
          -- If business is in first 7 days, show ALL items
          (b.created_at >= CURRENT_DATE - INTERVAL '7 days') OR
          -- Otherwise, show only items with reorder points OR newly added ingredient mapping items
          (ii.reorder_point IS NOT NULL AND ii.reorder_point > 0) OR 
          (ii.created_at >= CURRENT_DATE - INTERVAL '7 days' AND ii.source = 'ingredient_mapping')
        )
      GROUP BY ii.item_id, ii.name, ii.reorder_point, ii.safety_stock, abc.abc_category, ii.created_at, ii.source, mst.tracking_phase, 
               mst.is_learning_mode, rpc.average_daily_consumption, rpc.average_lead_time_days,
               v.name, v.contact_phone, b.created_at
      HAVING 
        -- If business is in first 7 days, include ALL items regardless of stock level
        (b.created_at >= CURRENT_DATE - INTERVAL '7 days') OR
        -- Otherwise, apply normal low stock filtering
        (COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) OR 
         COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0) OR
         (ii.created_at >= CURRENT_DATE - INTERVAL '7 days' 
          AND ii.source = 'ingredient_mapping'))
      ORDER BY 
        CASE 
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0) THEN 1
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) THEN 2
          ELSE 3
        END,
        ii.name
    `, [businessId]);
    
    // Check if business is in first 7 days
    const isBusinessFirst7Days = criticalItems.rows.length > 0 ? criticalItems.rows[0].is_business_first_7_days : false;
    if (isBusinessFirst7Days) {
      console.log('📋 SHOWING ONLY LOW STOCK ITEMS (normal mode)');
    }
    
    // Apply filtering logic:
    // - If business is in first 7 days: Include ALL items
    // - Otherwise: Critical alerts: Only A-category items that are actually critical
    // - Low stock alerts: All low stock items + B/C category items that are critical (moved to low stock)
    // - Newly added items: All items within 7 days regardless of stock status (from ingredient mapping)
    const filteredResults = [];
    
    criticalItems.rows.forEach(item => {
      if (isBusinessFirst7Days) {
        // During first 7 days of business, include ALL items
        filteredResults.push(item);
      } else if (item.is_newly_added) {
        // Newly added items get special status regardless of stock level
        filteredResults.push({
          ...item,
          stock_status: 'newly_added'
        });
      } else if (item.stock_status === 'critical') {
        if (item.abc_category === 'A') {
          // A-category critical items stay as critical
          filteredResults.push(item);
        } else {
          // B/C category critical items are moved to low stock section
          filteredResults.push({
            ...item,
            stock_status: 'low'
          });
        }
      } else if (item.stock_status === 'low') {
        // All low stock items are included as-is
        filteredResults.push(item);
      }
    });
    
    res.json({
      success: true,
      data: filteredResults,
      count: filteredResults.length,
      summary: {
        newly_added: filteredResults.filter(i => i.is_newly_added).length,
        critical: filteredResults.filter(i => i.stock_status === 'critical').length,
        low_stock: filteredResults.filter(i => i.stock_status === 'low').length,
        newly_added_status: filteredResults.filter(i => i.stock_status === 'newly_added').length
      }
    });
    
  } catch (error) {
    console.error('Error fetching critical items:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch critical items',
      details: error.message
    });
  }
});

// GET /api/minimal-stock/tracking-status/:businessId - Get tracking status for all items
router.get('/tracking-status/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    const trackingStatus = await pool.query(`
      SELECT 
        ii.item_id,
        ii.name,
        mst.tracking_phase,
        mst.is_learning_mode,
        mst.data_collection_start_date,
        mst.phase_2_start_date,
        mst.phase_3_start_date,
        mst.total_consumption_recorded,
        mst.total_usage_days,
        mst.preliminary_daily_consumption,
        mst.refined_daily_consumption,
        CURRENT_DATE - mst.data_collection_start_date as days_tracked,
        CASE 
          WHEN mst.is_learning_mode = true THEN 'Learning Mode (Phase 1)'
          WHEN mst.tracking_phase = 2 THEN 'Preliminary Automation (Phase 2)'
          WHEN mst.tracking_phase >= 3 THEN 'Full Automation (Phase 3)'
          ELSE 'Not Tracked'
        END as phase_description
      FROM InventoryItems ii
      LEFT JOIN MinimalStockTracking mst ON ii.item_id = mst.item_id
      WHERE ii.business_id = $1 AND ii.is_active = true
      ORDER BY ii.name
    `, [businessId]);
    
    res.json({
      success: true,
      data: trackingStatus.rows
    });
    
  } catch (error) {
    console.error('Error fetching tracking status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch tracking status',
      details: error.message
    });
  }
});

// POST /api/minimal-stock/transition-phases - Check and transition items to next phases
router.post('/transition-phases', async (req, res) => {
  try {
    const { businessId } = req.body;
    
    if (!businessId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: businessId'
      });
    }
    
    const transitions = [];
    
    // Check items ready for Phase 2 transition (after 7 days)
    const phase1Items = await pool.query(`
      SELECT item_id, data_collection_start_date
      FROM MinimalStockTracking 
      WHERE business_id = $1 
        AND tracking_phase = 1 
        AND is_learning_mode = true
        AND CURRENT_DATE - data_collection_start_date >= 7
    `, [businessId]);
    
    for (const item of phase1Items.rows) {
      const preliminaryConsumption = await calculatePreliminaryConsumption(item.item_id, businessId);
      if (preliminaryConsumption) {
        transitions.push({
          itemId: item.item_id,
          fromPhase: 1,
          toPhase: 2,
          preliminaryConsumption
        });
      }
    }
    
    // Check items ready for Phase 3 transition (after 14 days)
    const phase2Items = await pool.query(`
      SELECT item_id, data_collection_start_date
      FROM MinimalStockTracking 
      WHERE business_id = $1 
        AND tracking_phase = 2 
        AND CURRENT_DATE - data_collection_start_date >= 14
    `, [businessId]);
    
    for (const item of phase2Items.rows) {
      const refinedConsumption = await calculateRefinedConsumption(item.item_id, businessId);
      if (refinedConsumption) {
        transitions.push({
          itemId: item.item_id,
          fromPhase: 2,
          toPhase: 3,
          refinedConsumption
        });
      }
    }
    
    res.json({
      success: true,
      message: 'Phase transitions completed',
      data: {
        transitions,
        transitionsCount: transitions.length
      }
    });
    
  } catch (error) {
    console.error('Error transitioning phases:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to transition phases',
      details: error.message
    });
  }
});

// GET /api/minimal-stock/dashboard-alerts/:businessId - Get stock alerts for dashboard
router.get('/dashboard-alerts/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    // Align dashboard with Create Reorder "order items" exactly (includes Phase 1 learning items)
    const serviceItems = await MinimalStockService.getCreateReorderItems(Number(businessId));

    // Map to a shape close to previous response fields
    const mapped = serviceItems.map(r => ({
      item_id: r.item_id,
      name: r.item_name,
      current_stock: Number(r.current_stock) || 0,
      reorder_point: r.reorder_point,
      safety_stock: r.safety_stock,
      unit: undefined, // unit not returned by service; optional in UI
      vendor_name: r.default_vendor_name || null,
      urgency_level: r.stock_status, // 'critical' | 'low' | 'learning'
      tracking_phase: r.tracking_phase,
      alert_type: r.alert_type,
      is_learning_mode: r.is_learning_mode === true
    }));

    const summary = {
      total_alerts: mapped.length,
      critical_items: mapped.filter(r => r.urgency_level === 'critical').length,
      // Include 'learning' under low to mirror Create Reorder order-items count
      low_stock_items: mapped.filter(r => r.urgency_level === 'low' || r.urgency_level === 'learning').length,
      learning_items: mapped.filter(r => r.is_learning_mode === true || r.urgency_level === 'learning').length
    };

    const alert_item_ids = mapped.map(r => r.item_id);
  console.log('[dashboard-alerts via MinimalStockService(getCreateReorderItems)] business', businessId, 'count', mapped.length, 'ids', alert_item_ids);

  // Prevent caching so the dashboard always reflects latest count
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');

  res.json({ success: true, data: mapped, summary, count: mapped.length, alert_item_ids, parity_mode: 'service-create-reorder' });
    
  } catch (error) {
    console.error('Error fetching dashboard stock alerts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stock alerts',
      details: error.message
    });
  }
});

// GET /api/minimal-stock/all-low-stock/:businessId - Get all low stock items (any category)
router.get('/all-low-stock/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    // Get all items below reorder point regardless of ABC category
    const lowStockItems = await pool.query(`
      SELECT 
        ii.item_id,
        ii.name,
        ii.reorder_point,
        ii.safety_stock,
        COALESCE(abc.abc_category, 'C') as abc_category,
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
      LEFT JOIN ABCAnalysisResults abc ON ii.item_id = abc.item_id
      WHERE ii.business_id = $1 AND ii.is_active = true
      GROUP BY ii.item_id, ii.name, ii.reorder_point, ii.safety_stock, abc.abc_category, gu.unit_symbol, v.name
      HAVING 
        (
          -- Include items at or below their set thresholds (align with frontend <= logic)
          (COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) OR 
           COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0))
          AND (ii.reorder_point IS NOT NULL OR ii.safety_stock IS NOT NULL)
        )
        OR 
        (
          -- Also include any items with zero or very low stock (≤ 5 units) even without thresholds
          COALESCE(SUM(ib.quantity), 0) <= 5
        )
      ORDER BY 
        CASE 
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0) THEN 1
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) THEN 2
          ELSE 3
        END, ii.name
    `, [businessId]);
    
    res.json({
      success: true,
      data: lowStockItems.rows,
      count: lowStockItems.rows.length
    });
    
  } catch (error) {
    console.error('Error fetching all low stock items:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch low stock items',
      details: error.message
    });
  }
});

module.exports = router;
