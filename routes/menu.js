const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// GET /api/menu/items - Get all menu items
router.get('/items', async (req, res) => {
  try {
    const query = `
      SELECT 
        mi.menu_item_id as id,
        mi.name,
        mi.price,
        mi.servings_per_batch,
        mi.is_active,
        mi.image_url,
        mc.name as category,
        gu.unit_name as serving_unit,
        mi.created_at,
        mi.updated_at
      FROM menuitems mi
      LEFT JOIN menucategories mc ON mi.category_id = mc.category_id
      LEFT JOIN globalunits gu ON mi.serving_unit_id = gu.unit_id
      WHERE mi.is_active = true AND mi.business_id = 1
      ORDER BY mc.name, mi.name
    `;
    
    const result = await pool.query(query);
    
    // Use actual images if available, fallback to placeholder
    // Get the server's host and port from the request
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;
    const { buildImageMeta } = require('../utils/imageAugment');
    const itemsWithImages = result.rows.map(item => ({
      ...item,
      ...buildImageMeta(item, baseUrl)
    }));

    res.status(200).json({
      success: true,
      data: itemsWithImages,
      count: itemsWithImages.length
    });
  } catch (error) {
    console.error('Error fetching menu items:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch menu items',
      details: error.message
    });
  }
});

// GET /api/menu/categories - Get all menu categories
router.get('/categories', async (req, res) => {
  try {
    const query = `
      SELECT 
        category_id as id,
        name,
        is_active,
        created_at
      FROM menucategories
      WHERE is_active = true AND business_id = 1
      ORDER BY name
    `;
    
    const result = await pool.query(query);
    
    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching menu categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch menu categories',
      details: error.message
    });
  }
});

// GET /api/menu/test-image - Test image accessibility
router.get('/test-image/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const fs = require('fs');
    const path = require('path');
    
    // Check if image exists in uploads
    const uploadPath = path.join(__dirname, '..', 'uploads', 'menu-items', 'original', filename);
    const staticPath = path.join(__dirname, '..', 'images', filename);
    
    let imagePath = null;
    let imageType = null;
    
    if (fs.existsSync(uploadPath)) {
      imagePath = uploadPath;
      imageType = 'uploaded';
    } else if (fs.existsSync(staticPath)) {
      imagePath = staticPath;
      imageType = 'static';
    }
    
    if (imagePath) {
      const stats = fs.statSync(imagePath);
      res.json({
        success: true,
        filename,
        type: imageType,
        path: imagePath,
        size: stats.size,
        exists: true
      });
    } else {
      res.json({
        success: false,
        filename,
        exists: false,
        message: 'Image not found in uploads or static directories'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;