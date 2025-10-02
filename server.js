const serverless = require('serverless-http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();
const stockInRoutes = require('./routes/stockIn');
const inventoryRoutes = require('./routes/inventory');
const ocrRoutes = require('./routes/ocr');
const salesReportRoutes = require('./routes/salesReport');
const menuRoutes = require('./routes/enhancedMenu');
const recipesRoutes = require('./routes/recipes');
const wastageRoutes = require('./routes/wastage');
const usersRoutes = require('./routes/users');
const healthRoutes = require('./routes/health');
const usageRoutes = require('./routes/usage');
const unitMappingRoutes = require('./routes/unitMapping');
const authRoutes = require('./routes/auth');
const totalSales=require('./routes/totalSales');
const reportsRoutes = require('./routes/reports');
const abcAnalysisRoutes = require('./routes/abcAnalysis');
const recipeLibraryRoutes = require('./routes/recipeLibrary');
const imagesRoutes = require('./routes/images');
const qrBillingRoutes = require('./routes/qrBilling');

const qrCodesRoutes = require('./routes/qrCodes');
const rolesRoutes = require('./routes/roles');
const settingsRoutes = require('./routes/settings');
const inventoryCategoriesRoutes = require('./routes/inventoryCategories');
const ordersRoutes = require('./routes/orders');
// Lightweight sessions overview (added) reusing existing pool (declared later with testConnection)

// Multi-tenancy middleware (non-intrusive)
const tenantContext = require('./middleware/tenantContext');
// Diagnostics router will be mounted AFTER app + tenant middleware initialization further below
const minimalStockRoutes = require('./routes/minimalStock');
const vendorManagementRoutes = require('./routes/vendorManagement');
const reorderManagementRoutes = require('./routes/reorderManagement');
const notificationsRoutes = require('./routes/notifications');
const testCategoryAssignmentsRoutes = require('./routes/testCategoryAssignments');

// --- ADDED THIS LINE ---
const stockRepoRoutes = require('./routes/stockrepo'); 
// -----------------------

// Report Scheduler Service
const reportScheduler = require('./services/reportScheduler');

const { testConnection, pool } = require('./config/database'); // single import (avoid duplicate declaration)

const app = express();
// Default port aligned to operational expectation (5000). Override with PORT env if needed.
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
// CORS configuration
const corsOptions = {
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  // Allow custom tenant headers for multi-tenancy enforcement
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'X-Tenant-Id', 'X-Business-Id']
};

app.use(cors(corsOptions));

// Add Cross-Origin-Resource-Policy header to all responses
app.use((req, res, next) => {
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

// Minimal logging - only log OCR requests
app.use('/api/ocr', (req, res, next) => {
  console.log(`OCR ${req.method} request triggered`);
  next();
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
// Placeholder middleware kept (no-op)
app.use((req, res, next) => next());

// QR scan redirect (public)
const FRONTEND_REDIRECT_ORIGIN = process.env.FRONTEND_REDIRECT_ORIGIN || 'https://menu-frontend-9327c.web.app';
app.get('/qr/:qrId', async (req, res) => {
  const { qrId } = req.params;
  try {
    const scanStartTs = Date.now();
    console.log('[QR-SCAN] incoming request qrId=%s ip=%s ua="%s"', qrId, req.ip, (req.headers['user-agent']||'').slice(0,120));
    const { rows } = await pool.query(
      `SELECT id, qr_id, table_number, business_id, is_active, anchor_url FROM qr_codes WHERE qr_id=$1 LIMIT 1`,
      [qrId]
    );
    const row = rows[0];
    if (!row) {
      const fallbackNF = `${FRONTEND_REDIRECT_ORIGIN}/?qrId=${encodeURIComponent(qrId)}&notFound=1`;
      return res.redirect(302, fallbackNF);
    }
    const target = new URL(FRONTEND_REDIRECT_ORIGIN);
    target.searchParams.set('qrId', qrId);
    if (row.table_number) target.searchParams.set('table', row.table_number);
    if (row.business_id) target.searchParams.set('businessId', String(row.business_id));
    if (row.is_active === false) target.searchParams.set('inactive','1');

    // Optionally assign business_id if missing and provided via query
    const providedBiz = req.query.businessId ? parseInt(String(req.query.businessId),10) : null;
    if (row && !row.business_id && providedBiz) {
      try {
        await pool.query('UPDATE qr_codes SET business_id=$1 WHERE id=$2', [providedBiz, row.id]);
        row.business_id = providedBiz;
      } catch (e) {
        console.warn('[QR-SCAN] failed to assign business_id qrId=%s err=%s', qrId, e.message);
      }
    }

    // Auto-create sessions (modern + legacy best-effort)
    if (row && row.id) {
      try {
        await pool.query('BEGIN');
        const modernActive = await pool.query(`SELECT id FROM dining_sessions WHERE qr_code_id=$1 AND is_active=TRUE LIMIT 1`, [row.id]);
        if (!modernActive.rows.length) {
          const modernSessionId = 'S' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
          await pool.query(`INSERT INTO dining_sessions (session_id, qr_code_id, table_number, business_id, is_active, billing_model, started_at, last_activity)
                            VALUES ($1,$2,$3,$4,TRUE,'eat_first',NOW(),NOW())`, [modernSessionId, row.id, row.table_number, row.business_id]);
        }
        const legacyActive = await pool.query(`SELECT ds.session_id FROM DiningSessions ds JOIN QRCodes q ON q.qr_code_id=ds.qr_code_id
                                               WHERE q.business_id=$1 AND q.table_number=$2 AND ds.status='active' LIMIT 1`, [row.business_id, row.table_number]);
        if (!legacyActive.rows.length) {
          const legacyInsert = await pool.query(`INSERT INTO DiningSessions (business_id, qr_code_id, start_time, status, created_at)
                                                 SELECT $1, q.qr_code_id, NOW(), 'active', NOW() FROM QRCodes q WHERE q.business_id=$1 AND q.table_number=$2 RETURNING session_id`, [row.business_id, row.table_number]);
          if (legacyInsert.rows.length) {
            const legacyId = legacyInsert.rows[0].session_id;
            try { await pool.query(`UPDATE QRCodes SET current_session_id=$1 WHERE table_number=$2 AND business_id=$3`, [legacyId, row.table_number, row.business_id]); } catch(_){}
          }
        }
        await pool.query('COMMIT');
      } catch (sessErr) {
        try { await pool.query('ROLLBACK'); } catch(_){}
        console.warn('[QR-SCAN] session ensure failed qrId=%s err=%s', qrId, sessErr.message);
      }
    }

    console.log('[QR-SCAN] redirecting qrId=%s elapsed=%dms', qrId, Date.now()-scanStartTs);
    return res.redirect(302, target.toString());
  } catch (e) {
    console.error('[QR-SCAN] ERROR qrId=%s msg=%s', qrId, e.message);
    const fallback = `${FRONTEND_REDIRECT_ORIGIN}/?qrId=${encodeURIComponent(qrId)}&lookupError=1`;
    return res.redirect(302, fallback);
  }
});

// Serve static files from uploads directory with CORS headers
app.use('/uploads', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static('uploads'));

// Serve static files from images directory with CORS headers
app.use('/images', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static('images'));

// Routes
app.use('/api/auth', authRoutes);

// Tenant context now active for subsequent routes
app.use(tenantContext);

// Diagnostics (now that tenant context is set for this request session)
app.use('/diagnostics', require('./routes/diagnostics'));

app.use('/api/stock-in', stockInRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/sales-report', salesReportRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/recipes', recipesRoutes);
app.use('/api/wastage', wastageRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/unit-mapping', unitMappingRoutes);
app.use('/api/total-sales',totalSales);
app.use('/api/reports', reportsRoutes);
app.use('/api/abc-analysis', abcAnalysisRoutes);
app.use('/api/recipe-library', recipeLibraryRoutes);
app.use('/api/images', imagesRoutes);
app.use('/api/qr-billing', qrBillingRoutes);
app.use('/api/stockrepo', stockRepoRoutes);
// QR Management (QR codes, sessions, analytics)
app.use('/api/qr', qrCodesRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/inventory-categories', inventoryCategoriesRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/minimal-stock', minimalStockRoutes);

// --- QR Scan URL Helper (diagnostic) ---
app.get('/api/qr/scan-urls', async (req, res) => {
  try {
    const businessId = parseInt(req.query.businessId || '1', 10);
    // Detect host/port for constructing sample URLs
    const hostHeader = req.headers.host || `localhost:${PORT}`;
    const proto = (req.protocol || 'http');
    const base = `${proto}://${hostHeader}`;
    const modern = await pool.query(`SELECT id, qr_id, table_number, business_id, is_active FROM qr_codes WHERE business_id=$1 ORDER BY table_number::int NULLS LAST, table_number`, [businessId]);
    const legacy = await pool.query(`SELECT qr_code_id, table_number, business_id, is_active FROM QRCodes WHERE business_id=$1 ORDER BY table_number::int NULLS LAST, table_number`, [businessId]).catch(()=>({rows:[]}));
    const list = [];
    modern.rows.forEach(r=>{
      list.push({
        source:'modern',
        table_number:r.table_number,
        qr_id:r.qr_id,
        business_id:r.business_id,
        is_active:r.is_active,
        scan_url: r.qr_id ? `${base}/qr/${r.qr_id}?businessId=${r.business_id}` : null
      });
    });
    legacy.rows.forEach(r=>{
      list.push({
        source:'legacy',
        table_number:r.table_number,
        qr_id:String(r.qr_code_id),
        business_id:r.business_id,
        is_active:r.is_active,
        scan_url: `${base}/qr/${r.qr_code_id}?businessId=${r.business_id}`
      });
    });
    return res.json({ business_id: businessId, count: list.length, entries: list });
  } catch(e) {
    console.error('scan-urls error', e);
    return res.status(500).json({ error:'failed to build scan urls' });
  }
});

// --- Added Sessions Overview Endpoint (Parity with MENU-BACKEND minimal color logic) ---
// --- Bulk Generate QR Codes (modern schema) ---
// POST /api/qr/bulk-generate
// Body: { businessId, tables: ["1","2",...], includePng (optional boolean) }
// Returns: { businessId, count, base, qrs: [{ table_number, qr_id, scan_url, png? }] }
app.post('/api/qr/bulk-generate', async (req, res) => {
  try {
    const { businessId: rawBiz, tables, includePng = true } = req.body || {};
    const businessId = parseInt(rawBiz || req.query.businessId || '1', 10);
    if (!businessId) return res.status(400).json({ error: 'businessId required' });
    if (!Array.isArray(tables) || !tables.length) return res.status(400).json({ error: 'tables array required' });
    const hostHeader = req.headers.host || `localhost:${PORT}`;
    let base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${hostHeader}`).replace(/\/$/, '');
    // If base resolves to localhost or 127.x and no PUBLIC_BASE_URL provided, attempt LAN IP detection
    if (!process.env.PUBLIC_BASE_URL && /^(https?:\/\/)?(localhost|127\.|0\.0\.0\.0)/i.test(base)) {
      try {
        const os = require('os');
        const nets = os.networkInterfaces();
        outer: for (const name of Object.keys(nets)) {
          for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
              const portPart = hostHeader.split(':')[1] || PORT;
              base = `${req.protocol}://${net.address}:${portPart}`;
              break outer;
            }
          }
        }
      } catch(_) { /* ignore */ }
    }
    const results = [];
    for (const t of tables) {
      const tableNumber = String(t).trim();
      if (!tableNumber) continue;
      // Try find existing row
      let rowRes = await pool.query(`SELECT id, table_number, qr_id, business_id FROM qr_codes WHERE business_id=$1 AND table_number=$2 LIMIT 1`, [businessId, tableNumber]);
      let row = rowRes.rows[0];
      if (!row) {
        // Insert new
        rowRes = await pool.query(
          `INSERT INTO qr_codes (business_id, table_number, is_active, qr_id)
           VALUES ($1,$2,TRUE, LEFT(MD5(RANDOM()::text || NOW()::text),10))
           RETURNING id, table_number, qr_id, business_id`,
          [businessId, tableNumber]
        );
        row = rowRes.rows[0];
      } else if (!row.qr_id) {
        const regen = await pool.query(
          `UPDATE qr_codes SET qr_id = LEFT(MD5(RANDOM()::text || NOW()::text),10) WHERE id=$1 RETURNING qr_id`,
          [row.id]
        );
        row.qr_id = regen.rows[0].qr_id;
      }
      const scanUrl = `${base}/qr/${row.qr_id}?businessId=${businessId}`;
      let pngData = null;
      if (includePng) {
        try { pngData = await require('qrcode').toDataURL(scanUrl, { margin:1, scale:6 }); } catch(e) { pngData = null; }
      }
      const numericMatch = String(row.table_number).match(/(\d+)/);
      results.push({
        table_number: row.table_number,
        numeric_table: numericMatch ? numericMatch[1] : null,
        qr_id: row.qr_id,
        scan_url: scanUrl,
        png: pngData
      });
    }
    return res.json({ businessId, count: results.length, base, qrs: results });
  } catch (e) {
    console.error('POST /api/qr/bulk-generate error:', e);
    return res.status(500).json({ error: 'Failed to bulk generate' });
  }
});

