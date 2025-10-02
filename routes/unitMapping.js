const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// Helper to format numbers nicely in notification text (e.g., 50.000000 -> 50, 12.5 -> 12.5)
function formatNumber(value) {
  const n = Number(value);
  if (!isFinite(n)) return String(value);
  if (Number.isInteger(n)) return String(n);
  // Trim to max 2 decimals without trailing zeros
  return Number(n.toFixed(2)).toString();
}

// Utility function to insert notifications (same as in notifications.js)
async function insertNotification(client, {
  businessId,
  userId,
  type,
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

// Get all available units for dropdowns
router.get('/units', async (req, res) => {
  try {
    console.log('Fetching units from GlobalUnits table...');
    
    const result = await pool.query(`
      SELECT 
        unit_id,
        unit_name,
        unit_symbol,
        unit_type,
        is_system_defined
      FROM GlobalUnits 
      WHERE is_active = true 
      ORDER BY unit_type, unit_name
    `);

    console.log(`Found ${result.rows.length} units in database`);

    if (result.rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          kitchen: [],
          supplier: [],
          container: []
        },
        message: 'No units found in database'
      });
    }

    // Categorize units for different use cases
  const units = {
      kitchen: result.rows.filter(unit => 
        ['Weight', 'Volume'].includes(unit.unit_type) || 
        ['cup', 'tbsp', 'tsp', 'bowl'].includes(unit.unit_symbol)
      ),
      supplier: result.rows.filter(unit => 
    ['Weight', 'Volume', 'Count'].includes(unit.unit_type)
      ),
      container: result.rows.filter(unit => 
        ['Count'].includes(unit.unit_type) || 
        (unit.unit_symbol && ['box', 'carton', 'bag', 'sack', 'crate'].includes(unit.unit_symbol.toLowerCase()))
      )
    };

    console.log(`Categorized units - Kitchen: ${units.kitchen.length}, Supplier: ${units.supplier.length}, Container: ${units.container.length}`);

    // Optional: filter synonyms so only 'pcs' appears if both exist
    const dedupeBySymbol = (arr) => {
      const out = [];
      const seen = new Set();
      for (const u of arr) {
        const sym = (u.unit_symbol || '').toLowerCase();
        if (sym === 'pc') continue; // drop 'pc'
        if (seen.has(sym)) continue;
        seen.add(sym);
        out.push(u);
      }
      return out;
    };

    units.kitchen = dedupeBySymbol(units.kitchen);
    units.supplier = dedupeBySymbol(units.supplier);
    units.container = dedupeBySymbol(units.container);

    res.json({
      success: true,
      data: units
    });
  } catch (error) {
    console.error('Error fetching units:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch units',
      details: error.message
    });
  }
});

// Get business-specific unit conversions
router.get('/conversions/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;

    const result = await pool.query(`
      SELECT 
        bc.conversion_id,
        bc.from_unit_id,
        bc.to_unit_id,
        bc.conversion_factor,
        bc.description,
        fu.unit_name as from_unit_name,
        fu.unit_symbol as from_unit_symbol,
        tu.unit_name as to_unit_name,
        tu.unit_symbol as to_unit_symbol
      FROM BusinessUnitConversions bc
      JOIN GlobalUnits fu ON bc.from_unit_id = fu.unit_id
      JOIN GlobalUnits tu ON bc.to_unit_id = tu.unit_id
      WHERE bc.business_id = $1
      ORDER BY fu.unit_name
    `, [businessId]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching conversions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch conversions'
    });
  }
});

