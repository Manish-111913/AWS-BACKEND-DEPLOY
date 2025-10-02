const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { validateSaleData } = require('../middleware/validation');

// Database connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/**
 * Helper function to deduct ingredients from inventory using FIFO method
 */
async function deductIngredients(client, menuItemId, quantity, businessId) {
  // 1. Get recipe ingredients
  const recipeQuery = `
    SELECT 
      r.item_id as ingredient_item_id,
      r.quantity as quantity_required,
      r.unit_id,
      i.name as item_name
    FROM RecipeIngredients r
    JOIN InventoryItems i ON r.item_id = i.item_id
    WHERE r.recipe_id = $1 AND i.business_id = $2
  `;
  
  const recipeResult = await client.query(recipeQuery, [menuItemId, businessId]);
  
  if (recipeResult.rows.length === 0) {
    throw new Error(`No recipe found for menu item ${menuItemId}`);
  }

  const deductions = [];
  
  // 2. Process each ingredient
  for (const ingredient of recipeResult.rows) {
    const totalRequired = ingredient.quantity_required * quantity;
    let remainingToDeduct = totalRequired;
    
    // 3. Get available batches in FIFO order
    const batchQuery = `
      SELECT 
        batch_id,
        quantity as quantity_remaining,
        unit_cost as cost_price,
        expiry_date
      FROM InventoryBatches
      WHERE item_id = $1 
        AND quantity > 0
      ORDER BY expiry_date ASC NULLS LAST, batch_id ASC
      FOR UPDATE
    `;
    
    const batchesResult = await client.query(batchQuery, [ingredient.ingredient_item_id]);
    
    if (batchesResult.rows.length === 0) {
      throw new Error(`No stock available for ingredient: ${ingredient.item_name}`);
    }

    // 4. Deduct from each batch until requirement is met
    for (const batch of batchesResult.rows) {
      if (remainingToDeduct <= 0) break;
      
      const deductFromBatch = Math.min(remainingToDeduct, batch.quantity_remaining);
      const newQuantity = batch.quantity_remaining - deductFromBatch;
      
      // Update batch quantity
      await client.query(`
        UPDATE InventoryBatches 
        SET quantity = $1
        WHERE batch_id = $2
      `, [
        newQuantity,
        batch.batch_id
      ]);
      
      remainingToDeduct -= deductFromBatch;
      deductions.push({
        ingredientId: ingredient.ingredient_item_id,
        batchId: batch.batch_id,
        deducted: deductFromBatch,
        costPrice: batch.cost_price
      });
    }

    if (remainingToDeduct > 0) {
      throw new Error(`Insufficient stock for ingredient: ${ingredient.item_name}`);
    }

    // 5. Update is_in_stock flag in inventory_items
    await client.query(`
      UPDATE InventoryItems 
      SET is_in_stock = EXISTS (
        SELECT 1
        FROM InventoryBatches
        WHERE item_id = $1 AND quantity > 0
      )
      WHERE item_id = $1
    `, [ingredient.ingredient_item_id]);
  }
  
  return deductions;
}

/**
 * Create a new sale with automatic ingredient deduction
 * POST /sales/create
 */
router.post('/sales/create', validateSaleData, async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { 
      businessId,
      customerId,
      items, // [{ menuItemId, quantity, unitPrice }]
      paymentMethod
    } = req.body;

    // Input validation
    if (!businessId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid input: businessId and items array required'
      });
    }

    await client.query('BEGIN');

    // 1. Create sales transaction 
    const totalAmount = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    
    const saleResult = await client.query(`
      INSERT INTO SalesTransactions (
        business_id,
        transaction_date,
        total_amount,
        payment_method,
        status,
        processed_by_user_id,
        created_at
      ) VALUES ($1, CURRENT_DATE, $2, $3, 'Confirmed', $4, CURRENT_TIMESTAMP)
      RETURNING sale_id
    `, [businessId, totalAmount, paymentMethod || 'Cash', req.user?.user_id]);

    const saleId = saleResult.rows[0].sale_id;
    const ingredientDeductions = [];

    // 3. Process each sales item and deduct inventory
    for (const item of items) {
      const { menuItemId, quantity, unitPrice } = item;
      const subtotal = quantity * unitPrice;

      // Insert sale line item
      await client.query(`
        INSERT INTO SaleLineItems (
          sale_id,
          menu_item_id,
          quantity_sold,
          unit_price,
          line_item_amount
        ) VALUES ($1, $2, $3, $4, $5)
      `, [saleId, menuItemId, quantity, unitPrice, subtotal]);

      // Deduct ingredients from inventory using FIFO
      try {
        const deductions = await deductIngredients(client, menuItemId, quantity, businessId);
        ingredientDeductions.push(...deductions);
      } catch (error) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }
    }

    // 4. Get updated inventory snapshot
    const inventorySnapshot = await client.query(`
      SELECT 
        i.item_id,
        i.name as item_name,
        COALESCE((
          SELECT SUM(b.quantity)
          FROM InventoryBatches b
          WHERE b.item_id = i.item_id AND b.quantity > 0
        ), 0) as current_stock,
        i.standard_unit_id as unit_id,
        CASE 
          WHEN i.is_in_stock = false THEN 'Out of stock'
          WHEN i.reorder_point IS NOT NULL AND (
            SELECT SUM(b.quantity)
            FROM InventoryBatches b
            WHERE b.item_id = i.item_id AND b.quantity > 0
          ) <= i.reorder_point THEN 'Low stock'
          ELSE 'In stock'
        END as stock_status
      FROM InventoryItems i
      WHERE i.business_id = $1
        AND i.item_id IN (
          SELECT DISTINCT r.item_id
          FROM RecipeIngredients r
          WHERE r.recipe_id IN (${items.map(item => item.menuItemId).join(',')})
        )
    `, [businessId]);

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      data: {
        saleId,
        totalAmount,
        items: items.map(item => ({
          menuItemId: item.menuItemId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.quantity * item.unitPrice
        })),
        ingredientDeductions: ingredientDeductions.map(d => ({
          ingredientId: d.ingredientId,
          deducted: d.deducted,
          costImpact: d.deducted * d.costPrice
        })),
        updatedInventory: inventorySnapshot.rows
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating sale:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create sale',
      error: error.message
    });
  } finally {
    client.release();
  }
});