app.get('/api/sessions/overview', async (req, res) => {
  try {
    const businessId = parseInt(req.query.businessId || req.query.tenant || '1', 10);
    if (!businessId) return res.status(400).json({ error: 'businessId required' });
    const mode = String(req.query.mode || 'eat_later').toLowerCase();

    const { rows } = await pool.query(`
      /* Unified legacy + modern QR/session overview with order/payment aggregation */
      WITH legacy AS (
        SELECT q.qr_code_id::int AS qr_code_id,
               q.table_number::text AS table_number,
               q.current_session_id::int AS linked_session_id,
               'legacy'::text AS source
        FROM QRCodes q
        WHERE q.business_id=$1 AND (q.is_active IS DISTINCT FROM FALSE)
      ), modern AS (
        SELECT m.id::int AS qr_code_id,
               m.table_number::text AS table_number,
               NULL::int AS linked_session_id,
               'modern'::text AS source
        FROM qr_codes m
        WHERE m.business_id=$1 AND (m.is_active IS DISTINCT FROM FALSE)
      ), all_qr AS (
        SELECT * FROM legacy
        UNION ALL
        SELECT * FROM modern
      ), legacy_sessions AS (
        SELECT ds.session_id::int AS session_id,
               ds.qr_code_id::int AS qr_code_id,
               ds.status::text AS status,
               (ds.status='active') AS session_is_active
        FROM DiningSessions ds
        WHERE ds.business_id=$1
      ), modern_sessions AS (
        SELECT md.id * -1 AS session_id,
               md.qr_code_id::int AS qr_code_id,
               CASE WHEN md.is_active THEN 'active' ELSE 'inactive' END AS status,
               md.is_active AS session_is_active,
               md.payment_status AS modern_payment_status
        FROM dining_sessions md
        WHERE md.business_id=$1 AND md.is_active=TRUE
      ), ds_join AS (
        SELECT a.qr_code_id, a.table_number, a.source,
               COALESCE(ls.session_id, ms.session_id) AS session_id,
               COALESCE(ls.status, ms.status) AS session_status,
               COALESCE(ls.session_is_active, ms.session_is_active) AS session_is_active,
               ms.modern_payment_status
        FROM all_qr a
        LEFT JOIN legacy_sessions ls ON ls.qr_code_id=a.qr_code_id AND ls.session_is_active=TRUE
        LEFT JOIN modern_sessions ms ON ms.qr_code_id=a.qr_code_id AND ls.session_id IS NULL
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY table_number ORDER BY
            (CASE WHEN session_is_active THEN 1 ELSE 0 END) DESC,
            (CASE WHEN source='modern' THEN 1 ELSE 0 END) DESC,
            qr_code_id DESC
        ) AS rn FROM ds_join
      ), dedup AS (
        SELECT * FROM ranked WHERE rn=1
      ), legacy_agg AS (
        SELECT o.dining_session_id AS legacy_session_id,
               COUNT(*) FILTER (WHERE o.dining_session_id IS NOT NULL) AS legacy_orders_count,
               BOOL_OR(o.payment_status <> 'paid') AS legacy_unpaid_exists,
               BOOL_OR(o.status IN ('READY','COMPLETED')) AS legacy_any_ready_order,
               EXISTS(
                 SELECT 1 FROM OrderItems oi JOIN Orders ox ON oi.order_id=ox.order_id
                 WHERE ox.dining_session_id=o.dining_session_id AND oi.item_status='COMPLETED'
               ) AS legacy_any_item_completed,
               (BOOL_AND(o.payment_status='paid') AND COUNT(*)>0) AS legacy_all_paid
        FROM Orders o
        GROUP BY o.dining_session_id
      ), modern_agg AS (
        SELECT so.session_id AS modern_session_pk,
               COUNT(*) AS modern_orders_count,
               MAX(CASE WHEN so.order_status IN ('ready','served','completed') THEN 1 ELSE 0 END) > 0 AS modern_any_ready_order
        FROM session_orders so
        GROUP BY so.session_id
      )
      SELECT d.qr_code_id,
             d.table_number,
             d.session_id,
             d.session_status,
             d.session_is_active,
             CASE
               WHEN d.session_id>0 THEN COALESCE((SELECT legacy_orders_count FROM legacy_agg la WHERE la.legacy_session_id=d.session_id),0)
               WHEN d.session_id<0 THEN COALESCE((SELECT modern_orders_count FROM modern_agg ma WHERE ma.modern_session_pk=(-d.session_id)),0)
               ELSE 0 END AS orders_count,
             CASE
               WHEN d.session_id>0 THEN COALESCE((SELECT legacy_unpaid_exists FROM legacy_agg la WHERE la.legacy_session_id=d.session_id),FALSE)
               WHEN d.session_id<0 THEN COALESCE((SELECT (ds.payment_status IS DISTINCT FROM 'paid') FROM dining_sessions ds WHERE ds.id=(-d.session_id)),FALSE)
               ELSE FALSE END AS unpaid_exists,
             CASE
               WHEN d.session_id>0 THEN COALESCE((SELECT legacy_any_ready_order FROM legacy_agg la WHERE la.legacy_session_id=d.session_id),FALSE)
               WHEN d.session_id<0 THEN COALESCE((SELECT modern_any_ready_order FROM modern_agg ma WHERE ma.modern_session_pk=(-d.session_id)),FALSE)
               ELSE FALSE END AS any_ready_order,
             CASE
               WHEN d.session_id>0 THEN COALESCE((SELECT legacy_any_item_completed FROM legacy_agg la WHERE la.legacy_session_id=d.session_id),FALSE)
               WHEN d.session_id<0 THEN COALESCE((SELECT modern_any_ready_order FROM modern_agg ma WHERE ma.modern_session_pk=(-d.session_id)),FALSE)
               ELSE FALSE END AS any_item_completed,
             CASE
               WHEN d.session_id>0 THEN COALESCE((SELECT legacy_all_paid FROM legacy_agg la WHERE la.legacy_session_id=d.session_id),FALSE)
               WHEN d.session_id<0 THEN COALESCE((SELECT (ds.payment_status='paid') FROM dining_sessions ds WHERE ds.id=(-d.session_id)),FALSE)
               ELSE FALSE END AS all_paid,
            d.modern_payment_status,
            0 AS total_amount
      FROM dedup d
      ORDER BY (
        CASE WHEN d.table_number ~ '^\\d+$' THEN d.table_number::int ELSE NULL END
      ) NULLS LAST, d.table_number ASC
    `,[businessId]);

    // Build numeric map of onboarded tables (active QR codes only)
    const numericMap = new Map();
    const seenIdsPerNum = new Map();
    const parseNumeric = (val) => {
      if (!val) return null;
      const m = String(val).match(/(\d+)/);
      return m ? parseInt(m[1],10) : null;
    };
    rows.forEach(r => {
      const num = parseNumeric(r.table_number);
      if (num==null) return;
      const existing = numericMap.get(num);
      const isActive = (r.session_id && (r.session_is_active === true || Number(r.session_id)<0));
      if (!existing) {
        numericMap.set(num, r); seenIdsPerNum.set(num, isActive?2:1);
      } else {
        const cur = seenIdsPerNum.get(num);
        const pri = isActive?2:1;
        if (pri>cur) { numericMap.set(num,r); seenIdsPerNum.set(num,pri); }
      }
    });
    const queryClamp = req.query.clamp ? parseInt(String(req.query.clamp),10):0;
    const onboardingClamp = queryClamp>0 ? queryClamp : parseInt(process.env.ONBOARDING_TABLE_COUNT || process.env.DASHBOARD_TABLE_COUNT || '0',10);
    const numericKeys = Array.from(numericMap.keys()).sort((a,b)=>a-b);
    const totalOnboarded = numericKeys.length;
    let desiredTotal = onboardingClamp>0 ? onboardingClamp : totalOnboarded;
    if (desiredTotal < totalOnboarded && onboardingClamp>0) {
      // strict clamp
      while(numericKeys.length && numericKeys[numericKeys.length-1]>onboardingClamp) numericKeys.pop();
    }

    const output = [];
    for (let t=1; t<=desiredTotal; t++) {
      const row = numericMap.get(t);
      if (!row) {
        output.push({
          qr_code_id:null, table_number:String(t), session_id:null, session_status:null,
          orders_count:0, unpaid_exists:false, any_ready_order:false, any_item_completed:false,
          all_paid:false, modern_payment_status:null, color:'ash', mode_applied:mode, reason:'no active session'
        });
        continue;
      }
      const hasActive = (row.session_id && (row.session_is_active === true || Number(row.session_id)<0));
      const anyReady = row.any_ready_order || row.any_item_completed;
      let color = 'ash';
      let reason = 'no active session';
      if (hasActive) {
        if (mode==='pay_first') {
          if (anyReady) { color='green'; reason='ready/completed item present'; }
          else { color='yellow'; reason='active session; no ready item yet'; }
        } else { // eat_later
          // Prioritize explicit paid state even if zero orders (pre-paid or manual mark-paid)
          if (row.all_paid) { color='green'; reason='all orders (or prepaid) marked paid'; }
          else if (row.orders_count===0) { color='yellow'; reason='session active; no orders yet'; }
          else if (row.unpaid_exists) { color='yellow'; reason='orders placed; unpaid exists'; }
          else if (!row.all_paid) { color='yellow'; reason='orders placed; awaiting payment settlement'; }
          else { color='green'; reason='all orders paid'; }
        }
      }
      output.push({
        qr_code_id: row.qr_code_id,
        table_number: String(t),
        session_id: row.session_id,
        session_status: row.session_status,
        orders_count: Number(row.orders_count),
        unpaid_exists: row.unpaid_exists,
        any_ready_order: row.any_ready_order,
        any_item_completed: row.any_item_completed,
        all_paid: row.all_paid,
        modern_payment_status: row.modern_payment_status || null,
        color,
        total_amount: 0,
        mode_applied: mode,
        reason
      });
    }
    const payload = {
      tables: output,
      mode,
      total_onboarded: totalOnboarded,
      desired_total: desiredTotal,
      onboarding_clamp: onboardingClamp,
      applied_clamp_source: queryClamp>0 ? 'query' : (onboardingClamp>0 ? 'env':'auto'),
      debug_numeric_keys: numericKeys
    };
    if (String(req.query.debug||'').toLowerCase()==='1') payload._raw_rows = rows;
    return res.json(payload);
  } catch (e) {
    console.error('GET /api/sessions/overview error (inline server.js):', e);
    return res.status(500).json({ error:'Failed to load sessions overview'});
  }
});

