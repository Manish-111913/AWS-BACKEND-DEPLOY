const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// Import report scheduler for status endpoint
const reportScheduler = require('../services/reportScheduler');

// Prefer request-scoped DB client (tenantContext) when available
async function getReqClient(req) {
  if (req && (req.dbClient || req.db)) {
    return { client: req.dbClient || req.db, release: () => {} };
  }
  const client = await pool.connect();
  return { client, release: () => client.release() };
}

// Utility: insert a notification with basic duplicate suppression (24h window)
async function insertNotification(client, {
  businessId,
  userId,
  type, // e.g., 'critical' | 'warning' | 'info' | 'success'
  title,
  description,
  relatedUrl
}) {
  // Avoid duplicates (same type + title in last 24h)
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

// Helper: get a unit label for an inventory item by name (symbol preferred, else name)
async function getItemUnitLabel(client, businessId, itemName) {
  try {
    if (!itemName) return null;
    const q = await client.query(
      `SELECT COALESCE(NULLIF(TRIM(gu.unit_symbol), ''), gu.unit_name) AS unit_label
       FROM InventoryItems ii
       JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
       WHERE ii.business_id = $1 AND lower(ii.name) = lower($2)
       LIMIT 1`,
      [businessId, String(itemName)]
    );
    return q.rows[0]?.unit_label || null;
  } catch (_) {
    return null;
  }
}

// GET /api/notifications/:businessId
// Query: userId, status=unread|all, limit
router.get('/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;
    const userId = parseInt(req.query.userId, 10) || 1;
    const status = (req.query.status || 'unread').toLowerCase();
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

    const params = [businessId, userId];
    let where = 'business_id = $1 AND user_id = $2';
    if (status === 'unread') where += ' AND is_read = false';

    const rows = await pool.query(
      `SELECT notification_id, type, title, description, related_url, is_read, created_at
       FROM UserNotifications
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT ${limit}`,
      params
    );

    res.json({ success: true, data: rows.rows, count: rows.rows.length });
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch notifications', details: err.message });
  }
});

// GET /api/notifications/:businessId/unread-count?userId=1
router.get('/:businessId/unread-count', async (req, res) => {
  try {
    const { businessId } = req.params;
    const userId = parseInt(req.query.userId, 10) || 1;
    const result = await pool.query(
      `SELECT COUNT(*)::int AS unread_count
       FROM UserNotifications
       WHERE business_id = $1 AND user_id = $2 AND is_read = false`,
      [businessId, userId]
    );
    res.json({ success: true, unread: result.rows[0].unread_count });
  } catch (err) {
    console.error('Error counting unread notifications:', err);
    res.status(500).json({ success: false, error: 'Failed to get unread count', details: err.message });
  }
});

// POST /api/notifications/mark-read { userId, ids: number[] }
router.post('/mark-read', async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId, ids } = req.body;
    if (!userId || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'userId and ids[] are required' });
    }
    await client.query('BEGIN');
    await client.query(
      `UPDATE UserNotifications SET is_read = true
       WHERE user_id = $1 AND notification_id = ANY($2::int[])`,
      [userId, ids]
    );
    await client.query('COMMIT');
    res.json({ success: true, message: 'Notifications marked as read', count: ids.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error marking read:', err);
    res.status(500).json({ success: false, error: 'Failed to mark notifications read', details: err.message });
  } finally {
    client.release();
  }
});

// =================== MINIMAL STOCK NOTIFICATIONS ===================

// POST /api/notifications/minimal-stock/reorder-point-change { businessId, userId, itemName, oldQuantity, newQuantity, unitLabel }
router.post('/minimal-stock/reorder-point-change', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, itemName, oldQuantity, newQuantity, unitLabel } = req.body;
    if (!businessId || !userId || !itemName || newQuantity === undefined || oldQuantity === undefined) {
      return res.status(400).json({ success: false, error: 'businessId, userId, itemName, oldQuantity, newQuantity are required' });
    }

    const oldQ = Number(oldQuantity) || 0;
    const newQ = Number(newQuantity) || 0;
    const denom = oldQ === 0 ? (newQ === 0 ? 1 : newQ) : oldQ;
    const changePct = denom === 0 ? 0 : Math.round((Math.abs(newQ - oldQ) / denom) * 100);
    const unit = unitLabel ? ` ${unitLabel}` : '';
    const title = `Alert: Reorder Point for ${itemName} Has Changed`;
    const description = `The reorder point for ${itemName} was updated from ${oldQ}${unit} to ${newQ}${unit}.${changePct ? ` (~${changePct}% change)` : ''} This may be due to recent shifts in consumption or lead time.`;

    await client.query('BEGIN');
    await insertNotification(client, {
      businessId,
      userId,
      type: 'info',
      title,
      description,
      relatedUrl: `/overview?focus=${encodeURIComponent(itemName)}`
    });
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating reorder-point-change notification:', err);
    res.status(500).json({ success: false, error: 'Failed to create notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/minimal-stock/no-reorder-point/check { businessId, userId, days }
router.post('/minimal-stock/no-reorder-point/check', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, days = 7 } = req.body;
    if (!businessId || !userId) return res.status(400).json({ success: false, error: 'businessId and userId are required' });

    const rows = await client.query(
      `SELECT ii.item_id, ii.name, COALESCE(NULLIF(TRIM(gu.unit_symbol), ''), gu.unit_name) AS unit_label, ii.created_at
       FROM InventoryItems ii
       JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
       WHERE ii.business_id = $1
         AND ii.is_active = true
         AND (ii.reorder_point IS NULL OR ii.reorder_point = 0)
         AND ii.created_at <= NOW() - ($2::int || ' days')::interval
       ORDER BY ii.name`,
      [businessId, days]
    );

    let created = 0, skipped = 0;
    await client.query('BEGIN');
    if (rows.rows.length > 0) {
      const examples = rows.rows.slice(0, 5).map(r => r.name);
      const title = 'Warning: No Reorder Point Set';
      const description = `${rows.rows.length} item(s) have no reorder point set after ${days} days. Examples: ${examples.join(', ')}.`;
      const { skipped: wasSkipped } = await insertNotification(client, {
        businessId,
        userId,
        type: 'warning',
        title,
        description,
        relatedUrl: '/overview'
      });
      if (wasSkipped) skipped++; else created++;
    }
    await client.query('COMMIT');
    res.json({ success: true, created, skipped, total: rows.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error checking no-reorder-point items:', err);
    res.status(500).json({ success: false, error: 'Failed to check items', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/minimal-stock/reorder-summary { businessId, userId }
router.post('/minimal-stock/reorder-summary', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId } = req.body;
    if (!businessId || !userId) return res.status(400).json({ success: false, error: 'businessId and userId are required' });

    const alerts = await client.query(
      `SELECT ii.item_id, ii.name,
              COALESCE(NULLIF(TRIM(gu.unit_symbol), ''), gu.unit_name) AS unit_label,
              COALESCE(SUM(ib.quantity), 0) AS current_stock,
              ii.reorder_point
       FROM InventoryItems ii
       JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
       LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
       WHERE ii.business_id = $1 AND ii.is_active = true
       GROUP BY ii.item_id, ii.name, gu.unit_symbol, gu.unit_name, ii.reorder_point
       HAVING COALESCE(SUM(ib.quantity), 0) < COALESCE(ii.reorder_point, 0)
       ORDER BY ii.name`,
      [businessId]
    );

    await client.query('BEGIN');
    const count = alerts.rows.length;
    const examples = alerts.rows.slice(0, 5).map(r => r.name);
    const title = `Daily Summary: ${count} Item(s) Need Your Attention`;
    const description = count > 0
      ? `You have ${count} item(s) below their minimal stock level. Examples: ${examples.join(', ')}. Click to review and place orders.`
      : 'No items are currently below their minimal stock level.';

    await insertNotification(client, {
      businessId,
      userId,
      type: count > 0 ? 'warning' : 'success',
      title,
      description,
      relatedUrl: '/overview'
    });
    await client.query('COMMIT');
    res.json({ success: true, count });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating reorder summary notification:', err);
    res.status(500).json({ success: false, error: 'Failed to create summary notification', details: err.message });
  } finally {
    client.release();
  }
});

// =================== INGREDIENT MAPPING: MISSING INVENTORY ITEM ===================

// POST /api/notifications/ingredient-mapping/ingredient-not-in-inventory { businessId, userId, ingredientName }
router.post('/ingredient-mapping/ingredient-not-in-inventory', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, ingredientName } = req.body;
    if (!businessId || !userId || !ingredientName) {
      return res.status(400).json({ success: false, error: 'businessId, userId and ingredientName are required' });
    }
    await client.query('BEGIN');
    await insertNotification(client, {
      businessId,
      userId,
      type: 'warning',
      title: 'Warning: Ingredient Not Found in Inventory',
      description: `The ingredient "${ingredientName}" is not in your current inventory. Please add this item to your stock via the Stock In module before it can be added to a recipe.`,
      relatedUrl: `/stock-in?prefill=${encodeURIComponent(ingredientName)}`
    });
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating ingredient-not-in-inventory notification:', err);
    res.status(500).json({ success: false, error: 'Failed to create notification', details: err.message });
  } finally {
    client.release();
  }
});

// =================== VENDOR MANAGEMENT NOTIFICATIONS ===================

