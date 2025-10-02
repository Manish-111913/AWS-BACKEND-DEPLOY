const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// POST /api/inventory/items - Create a new inventory item (upsert by business_id+name)
router.post('/items', async (req, res) => {
  try {
    const { name, unit_symbol, business_id, source } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Item name is required' });
    }

    // Default to business 1 for now (multi-tenant wiring can be added later)
    const businessId = parseInt(business_id) || 1;
    const unitSymbol = (unit_symbol || 'g').toString();
    const itemSource = source || 'manual'; // Track source: 'ingredient_mapping', 'manual', etc.

    // Resolve unit_id from GlobalUnits, default to 'g' if not found
    const unitResult = await pool.query(
      'SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $1 LIMIT 1',
      [unitSymbol]
    );
    let unitId = unitResult.rows[0]?.unit_id;
    if (!unitId) {
      const fallback = await pool.query(
        "SELECT unit_id FROM GlobalUnits WHERE unit_symbol = 'g' LIMIT 1"
      );
      unitId = fallback.rows[0]?.unit_id || 1;
    }

    // Upsert item by (business_id, name) and track the source
    const upsertQuery = `
      INSERT INTO InventoryItems (business_id, name, standard_unit_id, is_active, created_at, updated_at, source)
      VALUES ($1, TRIM($2), $3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $4)
      ON CONFLICT (business_id, name)
      DO UPDATE SET updated_at = EXCLUDED.updated_at, is_active = true, source = EXCLUDED.source
      RETURNING item_id, business_id, name, standard_unit_id, is_active, created_at, updated_at, source
    `;

    const result = await pool.query(upsertQuery, [businessId, name, unitId, itemSource]);
    const row = result.rows[0];

    // Also return unit symbol for convenience
    const unitRow = await pool.query('SELECT unit_symbol FROM GlobalUnits WHERE unit_id = $1', [row.standard_unit_id]);

    return res.status(201).json({
      success: true,
      data: {
        id: row.item_id,
        name: row.name,
        businessId: row.business_id,
        standardUnit: unitRow.rows[0]?.unit_symbol || unitSymbol,
        is_active: row.is_active,
        source: row.source,
      }
    });
  } catch (error) {
    console.error('Error creating inventory item:', error);
    return res.status(500).json({ success: false, error: 'Failed to create inventory item', details: error.message });
  }
});

// DELETE /api/inventory/items/:itemId/batches/:batchId - Delete inventory batch
router.delete('/items/:itemId/batches/:batchId', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const itemId = parseInt(req.params.itemId);
    const batchId = req.params.batchId;
    
    if (isNaN(itemId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid item ID'
      });
    }

    // First, get the batch information (matching your DBsetup.js schema)
    const batchQuery = `
      SELECT ib.*, ii.name as item_name 
      FROM InventoryBatches ib
      JOIN InventoryItems ii ON ib.item_id = ii.item_id
      WHERE ib.item_id = $1 AND ib.batch_id = $2 AND ib.is_expired = false
    `;
    
    const batchResult = await client.query(batchQuery, [itemId, batchId.split('-batch-')[1] || batchId]);
    
    if (batchResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        error: 'Batch not found'
      });
    }

    const batch = batchResult.rows[0];

    // Mark the batch as expired instead of deleting (for audit trail)
    const expireBatchQuery = `
      UPDATE InventoryBatches 
      SET is_expired = true, updated_at = NOW()
      WHERE batch_id = $1
      RETURNING *
    `;
    
    const expiredBatch = await client.query(expireBatchQuery, [batch.batch_id]);

    // Check if this was the last active batch for this item
    const remainingBatchesQuery = `
      SELECT COUNT(*) as count 
      FROM InventoryBatches 
      WHERE item_id = $1 AND is_expired = false AND quantity > 0
    `;
    
    const remainingBatches = await client.query(remainingBatchesQuery, [itemId]);
    
    // If no active batches remain, deactivate the inventory item
    if (parseInt(remainingBatches.rows[0].count) === 0) {
      await client.query(
        'UPDATE InventoryItems SET is_active = false, updated_at = NOW() WHERE item_id = $1',
        [itemId]
      );
    }

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: 'Batch deleted successfully',
      data: {
        deletedBatch: expiredBatch.rows[0],
        itemDeactivated: parseInt(remainingBatches.rows[0].count) === 0
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting inventory batch:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete batch',
      details: error.message
    });
  } finally {
    client.release();
  }
});