// --- Single Table Overview (returns single row with reason) ---
app.get('/api/sessions/overview/table/:tableNumber', async (req, res) => {
  try {
    const tableNumber = parseInt(req.params.tableNumber,10);
    if (!tableNumber) return res.status(400).json({ error:'tableNumber must be numeric' });
    const businessId = parseInt(req.query.businessId || req.query.tenant || '1', 10);
    if (!businessId) return res.status(400).json({ error:'businessId required' });
    const mode = String(req.query.mode || 'eat_later').toLowerCase();
    // Reuse main overview logic by calling the same query block and then filtering desired table.
    const { rows } = await pool.query(`
      WITH legacy AS (
        SELECT q.qr_code_id::int AS qr_code_id,
               q.table_number::text AS table_number,
               q.current_session_id::int AS linked_session_id,
               'legacy'::text AS source
        FROM QRCodes q
        WHERE q.business_id=$1 AND (q.is_active IS DISTINCT FROM FALSE)
      ), modern AS (
        SELECT m.id::int AS qr_code_id,
               m.table_number::text AS table_number,
               NULL::int AS linked_session_id,
               'modern'::text AS source
        FROM qr_codes m
        WHERE m.business_id=$1 AND (m.is_active IS DISTINCT FROM FALSE)
      ), all_qr AS (
        SELECT * FROM legacy
        UNION ALL
        SELECT * FROM modern
      ), legacy_sessions AS (
        SELECT ds.session_id::int AS session_id,
               ds.qr_code_id::int AS qr_code_id,
               ds.status::text AS status,
               (ds.status='active') AS session_is_active
        FROM DiningSessions ds
        WHERE ds.business_id=$1
      ), modern_sessions AS (
        SELECT md.id * -1 AS session_id,
               md.qr_code_id::int AS qr_code_id,
               CASE WHEN md.is_active THEN 'active' ELSE 'inactive' END AS status,
               md.is_active AS session_is_active,
               md.payment_status AS modern_payment_status
        FROM dining_sessions md
        WHERE md.business_id=$1 AND md.is_active=TRUE
      ), ds_join AS (
        SELECT a.qr_code_id, a.table_number, a.source,
               COALESCE(ls.session_id, ms.session_id) AS session_id,
               COALESCE(ls.status, ms.status) AS session_status,
               COALESCE(ls.session_is_active, ms.session_is_active) AS session_is_active,
               ms.modern_payment_status
        FROM all_qr a
        LEFT JOIN legacy_sessions ls ON ls.qr_code_id=a.qr_code_id AND ls.session_is_active=TRUE
        LEFT JOIN modern_sessions ms ON ms.qr_code_id=a.qr_code_id AND ls.session_id IS NULL
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY table_number ORDER BY
            (CASE WHEN session_is_active THEN 1 ELSE 0 END) DESC,
            (CASE WHEN source='modern' THEN 1 ELSE 0 END) DESC,
            qr_code_id DESC
        ) AS rn FROM ds_join
      ), dedup AS (
        SELECT * FROM ranked WHERE rn=1
      ), legacy_agg AS (
        SELECT o.dining_session_id AS legacy_session_id,
               COUNT(*) FILTER (WHERE o.dining_session_id IS NOT NULL) AS legacy_orders_count,
               BOOL_OR(o.payment_status <> 'paid') AS legacy_unpaid_exists,
               BOOL_OR(o.status IN ('READY','COMPLETED')) AS legacy_any_ready_order,
               EXISTS(
                 SELECT 1 FROM OrderItems oi JOIN Orders ox ON oi.order_id=ox.order_id
                 WHERE ox.dining_session_id=o.dining_session_id AND oi.item_status='COMPLETED'
               ) AS legacy_any_item_completed,
               (BOOL_AND(o.payment_status='paid') AND COUNT(*)>0) AS legacy_all_paid
        FROM Orders o
        GROUP BY o.dining_session_id
      ), modern_agg AS (
        SELECT so.session_id AS modern_session_pk,
               COUNT(*) AS modern_orders_count,
               MAX(CASE WHEN so.order_status IN ('ready','served','completed') THEN 1 ELSE 0 END) > 0 AS modern_any_ready_order
        FROM session_orders so
        GROUP BY so.session_id
      )
      SELECT * FROM (
        SELECT d.qr_code_id,
               d.table_number,
               d.session_id,
               d.session_status,
               d.session_is_active,
               CASE
                 WHEN d.session_id>0 THEN COALESCE((SELECT legacy_orders_count FROM legacy_agg la WHERE la.legacy_session_id=d.session_id),0)
                 WHEN d.session_id<0 THEN COALESCE((SELECT modern_orders_count FROM modern_agg ma WHERE ma.modern_session_pk=(-d.session_id)),0)
                 ELSE 0 END AS orders_count,
               CASE
                 WHEN d.session_id>0 THEN COALESCE((SELECT legacy_unpaid_exists FROM legacy_agg la WHERE la.legacy_session_id=d.session_id),FALSE)
                 WHEN d.session_id<0 THEN COALESCE((SELECT (ds.payment_status IS DISTINCT FROM 'paid') FROM dining_sessions ds WHERE ds.id=(-d.session_id)),FALSE)
                 ELSE FALSE END AS unpaid_exists,
               CASE
                 WHEN d.session_id>0 THEN COALESCE((SELECT legacy_any_ready_order FROM legacy_agg la WHERE la.legacy_session_id=d.session_id),FALSE)
                 WHEN d.session_id<0 THEN COALESCE((SELECT modern_any_ready_order FROM modern_agg ma WHERE ma.modern_session_pk=(-d.session_id)),FALSE)
                 ELSE FALSE END AS any_ready_order,
               CASE
                 WHEN d.session_id>0 THEN COALESCE((SELECT legacy_any_item_completed FROM legacy_agg la WHERE la.legacy_session_id=d.session_id),FALSE)
                 WHEN d.session_id<0 THEN COALESCE((SELECT modern_any_ready_order FROM modern_agg ma WHERE ma.modern_session_pk=(-d.session_id)),FALSE)
                 ELSE FALSE END AS any_item_completed,
               CASE
                 WHEN d.session_id>0 THEN COALESCE((SELECT legacy_all_paid FROM legacy_agg la WHERE la.legacy_session_id=d.session_id),FALSE)
                 WHEN d.session_id<0 THEN COALESCE((SELECT (ds.payment_status='paid') FROM dining_sessions ds WHERE ds.id=(-d.session_id)),FALSE)
                 ELSE FALSE END AS all_paid,
               d.modern_payment_status
        FROM dedup d
      ) x
      WHERE (x.table_number ~ '^\\d+$' AND x.table_number::int = $2)
    `,[businessId, tableNumber]);
    let row = rows[0];
    if (!row) {
      return res.json({
        table_number:String(tableNumber), color:'ash', reason:'no active session',
        session_id:null, orders_count:0, unpaid_exists:false, any_ready_order:false, any_item_completed:false, all_paid:false
      });
    }
    const hasActive = (row.session_id && (row.session_is_active === true || Number(row.session_id)<0));
    const anyReady = row.any_ready_order || row.any_item_completed;
    let color='ash', reason='no active session';
    if (hasActive) {
      if (mode==='pay_first') {
        if (anyReady) { color='green'; reason='ready/completed item present'; }
        else { color='yellow'; reason='active session; no ready item yet'; }
      } else {
        if (row.orders_count===0) { color='yellow'; reason='session active; no orders yet'; }
        else if (row.unpaid_exists) { color='yellow'; reason='orders placed; unpaid exists'; }
        else if (!row.all_paid) { color='yellow'; reason='orders placed; awaiting payment settlement'; }
        else { color='green'; reason='all orders paid'; }
      }
    }
    return res.json({
      table_number: row.table_number,
      session_id: row.session_id,
      orders_count: Number(row.orders_count),
      unpaid_exists: row.unpaid_exists,
      any_ready_order: row.any_ready_order,
      any_item_completed: row.any_item_completed,
      all_paid: row.all_paid,
      modern_payment_status: row.modern_payment_status || null,
      color,
      mode_applied: mode,
      reason
    });
  } catch(e) {
    console.error('GET /api/sessions/overview/table error:', e);
    return res.status(500).json({ error:'Failed to load table status'});
  }
});

