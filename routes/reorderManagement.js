const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const MinimalStockService = require('../services/MinimalStockService');
const PDFGenerator = require('../services/pdfGenerator');

/**
 * REORDER MANAGEMENT ROUTES
 * Handles creation, tracking, and management of purchase order reorders
 * Integrates with minimal stock alerts and vendor management
 */

// =================== CREATE REORDER OPERATIONS ===================

/**
 * GET /api/reorder/suggested-items/:businessId
 * Get all items that need reordering based on minimal stock alerts
 */
router.get('/suggested-items/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
  // Get items for Create Reorder (includes Phase 1 learning items first 7 days + critical/low Phase 2/3)
  const reorderScreenItems = await MinimalStockService.getCreateReorderItems(businessId);
    
    // Enhance with reorder calculations and vendor information
    const client = await pool.connect();
    const enhancedItems = [];
    
    for (const item of reorderScreenItems) {
      // Skip reorder quantity calculations for learning items (Phase 1)
      if (item.stock_status === 'learning' || item.is_learning_mode) {
        enhancedItems.push({
          itemId: item.item_id,
          itemName: item.item_name,
            currentStock: item.current_stock,
            reorderPoint: item.reorder_point,
            safetyStock: item.safety_stock,
            stockStatus: 'learning',
            urgencyScore: null,
            daysUntilStockout: null,
            recommendedOrderQty: null,
            minimumOrderQty: null,
            standardPackSize: null,
            estimatedCost: null,
            lastPurchasePrice: null,
            defaultVendorId: null,
            vendorName: null,
            vendorContact: null,
            estimatedLeadTime: null,
            dailyConsumption: null,
            trackingPhase: item.tracking_phase,
            phaseLabel: 'Phase 1 (Learning)',
            alertType: null,
            isLearning: true,
            daysTracked: item.days_tracked
        });
        continue;
      }
      // Get recommended order quantity based on business rules
      const reorderCalc = await client.query(`
        SELECT 
          ii.name,
          ii.current_stock,
          ii.reorder_point,
          ii.safety_stock,
          ii.default_vendor_id,
          v.name as vendor_name,
          v.contact_email,
          v.contact_phone,
          rpc.average_daily_consumption,
          rpc.average_lead_time_days,
          vlt.avg_lead_time_days as vendor_lead_time,
          COALESCE(lip.unit_price, 0) as last_purchase_price
        FROM InventoryItems ii
        LEFT JOIN Vendors v ON ii.default_vendor_id = v.vendor_id
        LEFT JOIN ReorderPointCalculations rpc ON ii.item_id = rpc.item_id
        LEFT JOIN VendorLeadTimes vlt ON ii.item_id = vlt.item_id AND ii.default_vendor_id = vlt.vendor_id
        LEFT JOIN (
          SELECT DISTINCT ON (item_id) item_id, unit_price
          FROM LineItemPrices
          WHERE item_id = $1
          ORDER BY item_id, created_at DESC
        ) lip ON ii.item_id = lip.item_id
        WHERE ii.item_id = $1 AND ii.business_id = $2
      `, [item.item_id, businessId]);
      
      if (reorderCalc.rows.length > 0) {
        const itemData = reorderCalc.rows[0];
        
        // Calculate recommended order quantity
        const leadTimeDays = itemData.vendor_lead_time || itemData.average_lead_time_days || 7;
        const dailyConsumption = itemData.average_daily_consumption || 1;
        const safetyStock = itemData.safety_stock || 0;
        const currentStock = itemData.current_stock || 0;
        
        // Order quantity = (Lead time consumption) + Safety stock - Current stock + Buffer
        const leadTimeConsumption = dailyConsumption * leadTimeDays;
        const bufferStock = dailyConsumption * 3; // 3-day buffer
        // Minimum order quantity not in schema; default to 1
        const minOrderQty = 1;
        const calculatedOrderQty = Math.max(
          leadTimeConsumption + safetyStock - currentStock + bufferStock,
          minOrderQty
        );
        
        // Round up to standard pack size if specified
        // Standard pack size not in schema; use raw calculated rounded up
        const recommendedQty = Math.ceil(calculatedOrderQty);
        
        // Calculate estimated cost
        const estimatedCost = recommendedQty * (itemData.last_purchase_price || 0);
        
        // Calculate urgency score (lower is more urgent)
        const daysUntilStockout = currentStock / Math.max(dailyConsumption, 0.1);
        const urgencyScore = Math.max(1, Math.min(10, Math.ceil(daysUntilStockout)));
        
  enhancedItems.push({
          itemId: item.item_id,
          itemName: itemData.name,
          currentStock: currentStock,
          reorderPoint: itemData.reorder_point,
          safetyStock: safetyStock,
          stockStatus: item.stock_status,
          urgencyScore,
          daysUntilStockout: Math.round(daysUntilStockout * 10) / 10,
          
          // Reorder calculations
          recommendedOrderQty: recommendedQty,
          minimumOrderQty: minOrderQty,
          standardPackSize: null,
          estimatedCost: Math.round(estimatedCost * 100) / 100,
          lastPurchasePrice: itemData.last_purchase_price,
          
          // Vendor information
          defaultVendorId: itemData.default_vendor_id,
          vendorName: itemData.vendor_name,
          vendorContact: {
            email: itemData.contact_email,
            phone: itemData.contact_phone
          },
          estimatedLeadTime: leadTimeDays,
          
          // Analytics
          dailyConsumption: Math.round(dailyConsumption * 100) / 100,
          trackingPhase: item.tracking_phase,
          phaseLabel: item.tracking_phase === 2 ? 'Phase 2 (Preliminary)' : (item.tracking_phase >= 3 ? 'Phase 3 (Full)' : 'Unknown'),
          alertType: item.alert_type,
          isLearning: false
        });
      }
    }
    
    client.release();
    
    // Sort by urgency (most urgent first)
    enhancedItems.sort((a, b) => {
      // Learning items should always be at bottom
      if (a.stockStatus === 'learning' && b.stockStatus !== 'learning') return 1;
      if (b.stockStatus === 'learning' && a.stockStatus !== 'learning') return -1;
      // Null urgency (learning) vs number
      if (a.urgencyScore == null && b.urgencyScore != null) return 1;
      if (b.urgencyScore == null && a.urgencyScore != null) return -1;
      if (a.urgencyScore == null && b.urgencyScore == null) return a.itemName.localeCompare(b.itemName);
      return a.urgencyScore - b.urgencyScore;
    });
    
    res.json({
      success: true,
      totalItems: enhancedItems.length,
  criticalCount: enhancedItems.filter(item => item.stockStatus === 'critical').length,
  lowStockCount: enhancedItems.filter(item => item.stockStatus === 'low').length,
  learningCount: enhancedItems.filter(item => item.stockStatus === 'learning').length,
      totalEstimatedCost: enhancedItems.reduce((sum, item) => sum + item.estimatedCost, 0),
      suggestedItems: enhancedItems
    });
    
  } catch (error) {
    console.error('Error getting suggested reorder items:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get suggested reorder items',
      details: error.message 
    });
  }
});