// Get kitchen units for a business (formatted for frontend)
router.get('/kitchen-units/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;

    // Get kitchen-specific conversions
    const result = await pool.query(`
      SELECT 
        bc.conversion_id,
        bc.conversion_factor,
        bc.description,
        fu.unit_name as from_unit_name,
        fu.unit_symbol as from_unit_symbol,
        tu.unit_name as to_unit_name,
        tu.unit_symbol as to_unit_symbol
      FROM BusinessUnitConversions bc
      JOIN GlobalUnits fu ON bc.from_unit_id = fu.unit_id
      JOIN GlobalUnits tu ON bc.to_unit_id = tu.unit_id
      WHERE bc.business_id = $1 
        AND (fu.unit_symbol IN ('cup', 'tbsp', 'tsp', 'bowl') OR bc.description ILIKE '%kitchen%')
      ORDER BY fu.unit_name
    `, [businessId]);

    // Format for frontend (key-value pairs)
    const kitchenUnits = {};
    result.rows.forEach(row => {
      const key = row.from_unit_symbol.toLowerCase();
      kitchenUnits[key] = {
        value: row.conversion_factor,
        unit: row.to_unit_symbol
      };
    });

    // Always ensure all 4 kitchen units are present with defaults if not saved
    const defaultUnits = {
      bowl: { value: 250, unit: 'ml' },
      cup: { value: 250, unit: 'ml' },
      tbsp: { value: 15, unit: 'ml' },
      tsp: { value: 5, unit: 'ml' }
    };

    // Merge defaults with saved values (saved values take precedence)
    Object.keys(defaultUnits).forEach(key => {
      if (!kitchenUnits[key]) {
        kitchenUnits[key] = defaultUnits[key];
      }
    });

    res.json({
      success: true,
      data: kitchenUnits
    });
  } catch (error) {
    console.error('Error fetching kitchen units:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch kitchen units'
    });
  }
});

// Get ingredient-scoped kitchen conversions for a business (normalized for frontend)
router.get('/kitchen-units/:businessId/by-ingredient', async (req, res) => {
  try {
    const { businessId } = req.params;

    const result = await pool.query(`
      SELECT 
        bc.conversion_id,
        bc.conversion_factor AS quantity,
        bc.description,
        -- Prefer InventoryItems.name; if not found, parse from description: "Kitchen conversion: <Item> - ..."
        COALESCE(
          ii.name,
          NULLIF(TRIM(SUBSTRING(bc.description FROM '(?i)^Kitchen conversion:\s*([^\-]+?)\s*-')),'')
        ) AS item,
        fu.unit_symbol AS kitchen_tool,
        tu.unit_symbol AS unit
      FROM BusinessUnitConversions bc
      JOIN GlobalUnits fu ON bc.from_unit_id = fu.unit_id
      JOIN GlobalUnits tu ON bc.to_unit_id = tu.unit_id
      LEFT JOIN InventoryItems ii ON bc.description ILIKE 'Kitchen conversion: ' || ii.name || ' - %'
      WHERE bc.business_id = $1 AND bc.description ILIKE '%Kitchen conversion:%'
      ORDER BY item NULLS LAST, fu.unit_symbol
    `, [businessId]);

    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error('Error fetching ingredient kitchen units:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch ingredient kitchen units' });
  }
});