app.use('/api/vendor-management', vendorManagementRoutes);
app.use('/api/reorder', reorderManagementRoutes);


console.log("total sales backend routes");
// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);

  // Handle different types of errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Validation Error',
      details: err.message
    });
  }

  if (err.code === '23505') { // PostgreSQL unique constraint violation
    return res.status(409).json({
      success: false,
      error: 'Duplicate entry',
      details: 'A record with this information already exists'
    });
  }

  if (err.code === '23503') { // PostgreSQL foreign key violation
    return res.status(400).json({
      success: false,
      error: 'Invalid reference',
      details: 'Referenced record does not exist'
    });
  }

  // Default error response
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error',
    status: err.status || 500,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl
  });
});

// Notification System Auto-Setup
async function initializeNotificationSystem() {
  try {
    console.log('\n🔔 Setting up notification system...');
    
    // Auto-setup notification preferences for all users
    const client = await pool.connect();
    try {
      const usersResult = await client.query(`
        SELECT u.user_id FROM Users u WHERE u.is_active = true
      `);
      
      const reportTypes = ['endOfDayReports', 'dailyReportReminders', 'monthlyReports', 'performanceAlerts'];
      let addedCount = 0;
      
      for (const user of usersResult.rows) {
        for (const alertType of reportTypes) {
          const existingResult = await client.query(`
            SELECT 1 FROM NotificationPreferences 
            WHERE user_id = $1 AND alert_type = $2
          `, [user.user_id, alertType]);
          
          if (existingResult.rows.length === 0) {
            await client.query(`
              INSERT INTO NotificationPreferences (user_id, alert_type, is_enabled, created_at)
              VALUES ($1, $2, true, NOW())
            `, [user.user_id, alertType]);
            addedCount++;
          }
        }
      }
      
      if (addedCount > 0) {
        console.log(`   ✅ Added ${addedCount} notification preferences`);
      } else {
        console.log('   ✅ Notification preferences already configured');
      }
      
    } finally {
      client.release();
    }
    
    // Initialize Report Scheduler
    console.log('   🕐 Initializing report scheduler...');
    await reportScheduler.initialize();
    console.log('   ✅ Report scheduler active (realistic restaurant timings)');
    console.log('   📊 End-of-day reports: 11:30 PM daily');
    console.log('   ⏰ Missing report reminders: 9:00 AM daily');
    console.log('   📅 Monthly reports: 1st of month at 10:00 AM');
    console.log('   📈 Performance checks: Every 2 hours (10 AM - 10 PM)');
    
  } catch (error) {
    console.error('   ❌ Notification setup failed:', error.message);
    // Don't crash the server, just log the error
  }
}

// Start server (only for local development)
const startServer = async () => {
  console.log('🔄 Starting server initialization...');
  try {
    console.log('🔌 Testing database connection...');
    await testConnection();
    console.log('✅ Database connection established');

    console.log('🚀 Starting Express server...');
    const HOST = process.env.HOST || '0.0.0.0';
    app.listen(PORT, HOST, async () => {
      console.log(`🚀 Server running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
      if (HOST === '0.0.0.0') {
        try {
          const os = require('os');
          const ifaces = os.networkInterfaces();
          Object.values(ifaces).flat().filter(i=>i && i.family==='IPv4' && !i.internal).forEach(i=>{
            console.log(`🌐 LAN Access:   http://${i.address}:${PORT}/qr/<qr_id>`);
          });
        } catch(_) {}
        console.log('🔎 If a phone scan says "Site can\'t be reached": ensure phone & server on same network, and QR encodes a host that resolves to one of the LAN IPs above.');
      }
      console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 Frontend: http://localhost:3000`);
      console.log(`🔗 API Base URL: http://localhost:${PORT}/api`);
      
  // WhatsApp integration removed

      // Auto-setup notification preferences and initialize scheduler
      await initializeNotificationSystem();
      
      // Display all available routes in a simple format
      console.log('\n📋 Available Routes:');
      console.log('━'.repeat(60));
      
      // Health Routes
      console.log('🏥 Health:');
      console.log('   GET  /api/health');
      console.log('   GET  /api/health/db-status');
      
      // Stock In Routes
      console.log('📦 Stock In:');
      console.log('   GET  /api/stock-in');
      console.log('   POST /api/stock-in');
      console.log('   POST /api/stock-in/draft');
      console.log('   GET  /api/stock-in/inventory/overview');
      console.log('   GET  /api/stock-in/:id');
      console.log('   PUT  /api/stock-in/:id/complete');
      console.log('   DEL  /api/stock-in/:id');
      
      // Menu Routes
      console.log('🍽️ Menu:');
      console.log('   GET  /api/menu/items');
      console.log('   GET  /api/menu/categories');
      console.log('   GET  /api/menu/test-image/:filename');
      
      // Recipe Routes
      console.log('👨‍🍳 Recipes:');
      console.log('   GET  /api/recipes');
      console.log('   GET  /api/recipes/:id/ingredients');
      console.log('   POST /api/recipes');
      console.log('   PUT  /api/recipes/:id');
      console.log('   PUT  /api/recipes/:id/ingredients');
      
      // Usage Routes (Stock Out)
      console.log('📤 Usage (Stock Out):');
      console.log('   POST /api/usage/record');
      console.log('   GET  /api/usage/records');
      console.log('   GET  /api/usage/summary');
      
      // Unit Mapping Routes
      console.log('📏 Unit Mapping:');
      console.log('   GET  /api/unit-mapping/units');
      console.log('   GET  /api/unit-mapping/conversions/:businessId');
      console.log('   GET  /api/unit-mapping/kitchen-units/:businessId');
      console.log('   POST /api/unit-mapping/kitchen-units/:businessId');
      console.log('   GET  /api/unit-mapping/inventory-items/:businessId');
      console.log('   GET  /api/unit-mapping/supplier-conversions/:businessId');
      console.log('   POST /api/unit-mapping/supplier-conversions/:businessId');
      console.log('   POST /api/unit-mapping/complete-setup/:businessId');
      
      // Orders Routes (QR Billing & Kitchen Management)
      console.log('🍽️ Orders & Kitchen:');
      console.log('   POST /api/orders');
      console.log('   GET  /api/orders/kitchen-queue');
      console.log('   PATCH /api/orders/:orderId/status');
  console.log('   PATCH /api/orders/:orderId/pay');
  console.log('   GET  /api/orders/owner-summary');
      
      // Auth Routes
      console.log('🔐 Authentication:');
      console.log('   POST /api/auth/signup');
      console.log('   POST /api/auth/signin');
      console.log('   GET  /api/auth/status');
      console.log('   GET  /api/auth/verify-email');
      console.log('   POST /api/auth/resend-verification');
      
      // User Routes
      console.log('👥 Users:');
      console.log('   GET  /api/users');
      console.log('   GET  /api/users/:id');
      console.log('   POST /api/users');
      
      // OCR Routes
      console.log('📄 OCR:');
      console.log('   POST /api/ocr/upload');
      console.log('   GET  /api/ocr/images');
      console.log('   POST /api/ocr/process/:imageId');
      
      // Wastage Routes
      console.log('🗑️ Wastage:');
      console.log('   GET  /api/wastage');
      console.log('   POST /api/wastage');
      console.log('   GET  /api/wastage/reasons');
      console.log('   GET  /api/wastage/summary');
      
      // Inventory Routes
      console.log('📊 Inventory:');
      console.log('   DEL  /api/inventory/items/:itemId/batches/:batchId');
      console.log('   GET  /api/inventory/items/:itemId/batches');
      console.log('   GET  /api/inventory/items/:businessId/category-assignments');
      
      // ABC Analysis Routes
      console.log('📈 ABC Analysis:');
      console.log('   GET  /api/abc-analysis/calculate');
      console.log('   GET  /api/abc-analysis/history');
      console.log('   GET  /api/abc-analysis/recommendations');
      
      // --- ADDED THIS SECTION ---
      console.log('📈 Stock & Wastage Reports:');
      console.log('   GET  /api/stockrepo/header-summary');
      console.log('   GET  /api/stockrepo/item-wise-sales');
      console.log('   GET  /api/stockrepo/performance-summary');
      console.log('   GET  /api/stockrepo/raw-material-stock');
      console.log('   GET  /api/stockrepo/wastage-comparison');
      console.log('   GET  /api/stockrepo/key-insights');
      // --------------------------

  // QR Billing – Real-time Reports
  console.log('🍽️ QR Reports:');
  console.log('   GET  /api/reports/qr/today-overview');
  console.log('   GET  /api/reports/qr/ingredients-usage');
  console.log('   GET  /api/reports/qr/top-items');

      console.log('━'.repeat(60));
      // --- UPDATED ROUTE COUNT ---
  console.log('📈 Total: 63 routes available');
      // ---------------------------
      console.log(`✅ All routes configured for localhost:${PORT}/api`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    console.error('❌ Stack trace:', error.stack);
    process.exit(1);
  }
};

