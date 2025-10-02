const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { buildImageMeta } = require('../utils/imageAugment');
const MinimalStockService = require('../services/MinimalStockService');

// Helper: resolve date range from query (defaults to This Week)
function getDateRange(query) {
  const period = (query.period || 'week').toLowerCase();
  const today = new Date();
  let start = new Date(today);
  let end = new Date(today);

  // Normalize to YYYY-MM-DD
  const fmt = (d) => d.toISOString().slice(0, 10);

  if (period === 'all') {
    // Open-ended range to include all data
    return { start: '1900-01-01', end: '2999-12-31' };
  } else if (period === 'today') {
    // start = end = today
  } else if (period === 'month') {
    start = new Date(today.getFullYear(), today.getMonth(), 1);
  } else if (period === 'year') {
    start = new Date(today.getFullYear(), 0, 1);
  } else if (period === 'custom' && query.start && query.end) {
    start = new Date(query.start);
    end = new Date(query.end);
  } else {
    // week (last 7 days including today)
    start.setDate(today.getDate() - 6);
  }

  return { start: fmt(start), end: fmt(end) };
}

// Header Summary - Total sales overview
router.get('/header-summary', async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const query = `
      WITH sales_total AS (
        SELECT COALESCE(SUM(sli.quantity_sold * sli.unit_price), 0) AS total
        FROM SalesTransactions st
        JOIN SaleLineItems sli ON st.sale_id = sli.sale_id
        WHERE COALESCE(st.transaction_date, st.created_at::date) BETWEEN $1 AND $2
      ), items_count AS (
        SELECT COUNT(DISTINCT sli.menu_item_id) AS cnt
        FROM SaleLineItems sli
        JOIN SalesTransactions st ON sli.sale_id = st.sale_id
        WHERE COALESCE(st.transaction_date, st.created_at::date) BETWEEN $1 AND $2
      )
      SELECT 
        (SELECT cnt FROM items_count) AS "itemsSoldCount",
        (SELECT total FROM sales_total) AS "totalSales",
        (SELECT total FROM sales_total) * 0.3 AS "grossProfit";
    `;
    const result = await pool.query(query, [start, end]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching header summary:", err);
    res.status(500).json({ error: "Failed to fetch header summary" });
  }
});