/**
 * POST /api/reorder/create-purchase-order
 * Create a new purchase order from selected reorder items
 */
router.post('/create-purchase-order', async (req, res) => {
  const client = await pool.connect();
  const startTs = Date.now();
  try {
    await client.query('BEGIN');
    // Set a higher timeout within this transaction to avoid read timeouts under load
    await client.query("SET LOCAL statement_timeout = '120s'");
    
    const { 
      businessId, 
      vendorId, 
      selectedItems, 
      orderNotes, 
      requestedDeliveryDate,
      createdBy 
    } = req.body;
    
    // Validate required fields
    if (!businessId || !vendorId || !selectedItems || selectedItems.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: businessId, vendorId, selectedItems' 
      });
    }
    
    // Generate PO number
    const poNumberResult = await client.query(`
      SELECT COALESCE(MAX(CAST(SUBSTRING(po_number FROM '[0-9]+') AS INTEGER)), 0) + 1 as next_number
      FROM PurchaseOrders 
      WHERE business_id = $1 AND po_number ~ '^PO[0-9]+$'
    `, [businessId]);
    
    const poNumber = `PO${String(poNumberResult.rows[0].next_number).padStart(6, '0')}`;
    
    // Create purchase order header
    const poResult = await client.query(`
      INSERT INTO PurchaseOrders (
        po_number, business_id, vendor_id, order_date, status,
        expected_delivery_date, special_instructions, created_by_user_id, total_amount
      ) VALUES ($1, $2, $3, CURRENT_DATE, 'Draft', $4, $5, $6, 0)
      RETURNING po_id, po_number
    `, [poNumber, businessId, vendorId, requestedDeliveryDate, orderNotes, createdBy]);
    
    const { po_id, po_number } = poResult.rows[0];
    
    let totalAmount = 0;
    const lineItems = [];
    
    // Create line items for each selected item
    for (const item of selectedItems) {
      const { itemId, orderQuantity, unitPrice, notes } = item;
      
      if (!itemId || !orderQuantity || orderQuantity <= 0) {
        throw new Error(`Invalid item data: itemId=${itemId}, quantity=${orderQuantity}`);
      }
      
      // Get item's standard unit
      const itemResult = await client.query(`
        SELECT standard_unit_id 
        FROM InventoryItems 
        WHERE item_id = $1
      `, [itemId]);
      
      if (itemResult.rows.length === 0) {
        throw new Error(`Item not found: ${itemId}`);
      }
      
      const unitId = itemResult.rows[0].standard_unit_id;
      const lineTotal = orderQuantity * (unitPrice || 0);
      totalAmount += lineTotal;
      
      // Insert line item
      const lineItemResult = await client.query(`
        INSERT INTO PurchaseOrderLineItems (
          po_id, item_id, quantity_ordered, unit_id, unit_price, total_line_amount
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING po_line_item_id
      `, [po_id, itemId, orderQuantity, unitId, unitPrice || 0, lineTotal]);
      
      // Create reorder tracking record
      await client.query(`
        INSERT INTO ReorderTracking (
          po_id, item_id, business_id, reorder_reason, quantity_ordered,
          current_stock_at_order, reorder_point_at_order, created_by
        ) VALUES ($1, $2, $3, 'minimal_stock_alert', $4, 
          (SELECT COALESCE(SUM(quantity), 0) FROM InventoryBatches WHERE item_id = $2 AND is_expired = false),
          (SELECT reorder_point FROM InventoryItems WHERE item_id = $2),
          $5
        )
      `, [po_id, itemId, businessId, orderQuantity, createdBy]);
      
      // Mark stock alerts as addressed
      await client.query(`
        UPDATE StockAlerts 
        SET status = 'addressed', addressed_date = NOW(), po_id = $1
        WHERE item_id = $2 AND status = 'active'
      `, [po_id, itemId]);
      
      lineItems.push({
        lineItemId: lineItemResult.rows[0].po_line_item_id,
        itemId,
        orderQuantity,
        unitPrice: unitPrice || 0,
        lineTotal
      });
    }
    
    // Update PO total amount and item count
    await client.query(`
      UPDATE PurchaseOrders 
      SET total_amount = $1, total_items = $2, updated_at = NOW()
      WHERE po_id = $3
    `, [totalAmount, selectedItems.length, po_id]);

    // Update vendor's total_orders count
    await client.query(`
      UPDATE Vendors 
      SET total_orders = total_orders + 1, 
          last_order_date = CURRENT_DATE,
          last_ordered_at = NOW(),
          updated_at = NOW()
      WHERE vendor_id = $1
    `, [vendorId]);

    await client.query('COMMIT');
    console.log(`📦 Purchase Order created: ${po_number} for ${selectedItems.length} items, total: $${totalAmount}. Vendor ${vendorId} total_orders updated.`);
    const txEnd = Date.now();

    // Release transaction client before any non-critical heavy work
    client.release();

    // Acquire a fresh client for read-only post-commit queries (short timeout)
    const readClient = await pool.connect();
    try {
      await readClient.query("SET LOCAL statement_timeout = '60s'");

      // Get complete order data for PDF
      const orderDetailsResult = await readClient.query(`
      SELECT 
        po.po_number, po.order_date, po.expected_delivery_date, 
        po.special_instructions, po.total_amount,
        v.name as vendor_name, v.contact_phone, v.address as vendor_address,
        v.vendor_category, v.contact_email,
        b.name as business_name, 'Not Available' as business_address
      FROM PurchaseOrders po
      JOIN Vendors v ON po.vendor_id = v.vendor_id
      LEFT JOIN Businesses b ON po.business_id = b.business_id
      WHERE po.po_id = $1
    `, [po_id]);

      const orderDetails = orderDetailsResult.rows[0];

      // Get line items with names
      const lineItemsResult = await readClient.query(`
      SELECT 
        li.quantity_ordered, li.unit_price,
        ii.name as name,
        gu.unit_symbol as unit
      FROM PurchaseOrderLineItems li
      JOIN InventoryItems ii ON li.item_id = ii.item_id
      LEFT JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
      WHERE li.po_id = $1
      ORDER BY ii.name
    `, [po_id]);

      try {
        // Generate PDF with enhanced data
        const pdfData = {
        poNumber: po_number,
        businessInfo: {
          name: orderDetails.business_name || 'Invexis Restaurant Management',
          address: orderDetails.business_address || 'Business Address'
        },
        vendorInfo: {
          name: orderDetails.vendor_name,
          phone: orderDetails.contact_phone,
          email: orderDetails.contact_email,
          address: orderDetails.vendor_address
        },
        vendorCategory: orderDetails.vendor_category || 'General',
        orderDate: orderDetails.order_date,
        deliveryDate: orderDetails.expected_delivery_date,
        items: lineItemsResult.rows.map(item => ({
          name: item.name,
          orderQuantity: item.quantity_ordered,
          unit: item.unit || ''
        })),
        orderNotes: orderDetails.special_instructions,
        fromNumber: '8919997308' // Your business contact number
        };

        await PDFGenerator.generatePurchaseOrderPDF(pdfData);
      } catch (pdfError) {
        console.error('PDF error:', pdfError);
      }
    } finally {
      readClient.release();
    }

    const endTs = Date.now();
    console.log(`⏱️ create-purchase-order timings: tx=${txEnd - startTs}ms, total=${endTs - startTs}ms`);

    return res.json({
      success: true,
      message: 'Purchase order created successfully',
      purchaseOrder: {
        poId: po_id,
        poNumber: po_number,
        vendorId,
        itemCount: selectedItems.length,
        status: 'Draft',
  lineItems
      }
    });
    
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    console.error('Error creating purchase order:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to create purchase order',
      details: error.message 
    });
  } finally {
    // In normal success flow, client is already released before PDF queries
    try { client.release(); } catch (e) {}
  }
});