// Only start the server if not running in Lambda
if (!process.env.AWS_LAMBDA_FUNCTION_NAME) {
  startServer();
}

// Initialize for Lambda (database and notification system)
const initializeLambda = async () => {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    console.log('🔄 Initializing for Lambda environment...');
    try {
      await testConnection();
      console.log('✅ Database connection established for Lambda');
      await initializeNotificationSystem();
      console.log('✅ Lambda initialization complete');
    } catch (error) {
      console.error('❌ Lambda initialization failed:', error.message);
      // Don't throw, let Lambda handle the request anyway
    }
  }
};

// Initialize for Lambda on cold start
initializeLambda();

// Export for AWS Lambda
module.exports.handler = serverless(app);
module.exports.app = app; // Export app for testing

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  reportScheduler.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  reportScheduler.stop();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  reportScheduler.stop();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  reportScheduler.stop();
  process.exit(1);
});

// --- Session Diagnostics: Inspect QR + sessions (modern + legacy) by qrId ---
app.get('/api/sessions/debug/:qrId', async (req, res) => {
  const { qrId } = req.params;
  const businessId = parseInt(req.query.businessId || '1', 10);
  try {
    const modernQR = await pool.query(`SELECT * FROM qr_codes WHERE qr_id = $1 AND ($2::int IS NULL OR business_id = $2) LIMIT 1`, [qrId, businessId]);
    const legacyQR = await pool.query(`SELECT * FROM QRCodes WHERE ($2::int IS NULL OR business_id = $2) AND (table_number = (SELECT table_number FROM qr_codes WHERE qr_id=$1 LIMIT 1))`, [qrId, businessId]);
    const modernRow = modernQR.rows[0];
    let tableNumber = modernRow?.table_number || legacyQR.rows[0]?.table_number;
    const modernSessions = modernRow ? await pool.query(`SELECT * FROM dining_sessions WHERE qr_code_id = $1 ORDER BY id DESC LIMIT 5`, [modernRow.id]) : { rows: [] };
    const legacySessions = tableNumber ? await pool.query(`SELECT ds.* FROM DiningSessions ds JOIN QRCodes q ON q.qr_code_id = ds.qr_code_id WHERE q.table_number = $1 AND q.business_id = $2 ORDER BY ds.session_id DESC LIMIT 5`, [tableNumber, businessId]) : { rows: [] };
    return res.json({
      qrId,
      businessId,
      modern_qr: modernRow || null,
      legacy_qr: legacyQR.rows[0] || null,
      modern_sessions: modernSessions.rows,
      legacy_sessions: legacySessions.rows
    });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to debug qrId', detail: e.message });
  }
});

// --- Force Activate Session: ensures an active session exists for a given qrId ---
app.post('/api/sessions/force-activate', async (req, res) => {
  const { qrId, billing_model = 'eat_first', businessId: bId } = req.body || {};
  const businessId = parseInt(bId || '1', 10);
  if (!qrId) return res.status(400).json({ error: 'qrId required' });
  try {
    const { rows } = await pool.query(`SELECT id, table_number, business_id FROM qr_codes WHERE qr_id = $1 AND business_id = $2 LIMIT 1`, [qrId, businessId]);
    if (!rows.length) return res.status(404).json({ error: 'qrId not found for business' });
    const qr = rows[0];
    await pool.query('BEGIN');
    const modernActive = await pool.query(`SELECT id FROM dining_sessions WHERE qr_code_id = $1 AND is_active = TRUE LIMIT 1`, [qr.id]);
    let createdModern = null;
    if (!modernActive.rows.length) {
      const sid = 'S' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
      await pool.query(`INSERT INTO dining_sessions (session_id, qr_code_id, table_number, business_id, is_active, billing_model, started_at, last_activity) VALUES ($1,$2,$3,$4,TRUE,$5,NOW(),NOW())`, [sid, qr.id, qr.table_number, qr.business_id, billing_model]);
      createdModern = sid;
    }
    // Legacy ensure
    const legacyActive = await pool.query(`SELECT ds.session_id FROM DiningSessions ds JOIN QRCodes q ON q.qr_code_id = ds.qr_code_id WHERE q.business_id=$1 AND q.table_number=$2 AND ds.status='active' LIMIT 1`, [qr.business_id, qr.table_number]);
    let createdLegacy = null;
    if (!legacyActive.rows.length) {
      const legacyInsert = await pool.query(`INSERT INTO DiningSessions (business_id, qr_code_id, start_time, status, created_at) SELECT $1, q.qr_code_id, NOW(), 'active', NOW() FROM QRCodes q WHERE q.business_id=$1 AND q.table_number=$2 RETURNING session_id`, [qr.business_id, qr.table_number]);
      if (legacyInsert.rows.length) {
        createdLegacy = legacyInsert.rows[0].session_id;
        try { await pool.query(`UPDATE qr_codes SET current_session_id = $1 WHERE id = $2`, [createdLegacy, qr.id]); } catch(_) {}
        try { await pool.query(`UPDATE QRCodes SET current_session_id = $1 WHERE table_number = $2 AND business_id = $3`, [createdLegacy, qr.table_number, qr.business_id]); } catch(_) {}
      }
    }
    await pool.query('COMMIT');
    return res.json({ qrId, businessId, createdModern, createdLegacy, alreadyModernActive: modernActive.rows.length>0, alreadyLegacyActive: legacyActive.rows.length>0 });
  } catch (e) {
    try { await pool.query('ROLLBACK'); } catch(_){}
    return res.status(500).json({ error: 'force-activate failed', detail: e.message });
  }
});

// Programmatic session ensure (no redirect) - useful if QR points directly to frontend and frontend wants to trigger backend session explicitly
app.post('/api/qr/ensure-session', async (req, res) => {
  try {
    const { qrId, businessId:biz, table, mode='eat_later' } = req.body || {};
    const businessId = parseInt(biz || req.query.businessId || '1',10);
    if (!qrId) return res.status(400).json({ error:'qrId required' });
    // Fetch qr row (prefer modern)
    const qrRowRes = await pool.query(`SELECT id, qr_id, table_number, business_id FROM qr_codes WHERE qr_id=$1 LIMIT 1`, [qrId]);
    let qrRow = qrRowRes.rows[0];
    if (!qrRow) return res.status(404).json({ error:'qr not found'});
    if (!qrRow.business_id && businessId) {
      try { await pool.query('UPDATE qr_codes SET business_id=$1 WHERE id=$2',[businessId, qrRow.id]); qrRow.business_id=businessId; } catch(_){}
    }
    const effectiveBiz = qrRow.business_id || businessId;
    if (!effectiveBiz) return res.status(400).json({ error:'business id unresolved'});
    // Update last_scan_at if column exists
    try { await pool.query(`UPDATE qr_codes SET last_scan_at=NOW() WHERE id=$1`, [qrRow.id]); } catch(_) {}
    // Ensure modern session
    let createdModern=false, createdLegacy=false, modernSessionId=null, legacySessionId=null;
    const modernActive = await pool.query(`SELECT id, session_id FROM dining_sessions WHERE qr_code_id=$1 AND is_active=TRUE LIMIT 1`, [qrRow.id]);
    if (modernActive.rows.length) { modernSessionId = modernActive.rows[0].session_id; }
    else {
      const newSessionId = 'S'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
      await pool.query(`INSERT INTO dining_sessions (session_id, qr_code_id, table_number, business_id, is_active, billing_model, started_at, last_activity) VALUES ($1,$2,$3,$4,TRUE,$5,NOW(),NOW())`, [newSessionId, qrRow.id, qrRow.table_number, effectiveBiz, mode==='pay_first' ? 'pay_first':'eat_first']);
      modernSessionId = newSessionId; createdModern=true;
    }
    // Ensure legacy (optional)
    const legacyActive = await pool.query(`SELECT ds.session_id FROM DiningSessions ds JOIN QRCodes q ON q.qr_code_id=ds.qr_code_id WHERE q.business_id=$1 AND q.table_number=$2 AND ds.status='active' LIMIT 1`, [effectiveBiz, qrRow.table_number]);
    if (legacyActive.rows.length) { legacySessionId = legacyActive.rows[0].session_id; }
    else {
      const ins = await pool.query(`INSERT INTO DiningSessions (business_id, qr_code_id, start_time, status, created_at) SELECT $1, q.qr_code_id, NOW(),'active',NOW() FROM QRCodes q WHERE q.business_id=$1 AND q.table_number=$2 LIMIT 1 RETURNING session_id`, [effectiveBiz, qrRow.table_number]);
      if (ins.rows.length) { legacySessionId=ins.rows[0].session_id; createdLegacy=true; try { await pool.query(`UPDATE QRCodes SET current_session_id=$1 WHERE table_number=$2 AND business_id=$3`, [legacySessionId, qrRow.table_number, effectiveBiz]); } catch(_){} }
    }
    return res.json({ success:true, data:{ qr_id:qrRow.qr_id, table_number:qrRow.table_number, business_id:effectiveBiz, modern_session_id:modernSessionId, legacy_session_id:legacySessionId, createdModern, createdLegacy } });
  } catch(e) {
    console.error('ensure-session error', e); return res.status(500).json({ error:'failed to ensure session'});
  }
});