// Item-wise sales data
router.get('/item-wise-sales', async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    
    // First, let's use a simpler approach that works with the existing schema
    const query = `
      WITH sales_data AS (
        -- Get sales data for the date range
        SELECT 
          mi.menu_item_id,
          mi.name,
          mi.price,
          COALESCE(mi.image_url, '') AS image,
          SUM(sli.quantity_sold) AS total_sold,
          SUM(sli.quantity_sold * sli.unit_price) AS total_revenue
        FROM MenuItems mi
        LEFT JOIN SaleLineItems sli ON mi.menu_item_id = sli.menu_item_id
        LEFT JOIN SalesTransactions st ON sli.sale_id = st.sale_id
        WHERE COALESCE(st.transaction_date, st.created_at::date) BETWEEN $1 AND $2
        GROUP BY mi.menu_item_id, mi.name, mi.price, mi.image_url
      ),
      wastage_data AS (
        -- Get wastage data for the date range
        SELECT 
          sor.item_id AS menu_item_id,
          SUM(sor.quantity) AS total_wastage_units,
          SUM(sor.estimated_cost_impact) AS total_wastage_cost
        FROM StockOutRecords sor
        WHERE sor.item_type = 'MenuItem' 
        AND COALESCE(sor.deducted_date::date, sor.created_at::date) BETWEEN $1 AND $2
        GROUP BY sor.item_id
      ),
      cost_estimates AS (
        -- Calculate estimated costs based on price tiers and any available cost data
        SELECT 
          sd.*,
          -- Use more sophisticated cost estimation
          CASE 
            WHEN sd.price <= 150 THEN sd.price * 0.45  -- Street food style
            WHEN sd.price <= 250 THEN sd.price * 0.52  -- Medium complexity
            WHEN sd.price <= 350 THEN sd.price * 0.58  -- Complex dishes
            WHEN sd.price <= 450 THEN sd.price * 0.62  -- Premium items
            ELSE sd.price * 0.67                       -- Luxury items
          END AS estimated_cost_per_unit
        FROM sales_data sd
      )
      SELECT 
        ce.menu_item_id,
        ce.name,
        ce.price,
        ce.image,
        ce.estimated_cost_per_unit,
        COALESCE(ce.total_sold, 0) AS sold,
        COALESCE(ce.total_revenue, 0) AS total_sales,
        COALESCE(wd.total_wastage_units, 0) AS wastage_plates,
        COALESCE(wd.total_wastage_cost, 0) AS wastage_value,
        -- Calculate gross profit using estimated costs
        COALESCE(ce.total_revenue - (ce.total_sold * ce.estimated_cost_per_unit), 0) AS gross_profit_amount,
        -- Calculate gross profit percentage
        CASE 
          WHEN ce.total_revenue > 0 
          THEN ((ce.total_revenue - (ce.total_sold * ce.estimated_cost_per_unit)) / ce.total_revenue) * 100
          ELSE 0
        END AS gross_profit_percentage
      FROM cost_estimates ce
      LEFT JOIN wastage_data wd ON ce.menu_item_id = wd.menu_item_id
      WHERE COALESCE(ce.total_sold, 0) > 0  -- Only show items that have been sold
      ORDER BY gross_profit_amount DESC;
    `;
    
    const result = await pool.query(query, [start, end]);

    // Base URL for absolute image paths
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    // Format the data for frontend with robust image handling
    const formattedData = result.rows.map(row => {
      const grossProfitAmount = Number(row.gross_profit_amount) || 0;
      const grossProfitPercentage = Number(row.gross_profit_percentage) || 0;

      // Build image metadata using the unified augmentation utility
      const meta = buildImageMeta({ name: row.name, image_url: row.image }, baseUrl, { enableGridFs: true });
      const primaryImage = meta.img || meta.fallback_img || row.image || meta.placeholder_img;

      return {
        name: row.name,
        price: `₹${Number(row.price).toFixed(2)}`,
        image: primaryImage, // keep existing field for backward compatibility
        sold: `${Number(row.sold)} sold`,
        wastage: `Wastage: ${Number(row.wastage_plates)} Plates (₹${Number(row.wastage_value).toFixed(0)})`,
        grossProfit: `₹${grossProfitAmount.toFixed(0)}`,
        change: `↑${grossProfitPercentage.toFixed(1)}%`,
        // expose full image meta for enhanced UIs
        img: meta.img,
        fallback_img: meta.fallback_img,
        fallbacks: meta.fallbacks,
        placeholder_img: meta.placeholder_img,
      };
    });
    
    res.json(formattedData);
  } catch (err) {
    console.error("Error fetching item-wise sales:", err);
    res.status(500).json({ error: "Failed to fetch item-wise sales" });
  }
});

