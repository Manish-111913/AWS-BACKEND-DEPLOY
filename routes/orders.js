const express = require('express');
const router = express.Router();
const db = require('../config/database');

// --- Helpers: payment method detection and caching ---
let __hasPaymentMethodCol = null;
let __diningSessionCols = null; // caches detected start column names { modern, legacy, primary }
async function hasOrdersPaymentMethodColumn() {
  if (__hasPaymentMethodCol !== null) return __hasPaymentMethodCol;
  try {
    const r = await db.pool.query(`
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = 'orders' AND column_name = 'payment_method'
      LIMIT 1
    `);
    __hasPaymentMethodCol = r.rows.length > 0;
  } catch (_) {
    __hasPaymentMethodCol = false;
  }
  return __hasPaymentMethodCol;
}

// Detect both modern (dining_sessions) and legacy (DiningSessions) start columns (started_at vs start_time)
async function getDiningSessionStartColumns(forceRefresh = false) {
  if (__diningSessionCols && !forceRefresh) return __diningSessionCols;
  const result = { modern: 'start_time', legacy: 'start_time', primary: 'start_time' };
  try {
    // We query both tables separately; existence of the table itself might differ by install.
    const modern = await db.pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'dining_sessions' AND column_name IN ('started_at','start_time')
    `);
    if (modern.rows.length) {
      const hasStartedAt = modern.rows.some(r => r.column_name === 'started_at');
      result.modern = hasStartedAt ? 'started_at' : 'start_time';
    }
    const legacy = await db.pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'diningsessions' AND column_name IN ('started_at','start_time')
    `);
    if (legacy.rows.length) {
      const hasLegacyStartedAt = legacy.rows.some(r => r.column_name === 'started_at');
      result.legacy = hasLegacyStartedAt ? 'started_at' : 'start_time';
    }
    // Decide primary preference: prefer modern table if any column present; else legacy
    if (modern.rows.length) result.primary = result.modern; else if (legacy.rows.length) result.primary = result.legacy;
  } catch (e) {
    // swallow; keep defaults
  }
  __diningSessionCols = result;
  return __diningSessionCols;
}

// Backward compatibility: original single-column getter (returns primary)
async function getDiningSessionStartColumn() { const cols = await getDiningSessionStartColumns(); return cols.primary; }

function isCounterish(method) {
  if (!method) return false;
  const s = String(method).toUpperCase();
  return s.includes('COUNTER') || s.includes('CASH');
}

// In-memory cache for counter sessions when column missing
const sessionCounterCache = new Map(); // session_id -> { hasCounter: true, expiresAt }
function markSessionCounter(sessionId, ttlHours = 12) {
  if (!sessionId) return;
  const expiresAt = Date.now() + Math.max(1, ttlHours) * 60 * 60 * 1000;
  sessionCounterCache.set(String(sessionId), { hasCounter: true, expiresAt });
}
function isCounterSessionCached(sessionId) {
  const entry = sessionCounterCache.get(String(sessionId));
  if (!entry) return false;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    sessionCounterCache.delete(String(sessionId));
    return false;
  }
  return !!entry.hasCounter;
}

// Tenant helper
function getBusinessId(req) {
  const businessId =
    req.headers['x-tenant-id'] ||
    req.headers['X-Tenant-Id'] ||
    req.headers['x-business-id'] ||
    req.headers['X-Business-Id'] ||
    req.query.tenant ||
    req.query.businessId ||
    req.business_id || 1;
  return parseInt(businessId) || 1;
}

// --- Minimal inventory deduction stub (keeps API stable) ---
async function deductInventoryForOrder(client, orderId, items, businessId) {
  // Intentionally simplified; non-blocking
  return { missingUpdates: [] };
}

// --- Sales recording helper (simplified) ---
async function recordSaleForOrder(client, orderId, businessId, options = {}) {
  const { items = null, totalAmount = null, paymentMethod = 'Online' } = options;
  await client.query("SELECT set_config('app.current_business_id', $1, true)", [String(businessId)]);

  // Build aggregated items
  let agg = new Map();
  if (Array.isArray(items) && items.length > 0) {
    for (const it of items) {
      const id = Number(it.menu_item_id);
      const qty = Math.max(1, parseInt(it.quantity || 1, 10));
      const price = Number(it.price || 0);
      const cur = agg.get(id) || { qty: 0, unit_price: price };
      cur.qty += qty;
      if (!cur.unit_price && price) cur.unit_price = price;
      agg.set(id, cur);
    }
  } else {
    const rows = await client.query(`
      SELECT oi.menu_item_id, COUNT(*)::int AS qty, mi.price::decimal AS price
      FROM OrderItems oi
      JOIN MenuItems mi ON mi.menu_item_id = oi.menu_item_id
      JOIN Orders o ON o.order_id = oi.order_id
      WHERE oi.order_id = $1 AND o.business_id = $2
      GROUP BY oi.menu_item_id, mi.price
    `, [orderId, businessId]);
    for (const r of rows.rows) {
      agg.set(Number(r.menu_item_id), { qty: Number(r.qty), unit_price: Number(r.price || 0) });
    }
  }

  let computedTotal = 0;
  for (const [, v] of agg.entries()) computedTotal += Number(v.qty) * Number(v.unit_price || 0);
  const saleTotal = Number(totalAmount || computedTotal || 0);

  const saleRes = await client.query(`
    INSERT INTO SalesTransactions (
      business_id, transaction_date, transaction_time,
      total_amount, discount_amount, tax_amount, payment_method, status, created_at, updated_at
    ) VALUES ($1, CURRENT_DATE, CURRENT_TIME, $2, 0, 0, $3, 'Confirmed', NOW(), NOW())
    RETURNING sale_id
  `, [businessId, saleTotal, paymentMethod || 'Online']);
  const saleId = saleRes.rows[0].sale_id;

  if (agg.size > 0) {
    const lineValues = [];
    const params = [];
    let i = 1;
    for (const [menuId, v] of agg.entries()) {
      params.push(saleId, menuId, v.qty, v.unit_price, (Number(v.qty) * Number(v.unit_price || 0)));
      lineValues.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
    }
    const sql = `
      INSERT INTO SaleLineItems (sale_id, menu_item_id, quantity_sold, unit_price, line_item_amount)
      VALUES ${lineValues.join(',')}
    `;
    await client.query(sql, params);
  }

  return { sale_id: saleId, total: saleTotal };
}

