const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// GET /api/roles?business_id=1 - List active roles for a business
router.get('/', async (req, res) => {
  try {
    const businessId = parseInt(req.query.business_id, 10) || 1;
    const result = await pool.query(
      `SELECT role_id, role_name, description, is_system_default, is_active, created_at
       FROM Roles
       WHERE business_id = $1 AND is_active = true
       ORDER BY role_name ASC`,
      [businessId]
    );
    res.status(200).json({ success: true, data: result.rows, count: result.rows.length });
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch roles', details: error.message });
  }
});

module.exports = router;
