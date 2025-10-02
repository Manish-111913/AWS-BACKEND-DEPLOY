# Multi-Tenancy Architecture (Invexis / QR Billing)

## Goal
Robust, enforceable, auditable tenant isolation using a **single PostgreSQL database + shared schema** with **Row Level Security (RLS)** and **runtime tenant context**.

## Model Summary
| Aspect | Approach |
|--------|----------|
| Isolation | `business_id` column + PostgreSQL RLS policy per table |
| Context Propagation | `set_tenant_context(business_id)` sets `app.current_tenant` GUC |
| Enforcement | RLS policy: `USING business_id = current_setting('app.current_tenant', true)::int` |
| Write Guard | `WITH CHECK` clause mirrors the `USING` predicate |
| Bootstrapping | Business inserted before context required; subsequent data under context |
| Indexing | Compound `(business_id, status|date|active)` for tenant-scoped queries |

## Key Functions (Database)
```
set_tenant_context(tenant_business_id INT)
get_tenant_context() RETURNS INT
validate_tenant_context() RETURNS BOOLEAN
```

## Application Responsibilities
1. **Resolve tenant** (from JWT, API key, session, or header) at request start.
2. **Acquire PG client** from pool.
3. **Execute**: `SELECT set_tenant_context($1)` before any tenant-scoped query.
4. **All queries** rely on RLS—no need to put `business_id = $1` manually (still OK for indexes/filtering).
5. **Release client** after response; optionally clear context for defense-in-depth.

## Middleware Skeleton
```js
async function tenantMiddleware(req, res, next) {
  try {
    const tenantId = resolveTenantFromAuth(req); // implement this
    if (!tenantId) return res.status(400).json({ error: 'Tenant missing' });
    const client = await pool.connect();
    await client.query('SELECT set_tenant_context($1)', [tenantId]);
    req.db = client;
    req.tenantId = tenantId;
    res.on('finish', () => client.release());
    next();
  } catch (e) { next(e); }
}
```

## RLS Policy Pattern
All business tables (detected in provisioning script) get:
```
CREATE POLICY tenant_<table>_policy ON <Table>
  FOR ALL TO PUBLIC
  USING (business_id = current_setting('app.current_tenant', true)::int)
  WITH CHECK (business_id = current_setting('app.current_tenant', true)::int);
```

## Validation & Testing
Run isolation diagnostic:
```
node backend/scripts/test-multitenancy.js
```
What it verifies:
- Two businesses isolated
- Cross-tenant spoof insert blocked
- Visibility leakage prevented

## Hardening Options
| Enhancement | Benefit |
|-------------|---------|
| Separate policies per command | Fine-grained future RBAC |
| BEFORE INSERT trigger ensuring context set | Prevents unscoped writes |
| Add audit table for critical tables | Forensics & compliance |
| Materialized view per tenant for heavy aggregates | Performance |
| Connection wrap clearing context on release | Eliminates stale GUC risk |
| CI schema check script | Prevents new table without RLS |

## Example: Trigger to Enforce Context
```sql
CREATE OR REPLACE FUNCTION assert_tenant_context()
RETURNS trigger AS $$
BEGIN
  IF current_setting('app.current_tenant', true) IS NULL THEN
    RAISE EXCEPTION 'Tenant context not set';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

-- Apply (example)
CREATE TRIGGER inventoryitems_assert_ctx
  BEFORE INSERT ON InventoryItems
  FOR EACH ROW EXECUTE FUNCTION assert_tenant_context();
```

## Operational Checklist
- [ ] Tenant context is set in every request before queries
- [ ] No pooled session reused without resetting context
- [ ] All tables with `business_id` have RLS enabled
- [ ] Cross-tenant insert attempt fails (script proves)
- [ ] App does not trust client-provided business_id (derive from auth)
- [ ] Production logs include `{ tenant: <id>, route, duration }`
- [ ] Indexes support primary access patterns `(business_id, status/date)`
- [ ] Inventory deduction triggers operate only within tenant scope
- [ ] Business creation path documented and isolated