// Save kitchen units
router.post('/kitchen-units/:businessId', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { businessId } = req.params;
    const { units, conversions } = req.body;

    await client.query('BEGIN');

    // Helper to find (or create) a GlobalUnit by symbol/name
    const ensureGlobalUnit = async (symbolRaw) => {
      if (!symbolRaw) return null;
      const symbol = String(symbolRaw).trim();
      const lower = symbol.toLowerCase();
      // Try by unit_symbol (case-insensitive)
      let found = await client.query('SELECT unit_id FROM GlobalUnits WHERE LOWER(unit_symbol) = LOWER($1) LIMIT 1', [symbol]);
      if (found.rows.length) return found.rows[0].unit_id;
      // Try by unit_name (case-insensitive)
      found = await client.query('SELECT unit_id FROM GlobalUnits WHERE LOWER(unit_name) = LOWER($1) LIMIT 1', [symbol]);
      if (found.rows.length) return found.rows[0].unit_id;
      // Create minimal custom unit under Count by default
      const name = symbol.charAt(0).toUpperCase() + symbol.slice(1);
      const ins = await client.query(
        `INSERT INTO GlobalUnits (unit_name, unit_symbol, unit_type, is_system_defined, is_active)
         VALUES ($1, $2, 'Count', false, true)
         RETURNING unit_id`,
        [name, lower]
      );
      return ins.rows[0].unit_id;
    };

    // Branch 1: legacy global kitchen units object -> keep backward compatible
    if (units && !conversions) {
      // Get existing kitchen unit conversions to detect changes
      const existingResult = await client.query(`
        SELECT 
          fu.unit_symbol as from_unit_symbol,
          bc.conversion_factor,
          tu.unit_symbol as to_unit_symbol
        FROM BusinessUnitConversions bc
        JOIN GlobalUnits fu ON bc.from_unit_id = fu.unit_id
        JOIN GlobalUnits tu ON bc.to_unit_id = tu.unit_id
        WHERE bc.business_id = $1 
          AND fu.unit_symbol IN ('cup', 'tbsp', 'tsp', 'bowl', 'packet')
      `, [businessId]);

      // Create a map of existing values
      const existingUnits = {};
      existingResult.rows.forEach(row => {
        existingUnits[row.from_unit_symbol] = {
          value: parseFloat(row.conversion_factor),
          unit: row.to_unit_symbol
        };
      });

      // Track changes for notification
      const changes = [];
      const newUnits = [];

      // Delete existing kitchen unit conversions (global-only)
      await client.query(`
        DELETE FROM BusinessUnitConversions 
        WHERE business_id = $1 
          AND (description LIKE '%kitchen%' OR from_unit_id IN (
            SELECT unit_id FROM GlobalUnits WHERE unit_symbol IN ('cup', 'tbsp', 'tsp', 'bowl', 'packet')
          ))
      `, [businessId]);

      for (const [fromSymbolRaw, conversion] of Object.entries(units)) {
        const fromSymbol = String(fromSymbolRaw).toLowerCase();
        const fromUnitId = await ensureGlobalUnit(fromSymbol);
        const toUnitId = await ensureGlobalUnit(conversion.unit);
        if (fromUnitId && toUnitId) {
          await client.query(`
            INSERT INTO BusinessUnitConversions 
            (business_id, from_unit_id, to_unit_id, conversion_factor, description)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (business_id, from_unit_id, to_unit_id) 
            DO UPDATE SET 
              conversion_factor = EXCLUDED.conversion_factor,
              description = EXCLUDED.description,
              updated_at = CURRENT_TIMESTAMP
          `, [
            businessId,
            fromUnitId,
            toUnitId,
            parseFloat(conversion.value),
            `Kitchen unit conversion: 1 ${fromSymbol} = ${formatNumber(conversion.value)} ${String(conversion.unit).toLowerCase()}`
          ]);

          const existingUnit = existingUnits[fromSymbol];
          if (existingUnit) {
            if (existingUnit.value !== parseFloat(conversion.value) || existingUnit.unit !== String(conversion.unit).toLowerCase()) {
              changes.push(`1 ${fromSymbol} changed from ${formatNumber(existingUnit.value)} ${existingUnit.unit} to ${formatNumber(conversion.value)} ${String(conversion.unit).toLowerCase()}`);
            }
          } else {
            newUnits.push(`1 ${fromSymbol} = ${formatNumber(conversion.value)} ${String(conversion.unit).toLowerCase()}`);
          }
        }
      }

      try {
        if (changes.length > 0 || newUnits.length > 0) {
          const parts = [];
          if (changes.length) parts.push(`Changes: ${changes.join(', ')}`);
          if (newUnits.length) parts.push(`New units: ${newUnits.join(', ')}`);
          const notificationDescription = `Kitchen units updated: ${parts.join('. ')}.`;
          await client.query(
            `INSERT INTO UserNotifications (business_id, user_id, type, title, description, related_url, is_read)
             VALUES ($1, $2, $3, $4, $5, $6, false)`,
            [parseInt(businessId), 1, 'success', 'Kitchen Units Successfully Updated', notificationDescription, '/map1']
          );
        }
      } catch (notifError) {
        console.error('Error creating kitchen units notification:', notifError);
      }

      await client.query('COMMIT');
      return res.json({ success: true, message: 'Kitchen units saved successfully' });
    }

    // Branch 2: ingredient-scoped kitchen conversions array
    if (Array.isArray(conversions)) {
      // Gather existing for change detection
      const existingRes = await client.query(`
        SELECT bc.description, bc.conversion_factor, fu.unit_symbol AS from_symbol, tu.unit_symbol AS to_symbol
        FROM BusinessUnitConversions bc
        JOIN GlobalUnits fu ON bc.from_unit_id = fu.unit_id
        JOIN GlobalUnits tu ON bc.to_unit_id = tu.unit_id
        WHERE bc.business_id = $1 AND bc.description ILIKE '%Kitchen conversion:%'
      `, [businessId]);

      const existingMap = new Map(); // key: item|from|to -> factor
      existingRes.rows.forEach(r => {
        const m = r.description.match(/^Kitchen conversion: (.+?) - /i);
        if (m) {
          const item = m[1];
          const key = `${item.toLowerCase()}|${String(r.from_symbol).toLowerCase()}|${String(r.to_symbol).toLowerCase()}`;
          existingMap.set(key, parseFloat(r.conversion_factor));
        }
      });

      // Delete existing ingredient-scoped kitchen conversions
      await client.query(`
        DELETE FROM BusinessUnitConversions 
        WHERE business_id = $1 AND description ILIKE '%Kitchen conversion:%'
      `, [businessId]);

      const changes = [];
      const additions = [];

      // Normalize name->symbol for common tools
      const nameToSymbol = {
        tablespoon: 'tbsp',
        teaspoon: 'tsp',
        cup: 'cup',
        bowl: 'bowl',
        glass: 'glass',
        teacup: 'teacup',
        ladle: 'ladle',
        scoop: 'scoop'
      };

      for (const conv of conversions) {
        const itemName = String(conv.item || '').trim();
        if (!itemName) continue;
        const rawTool = String(conv.kitchenTool || '').trim();
        const toolSym = nameToSymbol[rawTool.toLowerCase()] || rawTool.toLowerCase();
        const toSym = String(conv.unit || '').trim();
        const qty = Number(conv.quantity);
        if (!toolSym || !toSym || !(qty > 0)) continue;

        const fromUnitId = await ensureGlobalUnit(toolSym);
        const toUnitId = await ensureGlobalUnit(toSym);
        if (!fromUnitId || !toUnitId) continue;

        await client.query(`
          INSERT INTO BusinessUnitConversions 
            (business_id, from_unit_id, to_unit_id, conversion_factor, description)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (business_id, from_unit_id, to_unit_id)
          DO UPDATE SET conversion_factor = EXCLUDED.conversion_factor,
                        description = EXCLUDED.description,
                        updated_at = CURRENT_TIMESTAMP
        `, [
          businessId,
          fromUnitId,
          toUnitId,
          qty,
          `Kitchen conversion: ${itemName} - 1 ${toolSym} = ${formatNumber(qty)} ${toSym.toLowerCase()}`
        ]);

        const key = `${itemName.toLowerCase()}|${toolSym}|${toSym.toLowerCase()}`;
        const prev = existingMap.get(key);
        if (prev !== undefined) {
          if (prev !== qty) changes.push(`${itemName}: 1 ${toolSym} ${formatNumber(prev)}->${formatNumber(qty)} ${toSym.toLowerCase()}`);
        } else {
          additions.push(`${itemName}: 1 ${toolSym} = ${formatNumber(qty)} ${toSym.toLowerCase()}`);
        }
      }

      try {
        if (changes.length || additions.length) {
          const parts = [];
          if (changes.length) parts.push(`Updated: ${changes.join(', ')}`);
          if (additions.length) parts.push(`Added: ${additions.join(', ')}`);
          await client.query(
            `INSERT INTO UserNotifications (business_id, user_id, type, title, description, related_url, is_read)
             VALUES ($1, $2, $3, $4, $5, $6, false)`,
            [parseInt(businessId), 1, 'success', 'Kitchen Units Successfully Updated', `Ingredient kitchen conversions: ${parts.join('. ')}.`, '/map1']
          );
        }
      } catch (notifError) {
        console.error('Error creating ingredient kitchen units notification:', notifError);
      }

      await client.query('COMMIT');
      return res.json({ success: true, message: 'Ingredient kitchen units saved successfully' });
    }

    // If neither structure provided
    await client.query('ROLLBACK');
    return res.status(400).json({ success: false, error: 'Invalid payload. Provide either units (object) or conversions (array).' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving kitchen units:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save kitchen units'
    });
  } finally {
    client.release();
  }
});

