const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// GET /api/users - Get all users for a business
router.get('/', async (req, res) => {
  try {
    const businessId = req.query.business_id || 1; // Default to business 1
    
    const query = `
      SELECT 
        u.user_id,
        u.name,
        u.email,
        u.phone_number,
        u.is_active,
        r.role_name,
        u.created_at,
  u.last_login_at,
  u.last_active_at
      FROM Users u
      LEFT JOIN Roles r ON u.role_id = r.role_id
  WHERE u.business_id = $1
      ORDER BY u.name
    `;
    
    const result = await pool.query(query, [businessId]);
    
    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users',
      details: error.message
    });
  }
});

// GET /api/users/:id - Get specific user
router.get('/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    
    if (isNaN(userId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid user ID'
      });
    }
    
    const query = `
      SELECT 
        u.user_id,
        u.name,
        u.email,
        u.phone_number,
        u.is_active,
        r.role_name,
        u.created_at,
        u.last_login_at,
        u.last_active_at
      FROM Users u
      LEFT JOIN Roles r ON u.role_id = r.role_id
      WHERE u.user_id = $1
    `;
    
    const result = await pool.query(query, [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user',
      details: error.message
    });
  }
});

const { createVerificationToken, sendVerificationEmail } = require('../utils/email');
const bcrypt = require('bcrypt');

// POST /api/users - Create new user (invite flow)
router.post('/', async (req, res) => {
  try {
  const { name, email, phone_number, role_id, business_id = 1 } = req.body;
    
    // Basic validation
    if (!name || !email || !role_id) {
      return res.status(400).json({
        success: false,
        error: 'Name, email, and role_id are required'
      });
    }
    
    // Check if email already exists
    const existingUser = await pool.query(
      'SELECT user_id FROM Users WHERE email = $1',
      [email]
    );
    
    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: 'User with this email already exists'
      });
    }
    
    // Create a temporary random password to satisfy NOT NULL constraint
    const tempPassword = `invite-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // Create inactive user; they will set their real password after verification/reset
    const query = `
      INSERT INTO Users (business_id, name, email, phone_number, role_id, password_hash, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, false, NOW(), NOW())
      RETURNING user_id, name, email, phone_number, is_active, created_at
    `;
    
    const result = await pool.query(query, [
      business_id,
      name,
      email,
      phone_number,
      role_id,
      passwordHash
    ]);
    
  const newUser = result.rows[0];

  // Optionally generate a reset token for later 'set password' flow (schema has columns)
  // Skipping storing token here to keep flow simple; email verification remains the gate.

  // Send verification email using shared utility
    try {
      const token = createVerificationToken(newUser.user_id, email);
      await sendVerificationEmail(email, token, name);
    } catch (mailErr) {
      console.error('Failed to send invite email:', mailErr.message);
      // Proceed but inform caller; client may retry resend
    }

    res.status(201).json({
      success: true,
      message: 'User invited successfully. Verification email sent if possible.',
      data: newUser
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create user',
      details: error.message
    });
  }
});

module.exports = router;

// PUT /api/users/:id/role - Update user's role
router.put('/:id/role', async (req, res) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const { role_id, business_id } = req.body || {};

    if (!userId || !role_id) {
      return res.status(400).json({ success: false, error: 'userId and role_id are required' });
    }

    // Verify target role exists (and is active)
    const roleRes = await pool.query(
      'SELECT role_id, business_id FROM Roles WHERE role_id = $1 AND is_active = true',
      [role_id]
    );
    if (roleRes.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid role_id' });
    }

    // Optionally ensure the user belongs to same business as the role
    const userRes = await pool.query('SELECT user_id, business_id FROM Users WHERE user_id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    if (business_id && userRes.rows[0].business_id !== business_id) {
      return res.status(403).json({ success: false, error: 'User does not belong to the specified business' });
    }
    if (userRes.rows[0].business_id !== roleRes.rows[0].business_id) {
      return res.status(400).json({ success: false, error: 'Role and User belong to different businesses' });
    }

    const updateRes = await pool.query(
      'UPDATE Users SET role_id = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2 RETURNING user_id, role_id',
      [role_id, userId]
    );

    return res.status(200).json({ success: true, message: 'User role updated', data: updateRes.rows[0] });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ success: false, error: 'Failed to update user role', details: error.message });
  }
});