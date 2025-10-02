const express = require('express');
const router = express.Router();

const { pool } = require('../config/database');

async function ensureTable() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS qr_codes (
        id SERIAL PRIMARY KEY,
        qr_id VARCHAR(64) UNIQUE,
        table_number VARCHAR(32) NOT NULL,
        business_id INT NOT NULL DEFAULT 1,
        tenant_id INT,
        is_active BOOLEAN DEFAULT TRUE,
        anchor_url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_qr_codes_business_table ON qr_codes(business_id, table_number);
    `);
  } finally {
    client.release();
  }
}

// GET /api/qr/list?businessId=1
router.get('/list', async (req, res) => {
  try {
    await ensureTable();
    const businessId = parseInt(req.query.businessId || req.headers['x-business-id'] || req.tenant?.id || 1, 10);
    const result = await pool.query(
      'SELECT id as qr_id, table_number, business_id, is_active, anchor_url FROM qr_codes WHERE business_id = $1 ORDER BY table_number',
      [businessId]
    );
    return res.json({ success: true, qrCodes: result.rows });
  } catch (err) {
    console.error('GET /api/qr/list failed:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch QR codes' });
  }
});

// POST /api/qr/generate { tables: ["1","2"], businessId: 1 }
router.post('/generate', async (req, res) => {
  try {
    await ensureTable();
    const tables = Array.isArray(req.body.tables) ? req.body.tables : [];
    if (!tables.length) {
      return res.status(400).json({ success: false, error: 'Missing tables array' });
    }
    const businessId = parseInt(req.body.businessId || req.headers['x-business-id'] || req.tenant?.id || 1, 10);

    const created = [];
    const errors = [];

    // Determine the frontend origin for anchor URLs
    const frontendOrigin = process.env.FRONTEND_ORIGIN
      || process.env.FRONTEND_BASE_URL
      || 'http://localhost:3000';

    for (const t of tables) {
      const tableNum = String(t).trim();
      if (!tableNum) continue;
  const qrId = `b${businessId}_t${tableNum}`.slice(0, 32);
  const anchor = `${frontendOrigin}/?table=${encodeURIComponent(tableNum)}`;
      try {
        const existing = await pool.query(
          'SELECT id as qr_id, table_number, anchor_url FROM qr_codes WHERE business_id = $1 AND table_number = $2',
          [businessId, tableNum]
        );
        if (existing.rows.length) {
          errors.push({ table: tableNum, message: 'Already exists', existing: existing.rows[0] });
          continue;
        }
        const insert = await pool.query(
          'INSERT INTO qr_codes (qr_id, table_number, business_id, is_active, anchor_url) VALUES ($1,$2,$3,true,$4) RETURNING id as qr_id, table_number, business_id, is_active, anchor_url',
          [qrId, tableNum, businessId, anchor]
        );
        created.push(insert.rows[0]);
      } catch (e) {
        errors.push({ table: tableNum, message: e.message });
      }
    }

    return res.json({ success: true, qrCodes: created, errors });
  } catch (err) {
    console.error('POST /api/qr/generate failed:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to generate QR codes' });
  }
});

module.exports = router;
