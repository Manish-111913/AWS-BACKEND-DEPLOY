const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// GET /api/wastage - Get wastage records
router.get('/', async (req, res) => {
  try {
    const { business_id = 1, start_date, end_date, limit = 50 } = req.query;
    
  let query = `
      SELECT 
        sor.stock_out_id,
        sor.quantity,
        sor.estimated_cost_impact,
        sor.deducted_date,
        sor.notes,
        sor.status,
        CASE 
          WHEN sor.item_type = 'MenuItem' THEN mi.name
          WHEN sor.item_type = 'InventoryItem' THEN ii.name
          ELSE 'Unknown Item'
        END as item_name,
        wr.reason_label as waste_reason,
        wr.reason_category,
        u.name as recorded_by_name
      FROM StockOutRecords sor
      LEFT JOIN MenuItems mi ON sor.item_id = mi.menu_item_id AND sor.item_type = 'MenuItem'
      LEFT JOIN InventoryItems ii ON sor.item_id = ii.item_id AND sor.item_type = 'InventoryItem'
      LEFT JOIN WastageReasons wr ON sor.waste_reason_id = wr.reason_id
      LEFT JOIN Users u ON sor.deducted_by_user_id = u.user_id
      WHERE sor.business_id = $1 AND sor.reason_type = 'Waste'
  AND COALESCE(LOWER(wr.reason_label),'') NOT LIKE '%billing%' -- exclude billing errors from dashboard list
    `;
    
    const params = [business_id];
    
    if (start_date && end_date) {
      query += ` AND sor.deducted_date BETWEEN $${params.length + 1} AND $${params.length + 2}`;
      params.push(start_date, end_date);
    } else if (start_date) {
      query += ` AND sor.deducted_date >= $${params.length + 1}`;
      params.push(start_date);
    } else if (end_date) {
      query += ` AND sor.deducted_date <= $${params.length + 1}`;
      params.push(end_date);
    }
    
    query += ` ORDER BY sor.deducted_date DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));
    
    const result = await pool.query(query, params);
    
    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching wastage records:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch wastage records',
      details: error.message
    });
  }
});

// POST /api/wastage - Record wastage
router.post('/', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const {
      item_id,
      item_type = 'InventoryItem',
      quantity,
      unit_id,
      waste_reason_id,
      notes,
      deducted_by_user_id = 1,
  business_id = 1,
  estimated_cost_impact: estimated_cost_override
    } = req.body;
    
    // Validation
    if (!item_id || !quantity || !waste_reason_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'item_id, quantity, and waste_reason_id are required'
      });
    }
    
    if (parseFloat(quantity) <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'Quantity must be greater than 0'
      });
    }
    
    // Pre-fetch wastage reason label (for billing checks)
    let reasonLabelRaw = '';
    try {
      const rl = await client.query('SELECT reason_label FROM WastageReasons WHERE reason_id = $1 LIMIT 1', [waste_reason_id]);
      reasonLabelRaw = rl.rows[0]?.reason_label || '';
    } catch(_) {}
    const normalizedReason = reasonLabelRaw.toString().trim().toLowerCase().replace(/[\-_]+/g,' ');
    const isBillingError = normalizedReason.includes('billing');

    // Get item details for cost estimation
    let itemName = 'Unknown Item';
    let unitCost = 0; // cost per unit
    if (item_type === 'MenuItem') {
      const miRes = await client.query(
        'SELECT name, price FROM MenuItems WHERE menu_item_id = $1 AND business_id = $2',
        [item_id, business_id]
      );
      if (miRes.rows.length) {
        itemName = miRes.rows[0].name;
        const sellingPrice = parseFloat(miRes.rows[0].price || 0);
        // Prefer recipe estimated_cost if available
        let recipeCost = 0;
        try {
          const rc = await client.query('SELECT estimated_cost FROM Recipes WHERE recipe_id = $1 LIMIT 1', [item_id]);
          recipeCost = parseFloat(rc.rows[0]?.estimated_cost || 0);
        } catch (_) {}
        unitCost = recipeCost > 0 ? recipeCost : sellingPrice;
      }
    } else {
      const iiRes = await client.query(
        `SELECT ii.name, AVG(ib.unit_cost) as avg_cost
         FROM InventoryItems ii
         LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
         WHERE ii.item_id = $1 AND ii.business_id = $2
         GROUP BY ii.item_id, ii.name`,
        [item_id, business_id]
      );
      if (iiRes.rows.length) {
        itemName = iiRes.rows[0].name;
        unitCost = parseFloat(iiRes.rows[0].avg_cost || 0);
      }
    }
    
    if (!itemName || unitCost === undefined) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Item not found'
      });
    }
    
    // If client sent a precomputed estimated cost, prefer it
    let estimatedCost = undefined;
    if (estimated_cost_override !== undefined && estimated_cost_override !== null) {
      const v = parseFloat(estimated_cost_override);
      if (!isNaN(v) && v >= 0) estimatedCost = v;
    }
    if (estimatedCost === undefined) {
      estimatedCost = parseFloat(quantity) * (unitCost || 0);
    }
    
  // For inventory items, deduct from batches unless billing error (we skip deduction so stock is reverted automatically)
  if (item_type === 'InventoryItem' && !isBillingError) {
      // Get available batches ordered by expiry date (FIFO)
      const batchQuery = `
        SELECT batch_id, quantity, unit_cost, expiry_date
        FROM InventoryBatches
        WHERE item_id = $1 AND is_expired = false AND quantity > 0
        ORDER BY expiry_date ASC NULLS LAST, created_at ASC
      `;
      
      const batchResult = await client.query(batchQuery, [item_id]);
      
      if (batchResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: 'No available stock for this item'
        });
      }
      
      // Check if we have enough total quantity
  const totalAvailable = batchResult.rows.reduce((sum, batch) => sum + parseFloat(batch.quantity), 0);
      if (totalAvailable < parseFloat(quantity)) {
        // Create stock discrepancy notification before returning error
        try {
          await fetch(`${process.env.API_BASE_URL || 'http://localhost:5000'}/api/notifications/waste/stock-discrepancy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              businessId: business_id,
              userId: deducted_by_user_id,
              itemName: itemName,
              attemptedQuantity: parseFloat(quantity),
              availableQuantity: totalAvailable,
              negativeValue: totalAvailable - parseFloat(quantity),
              isPilferage: totalAvailable === 0 && parseFloat(quantity) > 5
            })
          });
        } catch (notifError) {
          console.log('Stock discrepancy notification failed:', notifError.message);
        }

        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          error: `Insufficient stock. Available: ${totalAvailable}, Requested: ${quantity}`
        });
      }
      
      // Deduct from batches using FIFO
      let remainingToDeduct = parseFloat(quantity);
      
      for (const batch of batchResult.rows) {
        if (remainingToDeduct <= 0) break;
        
        const batchQuantity = parseFloat(batch.quantity);
        const deductFromBatch = Math.min(remainingToDeduct, batchQuantity);
        const newBatchQuantity = batchQuantity - deductFromBatch;
        
        // Update batch quantity
        await client.query(
          'UPDATE InventoryBatches SET quantity = $1, updated_at = NOW() WHERE batch_id = $2',
          [newBatchQuantity, batch.batch_id]
        );
        
        remainingToDeduct -= deductFromBatch;
      }
    }
    
    // Insert wastage record
    const insertQuery = `
      INSERT INTO StockOutRecords (
        business_id, item_id, item_type, quantity, unit_id,
        reason_type, waste_reason_id, notes, deducted_by_user_id,
        deducted_date, estimated_cost_impact, status
      )
      VALUES ($1, $2, $3, $4, $5, 'Waste', $6, $7, $8, NOW(), $9, 'Confirmed')
      RETURNING stock_out_id, deducted_date
    `;
    
    const result = await client.query(insertQuery, [
      business_id,
      item_id,
      item_type,
      parseFloat(quantity),
      unit_id || 5, // Default unit
      waste_reason_id,
      notes,
      deducted_by_user_id,
      estimatedCost
    ]);

    // Also insert into WastageRecords for inventory items (schema requires InventoryItems FK)
    if (item_type === 'InventoryItem') {
      try {
        await client.query(
          `INSERT INTO WastageRecords (business_id, item_id, quantity, reason_id, cost_impact, recorded_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [business_id, item_id, parseFloat(quantity), waste_reason_id, estimatedCost, deducted_by_user_id]
        );
      } catch (wrErr) {
        console.warn('Warning: Failed to insert WastageRecords entry:', wrErr.message);
      }
    }

  // Auto-revert logic:
  // 1. InventoryItem: if billing error, we skipped deduction above (implicit revert)
  // 2. MenuItem: if billing error, add back ingredients as before
    let revertSummary = null;
    if (item_type === 'InventoryItem' && isBillingError) {
      revertSummary = { reason: normalizedReason, item_type: 'InventoryItem', quantity: parseFloat(quantity), action: 'deduction_skipped_due_to_billing_error' };
    } else if (item_type === 'MenuItem') {
      try {
        if (isBillingError) {
          // Get recipe ingredients for the wasted menu item
          const riQuery = `
            SELECT ri.item_id AS ingredient_id, ri.quantity AS per_unit_qty, ri.unit_id AS ingredient_unit_id,
                   ii.standard_unit_id AS standard_unit_id
            FROM RecipeIngredients ri
            JOIN InventoryItems ii ON ii.item_id = ri.item_id
            WHERE ri.recipe_id = $1
          `;
          const riRes = await client.query(riQuery, [item_id]);

          if (riRes.rows.length > 0) {
            // Helper to get conversion factor from ingredient unit to standard unit
            async function getConv(fromUnitId, toUnitId) {
              if (!fromUnitId || !toUnitId || fromUnitId === toUnitId) return 1.0;
              const convRes = await client.query(
                `SELECT conversion_factor FROM BusinessUnitConversions 
                 WHERE business_id = $1 AND from_unit_id = $2 AND to_unit_id = $3 LIMIT 1`,
                [business_id, fromUnitId, toUnitId]
              );
              if (convRes.rows.length) return parseFloat(convRes.rows[0].conversion_factor);
              return null; // no conversion available
            }

            const adjustments = [];
            for (const row of riRes.rows) {
              const ingrId = row.ingredient_id;
              const perUnitQty = parseFloat(row.per_unit_qty || 0);
              const fromUnit = row.ingredient_unit_id;
              const toUnit = row.standard_unit_id;

              if (!(perUnitQty > 0)) continue;
              const conv = await getConv(fromUnit, toUnit);
              if (conv === null) {
                adjustments.push({ ingredient_id: ingrId, reverted: false, reason: 'missing_unit_conversion' });
                continue;
              }

              const addQty = perUnitQty * conv * parseFloat(quantity);
              if (!(addQty > 0)) continue;

              // Try to add back into the most recent non-expired batch; else create an adjustment batch
              const recentBatchRes = await client.query(
                `SELECT batch_id FROM InventoryBatches 
                 WHERE item_id = $1 AND is_expired = false 
                 ORDER BY received_date DESC NULLS LAST, created_at DESC 
                 LIMIT 1`,
                [ingrId]
              );

              if (recentBatchRes.rows.length) {
                const batchId = recentBatchRes.rows[0].batch_id;
                await client.query(
                  'UPDATE InventoryBatches SET quantity = quantity + $1, updated_at = NOW() WHERE batch_id = $2',
                  [addQty, batchId]
                );
                adjustments.push({ ingredient_id: ingrId, reverted: true, quantity_added: parseFloat(addQty.toFixed(2)), batch_id: batchId, created_new_batch: false });
              } else {
                // Determine avg cost for the ingredient for a reasonable unit_cost
                const avgCostRes = await client.query(
                  `SELECT AVG(unit_cost) AS avg_cost FROM InventoryBatches WHERE item_id = $1`,
                  [ingrId]
                );
                const unitCost = parseFloat(avgCostRes.rows[0]?.avg_cost || 0) || 0;
                const insBatchRes = await client.query(
                  `INSERT INTO InventoryBatches (item_id, quantity, unit_cost, received_date, invoice_reference, created_at, updated_at)
                   VALUES ($1, $2, $3, NOW(), $4, NOW(), NOW()) RETURNING batch_id`,
                  [ingrId, addQty, unitCost, 'ADJUSTMENT:RETURN']
                );
                adjustments.push({ ingredient_id: ingrId, reverted: true, quantity_added: parseFloat(addQty.toFixed(2)), batch_id: insBatchRes.rows[0].batch_id, created_new_batch: true });
              }
            }

            revertSummary = { reason: normalizedReason, dish_quantity: parseFloat(quantity), adjustments };
          } else {
            revertSummary = { reason: normalizedReason, dish_quantity: parseFloat(quantity), adjustments: [], note: 'no_recipe_ingredients_found' };
          }
        }
      } catch (revertErr) {
        console.warn('Auto-revert for menu-item wastage failed:', revertErr.message);
      }
    }
    
    await client.query('COMMIT');

    // Create success notification for wastage deduction
    try {
      await fetch(`${process.env.API_BASE_URL || 'http://localhost:5000'}/api/notifications/waste/successful-deduction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: business_id,
          userId: deducted_by_user_id,
          date: result.rows[0].deducted_date.toISOString().split('T')[0],
          totalItems: 1,
          totalValue: estimatedCost.toFixed(2),
          deductedItems: [itemName]
        })
      });
    } catch (notifError) {
      console.log('Notification creation failed:', notifError.message);
    }

    // Check for high wastage alert (if cost > 100 or quantity > 10)
    if (estimatedCost > 100 || parseFloat(quantity) > 10) {
      try {
        await fetch(`${process.env.API_BASE_URL || 'http://localhost:5000'}/api/notifications/waste/high-wastage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessId: business_id,
            userId: deducted_by_user_id,
      itemName: itemName,
            quantity: parseFloat(quantity),
            threshold: estimatedCost > 100 ? '₹100' : '10 units',
            percentage: 'high'
          })
        });
      } catch (notifError) {
        console.log('High wastage notification failed:', notifError.message);
      }
    }
    
    res.status(201).json({
      success: true,
      message: 'Wastage record created and inventory updated successfully',
      data: {
        stock_out_id: result.rows[0].stock_out_id,
    item_name: itemName,
        quantity: parseFloat(quantity),
        estimated_cost: estimatedCost.toFixed(2),
        recorded_date: result.rows[0].deducted_date,
  inventory_updated: item_type === 'InventoryItem' && !isBillingError,
  ingredients_reverted: revertSummary
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error recording wastage:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record wastage',
      details: error.message
    });
  } finally {
    client.release();
  }
});

// GET /api/wastage/reasons - Get wastage reasons
router.get('/reasons', async (req, res) => {
  try {
    const { business_id = 1 } = req.query;
    
    const query = `
      SELECT 
        reason_id,
        reason_label,
        reason_category,
        is_active
      FROM WastageReasons
      WHERE (business_id = $1 OR business_id IS NULL) AND is_active = true
      ORDER BY reason_category, reason_label
    `;
    
    const result = await pool.query(query, [business_id]);
    
    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching wastage reasons:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch wastage reasons',
      details: error.message
    });
  }
});

// GET /api/wastage/summary - Get wastage summary
router.get('/summary', async (req, res) => {
  try {
    const { business_id = 1, start_date, end_date } = req.query;
    
    let query = `
      SELECT 
        wr.reason_category,
        wr.reason_label,
        COUNT(*) as total_incidents,
        SUM(sor.quantity) as total_quantity,
        SUM(sor.estimated_cost_impact) as total_cost,
        AVG(sor.estimated_cost_impact) as avg_cost_per_incident
      FROM StockOutRecords sor
      LEFT JOIN WastageReasons wr ON sor.waste_reason_id = wr.reason_id
      WHERE sor.business_id = $1 AND sor.reason_type = 'Waste'
        AND COALESCE(LOWER(wr.reason_label),'') NOT LIKE '%billing%' -- exclude billing errors from aggregated summary
    `;
    
    const params = [business_id];
    
    if (start_date && end_date) {
      query += ` AND sor.deducted_date BETWEEN $${params.length + 1} AND $${params.length + 2}`;
      params.push(start_date, end_date);
    }
    
    query += `
      GROUP BY wr.reason_category, wr.reason_label
      ORDER BY total_cost DESC
    `;
    
    const result = await pool.query(query, params);
    
    // Calculate totals
    const totalCost = result.rows.reduce((sum, row) => sum + parseFloat(row.total_cost || 0), 0);
    const totalIncidents = result.rows.reduce((sum, row) => sum + parseInt(row.total_incidents || 0), 0);
    
    res.status(200).json({
      success: true,
      data: result.rows,
      summary: {
        total_cost: totalCost.toFixed(2),
        total_incidents: totalIncidents,
        categories: result.rows.length
      }
    });
  } catch (error) {
    console.error('Error fetching wastage summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch wastage summary',
      details: error.message
    });
  }
});

// POST /api/wastage/reasons - Create a new wastage reason
router.post('/reasons', async (req, res) => {
  try {
    const { reason_label, reason_category = 'General Waste', business_id = 1, is_active = true } = req.body;

    if (!reason_label || typeof reason_label !== 'string' || !reason_label.trim()) {
      return res.status(400).json({ success: false, error: 'reason_label is required' });
    }

    // Enforce allowed categories per DB CHECK constraint
    const ALLOWED_CATEGORIES = ['Dish Waste', 'General Waste'];
    const normalizeCategory = (val) => {
      const v = (val || '').toString().trim().toLowerCase();
      if (v === 'dish waste' || v === 'dish') return 'Dish Waste';
      if (v === 'general waste' || v === 'general') return 'General Waste';
      // Some common semantics can map to Dish Waste
      if (['preparation', 'storage', 'service', 'kitchen', 'spoilage'].includes(v)) return 'Dish Waste';
      return null;
    };

    const cat = normalizeCategory(reason_category);
    if (!cat) {
      return res.status(400).json({
        success: false,
        error: `Invalid reason_category. Allowed: ${ALLOWED_CATEGORIES.join(', ')}`
      });
    }

    const insertQuery = `
      INSERT INTO WastageReasons (business_id, reason_label, reason_category, is_active)
      VALUES ($1, $2, $3, $4)
      RETURNING reason_id, reason_label, reason_category, is_active
    `;

    const result = await pool.query(insertQuery, [business_id, reason_label.trim(), cat, is_active]);

    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error creating wastage reason:', error);
    return res.status(500).json({ success: false, error: 'Failed to create wastage reason', details: error.message });
  }
});

// DELETE /api/wastage/reasons/:id - Soft delete a wastage reason (set is_active = false)
router.delete('/reasons/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ success: false, error: 'Valid reason id is required' });
    }

    const updateQuery = `
      UPDATE WastageReasons
      SET is_active = false
      WHERE reason_id = $1
      RETURNING reason_id
    `;

    const result = await pool.query(updateQuery, [parseInt(id)]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'Wastage reason not found' });
    }

    return res.status(200).json({ success: true, message: 'Wastage reason deleted' });
  } catch (error) {
    console.error('Error deleting wastage reason:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete wastage reason', details: error.message });
  }
});

module.exports = router;