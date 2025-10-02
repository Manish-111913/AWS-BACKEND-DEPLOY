Invexis Backend Overview (Excluding DB utils)

Updated: 2025-09-06

Scope
- This document explains how the backend works end-to-end, excluding any files under backend/DB utils.
- Complements backend/DB_SCHEMA_SUMMARY.md (database schema details).

Runtime Architecture
- Entry point: backend/server.js
  - Express app with security middleware (helmet), CORS (localhost origins), JSON body parsing, static serving for /uploads and /images with permissive CORS headers.
  - Routes mounted under /api/* across domains: auth, stock-in, inventory, OCR, sales-report, menu, recipes, wastage, users, health, usage, unit-mapping, total-sales, reports, abc-analysis, recipe-library, images, roles, settings, inventory-categories, minimal-stock, vendor-management, reorder, notifications, testCategoryAssignments, and stockrepo (analytics).
  - Error handling middleware translating ValidationError and common PG error codes (23505 duplicate, 23503 FK) into JSON responses; default 500 with optional stack in development.
  - 404 catch-all to JSON.
  - Server startup flow:
    1) Tests DB connectivity via config/database.testConnection().
    2) Starts Express on http://localhost:5000.
    3) initializeNotificationSystem():
       - Ensures NotificationPreferences rows exist for all active users (endOfDayReports, dailyReportReminders, monthlyReports, performanceAlerts).
       - Initializes the Report Scheduler.
       - Prints a curated list of available routes for operator visibility.
    4) Graceful shutdown hooks stop the report scheduler.

Configuration & DB Access
- Environment: .env consumed via dotenv. Important vars include DATABASE_URL, JWT_SECRET, FRONTEND_URL, API_BASE_URL (for scheduler callbacks).
- Database access: config/database exports a pg Pool (pool) and testConnection(). All feature modules use pool.query() with parameterized SQL.
- Tenant context: See DBfinal.js and DB_SCHEMA_SUMMARY.md for multi-tenant RLS; many routes currently default to business_id=1 unless a business id is passed.

Services
- services/reportScheduler.js
  - Orchestrates time-based jobs using node-cron (timezone Asia/Kolkata):
    - End-of-day reports: 23:30 daily → generates and posts notification payloads per user.
    - Missing report reminders: 09:00 daily → posts reminders for missing daily reports.
    - Monthly reports: 10:00 on the 1st → posts monthly report readiness per user.
    - Performance checks: every 2 hours between 10:00 and 22:00 → checks unusual sales volume and wastage trends; posts alerts.
    - Reorder point refresh: 02:00 daily → updates InventoryItems.reorder_point using ReorderPointCalculations and optional VendorLeadTimes.
  - Uses callNotificationEndpoint() to POST to /api/notifications/* (configurable base URL).
  - Exposes initialize(), stop(), getStatus().

Selected Route Modules (behavioral summary)
- routes/auth.js
  - Email setup via nodemailer (Gmail SMTP). Tests config on startup.
  - POST /api/auth/signup: Validates input & password strength, hashes password (bcrypt), inserts Users row with is_active=false, emails verification link (JWT). Rolls back on failure.
  - GET /api/auth/verify-email?token=...: Verifies JWT, activates user (is_active=true), returns an HTML confirmation page.
  - POST /api/auth/signin: Verifies credentials, last_login_at update, returns JWT session token (24h) with user metadata.
  - POST /api/auth/resend-verification: Re-sends verification email for inactive accounts.
  - GET /api/auth/status: Checks Bearer token, returns authenticated status + user info.
  - PUT /api/auth/profile (JWT): Updates name/email/phone with uniqueness checks.
  - PUT /api/auth/change-password (JWT): Validates current password, updates password hash.

- routes/inventory.js
  - POST /api/inventory/items: Upsert InventoryItems by (business_id, name), resolves unit via GlobalUnits, tracks source, returns item with unit symbol.
  - DELETE /api/inventory/items/:itemId/batches/:batchId: Soft-expire batch (is_expired=true), updates InventoryItems.is_in_stock if no active batches remain; transaction-protected.
  - Additional GET endpoints (not fully enumerated here) return item batches and category assignments used by UI.

- routes/stockrepo.js (analytics/reporting support)
  - GET /header-summary: Aggregates total sales, gross profit proxy.
  - GET /item-wise-sales: Joins sales and wastage; estimates cost tiers and computes gross profit and percentage per menu item.
  - GET /raw-material-stock: Summarizes ingredient stock and classifies stock level vs reorder point.
  - GET /performance-analytics: Item sales series and overall total in a period.
  - GET /raw-material-consumption: Ingredient stock vs consumption from StockOutRecords.
  - GET /performance-summary: Sales, profit proxy, wastage per menu item.
  - GET /wastage-comparison: Top wastage menu items over a period.
  - GET /key-insights: Best-selling item, most wasted item, and a simple stock accuracy metric.
  - Utilities: period-based date range parser; debug endpoints (schema, test images).

- Other route groups (high-level intent based on server.js mounts and repository naming)
  - routes/stockIn.js: Handles bill ingestion (manual/OCR), item mapping, batch creation, and stock-in line items.
  - routes/ocr.js: Image upload, OCR processing for sales reports/vendor bills, and extracted line items.
  - routes/salesReport.js: Daily/periodic sales aggregation, report generation, confirmation flows.
  - routes/menu.js & routes/recipes.js: Manage menu items, categories, recipes, and recipe ingredients.
  - routes/wastage.js: Record wastage (StockOutRecords reason=waste), list reasons, and summaries.
  - routes/usage.js: Record inventory usage/stock-out (reason=usage), summaries, and possibly link to UsageEvents.
  - routes/unitMapping.js: Unit catalogs, supplier conversions, kitchen units setup per business.
  - routes/reports.js: Business dashboards, quick reports, data health metrics, category/report preferences.
  - routes/abcAnalysis.js: Compute and store ABCAnalysisResults and recommendations. Also provides:
    - GET /api/abc-analysis/list: grouped A/B/C lists for UI tabs (requires a recent /calculate call; uses short cache)
    - POST /api/abc-analysis/promote: convenience endpoint to promote B-item to A (sets manual_abc_category='A')
    - PUT /api/abc-analysis/manual-category: explicit manual override (currently restricted to 'A')
    - DELETE /api/abc-analysis/manual-category/:itemId: clear manual override
    - GET /api/abc-analysis/item/:itemId: enriched item detail view data
  - routes/recipeLibrary.js: Predefined complimentary items and templates.
  - routes/images.js: Image metadata, thumbnails, uploads; uses ScannedImages.
  - routes/roles.js & routes/users.js: Role management and user CRUD.
  - routes/settings.js & routes/inventoryCategories.js & routes/minimalStock.js: Settings and category management.
  - routes/vendorManagement.js & routes/reorderManagement.js: Vendor CRUD and procurement planning/reorder logic.
  - routes/notifications.js: Endpoints consumed by the scheduler for EoD/missing/monthly/performance alerts; also user notification preferences.

Error Handling & Logging
- Central error handler catches thrown errors from routes and maps database constraint errors to 4xx where appropriate.
- Startup console enumerates mounted routes and highlights scheduling setup status.
- Many routes log key actions for traceability (e.g., auth). Keep NODE_ENV=development to include stack traces in error JSON.

Security & Auth
- JWT-based session tokens for authenticated endpoints in auth.js; other modules may require middleware similarly (check per-route).
- Helmet enables basic HTTP headers. CORS restricted to localhost origins by default.
- Email verification required before sign-in (Users.is_active must be true).

Scheduling & Notifications Flow
- Scheduler selects active users with enabled NotificationPreferences per alert_type.
- Posts to /api/notifications/* endpoints residing within the same backend by default (API_BASE_URL or localhost:5000).
- Notifications and Report generation depend on DBfinal.js tables: UserNotifications, SalesReports, StockReports, QuickReports, DataHealthMetrics, etc.

Data Model Alignment
- All CRUD/analytics queries operate on the PostgreSQL schema created by backend/DBfinal.js.
- Key dependencies visible:
  - SalesTransactions + SaleLineItems power sales analytics endpoints.
  - StockOutRecords collect wastage/usage info used in reporting.
  - InventoryItems + InventoryBatches maintain stock status and reorder logic.
  - MenuItems + RecipeIngredients enable usage estimations and sales linkages.

Local Development
- Start DB (Neon/Postgres), run node backend/DBfinal.js once to create/update schema.
- Start server: cd backend && npm start (or node server.js).
- Frontend expected at http://localhost:3000.
- Test scripts at repo root (quick-connectivity-test.js, test-inventory-api.js, test-report-system.js, etc.) exercise critical flows.

Operational Caveats
- Some routes assume business_id=1 if none is supplied; for multi-tenant production, ensure set_tenant_context is used or business context is enforced per request.
- Gmail SMTP settings in auth.js expect a valid app password and 2FA-enabled account.
- Images served from /uploads and /images with cross-origin resource policy set to cross-origin.

Appendix: Key Endpoints at Startup (printed by server)
- Health: /api/health
- Stock In: /api/stock-in (CRUD & draft/complete)
- Menu & Recipes: /api/menu/*, /api/recipes/*
- Usage (Stock Out): /api/usage/*
- Unit Mapping: /api/unit-mapping/*
- Auth: /api/auth/* (signup, signin, status, verify-email, resend-verification, profile, change-password)
- Users: /api/users/*
- OCR: /api/ocr/* (upload/process)
- Wastage: /api/wastage/*
- Inventory: /api/inventory/*
- ABC: /api/abc-analysis/*
- Stock & Wastage Reports (stockrepo): /api/stockrepo/*

Notes
- This overview intentionally excludes any files under backend/DB utils per the requirement.