// Helper: list LAN IP candidates for configuring PUBLIC_BASE_URL
app.get('/api/qr/lan-info', (req, res) => {
  try {
    const os = require('os');
    const nets = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
      }
    }
    const hostHeader = req.headers.host || `localhost:${PORT}`;
    const portPart = hostHeader.split(':')[1] || PORT;
    res.json({
      detected_ips: ips,
      suggested_examples: ips.map(ip => `${req.protocol}://${ip}:${portPart}`),
      using_public_base: !!process.env.PUBLIC_BASE_URL,
      public_base_url: process.env.PUBLIC_BASE_URL || null
    });
  } catch(e) {
    res.status(500).json({ error:'failed to enumerate interfaces', message:e.message });
  }
});

// List existing QR codes (modern schema)
// GET /api/qr/list?businessId=1&includePng=1
app.get('/api/qr/list', async (req, res) => {
  try {
    const businessId = parseInt(req.query.businessId || '1', 10);
    if (!businessId) return res.status(400).json({ error: 'businessId required' });
    const includePng = String(req.query.includePng||'0') === '1';
    const hostHeader = req.headers.host || `localhost:${PORT}`;
    let base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${hostHeader}`).replace(/\/$/, '');
    if (!process.env.PUBLIC_BASE_URL && /^(https?:\/\/)?(localhost|127\.|0\.0\.0\.0)/i.test(base)) {
      try {
        const os = require('os');
        const nets = os.networkInterfaces();
        outer: for (const name of Object.keys(nets)) {
          for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) { base = `${req.protocol}://${net.address}:${hostHeader.split(':')[1]||PORT}`; break outer; }
          }
        }
      } catch(_) {}
    }
    let modernRows = (await pool.query(`SELECT id, table_number, qr_id, business_id, is_active FROM qr_codes WHERE business_id=$1`, [businessId])).rows;
    let migrated = false;
    // If no modern rows, attempt migration from legacy QRCodes
    if (modernRows.length === 0) {
      try {
        const legacy = await pool.query(`SELECT qr_code_id, table_number, is_active FROM QRCodes WHERE business_id=$1`, [businessId]);
        if (legacy.rows.length) {
          for (const l of legacy.rows) {
            // Insert if not exists (table_number uniqueness may not exist yet)
            const exists = await pool.query(`SELECT id, qr_id FROM qr_codes WHERE business_id=$1 AND table_number=$2 LIMIT 1`, [businessId, l.table_number]);
            if (!exists.rows.length) {
              const ins = await pool.query(`INSERT INTO qr_codes (business_id, table_number, is_active, qr_id) VALUES ($1,$2,$3, LEFT(MD5(RANDOM()::text||NOW()::text),10)) RETURNING id, table_number, qr_id, is_active`, [businessId, l.table_number, l.is_active !== false]);
              modernRows.push(ins.rows[0]);
            } else {
              modernRows.push(exists.rows[0]);
            }
          }
          migrated = true;
        }
      } catch(migErr) {
        console.warn('qr list migration skipped:', migErr.message);
      }
    }
    // Backfill qr_id for any null modern rows
    for (const r of modernRows) {
      if (!r.qr_id) {
        const regen = await pool.query(`UPDATE qr_codes SET qr_id=LEFT(MD5(RANDOM()::text||NOW()::text),10) WHERE id=$1 RETURNING qr_id`, [r.id]);
        r.qr_id = regen.rows[0].qr_id;
      }
    }
    // Re-select (optional) not strictly needed — we mutate in place
    const qrs = [];
    for (const r of modernRows) {
      const scan_url = `${base}/qr/${r.qr_id}?businessId=${businessId}`;
      let png = null;
      if (includePng) { try { png = await require('qrcode').toDataURL(scan_url, { margin:1, scale:6 }); } catch(_) {} }
      const numericMatch = String(r.table_number).match(/(\d+)/);
      qrs.push({ table_number: r.table_number, numeric_table: numericMatch ? numericMatch[1] : null, qr_id: r.qr_id, scan_url, png });
    }
    qrs.sort((a,b)=> (parseInt(a.numeric_table||a.table_number||'0') - parseInt(b.numeric_table||b.table_number||'0')));
    return res.json({ businessId, count: qrs.length, base, migrated, qrs });
  } catch(e) {
    console.error('GET /api/qr/list error:', e);
    return res.status(500).json({ error: 'Failed to list qr codes' });
  }
});

// --- Mark Payment Success (simulate payment) ---
// Body: { businessId, tableNumber?, qrId?, sessionId? }
// Effect: Marks all open orders as paid and (if modern) sets dining_sessions.payment_status='paid'.
// Triggers dashboard color becoming green for eat_later mode and eventually for pay_first when readiness logic satisfied.
// Idempotency Notes:
//  - Safe to call repeatedly; subsequent calls will simply keep payment_status='paid'.
//  - If no modern session exists yet (e.g. user skipped scan), one is auto-created.
//  - Will NOT fabricate a session_orders row unless ALLOW_DIRECT_PAY_WITHOUT_ORDER=true (to enforce order-before-payment discipline).
//  - Legacy sessions/orders are only marked paid if they exist; no new legacy order is created here (that happens in /api/checkout payNow bridging).
app.post('/api/qr/mark-paid', async (req, res) => {
  try {
    const { businessId: rawBiz, tableNumber, qrId, sessionId, totalAmount } = req.body || {};
    const businessId = parseInt(rawBiz || req.query.businessId || '1', 10);
    if (!businessId) return res.status(400).json({ error:'businessId required' });
    if (!tableNumber && !qrId && !sessionId) return res.status(400).json({ error:'Provide tableNumber or qrId or sessionId' });
    // Resolve table + sessions
    let resolvedTable = tableNumber ? String(tableNumber) : null;
    let modernSession = null;
    let legacySession = null;
    let modernQrId = null;
    // Resolve from qrId if given
    if (qrId && !resolvedTable) {
      const qrLookup = await pool.query(`SELECT table_number FROM qr_codes WHERE qr_id=$1 LIMIT 1`, [qrId]);
      if (qrLookup.rows[0]) resolvedTable = qrLookup.rows[0].table_number;
    }
    if (!resolvedTable && sessionId) {
      // Try modern by session_id textual or legacy numeric
      const mod = await pool.query(`SELECT table_number FROM dining_sessions WHERE session_id=$1 LIMIT 1`, [sessionId]);
      if (mod.rows[0]) resolvedTable = mod.rows[0].table_number;
      if (!resolvedTable) {
        const leg = await pool.query(`SELECT q.table_number FROM DiningSessions ds JOIN QRCodes q ON q.qr_code_id=ds.qr_code_id WHERE ds.session_id=$1 LIMIT 1`, [sessionId]);
        if (leg.rows[0]) resolvedTable = leg.rows[0].table_number;
      }
    }
    if (!resolvedTable) return res.status(404).json({ error:'Could not resolve tableNumber' });
  // Find modern dining session
  const modern = await pool.query(`SELECT ds.id, ds.payment_status, ds.qr_code_id FROM dining_sessions ds JOIN qr_codes qc ON qc.id=ds.qr_code_id WHERE ds.is_active=TRUE AND qc.business_id=$1 AND qc.table_number=$2 ORDER BY ds.id DESC LIMIT 1`, [businessId, resolvedTable]);
    if (modern.rows[0]) { modernSession = modern.rows[0]; }
    // Find legacy session
    const legacy = await pool.query(`SELECT ds.session_id FROM DiningSessions ds JOIN QRCodes q ON q.qr_code_id=ds.qr_code_id WHERE q.business_id=$1 AND q.table_number=$2 AND ds.status='active' ORDER BY ds.session_id DESC LIMIT 1`, [businessId, resolvedTable]);
    if (legacy.rows[0]) { legacySession = legacy.rows[0]; }
    // Mark modern paid
    // Auto-create modern session if none exists (user jumped straight to payment without scanning QR first)
    if (!modernSession) {
      const qrRow = await pool.query(`SELECT id FROM qr_codes WHERE business_id=$1 AND table_number=$2 LIMIT 1`, [businessId, resolvedTable]);
      let qrInternalId = qrRow.rows[0]?.id;
      if (!qrInternalId) {
        const ins = await pool.query(`INSERT INTO qr_codes (business_id, table_number, is_active, qr_id) VALUES ($1,$2,TRUE, LEFT(MD5(RANDOM()::text || NOW()::text),10)) RETURNING id`, [businessId, resolvedTable]);
        qrInternalId = ins.rows[0].id;
      }
      const newSess = await pool.query(`INSERT INTO dining_sessions (qr_code_id, is_active, payment_status, created_at, last_activity) VALUES ($1,TRUE,'unpaid',NOW(),NOW()) RETURNING id, payment_status, qr_code_id`, [qrInternalId]);
      modernSession = newSess.rows[0];
    }

    if (modernSession) {
      // Ensure at least one real order exists unless override enabled.
      const allowDirect = String(process.env.ALLOW_DIRECT_PAY_WITHOUT_ORDER||'').toLowerCase()==='true';
      const existingModernOrder = await pool.query(`SELECT id FROM session_orders WHERE session_id=$1 LIMIT 1`, [modernSession.id]);
      if (!existingModernOrder.rows.length && !allowDirect) {
        return res.status(400).json({ error:'NO_ORDER','message':'Cannot mark paid before at least one order is created (use /api/checkout first).'});
      }
      await pool.query(`UPDATE dining_sessions SET payment_status='paid', last_activity=NOW() WHERE id=$1`, [modernSession.id]);
      try { await pool.query(`UPDATE session_orders SET payment_status='paid' WHERE session_id=$1`, [modernSession.id]); } catch(_){}
      // If direct payment allowed and no order, optionally create a minimal order for reporting (kept but only if override)
      if (!existingModernOrder.rows.length && allowDirect) {
        try { await pool.query(`INSERT INTO session_orders (session_id, order_status, payment_status, total_amount, created_at) VALUES ($1,'completed','paid',$2,NOW())`, [modernSession.id, Number(totalAmount)||0]); } catch(_){}
      }
    }
    // Mark legacy orders paid
    if (legacySession) {
      // Mark all legacy orders paid & close session so modern mapping (negative id) is preferred for color logic
      await pool.query(`UPDATE Orders SET payment_status='paid' WHERE dining_session_id=$1`, [legacySession.session_id]);
      try { await pool.query(`UPDATE DiningSessions SET status='completed' WHERE session_id=$1`, [legacySession.session_id]); } catch(_){ }
    }
    // Attempt to mark legacy session complete if both paid & no unpaid remain (optional)
    try {
      if (legacySession) {
        const unpaid = await pool.query(`SELECT 1 FROM Orders WHERE dining_session_id=$1 AND payment_status <> 'paid' LIMIT 1`, [legacySession.session_id]);
        if (!unpaid.rows.length) {
          await pool.query(`UPDATE DiningSessions SET status='completed' WHERE session_id=$1 AND status='active'`, [legacySession.session_id]);
        }
      }
    } catch(_){}
    // Prepare response
    return res.json({ success:true, table_number: resolvedTable, modern_session_id: modernSession?.id || null, legacy_session_id: legacySession?.session_id || null });
  } catch(e) {
    console.error('POST /api/qr/mark-paid error:', e);
    return res.status(500).json({ error:'Failed to mark paid' });
  }
});

