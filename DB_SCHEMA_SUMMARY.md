Invexis Database Schema Summary (PostgreSQL / Neon)

Version: v2.3 Enterprise (August 2025)
File: backend/DBfinal.js

Overview
- Multi-tenant schema for restaurants/food businesses.
- PostgreSQL 14+ (compatible with Neon). Uses SSL connection via DATABASE_URL.
- Strong tenant isolation using Row-Level Security (RLS) tied to app.current_tenant.
- Comprehensive indexing for performance.
- Rich domain coverage: business & users, dashboard/notifications, inventory, vendors & procurement, sales & OCR, menu & recipes, reporting & analytics, production planning, subscriptions, and a usage events system.

Environment & Running
1) Set DATABASE_URL in .env with Neon connection string (sslmode=require).
2) Node.js v16+ recommended. Run: node backend/DBfinal.js
3) The script is idempotent (IF NOT EXISTS and CREATE OR REPLACE used widely). Safe to re-run.
4) Extensions: The script ensures pgcrypto (for gen_random_uuid) is present.

Tenant Context
- Helper functions:
  - set_tenant_context(tenant_business_id int)
  - get_tenant_context() returns int
  - validate_tenant_context() returns boolean
- RLS policies use current_setting('app.current_tenant', true)::int for filtering.
- App helper also provided (JS): setTenantContext(client, businessId) sets app.current_tenant.

Key Enums (selection)
- widget_enum(Metric, Graph, List, Button), trend_enum(Up, Down, Stable)
- severity_enum(Low, Medium, High, Critical), alert_status_enum(open, resolved, dismissed)
- unit_type_enum(Weight, Volume, Count, Prepared Dish, Custom)
- stock_in_status_enum, stock_in_entry_enum, stock_out_status_enum, stock_reason_enum
- item_source_enum(InventoryItem, MenuItem)
- po_status_enum, payment_status_enum
- report_category_enum(Sales, Inventory, Wastage, Vendor, Financial, Data Health, Other)
- abc_enum(A, B, C)
- sales_status_enum, scan_status_enum, scan_type_enum
- transaction_enum(Sale, Wastage, Complimentary)
- waste_reason_cat_enum, health_status_enum, setting_data_enum
- billing_cycle_enum(Monthly, Annually), subscription_status_enum
- forecasting_method_enum(Manual, Hybrid_Forecast, Moving_Average, Same_Day_Average)

Modules & Major Tables (high level)
1) Business & User Management
   - BusinessTypes, BillingMachineModels, Languages
   - Businesses, BusinessLocations(UNIQUE per business), Roles(+RolePermissions), Users
   - Permissions, RolePermissions

2) Dashboard & Notifications
   - DashboardWidgets, UserDashboardPreferences(UNIQUE per user+widget)
   - UserNotifications, NotificationPreferences

3) Summary Metrics & Reports
   - SalesSummaryMetrics(UNIQUE business+period+range)
   - QuickReports(UNIQUE business+date_range)

4) Inventory Core
   - GlobalUnits, BusinessUnitConversions(UNIQUE business+from+to)
   - InventoryCategories(UNIQUE per business)
   - Vendors(UNIQUE per business), InventoryItems(UNIQUE per business)
   - InventoryBatches (per item, track expiry, cost)
   - StockInRecords + StockInLineItems
   - StockOutRecords (reason_type Usage/Waste, supports evidence image and usage_event link)
   - WastageReasons(UNIQUE per business) + WastageRecords

5) Smart Inventory & ABC
   - ABCAnalysisResults(UNIQUE item+biz+period)
   - ReorderPointCalculations (per item)
   - VendorRatings(UNIQUE vendor+user)

6) Vendor & Procurement
   - PurchaseOrders(UNIQUE business+po_number) + PurchaseOrderLineItems(UNIQUE po+item)
   - VendorBillsItems, UpcomingPaymentsDue(UNIQUE business+vendor+invoice)