// Raw material stock data
router.get('/raw-material-stock', async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    // Multi-tenant: try to respect the same business scoping approach used elsewhere
    const bizHeader = req.headers['x-tenant-id'] || req.headers['x-business-id'] || req.query.businessId || req.query.tenant || '1';
    const businessId = parseInt(bizHeader, 10) || 1;
    try { await pool.query("SELECT set_config('app.current_business_id', $1, true)", [String(businessId)]); } catch (_) {}
    /*
      New Semantics:
        before_qty: quantity in stock at the START of the selected period (snapshot as of start - 1 second)
        deducted_qty: ideal consumption derived from sales during the period by expanding recipes
                      (sales quantity * recipe ingredient quantity). If an item has no recipe-driven
                      consumption, fallback to StockOut usage (Usage) within the period.
        after_qty:  before_qty - deducted_qty (never below 0)
      Notes:
        - We DO NOT incorporate received_qty into the equation per new definition; this endpoint now
          answers: "If I look at what I had at the start and what sales should have consumed, where
          should I stand now?" (Ideal remaining.)
        - Received quantities are exposed for context but not part of after computation now.
    */
    const query = `
      WITH period AS (
        SELECT $1::date AS start_date, $2::date AS end_date
      ),
      -- Snapshot BEFORE: sum of non-expired batch quantities strictly before period start, per tenant
      start_snapshot AS (
        SELECT ii.item_id,
               COALESCE(SUM(CASE WHEN ib.is_expired IS NOT TRUE THEN ib.quantity ELSE 0 END),0) AS before_qty
        FROM InventoryItems ii
        LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id
        LEFT JOIN period p ON TRUE
        WHERE ii.business_id = $3
          AND (
            ib.batch_id IS NULL OR 
            (COALESCE(ib.received_date::date, ib.created_at::date) < p.start_date)
          )
        GROUP BY ii.item_id
      ),
      -- Actual usage from StockOut (Usage) within the period, in inventory standard units
      stockout_usage AS (
        SELECT sor.item_id AS inventory_item_id,
               SUM(
                 sor.quantity * COALESCE(
                   (
                     SELECT bc.conversion_factor
                     FROM BusinessUnitConversions bc
                     JOIN InventoryItems ii ON ii.item_id = sor.item_id AND ii.business_id = $3
                     WHERE bc.business_id = $3
                       AND bc.from_unit_id = sor.unit_id
                       AND bc.to_unit_id = ii.standard_unit_id
                     LIMIT 1
                   ),
                   CASE 
                     WHEN sor.unit_id = (SELECT ii2.standard_unit_id FROM InventoryItems ii2 WHERE ii2.item_id = sor.item_id AND ii2.business_id = $3 LIMIT 1)
                     THEN 1
                     ELSE 1 -- fallback if missing conversion
                   END
                 )
               ) AS usage_quantity
        FROM StockOutRecords sor
        JOIN period p ON TRUE
        WHERE sor.item_type = 'InventoryItem'
          AND sor.reason_type = 'Usage'
          AND sor.business_id = $3
          AND COALESCE(sor.deducted_date::date, sor.created_at::date) BETWEEN p.start_date AND p.end_date
        GROUP BY sor.item_id
      ),
      -- Recipe-based estimated consumption from sales, but only for items without StockOut usage to avoid double counting
      sales AS (
        SELECT sli.menu_item_id, SUM(sli.quantity_sold) AS qty_sold
        FROM SaleLineItems sli
        JOIN SalesTransactions st ON st.sale_id = sli.sale_id
        JOIN period p ON TRUE
        WHERE st.business_id = $3
          AND COALESCE(st.transaction_date, st.created_at::date) BETWEEN p.start_date AND p.end_date
        GROUP BY sli.menu_item_id
      ),
      recipe_consumption AS (
        SELECT ri.item_id AS inventory_item_id,
               SUM(
                 ri.quantity * s.qty_sold *
                 COALESCE(
                   -- forward mapping: recipe unit -> standard unit
                   (
                     SELECT bc.conversion_factor
                     FROM BusinessUnitConversions bc
                     WHERE bc.business_id = $3
                       AND bc.from_unit_id = ri.unit_id
                       AND bc.to_unit_id = ii.standard_unit_id
                     LIMIT 1
                   ),
                   -- reverse mapping: standard unit -> recipe unit (invert)
                   (
                     SELECT NULLIF(1.0 / NULLIF(bc2.conversion_factor, 0), 0)
                     FROM BusinessUnitConversions bc2
                     WHERE bc2.business_id = $3
                       AND bc2.from_unit_id = ii.standard_unit_id
                       AND bc2.to_unit_id = ri.unit_id
                     LIMIT 1
                   ),
                   -- same unit or missing conversion: assume 1
                   CASE WHEN ri.unit_id = ii.standard_unit_id THEN 1 ELSE 1 END
                 )
               ) AS ideal_quantity
        FROM RecipeIngredients ri
        JOIN sales s ON s.menu_item_id = ri.recipe_id
        JOIN InventoryItems ii ON ii.item_id = ri.item_id
        WHERE ii.business_id = $3
        GROUP BY ri.item_id
      ),
      combined_consumption AS (
        SELECT su.inventory_item_id AS item_id, su.usage_quantity AS deducted_qty, true AS from_stockout
        FROM stockout_usage su
        UNION ALL
        SELECT rc.inventory_item_id AS item_id, rc.ideal_quantity AS deducted_qty, false AS from_stockout
        FROM recipe_consumption rc
        WHERE rc.inventory_item_id NOT IN (SELECT inventory_item_id FROM stockout_usage)
      ),
      aggregated_consumption AS (
        SELECT item_id, SUM(deducted_qty) AS deducted_qty
        FROM combined_consumption
        GROUP BY item_id
      ),
      -- Current physical stock for context, per tenant
      current_stock AS (
        SELECT ii.item_id,
               COALESCE(ii.current_stock, 0) AS physical_after
        FROM InventoryItems ii
        WHERE ii.business_id = $3
      ),
      received AS (
          SELECT ib.item_id, SUM(ib.quantity) AS received_qty
          FROM InventoryBatches ib
          JOIN InventoryItems ii ON ii.item_id = ib.item_id
          JOIN period p ON TRUE
          WHERE ii.business_id = $3
            AND COALESCE(ib.received_date::date, ib.created_at::date) BETWEEN p.start_date AND p.end_date
          GROUP BY ib.item_id
      )
      SELECT 
        ii.item_id,
        ii.name,
        gu.unit_name AS unit,
        -- Redefined semantics to match UI math and expectations
        -- after_qty reflects current physical stock; before_qty = after_qty + deducted_qty
        (COALESCE(cs.physical_after,0) + COALESCE(ac.deducted_qty,0)) AS before_qty,
        COALESCE(ac.deducted_qty,0) AS deducted_qty,
        COALESCE(cs.physical_after,0) AS after_qty,
        COALESCE(rcv.received_qty,0) AS received_qty,
        COALESCE(cs.physical_after,0) AS physical_current_qty,
        CASE 
          WHEN COALESCE(cs.physical_after,0) <= COALESCE(ii.reorder_point, 0) THEN 'Low Stock'
          WHEN COALESCE(cs.physical_after,0) <= COALESCE(ii.reorder_point, 0) * 1.5 THEN 'Medium Stock'
          ELSE 'Sufficient'
        END AS stock_level
      FROM InventoryItems ii
      LEFT JOIN start_snapshot ss ON ss.item_id = ii.item_id
      LEFT JOIN aggregated_consumption ac ON ac.item_id = ii.item_id
      LEFT JOIN received rcv ON rcv.item_id = ii.item_id
      LEFT JOIN current_stock cs ON cs.item_id = ii.item_id
      LEFT JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
      WHERE ii.business_id = $3
      ORDER BY after_qty ASC;
    `;
    const result = await pool.query(query, [start, end, businessId]);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching raw material stock (new semantics):", err);
    res.status(500).json({ error: "Failed to fetch raw material stock" });
  }
});

