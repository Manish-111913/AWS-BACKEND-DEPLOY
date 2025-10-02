// backend/routes/stockReport.js
router.get('/summary', async (req, res) => {
  try {
    // Example query, adjust to your schema
    const totalSales = await pool.query(`SELECT SUM(total_amount) AS total_sales FROM salestransactions`);
    const grossProfit = await pool.query(`SELECT SUM(total_amount) * 0.3 AS gross_profit FROM salestransactions`);
    // Add more queries for change %, featured item, etc.
    res.json({
      totalSales: totalSales.rows[0].total_sales,
      grossProfit: grossProfit.rows[0].gross_profit,
      // ...other fields
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stock summary" });
  }
});

router.get('/item-wise', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        m.name, 
        m.price, 
        SUM(sli.quantity_sold) AS sold, 
        SUM(sli.wastage) AS wastage, 
        SUM(sli.quantity_sold * sli.unit_price) * 0.3 AS grossProfit,
        m.image_url
      FROM salelineitems sli
      JOIN menuitems m ON sli.menu_item_id = m.menu_item_id
      GROUP BY m.name, m.price, m.image_url
      ORDER BY sold DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch item-wise sales" });
  }
});


router.get('/performance-summary', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        m.name AS item, 
        SUM(sli.quantity_sold * sli.unit_price) AS sales, 
        ROUND(AVG(sli.profit_percent), 2) AS profit, 
        SUM(sli.wastage) AS wastage
      FROM salelineitems sli
      JOIN menuitems m ON sli.menu_item_id = m.menu_item_id
      GROUP BY m.name
      ORDER BY sales DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch performance summary" });
  }
});

router.get('/raw-material-stock', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        name, 
        before_qty, 
        deducted_qty, 
        after_qty, 
        status
      FROM raw_material_stock
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch raw material stock" });
  }
});



router.get('/performance-analytics', async (req, res) => {
  // Compose your analytics logic here
  res.json({
    total: 18200,
    items: [
      { name: 'Mysore Bhajji', value: 20, color: '#4299e1' },
      // ...
    ]
  });
});

router.get('/raw-material-consumption', async (req, res) => {
  // Compose your consumption logic here
  res.json([
    { name: 'Maida', value: '10 kg', consumption: 40 },
    // ...
  ]);
});

router.get('/key-insights', async (req, res) => {
  // Compose your insights logic here
  res.json({
    bestSelling: { item: 'Masala Bhaji', value: '₹2,480' },
    mostWasted: { item: 'Masala Bhajji', value: '(₹100)' },
    stockAccuracy: '96.2%'
  });
});