// --- Create Order (reusing existing modern dining session if present) ---
// Root cause of "table not turning green" even after payment:
//  - Each new order previously CREATED a brand new legacy DiningSessions row.
//  - The QR scan (/start-session) created or reused a MODERN dining_sessions row.
//  - /api/orders/by-table prefers the row with an active session but may pick the modern one
//    that had ZERO orders attached (remaining yellow) while the paid order was linked to the
//    separate legacy session. We fix this by always reusing (or creating) the modern session
//    and attaching orders to it.
router.post('/', async (req, res) => {
  const client = await db.pool.connect();
  try {
    console.log('📋 Creating new order (session reuse flow)');
    let customer_name, customer_phone, table_number, items, total_amount, payment_method, payment_status, special_requests;

    if (req.body.customerInfo) {
      customer_name = req.body.customerInfo.name || 'QR Customer';
      customer_phone = req.body.customerInfo.phone || '0000000000';
      table_number = req.body.tableNumber || `QR-${Date.now().toString().slice(-4)}`;
      items = (req.body.items || []).map(it => ({
        name: it.name,
        price: Number(it.price || 0),
        customizations: Array.isArray(it.customizations) ? it.customizations : [],
        menu_item_id: parseInt(it.id ?? it.menu_item_id, 10),
        quantity: Math.max(1, parseInt(it.quantity || 1, 10))
      }));
      total_amount = Number(req.body.paymentInfo?.amount) || items.reduce((s, i) => s + (Number(i.price || 0) * Number(i.quantity || 1)), 0);
      payment_method = req.body.paymentInfo?.method || 'Online';
      payment_status = isCounterish(payment_method) ? 'unpaid' : 'paid';
      special_requests = req.body.specialRequests?.join(', ') || '';
    } else {
      customer_name = req.body.customer_name || 'Customer';
      customer_phone = req.body.customer_phone || '0000000000';
      table_number = req.body.table_number || `QR-${Date.now().toString().slice(-4)}`;
      items = (req.body.items || []).map(it => ({
        name: it.name,
        price: Number(it.price || 0),
        customizations: Array.isArray(it.customizations) ? it.customizations : [],
        menu_item_id: parseInt(it.menu_item_id ?? it.id, 10),
        quantity: Math.max(1, parseInt(it.quantity || 1, 10))
      }));
      total_amount = Number(req.body.total_amount);
      payment_method = req.body.payment_method || 'Online';
      payment_status = req.body.payment_status || (isCounterish(payment_method) ? 'unpaid' : 'paid');
      special_requests = req.body.special_requests || '';
    }

    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ success: false, error: 'Items array is required and cannot be empty' });
    if (!total_amount || Number(total_amount) <= 0) return res.status(400).json({ success: false, error: 'Valid total amount is required' });
    for (let idx = 0; idx < items.length; idx++) {
      if (!Number.isFinite(items[idx].menu_item_id)) return res.status(400).json({ success: false, error: `Invalid menu_item_id at item ${idx + 1}` });
    }

    const businessId = getBusinessId(req);
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_business_id', $1, true)", [String(businessId)]);

    // 1. Ensure modern qr_codes row
    let modern_qr_id;
    try {
      const modernQr = await client.query(`SELECT id FROM qr_codes WHERE business_id = $1 AND table_number = $2 LIMIT 1`, [businessId, table_number]);
      if (modernQr.rows.length) {
        modern_qr_id = modernQr.rows[0].id;
      } else {
        const ins = await client.query(`INSERT INTO qr_codes (business_id, table_number, is_active, created_at) VALUES ($1,$2,TRUE,NOW()) RETURNING id`, [businessId, table_number]);
        modern_qr_id = ins.rows[0].id;
      }
    } catch (e) {
      console.warn('⚠️ modern qr_codes unavailable, will fallback legacy:', e.message);
    }

    let dining_session_id = null;
    let usingModern = false;
    if (modern_qr_id) {
      const existingModern = await client.query(`SELECT session_id FROM dining_sessions WHERE qr_code_id = $1 AND is_active = TRUE LIMIT 1`, [modern_qr_id]);
      if (existingModern.rows.length) {
        dining_session_id = existingModern.rows[0].session_id;
        usingModern = true;
        console.log(`♻️ Reusing modern dining_session ${dining_session_id}`);
      } else {
        const newModern = await client.query(`INSERT INTO dining_sessions (business_id, qr_code_id, start_time, is_active, created_at) VALUES ($1,$2,NOW(),TRUE,NOW()) RETURNING session_id`, [businessId, modern_qr_id]);
        dining_session_id = newModern.rows[0].session_id;
        usingModern = true;
        console.log(`🆕 Created modern dining_session ${dining_session_id}`);
      }
    }
    if (!dining_session_id) {
      // Legacy fallback
      let qrRes = await client.query(`SELECT qr_code_id FROM QRCodes WHERE business_id = $1 AND table_number = $2 LIMIT 1`, [businessId, table_number]);
      let legacy_qr_id;
      if (qrRes.rows.length) legacy_qr_id = qrRes.rows[0].qr_code_id; else {
        const insQr = await client.query(`INSERT INTO QRCodes (business_id, table_number, is_active, created_at) VALUES ($1,$2,TRUE,NOW()) RETURNING qr_code_id`, [businessId, table_number]);
        legacy_qr_id = insQr.rows[0].qr_code_id;
      }
      const dsRes = await client.query(`INSERT INTO DiningSessions (business_id, qr_code_id, start_time, status, created_at) VALUES ($1,$2,NOW(),'active',NOW()) RETURNING session_id`, [businessId, legacy_qr_id]);
      dining_session_id = dsRes.rows[0].session_id;
      try { await client.query(`UPDATE QRCodes SET current_session_id = $1 WHERE qr_code_id = $2`, [dining_session_id, legacy_qr_id]); } catch(_) {}
      console.log(`🆕 Created legacy dining_session ${dining_session_id}`);
    }

    // 2. Insert order
    const canStoreMethod = await hasOrdersPaymentMethodColumn();
    let orderRes;
    if (canStoreMethod) {
      orderRes = await client.query(`INSERT INTO Orders (business_id, dining_session_id, status, customer_prep_time_minutes, customer_timer_paused, payment_status, payment_method, placed_at, inventory_deducted, created_at, updated_at) VALUES ($1,$2,'PLACED',30,FALSE,$3,$4,NOW(),FALSE,NOW(),NOW()) RETURNING order_id`, [businessId, dining_session_id, payment_status, String(payment_method)]);
    } else {
      orderRes = await client.query(`INSERT INTO Orders (business_id, dining_session_id, status, customer_prep_time_minutes, customer_timer_paused, payment_status, placed_at, inventory_deducted, created_at, updated_at) VALUES ($1,$2,'PLACED',30,FALSE,$3,NOW(),FALSE,NOW(),NOW()) RETURNING order_id`, [businessId, dining_session_id, payment_status]);
      if (isCounterish(payment_method)) markSessionCounter(dining_session_id);
    }
    const orderId = orderRes.rows[0].order_id;

    // 3. Insert items
    let insertedItemsCount = 0;
    for (const it of items) {
      const qty = Math.max(1, parseInt(it.quantity || 1, 10));
      for (let i = 0; i < qty; i++) {
        await client.query(`INSERT INTO OrderItems (order_id, menu_item_id, item_status, business_id, created_at, updated_at) VALUES ($1,$2,'QUEUED',$3,NOW(),NOW())`, [orderId, it.menu_item_id, businessId]);
        insertedItemsCount++;
      }
    }

    // 4. Inventory + sales
    let deductionInfo = await deductInventoryForOrder(client, orderId, items, businessId).catch(() => ({ missingUpdates: [] }));
    if (String(payment_status).toLowerCase() === 'paid') {
      try { await recordSaleForOrder(client, orderId, businessId, { items, totalAmount: total_amount, paymentMethod: payment_method }); } catch (e) { console.warn('⚠️ Failed to record sale at creation (non-fatal):', e.message); }
      if (usingModern) {
        try { await client.query(`UPDATE dining_sessions SET payment_status='paid', updated_at = NOW() WHERE session_id = $1`, [dining_session_id]); } catch(_) {}
      }
    }

    await client.query('COMMIT');
    return res.status(201).json({ success: true, message: 'Order created successfully', data: { order_id: orderId, items_count: insertedItemsCount, total_amount, status: 'PLACED', session_id: dining_session_id, usingModern, warnings: (deductionInfo && deductionInfo.missingUpdates && deductionInfo.missingUpdates.length) ? { missingInventoryItems: deductionInfo.missingUpdates } : undefined } });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('❌ Error creating order:', error);
    return res.status(500).json({ success: false, error: 'Failed to create order: ' + error.message });
  } finally { client.release(); }
});

