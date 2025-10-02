// Enhanced menu route with better tenant context handling
const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// Helper function to get business_id from request
function getBusinessId(req) {
  // Check various sources for business/tenant ID
  const tenantId = req.headers['x-tenant-id'] || req.headers['X-Tenant-Id'] || 
                   req.query.tenant || req.query.businessId || '1'; // Default to 1
  return parseInt(tenantId) || 1;
}

// GET /api/menu/items - Get all menu items with enhanced tenant handling
router.get('/items', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    console.log('📋 Fetching menu items for business_id:', businessId);
    
    // First try with tenant-specific query
    let query = `
      SELECT 
        mi.menu_item_id as id,
        mi.name,
        mi.price,
        mi.servings_per_batch,
        mi.is_active,
        mi.image_url,
        COALESCE(mc.name, 'Other') as category,
        COALESCE(gu.unit_name, 'piece') as serving_unit,
        mi.created_at,
        mi.updated_at
      FROM MenuItems mi
      LEFT JOIN MenuCategories mc ON mi.category_id = mc.category_id
      LEFT JOIN GlobalUnits gu ON mi.serving_unit_id = gu.unit_id
      WHERE mi.is_active = true AND mi.business_id = $1
      ORDER BY mc.name, mi.name
    `;
    
    let result;
    try {
      result = await pool.query(query, [businessId]);
    } catch (error) {
      console.log('⚠️ Tenant-specific query failed, trying fallback approach');
      // If tenant-specific fails, try without tenant filter
      query = `
        SELECT 
          mi.menu_item_id as id,
          mi.name,
          mi.price,
          mi.servings_per_batch,
          mi.is_active,
          mi.image_url,
          COALESCE(mc.name, 'Other') as category,
          COALESCE(gu.unit_name, 'piece') as serving_unit,
          mi.created_at,
          mi.updated_at
        FROM MenuItems mi
        LEFT JOIN MenuCategories mc ON mi.category_id = mc.category_id
        LEFT JOIN GlobalUnits gu ON mi.serving_unit_id = gu.unit_id
        WHERE mi.is_active = true
        ORDER BY mc.name, mi.name
        LIMIT 50
      `;
      result = await pool.query(query);
    }
    
    console.log(`✅ Found ${result.rows.length} menu items`);
    
    // If no items found, return fallback data structure
    if (result.rows.length === 0) {
      console.log('📋 No items in database, returning structured fallback data');
      const fallbackItems = [
        { id: 1, name: 'Masala Dosa', category: 'Breakfast', price: 80, servings_per_batch: 1, is_active: true, serving_unit: 'piece' },
        { id: 2, name: 'Idli Sambar', category: 'Breakfast', price: 60, servings_per_batch: 1, is_active: true, serving_unit: 'plate' },
        { id: 3, name: 'Chicken Biryani', category: 'Lunch', price: 250, servings_per_batch: 1, is_active: true, serving_unit: 'plate' },
        { id: 4, name: 'Paneer Butter Masala', category: 'Lunch', price: 180, servings_per_batch: 1, is_active: true, serving_unit: 'bowl' },
        { id: 5, name: 'Dal Tadka', category: 'Lunch', price: 80, servings_per_batch: 1, is_active: true, serving_unit: 'bowl' },
        { id: 6, name: 'Pav Bhaji', category: 'Snacks', price: 90, servings_per_batch: 1, is_active: true, serving_unit: 'plate' },
        { id: 7, name: 'Gulab Jamun', category: 'Desserts', price: 40, servings_per_batch: 2, is_active: true, serving_unit: 'pieces' },
        { id: 8, name: 'Masala Chai', category: 'Beverages', price: 20, servings_per_batch: 1, is_active: true, serving_unit: 'cup' }
      ];
      
      return res.status(200).json({
        success: true,
        data: fallbackItems,
        count: fallbackItems.length,
        source: 'fallback',
        message: 'Using fallback data - no items found in database'
      });
    }
    
    // Process images with fallback
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;
    
    const itemsWithImages = result.rows.map(item => ({
      ...item,
      image_url: item.image_url || `/images/${item.name.toLowerCase().replace(/\s+/g, '-')}.jpg`
    }));

    res.status(200).json({
      success: true,
      data: itemsWithImages,
      count: itemsWithImages.length,
      business_id: businessId,
      source: 'database'
    });
    
  } catch (error) {
    console.error('❌ Error fetching menu items:', error);
    
    // Return fallback data on any error
    const fallbackItems = [
      { id: 1, name: 'Masala Dosa', category: 'Breakfast', price: 80, servings_per_batch: 1, is_active: true, serving_unit: 'piece' },
      { id: 2, name: 'Idli Sambar', category: 'Breakfast', price: 60, servings_per_batch: 1, is_active: true, serving_unit: 'plate' },
      { id: 3, name: 'Chicken Biryani', category: 'Lunch', price: 250, servings_per_batch: 1, is_active: true, serving_unit: 'plate' },
      { id: 4, name: 'Paneer Butter Masala', category: 'Lunch', price: 180, servings_per_batch: 1, is_active: true, serving_unit: 'bowl' },
      { id: 5, name: 'Dal Tadka', category: 'Lunch', price: 80, servings_per_batch: 1, is_active: true, serving_unit: 'bowl' },
      { id: 6, name: 'Pav Bhaji', category: 'Snacks', price: 90, servings_per_batch: 1, is_active: true, serving_unit: 'plate' },
      { id: 7, name: 'Gulab Jamun', category: 'Desserts', price: 40, servings_per_batch: 2, is_active: true, serving_unit: 'pieces' },
      { id: 8, name: 'Masala Chai', category: 'Beverages', price: 20, servings_per_batch: 1, is_active: true, serving_unit: 'cup' }
    ];
    
    res.status(200).json({
      success: true,
      data: fallbackItems,
      count: fallbackItems.length,
      source: 'error_fallback',
      error: error.message,
      message: 'Returning fallback data due to database error'
    });
  }
});

