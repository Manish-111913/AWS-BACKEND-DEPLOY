const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const fetch = require('node-fetch');
const StockInModel = require('../models/StockIn');
const { validateStockIn } = require('../middleware/validation');
const { spawn } = require('child_process');
const path = require('path');


// POST /api/stock-in - Create completed stock in record
// Helper: run Python validator (Gemini primary). Fails closed when not available.
async function runAIValidation(items) {
  const scriptPath = path.join(__dirname, '..', 'python', 'food_validator.py');
  const payload = JSON.stringify({ items: items.map(it => ({
    item_name: (it?.item_name || '').toString(),
    category: (it?.category || '').toString()
  })) });

  const runPythonOnce = (cmd) => new Promise((resolve, reject) => {
    const child = spawn(cmd, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
    }, 10000);
    child.stdout.on('data', d => stdout += d.toString());
    child.stderr.on('data', d => stderr += d.toString());
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr || `validator exited ${code}`));
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(new Error(`Invalid JSON from validator: ${e.message}`)); }
    });
    child.stdin.write(payload);
    child.stdin.end();
  });

  try {
    return await runPythonOnce('python');
  } catch (e1) {
    return await runPythonOnce('py');
  }
}

async function aiValidateItems(req, res, next) {
  try {
    const items = (req.validatedData?.items) || (req.body?.items);
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'No items to validate' });
    }
    const result = await runAIValidation(items);
    const results = Array.isArray(result?.results) ? result.results : [];
    if (results.length !== items.length) {
      return res.status(500).json({ success: false, error: 'AI validation failed: mismatched results' });
    }
    const invalids = results.filter(r => r && r.valid === false);
    if (invalids.length > 0) {
      return res.status(400).json({ success: false, error: 'invalid item : Give a correct input', details: invalids });
    }
    // Optionally align categories with AI suggestion when provided and allowed
    const allowed = new Set(['Meat','Seafood','Vegetables','Dairy','Spices','Grains','Beverages','Oils']);
    // Respect client locking: never alter item_name; only fill empty category if not locked
    results.forEach(r => {
      if (!r || typeof r.index !== 'number') return;
      const idx = r.index;
      const rec = items[idx];
      if (!rec) return;
      const locked = rec.client_lock === true;
      // item_name untouched intentionally
      if (!locked) {
        const sug = (r.suggested_category || '').trim();
        if (sug && allowed.has(sug) && !rec.category) {
          rec.category = sug;
        }
      }
      // Preserve original OCR name if client sent it
      if (rec.original_ocr_name === undefined && rec.item_name) {
        rec.original_ocr_name = rec.item_name;
      }
    });
    // Persist the possibly-updated items back into validatedData so the model sees aligned categories
    if (req.validatedData) req.validatedData.items = items;
    next();
  } catch (error) {
    // Fail closed: block submission if validator cannot run
    return res.status(500).json({ success: false, error: 'AI validator unavailable. Configure GOOGLE_VISION_API_KEY and Python.' });
  }
}

router.post('/', validateStockIn, aiValidateItems, async (req, res) => {
  try {
    const result = await StockInModel.createStockInRecord(req.validatedData, false);
    // Fire-and-forget: sync notifications with current stock alerts
    (async () => {
      try {
        const businessId = 1; // TODO: derive from auth/req.validatedData
        const userId = 1; // TODO: derive current user
        await fetch('http://localhost:5000/api/notifications/sync/stock-alerts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessId, userId })
        });
      } catch (e) {
        // silent
      }
    })();

    res.status(201).json({
      success: true,
      message: 'Stock in record created successfully',
      data: result
    });
  } catch (error) {
    console.error('Error creating stock in record:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create stock in record',
      details: error.message
    });
  }
});


// POST /api/stock-in/draft - Create draft stock in record
router.post('/draft', validateStockIn, aiValidateItems, async (req, res) => {
  try {
    const result = await StockInModel.createStockInRecord(req.validatedData, true);
    
    res.status(201).json({
      success: true,
      message: 'Draft saved successfully',
      data: result
    });
  } catch (error) {
    console.error('Error saving draft:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save draft',
      details: error.message
    });
  }
});