## Monitoring Suggestions
- Add structured log field `tenant_id`.
- Periodic superuser job: `SELECT table_name FROM information_schema.columns WHERE column_name='business_id'` vs `pg_policies` to detect drift.
- Alert if any query returns `business_id` NULL where it should not.

## Common Pitfalls & Solutions
| Pitfall | Symptom | Fix |
|---------|---------|-----|
| Forget to set context | Empty result sets or cross-tenant exposure if superuser | Middleware enforcement |
| Reusing pooled connection | Tenant A sees stale context | Always call `set_tenant_context` per request |
| New table added w/o RLS | Data leakage path | CI schema RLS audit |
| Manual override during admin ops | Bypass policies silently | Add explicit `admin_mode` function with audit |

## Migration Safety
When adding new tenant tables:
1. Add `business_id INT NOT NULL REFERENCES Businesses(business_id)`.
2. Provision default indexes: `(business_id, created_at)` or domain-specific.
3. Enable RLS + policy.
4. Add to automated RLS verification script list if you maintain one.

## Decision Log (Rationale)
- Chose shared schema (vs per-tenant schema) for reduced migration overhead and uniform analytics.
- Chose RLS over manual WHERE because it eliminates class of human error.
- Chose GUC (`app.current_tenant`) for stable, performant predicate reuse.

## Future Improvements
- Add column-level security for sensitive financial tables.
- Introduce `TenantFeatureFlags` for plan-based enablement.
- Build a `TenantDataExport` service (per-tenant dump).

## Runtime Modes
| Env Var | Effect | Default |
|---------|--------|---------|
| `DEFAULT_TENANT_ID` | If set, used when no tenant id resolved (soft legacy mode) | unset |
| `STRICT_MULTI_TENANCY` | If `true`, requests without tenant are rejected (400) | false |

### Rollout Strategy
1. Phase 0: Set `DEFAULT_TENANT_ID` to a known dev tenant → verify nothing breaks.
2. Phase 1: Update frontend/auth to always send header `X-Business-Id` or embed business in JWT.
3. Phase 2: Remove `DEFAULT_TENANT_ID`, keep `STRICT_MULTI_TENANCY=false` for a soak period.
4. Phase 3: Set `STRICT_MULTI_TENANCY=true` (enforced) once all clients compliant.
5. Optional: Add trigger-based enforcement afterwards.

## Middleware Placement
Injected in `server.js` AFTER `/api/auth` route registration to avoid interfering with login/signup, BEFORE all business-bound routes.

```js
const tenantContext = require('./middleware/tenantContext');
app.use('/api/auth', authRoutes); // public / semi-public
app.use(tenantContext);           // multi-tenant activation boundary
// subsequent /api/* routes now protected by RLS context
```

## FORCE ROW LEVEL SECURITY
By default PostgreSQL allows the table owner and superusers to bypass RLS. To guarantee *all* access paths are evaluated, we apply:
```
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;
```
A helper script was added:
```
node backend/scripts/force-rls.js
```
This will:
1. Find all tables with `business_id`.
2. Enable and FORCE RLS on each.

### WHEN TO RUN
- After initial migrations (once tables exist)
- After adding new tenant tables
- In CI before running isolation test

### CI Suggestion
```
node backend/scripts/force-rls.js && node backend/scripts/test-multitenancy.js
```

## ROLE HARDENING
Create a dedicated application role with no bypass privileges:
```sql
CREATE ROLE app_user NOINHERIT LOGIN PASSWORD '***';
GRANT CONNECT ON DATABASE yourdb TO app_user;
-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO app_user;
-- Table privileges (select/insert/update/delete as needed)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
```
Use that role in `DATABASE_URL` instead of the superuser.

## POST-FIX VERIFICATION STEPS
1. Run force script:
```
node backend/scripts/force-rls.js
```
2. Re-run isolation test:
```
node backend/scripts/test-multitenancy.js
```
3. Expect: All `visibility_check` operations ✅ and `spoof_insert` ✅ (blocked).
4. Optional deeper audit:
```sql
SELECT relname, relforcerowsecurity FROM pg_class WHERE relforcerowsecurity = true ORDER BY relname;
```

---
Maintainer: (Add maintainer contact here)
Last Updated: 2025-09-19