// Performance analytics
router.get('/performance-analytics', async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const itemSalesQuery = `
      SELECT 
        mi.name,
        COALESCE(SUM(sli.quantity_sold * sli.unit_price), 0) AS item_sales
      FROM MenuItems mi
      LEFT JOIN SaleLineItems sli ON mi.menu_item_id = sli.menu_item_id
      LEFT JOIN SalesTransactions st ON sli.sale_id = st.sale_id AND COALESCE(st.transaction_date, st.created_at::date) BETWEEN $1 AND $2
      GROUP BY mi.menu_item_id, mi.name
      ORDER BY item_sales DESC;
    `;
    
    const totalSalesQuery = `
      SELECT COALESCE(SUM(sli.quantity_sold * sli.unit_price), 0) AS total_sales
      FROM SalesTransactions st
      JOIN SaleLineItems sli ON st.sale_id = sli.sale_id
      WHERE COALESCE(st.transaction_date, st.created_at::date) BETWEEN $1 AND $2;
    `;

    const [itemResult, totalResult] = await Promise.all([
      pool.query(itemSalesQuery, [start, end]),
      pool.query(totalSalesQuery, [start, end])
    ]);

    const items = itemResult.rows.map(row => ({
      name: row.name,
      value: Number(row.item_sales) || 0
    }));

    const total = Number(totalResult.rows[0]?.total_sales) || 0;

    res.json({
      total,
      items
    });
  } catch (err) {
    console.error("Error fetching performance analytics:", err);
    res.status(500).json({ error: "Failed to fetch performance analytics" });
  }
});

// Raw material consumption
router.get('/raw-material-consumption', async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const query = `
      SELECT 
        ii.name AS ingredient_name,
        COALESCE(SUM(ib.quantity), 0) AS total_stock,
        COALESCE(SUM(sor.quantity), 0) AS total_consumed,
        gu.unit_name AS unit_name
      FROM InventoryItems ii
      LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id
      LEFT JOIN StockOutRecords sor ON ii.item_id = sor.item_id AND sor.item_type = 'InventoryItem' AND COALESCE(sor.deducted_date::date, sor.created_at::date) BETWEEN $1 AND $2
  LEFT JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
  GROUP BY ii.item_id, ii.name, gu.unit_name
      ORDER BY total_consumed DESC;
    `;
    const result = await pool.query(query, [start, end]);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching raw material consumption:", err);
    res.status(500).json({ error: "Failed to fetch raw material consumption" });
  }
});