// --- Start (or fetch) a dining session WITHOUT placing an order (scan event) ---
// Body: { table_number: <number|string> }
// Returns: { session_id, table_number, created: boolean }
router.post('/start-session', async (req, res) => {
  try {
    let { table_number, qr_id, qrId } = req.body || {};
    qr_id = qr_id || qrId; // normalize
    const businessId = getBusinessId(req);

    // If qr_id provided, resolve table_number from modern qr_codes first, then legacy QRCodes
    if (!table_number && qr_id) {
      const modern = await db.pool.query(`SELECT table_number FROM qr_codes WHERE qr_id = $1 AND business_id = $2 LIMIT 1`, [qr_id, businessId]);
      if (modern.rows.length) table_number = modern.rows[0].table_number;
      else {
        const legacy = await db.pool.query(`SELECT table_number FROM QRCodes WHERE qr_code_id::text = $1 AND business_id = $2 LIMIT 1`, [qr_id, businessId]);
        if (legacy.rows.length) table_number = legacy.rows[0].table_number;
      }
    }

    if (!table_number && table_number !== 0) {
      return res.status(400).json({ success: false, error: 'table_number or qr_id is required' });
    }

    // Ensure QR code existence (prefer modern table)
    let qrRes = await db.pool.query(
      `SELECT id AS qr_code_id FROM qr_codes WHERE business_id = $1 AND table_number = $2 LIMIT 1`,
      [businessId, table_number]
    );
    let qr_code_id;
    if (qrRes.rows.length === 0) {
      // Fallback to legacy table
      let legacyRes = await db.pool.query(
        `SELECT qr_code_id FROM QRCodes WHERE business_id = $1 AND table_number = $2 LIMIT 1`,
        [businessId, table_number]
      );
      if (legacyRes.rows.length === 0) {
        // Create modern row
        const ins = await db.pool.query(
          `INSERT INTO qr_codes (business_id, table_number, is_active, created_at)
           VALUES ($1, $2, TRUE, NOW()) RETURNING id`,
          [businessId, table_number]
        );
        qr_code_id = ins.rows[0].id;
      } else {
        qr_code_id = legacyRes.rows[0].qr_code_id;
      }
    } else {
      qr_code_id = qrRes.rows[0].qr_code_id;
    }

    // Check existing active session (modern: dining_sessions has is_active; legacy: status='active')
    let sess = await db.pool.query(
      `SELECT session_id FROM dining_sessions WHERE qr_code_id = $1 AND is_active = TRUE LIMIT 1`,
      [qr_code_id]
    );
    if (!sess.rows.length) {
      // Try legacy join if not found (in case qr_code_id points to legacy row id)
      sess = await db.pool.query(
        `SELECT ds.session_id FROM DiningSessions ds
         JOIN QRCodes qc ON qc.current_session_id = ds.session_id
         WHERE qc.qr_code_id = $1 AND ds.status='active' LIMIT 1`,
        [qr_code_id]
      );
    }
    let created = false;
    let session_id;
    if (sess.rows.length) {
      session_id = sess.rows[0].session_id;
    } else {
      // Insert modern dining session first
      const insS = await db.pool.query(
        `INSERT INTO dining_sessions (business_id, qr_code_id, start_time, is_active, created_at)
         VALUES ($1, $2, NOW(), TRUE, NOW()) RETURNING session_id`,
        [businessId, qr_code_id]
      ).catch(()=>null);
      if (insS && insS.rows.length) {
        session_id = insS.rows[0].session_id;
      } else {
        // Fallback legacy
        const legacyS = await db.pool.query(
          `INSERT INTO DiningSessions (business_id, qr_code_id, start_time, status, created_at)
           VALUES ($1, $2, NOW(), 'active', NOW()) RETURNING session_id`,
          [businessId, qr_code_id]
        );
        session_id = legacyS.rows[0].session_id;
        try { await db.pool.query(`UPDATE QRCodes SET current_session_id = $1 WHERE qr_code_id = $2`, [session_id, qr_code_id]); } catch(_) {}
      }
      created = true;
    }
    return res.json({ success: true, data: { session_id: Number(session_id), table_number, created } });
  } catch (e) {
    console.error('❌ Error starting session:', e);
    return res.status(500).json({ success: false, error: 'Failed to start session: ' + e.message });
  }
});

// --- Kitchen Queue ---
router.get('/kitchen-queue', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const result = await db.pool.query(`
      WITH __ctx AS (
        SELECT set_config('app.current_business_id', $1::text, true)
      )
      SELECT o.order_id AS id,
             CASE WHEN o.status = 'IN_PROGRESS' THEN 'PREPARING' ELSE o.status::text END AS status,
             o.placed_at,
             o.customer_prep_time_minutes,
             COALESCE(qc.table_number, 'NA') AS table_number,
             FLOOR(EXTRACT(EPOCH FROM (NOW() - o.placed_at)) / 60) AS minutes_elapsed,
             (
               SELECT COALESCE(JSON_AGG(
                        JSON_BUILD_OBJECT('menu_item_id', g.menu_item_id, 'menu_item_name', g.name, 'quantity', g.qty)
                      ), '[]'::json)
               FROM (
                 SELECT oi.menu_item_id, m.name, COUNT(*)::int AS qty
                 FROM OrderItems oi JOIN MenuItems m ON m.menu_item_id = oi.menu_item_id
                 WHERE oi.order_id = o.order_id
                 GROUP BY oi.menu_item_id, m.name
               ) g
             ) AS items
      FROM Orders o
      LEFT JOIN DiningSessions ds ON ds.session_id = o.dining_session_id
      LEFT JOIN QRCodes qc ON qc.qr_code_id = ds.qr_code_id
      WHERE o.status IN ('PLACED', 'IN_PROGRESS', 'READY') AND o.business_id = $1::int
      ORDER BY o.placed_at ASC
    `, [businessId]);

    return res.json({ success: true, orders: result.rows });
  } catch (error) {
    console.error('❌ Error fetching kitchen queue:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch kitchen queue: ' + error.message });
  }
});

