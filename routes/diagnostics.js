// backend/routes/diagnostics.js
// Enhanced diagnostics endpoints for multi-tenant isolation visibility.
// Provides:
//   GET /diagnostics/whoami                → current DB role + tenant context
//   GET /diagnostics/tenant-visibility     → leak counts across key tenant tables
//     Optional query params:
//       tables=inventoryitems,vendors      → override default table list
//       detail=true                        → include per-table totals and leak ratio

const router = require('express').Router();
// Use the central database pool
const { pool } = require('../config/database');

function getClient(req) {
  return (req && (req.dbClient || req.db)) || pool;
}

async function getTenantContext(req) {
  const client = getClient(req);
  const { rows: [{ tenant_raw }] } = await client.query(
    `SELECT current_setting('app.current_tenant', true) AS tenant_raw`
  );
  return tenant_raw || null;
}

async function countTableLeaks(table, tenantId) {
  // Basic safety on identifier (letters, numbers, underscore only)
  if (!/^[a-zA-Z0-9_]+$/.test(table)) {
    throw new Error(`Invalid table identifier: ${table}`);
  }
  const sql = `SELECT 
      COUNT(*) FILTER (WHERE business_id <> $1) AS leaks,
      COUNT(*) AS total
    FROM ${table}`;
  const { rows:[r] } = await pool.query(sql, [tenantId]);
  return { leaks: parseInt(r.leaks,10), total: parseInt(r.total,10) };
}

router.get('/whoami', async (req,res,next) => {
  try {
    const client = getClient(req);
    const { rows:[r] } = await client.query(`SELECT current_user, session_user, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypass_rls`);
    const tenantContext = await getTenantContext(req);
    const warnings = [];
    if (r.bypass_rls) warnings.push('Connected role can BYPASS RLS; isolation tests are not reliable. Switch to runtime role.');
    if (!tenantContext) warnings.push('Tenant context not set. Provide X-Tenant-Id or X-Business-Id header.');
    res.json({ success:true, current_user: r.current_user, session_user: r.session_user, bypassRLS: r.bypass_rls, tenantContext, via: req.tenantContextEstablishedVia || null, warnings });
  } catch (e) {
    next(e);
  }
});

router.get('/tenant-visibility', async (req,res,next)=>{
  try {
    const client = getClient(req);
    const tenantRaw = await getTenantContext(req);
    if (!tenantRaw) {
      return res.status(400).json({ success:false, error:'tenant_context_missing', message:'app.current_tenant not set in this session', remediation: 'Send header X-Tenant-Id: <business_id> or authenticate with a user tied to a business.' });
    }
    const tenantId = parseInt(tenantRaw,10);
    if (Number.isNaN(tenantId)) {
      return res.status(400).json({ success:false, error:'tenant_context_invalid', value: tenantRaw });
    }

    const detail = (req.query.detail === 'true');
    const tables = (req.query.tables ? req.query.tables.split(',') : ['inventoryitems','inventorycategories','vendors']).map(t=>t.trim()).filter(Boolean);

    const perTable = {};
    for (const t of tables) {
      try {
        perTable[t] = await countTableLeaks(t, tenantId);
        if (detail) {
          const { leaks, total } = perTable[t];
          perTable[t].ratio = total === 0 ? 0 : leaks / total;
        }
      } catch (e) {
        perTable[t] = { error: e.message };
      }
    }

    let totalLeaks = 0; let totalRows = 0;
    for (const v of Object.values(perTable)) {
      if (v && typeof v.leaks === 'number') totalLeaks += v.leaks;
      if (v && typeof v.total === 'number') totalRows += v.total;
    }

    res.json({
      success:true,
      tenantId,
      tables: perTable,
      summary: {
        totalLeaks,
        totalRows,
        overallLeakRatio: totalRows === 0 ? 0 : totalLeaks / totalRows,
        allIsolated: totalLeaks === 0
      }
    });
  } catch(e) {
    next(e);
  }
});

module.exports = router;