// Performance summary
router.get('/performance-summary', async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const query = `
      SELECT 
        mi.name AS item,
        COALESCE(SUM(sli.quantity_sold * sli.unit_price), 0) AS sales,
        COALESCE(SUM(sli.quantity_sold * sli.unit_price) * 0.3, 0) AS profit,
        COALESCE(SUM(sor.estimated_cost_impact), 0) AS wastage
      FROM MenuItems mi
      LEFT JOIN SaleLineItems sli ON mi.menu_item_id = sli.menu_item_id
      LEFT JOIN SalesTransactions st ON sli.sale_id = st.sale_id AND COALESCE(st.transaction_date, st.created_at::date) BETWEEN $1 AND $2
      LEFT JOIN StockOutRecords sor ON mi.menu_item_id = sor.item_id AND sor.item_type = 'MenuItem' AND COALESCE(sor.deducted_date::date, sor.created_at::date) BETWEEN $1 AND $2
      GROUP BY mi.menu_item_id, mi.name
      ORDER BY sales DESC;
    `;
    const result = await pool.query(query, [start, end]);
    // Shape numbers as plain numbers; frontend prints the formatting
    const rows = result.rows.map(r => ({
      item: r.item,
      sales: Number(r.sales) || 0,
      profit: Number(r.profit) || 0,
      wastage: Number(r.wastage) || 0,
    }));
    res.json(rows);
  } catch (err) {
    console.error("Error fetching performance summary:", err);
    res.status(500).json({ error: "Failed to fetch performance summary" });
  }
});

// Wastage comparison data
router.get('/wastage-comparison', async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const query = `
      SELECT 
        mi.name AS item_name,
        COALESCE(SUM(sor.estimated_cost_impact), 0) AS wastage_value
      FROM MenuItems mi
      LEFT JOIN StockOutRecords sor ON mi.menu_item_id = sor.item_id AND sor.item_type = 'MenuItem' AND COALESCE(sor.deducted_date::date, sor.created_at::date) BETWEEN $1 AND $2
      GROUP BY mi.menu_item_id, mi.name
      HAVING COALESCE(SUM(sor.estimated_cost_impact), 0) > 0
      ORDER BY wastage_value DESC
      LIMIT 12;
    `;
    const result = await pool.query(query, [start, end]);
    const labels = result.rows.map(r => r.item_name);
    const data = result.rows.map(r => Number(r.wastage_value) || 0);
    res.json({ labels, data });
  } catch (err) {
    console.error("Error fetching wastage comparison:", err);
    res.status(500).json({ error: "Failed to fetch wastage comparison" });
  }
});

// Key insights
router.get('/key-insights', async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    // Multi-tenant scoping (align with other stock endpoints)
    const bizHeader = req.headers['x-tenant-id'] || req.headers['x-business-id'] || req.query.businessId || req.query.tenant || '1';
    const businessId = parseInt(bizHeader, 10) || 1;
    try { await pool.query("SELECT set_config('app.current_business_id', $1, true)", [String(businessId)]); } catch (_) {}
    const topSellingQuery = `
      SELECT mi.name, SUM(sli.quantity_sold) AS total_sold
      FROM MenuItems mi
      JOIN SaleLineItems sli ON mi.menu_item_id = sli.menu_item_id
      JOIN SalesTransactions st ON sli.sale_id = st.sale_id
      WHERE COALESCE(st.transaction_date, st.created_at::date) BETWEEN $1 AND $2
      GROUP BY mi.menu_item_id, mi.name
      ORDER BY total_sold DESC
      LIMIT 1;
    `;
    const wastageQuery = `
      SELECT mi.name, SUM(sor.estimated_cost_impact) AS total_wastage
      FROM MenuItems mi
      JOIN StockOutRecords sor ON mi.menu_item_id = sor.item_id AND sor.item_type = 'MenuItem'
      WHERE COALESCE(sor.deducted_date::date, sor.created_at::date) BETWEEN $1 AND $2
      GROUP BY mi.menu_item_id, mi.name
      ORDER BY total_wastage DESC
      LIMIT 1;
    `;
    // Dashboard low-stock count should mirror Create Reorder logic inputs:
    // - Use InventoryItems.current_stock (authoritative), not batch sums
    // - Scope by business and active items
    // - Threshold: current_stock <= reorder_point (includes 'critical')
    const lowStockCountQuery = `
      SELECT COUNT(*) AS total_items 
      FROM InventoryItems ii
      WHERE ii.business_id = $1 AND ii.is_active = TRUE;
    `;

    const [topSellingResult, wastageResult, totalItemsRes, createReorderItems] = await Promise.all([
      pool.query(topSellingQuery, [start, end]),
      pool.query(wastageQuery, [start, end]),
      pool.query(lowStockCountQuery, [businessId]),
      MinimalStockService.getCreateReorderItems(businessId)
    ]);

    const bestSelling = topSellingResult.rows[0]
      ? { item: topSellingResult.rows[0].name, value: `${topSellingResult.rows[0].total_sold} sold` }
      : { item: '-', value: '0 sold' };

    const mostWasted = wastageResult.rows[0]
      ? { item: wastageResult.rows[0].name, value: `₹${Number(wastageResult.rows[0].total_wastage || 0).toFixed(2)}` }
      : { item: '-', value: '₹0' };

    const totalItems = Number(totalItemsRes.rows[0]?.total_items || 0);
    const lowStock = Array.isArray(createReorderItems) ? createReorderItems.length : 0;
    const accuracy = totalItems > 0 ? (((totalItems - lowStock) / totalItems) * 100).toFixed(1) + '%' : '0%';

    // Prevent caching so dashboard reflects latest count
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');

    res.json({
      bestSelling,
      mostWasted,
      stockAccuracy: accuracy,
      lowStockCount: lowStock
    });
  } catch (err) {
    console.error("Error fetching key insights:", err);
    res.status(500).json({ error: "Failed to fetch key insights" });
  }
});