// --- SIMPLE PAYMENT STATUS TABLE AGGREGATION ---
// GET /api/orders/by-table?businessId=1
// Returns tables with color based ONLY on Orders.payment_status (all paid -> green, any unpaid -> yellow, none -> ash)
router.get('/by-table', async (req, res) => {
  const businessId = getBusinessId(req);
  try {
    const sql = `
      WITH legacy AS (
        SELECT q.table_number::text AS table_number,
               q.qr_code_id::int    AS qr_code_id,
               ds.session_id::int   AS session_id,
               NULL::text           AS modern_payment_status,
               ds.status::text      AS legacy_status
        FROM QRCodes q
        LEFT JOIN DiningSessions ds ON ds.qr_code_id = q.qr_code_id AND ds.status='active'
        WHERE q.business_id = $1 AND (q.is_active IS DISTINCT FROM FALSE)
      ), modern AS (
        SELECT qc.table_number::text AS table_number,
               qc.id::int            AS qr_code_id,
               d.id::int             AS session_id,
               d.payment_status::text AS modern_payment_status,
               NULL::text            AS legacy_status
        FROM qr_codes qc
        LEFT JOIN dining_sessions d ON d.qr_code_id = qc.id AND d.is_active = TRUE
        WHERE qc.business_id = $1 AND (qc.is_active IS DISTINCT FROM FALSE)
      ), unioned AS (
        SELECT * FROM legacy
        UNION ALL
        SELECT * FROM modern
      ), dedup AS (
        SELECT DISTINCT ON (table_number)
               table_number, qr_code_id, session_id, modern_payment_status, legacy_status
        FROM (
          SELECT u.*, (u.session_id IS NOT NULL)::int AS has_session
          FROM unioned u
        ) z
        ORDER BY table_number, has_session DESC, qr_code_id DESC
      ), orders_agg AS (
        SELECT o.dining_session_id AS session_id,
               COUNT(o.order_id) AS orders_count,
               COUNT(*) FILTER (WHERE o.payment_status <> 'paid') AS unpaid_count,
               COUNT(*) FILTER (WHERE o.payment_status = 'paid')  AS paid_count
        FROM Orders o
        WHERE o.business_id = $1
        GROUP BY o.dining_session_id
      )
      SELECT d.table_number,
             d.qr_code_id,
             d.session_id,
             d.modern_payment_status,
             COALESCE(a.orders_count,0)  AS orders_count,
             COALESCE(a.unpaid_count,0)  AS unpaid_count,
             COALESCE(a.paid_count,0)    AS paid_count
      FROM dedup d
      LEFT JOIN orders_agg a ON a.session_id = d.session_id
      ORDER BY (
        CASE WHEN d.table_number ~ '^[0-9]+$' THEN d.table_number::int ELSE 999999 END
      ), d.table_number ASC`;
    const { rows } = await db.pool.query(sql, [businessId]);
    const tables = rows.map(r => {
      // Color determination (v2):
      // 1. No session -> ash
      // 2. Modern session paid (payment_status='paid') -> green immediately (even if zero or unpaid legacy orders not present)
      // 3. Session active & zero orders & not paid -> yellow (scanned but no orders yet)
      // 4. Orders exist: any unpaid -> yellow; else all paid -> green
      // This ensures "after payment it turns green" in both modern (session-level) and legacy (order-level) flows.
      let color = 'ash';
      let colorReason = 'no-session';
      const hasSession = !!r.session_id;
      const ordersCount = Number(r.orders_count);
      const unpaidCount = Number(r.unpaid_count);
  // Normalize modern payment status (trim + lowercase) to handle accidental whitespace like 'paid\n'
  const normalizedModern = (r.modern_payment_status || '').toString().trim().toLowerCase();
  const modernPaid = normalizedModern === 'paid';
      if (hasSession) {
        if (modernPaid) {
          color = 'green';
          colorReason = 'modern-session-paid';
        } else if (ordersCount === 0) {
          color = 'yellow';
          colorReason = 'session-no-orders-yet';
        } else if (unpaidCount > 0) {
          color = 'yellow';
          colorReason = 'some-unpaid-orders';
        } else {
          color = 'green';
          colorReason = 'all-orders-paid';
        }
      }
      return {
        table_number: r.table_number,
        qr_code_id: r.qr_code_id,
        session_id: r.session_id,
        orders_count: Number(r.orders_count),
        unpaid_count: Number(r.unpaid_count),
        paid_count: Number(r.paid_count),
        modern_payment_status: r.modern_payment_status && r.modern_payment_status.toString().trim(),
        color,
        colorReason
      };
    });
    // Optional debug=1 -> include raw order payment statuses per session to prove linkage
    if (String(req.query.debug || '').toLowerCase() === '1') {
      const sessionIds = tables.filter(t => t.session_id).map(t => t.session_id);
      if (sessionIds.length) {
        try {
          const statusRes = await db.pool.query(`SELECT dining_session_id, ARRAY_AGG(payment_status) AS statuses FROM Orders WHERE dining_session_id = ANY($1::int[]) GROUP BY dining_session_id`, [sessionIds]);
          const byId = new Map(statusRes.rows.map(r => [r.dining_session_id, r.statuses]));
          for (const t of tables) if (t.session_id && byId.has(t.session_id)) t.order_statuses = byId.get(t.session_id);
        } catch (e) {
          console.warn('debug order statuses fetch failed:', e.message);
        }
      }
    }
    return res.json({ businessId, tables, count: tables.length });
  } catch (e) {
    console.error('❌ /api/orders/by-table error:', e);
    return res.status(500).json({ success:false, error:'Failed to aggregate tables: '+ e.message });
  }
});

// --- Debug helper: recent orders with table mapping ---
// GET /api/orders/debug-latest?businessId=1&limit=20
router.get('/debug-latest', async (req, res) => {
  const businessId = getBusinessId(req);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '20', 10)));
  try {
    const sql = `
      WITH modern AS (
        SELECT o.order_id, o.dining_session_id, o.payment_status, o.payment_method,
               o.placed_at, ds.payment_status AS session_payment_status,
               qc.table_number, ds.is_active, 'modern' AS session_type
        FROM Orders o
        JOIN dining_sessions ds ON ds.session_id = o.dining_session_id
        JOIN qr_codes qc ON qc.id = ds.qr_code_id
        WHERE o.business_id = $1
      ), legacy AS (
        SELECT o.order_id, o.dining_session_id, o.payment_status, o.payment_method,
               o.placed_at, NULL::text AS session_payment_status,
               qc.table_number, (ds.status = 'active') AS is_active, 'legacy' AS session_type
        FROM Orders o
        JOIN DiningSessions ds ON ds.session_id = o.dining_session_id
        JOIN QRCodes qc ON qc.qr_code_id = ds.qr_code_id
        WHERE o.business_id = $1
      ), unioned AS (
        SELECT * FROM modern
        UNION ALL
        SELECT * FROM legacy
      )
      SELECT * FROM unioned
      ORDER BY placed_at DESC
      LIMIT $2`;
    const { rows } = await db.pool.query(sql, [businessId, limit]);
    return res.json({ success: true, count: rows.length, orders: rows });
  } catch (e) {
    console.error('❌ /api/orders/debug-latest error:', e);
    return res.status(500).json({ success:false, error:e.message });
  }
});

// --- Update order status ---
router.patch('/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    const businessId = getBusinessId(req);
    const statusMapping = { PLACED: 'PLACED', PREPARING: 'IN_PROGRESS', READY: 'READY', COMPLETED: 'COMPLETED' };
    const dbStatus = statusMapping[String(status || '').toUpperCase()] || String(status || '').toUpperCase();
    const result = await db.pool.query(`
      UPDATE Orders SET status = $1, updated_at = NOW()
      WHERE order_id = $2 AND business_id = $3
      RETURNING order_id, status
    `, [dbStatus, orderId, businessId]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Order not found' });
    return res.json({ success: true, message: 'Order status updated successfully', data: result.rows[0] });
  } catch (error) {
    console.error('❌ Error updating order status:', error);
    return res.status(500).json({ success: false, error: 'Failed to update order status: ' + error.message });
  }
});

