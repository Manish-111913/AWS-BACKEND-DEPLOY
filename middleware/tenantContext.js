// middleware/tenantContext.js
// Non-intrusive tenant context setter.
// Strategy:
// 1. If request already resolved a user with business_id (e.g., auth layer), use that.
// 2. Else if X-Business-Id header present, use that.
// 3. Else if DEFAULT_TENANT_ID env set, use it (soft mode for legacy non-tenant-aware calls).
// 4. Else: proceed WITHOUT setting context (legacy behavior) — RLS will hide rows, may return empty.
//    (You can later flip STRICT_MULTI_TENANCY=true to enforce rejection when tenant is missing.)
//
// This avoids breaking existing endpoints while enabling progressive adoption.

const { pool } = require('../config/database');

const DEFAULT_TENANT_ID = process.env.DEFAULT_TENANT_ID ? parseInt(process.env.DEFAULT_TENANT_ID, 10) : null;
const STRICT_MULTI_TENANCY = process.env.STRICT_MULTI_TENANCY === 'true';

async function tenantContext(req, res, next) {
  let client;
  try {
    // Skip for health or auth endpoints (adjust as needed)
    if (req.method === 'OPTIONS' || req.method === 'HEAD' || req.path.startsWith('/api/health') || req.path.startsWith('/api/auth')) {
      return next();
    }

    // Resolve tenant ID (expanded sources)
    let tenantId = null;
    // Headers (case-insensitive in Node): include common aliases
    const headerTenant = (
      req.headers['x-business-id'] || req.headers['x-tenant-id'] ||
      req.headers['x-businessid'] || req.headers['x-tenantid'] ||
      req.headers['x-bid'] || req.headers['x-tenant']
    );
    // Query params: include snake_case and common aliases
    const queryTenant = (
      req.query.tenantId || req.query.businessId ||
      req.query.tenant_id || req.query.business_id ||
      req.query.tenant || req.query.bid
    );
    // Body param (for POSTs)
    const bodyTenant = (
      (req.body && (req.body.tenantId || req.body.businessId || req.body.tenant_id || req.body.business_id)) || null
    );

    if (req.user && req.user.business_id) tenantId = req.user.business_id;
    else if (headerTenant) {
      const parsed = parseInt(headerTenant, 10);
      if (!Number.isNaN(parsed)) tenantId = parsed;
    } else if (queryTenant) {
      const parsed = parseInt(queryTenant, 10);
      if (!Number.isNaN(parsed)) tenantId = parsed;
    } else if (bodyTenant) {
      const parsed = parseInt(bodyTenant, 10);
      if (!Number.isNaN(parsed)) tenantId = parsed;
    } else if (DEFAULT_TENANT_ID && !STRICT_MULTI_TENANCY) {
      // Only apply soft fallback when NOT in strict mode
      tenantId = DEFAULT_TENANT_ID; // Soft fallback (legacy support)
    }

    if (!tenantId) {
      const isStartSession = req.path === '/api/orders/start-session' || req.originalUrl === '/api/orders/start-session';
      const enforcing = (STRICT_MULTI_TENANCY || req.path.startsWith('/diagnostics')) && !isStartSession;
      if (enforcing) {
        return res.status(400).json({ error: 'tenant_context_missing', details: 'Provide X-Tenant-Id or X-Business-Id header (or authenticate with business_id).', sourcesTried: ['req.user.business_id','X-Business-Id','X-Tenant-Id','query.tenantId','DEFAULT_TENANT_ID'], strict: STRICT_MULTI_TENANCY });
      }
      // Soft fallback for start-session (assume tenant 1 if unspecified)
      if (isStartSession) {
        tenantId = DEFAULT_TENANT_ID || 1;
      } else {
        return next();
      }
    }

  // Acquire db client with guard; if pool is saturated/slow, fail fast to avoid hanging requests
  const acquire = pool.connect();
  const timeoutMs = Math.max(parseInt(process.env.PG_CONN_TIMEOUT_MS || '20000', 10), 1000);
  client = await Promise.race([
    acquire,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`DB connection acquisition timeout after ${timeoutMs}ms`)), timeoutMs))
  ]);
  // Set both legacy and new GUC keys for compatibility across modules
  await client.query('SELECT set_config($1, $2, false)', ['app.current_tenant', String(tenantId)]);
  await client.query('SELECT set_config($1, $2, false)', ['app.current_business_id', String(tenantId)]);
    // Fallback check: if still blank, try dynamic SET (without parameter binding) safely after sanitizing.
    // (tenantId already parsed to int, so safe to interpolate)
    let usedFallback = false;
    let { rows:[preCheck] } = await client.query(`SELECT current_setting('app.current_tenant', true) AS ctx_before`);
    if (!preCheck.ctx_before) {
      await client.query(`SET app.current_tenant = '${tenantId}'`);
      usedFallback = true;
    }
    // Ensure app.current_business_id is also present
    let { rows:[preCheck2] } = await client.query(`SELECT current_setting('app.current_business_id', true) AS ctx_before`);
    if (!preCheck2.ctx_before) {
      await client.query(`SET app.current_business_id = '${tenantId}'`);
      usedFallback = true;
    }
    let usedHelper = false;

    // Verify the GUC actually got set (defense-in-depth)
    const { rows:[vr] } = await client.query(`SELECT current_setting('app.current_tenant', true) AS ctx`);
    const { rows:[vr2] } = await client.query(`SELECT current_setting('app.current_business_id', true) AS ctx2`);
    if (!vr.ctx || !vr2.ctx2) {
      const msg = '[tenantContext] GUC still empty after set_config + fallback SET. tenantId=' + tenantId;
      if (STRICT_MULTI_TENANCY) {
        // Final attempt: if DEFAULT_TENANT_ID present, try once with it; else downgrade to soft warning
        if (DEFAULT_TENANT_ID && DEFAULT_TENANT_ID !== tenantId) {
          try {
            await client.query(`SET app.current_tenant = '${DEFAULT_TENANT_ID}'`);
            await client.query(`SET app.current_business_id = '${DEFAULT_TENANT_ID}'`);
            const { rows:[rvA] } = await client.query(`SELECT current_setting('app.current_tenant', true) AS ctx`);
            if (!rvA.ctx) {
              console.error(msg + ' (strict) — fallback attempt with DEFAULT_TENANT_ID failed');
              throw new Error('Failed to establish tenant context (GUC not set)');
            } else {
              console.warn(msg + ' — recovered with DEFAULT_TENANT_ID');
            }
          } catch (recErr) {
            console.error('[tenantContext] recovery attempt failed:', recErr.message);
            throw new Error('Failed to establish tenant context (GUC not set)');
          }
        } else {
          console.error(msg + ' — STRICT mode aborting');
          throw new Error('Failed to establish tenant context (GUC not set)');
        }
      } else {
        // Soft mode: multi-step retry before giving up
        const devFallback = DEFAULT_TENANT_ID || 1;
        let applied = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await client.query('SELECT pg_sleep(0)'); // yield
            await client.query(`SET app.current_tenant = '${devFallback}'`);
            await client.query(`SET app.current_business_id = '${devFallback}'`);
            const { rows:[chk] } = await client.query(`SELECT current_setting('app.current_tenant', true) AS ctx`);
            if (chk.ctx) { applied = true; break; }
          } catch (_) { /* retry */ }
        }
        if (applied) {
          console.warn(msg + ` — recovered via dev fallback tenant=${devFallback}`);
          res.setHeader('X-Tenant-Warning', 'fallback-applied');
        } else {
          console.warn(msg + ' — fallback attempts failed; proceeding (queries may return empty)');
          res.setHeader('X-Tenant-Warning', 'fallback-failed');
        }
      }
    }
    // Lightweight debug (suppress in production unless VERBOSE_TENANT_LOGS)
    if (process.env.VERBOSE_TENANT_LOGS === 'true') {
      console.log(`[tenantContext] tenant=${tenantId} established (fallback=${usedFallback}) path=${req.path}`);
    }

    // Attach for downstream handlers (unify naming)
    req.dbClient = client; // preferred name
    req.db = client;       // backward compatibility
    req.tenantId = tenantId;
  req.tenantContextEstablishedVia = usedFallback ? 'fallback_set' : 'set_config';

    // Release on response end/close
    let released = false;
    const releaseClient = () => {
      if (released) return; // guard against double release
      released = true;
      try { client.release(); } catch (_) { /* ignore */ }
    };
    res.on('finish', releaseClient);
    res.on('close', releaseClient);
    

    return next();
  } catch (err) {
    if (client) {
      try { client.release(); } catch (_) {}
    }
    return next(err);
  }
}

module.exports = tenantContext;
