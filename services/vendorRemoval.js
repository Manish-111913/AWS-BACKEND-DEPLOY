// Service: vendorRemoval
// Provides safe vendor removal with soft-delete by default and optional hard delete with purge.
// Uses a provided pg Pool instance.

/**
 * Parse truthy flags from string/boolean
 */
function toBool(v, def = false) {
  if (typeof v === 'boolean') return v;
  if (v == null) return def;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y' || s === 'on';
}

/**
 * Compute dependent record counts for a vendor to assess deletability
 */
async function getDependencyCounts(pool, vendorId, businessId) {
  const queries = [
    { key: 'purchaseOrders', sql: `SELECT COUNT(*)::int AS c FROM PurchaseOrders WHERE vendor_id = $1 AND business_id = $2`, params: [vendorId, businessId] },
    { key: 'vendorBillsItems', sql: `SELECT COUNT(*)::int AS c FROM VendorBillsItems WHERE vendor_id = $1`, params: [vendorId] },
    { key: 'upcomingPayments', sql: `SELECT COUNT(*)::int AS c FROM UpcomingPaymentsDue WHERE vendor_id = $1 AND business_id = $2`, params: [vendorId, businessId] },
    { key: 'inventoryItemsDefault', sql: `SELECT COUNT(*)::int AS c FROM InventoryItems WHERE business_id = $2 AND default_vendor_id = $1`, params: [vendorId, businessId] },
    { key: 'inventoryBatches', sql: `SELECT COUNT(*)::int AS c FROM InventoryBatches WHERE vendor_id = $1`, params: [vendorId] },
    { key: 'stockInRecords', sql: `SELECT COUNT(*)::int AS c FROM StockInRecords WHERE vendor_id = $1`, params: [vendorId] },
  ];

  const counts = {};
  for (const q of queries) {
    const { rows } = await pool.query(q.sql, q.params);
    counts[q.key] = rows[0]?.c ?? 0;
  }
  return counts;
}

/**
 * Build a dry-run plan for removing a vendor
 */
async function planVendorRemoval(pool, { businessId, vendorId, vendorName, hard = false, purge = false }) {
  if (!businessId || (!vendorId && !vendorName)) {
    throw new Error('businessId and (vendorId or vendorName) are required');
  }

  // Resolve vendor
  let vendorRow;
  if (vendorId) {
    const { rows } = await pool.query(
      `SELECT vendor_id, business_id, name, vendor_category, is_active FROM Vendors WHERE business_id = $1 AND vendor_id = $2`,
      [businessId, vendorId]
    );
    vendorRow = rows[0];
  } else {
    const { rows } = await pool.query(
      `SELECT vendor_id, business_id, name, vendor_category, is_active FROM Vendors WHERE business_id = $1 AND name = $2`,
      [businessId, vendorName]
    );
    vendorRow = rows[0];
  }
  if (!vendorRow) {
    const ident = vendorId ? `ID ${vendorId}` : `name "${vendorName}"`;
    throw new Error(`Vendor not found for business ${businessId} with ${ident}`);
  }

  const counts = await getDependencyCounts(pool, vendorRow.vendor_id, businessId);

  return {
    mode: hard ? 'hard' : 'soft',
    purge: !!purge,
    vendor: vendorRow,
    dependencies: counts,
    notes:
      hard
        ? (purge
            ? 'Hard delete with purge will delete dependent PurchaseOrders (with their line items), VendorBillsItems, and UpcomingPaymentsDue; and null-out optional references in Inventory* and StockInRecords.'
            : 'Hard delete without purge will fail if there are dependent PurchaseOrders, VendorBillsItems, or UpcomingPaymentsDue. Use purge=true to remove them, or perform a soft delete.')
        : 'Soft delete will set is_active = FALSE and keep all historical data intact.'
  };
}

/**
 * Execute vendor removal
 */