// --- Mark order as paid ---
router.patch('/:orderId/pay', async (req, res) => {
  const { orderId } = req.params;
  const businessId = getBusinessId(req);
  const paymentMethod = req.body?.payment_method || req.body?.method || 'Online';
  const providedTotal = req.body?.total_amount;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_business_id', $1, true)", [String(businessId)]);

    const ord = await client.query('SELECT order_id, payment_status, dining_session_id FROM Orders WHERE order_id = $1 AND business_id = $2', [orderId, businessId]);
    if (ord.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    const canStoreMethod = await hasOrdersPaymentMethodColumn();
    if (canStoreMethod) {
      await client.query(`
        UPDATE Orders SET payment_status = 'paid', payment_method = $3, updated_at = NOW()
        WHERE order_id = $1 AND business_id = $2
      `, [orderId, businessId, String(paymentMethod)]);
    } else {
      await client.query(`
        UPDATE Orders SET payment_status = 'paid', updated_at = NOW()
        WHERE order_id = $1 AND business_id = $2
      `, [orderId, businessId]);
      if (isCounterish(paymentMethod)) markSessionCounter(ord.rows[0]?.dining_session_id);
    }

    const oiRes = await client.query(`
      SELECT oi.menu_item_id, COUNT(*)::int AS quantity, mi.price::decimal AS price
      FROM OrderItems oi
      JOIN Orders o ON o.order_id = oi.order_id
      JOIN MenuItems mi ON mi.menu_item_id = oi.menu_item_id
      WHERE oi.order_id = $1 AND o.business_id = $2
      GROUP BY oi.menu_item_id, mi.price
    `, [orderId, businessId]);
    const itms = oiRes.rows.map(r => ({ menu_item_id: Number(r.menu_item_id), quantity: Number(r.quantity), price: Number(r.price || 0) }));
    const computed = itms.reduce((s, r) => s + (Number(r.quantity) * Number(r.price || 0)), 0);
    const total = Number(providedTotal || computed || 0);

    const sale = await recordSaleForOrder(client, orderId, businessId, { items: itms, totalAmount: total, paymentMethod });
    // Mark session paid if all orders paid (updates modern dining_sessions or legacy fallback)
    try {
      const allPaidRes = await client.query(`SELECT BOOL_AND(payment_status='paid') AS all_paid FROM Orders WHERE dining_session_id = $1 AND business_id = $2`, [ord.rows[0].dining_session_id, businessId]);
      if (allPaidRes.rows.length && allPaidRes.rows[0].all_paid) {
        const upd = await client.query(`UPDATE dining_sessions SET payment_status='paid', updated_at = NOW() WHERE session_id = $1 RETURNING session_id`, [ord.rows[0].dining_session_id]);
        if (upd.rowCount === 0) {
          try { await client.query(`UPDATE DiningSessions SET status='paid', updated_at=NOW() WHERE session_id = $1`, [ord.rows[0].dining_session_id]); } catch(_) {}
        }
      }
    } catch (e2) { console.warn('⚠️ session payment_status update fail (non-fatal):', e2.message); }
    await client.query('COMMIT');
    return res.json({ success: true, message: 'Payment recorded and sale created', data: { order_id: Number(orderId), sale_id: sale.sale_id || null, total } });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Error recording payment/sale:', e);
    return res.status(500).json({ success: false, error: 'Failed to record payment: ' + e.message });
  } finally {
    client.release();
  }
});

// --- Get individual order details (for customer tracking) ---
router.get('/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const businessId = getBusinessId(req);
    
    // Use similar query structure as kitchen-queue endpoint
    const orderQuery = `
      WITH __ctx AS (
        SELECT set_config('app.current_business_id', $2::text, true)
      )
      SELECT o.order_id,
             o.status,
             o.placed_at,
             o.updated_at,
             o.total_amount,
             o.customer_prep_time_minutes,
             o.actual_ready_time,
             o.dining_session_id,
             COALESCE(qc.table_number, 'Table ' || o.dining_session_id) as table_number,
             (
               SELECT COALESCE(JSON_AGG(
                        JSON_BUILD_OBJECT(
                          'menu_item_id', g.menu_item_id, 
                          'item_name', g.name, 
                          'quantity', g.qty,
                          'price', g.price
                        )
                      ), '[]'::json)
               FROM (
                 SELECT oi.menu_item_id, m.name, COUNT(*)::int AS qty, m.price
                 FROM OrderItems oi JOIN MenuItems m ON m.menu_item_id = oi.menu_item_id
                 WHERE oi.order_id = o.order_id
                 GROUP BY oi.menu_item_id, m.name, m.price
               ) g
             ) AS items_json
      FROM Orders o
      LEFT JOIN DiningSessions ds ON ds.session_id = o.dining_session_id
      LEFT JOIN QRCodes qc ON qc.qr_code_id = ds.qr_code_id
      WHERE o.order_id = $1::int AND o.business_id = $2::int
    `;
    
    const orderResult = await db.pool.query(orderQuery, [orderId, businessId]);
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }
    
    const order = orderResult.rows[0];
    
    const response = {
      success: true,
      order: {
        order_id: parseInt(order.order_id),
        status: order.status,
        placed_at: order.placed_at,
        updated_at: order.updated_at,
        total_amount: parseFloat(order.total_amount || 0),
        customer_prep_time_minutes: parseInt(order.customer_prep_time_minutes || 25),
        actual_ready_time: order.actual_ready_time,
        dining_session_id: parseInt(order.dining_session_id),
        table_number: order.table_number,
        items: order.items_json || []
      }
    };
    
    return res.json(response);
    
  } catch (error) {
    console.error('❌ Error fetching order details:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch order details: ' + error.message
    });
  }
});