/**
 * Get total sales report with various breakdowns
 * GET /sales/total-report
 */
router.get('/sales/total-report', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { businessId, startDate, endDate, groupBy = 'day' } = req.query;

    if (!businessId || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters: businessId, startDate, endDate'
      });
    }

    // 1. Get total revenue and transaction count
    const totalMetricsQuery = `
      SELECT 
        SUM(total_amount) as total_revenue,
        COUNT(DISTINCT sale_id) as total_transactions
      FROM SalesTransactions
      WHERE business_id = $1
        AND transaction_date BETWEEN $2 AND $3
        AND status = 'Confirmed'
    `;
    
    const totalMetrics = await client.query(totalMetricsQuery, [businessId, startDate, endDate]);

    // 2. Get best-selling items
    const bestSellingQuery = `
      SELECT 
        m.name as item_name,
        SUM(sli.quantity_sold) as total_sold,
        SUM(sli.line_item_amount) as revenue
      FROM SaleLineItems sli
      JOIN SalesTransactions st ON sli.sale_id = st.sale_id
      JOIN MenuItems m ON sli.menu_item_id = m.menu_item_id
      WHERE st.business_id = $1
        AND st.transaction_date BETWEEN $2 AND $3
        AND st.status = 'Confirmed'
      GROUP BY m.menu_item_id, m.name
      ORDER BY total_sold DESC
      LIMIT 10
    `;
    
    const bestSelling = await client.query(bestSellingQuery, [businessId, startDate, endDate]);

    // 3. Get payment method breakdown
    const paymentBreakdownQuery = `
      SELECT 
        payment_method,
        COUNT(*) as transaction_count,
        SUM(total_amount) as total_amount
      FROM SalesTransactions
      WHERE business_id = $1
        AND transaction_date BETWEEN $2 AND $3
        AND status = 'Confirmed'
      GROUP BY payment_method
    `;
    
    const paymentBreakdown = await client.query(paymentBreakdownQuery, [businessId, startDate, endDate]);

    // 4. Get time-based breakdown
    let timeBreakdownQuery = '';
    if (groupBy === 'day') {
      timeBreakdownQuery = `
        SELECT 
          DATE(transaction_date) as date,
          COUNT(*) as transactions,
          SUM(total_amount) as revenue
        FROM SalesTransactions
        WHERE business_id = $1
          AND transaction_date BETWEEN $2 AND $3
          AND status = 'Confirmed'
        GROUP BY DATE(transaction_date)
        ORDER BY date
      `;
    } else if (groupBy === 'week') {
      timeBreakdownQuery = `
        SELECT 
          DATE_TRUNC('week', transaction_date) as week_start,
          COUNT(*) as transactions,
          SUM(total_amount) as revenue
        FROM SalesTransactions
        WHERE business_id = $1
          AND transaction_date BETWEEN $2 AND $3
          AND status = 'Confirmed'
        GROUP BY DATE_TRUNC('week', transaction_date)
        ORDER BY week_start
      `;
    } else {
      timeBreakdownQuery = `
        SELECT 
          DATE_TRUNC('month', transaction_date) as month_start,
          COUNT(*) as transactions,
          SUM(total_amount) as revenue
        FROM SalesTransactions
        WHERE business_id = $1
          AND transaction_date BETWEEN $2 AND $3
          AND status = 'Confirmed'
        GROUP BY DATE_TRUNC('month', transaction_date)
        ORDER BY month_start
      `;
    }
    
    const timeBreakdown = await client.query(timeBreakdownQuery, [businessId, startDate, endDate]);

    // Format and send response
    res.status(200).json({
      success: true,
      data: {
        totalRevenue: totalMetrics.rows[0]?.total_revenue || 0,
        totalTransactions: totalMetrics.rows[0]?.total_transactions || 0,
        bestSellingItems: bestSelling.rows.map(item => ({
          itemName: item.item_name,
          totalSold: parseInt(item.total_sold),
          revenue: parseFloat(item.revenue)
        })),
        paymentBreakdown: paymentBreakdown.rows.map(payment => ({
          method: payment.payment_method,
          transactionCount: parseInt(payment.transaction_count),
          totalAmount: parseFloat(payment.total_amount)
        })),
        timeBreakdown: timeBreakdown.rows.map(period => ({
          period: period.date || period.week_start || period.month_start,
          transactions: parseInt(period.transactions),
          revenue: parseFloat(period.revenue)
        })),
        summary: {
          averageTransactionValue: 
            totalMetrics.rows[0]?.total_revenue / totalMetrics.rows[0]?.total_transactions || 0,
          topSellingItem: bestSelling.rows[0]?.item_name || 'No sales',
          mostUsedPaymentMethod: paymentBreakdown.rows[0]?.payment_method || 'None'
        }
      }
    });

  } catch (error) {
    console.error('Error generating sales report:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate sales report',
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Error handling middleware
router.use((err, req, res, next) => {
  console.error('Route error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: err.message
  });
});

module.exports = router;