// Get inventory items for supplier conversions
router.get('/inventory-items/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;

    const result = await pool.query(`
      SELECT 
        ii.item_id as id,
        ii.name,
        ic.name as category,
        gu.unit_symbol as standardUnit,
        ii.source,
        ii.created_at
      FROM InventoryItems ii
      LEFT JOIN InventoryCategories ic ON ii.category_id = ic.category_id
      LEFT JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
      WHERE ii.business_id = $1 AND ii.is_active = true
      ORDER BY ii.name
    `, [businessId]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching inventory items:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch inventory items'
    });
  }
});

// Get supplier conversions
router.get('/supplier-conversions/:businessId', async (req, res) => {
  try {
    const { businessId } = req.params;

    const result = await pool.query(`
      SELECT 
        bc.conversion_id,
        bc.conversion_factor as quantity,
        bc.description,
        ii.name as item,
        fu.unit_symbol as containerType,
        tu.unit_symbol as unit
      FROM BusinessUnitConversions bc
      JOIN GlobalUnits fu ON bc.from_unit_id = fu.unit_id
      JOIN GlobalUnits tu ON bc.to_unit_id = tu.unit_id
      LEFT JOIN InventoryItems ii ON bc.description LIKE '%' || ii.name || '%'
      WHERE bc.business_id = $1 
        AND bc.description ILIKE '%supplier%'
      ORDER BY ii.name
    `, [businessId]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching supplier conversions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch supplier conversions'
    });
  }
});