// --- Deduction summary ---
router.get('/:orderId/deduction-summary', async (req, res) => {
  const { orderId } = req.params;
  const businessId = getBusinessId(req);
  try {
    await db.pool.query("SELECT set_config('app.current_business_id', $1, false)", [String(businessId)]);
    const sql = `
      WITH __ctx AS (
        SELECT set_config('app.current_business_id', $1::text, true)
      ),
      oi AS (
        SELECT oi.order_item_id, oi.menu_item_id
        FROM OrderItems oi
        JOIN Orders o ON oi.order_id = o.order_id
        WHERE oi.order_id = $2::int AND o.business_id = $1::int
      ),
      ri AS (
        SELECT ri.item_id, ri.quantity, ri.unit_id, oi.menu_item_id
        FROM oi JOIN RecipeIngredients ri ON ri.recipe_id = oi.menu_item_id
      ),
      inv AS (
        SELECT ii.item_id, ii.name, ii.standard_unit_id, ii.current_stock
        FROM InventoryItems ii
        WHERE ii.business_id = $1::int
      ),
      qty AS (
        SELECT 
          ri.item_id,
          SUM(
            ri.quantity * COALESCE(
              (SELECT conversion_factor FROM BusinessUnitConversions bc 
               WHERE bc.business_id = $1::int AND bc.from_unit_id = ri.unit_id AND bc.to_unit_id = inv.standard_unit_id
               LIMIT 1),
              CASE WHEN ri.unit_id = inv.standard_unit_id THEN 1 ELSE 1 END
            )
          ) AS qty_deducted
        FROM ri
        JOIN inv ON inv.item_id = ri.item_id
        GROUP BY ri.item_id
      )
      SELECT q.item_id, inv.name, q.qty_deducted, inv.current_stock AS current_stock_after, gu.unit_symbol
      FROM qty q
      JOIN inv ON inv.item_id = q.item_id
      LEFT JOIN GlobalUnits gu ON gu.unit_id = inv.standard_unit_id
      ORDER BY inv.name`;
    const result = await db.pool.query(sql, [businessId, orderId]);
    return res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('❌ Error building deduction summary:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// --- Owner summary ---
router.get('/owner-summary', async (req, res) => {
  const businessId = getBusinessId(req);
  try {
    await db.pool.query("SELECT set_config('app.current_business_id', $1, true)", [String(businessId)]);
    const canUseMethod = await hasOrdersPaymentMethodColumn();
    const { modern: modernStartCol, legacy: legacyStartCol } = await getDiningSessionStartColumns();

    const revRes = await db.pool.query(`
      SELECT COALESCE(SUM(total_amount), 0)::decimal AS total
      FROM SalesTransactions
      WHERE business_id = $1 AND transaction_date = CURRENT_DATE AND status = 'Confirmed'
    `, [businessId]);
    const todayRevenue = Number(revRes.rows[0]?.total || 0);

    const counterRes = await db.pool.query(`
      SELECT st.sale_id, st.total_amount::decimal AS amount, UPPER(st.payment_method) AS payment_method,
             st.created_at,
             (
               SELECT STRING_AGG(DISTINCT mi.name, ' + ' ORDER BY mi.name)
               FROM SaleLineItems sli
               JOIN MenuItems mi ON mi.menu_item_id = sli.menu_item_id
               WHERE sli.sale_id = st.sale_id
             ) AS items_text
      FROM SalesTransactions st
      WHERE st.business_id = $1 AND st.transaction_date = CURRENT_DATE AND UPPER(st.payment_method) IN ('COUNTER','CASH')
      ORDER BY st.created_at DESC
      LIMIT 20
    `, [businessId]);
    const counterOrders = counterRes.rows.map(r => ({
      id: Number(r.sale_id), amount: Number(r.amount || 0), payment_method: r.payment_method || 'COUNTER', created_at: r.created_at,
      item: r.items_text || 'Counter Order', status: 'completed'
    }));

    // Helper builder so we can retry with fallback column(s) if needed
    const buildTablesSql = (modernCol, legacyCol) => `
      WITH __ctx AS (
        SELECT set_config('app.current_business_id', $1::text, true)
      ),
      new_active AS (
        SELECT nc.id::int AS qr_code_id,
               nc.table_number::text AS table_number,
               ds.session_id::int AS session_id,
               ds.${modernCol}::timestamptz AS start_time
        FROM qr_codes nc
        LEFT JOIN dining_sessions ds ON ds.qr_code_id = nc.id AND ds.is_active = TRUE
        WHERE nc.business_id = $1::int AND nc.is_active = TRUE
      ),
      legacy_active AS (
        SELECT qc.qr_code_id::int AS qr_code_id,
               qc.table_number::text AS table_number,
               ds.session_id::int AS session_id,
               ds.${legacyCol}::timestamptz AS start_time
        FROM QRCodes qc
        LEFT JOIN DiningSessions ds ON ds.session_id = qc.current_session_id
        WHERE qc.business_id = $1::int AND qc.is_active = TRUE
      ),
      t AS (
        SELECT * FROM new_active
        UNION ALL
        SELECT * FROM legacy_active WHERE NOT EXISTS (SELECT 1 FROM new_active)
      ),
      dedup AS (
        -- Collapse duplicates by table_number: prefer new_active rows (present earlier in UNION) and highest qr_code_id (latest)
        /* Updated preference rules:
           1. Rows with a non-null session_id (active dining session) first
           2. Then by higher qr_code_id (latest)
           3. Ensures that if a legacy + modern row exist, the one with an active session surfaces
        */
        SELECT DISTINCT ON (table_number) *
        FROM (
          SELECT t.*, t.qr_code_id AS sort_id, (t.session_id IS NOT NULL)::int AS has_session
          FROM t
        ) z
        ORDER BY table_number, has_session DESC, sort_id DESC
      ),
      orders_today AS (
        SELECT o.dining_session_id AS session_id,
               BOOL_AND(o.payment_status = 'paid') AS all_paid,
               BOOL_OR(o.payment_status = 'unpaid') AS had_unpaid
        FROM Orders o
        WHERE o.business_id = $1::int AND o.placed_at::date = CURRENT_DATE
        GROUP BY o.dining_session_id
      ),
      order_items_today AS (
        /*
          order_item_status_enum = ('QUEUED','IN_PROGRESS','COMPLETED')
          We previously (incorrectly) checked for 'READY'. Interpret readiness as ANY completed item.
        */
        SELECT o.dining_session_id AS session_id,
               BOOL_OR(oi.item_status = 'COMPLETED') AS any_ready,
               COUNT(*) > 0 AS any_items
        FROM Orders o
        JOIN OrderItems oi ON oi.order_id = o.order_id
        WHERE o.business_id = $1::int AND o.placed_at::date = CURRENT_DATE
        GROUP BY o.dining_session_id
      ),
      first_ready AS (
        SELECT o.dining_session_id AS session_id, MIN(oi.updated_at) AS first_ready_at
        FROM Orders o
        JOIN OrderItems oi ON oi.order_id = o.order_id
        WHERE o.business_id = $1::int AND o.placed_at::date = CURRENT_DATE AND oi.item_status = 'COMPLETED'
        GROUP BY o.dining_session_id
      ),
      items_per AS (
        SELECT o.dining_session_id AS session_id, mi.menu_item_id, mi.name, mi.price::decimal AS unit_price, COUNT(*)::int AS qty
        FROM OrderItems oi
        JOIN Orders o ON o.order_id = oi.order_id
        JOIN MenuItems mi ON mi.menu_item_id = oi.menu_item_id
        WHERE o.business_id = $1::int AND o.placed_at::date = CURRENT_DATE
        GROUP BY o.dining_session_id, mi.menu_item_id, mi.name, mi.price
      ),
      session_totals AS (
        SELECT session_id, SUM(qty * unit_price)::decimal AS amount FROM items_per GROUP BY session_id
      ),
      items_agg AS (
        SELECT ip.session_id, st.amount,
               JSON_AGG(JSON_BUILD_OBJECT('item', ip.name, 'quantity', ip.qty, 'price', ip.unit_price) ORDER BY ip.name) AS items
        FROM items_per ip JOIN session_totals st ON st.session_id = ip.session_id
        GROUP BY ip.session_id, st.amount
      )
      SELECT d.qr_code_id, d.table_number, d.session_id, d.start_time,
        COALESCE(ia.amount, 0)::decimal AS amount,
        COALESCE(oa.all_paid, false) AS all_paid,
        COALESCE(oa.had_unpaid, false) AS had_unpaid,
        COALESCE(oit.any_ready, false) AS any_ready,
        COALESCE(oit.any_items, false) AS any_items,
        (d.session_id IS NOT NULL) AS session_active,
        fr.first_ready_at,
        COALESCE(ia.items, '[]'::json) AS items,
        FLOOR(EXTRACT(EPOCH FROM (NOW() - COALESCE(d.start_time, NOW()))) / 60) AS minutes_elapsed
      FROM dedup d
      LEFT JOIN items_agg ia ON ia.session_id = d.session_id
      LEFT JOIN orders_today oa ON oa.session_id = d.session_id
      LEFT JOIN order_items_today oit ON oit.session_id = d.session_id
      LEFT JOIN first_ready fr ON fr.session_id = d.session_id
      ORDER BY d.table_number::text`;

    let tablesRes;
    try {
      tablesRes = await db.pool.query(buildTablesSql(modernStartCol, legacyStartCol), [businessId]);
    } catch (e) {
      if (e && e.code === '42703') {
        // Fallback force to start_time for both
        try {
          tablesRes = await db.pool.query(buildTablesSql('start_time', 'start_time'), [businessId]);
        } catch (inner) {
          throw inner; // rethrow if fallback also fails
        }
      } else {
        throw e;
      }
    }

    let hasCounterBySession = new Map();
    if (canUseMethod) {
      const cm = await db.pool.query(`
        SELECT o.dining_session_id AS session_id,
               BOOL_OR((COALESCE(o.payment_method,'') ILIKE '%COUNTER%') OR (COALESCE(o.payment_method,'') ILIKE '%CASH%')) AS has_counter
        FROM Orders o
        WHERE o.business_id = $1::int AND o.placed_at::date = CURRENT_DATE
        GROUP BY o.dining_session_id
      `, [businessId]);
      hasCounterBySession = new Map(cm.rows.map(r => [String(r.session_id), r.has_counter]));
    }

    const model = String(req.query.model || '').toLowerCase(); // 'pay-first' or 'eat-first'
    const tables = tablesRes.rows.map((r, idx) => {
      const hasItems = !!r.any_items;
      const sessionActive = !!r.session_active; // newly exposed: session exists even if no items yet
      const sessionKey = String(r.session_id);
      const isCounter = canUseMethod ? !!hasCounterBySession.get(sessionKey) : isCounterSessionCached(r.session_id);
      let semanticStatus = 'empty'; // internal semantic
      if (model === 'pay-first') {
        /* Exact Pay First spec:
           Ash: no activity / not yet paid
           Yellow: payment secured (all orders paid) but no item served
           Green: first item ready (customer eating)
           We intentionally DO NOT show yellow merely for items unless they are fully paid.
        */
        if (r.any_ready) {
          semanticStatus = 'green';
        } else if (r.all_paid && hasItems) {
          semanticStatus = 'yellow';
        }
      } else { // eat-first (default)
        /*
          Eat First model semantics:
            - empty: no active dining session yet (table not scanned / opened)
            - yellow: active session (even with zero items yet) until fully paid
            - green: after ALL orders in the session are paid (all_paid)
          We intentionally do NOT require hasItems to show yellow so that a pure scan immediately surfaces.
        */
        if (sessionActive) {
          if (r.all_paid) semanticStatus = 'green';
          else semanticStatus = 'yellow';
        }
      }
      // Legacy 'cash' / 'paid' translation for existing UI (will map in frontend)
      let legacyStatus = 'empty';
      if (semanticStatus === 'yellow') legacyStatus = 'cash'; // reuse orange style until we add new classes
      if (semanticStatus === 'green') legacyStatus = 'paid';
      // Timer behavior:
      //  - Eat-first: show duration since session start (existing minutes_elapsed)
      //  - Pay-first: requirement says timer starts when customer begins eating (first item ready / green)
      let minsSource = Number(r.minutes_elapsed || 0); // default session start
      if (model === 'pay-first' && semanticStatus === 'green' && r.first_ready_at) {
        // compute minutes since first_ready_at
        try {
          const firstReadyMs = new Date(r.first_ready_at).getTime();
            const diffMin = Math.floor((Date.now() - firstReadyMs) / 60000);
            if (diffMin >= 0) minsSource = diffMin;
        } catch (_) {}
      }
      const mins = Math.max(0, minsSource);
      const timeStr = mins >= 60 ? `${Math.floor(mins / 60)}hr` : `${mins}m`;
      if ((process.env.DEBUG_SEMANTIC === '1') || String(req.query.debug_semantic||'').toLowerCase()==='true') {
        const debugObj = {
          table_number: r.table_number,
          session_id: r.session_id,
          model,
          sessionActive,
          any_items: r.any_items,
          all_paid: r.all_paid,
          had_unpaid: r.had_unpaid,
          any_ready: r.any_ready,
          first_ready_at: r.first_ready_at,
          derived_semantic: semanticStatus
        };
        console.log('[semantic-debug]', debugObj);
        r._debug_explanation = (function(){
          if (!sessionActive) return 'no-active-session';
          if (model === 'eat-first') {
            if (semanticStatus === 'yellow') return 'eat-first-active-not-paid';
            if (semanticStatus === 'green') return 'eat-first-paid-complete';
          } else {
            if (!r.all_paid && !r.any_ready) return 'pay-first-not-paid';
            if (r.all_paid && !r.any_ready && semanticStatus==='yellow') return 'pay-first-paid-waiting-item';
            if (r.any_ready && semanticStatus==='green') return 'pay-first-item-ready';
          }
          return 'state-derived';
        })();
      }
      return {
        id: Number(r.qr_code_id || idx + 1),
        name: `Table ${r.table_number}`,
        status: legacyStatus,
        semantic: semanticStatus, // expose new semantic for frontend refinement
        session_active: !!r.session_active, // helpful for debugging session without items
        debug_explanation: r._debug_explanation,
        amount: Number(r.amount || 0),
        time: timeStr,
        orders: Array.isArray(r.items) ? r.items : [],
        paymentMethod: legacyStatus === 'paid' ? 'Paid' : '' ,
        customerCount: hasItems ? 1 : 0
      };
    });

    return res.json({ success: true, data: { todayRevenue, counter: { orders: counterOrders, count: counterOrders.length, totalRevenue: counterOrders.reduce((s, o) => s + Number(o.amount || 0), 0) }, tables } });
  } catch (error) {
    console.error('❌ Error building owner summary:', error);
    return res.status(500).json({ success: false, error: 'Failed to load owner summary: ' + error.message });
  }
});

// --- Owner analytics ---
router.get('/owner-analytics', async (req, res) => {
  const businessId = getBusinessId(req);
  const runQuery = async (startColumn) => {
    const revAvg = await db.pool.query(`
      SELECT COALESCE(SUM(total_amount), 0)::decimal AS daily_revenue,
             COALESCE(AVG(total_amount), 0)::decimal AS avg_order_value
      FROM SalesTransactions
      WHERE business_id = $1 AND transaction_date = CURRENT_DATE AND status = 'Confirmed'
    `, [businessId]);
    const custRes = await db.pool.query(`
      SELECT COUNT(DISTINCT o.dining_session_id)::int AS total_customers
      FROM Orders o
      WHERE o.business_id = $1 AND o.placed_at::date = CURRENT_DATE
    `, [businessId]);
    const avgTimeRes = await db.pool.query(`
      WITH sess AS (
        SELECT DISTINCT o.dining_session_id AS session_id
        FROM Orders o
        WHERE o.business_id = $1 AND o.placed_at::date = CURRENT_DATE
      )
      SELECT COALESCE(AVG(FLOOR(EXTRACT(EPOCH FROM (NOW() - ds.${startColumn})) / 60))::int, 0) AS avg_minutes
      FROM sess s JOIN DiningSessions ds ON ds.session_id = s.session_id
    `, [businessId]);
    const popularRes = await db.pool.query(`
      SELECT mi.name AS item_name, COUNT(oi.order_item_id)::int AS orders
      FROM OrderItems oi
      JOIN Orders o ON o.order_id = oi.order_id
      JOIN MenuItems mi ON mi.menu_item_id = oi.menu_item_id
      WHERE o.business_id = $1 AND o.placed_at::date = CURRENT_DATE
      GROUP BY mi.name ORDER BY orders DESC, mi.name ASC LIMIT 10
    `, [businessId]);
    return {
      dailyRevenue: Number(revAvg.rows[0]?.daily_revenue || 0),
      totalCustomers: Number(custRes.rows[0]?.total_customers || 0),
      avgOrderValue: Number(revAvg.rows[0]?.avg_order_value || 0),
      avgTableTimeMinutes: Number(avgTimeRes.rows[0]?.avg_minutes || 0),
      popularItems: popularRes.rows.map(r => ({ name: r.item_name, orders: Number(r.orders || 0) }))
    };
  };
  try {
    await db.pool.query("SELECT set_config('app.current_business_id', $1, true)", [String(businessId)]);
    let sessionStartCol = await getDiningSessionStartColumn();
    let data;
    try {
      data = await runQuery(sessionStartCol);
    } catch (e) {
      if (e && e.code === '42703' && sessionStartCol !== 'start_time') {
        // Refresh detection and force fallback to start_time
        await getDiningSessionStartColumns(true);
        sessionStartCol = 'start_time';
        data = await runQuery(sessionStartCol); // retry
      } else {
        throw e;
      }
    }
    return res.json({ success: true, data });
  } catch (error) {
    console.error('❌ Error building owner analytics:', error);
    return res.status(500).json({ success: false, error: 'Failed to load owner analytics: ' + error.message });
  }
});

// ========== CHEF DASHBOARD API ENDPOINTS ==========

// --- Get chef dashboard orders (pending and in-progress) ---
router.get('/chef/pending', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    
    const result = await db.pool.query(`
      SELECT 
        o.order_id,
        o.status,
        o.placed_at,
        o.customer_prep_time_minutes,
        o.dining_session_id,
        COALESCE(qc.table_number, CONCAT('Table-', ds.session_id)) as table_number,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'item_name', oi.item_name,
            'quantity', oi.quantity,
            'customizations', oi.customizations
          )
          ORDER BY oi.order_item_id
        ) as items,
        SUM(oi.quantity * oi.unit_price) as total_amount,
        EXTRACT(EPOCH FROM (NOW() - o.placed_at)) / 60 as minutes_since_placed
      FROM Orders o
      LEFT JOIN OrderItems oi ON o.order_id = oi.order_id
      LEFT JOIN DiningSessions ds ON ds.session_id = o.dining_session_id
      LEFT JOIN QRCodes qc ON qc.qr_code_id = ds.qr_code_id
      WHERE o.status IN ('PLACED', 'IN_PROGRESS') 
        AND o.business_id = $1::int
      GROUP BY o.order_id, o.status, o.placed_at, o.customer_prep_time_minutes, 
               o.dining_session_id, qc.table_number, ds.session_id
      ORDER BY o.placed_at ASC
    `, [businessId]);

    return res.json({ success: true, orders: result.rows });
  } catch (error) {
    console.error('❌ Error fetching chef pending orders:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch pending orders: ' + error.message });
  }
});

// --- Start preparing an order (chef clicks "Start Preparing") ---
router.patch('/:orderId/start-preparing', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { orderId } = req.params;
    const businessId = getBusinessId(req);
    const chefId = req.body.chef_id || req.headers['x-user-id']; // Chef user ID
    
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_business_id', $1, true)", [String(businessId)]);

    // Update order status to IN_PROGRESS and set preparation start time
    const result = await client.query(`
      UPDATE Orders 
      SET 
        status = 'IN_PROGRESS',
        updated_at = NOW()
      WHERE order_id = $1 AND business_id = $2 AND status = 'PLACED'
      RETURNING order_id, status, updated_at, customer_prep_time_minutes, dining_session_id
    `, [orderId, businessId]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false, 
        error: 'Order not found or already being prepared' 
      });
    }

    // Log the chef action (optional for audit)
    if (chefId) {
      try {
        await client.query(`
          INSERT INTO UserNotifications (business_id, user_id, title, message, notification_type, is_read)
          VALUES ($1, $2, 'Order Started', 'Order #' || $3 || ' preparation started', 'order_status', false)
        `, [businessId, chefId, orderId]);
      } catch (logError) {
        // Don't fail the main operation if logging fails
        console.warn('Warning: Could not log chef action:', logError.message);
      }
    }

    await client.query('COMMIT');

    return res.json({ 
      success: true, 
      message: 'Order preparation started successfully',
      data: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error starting order preparation:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to start order preparation: ' + error.message 
    });
  } finally {
    client.release();
  }
});

