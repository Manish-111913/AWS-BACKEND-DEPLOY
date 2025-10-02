
const express = require('express');
const { pool } = require('../config/database');
const { calculateBulkGrossProfit } = require('../utils/costCalculator');
const router = express.Router();

// Helper: get business id from headers/query with default
function getBusinessId(req) {
  const val = req.headers['x-tenant-id'] || req.headers['X-Tenant-Id'] ||
              req.headers['x-business-id'] || req.headers['X-Business-Id'] ||
              req.query.tenant || req.query.businessId || '1';
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

// 📈 Summary Comparison (Current vs Previous Period or Date)
router.get('/summary-comparison', async (req, res) => {
  try {
    const { period, date } = req.query;
    let currentWhere = '';
    let previousWhere = '';
    if (date) {
      currentWhere = `WHERE DATE(transaction_date) = '${date}'`;
      previousWhere = `WHERE DATE(transaction_date) = '${date}'::date - INTERVAL '1 day'`;
    } else if (period === 'week') {
      currentWhere = `WHERE transaction_date >= NOW()::date - INTERVAL '7 days'`;
      previousWhere = `WHERE transaction_date >= NOW()::date - INTERVAL '14 days' AND transaction_date < NOW()::date - INTERVAL '7 days'`;
    } else if (period === 'month') {
      currentWhere = `WHERE transaction_date >= date_trunc('month', NOW()::date)`;
      previousWhere = `WHERE transaction_date >= date_trunc('month', NOW()::date) - INTERVAL '1 month' AND transaction_date < date_trunc('month', NOW()::date)`;
    } else if (period === 'year') {
      currentWhere = `WHERE transaction_date >= date_trunc('year', NOW()::date)`;
      previousWhere = `WHERE transaction_date >= date_trunc('year', NOW()::date) - INTERVAL '1 year' AND transaction_date < date_trunc('year', NOW()::date)`;
    } else {
      // Default to week
      currentWhere = `WHERE transaction_date >= NOW()::date - INTERVAL '7 days'`;
      previousWhere = `WHERE transaction_date >= NOW()::date - INTERVAL '14 days' AND transaction_date < NOW()::date - INTERVAL '7 days'`;
    }

    const query = (where) => `
      SELECT 
        COALESCE(SUM(total_amount), 0) AS total_sales,
        COUNT(*) AS total_orders,
        COALESCE(SUM(total_amount) * 0.3, 0) AS gross_profit,
        COALESCE(ROUND(AVG(total_amount), 2), 0) AS avg_order_value
      FROM salestransactions
      ${where};
    `;

    const [currentResult, previousResult] = await Promise.all([
      pool.query(query(currentWhere)),
      pool.query(query(previousWhere))
    ]);
    const current = currentResult.rows[0];
    const previous = previousResult.rows[0];

    // Calculate percentage change
    function percentChange(curr, prev) {
      if (Number(prev) === 0) return curr > 0 ? 100 : 0;
      return (((curr - prev) / Math.abs(prev)) * 100).toFixed(1);
    }

    res.json({
      total_sales: {
        current: Number(current.total_sales),
        previous: Number(previous.total_sales),
        percent: percentChange(current.total_sales, previous.total_sales)
      },
      total_orders: {
        current: Number(current.total_orders),
        previous: Number(previous.total_orders),
        percent: percentChange(current.total_orders, previous.total_orders)
      },
      gross_profit: {
        current: Number(current.gross_profit),
        previous: Number(previous.gross_profit),
        percent: percentChange(current.gross_profit, previous.gross_profit)
      },
      avg_order_value: {
        current: Number(current.avg_order_value),
        previous: Number(previous.avg_order_value),
        percent: percentChange(current.avg_order_value, previous.avg_order_value)
      }
    });
  } catch (err) {
    console.error('Error fetching summary comparison:', err);
    res.status(500).json({ error: 'Failed to fetch summary comparison' });
  }
});


// 🥧 Item Sales & Gross Profit Pie Data for a Specific Date
router.get('/items-by-date', async (req, res) => {
  try {
    const { date } = req.query;
    if (!date) {
      return res.status(400).json({ error: 'Missing date parameter (YYYY-MM-DD)' });
    }
    const query = `
      SELECT 
        m.name AS item_name,
        SUM(sli.quantity_sold) AS total_qty,
        SUM(sli.quantity_sold * sli.unit_price)::numeric(12,2) AS total_sales,
        (SUM(sli.quantity_sold * sli.unit_price) * 0.3)::numeric(12,2) AS gross_profit
      FROM salelineitems sli
      JOIN menuitems m ON sli.menu_item_id = m.menu_item_id
      JOIN salestransactions st ON sli.sale_id = st.sale_id
      WHERE DATE(st.transaction_date) = $1
      GROUP BY m.name
      ORDER BY total_sales DESC;
    `;
    const result = await pool.query(query, [date]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching items by date:', err);
    res.status(500).json({ error: 'Failed to fetch items by date' });
  }
});

// 📊 Sales Summary (Total Sales, Orders, Gross Profit, Avg Order Value, supports date)
router.get('/summary', async (req, res) => {
  try {
    const { period, date } = req.query;
    let where = '';
    if (date) {
      where = `WHERE DATE(st.transaction_date) = '${date}'`;
    } else if (period === 'week') {
      where = `WHERE st.transaction_date >= NOW()::date - INTERVAL '7 days'`;
    } else if (period === 'month') {
      where = `WHERE st.transaction_date >= date_trunc('month', NOW()::date)`;
    } else if (period === 'year') {
      where = `WHERE st.transaction_date >= date_trunc('year', NOW()::date)`;
    }
    
    // Get basic sales summary first
    const basicQuery = `
      SELECT 
        COALESCE(SUM(total_amount), 0) AS total_sales,
        COUNT(*) AS total_orders,
        COALESCE(ROUND(AVG(total_amount), 2), 0) AS avg_order_value
      FROM salestransactions st
      ${where};
    `;
    const basicResult = await pool.query(basicQuery);
    
    // Get detailed sales data to calculate accurate gross profit
    const detailedQuery = `
      SELECT 
        sli.menu_item_id,
        SUM(sli.quantity_sold) as total_quantity_sold,
        SUM(sli.line_item_amount) as item_revenue,
        mi.name as item_name,
        CAST(mi.price AS DECIMAL(10,2)) as menu_price
      FROM salestransactions st
      JOIN salelineitems sli ON st.sale_id = sli.sale_id
      JOIN menuitems mi ON sli.menu_item_id = mi.menu_item_id
      ${where.replace('st.transaction_date', 'st.transaction_date')}
      GROUP BY sli.menu_item_id, mi.name, mi.price
      HAVING SUM(sli.quantity_sold) > 0
    `;
    
    const detailedResult = await pool.query(detailedQuery);
    
    let totalGrossProfit = 0;
    
    if (detailedResult.rows.length > 0) {
      console.log(`📊 Calculating gross profit for ${detailedResult.rows.length} sold menu items...`);
      
      // Calculate gross profit for each sold menu item
      for (const item of detailedResult.rows) {
        try {
          const { calculateGrossProfit } = require('../utils/costCalculator');
          const grossProfitData = await calculateGrossProfit(
            item.menu_item_id, 
            parseFloat(item.menu_price)
          );
          
          // Multiply by quantity sold to get total gross profit for this item
          const itemTotalGrossProfit = grossProfitData.grossProfit * parseFloat(item.total_quantity_sold);
          totalGrossProfit += itemTotalGrossProfit;
          
          console.log(`💰 ${item.item_name}: ${item.total_quantity_sold} sold × ₹${grossProfitData.grossProfit.toFixed(2)} = ₹${itemTotalGrossProfit.toFixed(2)}`);
          
        } catch (error) {
          console.warn(`⚠️ Could not calculate gross profit for ${item.item_name} (ID: ${item.menu_item_id}):`, error.message);
          // Fallback to simplified calculation if recipe data is missing
          const fallbackGrossProfit = parseFloat(item.item_revenue) * 0.3; // 30% fallback
          totalGrossProfit += fallbackGrossProfit;
        }
      }
      
      console.log(`🧮 Total calculated gross profit: ₹${totalGrossProfit.toFixed(2)}`);
    }
    
    const result = {
      ...basicResult.rows[0],
      gross_profit: totalGrossProfit
    };
    
    res.json(result);
  } catch (err) {
    console.error("Error fetching sales summary:", err);
    res.status(500).json({ error: "Failed to fetch sales summary" });
  }
});

// 💳 Sales by Payment Method
router.get('/payment-methods', async (req, res) => {
  try {
    const { period, date } = req.query;
    let where = '';
    if (date) {
      where = `WHERE DATE(transaction_date) = '${date}'`;
    } 
    else if (period === 'week') {
      where = `WHERE transaction_date >= NOW()::date - INTERVAL '7 days'`;
    } else if (period === 'month') {
      where = `WHERE transaction_date >= date_trunc('month', NOW()::date)`;
    } else if (period === 'year') {
      where = `WHERE transaction_date >= date_trunc('year', NOW()::date)`;
    }
    const query = `
      SELECT 
        payment_method,
        COUNT(*) AS count,
        SUM(total_amount) AS amount
      FROM salestransactions
      ${where}
      GROUP BY payment_method;
    `;
    const result = await pool.query(query);

    const totalAmount = result.rows.reduce((sum, row) => sum + parseFloat(row.amount), 0);

    const formatted = result.rows.map(row => ({
      method: row.payment_method,
      amount: parseFloat(row.amount).toFixed(2),
      percent: totalAmount > 0 ? ((row.amount / totalAmount) * 100).toFixed(1) : '0.0'
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Error fetching payment methods:", err);
    res.status(500).json({ error: "Failed to fetch payment methods" });
  }
});

// 📈 Sales Trend
router.get('/trend', async (req, res) => {
  try {
  const { period, year, month } = req.query;
    let result = [];
    if (period === 'week' || !period) {
      // Get current week's Monday and Sunday (local time)
      const today = new Date();
      const dayOfWeek = today.getDay(); // 0 (Sun) - 6 (Sat)
      const monday = new Date(today);
      monday.setHours(0, 0, 0, 0);
      monday.setDate(today.getDate() - ((dayOfWeek + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      // Format dates as local YYYY-MM-DD to avoid UTC offset issues
      const fmt = d => d.toLocaleDateString('en-CA');
      const startDate = fmt(monday);
      const endDate = fmt(sunday);

      console.log('[TREND][WEEK] Start date:', startDate, 'End date:', endDate);

      // Query sales for each day in the week
      const query = `
        SELECT DATE(transaction_date) AS label, SUM(total_amount) AS total_sales
        FROM salestransactions
        WHERE DATE(transaction_date) >= '${startDate}' AND DATE(transaction_date) <= '${endDate}'
        GROUP BY label
        ORDER BY label;
      `;
      const dbResult = await pool.query(query);
      console.log('[TREND][WEEK] Query result:', dbResult.rows);

      // Fill missing days with zero sales (Mon -> Sun)
      result = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const label = fmt(d);
        const found = dbResult.rows.find(r => {
          // r.label may be a Date object or string depending on pg config
          const dbDate = new Date(r.label);
          const dbLabel = dbDate.toLocaleDateString('en-CA');
          return dbLabel === label;
        });
        result.push({ label, total_sales: found ? Number(found.total_sales) : 0 });
      }
    } else if (period === 'month') {
      // Use year and month if provided, else use current
      let y = year ? Number(year) : (new Date()).getFullYear();
      let m = month ? Number(month) : (new Date()).getMonth() + 1;
      let mStr = m < 10 ? `0${m}` : `${m}`;
      const startOfMonth = `${y}-${mStr}-01`;
      // Calculate last day of month
      const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${(m + 1).toString().padStart(2, '0')}-01`;
      const endOfMonth = `('${nextMonth}'::date - INTERVAL '1 day')`;
      const weekQueries = [
        // Week 1: 1-7
        `SELECT 1 as week, COALESCE(SUM(total_amount),0) as total_sales FROM salestransactions WHERE transaction_date::date >= '${startOfMonth}' AND transaction_date::date <= ('${y}-${mStr}-01'::date + INTERVAL '6 days')`,
        // Week 2: 8-14
        `SELECT 2 as week, COALESCE(SUM(total_amount),0) as total_sales FROM salestransactions WHERE transaction_date::date >= ('${y}-${mStr}-01'::date + INTERVAL '7 days') AND transaction_date::date <= ('${y}-${mStr}-01'::date + INTERVAL '13 days')`,
        // Week 3: 15-21
        `SELECT 3 as week, COALESCE(SUM(total_amount),0) as total_sales FROM salestransactions WHERE transaction_date::date >= ('${y}-${mStr}-01'::date + INTERVAL '14 days') AND transaction_date::date <= ('${y}-${mStr}-01'::date + INTERVAL '20 days')`,
        // Week 4: 22-end
        `SELECT 4 as week, COALESCE(SUM(total_amount),0) as total_sales FROM salestransactions WHERE transaction_date::date >= ('${y}-${mStr}-01'::date + INTERVAL '21 days') AND transaction_date::date <= ${endOfMonth}`
      ];
      const dbResults = await Promise.all(weekQueries.map(q => pool.query(q)));
      result = dbResults.map(r => ({ label: r.rows[0]?.week || '', total_sales: Number(r.rows[0]?.total_sales || 0) }));
  weekQueries.forEach((q, idx) => console.log(`[TREND][MONTH] Week ${idx + 1} SQL:`, q));
  dbResults.forEach((r, idx) => console.log(`[TREND][MONTH] Week ${idx + 1} Result:`, r.rows));
    } else if (period === 'year') {
      // 12 months in current year
      const query = `
        SELECT TO_CHAR(transaction_date, 'Mon') AS month, EXTRACT(MONTH FROM transaction_date) AS month_num, SUM(total_amount) AS total_sales
        FROM salestransactions
        WHERE transaction_date >= date_trunc('year', NOW()::date)
        GROUP BY month, month_num
        ORDER BY month_num;
      `;
  console.log('[TREND][YEAR] SQL:', query);
      const dbResult = await pool.query(query);
  console.log('[TREND][YEAR] Result:', dbResult.rows);
      // Fill missing months with zero
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const monthMap = {};
      months.forEach(m => { monthMap[m] = 0; });
      dbResult.rows.forEach(r => { monthMap[r.month] = Number(r.total_sales); });
      result = months.map(m => ({ label: m, total_sales: monthMap[m] }));
    }
    res.json(result);
  } catch (err) {
    console.error('Error fetching sales trend:', err);
    res.status(500).json({ error: 'Failed to fetch sales trend' });
  }
});

// 🥇 Top Items by Revenue (with Images, filtered by period or date)
router.get('/top-items', async (req, res) => {
  try {
    const { period, date } = req.query;
    let where = '';
    if (date) {
      where = `WHERE DATE(st.transaction_date) = '${date}'`;
    } else if (period === 'week') {
      where = `WHERE st.transaction_date >= NOW()::date - INTERVAL '7 days'`;
    } else if (period === 'month') {
      where = `WHERE st.transaction_date >= date_trunc('month', NOW()::date)`;
    } else if (period === 'year') {
      where = `WHERE st.transaction_date >= date_trunc('year', NOW()::date)`;
    }
    const query = `
      SELECT 
          m.menu_item_id,
          m.name AS item_name,
          m.image_url,
          SUM(sli.quantity_sold) AS total_qty,
          SUM(sli.quantity_sold * sli.unit_price)::numeric(12,2) AS total_revenue,
          (SUM(sli.quantity_sold * sli.unit_price) * 0.3)::numeric(12,2) AS gross_profit
      FROM salelineitems sli
      JOIN menuitems m ON sli.menu_item_id = m.menu_item_id
      JOIN salestransactions st ON sli.sale_id = st.sale_id
      ${where}
      GROUP BY m.menu_item_id, m.name, m.image_url
      ORDER BY total_revenue DESC
      LIMIT 10;
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching top items:', err);
    res.status(500).json({ error: 'Failed to fetch top items' });
  }
});
// 🧾 Key Analysis
router.get('/key-analysis', async (req, res) => {
  try {

    const { period, date } = req.query;
    let where = '';
    if (date) {
      where = `WHERE DATE(transaction_date) = '${date}'`;
    } else if (period === 'week') {
      where = `WHERE transaction_date >= NOW()::date - INTERVAL '7 days'`;
    } else if (period === 'month') {
      where = `WHERE transaction_date >= date_trunc('month', NOW()::date)`;
    } else if (period === 'year') {
      where = `WHERE transaction_date >= date_trunc('year', NOW()::date)`;
    }

    // Best revenue day
    const bestDay = await pool.query(`
      SELECT TO_CHAR(transaction_date, 'Day') AS day,
             SUM(total_amount) AS revenue
      FROM salestransactions
      ${where}
      GROUP BY day
      ORDER BY revenue DESC
      LIMIT 1;
    `);

    // Profit & total revenue
    const profit = await pool.query(`
      SELECT 
        COALESCE(SUM(total_amount), 0) * 0.3 AS profit_margin,  -- assume 30% margin
        COALESCE(SUM(total_amount), 0) AS total_revenue
      FROM salestransactions
      ${where};
    `);

    // 📊 Revenue Growth (Current 7 days vs Previous 7 days)
    let revenueGrowth;
    if (period === 'week') {
      revenueGrowth = await pool.query(`
        WITH current AS (
          SELECT COALESCE(SUM(total_amount), 0) AS revenue
          FROM salestransactions
          WHERE transaction_date >= NOW()::date - INTERVAL '7 days'
        ),
        previous AS (
          SELECT COALESCE(SUM(total_amount), 0) AS revenue
          FROM salestransactions
          WHERE transaction_date >= NOW()::date - INTERVAL '14 days'
            AND transaction_date < NOW()::date - INTERVAL '7 days'
        )
        SELECT 
          current.revenue AS current_revenue,
          previous.revenue AS previous_revenue,
          CASE 
            WHEN previous.revenue = 0 THEN 0
            ELSE ROUND(((current.revenue - previous.revenue) / previous.revenue) * 100, 1)
          END AS growth_percent
        FROM current, previous;
      `);
    } else if (period === 'month') {
      revenueGrowth = await pool.query(`
        WITH current AS (
          SELECT COALESCE(SUM(total_amount), 0) AS revenue
          FROM salestransactions
          WHERE transaction_date >= date_trunc('month', NOW()::date)
        ),
        previous AS (
          SELECT COALESCE(SUM(total_amount), 0) AS revenue
          FROM salestransactions
          WHERE transaction_date >= date_trunc('month', NOW()::date) - INTERVAL '1 month'
            AND transaction_date < date_trunc('month', NOW()::date)
        )
        SELECT 
          current.revenue AS current_revenue,
          previous.revenue AS previous_revenue,
          CASE 
            WHEN previous.revenue = 0 THEN 0
            ELSE ROUND(((current.revenue - previous.revenue) / previous.revenue) * 100, 1)
          END AS growth_percent
        FROM current, previous;
      `);
    } else if (period === 'year') {
      revenueGrowth = await pool.query(`
        WITH current AS (
          SELECT COALESCE(SUM(total_amount), 0) AS revenue
          FROM salestransactions
          WHERE transaction_date >= date_trunc('year', NOW()::date)
        ),
        previous AS (
          SELECT COALESCE(SUM(total_amount), 0) AS revenue
          FROM salestransactions
          WHERE transaction_date >= date_trunc('year', NOW()::date) - INTERVAL '1 year'
            AND transaction_date < date_trunc('year', NOW()::date)
        )
        SELECT 
          current.revenue AS current_revenue,
          previous.revenue AS previous_revenue,
          CASE 
            WHEN previous.revenue = 0 THEN 0
            ELSE ROUND(((current.revenue - previous.revenue) / previous.revenue) * 100, 1)
          END AS growth_percent
        FROM current, previous;
      `);
    } else {
      // Default: week
      revenueGrowth = await pool.query(`
        WITH current AS (
          SELECT COALESCE(SUM(total_amount), 0) AS revenue
          FROM salestransactions
          WHERE transaction_date >= NOW()::date - INTERVAL '7 days'
        ),
        previous AS (
          SELECT COALESCE(SUM(total_amount), 0) AS revenue
          FROM salestransactions
          WHERE transaction_date >= NOW()::date - INTERVAL '14 days'
            AND transaction_date < NOW()::date - INTERVAL '7 days'
        )
        SELECT 
          current.revenue AS current_revenue,
          previous.revenue AS previous_revenue,
          CASE 
            WHEN previous.revenue = 0 THEN 0
            ELSE ROUND(((current.revenue - previous.revenue) / previous.revenue) * 100, 1)
          END AS growth_percent
        FROM current, previous;
      `);
    }

    // 🔹 Top payment method query
    const topPayment = await pool.query(`
      SELECT payment_method, COUNT(*) * 100.0 / SUM(COUNT(*)) OVER() AS percent
      FROM salestransactions
      ${where}
      GROUP BY payment_method
      ORDER BY percent DESC
      LIMIT 1;
    `);

    // ✅ Construct response with fallbacks
    res.json({
      best_day: bestDay.rows[0]?.day?.trim() || "N/A",
      best_day_revenue: Number(bestDay.rows[0]?.revenue) || 0,

      top_payment_method: topPayment.rows[0]?.payment_method || "N/A",
      top_payment_percent: Number(topPayment.rows[0]?.percent)?.toFixed(1) || 0,

      profit_margin: Number(profit.rows[0]?.profit_margin) || 0,
      total_revenue: Number(profit.rows[0]?.total_revenue) || 0,

      gross_profit_percent: profit.rows[0]?.total_revenue > 0 
          ? ((profit.rows[0].profit_margin / profit.rows[0].total_revenue) * 100).toFixed(1)
          : 0,

      revenue_growth_percent: revenueGrowth.rows[0]?.growth_percent || 0
    });

  } catch (err) {
    console.error("Error fetching key analysis:", err);
    res.status(500).json({ error: "Failed to fetch key analysis" });
  }
});


module.exports = router;

// ===== QR Billing – Real-time Sales & Inventory Usage Reports (tenant-safe) =====
// Today overview: orders, items, revenue and category breakdown from QR Orders
router.get('/qr/today-overview', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const status = (req.query.status || 'COMPLETED').toUpperCase();
    const includeUnpaid = ['1','true','yes'].includes(String(req.query.includeUnpaid || '').toLowerCase());

    // Enforce tenant context (RLS)
    await pool.query("SELECT set_config('app.current_business_id', $1, false)", [businessId]);

    const whereClauses = [
      'o.business_id = $1',
      'DATE(o.placed_at) = CURRENT_DATE'
    ];

    // Status filter – default COMPLETED (kitchen done). Allow ALL via status=ANY
    if (status !== 'ANY') {
      // Accept either a single valid enum or a comma list; validate against allowlist
      const allowed = new Set(['PLACED','IN_PROGRESS','READY','COMPLETED','DELAYED']);
      const statuses = status.split(',').map(s => s.trim()).filter(s => s && allowed.has(s));
      if (statuses.length === 1) {
        whereClauses.push(`o.status = '${statuses[0]}'`);
      } else if (statuses.length > 1) {
        whereClauses.push(`o.status = ANY(ARRAY[${statuses.map(s => `'${s}'`).join(',')}])`);
      }
    }

    // Payment filter – default only paid
    if (!includeUnpaid) {
      whereClauses.push(`o.payment_status = 'paid'`);
    }

    const baseJoin = `
      FROM Orders o
      JOIN OrderItems oi ON oi.order_id = o.order_id
      JOIN MenuItems mi ON mi.menu_item_id = oi.menu_item_id
      LEFT JOIN MenuCategories mc ON mi.category_id = mc.category_id
      WHERE ${whereClauses.join(' AND ')}
    `;

    const [summary, byCategory, topItems] = await Promise.all([
      pool.query(
        `SELECT 
           COUNT(DISTINCT o.order_id) AS total_orders,
           COUNT(oi.order_item_id)    AS total_items,
           COALESCE(SUM(mi.price),0)  AS total_revenue
         ${baseJoin}`,
        [businessId]
      ),
      pool.query(
        `SELECT COALESCE(mc.name,'Other') AS category,
                COUNT(oi.order_item_id)    AS items,
                COALESCE(SUM(mi.price),0)  AS revenue
         ${baseJoin}
         GROUP BY COALESCE(mc.name,'Other')
         ORDER BY revenue DESC`,
        [businessId]
      ),
      pool.query(
        `SELECT mi.menu_item_id,
                mi.name AS item_name,
                COUNT(oi.order_item_id) AS qty,
                COALESCE(SUM(mi.price),0) AS revenue
         ${baseJoin}
         GROUP BY mi.menu_item_id, mi.name
         ORDER BY qty DESC, revenue DESC
         LIMIT 10`,
        [businessId]
      )
    ]);

    const row = summary.rows[0] || { total_orders: 0, total_items: 0, total_revenue: 0 };
    return res.json({
      success: true,
      business_id: businessId,
      date: new Date().toISOString().slice(0,10),
      totals: {
        orders: Number(row.total_orders) || 0,
        items: Number(row.total_items) || 0,
        revenue: Number(row.total_revenue) || 0
      },
      by_category: byCategory.rows.map(r => ({
        category: r.category,
        items: Number(r.items) || 0,
        revenue: Number(r.revenue) || 0
      })),
      top_items: topItems.rows.map(r => ({
        menu_item_id: r.menu_item_id,
        name: r.item_name,
        qty: Number(r.qty) || 0,
        revenue: Number(r.revenue) || 0
      }))
    });
  } catch (err) {
    console.error('Error in QR today-overview:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch QR today overview' });
  }
});

// Ingredients usage: summarizes inventory consumption implied by today's QR orders (recipes)
router.get('/qr/ingredients-usage', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const status = (req.query.status || 'COMPLETED').toUpperCase();
    const includeUnpaid = ['1','true','yes'].includes(String(req.query.includeUnpaid || '').toLowerCase());

    await pool.query("SELECT set_config('app.current_business_id', $1, false)", [businessId]);

    const whereClauses = [
      'o.business_id = $1',
      'DATE(o.placed_at) = CURRENT_DATE'
    ];
    if (status !== 'ANY') {
      const allowed = new Set(['PLACED','IN_PROGRESS','READY','COMPLETED','DELAYED']);
      const statuses = status.split(',').map(s => s.trim()).filter(s => s && allowed.has(s));
      if (statuses.length === 1) {
        whereClauses.push(`o.status = '${statuses[0]}'`);
      } else if (statuses.length > 1) {
        whereClauses.push(`o.status = ANY(ARRAY[${statuses.map(s => `'${s}'`).join(',')}])`);
      }
    }
    if (!includeUnpaid) {
      whereClauses.push(`o.payment_status = 'paid'`);
    }

    const result = await pool.query(
      `SELECT 
         ii.item_id,
         ii.name AS ingredient_name,
         gu.unit_name,
         SUM(ri.quantity) AS total_quantity
       FROM Orders o
       JOIN OrderItems oi ON oi.order_id = o.order_id
       JOIN Recipes r ON r.recipe_id = oi.menu_item_id
       JOIN RecipeIngredients ri ON ri.recipe_id = r.recipe_id
       JOIN InventoryItems ii ON ii.item_id = ri.item_id AND ii.business_id = o.business_id
       JOIN GlobalUnits gu ON gu.unit_id = ri.unit_id
       WHERE ${whereClauses.join(' AND ')}
       GROUP BY ii.item_id, ii.name, gu.unit_name
       ORDER BY ii.name ASC`,
      [businessId]
    );

    return res.json({
      success: true,
      business_id: businessId,
      date: new Date().toISOString().slice(0,10),
      usage: result.rows.map(r => ({
        item_id: r.item_id,
        name: r.ingredient_name,
        unit: r.unit_name,
        quantity: Number(r.total_quantity) || 0
      }))
    });
  } catch (err) {
    console.error('Error in QR ingredients-usage:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch QR ingredients usage' });
  }
});

// Top items (today) – QR Orders only
router.get('/qr/top-items', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const limit = Math.max(1, Math.min(parseInt(req.query.limit || '10', 10), 50));
    const status = (req.query.status || 'COMPLETED').toUpperCase();
    const includeUnpaid = ['1','true','yes'].includes(String(req.query.includeUnpaid || '').toLowerCase());

    await pool.query("SELECT set_config('app.current_business_id', $1, false)", [businessId]);

    const whereClauses = [
      'o.business_id = $1',
      'DATE(o.placed_at) = CURRENT_DATE'
    ];
    if (status !== 'ANY') {
      const allowed = new Set(['PLACED','IN_PROGRESS','READY','COMPLETED','DELAYED']);
      const statuses = status.split(',').map(s => s.trim()).filter(s => s && allowed.has(s));
      if (statuses.length === 1) {
        whereClauses.push(`o.status = '${statuses[0]}'`);
      } else if (statuses.length > 1) {
        whereClauses.push(`o.status = ANY(ARRAY[${statuses.map(s => `'${s}'`).join(',')}])`);
      }
    }
    if (!includeUnpaid) {
      whereClauses.push(`o.payment_status = 'paid'`);
    }

    const result = await pool.query(
      `SELECT mi.menu_item_id,
              mi.name,
              COALESCE(mi.image_url, '') AS image_url,
              COUNT(oi.order_item_id) AS qty,
              COALESCE(SUM(mi.price),0) AS revenue
       FROM Orders o
       JOIN OrderItems oi ON oi.order_id = o.order_id
       JOIN MenuItems mi ON mi.menu_item_id = oi.menu_item_id
       WHERE ${whereClauses.join(' AND ')}
       GROUP BY mi.menu_item_id, mi.name, mi.image_url
       ORDER BY qty DESC, revenue DESC
       LIMIT ${limit}`,
      [businessId]
    );

    return res.json({
      success: true,
      business_id: businessId,
      date: new Date().toISOString().slice(0,10),
      items: result.rows.map(r => ({
        menu_item_id: r.menu_item_id,
        name: r.name,
        image_url: r.image_url,
        qty: Number(r.qty) || 0,
        revenue: Number(r.revenue) || 0
      }))
    });
  } catch (err) {
    console.error('Error in QR top-items:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch QR top items' });
  }
});