// GET /api/stock-in/inventory/overview - Real-time inventory overview
router.get('/inventory/overview', async (req, res) => {
  // Set CORS and Cross-Origin-Resource-Policy headers
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  try {
    const { pool } = require('../config/database');
    const includeComplimentary = String(req.query.includeComplimentary || '').toLowerCase() === 'true';
    const hideExpired = String(req.query.hideExpired || '').toLowerCase() === 'true';
    const hideZeroStock = String(req.query.hideZeroStock || '').toLowerCase() === 'true';
    const excludeUncategorized = String(req.query.excludeUncategorized || '').toLowerCase() === 'true';
    const q = (req.query.q || '').toString().trim();
    // sources: comma separated list. If provided and not equal to '*' or 'all', only include those sources
    const sourcesParam = (req.query.sources || '').toString().trim();
    const parsedSources = sourcesParam
      ? sourcesParam.split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const restrictSources = parsedSources.length > 0 && !parsedSources.includes('*') && !parsedSources.includes('all');

    const businessId = parseInt(req.query.business_id || req.headers['x-tenant-id'] || req.headers['X-Tenant-Id'] || 1, 10) || 1;
    // Set tenant context for RLS
    await pool.query("SELECT set_config('app.current_business_id', $1, false)", [String(businessId)]);
    
    // Query based on your actual DBsetup.js schema
    // Build dynamic filters
    const whereClauses = [
      'ii.business_id = $1',
      'ii.is_active = TRUE'
    ];
    const params = [businessId];

    if (!includeComplimentary) {
      whereClauses.push('(ic.name IS NULL OR ic.name <> \'' + 'Complimentary Items' + '\')');
    }
    if (hideExpired) {
      // show items with no expiry or not yet expired
      whereClauses.push('(latest_batch.expiry_date IS NULL OR latest_batch.expiry_date >= CURRENT_DATE)');
    }
    if (hideZeroStock) {
      // filter where computed quantity > 0
      whereClauses.push('(COALESCE(ii.current_stock, COALESCE(batch_summary.total_quantity, 0)) > 0)');
    }
    if (excludeUncategorized) {
      // exclude Uncategorized items
      whereClauses.push("(ic.name IS NOT NULL AND ic.name <> 'Uncategorized')");
    }
    if (restrictSources) {
      params.push(parsedSources);
      whereClauses.push(`ii.source = ANY($${params.length}::text[])`);
    }
    if (q) {
      params.push(`%${q}%`);
      whereClauses.push(`(ii.name ILIKE $${params.length} OR ic.name ILIKE $${params.length})`);
    }

    const query = `
      SELECT 
        ii.item_id,
        ii.name as item_name,
        ii.source as source,
        ii.created_at as created_at,
        COALESCE(ii.current_stock, COALESCE(batch_summary.total_quantity, 0)) as quantity,
        COALESCE(gu.unit_name, 'units') as unit,
        COALESCE(ic.name, 'Uncategorized') as category,
        COALESCE(latest_batch.invoice_reference, latest_batch.batch_id::text, 'No batch') as batch_number,
        latest_batch.expiry_date,
        latest_batch.received_date,
        v.name AS supplier,
        COALESCE(latest_batch.updated_at, ii.updated_at) as updated_at,
        COALESCE(batch_summary.weighted_avg_cost, latest_batch.unit_cost, 0) as unit_cost,
        CASE 
          WHEN ii.source = 'ingredient_mapping' 
               AND ii.created_at >= (CURRENT_DATE - INTERVAL '7 days') THEN TRUE
          ELSE FALSE
        END AS is_newly_added,
        CASE 
          WHEN latest_batch.expiry_date IS NULL THEN 'No expiry date'
          WHEN latest_batch.expiry_date < CURRENT_DATE THEN 'Expired'
          WHEN latest_batch.expiry_date = CURRENT_DATE THEN 'Expires today'
          WHEN latest_batch.expiry_date <= CURRENT_DATE + INTERVAL '1 day' THEN 'Expires tomorrow'
          WHEN latest_batch.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'Expires in ' || (latest_batch.expiry_date - CURRENT_DATE) || ' days'
          WHEN latest_batch.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'Fresh'
          ELSE 'Good'
        END as status,
        CASE 
          WHEN latest_batch.expiry_date IS NULL THEN 999
          ELSE COALESCE((latest_batch.expiry_date - CURRENT_DATE), 999)
        END as days_to_expiry,
        CASE 
          WHEN batch_summary.total_quantity <= COALESCE(ii.reorder_point, 0) THEN 'low'
          WHEN batch_summary.total_quantity <= COALESCE(ii.safety_stock, 0) THEN 'medium'
          ELSE 'adequate'
        END as stock_level,
        ii.reorder_point as minimum_stock_level,
        ii.safety_stock as maximum_stock_level
      FROM InventoryItems ii
      LEFT JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
      LEFT JOIN InventoryCategories ic ON ii.category_id = ic.category_id
      LEFT JOIN (
        SELECT 
          item_id, 
          SUM(quantity) as total_quantity,
          SUM(quantity * unit_cost) / NULLIF(SUM(quantity), 0) as weighted_avg_cost
        FROM InventoryBatches 
        WHERE is_expired = FALSE
        GROUP BY item_id
      ) batch_summary ON ii.item_id = batch_summary.item_id
      LEFT JOIN (
        SELECT DISTINCT ON (item_id)
          item_id,
          batch_id,
          expiry_date,
          unit_cost,
          invoice_reference,
          vendor_id,
          received_date,
          updated_at
        FROM InventoryBatches 
        WHERE is_expired = FALSE
        ORDER BY item_id, expiry_date ASC NULLS LAST
      ) latest_batch ON ii.item_id = latest_batch.item_id
      LEFT JOIN Vendors v ON v.vendor_id = latest_batch.vendor_id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY 
        CASE 
          WHEN latest_batch.expiry_date IS NULL THEN 999
          WHEN latest_batch.expiry_date < CURRENT_DATE THEN -1
          ELSE (latest_batch.expiry_date - CURRENT_DATE)
        END ASC,
        ii.name ASC
    `;

    const result = await pool.query(query, params);
    
    // If no data, return sample data for testing
    if (result.rows.length === 0) {
      const sampleData = [
        {
          item_id: 1,
          item_name: 'Sample Tomatoes',
          quantity: 5,
          unit: 'kg',
          category: 'Vegetables',
          batch_number: 'SAMPLE001',
          expiry_date: '2025-08-15',
          status: 'Fresh',
          days_to_expiry: 20,
          stock_level: 'adequate',
          unit_cost: 25.50
        },
        {
          item_id: 2,
          item_name: 'Sample Chicken',
          quantity: 10,
          unit: 'kg',
          category: 'Meat',
          batch_number: 'SAMPLE002',
          expiry_date: '2025-07-28',
          status: 'Expires in 2 days',
          days_to_expiry: 2,
          stock_level: 'adequate',
          unit_cost: 180.00
        }
      ];
      
      return res.status(200).json({
        success: true,
        data: sampleData,
        timestamp: new Date().toISOString(),
        count: sampleData.length,
        message: 'Sample data - no inventory records found'
      });
    }
    
    // Process real data
    const processedData = result.rows.map(item => ({
      ...item,
      quantity: parseFloat(item.quantity) || 0,
      days_to_expiry: parseInt(item.days_to_expiry) || 999,
      is_fresh: item.days_to_expiry > 7,
      is_expiring_soon: item.days_to_expiry > 0 && item.days_to_expiry <= 7,
      is_expired: item.days_to_expiry < 0,
      last_updated: new Date().toISOString()
    }));
    
    res.status(200).json({
      success: true,
      data: processedData,
      timestamp: new Date().toISOString(),
      count: processedData.length,
      server_time: Date.now()
    });
    
  } catch (error) {
    console.error('❌ Error fetching inventory overview:', error);
    
    // Return sample data on error to keep frontend working
    const sampleData = [
      {
        item_id: 1,
        item_name: 'Sample Item',
        quantity: 1,
        unit: 'piece',
        category: 'Sample',
        batch_number: 'SAMPLE001',
        expiry_date: '2025-12-31',
        status: 'Good',
        days_to_expiry: 365,
        stock_level: 'adequate'
      }
    ];
    
    res.status(200).json({
      success: true,
      data: sampleData,
      timestamp: new Date().toISOString(),
      count: sampleData.length,
      message: 'Sample data - database error occurred',
      error: error.message
    });
  }
});