async function removeVendor(pool, { businessId, vendorId, vendorName, hard = false, purge = false, dryRun = false }) {
  const plan = await planVendorRemoval(pool, { businessId, vendorId, vendorName, hard, purge });
  if (dryRun) return { dryRun: true, ...plan };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (plan.mode === 'soft') {
      const { rows } = await client.query(
        `UPDATE Vendors SET is_active = FALSE, updated_at = NOW() WHERE business_id = $1 AND vendor_id = $2 RETURNING vendor_id, name, is_active`,
        [businessId, plan.vendor.vendor_id]
      );
      await client.query('COMMIT');
      return { ...plan, result: { action: 'soft-deleted', vendor: rows[0] } };
    }

    // Hard delete path
    const { dependencies } = plan;
    const hasBlocking = (dependencies.purchaseOrders > 0) || (dependencies.vendorBillsItems > 0) || (dependencies.upcomingPayments > 0);
    if (hasBlocking && !toBool(purge)) {
      throw new Error(`Hard delete blocked by dependencies. PurchaseOrders: ${dependencies.purchaseOrders}, VendorBillsItems: ${dependencies.vendorBillsItems}, UpcomingPayments: ${dependencies.upcomingPayments}. Re-run with purge=true to remove dependent rows, or use soft delete.`);
    }

    // Purge hard dependencies first (NOT NULL FKs)
    if (dependencies.purchaseOrders > 0) {
      // Find all PO IDs for this vendor+business
      const { rows: poRows } = await client.query(
        `SELECT po_id FROM PurchaseOrders WHERE vendor_id = $1 AND business_id = $2`,
        [plan.vendor.vendor_id, businessId]
      );
      const poIds = poRows.map(r => r.po_id);
      if (poIds.length > 0) {
        // Delete dependent ReorderTracking if table exists
        const { rows: rtExistsRows } = await client.query(`SELECT to_regclass('ReorderTracking') AS t`);
        const rtExists = !!rtExistsRows[0]?.t;
        if (rtExists) {
          await client.query(`DELETE FROM ReorderTracking WHERE po_id = ANY($1::int[])`, [poIds]);
        }

        // Null-out StockAlerts.po_id if table/column exists (best-effort)
        const { rows: saExistsRows } = await client.query(`SELECT to_regclass('StockAlerts') AS t`);
        const saExists = !!saExistsRows[0]?.t;
        if (saExists) {
          try {
            await client.query(`UPDATE StockAlerts SET po_id = NULL WHERE po_id = ANY($1::int[])`, [poIds]);
          } catch (e) {
            // Ignore if column doesn't exist or null not allowed
          }
        }

        // PurchaseOrderLineItems are ON DELETE CASCADE from PurchaseOrders
        await client.query(`DELETE FROM PurchaseOrders WHERE po_id = ANY($1::int[])`, [poIds]);
      }
    }
    if (dependencies.vendorBillsItems > 0) {
      await client.query(`DELETE FROM VendorBillsItems WHERE vendor_id = $1`, [plan.vendor.vendor_id]);
    }
    if (dependencies.upcomingPayments > 0) {
      await client.query(`DELETE FROM UpcomingPaymentsDue WHERE vendor_id = $1 AND business_id = $2`, [plan.vendor.vendor_id, businessId]);
    }

    // Null out optional FKs
    if (dependencies.inventoryItemsDefault > 0) {
      await client.query(`UPDATE InventoryItems SET default_vendor_id = NULL WHERE business_id = $1 AND default_vendor_id = $2`, [businessId, plan.vendor.vendor_id]);
    }
    if (dependencies.inventoryBatches > 0) {
      await client.query(`UPDATE InventoryBatches SET vendor_id = NULL WHERE vendor_id = $1`, [plan.vendor.vendor_id]);
    }
    if (dependencies.stockInRecords > 0) {
      await client.query(`UPDATE StockInRecords SET vendor_id = NULL WHERE vendor_id = $1`, [plan.vendor.vendor_id]);
    }

    // Finally remove vendor; VendorRatings has ON DELETE CASCADE
    const { rows: deleted } = await client.query(
      `DELETE FROM Vendors WHERE business_id = $1 AND vendor_id = $2 RETURNING vendor_id, name, vendor_category`,
      [businessId, plan.vendor.vendor_id]
    );

    await client.query('COMMIT');
    return { ...plan, result: { action: 'hard-deleted', vendor: deleted[0] } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  toBool,
  planVendorRemoval,
  removeVendor,
};