/**
 * GET /api/reorder/vendor-group-suggestions/:businessId
 * Group suggested items by vendor for efficient ordering
 */
router.get('/vendor-group-suggestions/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    
    // Get all suggested items
    const suggestedResponse = await fetch(`http://localhost:${process.env.PORT || 3001}/api/reorder/suggested-items/${businessId}`);
    const suggestedData = await suggestedResponse.json();
    
    if (!suggestedData.success) {
      throw new Error('Failed to get suggested items');
    }
    
    const items = suggestedData.suggestedItems;
    
    // Group items by vendor
    const vendorGroups = {};
    const unassignedItems = [];
    
    items.forEach(item => {
      if (item.defaultVendorId && item.vendorName) {
        if (!vendorGroups[item.defaultVendorId]) {
          vendorGroups[item.defaultVendorId] = {
            vendorId: item.defaultVendorId,
            vendorName: item.vendorName,
            vendorContact: item.vendorContact,
            items: [],
            totalEstimatedCost: 0,
            criticalItemCount: 0,
            averageUrgency: 0
          };
        }
        
        vendorGroups[item.defaultVendorId].items.push(item);
        vendorGroups[item.defaultVendorId].totalEstimatedCost += item.estimatedCost;
        
        if (item.stockStatus === 'critical') {
          vendorGroups[item.defaultVendorId].criticalItemCount++;
        }
      } else {
        unassignedItems.push(item);
      }
    });
    
    // Calculate averages and sort items within each group
    Object.values(vendorGroups).forEach(group => {
      group.averageUrgency = group.items.reduce((sum, item) => sum + item.urgencyScore, 0) / group.items.length;
      group.items.sort((a, b) => a.urgencyScore - b.urgencyScore);
      group.totalEstimatedCost = Math.round(group.totalEstimatedCost * 100) / 100;
    });
    
    // Sort vendor groups by urgency (most urgent first)
    const sortedVendorGroups = Object.values(vendorGroups)
      .sort((a, b) => a.averageUrgency - b.averageUrgency);
    
    res.json({
      success: true,
      totalVendors: sortedVendorGroups.length,
      totalItems: items.length,
      unassignedItemCount: unassignedItems.length,
      vendorGroups: sortedVendorGroups,
      unassignedItems: unassignedItems.sort((a, b) => a.urgencyScore - b.urgencyScore)
    });
    
  } catch (error) {
    console.error('Error getting vendor group suggestions:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get vendor group suggestions',
      details: error.message 
    });
  }
});

