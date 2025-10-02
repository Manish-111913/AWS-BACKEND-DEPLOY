// Test endpoint for category assignments
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// Simple test endpoint
router.get('/items/:businessId/category-assignments-test', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    console.log(`🔍 Testing category assignments for business ${businessId}`);
    
    // Step 1: Test the SQL query
    console.log('Step 1: Testing SQL query...');
    const inventoryItems = await pool.query(`
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
      HAVING COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0)
      ORDER BY ii.name
      LIMIT 3
    `, [businessId]);
    
    console.log(`✅ SQL query successful: Found ${inventoryItems.rows.length} items`);

    // Step 2: Test vendor query
    console.log('Step 2: Testing vendor query...');
    const vendors = await pool.query(`
      SELECT vendor_id, name, vendor_category, average_rating, contact_phone, contact_whatsapp
      FROM Vendors 
      WHERE business_id = $1 AND is_active = true
      ORDER BY vendor_category, average_rating DESC
      LIMIT 5
    `, [businessId]);
    
    console.log(`✅ Vendor query successful: Found ${vendors.rows.length} vendors`);

    // Step 3: Test categoryMapping import
    console.log('Step 3: Testing categoryMapping import...');
    const { createCategoryBasedAssignments } = require('../utils/categoryMapping');
    console.log('✅ categoryMapping import successful');

    // Step 4: Test assignment creation
    console.log('Step 4: Testing assignment creation...');
    const assignments = createCategoryBasedAssignments(
      inventoryItems.rows,
      vendors.rows
    );
    console.log(`✅ Assignment creation successful: ${assignments.length} assignments`);

    res.json({
      success: true,
      message: 'All tests passed!',
      data: {
        itemsFound: inventoryItems.rows.length,
        vendorsFound: vendors.rows.length,
        assignmentsCreated: assignments.length,
        sampleItems: inventoryItems.rows.map(item => ({
          name: item.name,
          category: item.category,
          stock: item.current_stock,
          reorderPoint: item.reorder_point
        })),
        sampleVendors: vendors.rows.map(vendor => ({
          name: vendor.name,
          category: vendor.vendor_category
        }))
      }
    });

  } catch (error) {
    console.error('❌ Test failed:', error);
    res.status(500).json({
      success: false,
      error: 'Test failed',
      details: error.message,
      stack: error.stack
    });
  }
});

module.exports = router;