// Save supplier conversions
router.post('/supplier-conversions/:businessId', async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { businessId } = req.params;
    const { conversions } = req.body;

    await client.query('BEGIN');

    // Get existing supplier conversions to detect changes
    const existingResult = await client.query(`
      SELECT 
        bc.conversion_factor,
        bc.description,
        fu.unit_symbol as container_type,
        tu.unit_symbol as base_unit
      FROM BusinessUnitConversions bc
      JOIN GlobalUnits fu ON bc.from_unit_id = fu.unit_id
      JOIN GlobalUnits tu ON bc.to_unit_id = tu.unit_id
      WHERE bc.business_id = $1 AND bc.description ILIKE '%supplier%'
    `, [businessId]);

    // Create a map of existing conversions by description
    const existingConversions = new Map();
    existingResult.rows.forEach(row => {
      // Extract item name from description like "Supplier conversion: Flour - 1 bag = 5 kg"
      const match = row.description.match(/Supplier conversion: (.+?) - /);
      if (match) {
        const itemName = match[1];
        const key = `${itemName}-${row.container_type}-${row.base_unit}`;
        existingConversions.set(key, parseFloat(row.conversion_factor));
      }
    });

    // Track changes for notification
    const changes = [];
    const newConversions = [];

    // Delete existing supplier conversions (case-insensitive)
    await client.query(`
      DELETE FROM BusinessUnitConversions 
      WHERE business_id = $1 AND description ILIKE '%supplier%'
    `, [businessId]);

    // Insert new conversions with conflict handling and track changes
    for (const conversion of conversions) {
      // Get unit IDs
  const containerUnitResult = await client.query(
        'SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $1',
        [conversion.containerType]
      );
      
      const baseUnitResult = await client.query(
        'SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $1',
        [conversion.unit]
      );

      if (containerUnitResult.rows.length > 0 && baseUnitResult.rows.length > 0) {
        await client.query(`
          INSERT INTO BusinessUnitConversions 
          (business_id, from_unit_id, to_unit_id, conversion_factor, description)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (business_id, from_unit_id, to_unit_id) 
          DO UPDATE SET 
            conversion_factor = EXCLUDED.conversion_factor,
            description = EXCLUDED.description,
            updated_at = CURRENT_TIMESTAMP
        `, [
          businessId,
          containerUnitResult.rows[0].unit_id,
          baseUnitResult.rows[0].unit_id,
          parseFloat(conversion.quantity),
          `Supplier conversion: ${conversion.item} - 1 ${conversion.containerType} = ${formatNumber(conversion.quantity)} ${conversion.unit}`
        ]);

        // Track changes for notification
        const key = `${conversion.item}-${conversion.containerType}-${conversion.unit}`;
        const existingQuantity = existingConversions.get(key);
        
        if (existingQuantity !== undefined) {
          if (existingQuantity !== parseFloat(conversion.quantity)) {
            changes.push(`${conversion.item}: 1 ${conversion.containerType} changed from ${formatNumber(existingQuantity)} ${conversion.unit} to ${formatNumber(conversion.quantity)} ${conversion.unit}`);
          }
        } else {
          newConversions.push(`${conversion.item}: 1 ${conversion.containerType} = ${formatNumber(conversion.quantity)} ${conversion.unit}`);
        }
      }
    }

    // Create detailed notification ONLY if there are actual changes
    try {
      if (changes.length > 0 || newConversions.length > 0) {
        let details = [];
        if (changes.length > 0) {
          details.push(`Updated: ${changes.join(', ')}`);
        }
        if (newConversions.length > 0) {
          details.push(`Added: ${newConversions.join(', ')}`);
        }
        const notificationDescription = `Supplier conversions updated: ${details.join('. ')}.`;

        // Insert notification within the same transaction
        await client.query(
          `INSERT INTO UserNotifications (business_id, user_id, type, title, description, related_url, is_read)
           VALUES ($1, $2, $3, $4, $5, $6, false)`,
          [parseInt(businessId), 1, 'success', 'Supplier Conversions Successfully Updated', notificationDescription, '/map2']
        );
      } else {
        console.log('Supplier conversions saved with no changes detected; skipping notification.');
      }
    } catch (notifError) {
      console.error('Error creating supplier conversions notification:', notifError);
      // Don't fail the main operation if notification fails
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Supplier conversions saved successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving supplier conversions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to save supplier conversions'
    });
  } finally {
    client.release();
  }
});

