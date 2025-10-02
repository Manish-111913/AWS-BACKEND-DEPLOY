const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { removeVendor, planVendorRemoval, toBool } = require('../services/vendorRemoval');

// Local utility: insert a notification with basic duplicate suppression (24h window)
async function insertNotification(client, {
  businessId,
  userId,
  type,
  title,
  description,
  relatedUrl
}) {
  const dupe = await client.query(
    `SELECT notification_id FROM UserNotifications
     WHERE business_id = $1 AND user_id = $2 AND type = $3 AND title = $4
       AND created_at >= NOW() - INTERVAL '24 hours'
     LIMIT 1`,
    [businessId, userId, type, title]
  );
  if (dupe.rows.length) return { skipped: true, notificationId: dupe.rows[0].notification_id };
  const res = await client.query(
    `INSERT INTO UserNotifications (business_id, user_id, type, title, description, related_url, is_read)
     VALUES ($1, $2, $3, $4, $5, $6, false)
     RETURNING notification_id`,
    [businessId, userId, type, title, description, relatedUrl || null]
  );
  return { skipped: false, notificationId: res.rows[0].notification_id };
}

// =================== VENDOR PERFORMANCE & LEAD TIME TRACKING ===================

// Calculate and update vendor performance metrics
const updateVendorPerformance = async (vendorId, businessId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Fetch previous metrics for comparison
    const prevRow = await client.query(
      `SELECT name, on_time_delivery_rate, average_rating FROM Vendors WHERE vendor_id = $1 AND business_id = $2 LIMIT 1`,
      [vendorId, businessId]
    );
    const vendorName = prevRow.rows[0]?.name || `Vendor ${vendorId}`;
    const prevOnTimeRate = prevRow.rows[0]?.on_time_delivery_rate != null ? Number(prevRow.rows[0].on_time_delivery_rate) : null;
    const prevAvgRating = prevRow.rows[0]?.average_rating != null ? Number(prevRow.rows[0].average_rating) : null;
    
    // Calculate on-time delivery rate
    const onTimeResult = await pool.query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(CASE WHEN sir.received_date <= po.expected_delivery_date THEN 1 END) as on_time_orders
      FROM PurchaseOrders po
      JOIN StockInRecords sir ON po.vendor_id = sir.vendor_id
      WHERE po.vendor_id = $1 AND po.business_id = $2 
        AND po.status = 'Received'
        AND po.created_at >= CURRENT_DATE - INTERVAL '6 months'
    `, [vendorId, businessId]);
    
    const { total_orders, on_time_orders } = onTimeResult.rows[0];
    const onTimeRate = total_orders > 0 ? (on_time_orders / total_orders) * 100 : 0;
    
    // Calculate average rating
    const ratingResult = await pool.query(`
      SELECT AVG(rating) as avg_rating, COUNT(*) as rating_count
      FROM VendorRatings 
      WHERE vendor_id = $1
    `, [vendorId]);
    
    const { avg_rating, rating_count } = ratingResult.rows[0];
    const averageRating = rating_count > 0 ? parseFloat(avg_rating) : 0;
    
    // Update vendor with calculated metrics
    await pool.query(`
      UPDATE Vendors 
      SET 
        on_time_delivery_rate = $2,
        average_rating = $3,
        total_orders = $4,
        last_ordered_at = (
          SELECT MAX(sir.received_date) 
          FROM StockInRecords sir 
          WHERE sir.vendor_id = $1
        ),
        updated_at = NOW()
      WHERE vendor_id = $1
    `, [vendorId, onTimeRate, averageRating, total_orders]);
    
    await client.query('COMMIT');
    
    console.log(`📊 Vendor ${vendorId} performance updated: ${onTimeRate.toFixed(1)}% on-time, ${averageRating.toFixed(1)} rating`);
    
    return {
      vendorId,
      vendorName,
      onTimeRate,
      averageRating,
      totalOrders: total_orders,
      prevOnTimeRate,
      prevAvgRating
    };
    
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

// Calculate lead time statistics for vendor-item combinations
const calculateVendorLeadTimes = async (vendorId, businessId) => {
  const client = await pool.connect();
  try {
    const leadTimeStats = await pool.query(`
      SELECT 
        poli.item_id,
        ii.name as item_name,
        AVG(EXTRACT(DAY FROM (sir.received_date - po.order_date))) as avg_lead_time_days,
        MIN(EXTRACT(DAY FROM (sir.received_date - po.order_date))) as min_lead_time,
        MAX(EXTRACT(DAY FROM (sir.received_date - po.order_date))) as max_lead_time,
        COUNT(*) as order_count
      FROM PurchaseOrders po
      JOIN PurchaseOrderLineItems poli ON po.po_id = poli.po_id
      JOIN StockInRecords sir ON po.vendor_id = sir.vendor_id
      JOIN InventoryItems ii ON poli.item_id = ii.item_id
      WHERE po.vendor_id = $1 AND po.business_id = $2
        AND po.status = 'Received'
        AND sir.received_date >= CURRENT_DATE - INTERVAL '6 months'
      GROUP BY poli.item_id, ii.name
      HAVING COUNT(*) >= 2
      ORDER BY ii.name
    `, [vendorId, businessId]);
    
    // Store/update lead time data
    for (const stat of leadTimeStats.rows) {
      await pool.query(`
        INSERT INTO VendorLeadTimes (
          item_id, vendor_id, business_id, avg_lead_time_days, 
          min_lead_time_days, max_lead_time_days, order_count, calculated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (item_id, vendor_id, business_id) 
        DO UPDATE SET 
          avg_lead_time_days = EXCLUDED.avg_lead_time_days,
          min_lead_time_days = EXCLUDED.min_lead_time_days,
          max_lead_time_days = EXCLUDED.max_lead_time_days,
          order_count = EXCLUDED.order_count,
          calculated_at = EXCLUDED.calculated_at
      `, [
        stat.item_id, vendorId, businessId, 
        stat.avg_lead_time_days, stat.min_lead_time, stat.max_lead_time, stat.order_count
      ]);
    }
    
    return leadTimeStats.rows;
    
  } finally {
    client.release();
  }
};

// =================== VENDOR RECOMMENDATION ENGINE ===================

// Get best vendor recommendations based on performance and lead time
const getVendorRecommendations = async (itemId, businessId) => {
  const client = await pool.connect();
  try {
    const recommendations = await pool.query(`
      SELECT 
        v.vendor_id,
        v.name,
        v.contact_phone,
        v.contact_email,
        v.average_rating,
        v.on_time_delivery_rate,
        v.quality_score,
        vlt.avg_lead_time_days,
        vlt.order_count,
        COALESCE(vbi.quantity, 0) as last_unit_cost,
        -- Performance score calculation
        (
          COALESCE(v.average_rating, 0) * 0.3 +
          COALESCE(v.on_time_delivery_rate, 0) * 0.4 +
          COALESCE(v.quality_score, 0) * 0.3
        ) as performance_score,
        -- Lead time score (shorter is better)
        CASE 
          WHEN vlt.avg_lead_time_days IS NULL THEN 50
          WHEN vlt.avg_lead_time_days <= 1 THEN 100
          WHEN vlt.avg_lead_time_days <= 2 THEN 90
          WHEN vlt.avg_lead_time_days <= 3 THEN 80
          WHEN vlt.avg_lead_time_days <= 5 THEN 70
          ELSE 60
        END as lead_time_score
      FROM Vendors v
      LEFT JOIN VendorLeadTimes vlt ON v.vendor_id = vlt.vendor_id AND vlt.item_id = $1
      LEFT JOIN VendorBillsItems vbi ON v.vendor_id = vbi.vendor_id AND vbi.item_id = $1
      WHERE v.business_id = $2 AND v.is_active = true
      ORDER BY 
        (performance_score + lead_time_score) / 2 DESC,
        vlt.order_count DESC NULLS LAST,
        v.average_rating DESC
    `, [itemId, businessId]);
    
    return recommendations.rows;
    
  } finally {
    client.release();
  }
};

// =================== REORDER AUTOMATION WITH VENDOR SELECTION ===================

// Generate automated reorder suggestions with optimal vendor selection
const generateReorderSuggestions = async (businessId) => {
  const client = await pool.connect();
  try {
    // Get all critical/low stock items
    const criticalItems = await pool.query(`
      SELECT 
        ii.item_id,
        ii.name,
        ii.reorder_point,
        ii.safety_stock,
        ii.default_vendor_id,
        COALESCE(SUM(ib.quantity), 0) as current_stock,
        rpc.average_daily_consumption,
        rpc.average_lead_time_days,
        mst.tracking_phase,
        CASE 
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0) THEN 'critical'
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) THEN 'low'
          ELSE 'sufficient'
        END as stock_status
      FROM InventoryItems ii
      LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
      LEFT JOIN ReorderPointCalculations rpc ON ii.item_id = rpc.item_id
      LEFT JOIN MinimalStockTracking mst ON ii.item_id = mst.item_id
      WHERE ii.business_id = $1 AND ii.is_active = true
      GROUP BY ii.item_id, ii.name, ii.reorder_point, ii.safety_stock, ii.default_vendor_id,
               rpc.average_daily_consumption, rpc.average_lead_time_days, mst.tracking_phase
      HAVING 
        (COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) OR 
         COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0))
        AND (mst.is_learning_mode = false OR mst.is_learning_mode IS NULL)
      ORDER BY 
        CASE 
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0) THEN 1
          WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) THEN 2
          ELSE 3
        END,
        ii.name
    `, [businessId]);
    
    const suggestions = [];
    
    for (const item of criticalItems.rows) {
      // Get vendor recommendations for this item
      const vendorRecommendations = await getVendorRecommendations(item.item_id, businessId);
      
      // Calculate suggested order quantity
      const dailyConsumption = item.average_daily_consumption || 5; // Default if no data
      const leadTime = item.average_lead_time_days || 3; // Default if no data
      const safetyStock = item.safety_stock || (dailyConsumption * 0.5);
      
      // Order quantity: enough to last through lead time + buffer for next cycle
      const suggestedQuantity = Math.ceil(
        (dailyConsumption * leadTime) + 
        safetyStock + 
        (dailyConsumption * 7) // Extra week supply
      );
      
      suggestions.push({
        item: {
          id: item.item_id,
          name: item.name,
          currentStock: item.current_stock,
          reorderPoint: item.reorder_point,
          stockStatus: item.stock_status,
          trackingPhase: item.tracking_phase
        },
        orderSuggestion: {
          suggestedQuantity,
          urgencyLevel: item.stock_status,
          reasonCode: item.stock_status === 'critical' ? 'CRITICAL_STOCK' : 'LOW_STOCK'
        },
        vendorRecommendations: vendorRecommendations.slice(0, 3), // Top 3 vendors
        analytics: {
          dailyConsumption,
          leadTime,
          safetyStock,
          daysUntilStockout: Math.floor(item.current_stock / dailyConsumption)
        }
      });
    }
    
    return suggestions;
    
  } finally {
    client.release();
  }
};

// =================== API ENDPOINTS ===================

// GET /api/vendor-management/vendors/:businessId - Get all vendors with performance metrics
router.get('/vendors/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { category, sortBy = 'performance' } = req.query;
    
    let query = `
      SELECT 
        v.*,
        CASE v.vendor_category
          WHEN 'wholesale' THEN 'Wholesale'
          WHEN 'dairy' THEN 'Dairy'
          WHEN 'meat' THEN 'Meat'
          WHEN 'seafood' THEN 'Seafood'
          WHEN 'fruits' THEN 'Fruits'
          WHEN 'vegetables' THEN 'Vegetables'
          ELSE 'Others'
        END as category,
        COUNT(po.po_id) as total_purchase_orders,
        SUM(po.total_amount) as total_spend,
        AVG(vr.rating) as user_rating,
        COUNT(vr.rating_id) as rating_count
      FROM Vendors v
      LEFT JOIN PurchaseOrders po ON v.vendor_id = po.vendor_id 
        AND po.created_at >= CURRENT_DATE - INTERVAL '6 months'
      LEFT JOIN VendorRatings vr ON v.vendor_id = vr.vendor_id
      WHERE v.business_id = $1 AND v.is_active = true
    `;
    
    const params = [businessId];
    
    if (category && category !== 'All') {
      query += ` AND v.vendor_category = $2`;
      params.push(category.toLowerCase());
    }
    
    query += ` GROUP BY v.vendor_id`;
    
    // Add sorting
    switch (sortBy) {
      case 'rating':
        query += ` ORDER BY v.average_rating DESC NULLS LAST`;
        break;
      case 'ontime':
        query += ` ORDER BY v.on_time_delivery_rate DESC NULLS LAST`;
        break;
      case 'spend':
        query += ` ORDER BY total_spend DESC NULLS LAST`;
        break;
      default:
        query += ` ORDER BY (v.average_rating * 0.4 + v.on_time_delivery_rate * 0.6) DESC NULLS LAST`;
    }
    
    const vendors = await pool.query(query, params);
    
    res.json({
      success: true,
      data: vendors.rows,
      count: vendors.rows.length
    });
    
  } catch (error) {
    console.error('Error fetching vendors:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vendors',
      details: error.message
    });
  }
});

// POST /api/vendor-management/vendors - Create new vendor
router.post('/vendors', async (req, res) => {
  try {
    const {
      businessId, name, description, category, contactPhone, contactEmail,
      contactWhatsapp, address, averageRating, qualityScore, userId
    } = req.body;
    
    if (!businessId || !name || !category) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: businessId, name, category'
      });
    }
    
    const result = await pool.query(`
      INSERT INTO Vendors (
        business_id, name, description, vendor_category, contact_phone, contact_email,
        contact_whatsapp, address, average_rating, quality_score, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
      RETURNING *, 
        CASE vendor_category
          WHEN 'wholesale' THEN 'Wholesale'
          WHEN 'dairy' THEN 'Dairy'
          WHEN 'meat' THEN 'Meat'
          WHEN 'seafood' THEN 'Seafood'
          WHEN 'fruits' THEN 'Fruits'
          WHEN 'vegetables' THEN 'Vegetables'
          ELSE 'Others'
        END as category
    `, [
      parseInt(businessId, 10), 
      name ? String(name) : null, 
      description ? String(description) : null, 
      category ? String(category).toLowerCase() : 'others', 
      contactPhone ? String(contactPhone) : null, 
      contactEmail ? String(contactEmail) : null,
      contactWhatsapp ? String(contactWhatsapp) : null, 
      address ? String(address) : null, 
      averageRating ? Math.max(0, Math.min(5, parseFloat(averageRating))) : 0, 
      qualityScore ? Math.max(0, Math.min(100, parseFloat(qualityScore))) : 0
    ]);
    
    // Create "New Vendor Detected" confirmation
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await insertNotification(client, {
          businessId,
          userId: parseInt(userId, 10) || 1,
          type: 'success',
          title: `New Vendor Added: ${name}`,
          description: `New vendor "${name}" has been successfully added to your supplier list. You can now track purchases and performance metrics.`,
          relatedUrl: '/vendors'
        });
        // If contact details are missing, also raise an incomplete-details warning for visibility
        if (!contactPhone || !contactEmail) {
          await insertNotification(client, {
            businessId,
            userId: parseInt(userId, 10) || 1,
            type: 'warning',
            title: `Incomplete Details: ${name}`,
            description: `Vendor "${name}" is missing contact information. Complete vendor profiles to enable smart reordering and analytics.`,
            relatedUrl: '/vendors'
          });
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    } catch (_) {}

    res.json({
      success: true,
      message: 'Vendor created successfully',
      data: result.rows[0]
    });
    
  } catch (error) {
    console.error('Error creating vendor:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create vendor',
      details: error.message
    });
  }
});

// PUT /api/vendor-management/vendors/:vendorId - Update vendor
router.put('/vendors/:vendorId', async (req, res) => {
  try {
    const { vendorId } = req.params;
    const updateFields = req.body;
    
    // Validate vendorId - must be a valid 32-bit integer
    const numericVendorId = parseInt(vendorId, 10);
    if (isNaN(numericVendorId) || numericVendorId < 1 || numericVendorId > 2147483647) {
      return res.status(400).json({
        success: false,
        error: `Invalid vendor ID: ${vendorId}. Must be a valid integer between 1 and 2147483647.`
      });
    }
    
    const allowedFields = [
      'name', 'description', 'contact_phone', 'contact_email', 'contact_whatsapp',
      'address', 'average_rating', 'quality_score', 'is_active', 'category'
    ];
    
    const setClause = [];
    const values = [];
    let paramCount = 1;
    
    for (const [key, value] of Object.entries(updateFields)) {
      if (allowedFields.includes(key)) {
        if (key === 'category') {
          // Map frontend 'category' to database 'vendor_category'
          setClause.push(`vendor_category = $${paramCount}`);
          values.push(value ? String(value).toLowerCase() : null);
        } else {
          setClause.push(`${key} = $${paramCount}`);
          // Sanitize values to prevent integer overflow
          if (['contact_phone', 'contact_whatsapp', 'contact_email', 'address', 'name', 'description'].includes(key)) {
            values.push(value ? String(value) : null);
          } else if (key === 'average_rating') {
            const rating = parseFloat(value);
            values.push(isNaN(rating) ? null : Math.max(0, Math.min(5, rating)));
          } else if (key === 'quality_score') {
            const score = parseFloat(value);
            values.push(isNaN(score) ? null : Math.max(0, Math.min(100, score)));
          } else if (key === 'is_active') {
            values.push(Boolean(value));
          } else {
            values.push(value);
          }
        }
        paramCount++;
      }
    }
    
    if (setClause.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }
    
    values.push(numericVendorId);
    
    const result = await pool.query(`
      UPDATE Vendors 
      SET ${setClause.join(', ')}, updated_at = NOW()
      WHERE vendor_id = $${paramCount}
      RETURNING *, 
        CASE vendor_category
          WHEN 'wholesale' THEN 'Wholesale'
          WHEN 'dairy' THEN 'Dairy'
          WHEN 'meat' THEN 'Meat'
          WHEN 'seafood' THEN 'Seafood'
          WHEN 'fruits' THEN 'Fruits'
          WHEN 'vegetables' THEN 'Vegetables'
          ELSE 'Others'
        END as category
    `, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Vendor not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Vendor updated successfully',
      data: result.rows[0]
    });
    
  } catch (error) {
    console.error('Error updating vendor:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update vendor',
      details: error.message
    });
  }
});

// GET /api/vendor-management/recommendations/:businessId/:itemId - Get vendor recommendations for item
router.get('/recommendations/:businessId/:itemId', async (req, res) => {
  try {
    const { businessId, itemId } = req.params;
    
    const recommendations = await getVendorRecommendations(itemId, businessId);
    
    res.json({
      success: true,
      data: recommendations,
      count: recommendations.length
    });
    
  } catch (error) {
    console.error('Error getting vendor recommendations:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get vendor recommendations',
      details: error.message
    });
  }
});

// POST /api/vendor-management/rate-vendor - Rate a vendor
router.post('/rate-vendor', async (req, res) => {
  try {
    const { vendorId, userId, rating, reviewComment } = req.body;
    
    if (!vendorId || !userId || !rating) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: vendorId, userId, rating'
      });
    }
    
    // Validate vendorId - must be a valid 32-bit integer
    const numericVendorId = parseInt(vendorId, 10);
    if (isNaN(numericVendorId) || numericVendorId < 1 || numericVendorId > 2147483647) {
      return res.status(400).json({
        success: false,
        error: `Invalid vendor ID: ${vendorId}. Must be a valid integer between 1 and 2147483647.`
      });
    }
    
    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        error: 'Rating must be between 1 and 5'
      });
    }
    
    // Insert or update rating
    await pool.query(`
      INSERT INTO VendorRatings (vendor_id, user_id, rating, review_comment)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (vendor_id, user_id) 
      DO UPDATE SET 
        rating = EXCLUDED.rating,
        review_comment = EXCLUDED.review_comment,
        created_at = NOW()
    `, [numericVendorId, userId, rating, reviewComment]);
    
    // Update vendor's average rating
    const businessResult = await pool.query(`
      SELECT business_id FROM Vendors WHERE vendor_id = $1
    `, [numericVendorId]);
    
    if (businessResult.rows.length > 0) {
      const businessId = businessResult.rows[0].business_id;
      const perf = await updateVendorPerformance(numericVendorId, businessId);
      // Generate performance alert if on-time rate dropped materially (>10 pts)
      try {
        if (perf.prevOnTimeRate != null && perf.onTimeRate != null) {
          const drop = Number(perf.prevOnTimeRate) - Number(perf.onTimeRate);
          const metric = 'On-time Delivery';
          const title = `Vendor Performance Alert: ${drop > 0 ? metric + ' Dropped' : metric + ' Updated'}`;
          const description = `Vendor "${perf.vendorName}" ${metric.toLowerCase()} ${drop > 0 ? 'fell to' : 'is at'} ${perf.onTimeRate.toFixed(0)}%${perf.prevOnTimeRate != null ? ` (prev ${Number(perf.prevOnTimeRate).toFixed(0)}%)` : ''}. Review vendor performance and consider diversifying suppliers.`;
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await insertNotification(client, {
              businessId,
              userId: parseInt(userId, 10) || 1,
              type: drop > 5 ? 'warning' : 'info',
              title,
              description,
              relatedUrl: '/vendors'
            });
            await client.query('COMMIT');
          } catch (e) {
            await client.query('ROLLBACK');
          } finally {
            client.release();
          }
        }
      } catch (_) {}
    }
    
    res.json({
      success: true,
      message: 'Vendor rating submitted successfully'
    });
    
  } catch (error) {
    console.error('Error rating vendor:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to rate vendor',
      details: error.message
    });
  }
});

// GET /api/vendor-management/reorder-suggestions/:businessId - Get automated reorder suggestions
router.get('/reorder-suggestions/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    const suggestions = await generateReorderSuggestions(businessId);
    
    res.json({
      success: true,
      data: suggestions,
      count: suggestions.length,
      summary: {
        criticalItems: suggestions.filter(s => s.orderSuggestion.urgencyLevel === 'critical').length,
        lowStockItems: suggestions.filter(s => s.orderSuggestion.urgencyLevel === 'low').length,
        totalSuggestedOrders: suggestions.length
      }
    });
    
  } catch (error) {
    console.error('Error generating reorder suggestions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate reorder suggestions',
      details: error.message
    });
  }
});

// POST /api/vendor-management/update-performance/:vendorId - Update vendor performance metrics
router.post('/update-performance/:vendorId', async (req, res) => {
  try {
    const { vendorId } = req.params;
    const { businessId, userId } = req.body;
    
    // Validate vendorId - must be a valid 32-bit integer
    const numericVendorId = parseInt(vendorId, 10);
    if (isNaN(numericVendorId) || numericVendorId < 1 || numericVendorId > 2147483647) {
      return res.status(400).json({
        success: false,
        error: `Invalid vendor ID: ${vendorId}. Must be a valid integer between 1 and 2147483647.`
      });
    }
    
    if (!businessId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required field: businessId'
      });
    }
    
    const performance = await updateVendorPerformance(numericVendorId, businessId);
    // Generate performance alert if significant change
    try {
      if (performance.prevOnTimeRate != null && performance.onTimeRate != null) {
        const delta = Number(performance.onTimeRate) - Number(performance.prevOnTimeRate);
        if (Math.abs(delta) >= 5) {
          const dropped = delta < 0;
          const metric = 'On-time Delivery';
          const title = `Vendor Performance Alert: ${metric} ${dropped ? 'Dropped' : 'Updated'}`;
          const description = `Vendor "${performance.vendorName}" ${metric.toLowerCase()} ${dropped ? 'fell to' : 'is at'} ${performance.onTimeRate.toFixed(0)}%${performance.prevOnTimeRate != null ? ` (prev ${Number(performance.prevOnTimeRate).toFixed(0)}%)` : ''}. Review vendor performance and consider diversifying suppliers.`;
          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            await insertNotification(client, {
              businessId,
              userId: parseInt(userId, 10) || 1,
              type: dropped ? 'warning' : 'info',
              title,
              description,
              relatedUrl: '/vendors'
            });
            await client.query('COMMIT');
          } catch (e) {
            await client.query('ROLLBACK');
          } finally {
            client.release();
          }
        }
      }
    } catch (_) {}
    const leadTimes = await calculateVendorLeadTimes(numericVendorId, businessId);
    
    res.json({
      success: true,
      message: 'Vendor performance updated successfully',
      data: {
        performance,
        leadTimeStats: leadTimes
      }
    });
    
  } catch (error) {
    console.error('Error updating vendor performance:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update vendor performance',
      details: error.message
    });
  }
});

// GET /api/vendor-management/analytics/:businessId - Get vendor analytics and KPIs
router.get('/analytics/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    const analytics = await pool.query(`
      SELECT 
        COUNT(*) as total_vendors,
        AVG(average_rating) as avg_vendor_rating,
        AVG(on_time_delivery_rate) as avg_ontime_rate,
        AVG(quality_score) as avg_quality_score,
        SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_vendors,
        COUNT(DISTINCT 
          CASE WHEN last_ordered_at >= CURRENT_DATE - INTERVAL '30 days' 
          THEN vendor_id END
        ) as vendors_used_recently
      FROM Vendors 
      WHERE business_id = $1
    `, [businessId]);
    
    const spendAnalytics = await pool.query(`
      SELECT 
        SUM(po.total_amount) as total_spend_6months,
        COUNT(po.po_id) as total_orders_6months,
        AVG(po.total_amount) as avg_order_value
      FROM PurchaseOrders po
      JOIN Vendors v ON po.vendor_id = v.vendor_id
      WHERE v.business_id = $1 
        AND po.created_at >= CURRENT_DATE - INTERVAL '6 months'
    `, [businessId]);
    
    const topVendors = await pool.query(`
      SELECT 
        v.name,
        v.average_rating,
        SUM(po.total_amount) as total_spend,
        COUNT(po.po_id) as order_count
      FROM Vendors v
      LEFT JOIN PurchaseOrders po ON v.vendor_id = po.vendor_id 
        AND po.created_at >= CURRENT_DATE - INTERVAL '6 months'
      WHERE v.business_id = $1 AND v.is_active = true
      GROUP BY v.vendor_id, v.name, v.average_rating
      ORDER BY total_spend DESC NULLS LAST
      LIMIT 5
    `, [businessId]);
    
    res.json({
      success: true,
      data: {
        overview: analytics.rows[0],
        spending: spendAnalytics.rows[0],
        topVendors: topVendors.rows
      }
    });
    
  } catch (error) {
    console.error('Error fetching vendor analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch vendor analytics',
      details: error.message
    });
  }
});

// POST /api/vendor-management/setup-categories/:businessId - Setup sample vendors with new categories
router.post('/setup-categories/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    // Update existing vendor categories
    await pool.query(`
      UPDATE vendors 
      SET category = CASE 
        WHEN category = 'Produce' THEN 'Vegetables'
        WHEN category = 'Beverages' THEN 'Wholesale'
        ELSE category 
      END 
      WHERE business_id = $1
    `, [businessId]);
    
    // Sample vendors for each new category
    const sampleVendors = [
      ['Ocean Fresh Seafood', 'Premium quality fresh seafood supplier', 'Seafood', '+919876543210', 'orders@oceanfresh.com'],
      ['Tropical Fruits Co.', 'Fresh seasonal fruits from local farms', 'Fruits', '+919876543211', 'supply@tropicalfruits.com'],
      ['Wholesale Mart', 'Bulk supplies and dry goods distributor', 'Wholesale', '+919876543212', 'bulk@wholesalemart.com'],
      ['Green Valley Vegetables', 'Farm fresh vegetables daily delivery', 'Vegetables', '+919876543213', 'fresh@greenvalley.com'],
      ['Premium Meats', 'High quality meat and poultry supplier', 'Meat', '+919876543214', 'orders@premiummeats.com'],
      ['Dairy Express', 'Fresh dairy products and milk supplier', 'Dairy', '+919876543215', 'supply@dairyexpress.com']
    ];
    
    let addedCount = 0;
    for (const [name, description, category, phone, email] of sampleVendors) {
      const result = await pool.query(`
        INSERT INTO vendors (business_id, name, description, category, contact_phone, contact_email, is_active) 
        VALUES ($1, $2, $3, $4, $5, $6, true)
        ON CONFLICT (business_id, name) DO UPDATE SET 
          category = EXCLUDED.category,
          description = EXCLUDED.description,
          contact_phone = EXCLUDED.contact_phone,
          contact_email = EXCLUDED.contact_email
        RETURNING vendor_id
      `, [businessId, name, description, category, phone, email]);
      
      if (result.rows.length > 0) addedCount++;
    }
    
    // Get final vendor list
    const vendors = await pool.query(`
      SELECT name, category FROM vendors 
      WHERE business_id = $1 AND is_active = true 
      ORDER BY category, name
    `, [businessId]);
    
    res.json({
      success: true,
      message: `Successfully setup ${addedCount} sample vendors`,
      data: vendors.rows
    });
    
  } catch (error) {
    console.error('Error setting up vendor categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to setup vendor categories',
      details: error.message
    });
  }
});

module.exports = router;

// =================== INCOMPLETE VENDOR DETAILS CHECK (creates a summary notification) ===================
// POST /api/vendor-management/vendors/notify-incomplete-details { businessId, userId }
router.post('/vendors/notify-incomplete-details', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId } = req.body || {};
    if (!businessId) {
      return res.status(400).json({ success: false, error: 'Missing required field: businessId' });
    }

    const rows = await client.query(
      `SELECT name
       FROM Vendors
       WHERE business_id = $1 AND is_active = true
         AND (
           contact_phone IS NULL OR TRIM(contact_phone) = '' OR
           contact_email IS NULL OR TRIM(contact_email) = '' OR
           (average_rating IS NULL AND total_orders IS NULL)
         )
       ORDER BY name
       LIMIT 10`,
      [businessId]
    );

    let created = 0;
    await client.query('BEGIN');
    if (rows.rows.length > 0) {
      const examples = rows.rows.slice(0, 3).map(r => r.name);
      const title = `${rows.rows.length} Vendor${rows.rows.length > 1 ? 's Have' : ' Has'} Incomplete Details`;
      const description = `${rows.rows.length} vendor${rows.rows.length > 1 ? 's are' : ' is'} missing contact info or performance metrics${examples.length ? `, e.g., ${examples.join(', ')}` : ''}. Complete vendor profiles to enable smart reordering and analytics.`;
      const { skipped } = await insertNotification(client, {
        businessId,
        userId: parseInt(userId, 10) || 1,
        type: 'warning',
        title,
        description,
        relatedUrl: '/vendors'
      });
      if (!skipped) created++;
    }
    await client.query('COMMIT');

    return res.json({ success: true, created, totalIncomplete: rows.rows.length });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating incomplete vendor details notification:', error);
    return res.status(500).json({ success: false, error: 'Failed to create notification', details: error.message });
  } finally {
    client.release();
  }
});