// GET /api/stock-in - Get all stock in records
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const status = req.query.status || null;
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT 
        sir.stock_in_id,
        sir.received_date,
        sir.total_cost,
        sir.status,
        sir.entry_method,
        sir.created_at,
        COUNT(sil.line_item_id) as total_items
      FROM StockInRecords sir
      LEFT JOIN StockInLineItems sil ON sir.stock_in_id = sil.stock_in_id
      WHERE sir.business_id = 1
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (status) {
      query += ` AND sir.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += `
      GROUP BY sir.stock_in_id, sir.received_date, sir.total_cost, 
               sir.status, sir.entry_method, sir.created_at
      ORDER BY sir.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    
    res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        page,
        limit,
        total_records: result.rows.length
      }
    });
  } catch (error) {
    console.error('Error fetching stock in records:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stock in records',
      details: error.message
    });
  }
});


// GET /api/stock-in/:id - Get specific stock in record
router.get('/:id', async (req, res) => {
  try {
    const stockInId = parseInt(req.params.id);
    
    if (isNaN(stockInId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid stock in ID'
      });
    }
    
    const record = await StockInModel.getStockInById(stockInId);
    
    if (!record) {
      return res.status(404).json({
        success: false,
        error: 'Stock in record not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: record
    });
  } catch (error) {
    console.error('Error fetching stock in record:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stock in record',
      details: error.message
    });
  }
});


