const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// ROOT: GET /api/inventory-categories  (returns count / requires explicit businessId param guidance)
router.get('/', async (req, res) => {
  try {
    // Lightweight health / discovery endpoint
    const result = await pool.query('SELECT COUNT(*)::int AS total FROM InventoryCategories');
    return res.json({ success: true, totalCategories: result.rows[0].total, hint: 'Use /api/inventory-categories/:businessId for scoped list' });
  } catch (error) {
    console.error('Error in inventory categories root endpoint:', error);
    return res.status(500).json({ success: false, error: 'Failed root categories check', details: error.message });
  }
});

// GET /api/inventory-categories/:businessId - list active categories
router.get('/:businessId', async (req, res) => {
  try {
    const businessId = parseInt(req.params.businessId, 10);
    if (!businessId) return res.status(400).json({ success: false, error: 'Invalid businessId' });
    const result = await pool.query(
      `SELECT category_id, name, is_active, created_at
       FROM InventoryCategories WHERE business_id = $1 AND is_active = true ORDER BY name`,
      [businessId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching inventory categories:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch categories', details: error.message });
  }
});

// POST /api/inventory-categories/:businessId { name }
router.post('/:businessId', async (req, res) => {
  try {
    const businessId = parseInt(req.params.businessId, 10);
    const { name } = req.body || {};
    if (!businessId || !name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'businessId and name are required' });
    }
    const result = await pool.query(
      `INSERT INTO InventoryCategories (business_id, name, is_active)
       VALUES ($1, $2, true)
       ON CONFLICT (business_id, name)
       DO UPDATE SET is_active = true, updated_at = NOW()
       RETURNING category_id, name, is_active`,
      [businessId, name.trim()]
    );
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error creating inventory category:', error);
    return res.status(500).json({ success: false, error: 'Failed to create category', details: error.message });
  }
});

// DELETE /api/inventory-categories/:categoryId -> soft delete
router.delete('/:categoryId', async (req, res) => {
  try {
    const id = parseInt(req.params.categoryId, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid category id' });
    const result = await pool.query(
      `UPDATE InventoryCategories SET is_active = false, updated_at = NOW() WHERE category_id = $1`,
      [id]
    );
    return res.json({ success: true, updated: result.rowCount });
  } catch (error) {
    console.error('Error deleting category:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete category', details: error.message });
  }
});

module.exports = router;