// --- Checkout (creates session order prior to payment) ---
// Body: { businessId, tableNumber, qrId, items:[{name, quantity, price, menuItemId?}] }
// Creates (or reuses active) modern dining_session, inserts a session_orders row with aggregated basic fields.
app.post('/api/checkout', async (req, res) => {
  try {
    const { businessId: rawBiz, tableNumber, qrId, items, payNow } = req.body || {};
    const businessId = parseInt(rawBiz || '1',10);
    if (!businessId) return res.status(400).json({ error:'businessId required'});
    if (!tableNumber && !qrId) return res.status(400).json({ error:'tableNumber or qrId required'});
    let resolvedTable = tableNumber;
    if (!resolvedTable && qrId) {
      const r = await pool.query(`SELECT table_number FROM qr_codes WHERE qr_id=$1 AND business_id=$2 LIMIT 1`, [qrId, businessId]);
      if (r.rows[0]) resolvedTable = r.rows[0].table_number;
    }
    if (!resolvedTable) return res.status(404).json({ error:'Could not resolve tableNumber from qrId'});
    // Ensure qr_codes row exists (generate qr_id if missing)
    let qrRow = await pool.query(`SELECT id, qr_id FROM qr_codes WHERE business_id=$1 AND table_number=$2 LIMIT 1`, [businessId, resolvedTable]);
    let qrInternalId = qrRow.rows[0]?.id;
    let qrIdFinal = qrRow.rows[0]?.qr_id;
    if (!qrInternalId) {
      const ins = await pool.query(`INSERT INTO qr_codes (business_id, table_number, is_active, qr_id) VALUES ($1,$2,TRUE, LEFT(MD5(RANDOM()::text || NOW()::text),10)) RETURNING id, qr_id`, [businessId, resolvedTable]);
      qrInternalId = ins.rows[0].id; qrIdFinal = ins.rows[0].qr_id;
    } else if (!qrIdFinal) {
      const regen = await pool.query(`UPDATE qr_codes SET qr_id=LEFT(MD5(RANDOM()::text || NOW()::text),10) WHERE id=$1 RETURNING qr_id`, [qrInternalId]);
      qrIdFinal = regen.rows[0].qr_id;
    }
    // Find or create active modern session (schema-flexible with fallbacks)
    let sessionRow = await pool.query(`SELECT ds.id, ds.payment_status FROM dining_sessions ds WHERE ds.qr_code_id=$1 AND ds.is_active=TRUE ORDER BY ds.id DESC LIMIT 1`, [qrInternalId]);
    let sessionId = sessionRow.rows[0]?.id;
    let sessionPaymentStatus = sessionRow.rows[0]?.payment_status || 'unpaid';
    if (!sessionId) {
      const genSessionId = 'S'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
      let created=null; let variantErrors=[];
      // Variant A: wide schema (includes session_id, table_number, business_id, billing_model, started_at/last_activity)
      try {
        created = await pool.query(`INSERT INTO dining_sessions (session_id, qr_code_id, table_number, business_id, is_active, billing_model, payment_status, started_at, last_activity)
                                     VALUES ($1,$2,$3,$4,TRUE,'eat_first','unpaid',NOW(),NOW()) RETURNING id, payment_status`, [genSessionId, qrInternalId, resolvedTable, businessId]);
      } catch(eA) { variantErrors.push('A:'+eA.message); }
      // Variant B: original narrow attempt (with created_at/last_activity only)
      if (!created) {
        try {
          created = await pool.query(`INSERT INTO dining_sessions (qr_code_id, is_active, payment_status, created_at, last_activity) VALUES ($1,TRUE,'unpaid',NOW(),NOW()) RETURNING id, payment_status`, [qrInternalId]);
        } catch(eB) { variantErrors.push('B:'+eB.message); }
      }
      // Variant C: ultra-minimal (some deployments have only qr_code_id, is_active, payment_status)
      if (!created) {
        try {
          created = await pool.query(`INSERT INTO dining_sessions (qr_code_id, is_active, payment_status) VALUES ($1,TRUE,'unpaid') RETURNING id, payment_status`, [qrInternalId]);
        } catch(eC) { variantErrors.push('C:'+eC.message); }
      }
      if (!created) {
        console.error('[checkout] failed to insert dining_sessions after variants', variantErrors.join(' | '));
        return res.status(500).json({ error:'Checkout failed - session create', detail: variantErrors });
      }
      sessionId = created.rows[0].id; sessionPaymentStatus = created.rows[0].payment_status;
    } else {
      // Best-effort touch last_activity if column present
      try { await pool.query(`UPDATE dining_sessions SET last_activity=NOW() WHERE id=$1`, [sessionId]); } catch(_touchErr) {}
    }
    // Aggregate items to a total
    let total = 0;
    if (Array.isArray(items)) {
      for (const it of items) {
        const qty = Number(it.quantity)||0; const price = Number(it.price)||0; total += qty*price;
      }
    }
    // Insert session_order row
    let orderId = null;
    let orderPaymentStatus = 'unpaid';
    try {
      const insOrder = await pool.query(`INSERT INTO session_orders (session_id, order_status, payment_status, total_amount, created_at)
                                         VALUES ($1,$2,$3,$4,NOW()) RETURNING id, payment_status`, [sessionId, payNow ? 'completed' : 'pending', payNow ? 'paid' : 'unpaid', total]);
      orderId = insOrder.rows[0].id; orderPaymentStatus = insOrder.rows[0].payment_status;
    } catch(e) { /* schema diff tolerant */ }

    // If payNow, mark session paid (best-effort) & compute color result
    let color = 'yellow';
    if (payNow) {
      try {
        await pool.query(`UPDATE dining_sessions SET payment_status='paid', last_activity=NOW() WHERE id=$1`, [sessionId]);
        sessionPaymentStatus = 'paid';
      } catch(_e) {}
      // Determine color: paid => green, else yellow (basic logic here; overview endpoint has richer rules)
      color = 'green';
    }

    // --- Bridge to legacy schema for owner dashboard color logic (idempotent) ---
    if (payNow) {
      try {
        // Ensure legacy QR row exists (QRCodes)
        let legacyQr = await pool.query(`SELECT qr_code_id, current_session_id FROM QRCodes WHERE business_id=$1 AND table_number=$2 LIMIT 1`, [businessId, String(resolvedTable)]);
        let legacyQrId = legacyQr.rows[0]?.qr_code_id;
        if (!legacyQrId) {
          const insLegacyQr = await pool.query(`INSERT INTO QRCodes (business_id, table_number) VALUES ($1,$2) RETURNING qr_code_id`, [businessId, String(resolvedTable)]);
          legacyQrId = insLegacyQr.rows[0].qr_code_id;
        }
        // Active legacy DiningSession or create one (status='active')
        let legacySessionId = legacyQr.rows[0]?.current_session_id;
        if (legacySessionId) {
          const chk = await pool.query(`SELECT session_id, status FROM DiningSessions WHERE session_id=$1`, [legacySessionId]);
          if (!chk.rows.length || chk.rows[0].status !== 'active') legacySessionId = null;
        }
        if (!legacySessionId) {
          const dsIns = await pool.query(`INSERT INTO DiningSessions (business_id, qr_code_id, status) VALUES ($1,$2,'active') RETURNING session_id`, [businessId, legacyQrId]);
          legacySessionId = dsIns.rows[0].session_id;
          await pool.query(`UPDATE QRCodes SET current_session_id=$1 WHERE qr_code_id=$2`, [legacySessionId, legacyQrId]);
        }
        // Idempotent legacy Order creation/update:
        // Reuse any existing paid+COMPLETED order, else update first unpaid, else insert new completed+paid.
        const legacyOrders = await pool.query(`SELECT order_id, status, payment_status FROM Orders WHERE dining_session_id=$1 ORDER BY order_id ASC`, [legacySessionId]);
        let legacyOrderId = null;
        const paidCompleted = legacyOrders.rows.find(o=>o.payment_status==='paid' && o.status==='COMPLETED');
        if (paidCompleted) {
          legacyOrderId = paidCompleted.order_id; // Reuse
        } else if (legacyOrders.rows.length) {
          // Update the first existing order to completed+paid
            legacyOrderId = legacyOrders.rows[0].order_id;
            await pool.query(`UPDATE Orders SET payment_status='paid', status='COMPLETED' WHERE order_id=$1`, [legacyOrderId]);
        } else {
          // Insert new paid order
          const ordIns = await pool.query(`INSERT INTO Orders (business_id, dining_session_id, status, customer_prep_time_minutes, payment_status)
                                           VALUES ($1,$2,'COMPLETED',15,'paid') RETURNING order_id`, [businessId, legacySessionId]);
          legacyOrderId = ordIns.rows[0].order_id;
        }
        // Mark legacy dining session completed only AFTER mirrored order is paid (optional for color - active is fine)
        // Keep it active so dashboard counts it; color logic uses Orders state.
      } catch(_legacyErr) {
        // Silently ignore; legacy bridging best-effort
      }
    }

    // Guarantee at least one session_orders row exists if schema is present
    if (!orderId) {
      try {
        const ensure = await pool.query(`INSERT INTO session_orders (session_id, order_status, payment_status, total_amount, created_at)
                                          VALUES ($1,$2,$3,$4,NOW()) RETURNING id, payment_status`, [sessionId, payNow ? 'completed' : 'pending', payNow ? 'paid':'unpaid', total]);
        orderId = ensure.rows[0].id; orderPaymentStatus = ensure.rows[0].payment_status;
      } catch(_e2) {}
    }

    return res.json({ success:true, sessionId, orderId, qrId: qrIdFinal, tableNumber: resolvedTable, total, paymentStatus: sessionPaymentStatus, orderPaymentStatus, color, paid: sessionPaymentStatus==='paid' });
  } catch(e) {
    console.error('POST /api/checkout error:', e);
    return res.status(500).json({ error:'Checkout failed'});
  }
});

