const { pool } = require('../config/database');

class StockInModel {
  
  // Create stock in record with line items and update inventory
  static async createStockInRecord(stockInData, isDraft = false) {
    if (!stockInData || !stockInData.items || !Array.isArray(stockInData.items)) {
      throw new Error('Invalid stock in data: items array is required');
    }

    if (stockInData.items.length === 0) {
      throw new Error('At least one item is required');
    }

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Detect if InventoryBatches has an optional link to StockInLineItems
      let hasBatchLineLink = false;
      try {
        const colCheck = await client.query(
          `SELECT 1 FROM information_schema.columns 
           WHERE table_schema = current_schema() 
             AND LOWER(table_name) = 'inventorybatches' 
             AND LOWER(column_name) = 'stock_in_line_item_id' 
           LIMIT 1`
        );
        hasBatchLineLink = colCheck.rows.length > 0;
      } catch (_) {
        hasBatchLineLink = false;
      }
      
  const { shift, items, vendor_name, vendor_phone } = stockInData;
      const recordDate = new Date().toISOString().split('T')[0];
      
      // Validate and calculate total amount safely
      let totalAmount = 0;
      for (const item of items) {
        const quantity = parseFloat(item.quantity);
        const unitPrice = parseFloat(item.unit_price);
        
        if (isNaN(quantity) || quantity <= 0) {
          throw new Error(`Invalid quantity for item: ${item.item_name}`);
        }
        if (isNaN(unitPrice) || unitPrice < 0) {
          throw new Error(`Invalid unit price for item: ${item.item_name}`);
        }
        
        totalAmount += quantity * unitPrice;
      }

      // Upsert vendor (Business Vendors table per DBfinal guidelines)
      let vendorId = null;
      if (vendor_name && vendor_name.trim()) {
        const findVendor = await client.query(
          `SELECT vendor_id FROM Vendors WHERE business_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
          [1, vendor_name.trim()]
        );
        if (findVendor.rows.length > 0) {
          vendorId = findVendor.rows[0].vendor_id;
          // Optionally update phone if empty
          if (vendor_phone && vendor_phone.trim()) {
            await client.query(
              `UPDATE Vendors SET contact_phone = COALESCE(contact_phone, $1), updated_at = NOW() WHERE vendor_id = $2`,
              [vendor_phone.trim(), vendorId]
            );
          }
        } else {
          const createVendor = await client.query(
            `INSERT INTO Vendors (business_id, name, contact_phone, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, true, NOW(), NOW())
             RETURNING vendor_id`,
            [1, vendor_name.trim(), (vendor_phone || null)]
          );
          vendorId = createVendor.rows[0].vendor_id;
        }
      }

      // Insert main stock in record (matching your DBsetup.js schema)
      const stockInQuery = `
        INSERT INTO StockInRecords (
          business_id, received_date, total_cost, status, 
          entry_method, vendor_id, created_at, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        RETURNING stock_in_id, received_date, created_at
      `;
      
      const stockInResult = await client.query(stockInQuery, [
        1, // business_id
        recordDate,
        totalAmount.toFixed(2),
        isDraft ? 'Draft' : 'Submitted',
        'Manual Entry',
        vendorId
      ]);
      
      const stockInId = stockInResult.rows[0].stock_in_id;

      // Insert line items and create/update inventory
      const lineItems = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        
        // Auto-convert container quantities to base units using saved supplier conversions (server-side safety)
        try {
          const convRes = await client.query(`
            SELECT bc.conversion_factor, tu.unit_symbol as to_unit_symbol
            FROM BusinessUnitConversions bc
            JOIN GlobalUnits fu ON bc.from_unit_id = fu.unit_id
            JOIN GlobalUnits tu ON bc.to_unit_id = tu.unit_id
            WHERE bc.business_id = 1
              AND LOWER(fu.unit_symbol) = LOWER($1)
              AND bc.description ILIKE '%' || $2 || '%'
            LIMIT 1
          `, [String(item.unit || '').toLowerCase().replace(/s$/, ''), String(item.item_name || '')]);

          if (convRes.rows.length > 0) {
            const factor = parseFloat(convRes.rows[0].conversion_factor) || 0;
            if (factor > 0 && !['kg','g','ml','l','liter','kilogram','gram','milliliter'].includes(String(item.unit || '').toLowerCase())) {
              item.quantity = (parseFloat(item.quantity) || 0) * factor;
              // Prefer symbol for downstream unit lookup
              item.unit = convRes.rows[0].to_unit_symbol || item.unit;
            }
          }
        } catch (e) {
          console.warn('Supplier conversion lookup failed; proceeding without conversion:', e.message);
        }
        
        // Get or create unit first (needed for line item)
  const unitQuery = `
          SELECT unit_id FROM GlobalUnits 
          WHERE LOWER(unit_symbol) = LOWER($1) OR LOWER(unit_name) = LOWER($1)
          LIMIT 1
        `;
        let unitResult = await client.query(unitQuery, [item.unit]);
        let unitId = null;

        if (unitResult.rows.length === 0) {
          // Create unit if it doesn't exist
          const createUnitQuery = `
            INSERT INTO GlobalUnits (unit_name, unit_symbol, unit_type, is_active, is_system_defined)
            VALUES ($1, $2, 'Count', true, false)
            ON CONFLICT (unit_name) DO NOTHING
            RETURNING unit_id
          `;
          const newUnit = await client.query(createUnitQuery, [item.unit, item.unit]);
          
          if (newUnit.rows.length > 0) {
            unitId = newUnit.rows[0].unit_id;
          } else {
            // Unit was created by another process, fetch it
            const refetchUnit = await client.query(unitQuery, [item.unit]);
            unitId = refetchUnit.rows[0].unit_id;
          }
        } else {
          unitId = unitResult.rows[0].unit_id;
        }

        // Insert line item (matching your DBsetup.js schema)
        const lineItemQuery = `
          INSERT INTO StockInLineItems (
            stock_in_id, raw_item_name_extracted, quantity, 
            unit_cost, expiry_date, received_unit_id,
            created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
          RETURNING line_item_id
        `;
        
        const lineTotal = parseFloat(item.quantity) * parseFloat(item.unit_price);
        
        const lineItemResult = await client.query(lineItemQuery, [
          stockInId,
          item.item_name,
          parseFloat(item.quantity),
          parseFloat(item.unit_price),
          item.expiry_date || null,
          unitId
        ]);

        // Create or get category (matching your DBsetup.js schema)
        const categoryQuery = `
          SELECT category_id FROM InventoryCategories 
          WHERE LOWER(name) = LOWER($1) AND business_id = 1
          LIMIT 1
        `;
        const categoryResult = await client.query(categoryQuery, [item.category]);
        let categoryId = null;

        if (categoryResult.rows.length === 0) {
          // Create category if it doesn't exist
          const createCategoryQuery = `
            INSERT INTO InventoryCategories (business_id, name, created_at, updated_at)
            VALUES (1, $1, NOW(), NOW())
            ON CONFLICT (business_id, name) DO UPDATE SET updated_at = NOW()
            RETURNING category_id
          `;
          const newCategory = await client.query(createCategoryQuery, [item.category]);
          categoryId = newCategory.rows[0].category_id;
          console.log('Created new category:', item.category, 'with ID:', categoryId);
        } else {
          categoryId = categoryResult.rows[0].category_id;
        }

        // Create or update inventory item (case-insensitive name matching)
        // First, check if an item with the same name (case-insensitive) already exists
        const existingItemQuery = `
          SELECT item_id, name FROM InventoryItems 
          WHERE business_id = 1 AND LOWER(name) = LOWER($1)
          LIMIT 1
        `;
        const existingItemResult = await client.query(existingItemQuery, [item.item_name]);
        
        let itemId;
        if (existingItemResult.rows.length > 0) {
          // Item exists (case-insensitive match), update it
          itemId = existingItemResult.rows[0].item_id;
          const existingName = existingItemResult.rows[0].name;
          
          const updateItemQuery = `
            UPDATE InventoryItems 
            SET category_id = $1, standard_unit_id = $2, updated_at = NOW()
            WHERE item_id = $3
          `;
          await client.query(updateItemQuery, [categoryId, unitId, itemId]);
          
          console.log(`Updated existing inventory item (${existingName}) with new data for ${item.item_name}`);
        } else {
          // Item doesn't exist, create new one
          const createItemQuery = `
            INSERT INTO InventoryItems (
              business_id, name, category_id, standard_unit_id,
              is_active, created_at, updated_at
            )
            VALUES (1, $1, $2, $3, true, NOW(), NOW())
            RETURNING item_id
          `;
          const newItemResult = await client.query(createItemQuery, [
            item.item_name,
            categoryId,
            unitId
          ]);
          itemId = newItemResult.rows[0].item_id;
          
          console.log(`Created new inventory item: ${item.item_name}`);
        }

        // Create inventory batch and increment current_stock atomically
        if (itemId) {
          const qty = parseFloat(item.quantity);
          const unitCost = parseFloat(item.unit_price);

          // Ensure InventoryItems has a current_stock column behavior
          await client.query(
            `UPDATE InventoryItems SET current_stock = COALESCE(current_stock, 0) + $1, updated_at = NOW() WHERE item_id = $2`,
            [qty, itemId]
          );

          const batchQuery = hasBatchLineLink
            ? `INSERT INTO InventoryBatches (
                 item_id, quantity, unit_cost, expiry_date,
                 received_date, invoice_reference, vendor_id, is_expired, created_at, updated_at,
                 stock_in_line_item_id
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, false, NOW(), NOW(), $8)
               RETURNING batch_id`
            : `INSERT INTO InventoryBatches (
                 item_id, quantity, unit_cost, expiry_date,
                 received_date, invoice_reference, vendor_id, is_expired, created_at, updated_at
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7, false, NOW(), NOW())
               RETURNING batch_id`;

          console.log('Creating batch for item:', itemId);

          const batchParams = [
            itemId,
            qty,
            unitCost,
            item.expiry_date || null,
            recordDate,
            (item.batch_number || '').trim() || null,
            vendorId
          ];
          if (hasBatchLineLink) batchParams.push(lineItemResult.rows[0].line_item_id);

          const batchResult = await client.query(batchQuery, batchParams);

          console.log('Batch created:', batchResult.rows[0]);
        }
        
        lineItems.push({
          line_item_id: lineItemResult.rows[0].line_item_id,
          ...item,
          line_total: lineTotal.toFixed(2)
        });
      }

      await client.query('COMMIT');
      console.log('✅ Stock in record created successfully with inventory items and batches');
      
      return {
        stock_in_id: stockInId,
        received_date: stockInResult.rows[0].received_date,
        shift,
        total_items: items.length,
        total_amount: totalAmount.toFixed(2),
        status: isDraft ? 'draft' : 'completed',
        created_at: stockInResult.rows[0].created_at,
        line_items: lineItems
      };
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error in createStockInRecord:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Get all stock in records with pagination
  static async getAllStockInRecords(page = 1, limit = 50, status = null) {
    const offset = (page - 1) * limit;
    
    let query = `
      SELECT 
        sir.stock_in_id,
        sir.record_date,
        sir.shift,
        sir.total_items,
        sir.total_amount,
        sir.status,
        sir.created_at,
        sir.updated_at,
        COUNT(sil.line_item_id) as actual_items_count
      FROM StockInRecords sir
      LEFT JOIN StockInLineItems sil ON sir.stock_in_id = sil.stock_in_id
    `;
    
    const params = [];
    let paramIndex = 1;
    
    if (status) {
      query += ` WHERE sir.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }
    
    query += `
      GROUP BY sir.stock_in_id, sir.record_date, sir.shift, 
               sir.total_items, sir.total_amount, sir.status, 
               sir.created_at, sir.updated_at
      ORDER BY sir.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    return result.rows;
  }

  // Get stock in record by ID with line items
  static async getStockInById(stockInId) {
    const mainQuery = `
      SELECT * FROM StockInRecords 
      WHERE stock_in_id = $1
    `;
    
    const lineItemsQuery = `
      SELECT * FROM StockInLineItems 
      WHERE stock_in_id = $1 
      ORDER BY line_number
    `;
    
    const [mainResult, lineItemsResult] = await Promise.all([
      pool.query(mainQuery, [stockInId]),
      pool.query(lineItemsQuery, [stockInId])
    ]);
    
    if (mainResult.rows.length === 0) {
      return null;
    }
    
    return {
      ...mainResult.rows[0],
      line_items: lineItemsResult.rows
    };
  }

  // Update draft to completed
  static async updateDraftToCompleted(stockInId) {
    const query = `
      UPDATE StockInRecords 
      SET status = 'completed', updated_at = NOW()
      WHERE stock_in_id = $1 AND status = 'draft'
      RETURNING *
    `;
    
    const result = await pool.query(query, [stockInId]);
    return result.rows[0];
  }

  // Delete stock in record and its line items
  static async deleteStockInRecord(stockInId) {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get associated batches to delete
      const batchQuery = `
        SELECT ib.batch_id 
        FROM InventoryBatches ib
        JOIN StockInLineItems sil ON ib.stock_in_line_item_id = sil.line_item_id
        WHERE sil.stock_in_id = $1
      `;
      const batches = await client.query(batchQuery, [stockInId]);
      
      // Delete associated batches
      if (batches.rows.length > 0) {
        const batchIds = batches.rows.map(row => row.batch_id);
        await client.query(
          'DELETE FROM InventoryBatches WHERE batch_id = ANY($1)', 
          [batchIds]
        );
      }
      
      // Delete line items
      await client.query('DELETE FROM StockInLineItems WHERE stock_in_id = $1', [stockInId]);
      
      // Delete main record
      const result = await client.query(
        'DELETE FROM StockInRecords WHERE stock_in_id = $1 RETURNING *', 
        [stockInId]
      );
      
      await client.query('COMMIT');
      return result.rows[0];
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Get inventory overview data
  static async getInventoryOverview() {
    const query = `
      WITH LatestBatches AS (
        SELECT DISTINCT ON (ib.item_id)
          ib.item_id,
          ib.batch_id,
          ib.expiry_date,
          ib.quantity,
          ib.unit_cost,
          ib.updated_at,
          ib.received_date
        FROM InventoryBatches ib
        WHERE ib.is_active = true 
        AND ib.quantity > 0
        ORDER BY ib.item_id, ib.expiry_date ASC
      )
      SELECT 
        ii.item_id,
        ii.name as item_name,
        COALESCE(SUM(lb.quantity), 0) as quantity,
        COALESCE(gu.unit_name, 'units') as unit,
        COALESCE(ic.name, 'Uncategorized') as category,
        COALESCE(lb.batch_id::text, 'No batch') as batch_number,
        lb.expiry_date,
        lb.updated_at,
        CASE 
          WHEN lb.expiry_date IS NULL THEN 'No expiry date'
          WHEN lb.expiry_date < CURRENT_DATE THEN 'Expired'
          WHEN lb.expiry_date = CURRENT_DATE THEN 'Expires today'
          WHEN lb.expiry_date <= CURRENT_DATE + INTERVAL '1 day' THEN 'Expires tomorrow'
          WHEN lb.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'Expires in ' || (lb.expiry_date - CURRENT_DATE) || ' days'
          WHEN lb.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'Fresh'
          ELSE 'Good'
        END as status,
        CASE 
          WHEN lb.expiry_date IS NULL THEN 999
          ELSE COALESCE((lb.expiry_date - CURRENT_DATE), 999)
        END as days_to_expiry,
        CASE 
          WHEN COALESCE(SUM(lb.quantity), 0) <= COALESCE(ii.reorder_point, 0) THEN 'low'
          WHEN COALESCE(SUM(lb.quantity), 0) <= COALESCE(ii.safety_stock, 0) THEN 'medium'
          ELSE 'adequate'
        END as stock_level,
        ii.reorder_point as minimum_stock_level,
        ii.safety_stock as maximum_stock_level
      FROM InventoryItems ii
      LEFT JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
      LEFT JOIN InventoryCategories ic ON ii.category_id = ic.category_id
      LEFT JOIN LatestBatches lb ON ii.item_id = lb.item_id
      WHERE ii.is_active = true
      GROUP BY ii.item_id, ii.name, gu.unit_name, ic.name, lb.batch_id, lb.expiry_date, lb.updated_at, ii.reorder_point, ii.safety_stock
      ORDER BY 
        CASE 
          WHEN lb.expiry_date IS NULL THEN 999
          WHEN lb.expiry_date < CURRENT_DATE THEN -1
          ELSE (lb.expiry_date - CURRENT_DATE)
        END ASC,
        ii.item_name ASC
    `;
    
    const result = await pool.query(query);
    return result.rows;
  }
}

module.exports = StockInModel;