// =================== REORDER TRACKING & MANAGEMENT ===================

/**
 * GET /api/reorder/tracking/:businessId
 * Get all reorder tracking information
 */
router.get('/tracking/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { status, startDate, endDate } = req.query;
    
    let statusFilter = '';
    let dateFilter = '';
    const params = [businessId];
    
    if (status) {
      statusFilter = 'AND po.status = $2';
      params.push(status);
    }
    
    if (startDate && endDate) {
      const paramIndex = params.length + 1;
      dateFilter = `AND po.order_date BETWEEN $${paramIndex} AND $${paramIndex + 1}`;
      params.push(startDate, endDate);
    }
    
    const client = await pool.connect();
    const trackingData = await client.query(`
      SELECT 
        rt.tracking_id,
        rt.po_id,
        po.po_number,
        po.status as po_status,
        po.order_date,
        po.requested_delivery_date,
        po.received_date,
        rt.item_id,
        ii.name as item_name,
        rt.quantity_ordered,
        rt.quantity_received,
        rt.current_stock_at_order,
        rt.reorder_point_at_order,
        rt.reorder_reason,
        v.name as vendor_name,
        v.contact_email,
        CASE 
          WHEN po.status = 'Received' THEN 'Completed'
          WHEN po.status = 'Cancelled' THEN 'Cancelled'
          WHEN po.requested_delivery_date < CURRENT_DATE THEN 'Overdue'
          WHEN po.requested_delivery_date = CURRENT_DATE THEN 'Due Today'
          ELSE 'Pending'
        END as delivery_status,
        CASE 
          WHEN po.received_date IS NOT NULL AND po.order_date IS NOT NULL 
          THEN EXTRACT(DAY FROM (po.received_date - po.order_date))
          ELSE NULL
        END as actual_lead_time_days
      FROM ReorderTracking rt
      JOIN PurchaseOrders po ON rt.po_id = po.po_id
      JOIN InventoryItems ii ON rt.item_id = ii.item_id
      JOIN Vendors v ON po.vendor_id = v.vendor_id
      WHERE rt.business_id = $1 
        ${statusFilter}
        ${dateFilter}
      ORDER BY po.order_date DESC, rt.tracking_id DESC
    `, params);
    
    client.release();
    
    // Group by PO for better organization
    const poGroups = {};
    trackingData.rows.forEach(row => {
      if (!poGroups[row.po_id]) {
        poGroups[row.po_id] = {
          poId: row.po_id,
          poNumber: row.po_number,
          poStatus: row.po_status,
          orderDate: row.order_date,
          requestedDeliveryDate: row.requested_delivery_date,
          receivedDate: row.received_date,
          vendorName: row.vendor_name,
          vendorContact: row.contact_email,
          deliveryStatus: row.delivery_status,
          actualLeadTimeDays: row.actual_lead_time_days,
          items: []
        };
      }
      
      poGroups[row.po_id].items.push({
        trackingId: row.tracking_id,
        itemId: row.item_id,
        itemName: row.item_name,
        quantityOrdered: row.quantity_ordered,
        quantityReceived: row.quantity_received,
        currentStockAtOrder: row.current_stock_at_order,
        reorderPointAtOrder: row.reorder_point_at_order,
        reorderReason: row.reorder_reason
      });
    });
    
    res.json({
      success: true,
      totalOrders: Object.keys(poGroups).length,
      totalItems: trackingData.rows.length,
      reorderTracking: Object.values(poGroups)
    });
    
  } catch (error) {
    console.error('Error getting reorder tracking:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get reorder tracking',
      details: error.message 
    });
  }
});