// Complete setup
router.post('/complete-setup/:businessId', async (req, res) => {
  const client = await pool.connect();
  try {
    const { businessId } = req.params;

    await client.query('BEGIN');

    // Check current onboarding state
    const prev = await client.query(
      `SELECT is_onboarded FROM Businesses WHERE business_id = $1 FOR UPDATE`,
      [businessId]
    );
    const wasOnboarded = !!prev.rows[0]?.is_onboarded;

    if (!wasOnboarded) {
      // Mark business as onboarded
      await client.query(
        `UPDATE Businesses 
         SET is_onboarded = true, updated_at = CURRENT_TIMESTAMP
         WHERE business_id = $1`,
        [businessId]
      );

      // Insert a single setup-complete notification
      await client.query(
        `INSERT INTO UserNotifications (business_id, user_id, type, title, description, related_url, is_read)
         VALUES ($1, $2, $3, $4, $5, $6, false)`,
        [parseInt(businessId), 1, 'success', 'Unit Mapping Setup Complete!',
         'All unit mapping configurations have been completed successfully. Your inventory system is now ready for use.', '/dashboard']
      );
    } else {
      console.log('Setup already completed earlier; skipping duplicate completion notification.');
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      message: 'Unit mapping setup completed successfully',
      createdNotification: !wasOnboarded
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error completing setup:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to complete setup'
    });
  } finally {
    client.release();
  }
});

module.exports = router;