// Estimated vs Real-time usage (daily grouped bars)
router.get('/estimated-vs-realtime', async (req, res) => {
  try {
    const { start, end } = getDateRange(req.query);
    const period = (req.query.period || 'week').toLowerCase();
    const wantDetails = req.query.details === '1';

    // Special mode: if user selected 'today' we return item-level estimated vs realtime (instead of a single bar)
    const itemLevel = period === 'today';

    // Decide granularity to avoid massive datasets:
    // - For 'all' or very large spans -> monthly aggregation
    // - Otherwise -> daily
    const startDate = new Date(start);
    const endDate = new Date(end);
    const daysSpan = Math.max(1, Math.round((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1);
    const useMonthly = period === 'all' || daysSpan > 180;

    let query;
    if (period === 'month') {
      // Single total for this month: estimated from submitted usage events (production) value
      query = `
        WITH m AS (
          SELECT date_trunc('month', $1::date)::date AS ms,
                 (date_trunc('month', $2::date) + INTERVAL '1 month' - INTERVAL '1 day')::date AS me
        ),
        est AS (
          SELECT SUM(ui.quantity_produced * mi.price) AS estimated
          FROM UsageEvents ue
          JOIN UsageItems ui ON ui.event_id = ue.event_id
          JOIN MenuItems mi ON mi.menu_item_id = ui.dish_id, m
          WHERE ue.status = 'submitted'
            AND ue.production_date BETWEEN m.ms AND m.me
        ),
        rt AS (
          SELECT SUM(sli.quantity_sold * sli.unit_price) AS realtime
          FROM SalesTransactions st
          JOIN SaleLineItems sli ON st.sale_id = sli.sale_id, m
          WHERE COALESCE(st.transaction_date, st.created_at::date) BETWEEN m.ms AND m.me
        )
        SELECT (SELECT ms FROM m) AS date,
               COALESCE((SELECT estimated FROM est),0) AS estimated,
               COALESCE((SELECT realtime FROM rt),0) AS realtime;
      `;
    } else if (useMonthly) {
      // Monthly aggregation based on production_date of submitted usage events
      query = `
        WITH bounds AS (
          SELECT 
            LEAST(
              COALESCE((SELECT MIN(ue.production_date) FROM UsageEvents ue WHERE ue.status='submitted'), '2999-12-31'),
              COALESCE((SELECT MIN(COALESCE(st.transaction_date, st.created_at::date)) FROM SalesTransactions st), '2999-12-31')
            ) AS min_d,
            GREATEST(
              COALESCE((SELECT MAX(ue.production_date) FROM UsageEvents ue WHERE ue.status='submitted'), '1900-01-01'),
              COALESCE((SELECT MAX(COALESCE(st.transaction_date, st.created_at::date)) FROM SalesTransactions st), '1900-01-01')
            ) AS max_d
        ),
        rng AS (
          SELECT 
            GREATEST(date_trunc('month', $1::date), date_trunc('month', bounds.min_d))::date AS s,
            LEAST(date_trunc('month', $2::date), date_trunc('month', bounds.max_d))::date AS e
          FROM bounds
        ),
        months AS (
          SELECT generate_series((SELECT s FROM rng), (SELECT e FROM rng), INTERVAL '1 month')::date AS m
        ),
        est AS (
          SELECT date_trunc('month', ue.production_date)::date AS m,
                 SUM(ui.quantity_produced * mi.price) AS estimated
          FROM UsageEvents ue
          JOIN UsageItems ui ON ui.event_id = ue.event_id
          JOIN MenuItems mi ON mi.menu_item_id = ui.dish_id
          WHERE ue.status = 'submitted'
            AND ue.production_date BETWEEN $1 AND $2
          GROUP BY 1
        ),
        rt AS (
          SELECT date_trunc('month', COALESCE(st.transaction_date, st.created_at::date))::date AS m,
                 SUM(sli.quantity_sold * sli.unit_price) AS realtime
          FROM SalesTransactions st
          JOIN SaleLineItems sli ON st.sale_id = sli.sale_id
          WHERE COALESCE(st.transaction_date, st.created_at::date) BETWEEN $1 AND $2
          GROUP BY 1
        )
        SELECT months.m AS date,
               COALESCE(est.estimated,0) AS estimated,
               COALESCE(rt.realtime,0) AS realtime
        FROM months
        LEFT JOIN est ON est.m = months.m
        LEFT JOIN rt ON rt.m = months.m
        ORDER BY months.m;
      `;
    } else {
      // Daily aggregation
      query = `
        WITH bounds AS (
          SELECT 
            LEAST(
              COALESCE((SELECT MIN(ue.production_date) FROM UsageEvents ue WHERE ue.status='submitted'), '2999-12-31'),
              COALESCE((SELECT MIN(COALESCE(st.transaction_date, st.created_at::date)) FROM SalesTransactions st), '2999-12-31')
            ) AS min_d,
            GREATEST(
              COALESCE((SELECT MAX(ue.production_date) FROM UsageEvents ue WHERE ue.status='submitted'), '1900-01-01'),
              COALESCE((SELECT MAX(COALESCE(st.transaction_date, st.created_at::date)) FROM SalesTransactions st), '1900-01-01')
            ) AS max_d
        ),
        rng AS (
          SELECT 
            GREATEST($1::date, bounds.min_d) AS s,
            LEAST($2::date, bounds.max_d) AS e
          FROM bounds
        ),
        days AS (
          SELECT generate_series((SELECT s FROM rng), (SELECT e FROM rng), INTERVAL '1 day')::date AS d
        ),
        est AS (
          SELECT ue.production_date::date AS d,
                 SUM(ui.quantity_produced * mi.price) AS estimated
          FROM UsageEvents ue
          JOIN UsageItems ui ON ui.event_id = ue.event_id
          JOIN MenuItems mi ON mi.menu_item_id = ui.dish_id
          WHERE ue.status = 'submitted'
            AND ue.production_date BETWEEN $1 AND $2
          GROUP BY 1
        ),
        rt AS (
          SELECT COALESCE(st.transaction_date, st.created_at::date) AS d,
                 SUM(sli.quantity_sold * sli.unit_price) AS realtime
          FROM SalesTransactions st
          JOIN SaleLineItems sli ON st.sale_id = sli.sale_id
          WHERE COALESCE(st.transaction_date, st.created_at::date) BETWEEN $1 AND $2
          GROUP BY 1
        )
        SELECT days.d AS date,
               COALESCE(est.estimated,0) AS estimated,
               COALESCE(rt.realtime,0) AS realtime
        FROM days
        LEFT JOIN est ON est.d = days.d
        LEFT JOIN rt ON rt.d = days.d
        ORDER BY days.d;
      `;
    }

  const result = await pool.query(query, [start, end]);
    const labels = result.rows.map(r => {
      const dt = new Date(r.date);
      return useMonthly ? `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}` : dt.toISOString().slice(0, 10);
    });
    const estimated = result.rows.map(r => Number(r.estimated) || 0);
    const realtime = result.rows.map(r => Number(r.realtime) || 0);

    // Friendly fallback when no data present in either series
    const total = estimated.reduce((a, b) => a + b, 0) + realtime.reduce((a, b) => a + b, 0);
    if (labels.length === 0 || total === 0) {
      return res.json({ labels: [], estimated: [], realtime: [], message: 'No data available for the selected period.' });
    }

    if (itemLevel) {
      // Build per-item aggregation for "today" only
      const itemQuery = `
        WITH sales AS (
          SELECT mi.menu_item_id, mi.name,
                 SUM(sli.quantity_sold * sli.unit_price) AS realtime_value
          FROM SalesTransactions st
          JOIN SaleLineItems sli ON st.sale_id = sli.sale_id
          JOIN MenuItems mi ON mi.menu_item_id = sli.menu_item_id
          WHERE COALESCE(st.transaction_date, st.created_at::date) = $1::date
          GROUP BY mi.menu_item_id, mi.name
        ), prod AS (
          SELECT mi.menu_item_id, mi.name,
                 SUM(ui.quantity_produced * mi.price) AS estimated_value
          FROM UsageEvents ue
          JOIN UsageItems ui ON ui.event_id = ue.event_id
          JOIN MenuItems mi ON mi.menu_item_id = ui.dish_id
          WHERE ue.status='submitted' AND ue.production_date = $1::date
          GROUP BY mi.menu_item_id, mi.name
        ), merged AS (
          SELECT COALESCE(prod.menu_item_id, sales.menu_item_id) AS menu_item_id,
                 COALESCE(prod.name, sales.name) AS name,
                 COALESCE(prod.estimated_value,0) AS estimated_value,
                 COALESCE(sales.realtime_value,0) AS realtime_value
          FROM prod
          FULL OUTER JOIN sales ON prod.menu_item_id = sales.menu_item_id
        )
        SELECT * FROM merged ORDER BY (estimated_value + realtime_value) DESC, name LIMIT 200;`;
      const itemsRes = await pool.query(itemQuery, [start]);
      const itemLabels = itemsRes.rows.map(r => r.name);
      const itemEstimated = itemsRes.rows.map(r => Number(r.estimated_value) || 0);
      const itemRealtime = itemsRes.rows.map(r => Number(r.realtime_value) || 0);
      if (!wantDetails) {
        return res.json({ labels, estimated, realtime, itemLabels, itemEstimated, itemRealtime, mode: 'item-today' });
      }
      // fall through to add breakdown + item arrays
    }

    if (!wantDetails) {
      return res.json({ labels, estimated, realtime });
    }

    // Detailed breakdown: per-day production components
    // (Limit to top 25 value contributors per requested span for brevity)
    const breakdownQuery = `
      WITH prod AS (
        SELECT 
          ue.production_date::date AS d,
          mi.menu_item_id,
          mi.name AS dish_name,
          ui.quantity_produced,
          mi.price,
          (ui.quantity_produced * mi.price) AS value
        FROM UsageEvents ue
        JOIN UsageItems ui ON ui.event_id = ue.event_id
        JOIN MenuItems mi ON mi.menu_item_id = ui.dish_id
        WHERE ue.status = 'submitted'
          AND ue.production_date BETWEEN $1 AND $2
      ), ranked AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY d ORDER BY value DESC) AS rnk FROM prod
      )
      SELECT * FROM ranked WHERE rnk <= 25 ORDER BY d, value DESC;`;
    const breakdownRes = await pool.query(breakdownQuery, [start, end]);
    const dailyMap = {};
    breakdownRes.rows.forEach(r => {
      const day = r.d.toISOString().slice(0,10);
      if (!dailyMap[day]) dailyMap[day] = [];
      dailyMap[day].push({
        itemId: r.menu_item_id,
        dish: r.dish_name,
        qtyProduced: Number(r.quantity_produced) || 0,
        unitPrice: Number(r.price) || 0,
        value: Number(r.value) || 0
      });
    });

    res.json({ labels, estimated, realtime, breakdown: dailyMap, note: 'Estimated = SUM(quantity_produced * menu_item.price) for submitted usage events' });
  } catch (err) {
    console.error('Error fetching estimated vs realtime:', err);
    res.status(500).json({ error: 'Failed to fetch estimated vs realtime' });
  }
});

// Test endpoint to check menu items and their images
router.get('/test-images', async (req, res) => {
  try {
    const query = `
      SELECT menu_item_id, name, image_url 
      FROM MenuItems 
      ORDER BY menu_item_id 
      LIMIT 10;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching test images:", err);
    res.status(500).json({ error: "Failed to fetch test images" });
  }
});

// Debug endpoint to check database schema
router.get('/debug-schema', async (req, res) => {
  try {
    const queries = {
      menuItems: `
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'menuitems' 
        ORDER BY ordinal_position;
      `,
      recipes: `
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'recipes' 
        ORDER BY ordinal_position;
      `,
      inventoryItems: `
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'inventoryitems' 
        ORDER BY ordinal_position;
      `,
      sampleRecipes: `
        SELECT * FROM recipes LIMIT 5;
      `
    };

    const results = {};
    for (const [key, query] of Object.entries(queries)) {
      try {
        const result = await pool.query(query);
        results[key] = result.rows;
      } catch (err) {
        results[key] = { error: err.message };
      }
    }

    res.json(results);
  } catch (err) {
    console.error("Error debugging schema:", err);
    res.status(500).json({ error: "Failed to debug schema" });
  }
});

module.exports = router;