/**
 * PUT /api/reorder/update-received/:poId
 * Update received quantities for a purchase order
 */
router.put('/update-received/:poId', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { poId } = req.params;
    const { receivedItems, receivedDate, notes } = req.body;
    
    // Update PO status and received date
    await client.query(`
      UPDATE PurchaseOrders 
      SET status = 'Received', received_date = $1, notes = COALESCE(notes, '') || $2, updated_at = NOW()
      WHERE po_id = $3
    `, [receivedDate || new Date(), notes ? `\nReceived: ${notes}` : '', poId]);
    
    // Update received quantities in tracking
    for (const item of receivedItems) {
      await client.query(`
        UPDATE ReorderTracking 
        SET quantity_received = $1, updated_at = NOW()
        WHERE po_id = $2 AND item_id = $3
      `, [item.quantityReceived, poId, item.itemId]);
    }
    
    await client.query('COMMIT');
    
    console.log(`📦 PO ${poId} marked as received with ${receivedItems.length} items`);
    
    res.json({
      success: true,
      message: 'Purchase order receipt updated successfully',
      poId,
      receivedDate: receivedDate || new Date(),
      itemsUpdated: receivedItems.length
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating received quantities:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update received quantities',
      details: error.message 
    });
  } finally {
    client.release();
  }
});