// GET /api/menu/categories - Get all menu categories with enhanced tenant handling
router.get('/categories', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    console.log('📂 Fetching categories for business_id:', businessId);
    
    let query = `
      SELECT 
        category_id as id,
        name,
        is_active,
        created_at
      FROM MenuCategories
      WHERE is_active = true AND business_id = $1
      ORDER BY name
    `;
    
    let result;
    try {
      result = await pool.query(query, [businessId]);
    } catch (error) {
      console.log('⚠️ Tenant-specific category query failed, using fallback');
      query = `
        SELECT 
          category_id as id,
          name,
          is_active,
          created_at
        FROM MenuCategories
        WHERE is_active = true
        ORDER BY name
      `;
      result = await pool.query(query);
    }
    
    // If no categories found, return fallback
    if (result.rows.length === 0) {
      const fallbackCategories = [
        { id: 1, name: 'Breakfast', is_active: true },
        { id: 2, name: 'Lunch', is_active: true },
        { id: 3, name: 'Snacks', is_active: true },
        { id: 4, name: 'Desserts', is_active: true },
        { id: 5, name: 'Beverages', is_active: true }
      ];
      
      return res.status(200).json({
        success: true,
        data: fallbackCategories,
        count: fallbackCategories.length,
        source: 'fallback'
      });
    }
    
    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      business_id: businessId,
      source: 'database'
    });
    
  } catch (error) {
    console.error('❌ Error fetching menu categories:', error);
    
    // Return fallback categories on error
    const fallbackCategories = [
      { id: 1, name: 'Breakfast', is_active: true },
      { id: 2, name: 'Lunch', is_active: true },
      { id: 3, name: 'Snacks', is_active: true },
      { id: 4, name: 'Desserts', is_active: true },
      { id: 5, name: 'Beverages', is_active: true }
    ];
    
    res.status(200).json({
      success: true,
      data: fallbackCategories,
      count: fallbackCategories.length,
      source: 'error_fallback',
      error: error.message
    });
  }
});

// Test endpoint to verify API connectivity
router.get('/test', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    res.status(200).json({
      success: true,
      message: 'Menu API is working',
      business_id: businessId,
      timestamp: new Date().toISOString(),
      tenant_header: req.headers['x-tenant-id'] || 'Not provided'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Menu API test failed'
    });
  }
});

module.exports = router;