// --- Diagnostics: Table State (modern + legacy) ---
// GET /api/diagnostics/table-state?businessId=&table= (or &qrId=)
// Provides a consolidated snapshot to debug why a table color is not green.
app.get('/api/diagnostics/table-state', async (req, res) => {
  try {
    const businessId = parseInt(req.query.businessId || req.query.tenant || '1',10);
    const tableParam = req.query.table ? String(req.query.table) : null;
    const qrId = req.query.qrId ? String(req.query.qrId) : null;
    if (!businessId) return res.status(400).json({ error:'businessId required' });
    if (!tableParam && !qrId) return res.status(400).json({ error:'table or qrId required'});
    let tableNumber = tableParam;
    if (!tableNumber && qrId) {
      const tLookup = await pool.query(`SELECT table_number FROM qr_codes WHERE qr_id=$1 AND business_id=$2 LIMIT 1`, [qrId, businessId]);
      tableNumber = tLookup.rows[0]?.table_number || null;
    }
    if (!tableNumber) return res.status(404).json({ error:'table unresolved'});
    // Modern QR & session
    const modernQr = await pool.query(`SELECT id, qr_id, table_number, business_id, is_active FROM qr_codes WHERE business_id=$1 AND table_number=$2 LIMIT 1`, [businessId, tableNumber]);
    const modernQrRow = modernQr.rows[0]||null;
    let modernSessionRow = null;
    let modernOrders = [];
    if (modernQrRow) {
      const ms = await pool.query(`SELECT id, payment_status, is_active, started_at, last_activity FROM dining_sessions WHERE qr_code_id=$1 ORDER BY id DESC LIMIT 1`, [modernQrRow.id]);
      modernSessionRow = ms.rows[0]||null;
      if (modernSessionRow) {
        const mo = await pool.query(`SELECT id, order_status, payment_status, total_amount, created_at FROM session_orders WHERE session_id=$1 ORDER BY id ASC`, [modernSessionRow.id]).catch(()=>({rows:[]}));
        modernOrders = mo.rows;
      }
    }
    // Legacy QR & session
    const legacyQr = await pool.query(`SELECT qr_code_id, table_number, current_session_id FROM QRCodes WHERE business_id=$1 AND table_number=$2 LIMIT 1`, [businessId, tableNumber]);
    const legacyQrRow = legacyQr.rows[0]||null;
    let legacySessionRow = null;
    let legacyOrders = [];
    if (legacyQrRow) {
      if (legacyQrRow.current_session_id) {
        const ls = await pool.query(`SELECT session_id, status FROM DiningSessions WHERE session_id=$1 LIMIT 1`, [legacyQrRow.current_session_id]);
        legacySessionRow = ls.rows[0]||null;
      }
      if (legacySessionRow) {
        const lo = await pool.query(`SELECT order_id, status, payment_status, created_at FROM Orders WHERE dining_session_id=$1 ORDER BY order_id ASC`, [legacySessionRow.session_id]);
        legacyOrders = lo.rows;
      }
    }
    // Derive color similar to overview (simplified)
    let color = 'ash';
    let reason = 'no active session';
    const modernActive = modernSessionRow && modernSessionRow.is_active;
    const legacyActive = legacySessionRow && legacySessionRow.status==='active';
    const active = modernActive || legacyActive;
    if (active) {
      const anyOrders = (modernOrders.length || legacyOrders.length) > 0;
      const modernPaid = modernSessionRow && modernSessionRow.payment_status==='paid';
      const legacyAllPaid = legacyOrders.length>0 && legacyOrders.every(o=>o.payment_status==='paid');
      if (modernPaid || legacyAllPaid) { color='green'; reason='all paid (modern session or legacy orders)'; }
      else if (!anyOrders) { color='yellow'; reason='active session; no orders yet'; }
      else { color='yellow'; reason='orders present; awaiting payment'; }
    }
    return res.json({
      input:{ businessId, table: tableNumber, qrId: qrId||null },
      modern:{ qr: modernQrRow, session: modernSessionRow, orders: modernOrders },
      legacy:{ qr: legacyQrRow, session: legacySessionRow, orders: legacyOrders },
      derived:{ color, reason }
    });
  } catch(e) {
    console.error('GET /api/diagnostics/table-state error', e);
    return res.status(500).json({ error:'failed to build table-state', detail:e.message });
  }
});

// --- Kitchen Orders Endpoint ---
// GET /api/kitchen/orders?businessId=1
// Returns active (or recently paid) orders from both modern and legacy schemas for kitchen display.
app.get('/api/kitchen/orders', async (req, res) => {
  try {
    const businessId = parseInt(req.query.businessId || req.query.tenant || '1',10);
    if (!businessId) return res.status(400).json({ error:'businessId required'});
    const includePaid = String(req.query.includePaid||'0')==='1';
    // Modern orders
    const modern = await pool.query(`
      SELECT so.id AS order_id, 'modern' AS source, qc.table_number, ds.payment_status AS session_payment_status,
             so.payment_status AS order_payment_status, so.order_status, so.total_amount, so.created_at
      FROM session_orders so
      JOIN dining_sessions ds ON ds.id = so.session_id
      JOIN qr_codes qc ON qc.id = ds.qr_code_id
      WHERE qc.business_id=$1 AND ds.is_active=TRUE
        AND ( $2::boolean = TRUE OR so.payment_status <> 'paid')
      ORDER BY so.created_at DESC
      LIMIT 200
    `,[businessId, includePaid]);
    // Legacy orders
    const legacy = await pool.query(`
      SELECT o.order_id, 'legacy' AS source, q.table_number, o.payment_status AS order_payment_status,
             o.status AS order_status, o.created_at
      FROM Orders o
      JOIN DiningSessions ds ON ds.session_id = o.dining_session_id
      JOIN QRCodes q ON q.qr_code_id = ds.qr_code_id
      WHERE q.business_id=$1 AND ds.status='active'
        AND ( $2::boolean = TRUE OR o.payment_status <> 'paid')
      ORDER BY o.order_id DESC
      LIMIT 200
    `,[businessId, includePaid]);
    return res.json({ businessId, modern: modern.rows, legacy: legacy.rows, count: modern.rows.length + legacy.rows.length });
  } catch(e) {
    console.error('GET /api/kitchen/orders error', e);
    return res.status(500).json({ error:'failed to load kitchen orders', detail:e.message });
  }
});