// POST /api/notifications/vendors/incomplete-details { businessId, userId, missingCount, examples }
// Create alert when vendor profiles are missing contact or metrics
router.post('/vendors/incomplete-details', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, missingCount, examples } = req.body;
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }

    await client.query('BEGIN');
    const countText = missingCount ? `${missingCount} vendor${missingCount > 1 ? 's' : ''}` : 'Some vendors';
    const examplesText = Array.isArray(examples) && examples.length > 0
      ? ` e.g., ${examples.slice(0, 3).join(', ')}${examples.length > 3 ? '...' : ''}`
      : '';

    await insertNotification(client, {
      businessId,
      userId,
      type: 'warning',
      title: 'Vendor Details Incomplete - Update Required',
      description: `${countText} are missing contact info or performance metrics.${examplesText} Complete vendor profiles to enable smart reordering and analytics.`,
      relatedUrl: '/vendors'
    });
    await client.query('COMMIT');
    res.json({ success: true, message: 'Incomplete vendor details notification created' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating vendor incomplete details notification:', err);
    res.status(500).json({ success: false, error: 'Failed to create vendor notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/vendors/performance-alert { businessId, userId, vendorName, metric, currentValue, previousValue }
// Create alert when vendor performance metric drops significantly
router.post('/vendors/performance-alert', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, vendorName, metric = 'On-time Delivery', currentValue, previousValue } = req.body;
    if (!businessId || !userId || !vendorName || currentValue === undefined) {
      return res.status(400).json({ success: false, error: 'businessId, userId, vendorName and currentValue are required' });
    }

    await client.query('BEGIN');
  const prevText = previousValue !== undefined && previousValue !== null ? ` (prev ${previousValue}%)` : '';
  const dropped = previousValue !== undefined && previousValue !== null && Number(currentValue) < Number(previousValue);
  const title = `Vendor Performance Alert: ${metric} ${dropped ? 'Dropped' : 'Updated'}`;
  const description = `Vendor "${vendorName}" ${metric.toLowerCase()} ${dropped ? 'fell to' : 'is at'} ${currentValue}%${prevText}. Review vendor performance and consider diversifying suppliers.`;

    await insertNotification(client, {
      businessId,
      userId,
  type: dropped ? 'warning' : 'info',
      title,
      description,
      relatedUrl: '/vendors'
    });
    await client.query('COMMIT');
    res.json({ success: true, message: 'Vendor performance alert notification created' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating vendor performance alert notification:', err);
    res.status(500).json({ success: false, error: 'Failed to create vendor performance notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/vendors/new-vendor-detected { businessId, userId, vendorName }
// Create info/confirmation when a new supplier is observed from OCR/stock-in
router.post('/vendors/new-vendor-detected', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, vendorName } = req.body;
    if (!businessId || !userId || !vendorName) {
      return res.status(400).json({ success: false, error: 'businessId, userId, and vendorName are required' });
    }

    await client.query('BEGIN');
    await insertNotification(client, {
      businessId,
      userId,
      type: 'success',
      title: 'New Vendor Detected',
      description: `We noticed purchases from a new supplier "${vendorName}". Confirm and add this vendor to your list for better tracking.`,
      relatedUrl: '/vendors'
    });
    await client.query('COMMIT');
    res.json({ success: true, message: 'New vendor detected notification created' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating new vendor detected notification:', err);
    res.status(500).json({ success: false, error: 'Failed to create new vendor notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/mark-all-read { userId, businessId }
router.post('/mark-all-read', async (req, res) => {
  try {
    const { userId, businessId } = req.body;
    if (!userId || !businessId) return res.status(400).json({ success: false, error: 'userId and businessId are required' });
    const result = await pool.query(
      `UPDATE UserNotifications
       SET is_read = true
       WHERE business_id = $1 AND user_id = $2 AND is_read = false`,
      [businessId, userId]
    );
    res.json({ success: true, updated: result.rowCount });
  } catch (err) {
    console.error('Error mark-all-read:', err);
    res.status(500).json({ success: false, error: 'Failed to mark all as read', details: err.message });
  }
});

// POST /api/notifications/dismiss { userId, ids: number[] }
router.post('/dismiss', async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId, ids } = req.body;
    if (!userId || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, error: 'userId and ids[] are required' });
    }
    await client.query('BEGIN');
    const result = await client.query(
      `DELETE FROM UserNotifications
       WHERE user_id = $1 AND notification_id = ANY($2::int[])`,
      [userId, ids]
    );
    await client.query('COMMIT');
    res.json({ success: true, deleted: result.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error dismissing notifications:', err);
    res.status(500).json({ success: false, error: 'Failed to dismiss notifications', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/generate/stock-alerts { businessId, userId }
// Derives notifications from current minimal-stock dashboard alerts
router.post('/generate/stock-alerts', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId } = req.body;
    if (!businessId || !userId) return res.status(400).json({ success: false, error: 'businessId and userId are required' });

    // Get current alerts (replicate query from minimal-stock dashboard endpoint)
    const alerts = await client.query(
      `SELECT 
         ii.item_id,
         ii.name,
         ii.reorder_point,
         ii.safety_stock,
         COALESCE(NULLIF(TRIM(gu.unit_symbol), ''), gu.unit_name) AS unit_label,
         COALESCE(SUM(ib.quantity), 0) AS current_stock,
         CASE 
           WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0) THEN 'critical'
           WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) THEN 'low'
           ELSE 'sufficient'
         END AS urgency_level
       FROM InventoryItems ii
       JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
       LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
       WHERE ii.business_id = $1 AND ii.is_active = true
       GROUP BY ii.item_id, ii.name, ii.reorder_point, ii.safety_stock, gu.unit_symbol, gu.unit_name
       HAVING 
         (COALESCE(SUM(ib.quantity), 0) < COALESCE(ii.reorder_point, 0) OR 
          COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0))
         AND (ii.reorder_point IS NOT NULL OR ii.safety_stock IS NOT NULL)
       ORDER BY ii.name`,
      [businessId]
    );

    let created = 0, skipped = 0;
    await client.query('BEGIN');
    for (const a of alerts.rows) {
      const type = a.urgency_level === 'critical' ? 'critical' : 'warning';
      const title = a.urgency_level === 'critical'
        ? `Urgent: Time to Reorder ${a.name}`
        : `Low Stock: ${a.name} is below reorder point`;
      const unit = a.unit_label ? ` ${a.unit_label}` : '';
      const description = a.urgency_level === 'critical'
        ? `Stock for ${a.name} is at ${a.current_stock}${unit}, below safety stock (${a.safety_stock ?? 'N/A'}${unit}).`
        : `${a.name} at ${a.current_stock}${unit}, below reorder point (${a.reorder_point ?? 'N/A'}${unit}).`;
      const { skipped: wasSkipped } = await insertNotification(client, {
        businessId,
        userId,
        type,
        title,
        description,
        relatedUrl: `/overview?focus=${a.item_id}`
      });
      if (wasSkipped) skipped++; else created++;
    }
    await client.query('COMMIT');

    res.json({ success: true, created, skipped, totalCandidates: alerts.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error generating stock alerts notifications:', err);
    res.status(500).json({ success: false, error: 'Failed to generate notifications from stock alerts', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/sync/stock-alerts { businessId, userId }
// Reconciles stock-alert notifications with current stock state: removes resolved ones, creates missing
router.post('/sync/stock-alerts', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId } = req.body;
    if (!businessId || !userId) return res.status(400).json({ success: false, error: 'businessId and userId are required' });

    // Current low/critical alerts
    const alerts = await client.query(
      `SELECT 
         ii.item_id,
         ii.name,
         ii.reorder_point,
         ii.safety_stock,
         COALESCE(NULLIF(TRIM(gu.unit_symbol), ''), gu.unit_name) AS unit_label,
         COALESCE(SUM(ib.quantity), 0) AS current_stock,
         CASE 
           WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0) THEN 'critical'
           WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) THEN 'low'
           ELSE 'sufficient'
         END AS urgency_level
       FROM InventoryItems ii
       JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
       LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
       WHERE ii.business_id = $1 AND ii.is_active = true
       GROUP BY ii.item_id, ii.name, ii.reorder_point, ii.safety_stock, gu.unit_symbol, gu.unit_name
       HAVING 
         (COALESCE(SUM(ib.quantity), 0) < COALESCE(ii.reorder_point, 0) OR 
          COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0))
         AND (ii.reorder_point IS NOT NULL OR ii.safety_stock IS NOT NULL)
       ORDER BY ii.name`,
      [businessId]
    );

    const current = new Map(); // item_id -> alert row
    for (const a of alerts.rows) current.set(String(a.item_id), a);

    // Existing stock-related notifications for this user/business (with or without related_url)
    const existing = await client.query(
      `SELECT notification_id, title, related_url
       FROM UserNotifications
       WHERE business_id = $1 AND user_id = $2
         AND (
           title ILIKE 'Urgent: Time to Reorder %' OR
           title ILIKE 'Low Stock: % is below reorder point'
         )`,
      [businessId, userId]
    );

    const parseFocusId = (url) => {
      if (!url) return null;
      const m = /[?&]focus=(\d+)/.exec(url);
      return m ? m[1] : null;
    };

  const existingByItem = new Map(); // item_id -> notification row
  const toDelete = [];
  const resolvedItemNames = new Set();
  const currentNames = new Set(Array.from(current.values()).map((a) => String(a.name).toLowerCase()));
  const resolvedItemIds = new Set();
    for (const n of existing.rows) {
      const itemId = parseFocusId(n.related_url);
      if (itemId) {
        if (!current.has(String(itemId))) {
          toDelete.push(n.notification_id);
          resolvedItemIds.add(String(itemId));
        } else {
          existingByItem.set(String(itemId), n);
        }
      } else {
        // Try parse by title when no related_url
        // Patterns: 'Urgent: Time to Reorder <name>' OR 'Low Stock: <name> is below reorder point'
        let name = null;
        const t = n.title || '';
        let m = /^Urgent: Time to Reorder\s+(.+)$/.exec(t);
        if (m && m[1]) name = m[1].trim();
        if (!name) {
          m = /^Low Stock:\s+(.+)\s+is below reorder point$/.exec(t);
          if (m && m[1]) name = m[1].trim();
        }
        if (name) {
          if (!currentNames.has(name.toLowerCase())) {
            toDelete.push(n.notification_id);
            resolvedItemNames.add(name);
          }
        }
      }
    }

    let deleted = 0, created = 0, skipped = 0;
    await client.query('BEGIN');

  if (toDelete.length > 0) {
      // Create success notifications for resolved items
      const idsArr = Array.from(resolvedItemIds).map((v) => parseInt(v, 10)).filter(Boolean);
      if (idsArr.length > 0) {
        const stocked = await client.query(
          `SELECT 
             ii.item_id,
             ii.name,
             ii.reorder_point,
             ii.safety_stock,
             COALESCE(NULLIF(TRIM(gu.unit_symbol), ''), gu.unit_name) AS unit_label,
             COALESCE(SUM(ib.quantity), 0) AS current_stock
           FROM InventoryItems ii
           JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
           LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
           WHERE ii.business_id = $1 AND ii.item_id = ANY($2::int[])
           GROUP BY ii.item_id, ii.name, ii.reorder_point, ii.safety_stock, gu.unit_symbol, gu.unit_name`,
          [businessId, idsArr]
        );
        for (const r of stocked.rows) {
          const title = `Restocked: ${r.name}`;
          const unitTxt = r.unit_label ? ` ${r.unit_label}` : '';
          const description = `Stock for ${r.name} is now ${r.current_stock}${unitTxt}, above reorder/safety thresholds.`;
          await insertNotification(client, {
            businessId,
            userId,
            type: 'success',
            title,
            description,
            relatedUrl: `/overview?focus=${r.item_id}`
          });
        }
      }

      // Also handle resolved by name (no related_url on original)
      const namesArr = Array.from(resolvedItemNames).map((s) => String(s).toLowerCase());
      if (namesArr.length > 0) {
        const stockedByName = await client.query(
          `SELECT 
             ii.item_id,
             ii.name,
             COALESCE(NULLIF(TRIM(gu.unit_symbol), ''), gu.unit_name) AS unit_label,
             COALESCE(SUM(ib.quantity), 0) AS current_stock
           FROM InventoryItems ii
           JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
           LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
           WHERE ii.business_id = $1 AND lower(ii.name) = ANY($2::text[])
           GROUP BY ii.item_id, ii.name, gu.unit_symbol, gu.unit_name`,
          [businessId, namesArr]
        );
        for (const r of stockedByName.rows) {
          const title = `Restocked: ${r.name}`;
          const unitTxt = r.unit_label ? ` ${r.unit_label}` : '';
          const description = `Stock for ${r.name} is now ${r.current_stock}${unitTxt}, above reorder/safety thresholds.`;
          await insertNotification(client, {
            businessId,
            userId,
            type: 'success',
            title,
            description,
            relatedUrl: `/overview?focus=${r.item_id}`
          });
        }
      }

      const del = await client.query(
        `DELETE FROM UserNotifications
         WHERE business_id = $1 AND user_id = $2 AND notification_id = ANY($3::int[])`,
        [businessId, userId, toDelete]
      );
      deleted = del.rowCount;
    }

    for (const [itemId, a] of current.entries()) {
      if (existingByItem.has(itemId)) continue; // already have a notification for this item
      const type = a.urgency_level === 'critical' ? 'critical' : 'warning';
      const title = a.urgency_level === 'critical'
        ? `Urgent: Time to Reorder ${a.name}`
        : `Low Stock: ${a.name} is below reorder point`;
      const unit = a.unit_label ? ` ${a.unit_label}` : '';
      const description = a.urgency_level === 'critical'
        ? `Stock for ${a.name} is at ${a.current_stock}${unit}, below safety stock (${a.safety_stock ?? 'N/A'}${unit}).`
        : `${a.name} at ${a.current_stock}${unit}, below reorder point (${a.reorder_point ?? 'N/A'}${unit}).`;
      const { skipped: wasSkipped } = await insertNotification(client, {
        businessId,
        userId,
        type,
        title,
        description,
        relatedUrl: `/overview?focus=${itemId}`
      });
      if (wasSkipped) skipped++; else created++;
    }

    await client.query('COMMIT');
    res.json({ success: true, created, deleted, skipped, totalCurrent: current.size });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error syncing stock alerts notifications:', err);
    res.status(500).json({ success: false, error: 'Failed to sync notifications from stock alerts', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/unit-mapping/check-setup { businessId, userId }
// Check unit mapping setup status and notify if incomplete
router.post('/unit-mapping/check-setup', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId } = req.body;
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }

    await client.query('BEGIN');

    // Set tenant context to ensure RLS policies work correctly
    try {
      await client.query(`SELECT set_config('rls.business_id', $1::text, true)`, [businessId]);
      console.log(`✅ Set tenant context for business_id: ${businessId}`);
    } catch (contextError) {
      console.warn('⚠️ Could not set tenant context, continuing without RLS context:', contextError.message);
    }

    // Check if business has unit conversions setup
    const conversionsCheck = await client.query(
      `SELECT COUNT(*)::int AS conversion_count
       FROM BusinessUnitConversions 
       WHERE business_id = $1`,
      [businessId]
    );

    const conversionCount = conversionsCheck.rows[0].conversion_count;
    
    // Check if business is marked as onboarded
    const businessCheck = await client.query(
      `SELECT is_onboarded FROM Businesses WHERE business_id = $1`,
      [businessId]
    );

    const isOnboarded = businessCheck.rows[0]?.is_onboarded || false;

    if (conversionCount === 0 || !isOnboarded) {
      // Create notification for incomplete setup with proper error handling
      const title = 'Unit Mapping Setup Required';
      const description = conversionCount === 0 
        ? 'Your business needs unit conversions configured to ensure accurate inventory tracking. Please complete the unit mapping setup by defining kitchen units and supplier conversions.'
        : 'Unit mapping setup is incomplete. Please complete the onboarding process to finish configuring your inventory system.';
      
      try {
        await insertNotification(client, {
          businessId,
          userId,
          type: 'warning',
          title,
          description,
          relatedUrl: '/settings'
        });
        console.log(`✅ Created unit mapping setup notification for business ${businessId}`);
      } catch (notificationError) {
        console.warn('⚠️ Could not create notification due to RLS policy:', notificationError.message);
        // Don't fail the entire request if notification creation fails
      }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      data: {
        conversions_count: conversionCount,
        is_onboarded: isOnboarded,
        needs_setup: conversionCount === 0 || !isOnboarded
      },
      message: conversionCount === 0 || !isOnboarded 
        ? 'Unit mapping setup notification created' 
        : 'Unit mapping setup is complete'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error checking unit mapping setup:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to check unit mapping setup', 
      details: err.message 
    });
  } finally {
    client.release();
  }
});

// POST /api/notifications/unit-mapping/validate-unit { businessId, userId, unit, itemName }
// Validate if a unit is mapped and notify if not
router.post('/unit-mapping/validate-unit', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, unit, itemName } = req.body;
    if (!businessId || !userId || !unit) {
      return res.status(400).json({ success: false, error: 'businessId, userId, and unit are required' });
    }

    await client.query('BEGIN');

    // Check if unit exists in global units
    const unitCheck = await client.query(
      `SELECT unit_id, unit_name, unit_symbol FROM GlobalUnits 
       WHERE (unit_symbol = $1 OR unit_name = $1) AND is_active = true`,
      [unit]
    );

    let unitFound = unitCheck.rows.length > 0;
    let isValid = false;

    if (unitFound) {
      // Check if there's a conversion for this unit in the business
      const conversionCheck = await client.query(
        `SELECT COUNT(*)::int AS conversion_count
         FROM BusinessUnitConversions bc
         JOIN GlobalUnits gu ON (bc.from_unit_id = gu.unit_id OR bc.to_unit_id = gu.unit_id)
         WHERE bc.business_id = $1 AND (gu.unit_symbol = $2 OR gu.unit_name = $2)`,
        [businessId, unit]
      );

      isValid = conversionCheck.rows[0].conversion_count > 0;
    }

    if (!unitFound || !isValid) {
      // Create notification for unmapped unit
      const title = `Unit Mapping Issue: "${unit}"`;
      const description = !unitFound 
        ? `The unit "${unit}" is not recognized in the system${itemName ? ` (used for item: "${itemName}")` : ''}. This may cause inventory tracking issues. Please add this unit to your system or use a standard unit instead.`
        : `The unit "${unit}" exists but is not properly mapped for your business${itemName ? ` (item: "${itemName}")` : ''}. Please configure unit conversions to ensure accurate inventory calculations.`;
      
      await insertNotification(client, {
        businessId,
        userId,
        type: 'warning',
        title,
        description,
        relatedUrl: '/map2'
      });
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      data: {
        unit,
        found: unitFound,
        valid: isValid,
        itemName: itemName || null
      },
      message: !unitFound || !isValid 
        ? 'Unit validation notification created'
        : 'Unit is valid and mapped'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error validating unit:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to validate unit', 
      details: err.message 
    });
  } finally {
    client.release();
  }
});

// POST /api/notifications/unit-mapping/notify-success { businessId, userId, action, details }
// Create success notification for unit mapping actions
router.post('/unit-mapping/notify-success', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, action, details } = req.body;
    if (!businessId || !userId || !action) {
      return res.status(400).json({ success: false, error: 'businessId, userId, and action are required' });
    }

    await client.query('BEGIN');

    let title, description, relatedUrl;

    switch (action) {
      case 'conversion_added':
        title = 'Unit Conversion Successfully Added';
        description = details 
          ? `Your unit conversion has been saved: ${details}. This will help ensure accurate inventory tracking and recipe calculations.`
          : 'A new unit conversion has been configured successfully. Your inventory system is now better equipped to handle different unit measurements.';
        relatedUrl = '/map2';
        break;
      case 'kitchen_units_saved':
        title = 'Kitchen Units Successfully Configured';
        description = 'Your kitchen unit conversions (cups, tablespoons, teaspoons, bowls) have been saved successfully. These will be used for recipe calculations and inventory management.';
        relatedUrl = '/map1';
        break;
      case 'setup_completed':
        title = 'Unit Mapping Setup Complete!';
        description = 'Congratulations! All unit mapping configurations have been completed successfully. Your inventory system is now fully configured and ready for accurate tracking.';
        relatedUrl = '/dashboard';
        break;
      default:
        title = 'Unit Mapping Operation Successful';
        description = details || 'Your unit mapping operation has been completed successfully. The system has been updated with your changes.';
        relatedUrl = '/map';
    }

    await insertNotification(client, {
      businessId,
      userId,
      type: 'success',
      title,
      description,
      relatedUrl
    });

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Success notification created',
      data: { action, title, description }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating success notification:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to create success notification', 
      details: err.message 
    });
  } finally {
    client.release();
  }
});

// POST /api/notifications/unit-mapping/audit { businessId, userId }
// Perform comprehensive unit mapping audit and create notifications
router.post('/unit-mapping/audit', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId } = req.body;
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }

    await client.query('BEGIN');

    // Get business setup status
    const businessStatus = await client.query(
      `SELECT is_onboarded FROM Businesses WHERE business_id = $1`,
      [businessId]
    );

    // Get conversion count
    const conversionStats = await client.query(
      `SELECT 
         COUNT(*)::int AS total_conversions,
         COUNT(CASE WHEN description ILIKE '%kitchen%' THEN 1 END)::int AS kitchen_conversions,
         COUNT(CASE WHEN description ILIKE '%supplier%' THEN 1 END)::int AS supplier_conversions
       FROM BusinessUnitConversions 
       WHERE business_id = $1`,
      [businessId]
    );

    // Check for unmapped units in inventory
    const unmappedUnits = await client.query(
      `SELECT DISTINCT gu.unit_symbol, COUNT(ii.item_id)::int AS item_count
       FROM InventoryItems ii
       JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
       LEFT JOIN BusinessUnitConversions bc ON (
         (bc.from_unit_id = gu.unit_id OR bc.to_unit_id = gu.unit_id) 
         AND bc.business_id = ii.business_id
       )
       WHERE ii.business_id = $1 AND ii.is_active = true AND bc.conversion_id IS NULL
       GROUP BY gu.unit_symbol
       ORDER BY item_count DESC`,
      [businessId]
    );

    const stats = conversionStats.rows[0];
    const isOnboarded = businessStatus.rows[0]?.is_onboarded || false;
    const hasUnmappedUnits = unmappedUnits.rows.length > 0;

    // Create audit notification
    let auditType = 'info';
    let auditTitle = 'Unit Mapping Audit Complete';
    let auditDescription = `Audit Results: ${stats.total_conversions} total conversions (${stats.kitchen_conversions} kitchen, ${stats.supplier_conversions} supplier)`;

    if (!isOnboarded || stats.total_conversions === 0) {
      auditType = 'warning';
      auditTitle = 'Unit Mapping Audit - Issues Found';
      auditDescription += '. Setup incomplete - please complete unit mapping configuration.';
    } else if (hasUnmappedUnits) {
      auditType = 'warning';
      auditTitle = 'Unit Mapping Audit - Unmapped Units Found';
      auditDescription += `. Found ${unmappedUnits.rows.length} unmapped unit types affecting ${unmappedUnits.rows.reduce((sum, row) => sum + row.item_count, 0)} items.`;
    } else {
      auditType = 'success';
      auditDescription += '. All units properly mapped.';
    }

    await insertNotification(client, {
      businessId,
      userId,
      type: auditType,
      title: auditTitle,
      description: auditDescription,
      relatedUrl: '/map'
    });

    await client.query('COMMIT');

    res.json({
      success: true,
      data: {
        is_onboarded: isOnboarded,
        conversions_count: stats.total_conversions,
        kitchen_conversions: stats.kitchen_conversions,
        supplier_conversions: stats.supplier_conversions,
        unmapped_units_count: unmappedUnits.rows.length,
        unmapped_units: unmappedUnits.rows,
        status: !isOnboarded || stats.total_conversions === 0 ? 'incomplete' : 
                hasUnmappedUnits ? 'partial' : 'complete'
      },
      message: 'Unit mapping audit completed and notification created'
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error performing unit mapping audit:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to perform unit mapping audit', 
      details: err.message 
    });
  } finally {
    client.release();
  }
});

// =================== STOCK OUT WASTE MODULE NOTIFICATIONS ===================

// POST /api/notifications/waste/successful-deduction { businessId, userId, date, totalItems, totalValue }
// Successful Deduction Summary notification
router.post('/waste/successful-deduction', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, date, totalItems, totalValue, deductedItems } = req.body;
    if (!businessId || !userId || !date) {
      return res.status(400).json({ success: false, error: 'businessId, userId, and date are required' });
    }

    await client.query('BEGIN');

    const title = 'Daily Stock Wastage Recorded Successfully';
    const description = `Your daily wastage for ${date} has been recorded. ${totalItems || 'Multiple'} items with total value of ${totalValue ? `₹${totalValue}` : 'N/A'} have been deducted from inventory.${deductedItems ? ` Items: ${deductedItems.slice(0, 3).join(', ')}${deductedItems.length > 3 ? '...' : ''}` : ''}`;

    await insertNotification(client, {
      businessId,
      userId,
      type: 'success',
      title,
      description,
      relatedUrl: '/reports'
    });

    await client.query('COMMIT');
    res.json({ success: true, message: 'Successful deduction notification created' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating wastage deduction notification:', err);
    res.status(500).json({ success: false, error: 'Failed to create notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/waste/stock-discrepancy { businessId, userId, itemName, attemptedQuantity, availableQuantity, negativeValue }
// Stock Discrepancy & Pilferage Flag notification
router.post('/waste/stock-discrepancy', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, itemName, attemptedQuantity, availableQuantity, negativeValue, isPilferage } = req.body;
    if (!businessId || !userId || !itemName) {
      return res.status(400).json({ success: false, error: 'businessId, userId, and itemName are required' });
    }

    await client.query('BEGIN');

    const unit = await getItemUnitLabel(client, businessId, itemName);
    const unitTxt = unit ? ` ${unit}` : '';
    const title = isPilferage ? `Urgent Alert: Suspected Pilferage - ${itemName}` : `Warning: Inventory Discrepancy - ${itemName}`;
    const description = isPilferage 
      ? `An unusually high discrepancy was recorded for ${itemName}. Your stock is now at ${negativeValue}${unitTxt}. This may indicate a data entry error or potential pilferage. Please perform an immediate physical stock check.`
      : `You are trying to deduct ${attemptedQuantity}${unitTxt} of ${itemName}, but only ${availableQuantity}${unitTxt} is available in stock. This will result in a negative stock value of ${negativeValue}${unitTxt}.`;

    await insertNotification(client, {
      businessId,
      userId,
      type: isPilferage ? 'critical' : 'warning',
      title,
      description,
      relatedUrl: '/overview'
    });

    await client.query('COMMIT');
    res.json({ success: true, message: 'Stock discrepancy notification created' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating stock discrepancy notification:', err);
    res.status(500).json({ success: false, error: 'Failed to create notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/waste/high-wastage { businessId, userId, itemName, quantity, threshold, percentage }
// High Wastage Alert notification
router.post('/waste/high-wastage', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, itemName, quantity, threshold, percentage } = req.body;
    if (!businessId || !userId || !itemName) {
      return res.status(400).json({ success: false, error: 'businessId, userId, and itemName are required' });
    }

    await client.query('BEGIN');

  const unit = await getItemUnitLabel(client, businessId, itemName);
  const unitTxt = unit ? ` ${unit}` : '';
  const title = `Wastage Alert: High Wastage for ${itemName}`;
  const description = `The wastage for ${itemName} today was ${quantity}${unitTxt}, which is ${percentage ? `${percentage}% ` : ''}higher than normal${threshold ? ` (threshold: ${threshold}${unitTxt})` : ''}. Please review your reports to identify the cause.`;

    await insertNotification(client, {
      businessId,
      userId,
      type: 'warning',
      title,
      description,
      relatedUrl: '/reports'
    });

    await client.query('COMMIT');
    res.json({ success: true, message: 'High wastage alert notification created' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating high wastage notification:', err);
    res.status(500).json({ success: false, error: 'Failed to create notification', details: err.message });
  } finally {
    client.release();
  }
});

// =================== STOCK OUT USAGE NOTIFICATIONS ===================

// POST /api/notifications/usage/successful-submission { businessId, userId, date, dishCount, totalIngredients }
// Successful Submission & Inventory Update notification
router.post('/usage/successful-submission', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, date, dishCount, totalIngredients, dishNames } = req.body;
    if (!businessId || !userId || !date) {
      return res.status(400).json({ success: false, error: 'businessId, userId, and date are required' });
    }

    await client.query('BEGIN');

    const title = 'Daily Stock Usage Recorded';
    const description = `Your daily sales for ${date} have been processed. The inventory has been updated, and the corresponding ingredients for ${dishCount || 'multiple'} dishes have been deducted.${dishNames ? ` Dishes: ${dishNames.slice(0, 3).join(', ')}${dishNames.length > 3 ? '...' : ''}` : ''} All reports have been refreshed.`;

    await insertNotification(client, {
      businessId,
      userId,
      type: 'success',
      title,
      description,
      relatedUrl: '/reports/daily'
    });

    await client.query('COMMIT');
    res.json({ success: true, message: 'Successful submission notification created' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating usage submission notification:', err);
    res.status(500).json({ success: false, error: 'Failed to create notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/usage/incomplete-recipe { businessId, userId, dishName, missingIngredients }
// Incomplete Recipe Mapping Alert notification
router.post('/usage/incomplete-recipe', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, dishName, missingIngredients } = req.body;
    if (!businessId || !userId || !dishName) {
      return res.status(400).json({ success: false, error: 'businessId, userId, and dishName are required' });
    }

    await client.query('BEGIN');

    const title = `Warning: Incomplete Recipe for ${dishName}`;
    const description = `The recipe for ${dishName} is incomplete. To ensure accurate stock deductions, please add all ingredients to the recipe before recording its sale.${missingIngredients ? ` Missing: ${missingIngredients.join(', ')}` : ''}`;

    await insertNotification(client, {
      businessId,
      userId,
      type: 'warning',
      title,
      description,
      relatedUrl: '/recipes'
    });

    await client.query('COMMIT');
    res.json({ success: true, message: 'Incomplete recipe notification created' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating incomplete recipe notification:', err);
    res.status(500).json({ success: false, error: 'Failed to create notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/usage/recipe-discrepancy { businessId, userId, dishName, itemName, negativeQuantity }
// Stock Discrepancy for Recipe notification
router.post('/usage/recipe-discrepancy', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, dishName, itemName, negativeQuantity } = req.body;
    if (!businessId || !userId || !dishName || !itemName) {
      return res.status(400).json({ success: false, error: 'businessId, userId, dishName, and itemName are required' });
    }

    await client.query('BEGIN');

  const unit = await getItemUnitLabel(client, businessId, itemName);
  const unitTxt = unit ? ` ${unit}` : '';
  const title = `Warning: Inventory Discrepancy for ${itemName}`;
  const description = `The sale of ${dishName} will result in a negative stock for ${itemName}. Your inventory for this item will be at ${negativeQuantity}${unitTxt}. This may indicate a physical stock count error. Do you wish to proceed?`;

    await insertNotification(client, {
      businessId,
      userId,
      type: 'warning',
      title,
      description,
      relatedUrl: `/overview?focus=${itemName}`
    });

    await client.query('COMMIT');
    res.json({ success: true, message: 'Recipe discrepancy notification created' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating recipe discrepancy notification:', err);
    res.status(500).json({ success: false, error: 'Failed to create notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/usage/unusual-sales { businessId, userId, date, actualVolume, averageVolume, percentage, isHigh }
// Unusual Sales Volume Alert notification
router.post('/usage/unusual-sales', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, date, actualVolume, averageVolume, percentage, isHigh } = req.body;
    if (!businessId || !userId || !date) {
      return res.status(400).json({ success: false, error: 'businessId, userId, and date are required' });
    }

    await client.query('BEGIN');

    const title = 'Alert: Unusual Sales Volume';
    const description = `Today's sales volume is ${percentage || 'significantly'} ${isHigh ? 'higher' : 'lower'} than your daily average${averageVolume ? ` (${averageVolume})` : ''}. This may be a ${isHigh ? 'great sales day' : 'slow day'} or indicate a data entry error. Please review the report to confirm.`;

    await insertNotification(client, {
      businessId,
      userId,
      type: 'info',
      title,
      description,
      relatedUrl: `/reports/daily?date=${date}`
    });

    await client.query('COMMIT');
    res.json({ success: true, message: 'Unusual sales volume notification created' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating unusual sales notification:', err);
    res.status(500).json({ success: false, error: 'Failed to create notification', details: err.message });
  } finally {
    client.release();
  }
});

// =================== EXPIRY ALERTS NOTIFICATIONS ===================

// POST /api/notifications/expiry/warning { businessId, userId, itemName, expiryDate, daysRemaining }
// Expiry Warning Alert notification
router.post('/expiry/warning', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, itemName, expiryDate, daysRemaining, quantity, batchId } = req.body;
    if (!businessId || !userId || !itemName || !expiryDate) {
      return res.status(400).json({ success: false, error: 'businessId, userId, itemName, and expiryDate are required' });
    }

    await client.query('BEGIN');

  const unit = await getItemUnitLabel(client, businessId, itemName);
  const unitTxt = unit ? ` ${unit}` : '';
  const title = `Warning: ${itemName} is Expiring Soon`;
  const description = `The ${itemName} you have in stock will expire ${daysRemaining ? `in ${daysRemaining} days` : `on ${expiryDate}`}${quantity ? ` (Quantity: ${quantity}${unitTxt})` : ''}. Please use this item immediately to prevent wastage.`;

    await insertNotification(client, {
      businessId,
      userId,
      type: 'warning',
      title,
      description,
      relatedUrl: '/overview'
    });

    await client.query('COMMIT');
    res.json({ success: true, message: 'Expiry warning notification created' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating expiry warning notification:', err);
    res.status(500).json({ success: false, error: 'Failed to create notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/expiry/automatic-wastage { businessId, userId, itemName, expiryDate, quantity, wastageCost }
// Automatic Wastage Notification
router.post('/expiry/automatic-wastage', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, itemName, expiryDate, quantity, wastageCost, batchId } = req.body;
    if (!businessId || !userId || !itemName || !expiryDate) {
      return res.status(400).json({ success: false, error: 'businessId, userId, itemName, and expiryDate are required' });
    }

    await client.query('BEGIN');

  const unit = await getItemUnitLabel(client, businessId, itemName);
  const unitTxt = unit ? ` ${unit}` : '';
  const title = `Alert: Expired Stock Detected - ${itemName}`;
  const description = `The ${itemName} in your inventory expired on ${expiryDate}. We have automatically deducted the remaining stock${quantity ? ` of ${quantity}${unitTxt}` : ''} from your inventory to ensure accuracy.${wastageCost ? ` The wastage cost of ₹${wastageCost} has been updated in your reports.` : ' The wastage cost has been updated in your reports.'}`;

    await insertNotification(client, {
      businessId,
      userId,
      type: 'critical',
      title,
      description,
      relatedUrl: '/reports'
    });

    await client.query('COMMIT');
    res.json({ success: true, message: 'Automatic wastage notification created' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating automatic wastage notification:', err);
    res.status(500).json({ success: false, error: 'Failed to create notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/expiry/check-expiring { businessId, userId, daysAhead }
// Check for expiring items and create notifications
router.post('/expiry/check-expiring', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, daysAhead = 3 } = req.body;
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }

    await client.query('BEGIN');

    // Get items expiring within the specified timeframe
    const expiringItems = await client.query(`
      SELECT 
        ii.name as item_name,
        ib.batch_id,
        ib.quantity,
        ib.expiry_date,
        COALESCE(NULLIF(TRIM(gu.unit_symbol), ''), gu.unit_name) AS unit_label,
        EXTRACT(DAY FROM (ib.expiry_date - CURRENT_DATE)) as days_remaining
      FROM InventoryBatches ib
      JOIN InventoryItems ii ON ib.item_id = ii.item_id
      JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
      WHERE ii.business_id = $1 
        AND ib.expiry_date IS NOT NULL
        AND ib.expiry_date <= CURRENT_DATE + INTERVAL '${daysAhead} days'
        AND ib.expiry_date > CURRENT_DATE
        AND ib.quantity > 0
      ORDER BY ib.expiry_date ASC
    `, [businessId]);

    let created = 0, skipped = 0;

    for (const item of expiringItems.rows) {
  const title = `Warning: ${item.item_name} is Expiring Soon`;
  const unitTxt = item.unit_label ? ` ${item.unit_label}` : '';
  const description = `The ${item.item_name} you have in stock will expire in ${item.days_remaining} days (Quantity: ${item.quantity}${unitTxt}). Please use this item immediately to prevent wastage.`;
      
      const { skipped: wasSkipped } = await insertNotification(client, {
        businessId,
        userId,
        type: 'warning',
        title,
        description,
        relatedUrl: `/overview?focus=${item.item_name}&batch=${item.batch_id}`
      });
      
      if (wasSkipped) skipped++; else created++;
    }

    await client.query('COMMIT');
    res.json({ 
      success: true, 
      message: `Expiry check completed: ${created} new notifications, ${skipped} skipped`,
      data: { created, skipped, totalChecked: expiringItems.rows.length }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error checking expiring items:', err);
    res.status(500).json({ success: false, error: 'Failed to check expiring items', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/expiry/daily-check { businessId, userId }
// Daily automated check for expiring items and expired items
router.post('/expiry/daily-check', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId } = req.body;
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }

    await client.query('BEGIN');

    // Check for items expiring in next 3 days
    const expiringItems = await client.query(`
      SELECT 
        ii.name as item_name,
        ib.batch_id,
        ib.quantity,
        ib.expiry_date,
        COALESCE(NULLIF(TRIM(gu.unit_symbol), ''), gu.unit_name) AS unit_label,
        EXTRACT(DAY FROM (ib.expiry_date - CURRENT_DATE)) as days_remaining
      FROM InventoryBatches ib
      JOIN InventoryItems ii ON ib.item_id = ii.item_id
      JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
      WHERE ii.business_id = $1 
        AND ib.expiry_date IS NOT NULL
        AND ib.expiry_date <= CURRENT_DATE + INTERVAL '3 days'
        AND ib.expiry_date > CURRENT_DATE
        AND ib.quantity > 0
        AND ib.is_expired = false
      ORDER BY ib.expiry_date ASC
    `, [businessId]);

    // Check for expired items (today and before)
    const expiredItems = await client.query(`
      SELECT 
        ii.name as item_name,
        ib.batch_id,
        ib.quantity,
        ib.expiry_date,
        ib.unit_cost,
        COALESCE(NULLIF(TRIM(gu.unit_symbol), ''), gu.unit_name) AS unit_label
      FROM InventoryBatches ib
      JOIN InventoryItems ii ON ib.item_id = ii.item_id
      JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
      WHERE ii.business_id = $1 
        AND ib.expiry_date IS NOT NULL
        AND ib.expiry_date <= CURRENT_DATE
        AND ib.quantity > 0
        AND ib.is_expired = false
      ORDER BY ib.expiry_date DESC
    `, [businessId]);

    let expiryWarnings = 0, expiredNotifications = 0;

    // Create expiry warning notifications
    for (const item of expiringItems.rows) {
      const { skipped: wasSkipped } = await insertNotification(client, {
        businessId,
        userId,
        type: 'warning',
        title: `Warning: ${item.item_name} is Expiring Soon`,
        description: `The ${item.item_name} you have in stock will expire in ${item.days_remaining} days (Quantity: ${item.quantity}${item.unit_label ? ` ${item.unit_label}` : ''}). Please use this item immediately to prevent wastage.`,
        relatedUrl: `/overview?focus=${item.item_name}&batch=${item.batch_id}`
      });
      if (!wasSkipped) expiryWarnings++;
    }

    // Process expired items - mark as expired and create notifications
    for (const item of expiredItems.rows) {
  const wastageCost = parseFloat(item.quantity) * parseFloat(item.unit_cost || 0);
      
      // Mark batch as expired
      await client.query(
        'UPDATE InventoryBatches SET is_expired = true, updated_at = NOW() WHERE batch_id = $1',
        [item.batch_id]
      );

      // Create automatic wastage notification
      const { skipped: wasSkipped } = await insertNotification(client, {
        businessId,
        userId,
        type: 'critical',
        title: `Alert: Expired Stock Detected - ${item.item_name}`,
        description: `The ${item.item_name} in your inventory expired on ${item.expiry_date.toISOString().split('T')[0]}. We have automatically marked the stock of ${item.quantity}${item.unit_label ? ` ${item.unit_label}` : ''} as expired to ensure accuracy. The wastage cost of ₹${wastageCost.toFixed(2)} has been updated in your reports.`,
        relatedUrl: '/reports'
      });
      if (!wasSkipped) expiredNotifications++;
    }

    await client.query('COMMIT');
    
    res.json({ 
      success: true, 
      message: `Daily expiry check completed`,
      data: { 
        expiryWarnings,
        expiredNotifications,
        totalExpiringItems: expiringItems.rows.length,
        totalExpiredItems: expiredItems.rows.length
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error in daily expiry check:', err);
    res.status(500).json({ success: false, error: 'Failed to perform daily expiry check', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/test-all { businessId, userId }
// Test endpoint to create sample notifications for all new categories
router.post('/test-all', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId = 1, userId = 1 } = req.body;
    
    await client.query('BEGIN');

    const testNotifications = [
      // Waste Module Tests
      {
        type: 'success',
        title: 'Daily Stock Wastage Recorded Successfully',
        description: 'Your daily wastage for 2025-08-25 has been recorded. 3 items with total value of ₹250 have been deducted from inventory. Items: Tomatoes, Onions, Milk',
        relatedUrl: '/reports'
      },
      {
        type: 'warning',
        title: 'Warning: Inventory Discrepancy - Flour',
        description: 'You are trying to deduct 5kg of Flour, but only 2kg is available in stock. This will result in a negative stock value of -3kg.',
        relatedUrl: '/overview?focus=Flour'
      },
      {
        type: 'warning',
        title: 'Wastage Alert: High Wastage for Vegetables',
        description: 'The wastage for Vegetables today was 2kg, which is 150% higher than normal (threshold: 0.8kg). Please review your reports to identify the cause.'
      },

      // Usage Module Tests  
      {
        type: 'success',
        title: 'Daily Stock Usage Recorded',
        description: 'Your daily sales for 2025-08-25 have been processed. The inventory has been updated, and the corresponding ingredients for 15 dishes have been deducted. Dishes: Biryani, Dal, Curry. All reports have been refreshed.',
        relatedUrl: '/reports/daily'
      },
      {
        type: 'warning',
        title: 'Warning: Incomplete Recipe for Chicken Curry',
        description: 'The recipe for Chicken Curry is incomplete. To ensure accurate stock deductions, please add all ingredients to the recipe before recording its sale. Missing: Recipe mapping required',
        relatedUrl: '/recipes'
      },
      {
        type: 'info',
        title: 'Alert: Unusual Sales Volume',
        description: 'Today\'s sales volume is 180% higher than your daily average (10-15 items). This may be a great sales day or indicate a data entry error. Please review the report to confirm.'
      },

      // Expiry Module Tests
      {
        type: 'warning',
        title: 'Warning: Milk is Expiring Soon',
        description: 'The Milk you have in stock will expire in 2 days (Quantity: 5 liters). Please use this item immediately to prevent wastage.',
        relatedUrl: '/overview?focus=Milk&batch=123'
      },
      {
        type: 'critical',
        title: 'Alert: Expired Stock Detected - Bread',
        description: 'The Bread in your inventory expired on 2025-08-24. We have automatically deducted the remaining stock of 10 pieces from your inventory to ensure accuracy. The wastage cost of ₹80 has been updated in your reports.'
      },

      // Vendor Module Tests
      {
        type: 'warning',
        title: 'Vendor Details Incomplete - Update Required',
        description: 'Some vendors are missing contact info or performance metrics. Complete vendor profiles to enable smart reordering and analytics.',
        relatedUrl: '/vendors'
      },
      {
        type: 'info',
        title: 'Vendor Performance Alert: On-time Delivery Dropped',
        description: 'Vendor "Fresh Farms" on-time delivery rate fell to 78% (prev 92%). Review vendor performance and consider diversifying suppliers.'
      },
      {
        type: 'success',
        title: 'New Vendor Detected',
        description: 'We noticed purchases from a new supplier "AgriHub Distributors". Confirm and add this vendor to your list for better tracking.'
      }
    ];

    let created = 0;
    for (const notif of testNotifications) {
      const { skipped } = await insertNotification(client, {
        businessId,
        userId,
        ...notif
      });
      if (!skipped) created++;
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Test notifications created: ${created} new, ${testNotifications.length - created} skipped`,
      data: { created, total: testNotifications.length }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating test notifications:', err);
    res.status(500).json({ success: false, error: 'Failed to create test notifications', details: err.message });
  } finally {
    client.release();
  }
});

// -------- REPORTS NOTIFICATIONS --------

// REPORTS: End-of-Day summary
// POST /api/notifications/reports/eod-summary { businessId, userId, date? (YYYY-MM-DD) }
router.post('/reports/eod-summary', async (req, res) => {
  const { client, release } = await getReqClient(req);
  try {
    const { businessId, userId, date } = req.body;
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }

    const day = date || new Date().toISOString().slice(0, 10);
    await client.query('BEGIN');

    const title = `End of Day Report Ready — ${day}`;
    const description = `Your daily report for ${day} is ready. View sales, wastage, usage, and inventory impact.`;
    const actionText = 'View Daily Report';
    const relatedUrl = `/reports/daily?date=${encodeURIComponent(day)}`;

    const { skipped, notificationId } = await insertNotification(client, {
      businessId,
      userId,
      type: 'info',
      title,
      description,
      actionText,
      relatedUrl,
      payload: { date: day, source: 'eod' },
    });

    await client.query('COMMIT');
    return res.json({ success: true, skipped, notificationId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating EOD report notification:', err);
    return res.status(500).json({ success: false, error: 'Failed to create EOD report notification', details: err.message });
  } finally {
    release();
  }
});

// REPORTS: Performance Anomaly Alert
// POST /api/notifications/reports/performance-anomaly { businessId, userId, date?, metric, current, baselineAvg, deviationPct }
router.post('/reports/performance-anomaly', async (req, res) => {
  const { client, release } = await getReqClient(req);
  try {
    const { businessId, userId, date, metric, current, baselineAvg, deviationPct } = req.body;
    if (!businessId || !userId || !metric || typeof current === 'undefined' || typeof baselineAvg === 'undefined') {
      return res.status(400).json({ success: false, error: 'businessId, userId, metric, current, baselineAvg are required' });
    }

    const day = date || new Date().toISOString().slice(0, 10);
    await client.query('BEGIN');

    const deltaPct = typeof deviationPct === 'number'
      ? deviationPct
      : (baselineAvg === 0 ? 0 : ((current - baselineAvg) / Math.abs(baselineAvg)) * 100);

    const severity = Math.abs(deltaPct) >= 20 ? 'warning' : 'info';
    const title = `Performance Alert: Unusual ${metric} on ${day}`;
    const description = `Today's ${metric} is ${current} vs avg ${baselineAvg.toFixed ? baselineAvg.toFixed(2) : baselineAvg} (${deltaPct.toFixed ? deltaPct.toFixed(1) : deltaPct}% deviation). Review details.`;
    const actionText = 'View Day Details';
    const relatedUrl = `/reports/daily?date=${encodeURIComponent(day)}&metric=${encodeURIComponent(metric)}`;

    const { skipped, notificationId } = await insertNotification(client, {
      businessId,
      userId,
      type: severity,
      title,
      description,
      actionText,
      relatedUrl,
      payload: { date: day, metric, current, baselineAvg, deviationPct: deltaPct },
    });

    await client.query('COMMIT');
    return res.json({ success: true, skipped, notificationId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating performance anomaly notification:', err);
    return res.status(500).json({ success: false, error: 'Failed to create performance anomaly notification', details: err.message });
  } finally {
    release();
  }
});

// REPORTS: High Wastage Trend Alert
// POST /api/notifications/reports/high-wastage-trend { businessId, userId, periodDays=7, increasePct, topItems?: [{itemId, name, qty, cost}] }
router.post('/reports/high-wastage-trend', async (req, res) => {
  const { client, release } = await getReqClient(req);
  try {
    const { businessId, userId, periodDays, increasePct, topItems } = req.body;
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }

    const days = Number.isFinite(periodDays) ? periodDays : 7;
    await client.query('BEGIN');

    const title = `Wastage Alert: Trend Up in Last ${days} Day(s)`;
    const inc = Number.isFinite(increasePct) ? increasePct.toFixed(1) : '—';
    const leading = Array.isArray(topItems) && topItems.length ? ` Top items: ${topItems.slice(0, 3).map(t => t.name).join(', ')}.` : '';
    const description = `Your wastage cost trend is up by ${inc}% over the last ${days} day(s).${leading}`;
    const actionText = 'View Wastage Report';
    const relatedUrl = `/reports/wastage?range=${days}d`;

    const { skipped, notificationId } = await insertNotification(client, {
      businessId,
      userId,
      type: 'warning',
      title,
      description,
      actionText,
      relatedUrl,
      payload: { periodDays: days, increasePct, topItems: topItems || [] },
    });

    await client.query('COMMIT');
    return res.json({ success: true, skipped, notificationId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating high wastage trend notification:', err);
    return res.status(500).json({ success: false, error: 'Failed to create high wastage trend notification', details: err.message });
  } finally {
    release();
  }
});

// REPORTS: Low-Margin Item Alert
// POST /api/notifications/reports/low-margin-item { businessId, userId, itemId, itemName, marginPct, avgCost, avgPrice, volume }
router.post('/reports/low-margin-item', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, itemId, itemName, marginPct, avgCost, avgPrice, volume } = req.body;
    if (!businessId || !userId || !itemId || !itemName || typeof marginPct === 'undefined') {
      return res.status(400).json({ success: false, error: 'businessId, userId, itemId, itemName, marginPct are required' });
    }

    await client.query('BEGIN');

    const title = `Profitability Alert: Review ${itemName}`;
    const description = `Gross margin is ${Number(marginPct).toFixed(1)}%. Avg Cost ₹${Number(avgCost || 0).toFixed(2)}, Avg Price ₹${Number(avgPrice || 0).toFixed(2)}, Volume ${Number(volume || 0)}. Consider recipe/pricing review.`;
    const actionText = 'Open Item Report';
    const relatedUrl = `/reports/item-profitability?itemId=${encodeURIComponent(itemId)}`;

    const { skipped, notificationId } = await insertNotification(client, {
      businessId,
      userId,
      type: 'warning',
      title,
      description,
      actionText,
      relatedUrl,
      payload: { itemId, itemName, marginPct, avgCost, avgPrice, volume },
    });

    await client.query('COMMIT');
    return res.json({ success: true, skipped, notificationId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating low margin item notification:', err);
    return res.status(500).json({ success: false, error: 'Failed to create low margin item notification', details: err.message });
  } finally {
    client.release();
  }
});

// REPORTS: Monthly Report Ready
// POST /api/notifications/reports/monthly-ready { businessId, userId, month } // month: '2025-08'
router.post('/reports/monthly-ready', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, month } = req.body;
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }

    const ym = month || new Date().toISOString().slice(0, 7);
    await client.query('BEGIN');

    const title = `Your Monthly Report for ${ym} is Ready`;
    const description = `Your comprehensive monthly report for ${ym} is ready. Review sales, costs, profits, and inventory KPIs.`;
    const actionText = 'View Monthly Report';
    const relatedUrl = `/reports/monthly?month=${encodeURIComponent(ym)}`;

    const { skipped, notificationId } = await insertNotification(client, {
      businessId,
      userId,
      type: 'info',
      title,
      description,
      actionText,
      relatedUrl,
      payload: { month: ym },
    });

    await client.query('COMMIT');
    return res.json({ success: true, skipped, notificationId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating monthly report notification:', err);
    return res.status(500).json({ success: false, error: 'Failed to create monthly report notification', details: err.message });
  } finally {
    client.release();
  }
});

// REPORTS: Missing Daily Report Alert (for waste & usage)
// POST /api/notifications/reports/missing-daily-report { businessId, userId, date? }
// Uses notifications history to infer missing submissions.
router.post('/reports/missing-daily-report', async (req, res) => {
  const { client, release } = await getReqClient(req);
  try {
    const { businessId, userId, date } = req.body;
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }

    const day = date || new Date().toISOString().slice(0, 10);
    const start = `${day} 00:00:00+00`;
    const end = `${day} 23:59:59+00`;

    await client.query('BEGIN');

    // Heuristics: check in UserNotifications (correct table)
    const usageCheck = await client.query(
      `SELECT 1
         FROM UserNotifications
        WHERE business_id = $1
          AND created_at BETWEEN $2 AND $3
          AND (
              LOWER(title) LIKE '%stock usage recorded%'
           OR LOWER(title) LIKE '%stockout recorded%'
           OR LOWER(title) LIKE '%usage submission%'
          )
        LIMIT 1`,
      [businessId, start, end]
    );

    const wasteCheck = await client.query(
      `SELECT 1
         FROM UserNotifications
        WHERE business_id = $1
          AND created_at BETWEEN $2 AND $3
          AND (
              LOWER(title) LIKE '%successful deduction%'
           OR LOWER(title) LIKE '%wastage recorded%'
           OR LOWER(title) LIKE '%stock deduction recorded%'
          )
        LIMIT 1`,
      [businessId, start, end]
    );

    let created = 0;

    if (usageCheck.rowCount === 0) {
      const title = `Reminder: Daily Stock Out Report Due — ${day}`;
      const description = `Your daily stock usage report for ${day} has not been submitted. Please record sales and wastage to keep inventory accurate.`;
      const relatedUrl = '/todays-sales-report';
      const result = await insertNotification(client, {
        businessId,
        userId,
        type: 'warning',
        title,
        description,
        relatedUrl,
      });
      if (!result.skipped) created++;
    }

    if (wasteCheck.rowCount === 0) {
      const title = `Reminder: Daily Wastage Report Due — ${day}`;
      const description = `Your daily wastage report for ${day} has not been submitted. Please record wastage to keep inventory and reports accurate.`;
      const relatedUrl = '/todays-sales-report';
      const result = await insertNotification(client, {
        businessId,
        userId,
        type: 'warning',
        title,
        description,
        relatedUrl,
      });
      if (!result.skipped) created++;
    }

    await client.query('COMMIT');
    return res.json({ success: true, created });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating missing daily report notifications:', err);
    return res.status(500).json({ success: false, error: 'Failed to create missing daily report notifications', details: err.message });
  } finally {
    release();
  }
});

// =================== INGREDIENT-BASED MAPPING NOTIFICATIONS ===================

// Helper: find conversion factor from one unit to another for a business
async function getConversionFactor(client, businessId, fromUnitId, toUnitId) {
  if (!fromUnitId || !toUnitId) return null;
  if (Number(fromUnitId) === Number(toUnitId)) return 1;
  try {
    const q = await client.query(
      `SELECT conversion_factor, direction FROM (
         SELECT bc.conversion_factor, 'forward'::text AS direction
         FROM BusinessUnitConversions bc
         WHERE bc.business_id = $1 AND bc.from_unit_id = $2 AND bc.to_unit_id = $3
         UNION ALL
         SELECT 1.0 / NULLIF(bc.conversion_factor, 0), 'reverse'::text AS direction
         FROM BusinessUnitConversions bc
         WHERE bc.business_id = $1 AND bc.from_unit_id = $3 AND bc.to_unit_id = $2
       ) x LIMIT 1`,
      [businessId, fromUnitId, toUnitId]
    );
    return q.rows[0]?.conversion_factor || null;
  } catch (_) {
    return null;
  }
}

// POST /api/notifications/ingredient-mapping/check-incomplete-recipes { businessId, userId, sampleLimit? }
// Flags dishes with missing recipe or zero/invalid ingredients
router.post('/ingredient-mapping/check-incomplete-recipes', async (req, res) => {
  const client = await pool.connect();
  try {
  const { businessId, userId, sampleLimit = 5, mode = 'summary', maxPerRun = 5 } = req.body;
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }

    const rows = await client.query(
      `SELECT mi.menu_item_id, mi.name AS dish_name,
              (r.recipe_id IS NULL) AS no_recipe,
              COUNT(ri.recipe_ingredient_id)::int AS ingredient_count,
              COUNT(CASE WHEN ri.quantity IS NULL OR ri.quantity <= 0 OR ri.unit_id IS NULL THEN 1 END)::int AS invalid_count
       FROM MenuItems mi
       LEFT JOIN Recipes r ON r.recipe_id = mi.menu_item_id
       LEFT JOIN RecipeIngredients ri ON ri.recipe_id = r.recipe_id
       WHERE mi.business_id = $1 AND mi.is_active = true
       GROUP BY mi.menu_item_id, mi.name, r.recipe_id
       HAVING (r.recipe_id IS NULL OR COUNT(ri.recipe_ingredient_id) = 0 OR COUNT(CASE WHEN ri.quantity IS NULL OR ri.quantity <= 0 OR ri.unit_id IS NULL THEN 1 END) > 0)
       ORDER BY mi.name`,
      [businessId]
    );

    let created = 0, skipped = 0;
    await client.query('BEGIN');
    const recs = rows.rows;
    if (mode === 'summary' || recs.length > maxPerRun) {
      const examples = recs.slice(0, sampleLimit).map(r => r.dish_name);
      const title = 'Incomplete Recipes Detected';
      const description = `${recs.length} dishes have incomplete recipes. Examples: ${examples.join(', ')}. Please add all ingredients with valid units and quantities.`;
      const { skipped: wasSkipped } = await insertNotification(client, {
        businessId, userId, type: 'warning', title, description, relatedUrl: '/recipes?unmapped=true'
      });
      if (wasSkipped) skipped++; else created++;
    } else {
      for (const r of recs) {
        const reasons = [];
        if (r.no_recipe) reasons.push('no recipe linked');
        if (!r.no_recipe && r.ingredient_count === 0) reasons.push('no ingredients added');
        if (r.invalid_count > 0) reasons.push(`${r.invalid_count} invalid ingredient row(s)`);
        const title = `Incomplete Recipe: ${r.dish_name}`;
        const description = `The recipe for ${r.dish_name} is incomplete (${reasons.join(', ')}). Add all ingredients with valid units and quantities to ensure accurate deductions and costing.`;
        const { skipped: wasSkipped } = await insertNotification(client, {
          businessId,
          userId,
          type: 'warning',
          title,
          description,
          relatedUrl: `/recipes?dish=${r.menu_item_id}`
        });
        if (wasSkipped) skipped++; else created++;
      }
    }
    await client.query('COMMIT');

    // Summarize with sample examples for UI convenience
    const examples = rows.rows.slice(0, sampleLimit).map(r => r.dish_name);
  res.json({ success: true, created, skipped, total: rows.rows.length, examples });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error checking incomplete recipes:', err);
    res.status(500).json({ success: false, error: 'Failed to check incomplete recipes', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/ingredient-mapping/check-unmapped-ingredients { businessId, userId }
// Warns when a recipe ingredient unit isn't mapped to the inventory item standard unit
router.post('/ingredient-mapping/check-unmapped-ingredients', async (req, res) => {
  const client = await pool.connect();
  try {
  const { businessId, userId, mode = 'summary', maxPerRun = 10 } = req.body;
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }

    const rows = await client.query(
      `SELECT mi.menu_item_id AS dish_id, mi.name AS dish_name,
              ii.item_id, ii.name AS ingredient_name,
              ri.unit_id AS recipe_unit_id, ii.standard_unit_id,
              gu1.unit_symbol AS recipe_unit_symbol, gu2.unit_symbol AS standard_unit_symbol
       FROM RecipeIngredients ri
       JOIN Recipes r ON r.recipe_id = ri.recipe_id
       JOIN MenuItems mi ON mi.menu_item_id = r.recipe_id
       JOIN InventoryItems ii ON ii.item_id = ri.item_id AND ii.business_id = mi.business_id
       JOIN GlobalUnits gu1 ON gu1.unit_id = ri.unit_id
       JOIN GlobalUnits gu2 ON gu2.unit_id = ii.standard_unit_id
       LEFT JOIN BusinessUnitConversions bc1 ON bc1.business_id = mi.business_id AND bc1.from_unit_id = ri.unit_id AND bc1.to_unit_id = ii.standard_unit_id
       LEFT JOIN BusinessUnitConversions bc2 ON bc2.business_id = mi.business_id AND bc2.from_unit_id = ii.standard_unit_id AND bc2.to_unit_id = ri.unit_id
       WHERE mi.business_id = $1
         AND ri.unit_id IS NOT NULL
         AND (ri.unit_id <> ii.standard_unit_id)
         AND bc1.conversion_id IS NULL AND bc2.conversion_id IS NULL
       ORDER BY mi.name, ii.name`,
      [businessId]
    );

    let created = 0, skipped = 0;
    await client.query('BEGIN');
    const recs = rows.rows;
    if (mode === 'summary' || recs.length > maxPerRun) {
      const examples = recs.slice(0, 5).map(r => `${r.ingredient_name} (${r.dish_name})`);
      const title = 'Unmapped Ingredient Units Found';
      const description = `${recs.length} recipe ingredient(s) have units not mapped to inventory units. Examples: ${examples.join(', ')}. Add conversions for accurate deductions.`;
      const { skipped: wasSkipped } = await insertNotification(client, {
        businessId, userId, type: 'warning', title, description, relatedUrl: '/map2'
      });
      if (wasSkipped) skipped++; else created++;
    } else {
      for (const r of recs) {
        const title = `Unmapped Ingredient Unit: ${r.ingredient_name}`;
        const description = `The ingredient ${r.ingredient_name} in recipe ${r.dish_name} uses unit \"${r.recipe_unit_symbol || r.recipe_unit_id}\" but the inventory item uses \"${r.standard_unit_symbol || r.standard_unit_id}\". Add a unit conversion so deductions are accurate.`;
        const { skipped: wasSkipped } = await insertNotification(client, {
          businessId,
          userId,
          type: 'warning',
          title,
          description,
          relatedUrl: `/recipes?dish=${r.dish_id}`
        });
        if (wasSkipped) skipped++; else created++;
      }
    }
    await client.query('COMMIT');
    res.json({ success: true, created, skipped, total: rows.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error checking unmapped ingredients:', err);
    res.status(500).json({ success: false, error: 'Failed to check unmapped ingredients', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/ingredient-mapping/check-zero-cost-recipes { businessId, userId }
// Alerts for recipes with zero or missing estimated cost
router.post('/ingredient-mapping/check-zero-cost-recipes', async (req, res) => {
  const client = await pool.connect();
  try {
  const { businessId, userId, mode = 'summary', maxPerRun = 10 } = req.body;
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }

    const rows = await client.query(
      `SELECT mi.menu_item_id, mi.name AS dish_name, r.estimated_cost
       FROM Recipes r
       JOIN MenuItems mi ON mi.menu_item_id = r.recipe_id
       WHERE mi.business_id = $1 AND (r.estimated_cost IS NULL OR r.estimated_cost = 0)
       ORDER BY mi.name`,
      [businessId]
    );

    let created = 0, skipped = 0;
    await client.query('BEGIN');
    const recs = rows.rows;
    if (mode === 'summary' || recs.length > maxPerRun) {
      const examples = recs.slice(0, 5).map(r => r.dish_name);
      const title = 'Zero-Cost Recipes Found';
      const description = `${recs.length} recipes have no estimated cost. Examples: ${examples.join(', ')}. Add ingredient costs to enable profitability analysis.`;
      const { skipped: wasSkipped } = await insertNotification(client, {
        businessId, userId, type: 'warning', title, description, relatedUrl: '/map'
      });
      if (wasSkipped) skipped++; else created++;
    } else {
      for (const r of recs) {
        const title = `Zero-Cost Recipe: ${r.dish_name}`;
        const description = `The recipe for ${r.dish_name} has no estimated cost. Add ingredient costs or average batch costs to enable profitability analysis.`;
        const { skipped: wasSkipped } = await insertNotification(client, {
          businessId,
          userId,
          type: 'warning',
          title,
          description,
          relatedUrl: '/map'
        });
        if (wasSkipped) skipped++; else created++;
      }
    }
    await client.query('COMMIT');
    res.json({ success: true, created, skipped, total: rows.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error checking zero-cost recipes:', err);
    res.status(500).json({ success: false, error: 'Failed to check zero-cost recipes', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/ingredient-mapping/alert-recent-recipe-changes { businessId, userId, days }
// Info alerts for recipes edited recently
router.post('/ingredient-mapping/alert-recent-recipe-changes', async (req, res) => {
  const client = await pool.connect();
  try {
  const { businessId, userId, days = 7, mode = 'summary', maxPerRun = 10 } = req.body;
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }

    const rows = await client.query(
      `SELECT mi.menu_item_id, mi.name AS dish_name, r.updated_at
       FROM Recipes r
       JOIN MenuItems mi ON mi.menu_item_id = r.recipe_id
       WHERE mi.business_id = $1 AND r.updated_at >= NOW() - ($2::int || ' days')::interval
       ORDER BY r.updated_at DESC`,
      [businessId, days]
    );

    let created = 0, skipped = 0;
    await client.query('BEGIN');
    const recs = rows.rows;
    if (mode === 'summary' || recs.length > maxPerRun) {
      const examples = recs.slice(0, 5).map(r => r.dish_name);
      const title = 'Recent Recipe Changes';
      const description = `${recs.length} recipes were updated in the last ${days} days. Examples: ${examples.join(', ')}.`;
      const { skipped: wasSkipped } = await insertNotification(client, {
        businessId, userId, type: 'info', title, description, relatedUrl: '/recipes'
      });
      if (wasSkipped) skipped++; else created++;
    } else {
      for (const r of recs) {
        const dateStr = new Date(r.updated_at).toISOString().split('T')[0];
        const title = `Recipe Updated: ${r.dish_name}`;
        const description = `The recipe for ${r.dish_name} was updated on ${dateStr}. Review ingredient mapping and costs if needed.`;
        const { skipped: wasSkipped } = await insertNotification(client, {
          businessId,
          userId,
          type: 'info',
          title,
          description,
          relatedUrl: `/recipes?dish=${r.menu_item_id}`
        });
        if (wasSkipped) skipped++; else created++;
      }
    }
    await client.query('COMMIT');
    res.json({ success: true, created, skipped, total: rows.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error creating recent recipe change alerts:', err);
    res.status(500).json({ success: false, error: 'Failed to create recent recipe change alerts', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/ingredient-mapping/check-recipe-stock-discrepancy { businessId, userId, servings }
// Flags dishes whose current stock of some ingredients is insufficient for the given servings
router.post('/ingredient-mapping/check-recipe-stock-discrepancy', async (req, res) => {
  const client = await pool.connect();
  try {
  const { businessId, userId, servings = 1, mode = 'summary', maxPerRun = 10 } = req.body;
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }

    // Compute shortages per dish
    const shortages = await client.query(
      `WITH ri_data AS (
         SELECT 
           mi.menu_item_id AS dish_id,
           mi.name AS dish_name,
           ii.item_id,
           ii.name AS ingredient_name,
           ri.quantity,
           ri.unit_id AS recipe_unit_id,
           ii.standard_unit_id,
           COALESCE(SUM(ib.quantity), 0) AS current_stock,
           -- derive conversion factor from recipe unit to item standard unit (if available)
           CASE
             WHEN ri.unit_id = ii.standard_unit_id THEN 1.0
             WHEN bc1.conversion_id IS NOT NULL THEN bc1.conversion_factor
             WHEN bc2.conversion_id IS NOT NULL THEN NULLIF(1.0 / NULLIF(bc2.conversion_factor, 0), 0)
             ELSE NULL
           END AS conv_factor,
           COALESCE(NULLIF(TRIM(gu.unit_symbol), ''), gu.unit_name) AS standard_unit_label
         FROM RecipeIngredients ri
         JOIN Recipes r ON r.recipe_id = ri.recipe_id
         JOIN MenuItems mi ON mi.menu_item_id = r.recipe_id
         JOIN InventoryItems ii ON ii.item_id = ri.item_id AND ii.business_id = mi.business_id
         JOIN GlobalUnits gu ON gu.unit_id = ii.standard_unit_id
         LEFT JOIN BusinessUnitConversions bc1 ON bc1.business_id = mi.business_id AND bc1.from_unit_id = ri.unit_id AND bc1.to_unit_id = ii.standard_unit_id
         LEFT JOIN BusinessUnitConversions bc2 ON bc2.business_id = mi.business_id AND bc2.from_unit_id = ii.standard_unit_id AND bc2.to_unit_id = ri.unit_id
         LEFT JOIN InventoryBatches ib ON ib.item_id = ii.item_id AND ib.is_expired = false
         WHERE mi.business_id = $1
         GROUP BY mi.menu_item_id, mi.name, ii.item_id, ii.name, ri.quantity, ri.unit_id, ii.standard_unit_id, bc1.conversion_id, bc1.conversion_factor, bc2.conversion_id, bc2.conversion_factor, gu.unit_symbol, gu.unit_name
       ), calc AS (
         SELECT 
           dish_id, dish_name,
           ingredient_name,
           current_stock,
           standard_unit_label,
           conv_factor,
           (quantity * $2::numeric * COALESCE(conv_factor, 0)) AS required_qty
         FROM ri_data
         WHERE conv_factor IS NOT NULL -- skip unmapped here
       )
       SELECT dish_id, dish_name,
              COUNT(*) FILTER (WHERE current_stock < required_qty)::int AS shortage_count,
              ARRAY_REMOVE(ARRAY_AGG(CASE WHEN current_stock < required_qty THEN ingredient_name END), NULL) AS shortage_ingredients,
              ARRAY_REMOVE(ARRAY_AGG(CASE WHEN current_stock < required_qty THEN standard_unit_label END), NULL) AS unit_labels
       FROM calc
       GROUP BY dish_id, dish_name
       HAVING COUNT(*) FILTER (WHERE current_stock < required_qty) > 0
       ORDER BY dish_name`,
      [businessId, servings]
    );

    let created = 0, skipped = 0;
    await client.query('BEGIN');
    const recs = shortages.rows;
    if (mode === 'summary' || recs.length > maxPerRun) {
      const examples = recs.slice(0, 5).map(r => r.dish_name);
      const title = 'Recipe-Stock Discrepancies Detected';
      const description = `${recs.length} dishes lack sufficient stock for ${servings} serving${servings > 1 ? 's' : ''}. Examples: ${examples.join(', ')}. Review inventory or adjust recipes.`;
      const { skipped: wasSkipped } = await insertNotification(client, {
        businessId, userId, type: 'warning', title, description, relatedUrl: '/recipes'
      });
      if (wasSkipped) skipped++; else created++;
    } else {
      for (const s of recs) {
        const list = (s.shortage_ingredients || []).slice(0, 3);
        const examples = list.join(', ');
        const title = `Recipe-Stock Discrepancy: ${s.dish_name}`;
        const description = `Not enough stock for ${s.dish_name} (${servings} serving${servings > 1 ? 's' : ''}). Short on ${s.shortage_count} ingredient${s.shortage_count > 1 ? 's' : ''}${examples ? ` e.g., ${examples}` : ''}. Review inventory or adjust the recipe.`;
        const { skipped: wasSkipped } = await insertNotification(client, {
          businessId,
          userId,
          type: 'warning',
          title,
          description,
          relatedUrl: '/map2'
        });
        if (wasSkipped) skipped++; else created++;
      }
    }
    await client.query('COMMIT');
    res.json({ success: true, created, skipped, total: shortages.rows.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error checking recipe-stock discrepancy:', err);
    res.status(500).json({ success: false, error: 'Failed to check recipe-stock discrepancy', details: err.message });
  } finally {
    client.release();
  }
});

// -------- DETAILS ENDPOINTS (READ-ONLY) --------

// GET /api/notifications/ingredient-mapping/details/incomplete-recipes?businessId=&limit=
router.get('/ingredient-mapping/details/incomplete-recipes', async (req, res) => {
  const client = await pool.connect();
  try {
    const businessId = req.query.businessId;
    if (!businessId) return res.status(400).json({ success: false, error: 'businessId is required' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const rows = await client.query(
      `SELECT mi.menu_item_id, mi.name AS dish_name,
              (r.recipe_id IS NULL) AS no_recipe,
              COUNT(ri.recipe_ingredient_id)::int AS ingredient_count,
              COUNT(CASE WHEN ri.quantity IS NULL OR ri.quantity <= 0 OR ri.unit_id IS NULL THEN 1 END)::int AS invalid_count
       FROM MenuItems mi
       LEFT JOIN Recipes r ON r.recipe_id = mi.menu_item_id
       LEFT JOIN RecipeIngredients ri ON ri.recipe_id = r.recipe_id
       WHERE mi.business_id = $1 AND mi.is_active = true
       GROUP BY mi.menu_item_id, mi.name, r.recipe_id
       HAVING (r.recipe_id IS NULL OR COUNT(ri.recipe_ingredient_id) = 0 OR COUNT(CASE WHEN ri.quantity IS NULL OR ri.quantity <= 0 OR ri.unit_id IS NULL THEN 1 END) > 0)
       ORDER BY mi.name
       LIMIT ${limit}`,
      [businessId]
    );
    res.json({ success: true, data: rows.rows, count: rows.rows.length });
  } catch (err) {
    console.error('Details incomplete-recipes error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch details', details: err.message });
  } finally {
    client.release();
  }
});

// GET /api/notifications/ingredient-mapping/details/unmapped-ingredients?businessId=&limit=
router.get('/ingredient-mapping/details/unmapped-ingredients', async (req, res) => {
  const client = await pool.connect();
  try {
    const businessId = req.query.businessId;
    if (!businessId) return res.status(400).json({ success: false, error: 'businessId is required' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const rows = await client.query(
      `SELECT mi.menu_item_id AS dish_id, mi.name AS dish_name,
              ii.item_id, ii.name AS ingredient_name,
              ri.unit_id AS recipe_unit_id, ii.standard_unit_id,
              gu1.unit_symbol AS recipe_unit_symbol, gu2.unit_symbol AS standard_unit_symbol
       FROM RecipeIngredients ri
       JOIN Recipes r ON r.recipe_id = ri.recipe_id
       JOIN MenuItems mi ON mi.menu_item_id = r.recipe_id
       JOIN InventoryItems ii ON ii.item_id = ri.item_id AND ii.business_id = mi.business_id
       JOIN GlobalUnits gu1 ON gu1.unit_id = ri.unit_id
       JOIN GlobalUnits gu2 ON gu2.unit_id = ii.standard_unit_id
       LEFT JOIN BusinessUnitConversions bc1 ON bc1.business_id = mi.business_id AND bc1.from_unit_id = ri.unit_id AND bc1.to_unit_id = ii.standard_unit_id
       LEFT JOIN BusinessUnitConversions bc2 ON bc2.business_id = mi.business_id AND bc2.from_unit_id = ii.standard_unit_id AND bc2.to_unit_id = ri.unit_id
       WHERE mi.business_id = $1
         AND ri.unit_id IS NOT NULL
         AND (ri.unit_id <> ii.standard_unit_id)
         AND bc1.conversion_id IS NULL AND bc2.conversion_id IS NULL
       ORDER BY mi.name, ii.name
       LIMIT ${limit}`,
      [businessId]
    );
    res.json({ success: true, data: rows.rows, count: rows.rows.length });
  } catch (err) {
    console.error('Details unmapped-ingredients error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch details', details: err.message });
  } finally {
    client.release();
  }
});

// GET /api/notifications/ingredient-mapping/details/zero-cost?businessId=&limit=
router.get('/ingredient-mapping/details/zero-cost', async (req, res) => {
  const client = await pool.connect();
  try {
    const businessId = req.query.businessId;
    if (!businessId) return res.status(400).json({ success: false, error: 'businessId is required' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const rows = await client.query(
      `SELECT mi.menu_item_id, mi.name AS dish_name, r.estimated_cost
       FROM Recipes r
       JOIN MenuItems mi ON mi.menu_item_id = r.recipe_id
       WHERE mi.business_id = $1 AND (r.estimated_cost IS NULL OR r.estimated_cost = 0)
       ORDER BY mi.name
       LIMIT ${limit}`,
      [businessId]
    );
    res.json({ success: true, data: rows.rows, count: rows.rows.length });
  } catch (err) {
    console.error('Details zero-cost error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch details', details: err.message });
  } finally {
    client.release();
  }
});

// GET /api/notifications/ingredient-mapping/details/recent-changes?businessId=&days=&limit=
router.get('/ingredient-mapping/details/recent-changes', async (req, res) => {
  const client = await pool.connect();
  try {
    const businessId = req.query.businessId;
    if (!businessId) return res.status(400).json({ success: false, error: 'businessId is required' });
    const days = Math.max(parseInt(req.query.days, 10) || 7, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const rows = await client.query(
      `WITH changed AS (
         SELECT 
           mi.menu_item_id,
           mi.name AS dish_name,
           r.updated_at,
           ri.item_id,
           ii.name AS ingredient_name,
           ri.quantity,
           ri.unit_id,
           COALESCE(NULLIF(TRIM(gu.unit_symbol), ''), gu.unit_name) AS unit_label,
           CASE 
             WHEN ri.created_at >= NOW() - ($2::int || ' days')::interval THEN 'added'
             WHEN ri.updated_at >= NOW() - ($2::int || ' days')::interval THEN 'edited'
             ELSE NULL
           END AS change_type
         FROM Recipes r
         JOIN MenuItems mi ON mi.menu_item_id = r.recipe_id
         LEFT JOIN RecipeIngredients ri ON ri.recipe_id = r.recipe_id
         LEFT JOIN InventoryItems ii ON ii.item_id = ri.item_id
         LEFT JOIN GlobalUnits gu ON gu.unit_id = ri.unit_id
         WHERE mi.business_id = $1 
           AND (
             r.updated_at >= NOW() - ($2::int || ' days')::interval OR
             ri.updated_at >= NOW() - ($2::int || ' days')::interval OR
             ri.created_at >= NOW() - ($2::int || ' days')::interval
           )
       )
       SELECT 
         menu_item_id,
         dish_name,
         MAX(updated_at) AS updated_at,
         JSON_AGG(
           JSON_BUILD_OBJECT(
             'ingredient_name', ingredient_name,
             'change_type', change_type,
             'quantity', quantity,
             'unit_id', unit_id,
             'unit_label', unit_label
           )
         ) FILTER (WHERE change_type IS NOT NULL) AS changed_ingredients
       FROM changed
       GROUP BY menu_item_id, dish_name
       ORDER BY MAX(updated_at) DESC
       LIMIT ${limit}`,
      [businessId, days]
    );
    res.json({ success: true, data: rows.rows, count: rows.rows.length, days });
  } catch (err) {
    console.error('Details recent-changes error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch details', details: err.message });
  } finally {
    client.release();
  }
});

// GET /api/notifications/ingredient-mapping/details/stock-discrepancy?businessId=&servings=&limit=
router.get('/ingredient-mapping/details/stock-discrepancy', async (req, res) => {
  const client = await pool.connect();
  try {
    const businessId = req.query.businessId;
    if (!businessId) return res.status(400).json({ success: false, error: 'businessId is required' });
    const servings = Math.max(parseInt(req.query.servings, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const rows = await client.query(
      `WITH ri_data AS (
         SELECT 
           mi.menu_item_id AS dish_id,
           mi.name AS dish_name,
           ii.item_id,
           ii.name AS ingredient_name,
           ri.quantity,
           ri.unit_id AS recipe_unit_id,
           ii.standard_unit_id,
           COALESCE(SUM(ib.quantity), 0) AS current_stock,
           CASE
             WHEN ri.unit_id = ii.standard_unit_id THEN 1.0
             WHEN bc1.conversion_id IS NOT NULL THEN bc1.conversion_factor
             WHEN bc2.conversion_id IS NOT NULL THEN NULLIF(1.0 / NULLIF(bc2.conversion_factor, 0), 0)
             ELSE NULL
           END AS conv_factor,
           COALESCE(NULLIF(TRIM(gu.unit_symbol), ''), gu.unit_name) AS standard_unit_label
         FROM RecipeIngredients ri
         JOIN Recipes r ON r.recipe_id = ri.recipe_id
         JOIN MenuItems mi ON mi.menu_item_id = r.recipe_id
         JOIN InventoryItems ii ON ii.item_id = ri.item_id AND ii.business_id = mi.business_id
         JOIN GlobalUnits gu ON gu.unit_id = ii.standard_unit_id
         LEFT JOIN BusinessUnitConversions bc1 ON bc1.business_id = mi.business_id AND bc1.from_unit_id = ri.unit_id AND bc1.to_unit_id = ii.standard_unit_id
         LEFT JOIN BusinessUnitConversions bc2 ON bc2.business_id = mi.business_id AND bc2.from_unit_id = ii.standard_unit_id AND bc2.to_unit_id = ri.unit_id
         LEFT JOIN InventoryBatches ib ON ib.item_id = ii.item_id AND ib.is_expired = false
         WHERE mi.business_id = $1
         GROUP BY mi.menu_item_id, mi.name, ii.item_id, ii.name, ri.quantity, ri.unit_id, ii.standard_unit_id, bc1.conversion_id, bc1.conversion_factor, bc2.conversion_id, bc2.conversion_factor, gu.unit_symbol, gu.unit_name
       )
       SELECT dish_id, dish_name,
              JSON_AGG(
                JSON_BUILD_OBJECT(
                  'ingredient_name', ingredient_name,
                  'required_qty', ROUND((quantity * $2::numeric * COALESCE(conv_factor, 0))::numeric, 4),
                  'current_stock', current_stock,
                  'unit_label', standard_unit_label
                )
              ) FILTER (WHERE conv_factor IS NOT NULL AND current_stock < (quantity * $2::numeric * COALESCE(conv_factor, 0))) AS shortages,
              COUNT(*) FILTER (WHERE conv_factor IS NOT NULL AND current_stock < (quantity * $2::numeric * COALESCE(conv_factor, 0)))::int AS shortage_count
       FROM ri_data
       GROUP BY dish_id, dish_name
       HAVING COUNT(*) FILTER (WHERE conv_factor IS NOT NULL AND current_stock < (quantity * $2::numeric * COALESCE(conv_factor, 0))) > 0
       ORDER BY dish_name
       LIMIT ${limit}`,
      [businessId, servings]
    );
    res.json({ success: true, data: rows.rows, count: rows.rows.length, servings });
  } catch (err) {
    console.error('Details stock-discrepancy error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch details', details: err.message });
  } finally {
    client.release();
  }
});

// =================== ABC ANALYSIS NOTIFICATIONS ===================

// POST /api/notifications/abc/analysis-completed { businessId, userId, startDate?, endDate? }
// Summarize the latest ABC analysis period (or supplied period) and notify
router.post('/abc/analysis-completed', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, startDate, endDate } = req.body || {};
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }

    await client.query('BEGIN');

    // Identify the target period: use provided dates, else find the most recent analysis period
    let period;
    if (startDate && endDate) {
      period = { start_date: startDate, end_date: endDate };
    } else {
      const p = await client.query(
        `WITH periods AS (
           SELECT start_date, end_date, MAX(created_at) AS created_at
           FROM ABCAnalysisResults
           WHERE business_id = $1
           GROUP BY start_date, end_date
         )
         SELECT start_date, end_date
         FROM periods
         ORDER BY created_at DESC
         LIMIT 1`,
        [businessId]
      );
      if (!p.rows.length) {
        await client.query('ROLLBACK');
        return res.json({ success: true, skipped: true, reason: 'No ABC analysis results found' });
      }
      period = p.rows[0];
    }

    // Summaries for the period
    const s = await client.query(
      `SELECT 
         SUM(CASE WHEN abc_category = 'A' THEN 1 ELSE 0 END)::int AS a_count,
         SUM(CASE WHEN abc_category = 'B' THEN 1 ELSE 0 END)::int AS b_count,
         SUM(CASE WHEN abc_category = 'C' THEN 1 ELSE 0 END)::int AS c_count,
         COALESCE(SUM(total_consumption_value), 0) AS total_value
       FROM ABCAnalysisResults
       WHERE business_id = $1 AND start_date = $2 AND end_date = $3`,
      [businessId, period.start_date, period.end_date]
    );

    const stats = s.rows[0] || { a_count: 0, b_count: 0, c_count: 0, total_value: 0 };
    const title = `ABC Analysis Completed — ${period.start_date} to ${period.end_date}`;
    const description = `A: ${stats.a_count} • B: ${stats.b_count} • C: ${stats.c_count}. Total consumption value: ${Number(stats.total_value || 0).toFixed(2)}.`;
    const { skipped, notificationId } = await insertNotification(client, {
      businessId,
      userId,
      type: 'info',
      title,
      description,
      relatedUrl: `/abc?start=${encodeURIComponent(period.start_date)}&end=${encodeURIComponent(period.end_date)}`
    });

    await client.query('COMMIT');
    res.json({ success: true, skipped, notificationId, period });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ABC analysis-completed notification error:', err);
    res.status(500).json({ success: false, error: 'Failed to create ABC analysis-completed notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/abc/category-shifts { businessId, userId }
// Detect items whose ABC category changed compared to previous analysis and notify
router.post('/abc/category-shifts', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId } = req.body || {};
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }

    await client.query('BEGIN');

    // Latest vs previous category per item
    const q = await client.query(
      `WITH ranked AS (
         SELECT item_id, abc_category, total_consumption_value, created_at,
                ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY created_at DESC) AS rn
         FROM ABCAnalysisResults
         WHERE business_id = $1
       ), pairs AS (
         SELECT r1.item_id, r1.abc_category AS latest_cat, r2.abc_category AS prev_cat, r1.total_consumption_value
         FROM ranked r1
         LEFT JOIN ranked r2 ON r2.item_id = r1.item_id AND r2.rn = 2
         WHERE r1.rn = 1
       )
       SELECT p.item_id, p.latest_cat, p.prev_cat, p.total_consumption_value, ii.name
       FROM pairs p
       JOIN InventoryItems ii ON ii.item_id = p.item_id AND ii.business_id = $1
       WHERE p.prev_cat IS NOT NULL AND p.prev_cat <> p.latest_cat
       ORDER BY p.total_consumption_value DESC
       LIMIT 5`,
      [businessId]
    );

    const shifts = q.rows;
    const count = shifts.length;
    if (count === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: true, skipped: true, reason: 'No category shifts detected' });
    }

    const examples = shifts.slice(0, 3).map(r => `${r.name}: ${r.prev_cat}→${r.latest_cat}`).join(', ');
    const title = `ABC Category Shifts Detected (${count})`;
    const description = examples ? `Recent changes — ${examples}. Review and confirm priorities.` : `Several items changed categories. Review and confirm priorities.`;
    const { skipped, notificationId } = await insertNotification(client, {
      businessId,
      userId,
      type: 'warning',
      title,
      description,
      relatedUrl: '/abc?view=changes'
    });

    await client.query('COMMIT');
    res.json({ success: true, skipped, notificationId, count, examples: shifts });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ABC category-shifts notification error:', err);
    res.status(500).json({ success: false, error: 'Failed to create ABC category-shifts notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/abc/high-value-a-items { businessId, userId, topN? }
// Highlight top A-items by consumption value from the latest analysis period
router.post('/abc/high-value-a-items', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, topN } = req.body || {};
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }
    const limit = Math.min(parseInt(topN, 10) || 5, 20);

    await client.query('BEGIN');

    // Find latest period
    const p = await client.query(
      `WITH periods AS (
         SELECT start_date, end_date, MAX(created_at) AS created_at
         FROM ABCAnalysisResults
         WHERE business_id = $1
         GROUP BY start_date, end_date
       )
       SELECT start_date, end_date
       FROM periods
       ORDER BY created_at DESC
       LIMIT 1`,
      [businessId]
    );
    if (!p.rows.length) {
      await client.query('ROLLBACK');
      return res.json({ success: true, skipped: true, reason: 'No ABC analysis results found' });
    }
    const period = p.rows[0];

    const q = await client.query(
      `SELECT ar.item_id, ii.name, ar.total_consumption_value
       FROM ABCAnalysisResults ar
       JOIN InventoryItems ii ON ii.item_id = ar.item_id
       WHERE ar.business_id = $1 AND ar.start_date = $2 AND ar.end_date = $3 AND ar.abc_category = 'A'
       ORDER BY ar.total_consumption_value DESC
       LIMIT ${limit}`,
      [businessId, period.start_date, period.end_date]
    );

    if (!q.rows.length) {
      await client.query('ROLLBACK');
      return res.json({ success: true, skipped: true, reason: 'No A-category items found for latest analysis' });
    }

    const names = q.rows.slice(0, 3).map(r => r.name).join(', ');
    const title = `High-Value A-Items — ${period.start_date} to ${period.end_date}`;
    const description = names ? `Top A-items: ${names}. Keep close watch on procurement and stock.` : `Review A-items for the latest period.`;
    const { skipped, notificationId } = await insertNotification(client, {
      businessId,
      userId,
      type: 'info',
      title,
      description,
      relatedUrl: `/abc?category=A&start=${encodeURIComponent(period.start_date)}&end=${encodeURIComponent(period.end_date)}`
    });

    await client.query('COMMIT');
    res.json({ success: true, skipped, notificationId, items: q.rows });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ABC high-value-a-items notification error:', err);
    res.status(500).json({ success: false, error: 'Failed to create ABC high-value A-items notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/abc/underperforming-bc { businessId, userId, days? }
// Flag B/C items with highest wastage cost over a recent window
router.post('/abc/underperforming-bc', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, days } = req.body || {};
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }
    const windowDays = Math.max(parseInt(days, 10) || 14, 1);

    await client.query('BEGIN');

    // Latest category for each item
    const q = await client.query(
      `WITH latest_cat AS (
         SELECT DISTINCT ON (item_id) item_id, abc_category
         FROM ABCAnalysisResults
         WHERE business_id = $1
         ORDER BY item_id, created_at DESC
       )
       SELECT ii.item_id, ii.name, COALESCE(SUM(w.cost_impact), 0) AS waste_cost
       FROM latest_cat lc
       JOIN InventoryItems ii ON ii.item_id = lc.item_id AND ii.business_id = $1
       LEFT JOIN WastageRecords w ON w.item_id = ii.item_id AND w.business_id = $1 AND w.created_at >= NOW() - INTERVAL '${windowDays} days'
       WHERE lc.abc_category IN ('B','C')
       GROUP BY ii.item_id, ii.name
       HAVING COALESCE(SUM(w.cost_impact), 0) > 0
       ORDER BY waste_cost DESC
       LIMIT 5`,
      [businessId]
    );

    const rows = q.rows;
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.json({ success: true, skipped: true, reason: 'No underperforming B/C items found in window' });
    }

    const examples = rows.slice(0, 3).map(r => `${r.name} (${Number(r.waste_cost || 0).toFixed(2)})`).join(', ');
    const title = `Underperforming B/C Items — High Waste Last ${windowDays}d`;
    const description = examples ? `Top wastage: ${examples}. Consider recipe or sourcing review.` : `Review B/C items with high wastage in the last ${windowDays} days.`;
    const { skipped, notificationId } = await insertNotification(client, {
      businessId,
      userId,
      type: 'warning',
      title,
      description,
      relatedUrl: `/wastage?range=${windowDays}d`
    });

    await client.query('COMMIT');
    res.json({ success: true, skipped, notificationId, items: rows, days: windowDays });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('ABC underperforming-bc notification error:', err);
    res.status(500).json({ success: false, error: 'Failed to create ABC underperforming B/C items notification', details: err.message });
  } finally {
    client.release();
  }
});

// =================== OCR & STOCK-IN NOTIFICATIONS ===================

// POST /api/notifications/test - Create a test notification (for debugging)
router.post('/test', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId = 1, userId = 1, message = 'Test notification' } = req.body || {};
    
    const { skipped, notificationId } = await insertNotification(client, {
      businessId,
      userId,
      type: 'info',
      title: 'Test Notification',
      description: message,
      relatedUrl: '/dashboard'
    });
    
    res.json({ success: true, skipped, notificationId, message: 'Test notification created' });
  } catch (err) {
    console.error('Test notification error:', err);
    res.status(500).json({ success: false, error: 'Failed to create test notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/ocr/success-review { businessId, userId, vendorName?, date?, imageId? }
// Inform user that OCR scan completed and bill is ready for review
router.post('/ocr/success-review', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, vendorName, date, imageId } = req.body || {};
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }
    const when = date || new Date().toISOString().slice(0, 10);
    const vtxt = vendorName ? ` from ${vendorName}` : '';
    const timeStamp = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const title = `Scan Complete${vtxt} - ${timeStamp}`;
    const description = `Bill${vtxt} dated ${when} was scanned at ${timeStamp}. Please review items and prices before posting to stock.`;
    const url = imageId ? `/stock-in?imageId=${encodeURIComponent(imageId)}` : `/stock-in?date=${encodeURIComponent(when)}`;

    const clientTx = await pool.connect();
    try {
      await clientTx.query('BEGIN');
      const { skipped, notificationId } = await insertNotification(clientTx, {
        businessId,
        userId,
        type: 'info',
        title,
        description,
        relatedUrl: url
      });
      await clientTx.query('COMMIT');
      return res.json({ success: true, skipped, notificationId });
    } catch (e) {
      await clientTx.query('ROLLBACK');
      throw e;
    } finally {
      clientTx.release();
    }
  } catch (err) {
    console.error('OCR success-review notification error:', err);
    res.status(500).json({ success: false, error: 'Failed to create OCR success notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/ocr/error-correction { businessId, userId, itemName?, imageId?, errorMessage? }
// Signal that OCR failed or needs manual correction
router.post('/ocr/error-correction', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, itemName, imageId, errorMessage } = req.body || {};
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }
    const itemTxt = itemName ? ` for item "${itemName}"` : '';
    const timeStamp = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const title = `Manual Correction Needed - ${timeStamp}`;
    const description = `Could not read some details${itemTxt}. ${errorMessage ? `Details: ${String(errorMessage).slice(0, 160)}` : 'Please enter them manually.'}`;
    const url = '/todays-sales-report';

    const tx = await pool.connect();
    try {
      await tx.query('BEGIN');
      const { skipped, notificationId } = await insertNotification(tx, {
        businessId,
        userId,
        type: 'warning',
        title,
        description,
        relatedUrl: url
      });
      await tx.query('COMMIT');
      res.json({ success: true, skipped, notificationId });
    } catch (e) {
      await tx.query('ROLLBACK');
      throw e;
    } finally {
      tx.release();
    }
  } catch (err) {
    console.error('OCR error-correction notification error:', err);
    res.status(500).json({ success: false, error: 'Failed to create OCR error notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/ocr/new-vendor-detected { businessId, userId, vendorName }
// Mirror vendor flag from OCR flow when supplier is not recognized
router.post('/ocr/new-vendor-detected', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, vendorName } = req.body || {};
    if (!businessId || !userId || !vendorName) {
      return res.status(400).json({ success: false, error: 'businessId, userId and vendorName are required' });
    }
    const title = `New Vendor Detected: ${vendorName}`;
    const description = `The vendor ${vendorName} is not in your system. Would you like to add them now?`;

    const tx = await pool.connect();
    try {
      await tx.query('BEGIN');
      const { skipped, notificationId } = await insertNotification(tx, {
        businessId,
        userId,
        type: 'info',
        title,
        description,
        relatedUrl: `/vendors?prefillVendor=${encodeURIComponent(vendorName)}`
      });
      await tx.query('COMMIT');
      res.json({ success: true, skipped, notificationId });
    } catch (e) {
      await tx.query('ROLLBACK');
      throw e;
    } finally {
      tx.release();
    }
  } catch (err) {
    console.error('OCR new-vendor-detected notification error:', err);
    res.status(500).json({ success: false, error: 'Failed to create new vendor detected notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/ocr/unit-not-recognized { businessId, userId, unit, itemName? }
// Prompt user to set up unit conversion/mapping
router.post('/ocr/unit-not-recognized', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, unit, itemName } = req.body || {};
    if (!businessId || !userId || !unit) {
      return res.status(400).json({ success: false, error: 'businessId, userId and unit are required' });
    }
    const itemTxt = itemName ? ` for "${itemName}"` : '';
    const title = `Unit Not Recognized: ${unit}`;
    const description = `The unit '${unit}'${itemTxt} has not been defined. Please create a conversion rule.`;

    const tx = await pool.connect();
    try {
      await tx.query('BEGIN');
      const { skipped, notificationId } = await insertNotification(tx, {
        businessId,
        userId,
        type: 'warning',
        title,
        description,
        relatedUrl: `/map?unit=${encodeURIComponent(unit)}`
      });
      await tx.query('COMMIT');
      res.json({ success: true, skipped, notificationId });
    } catch (e) {
      await tx.query('ROLLBACK');
      throw e;
    } finally {
      tx.release();
    }
  } catch (err) {
    console.error('OCR unit-not-recognized notification error:', err);
    res.status(500).json({ success: false, error: 'Failed to create unit not recognized notification', details: err.message });
  } finally {
    client.release();
  }
});

// POST /api/notifications/ocr/duplicate-bill-warning { businessId, userId, vendorName?, date?, billNumber?, amount? }
// Warn user of potential duplicate bill based on vendor/date/number/amount
router.post('/ocr/duplicate-bill-warning', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId, userId, vendorName, date, billNumber, amount } = req.body || {};
    if (!businessId || !userId) {
      return res.status(400).json({ success: false, error: 'businessId and userId are required' });
    }
    const day = date || new Date().toISOString().slice(0, 10);
    const v = vendorName ? ` from ${vendorName}` : '';
    const n = billNumber ? ` (#${billNumber})` : '';
    const a = Number.isFinite(parseFloat(amount)) ? ` ₹${parseFloat(amount).toFixed(2)}` : '';
    const title = 'Warning: Possible Duplicate Bill';
    const description = `This bill${v}${n}${a} looks like one you already entered on ${day}.`;

    const tx = await pool.connect();
    try {
      await tx.query('BEGIN');
      const { skipped, notificationId } = await insertNotification(tx, {
        businessId,
        userId,
        type: 'warning',
        title,
        description,
        relatedUrl: '/stock-in/review'
      });
      await tx.query('COMMIT');
      res.json({ success: true, skipped, notificationId });
    } catch (e) {
      await tx.query('ROLLBACK');
      throw e;
    } finally {
      tx.release();
    }
  } catch (err) {
    console.error('OCR duplicate-bill-warning notification error:', err);
    res.status(500).json({ success: false, error: 'Failed to create duplicate bill warning', details: err.message });
  } finally {
    client.release();
  }
});

// =================== REPORT SCHEDULER STATUS ===================

// GET /api/notifications/scheduler/status
// Get status of the automatic report scheduler
router.get('/scheduler/status', (req, res) => {
  try {
    const status = reportScheduler.getStatus();
    res.json({
      success: true,
      data: status,
      message: 'Report scheduler status retrieved successfully'
    });
  } catch (error) {
    console.error('Error getting scheduler status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get scheduler status',
      details: error.message
    });
  }
});

// POST /api/notifications/scheduler/trigger-eod
// Manually trigger end-of-day reports for testing
router.post('/scheduler/trigger-eod', async (req, res) => {
  try {
    const { businessId, userId } = req.body;
    
    if (businessId && userId) {
      // Trigger for specific user
      const today = new Date().toISOString().slice(0, 10);
      const result = await reportScheduler.callNotificationEndpoint('/reports/eod-summary', {
        businessId,
        userId,
        date: today
      });
      
      res.json({
        success: true,
        message: 'End-of-day report triggered for specific user',
        data: result
      });
    } else {
      // Trigger for all eligible users
      await reportScheduler.generateEndOfDayReports();
      res.json({
        success: true,
        message: 'End-of-day reports triggered for all eligible users'
      });
    }
  } catch (error) {
    console.error('Error triggering EOD reports:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to trigger end-of-day reports',
      details: error.message
    });
  }
});

// POST /api/notifications/test-report-notifications
// Create sample report notifications immediately for testing
router.post('/test-report-notifications', async (req, res) => {
  const { client, release } = await getReqClient(req);
  try {
    const { businessId = 1, userId = 1 } = req.body;
    
    await client.query('BEGIN');
    
    const today = new Date().toISOString().slice(0, 10);
    const currentMonth = new Date().toISOString().slice(0, 7);
    
    const testNotifications = [
      {
        type: 'info',
        title: `End of Day Report Ready — ${today}`,
        description: `Your daily report for ${today} is ready. View sales, wastage, usage, and inventory impact.`,
        relatedUrl: `/reports/daily?date=${encodeURIComponent(today)}`
      },
      {
        type: 'warning',
        title: `Reminder: Daily Stock Out Report Due — ${today}`,
        description: `Your daily stock usage report for ${today} has not been submitted. Please record sales and wastage to keep inventory accurate.`,
        relatedUrl: '/todays-sales-report'
      },
      {
        type: 'info',
        title: `Your Monthly Report for ${currentMonth} is Ready`,
        description: `Your comprehensive monthly report for ${currentMonth} is ready. Review sales, costs, profits, and inventory KPIs.`,
        relatedUrl: `/reports/monthly?month=${encodeURIComponent(currentMonth)}`
      },
      {
        type: 'warning',
        title: `Performance Alert: Unusual Sales on ${today}`,
        description: `Today's sales volume is 45% higher than your daily average (65 orders). This may be a great sales day or indicate a data entry error. Please review the report to confirm.`,
        relatedUrl: `/reports/daily?date=${today}`
      },
      {
        type: 'warning',
        title: 'Wastage Alert: Trend Up in Last 7 Days',
        description: 'Your wastage cost trend is up by 23.5% over the last 7 days. Top items: Tomatoes, Milk, Bread.',
        relatedUrl: '/reports/wastage?range=7d'
      }
    ];
    
    const createdNotifications = [];
    
    for (const notif of testNotifications) {
      const { skipped, notificationId } = await insertNotification(client, {
        businessId,
        userId,
        ...notif
      });
      
      createdNotifications.push({
        notificationId,
        skipped,
        title: notif.title,
        type: notif.type
      });
    }
    
  await client.query('COMMIT');
    
    res.json({
      success: true,
      message: 'Test report notifications created successfully',
      data: {
        businessId,
        userId,
        notifications: createdNotifications,
        total: testNotifications.length,
        created: createdNotifications.filter(n => !n.skipped).length,
        skipped: createdNotifications.filter(n => n.skipped).length
      }
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating test report notifications:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create test report notifications',
      details: error.message
    });
  } finally {
    release();
  }
});

// Export router after defining all routes
module.exports = router;
