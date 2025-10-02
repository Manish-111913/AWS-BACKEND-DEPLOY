const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// Utility to parse setting_value based on data_type
function parseSettingValue(value, dataType) {
  if (value === null || value === undefined) return null;
  try {
    switch (dataType) {
      case 'number': return Number(value);
      case 'boolean': return String(value).toLowerCase() === 'true';
      case 'json': return typeof value === 'object' ? value : JSON.parse(value);
      default: return value; // string
    }
  } catch (_) {
    return value;
  }
}

// GET /api/settings/:businessId?keys=a,b,c
router.get('/:businessId', async (req, res) => {
  try {
    const businessId = parseInt(req.params.businessId, 10);
    if (!businessId) return res.status(400).json({ success: false, error: 'Invalid businessId' });

    const keysParam = (req.query.keys || '').trim();
    let rows;
    if (keysParam) {
      const keys = keysParam.split(',').map(k => k.trim()).filter(Boolean);
      if (keys.length === 0) return res.json({ success: true, data: [] });
      const placeholders = keys.map((_, i) => `$${i + 2}`).join(',');
      const query = `SELECT setting_key, setting_value, data_type, module_scope, description
                     FROM BusinessSettings
                     WHERE business_id = $1 AND setting_key IN (${placeholders})`;
      const result = await pool.query(query, [businessId, ...keys]);
      rows = result.rows;
    } else {
      const result = await pool.query(
        `SELECT setting_key, setting_value, data_type, module_scope, description
         FROM BusinessSettings WHERE business_id = $1`,
        [businessId]
      );
      rows = result.rows;
    }

    const data = rows.map(r => ({
      key: r.setting_key,
      raw: r.setting_value,
      data_type: r.data_type,
      value: parseSettingValue(r.setting_value, r.data_type),
      module_scope: r.module_scope,
      description: r.description
    }));
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch settings', details: error.message });
  }
});

// PUT /api/settings/:businessId { settings: [{ key, value, data_type, module_scope?, description? }] }
router.put('/:businessId', async (req, res) => {
  const client = await pool.connect();
  try {
    const businessId = parseInt(req.params.businessId, 10);
    const { settings } = req.body || {};
    if (!businessId || !Array.isArray(settings) || settings.length === 0) {
      return res.status(400).json({ success: false, error: 'businessId and non-empty settings[] are required' });
    }
    await client.query('BEGIN');
    for (const s of settings) {
      const key = s.key;
      const dataType = s.data_type || (typeof s.value === 'boolean' ? 'boolean' : typeof s.value === 'number' ? 'number' : (typeof s.value === 'object' ? 'json' : 'string'));
      let settingValue = s.value;
      if (dataType === 'json') settingValue = JSON.stringify(settingValue);
      else settingValue = settingValue !== null && settingValue !== undefined ? String(settingValue) : null;
      await client.query(
        `INSERT INTO BusinessSettings (business_id, setting_key, setting_value, data_type, module_scope, description, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (business_id, setting_key)
         DO UPDATE SET setting_value = EXCLUDED.setting_value, data_type = EXCLUDED.data_type, module_scope = EXCLUDED.module_scope, description = EXCLUDED.description, updated_at = NOW()`,
        [businessId, key, settingValue, dataType, s.module_scope || null, s.description || null]
      );
    }
    await client.query('COMMIT');
    return res.json({ success: true, updated: settings.length });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving settings:', error);
    return res.status(500).json({ success: false, error: 'Failed to save settings', details: error.message });
  } finally {
    client.release();
  }
});

// ===== Notification Preferences =====
// GET /api/settings/:businessId/notification-preferences?userId=1
router.get('/:businessId/notification-preferences', async (req, res) => {
  try {
    const businessId = parseInt(req.params.businessId, 10);
    const userId = parseInt(req.query.userId, 10);
    if (!businessId || !userId) return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    const result = await pool.query(
      `SELECT alert_type, is_enabled, threshold_value FROM NotificationPreferences WHERE user_id = $1`,
      [userId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching notification preferences:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch notification preferences', details: error.message });
  }
});

// PUT /api/settings/:businessId/notification-preferences { userId, preferences: { key: boolean, ... } }
router.put('/:businessId/notification-preferences', async (req, res) => {
  const client = await pool.connect();
  try {
    const businessId = parseInt(req.params.businessId, 10);
    const { userId, preferences } = req.body || {};
    if (!businessId || !userId || !preferences || typeof preferences !== 'object') {
      return res.status(400).json({ success: false, error: 'businessId, userId and preferences object are required' });
    }
    const entries = Object.entries(preferences);
    await client.query('BEGIN');
    for (const [key, enabled] of entries) {
      await client.query(
        `INSERT INTO NotificationPreferences (user_id, alert_type, is_enabled, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, alert_type)
         DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = NOW()`,
        [userId, key, !!enabled]
      );
    }
    await client.query('COMMIT');
    return res.json({ success: true, updated: entries.length });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating notification preferences:', error);
    return res.status(500).json({ success: false, error: 'Failed to update notification preferences', details: error.message });
  } finally {
    client.release();
  }
});

// ===== Payment Methods =====
// GET /api/settings/:businessId/payment-methods
router.get('/:businessId/payment-methods', async (req, res) => {
  try {
    const businessId = parseInt(req.params.businessId, 10);
    if (!businessId) return res.status(400).json({ success: false, error: 'Invalid businessId' });
    const result = await pool.query(
      `SELECT payment_method_id, method_name, description, is_active, created_at
       FROM PaymentMethods WHERE business_id = $1 AND is_active = true ORDER BY method_name`,
      [businessId]
    );
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch payment methods', details: error.message });
  }
});

// POST /api/settings/:businessId/payment-methods { method_name, description? }
router.post('/:businessId/payment-methods', async (req, res) => {
  try {
    const businessId = parseInt(req.params.businessId, 10);
    const { method_name, description } = req.body || {};
    if (!businessId || !method_name || !method_name.trim()) {
      return res.status(400).json({ success: false, error: 'businessId and method_name are required' });
    }
    const result = await pool.query(
      `INSERT INTO PaymentMethods (business_id, method_name, description, is_active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (business_id, method_name)
       DO UPDATE SET is_active = true, description = COALESCE(EXCLUDED.description, PaymentMethods.description), updated_at = NOW()
       RETURNING payment_method_id, method_name, description, is_active`,
      [businessId, method_name.trim(), description || null]
    );
    return res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('Error creating payment method:', error);
    return res.status(500).json({ success: false, error: 'Failed to create payment method', details: error.message });
  }
});

// DELETE /api/settings/payment-methods/:id -> soft delete
router.delete('/payment-methods/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid payment method id' });
    const result = await pool.query(
      `UPDATE PaymentMethods SET is_active = false, updated_at = NOW() WHERE payment_method_id = $1`,
      [id]
    );
    return res.json({ success: true, updated: result.rowCount });
  } catch (error) {
    console.error('Error deleting payment method:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete payment method', details: error.message });
  }
});

module.exports = router;