// --- Complete order (chef clicks "Complete Order") ---
router.patch('/:orderId/complete', async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { orderId } = req.params;
    const businessId = getBusinessId(req);
    const chefId = req.body.chef_id || req.headers['x-user-id']; // Chef user ID
    
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_business_id', $1, true)", [String(businessId)]);

    // Update order status to READY (ready for pickup/delivery)
    const result = await client.query(`
      UPDATE Orders 
      SET 
        status = 'READY',
        updated_at = NOW(),
        actual_ready_time = NOW()
      WHERE order_id = $1 AND business_id = $2 AND status = 'IN_PROGRESS'
      RETURNING order_id, status, actual_ready_time, dining_session_id
    `, [orderId, businessId]);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false, 
        error: 'Order not found or not in preparation' 
      });
    }

    // Log the chef action
    if (chefId) {
      try {
        await client.query(`
          INSERT INTO UserNotifications (business_id, user_id, title, message, notification_type, is_read)
          VALUES ($1, $2, 'Order Ready', 'Order #' || $3 || ' is ready for pickup', 'order_status', false)
        `, [businessId, chefId, orderId]);
      } catch (logError) {
        // Don't fail the main operation if logging fails
        console.warn('Warning: Could not log chef action:', logError.message);
      }
    }

    await client.query('COMMIT');

    return res.json({ 
      success: true, 
      message: 'Order completed successfully',
      data: result.rows[0]
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error completing order:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to complete order: ' + error.message 
    });
  } finally {
    client.release();
  }
});

// --- Get chef dashboard statistics ---
router.get('/chef/stats', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    
    const result = await db.pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'PLACED') as pending_orders,
        COUNT(*) FILTER (WHERE status = 'IN_PROGRESS') as orders_in_progress,
        COUNT(*) FILTER (WHERE status = 'READY') as ready_orders,
        COUNT(*) FILTER (WHERE status = 'COMPLETED' AND DATE(updated_at) = CURRENT_DATE) as completed_today,
        AVG(EXTRACT(EPOCH FROM (actual_ready_time - updated_at)) / 60) 
          FILTER (WHERE actual_ready_time IS NOT NULL AND status = 'READY') 
          as avg_prep_time_minutes
      FROM Orders 
      WHERE business_id = $1::int
        AND (status IN ('PLACED', 'IN_PROGRESS', 'READY') OR 
             (status = 'COMPLETED' AND DATE(updated_at) = CURRENT_DATE))
    `, [businessId]);

    return res.json({ success: true, stats: result.rows[0] });
  } catch (error) {
    console.error('❌ Error fetching chef stats:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch chef statistics: ' + error.message });
  }
});

module.exports = router;