// PUT /api/stock-in/:id/complete - Convert draft to completed
router.put('/:id/complete', async (req, res) => {
  try {
    const stockInId = parseInt(req.params.id);
    
    const updatedRecord = await StockInModel.updateDraftToCompleted(stockInId);
    
    if (!updatedRecord) {
      return res.status(404).json({
        success: false,
        error: 'Draft record not found or already completed'
      });
    }
    
    // Fire-and-forget: sync notifications with current stock alerts
    (async () => {
      try {
        const businessId = 1; // TODO: derive from auth/session
        const userId = 1;
        await fetch('http://localhost:5000/api/notifications/sync/stock-alerts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ businessId, userId })
        });
      } catch (e) {
        // silent
      }
    })();

    res.status(200).json({
      success: true,
      message: 'Draft converted to completed successfully',
      data: updatedRecord
    });
  } catch (error) {
    console.error('Error completing draft:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete draft',
      details: error.message
    });
  }
});


// DELETE /api/stock-in/:id - Delete stock in record
router.delete('/:id', async (req, res) => {
  try {
    const stockInId = parseInt(req.params.id);
    
    const deletedRecord = await StockInModel.deleteStockInRecord(stockInId);
    
    if (!deletedRecord) {
      return res.status(404).json({
        success: false,
        error: 'Stock in record not found'
      });
    }
    
    res.status(200).json({
      success: true,
      message: 'Stock in record deleted successfully',
      data: deletedRecord
    });
  } catch (error) {
    console.error('Error deleting stock in record:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete stock in record',
      details: error.message
    });
  }
});


// POST /api/stock-in/validate-items - Validate items using Python parser
router.post('/validate-items', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items) {
      return res.status(400).json({ success: false, error: 'items array is required' });
    }

    const scriptPath = path.join(__dirname, '..', 'python', 'food_validator.py');
    const payload = JSON.stringify({
      items: items.map(it => ({
        item_name: (it?.item_name || '').toString(),
        category: (it?.category || '').toString()
      }))
    });

    const runPython = (cmd) => new Promise((resolve, reject) => {
      const child = spawn(cmd, [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 10000);

      child.stdout.on('data', (d) => { stdout += d.toString(); });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          return reject(new Error(stderr || `Python exited with code ${code}`));
        }
        try {
          const parsed = JSON.parse(stdout);
          resolve(parsed);
        } catch (e) {
          reject(new Error(`Invalid JSON from validator: ${e.message}. Output: ${stdout}`));
        }
      });

      // write input
      child.stdin.write(payload);
      child.stdin.end();
    });

    let result;
    try {
      result = await runPython('python');
    } catch (e1) {
      try {
        result = await runPython('py');
      } catch (e2) {
        return res.status(500).json({ success: false, error: `Validator not available: ${e2.message}` });
      }
    }

    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('Error validating items via parser:', error);
    return res.status(500).json({ success: false, error: error.message || 'Validation failed' });
  }
});


module.exports = router;