7) Sales Management & OCR
   - MenuCategories(UNIQUE per business) + MenuItems(UNIQUE per business)
   - SalesTransactions + SaleLineItems
   - ScannedImages (file metadata; scan_type/status enums extended)
   - ExtractedSalesReports + ExtractedSalesLineItems
   - DailySaleReports(UNIQUE per business per date)
   - InventoryTransactions (transaction_enum)

8) Menu, Recipes & Complimentary
   - Recipes(one-to-one with MenuItems)
   - RecipeIngredients(UNIQUE recipe+item)
   - ComplimentaryItemTemplates (by BusinessTypes)
   - BusinessComplimentaryItems(UNIQUE business+main_dish+complimentary)

9) Reports & Analytics
   - ReportRegistry, UserFavoriteReports(UNIQUE user+report)
   - ReportAccessHistory, ReportCategoryViewPreferences(UNIQUE user+category)
   - ReportFilterHistory, DataHealthMetrics(UNIQUE business+module+period)
   - UserReportViews, SalesReports(UNIQUE business+date), StockReports(UNIQUE business+date)

10) Production Planning & Forecasting
   - EstimatedProductionPlans(UNIQUE business+date+menu_item)
   - ProductionPlanHistory, ForecastingModelMetrics
   - DailyProductionInsights(UNIQUE business+date)

11) Settings & Admin
   - BusinessSettings(UNIQUE business+key), LocationSettings(UNIQUE location+key)
   - TaxRates(UNIQUE business+name), PaymentMethods(UNIQUE business+name)

12) Subscription & Plan Management
   - SubscriptionPlans, PlanFeatures(UNIQUE plan+feature)
   - BusinessSubscriptions(UNIQUE business+plan+start_date)

13) Usage Events & Production Tracking
   - UsageEvents(UUID PK default gen_random_uuid) status draft/submitted
   - UsageItems(UUID PK) per event and dish
   - UsageEventImages (link images evidence)
   - IngredientUsageEstimations (estimated ingredient needs per usage event)

Views (selection)
- CurrentStockSummary: item totals, reorder vs safety status
- UsageEventsSummary: per-event counts and metadata
- ProductionSummary: estimated revenue by production
- MenuItemsWithImages: menu + image metadata
- StockOutSummaryWithImages: stock-out with evidence image and usage event
- IngredientUsageSummary: flattened view of estimations

Triggers and Functions
- update_updated_at_column() + triggers on many tables
- process_usage_event_submission() BEFORE UPDATE on UsageEvents:
  - When status changes draft -> submitted: compute IngredientUsageEstimations based on RecipeIngredients and production quantities; updates submitted_at.
  - Note: It does NOT deduct stock automatically (estimation only).

RLS
- Enabled on all tables with business_id, via a loop that checks information_schema.
- Policy tenant_<table>_policy FOR ALL TO PUBLIC using app.current_tenant equality filter.
- Ensure to call set_tenant_context before querying or writing multi-tenant tables.

Indexes
- Many CONCURRENTLY created, grouped into business, performance, audit, production/usage.
- Additional targeted btree indexes on ABCAnalysisResults, StockOutRecords, InventoryBatches etc.

Important Constraints & Uniques
- Extensive UNIQUE constraints to prevent duplication (noted with FIXED comments in code).
- Check constraints for positive numbers, rating ranges, etc.

Operational Notes / Gotchas
- Requires pgcrypto for gen_random_uuid (the script now ensures it).
- ENUM alterations are done conditionally with DO blocks; on legacy environments adding values to enums may require exclusive lock; run off-hours.
- The RLS policy uses current_setting; ensure the application always sets app.current_tenant for each session/connection.
- Some aggregates in triggers use avg cost from InventoryBatches where quantity > 0; estimation if no batches available defaults to 0 cost.
- The schema is idempotent but if ENUM evolution happens over time, older values persist.

How to bootstrap a tenant session (Node/pg)
- await client.query("SELECT set_tenant_context($1)", [businessId])
- or JS helper in DBfinal.js: await setTenantContext(client, businessId)

Contact Areas
- Usage Events system is central to new features. Confirm business processes around submission and evidence.
- Consider adding materialized views if aggregate queries become heavy.
- Add background jobs to roll IngredientUsageEstimations into actual deductions if/when business confirms.