// GET /api/inventory/items/:itemId/batches - Get all batches for an item
router.get('/items/:itemId/batches', async (req, res) => {
  try {
    const itemId = parseInt(req.params.itemId);
    
    if (isNaN(itemId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid item ID'
      });
    }

    const query = `
      SELECT 
        ib.*,
        ii.name as item_name,
        gu.unit_name as unit,
        ib.received_date as procured_date,
        CASE 
          WHEN ib.expiry_date IS NULL THEN 'No expiry date'
          WHEN ib.expiry_date < CURRENT_DATE THEN 'Expired'
          WHEN ib.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'Urgent'
          WHEN ib.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'Warning'
          ELSE 'Good'
        END as status,
        CASE 
          WHEN ib.expiry_date IS NULL THEN 999
          ELSE COALESCE((ib.expiry_date - CURRENT_DATE), 999)
        END as days_to_expiry
      FROM InventoryBatches ib
      JOIN InventoryItems ii ON ib.item_id = ii.item_id
      LEFT JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
      WHERE ib.item_id = $1 AND ib.is_expired = false
      ORDER BY ib.expiry_date ASC NULLS LAST, ib.created_at ASC
    `;
    
    const result = await pool.query(query, [itemId]);
    
    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error('Error fetching item batches:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch item batches',
      details: error.message
    });
  }
});

// GET /api/inventory/items/:businessId - Get all inventory items for a business
router.get('/items/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const includeComplimentary = String(req.query.includeComplimentary || '').toLowerCase() === 'true';

    // Build conditional filter to hide complimentary items by default
    const whereExtra = includeComplimentary
      ? ''
      : `AND (ic.name IS NULL OR ic.name <> 'Complimentary Items')`;

    const inventoryItems = await pool.query(
      `
      SELECT 
        ii.item_id,
        ii.name,
        ii.reorder_point,
        ii.safety_stock,
        COALESCE(ii.current_stock, 0) as current_stock,
        gu.unit_symbol as unit,
        v.name as vendor_name,
        ic.name as category
      FROM InventoryItems ii
      LEFT JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
      LEFT JOIN Vendors v ON ii.default_vendor_id = v.vendor_id
      LEFT JOIN InventoryCategories ic ON ii.category_id = ic.category_id
      WHERE ii.business_id = $1 AND ii.is_active = true ${whereExtra}
      ORDER BY ii.name
      `,
      [businessId]
    );
    
    res.json({
      success: true,
      data: inventoryItems.rows,
      count: inventoryItems.rows.length
    });
    
  } catch (error) {
    console.error('Error fetching inventory items:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch inventory items',
      details: error.message
    });
  }
});

// GET /api/inventory/items/:businessId/category-assignments - Get category-based vendor assignments
router.get('/items/:businessId/category-assignments', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { createCategoryBasedAssignments } = require('../utils/categoryMapping');
  const includeAll = String(req.query.includeAll || '').toLowerCase() === 'true';

    // Get all inventory items with categories
    const baseQuery = `
      SELECT 
        ii.item_id,
        ii.name,
        ii.reorder_point,
        ii.safety_stock,
        COALESCE(SUM(ib.quantity), 0) as current_stock,
        gu.unit_symbol as unit,
        v.name as vendor_name,
        ic.name as category
      FROM InventoryItems ii
      LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
      LEFT JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
      LEFT JOIN Vendors v ON ii.default_vendor_id = v.vendor_id
      LEFT JOIN InventoryCategories ic ON ii.category_id = ic.category_id
      WHERE ii.business_id = $1 AND ii.is_active = true
        AND (ic.name IS NULL OR ic.name <> 'Complimentary Items')
      GROUP BY ii.item_id, ii.name, ii.reorder_point, ii.safety_stock, gu.unit_symbol, v.name, ic.name
      ${includeAll ? '' : 'HAVING COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0)'}
      ORDER BY ii.name
    `;

    const inventoryItems = await pool.query(baseQuery, [businessId]);

    // Get all vendors
    const vendors = await pool.query(`
      SELECT vendor_id, name, vendor_category, average_rating, contact_phone, contact_whatsapp
      FROM Vendors 
      WHERE business_id = $1 AND is_active = true
      ORDER BY vendor_category, average_rating DESC
    `, [businessId]);

    // Create category-based assignments
    const assignments = createCategoryBasedAssignments(
      inventoryItems.rows,
      vendors.rows
    );

  res.json({
      success: true,
      data: {
        assignments,
        totalVendors: assignments.length,
    totalItems: inventoryItems.rows.length,
        categoryBreakdown: assignments.map(a => ({
          vendorName: a.vendor.name,
          vendorCategory: a.vendorCategory,
          itemCount: a.itemCount,
          items: a.items.map(item => item.name)
        }))
      }
    });

  } catch (error) {
    console.error('Error creating category-based assignments:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create category-based assignments',
      details: error.message
    });
  }
});

module.exports = router;