// =================== ANALYTICS & REPORTING ===================

/**
 * GET /api/reorder/analytics/:businessId
 * Get reorder analytics and performance metrics
 */
router.get('/analytics/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const { period = '30' } = req.query; // Default to 30 days
    
    const client = await pool.connect();
    
    // Overall reorder statistics
    const overallStats = await client.query(`
      SELECT 
        COUNT(DISTINCT rt.po_id) as total_orders,
        COUNT(rt.tracking_id) as total_items_ordered,
        SUM(rt.quantity_ordered) as total_quantity_ordered,
        COUNT(CASE WHEN po.status = 'Received' THEN 1 END) as completed_orders,
        COUNT(CASE WHEN po.status = 'Cancelled' THEN 1 END) as cancelled_orders,
        COUNT(CASE WHEN po.requested_delivery_date < CURRENT_DATE AND po.status NOT IN ('Received', 'Cancelled') THEN 1 END) as overdue_orders,
        AVG(CASE WHEN po.received_date IS NOT NULL 
          THEN EXTRACT(DAY FROM (po.received_date - po.order_date)) 
          END) as avg_lead_time_days,
        SUM(po.total_amount) as total_order_value
      FROM ReorderTracking rt
      JOIN PurchaseOrders po ON rt.po_id = po.po_id
      WHERE rt.business_id = $1 
        AND po.order_date >= CURRENT_DATE - INTERVAL '${period} days'
    `, [businessId]);
    
    // Top items by reorder frequency
    const topReorderedItems = await client.query(`
      SELECT 
        ii.name as item_name,
        COUNT(rt.tracking_id) as reorder_count,
        SUM(rt.quantity_ordered) as total_quantity_ordered,
        AVG(rt.quantity_ordered) as avg_order_quantity,
        MAX(po.order_date) as last_reorder_date
      FROM ReorderTracking rt
      JOIN InventoryItems ii ON rt.item_id = ii.item_id
      JOIN PurchaseOrders po ON rt.po_id = po.po_id
      WHERE rt.business_id = $1 
        AND po.order_date >= CURRENT_DATE - INTERVAL '${period} days'
      GROUP BY ii.item_id, ii.name
      ORDER BY reorder_count DESC
      LIMIT 10
    `, [businessId]);
    
    // Vendor performance
    const vendorPerformance = await client.query(`
      SELECT 
        v.name as vendor_name,
        COUNT(DISTINCT po.po_id) as order_count,
        COUNT(CASE WHEN po.status = 'Received' THEN 1 END) as completed_orders,
        AVG(CASE WHEN po.received_date IS NOT NULL 
          THEN EXTRACT(DAY FROM (po.received_date - po.order_date)) 
          END) as avg_lead_time_days,
        SUM(po.total_amount) as total_order_value,
        ROUND(
          COUNT(CASE WHEN po.status = 'Received' THEN 1 END) * 100.0 / COUNT(po.po_id), 
          2
        ) as completion_rate
      FROM PurchaseOrders po
      JOIN Vendors v ON po.vendor_id = v.vendor_id
      WHERE po.business_id = $1 
        AND po.order_date >= CURRENT_DATE - INTERVAL '${period} days'
      GROUP BY v.vendor_id, v.name
      ORDER BY completion_rate DESC, avg_lead_time_days ASC
    `, [businessId]);
    
    // Monthly trend
    const monthlyTrend = await client.query(`
      SELECT 
        DATE_TRUNC('month', po.order_date) as month,
        COUNT(DISTINCT po.po_id) as order_count,
        COUNT(rt.tracking_id) as item_count,
        SUM(po.total_amount) as total_value
      FROM ReorderTracking rt
      JOIN PurchaseOrders po ON rt.po_id = po.po_id
      WHERE rt.business_id = $1 
        AND po.order_date >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', po.order_date)
      ORDER BY month DESC
      LIMIT 12
    `, [businessId]);
    
    client.release();
    
    const stats = overallStats.rows[0];
    
    res.json({
      success: true,
      period: `${period} days`,
      summary: {
        totalOrders: parseInt(stats.total_orders) || 0,
        totalItemsOrdered: parseInt(stats.total_items_ordered) || 0,
        totalQuantityOrdered: parseInt(stats.total_quantity_ordered) || 0,
        completedOrders: parseInt(stats.completed_orders) || 0,
        cancelledOrders: parseInt(stats.cancelled_orders) || 0,
        overdueOrders: parseInt(stats.overdue_orders) || 0,
        averageLeadTimeDays: Math.round((parseFloat(stats.avg_lead_time_days) || 0) * 10) / 10,
        totalOrderValue: Math.round((parseFloat(stats.total_order_value) || 0) * 100) / 100,
        completionRate: stats.total_orders > 0 
          ? Math.round((stats.completed_orders / stats.total_orders) * 100 * 10) / 10 
          : 0
      },
      topReorderedItems: topReorderedItems.rows,
      vendorPerformance: vendorPerformance.rows,
      monthlyTrend: monthlyTrend.rows
    });
    
  } catch (error) {
    console.error('Error getting reorder analytics:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to get reorder analytics',
      details: error.message 
    });
  }
});

// (WhatsApp status route removed)

module.exports = router;
