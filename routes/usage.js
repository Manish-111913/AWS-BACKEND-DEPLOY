const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// POST /api/usage/record - Record production usage
router.post('/record', async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { 
      production_date, 
      shift, 
      shift_time, 
      items, 
      total_estimated_cost, 
      notes, 
      recorded_by_user_id 
    } = req.body;

    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Items array is required and cannot be empty'
      });
    }

    // Always use a default user ID (1) if none is provided or invalid
    const userId = recorded_by_user_id && !isNaN(parseInt(recorded_by_user_id)) ? parseInt(recorded_by_user_id) : 1;

    if (!production_date) {
      return res.status(400).json({
        success: false,
        error: 'Production date is required'
      });
    }

    let totalEstimatedCost = 0;
    const usageRecords = [];
    
    // Create a new UsageEvent record
    const usageEventQuery = `
      INSERT INTO UsageEvents (
        business_id, production_date, shift, notes, status, created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING event_id
    `;
    
    const usageEventResult = await client.query(usageEventQuery, [
      1, // business_id
      production_date,
      `${shift} (${shift_time})`, // shift with time
      notes || `Production usage recorded - ${shift} shift`,
      'draft', // Set as draft initially
      userId
    ]);
    
    const eventId = usageEventResult.rows[0].event_id;

    // Process each item
    for (const item of items) {
      const { menu_item_id, quantity, unit } = item;

      // Enhanced validation
      if (!menu_item_id || isNaN(parseInt(menu_item_id)) || parseInt(menu_item_id) <= 0) {
        throw new Error('Invalid menu_item_id: must be a valid positive number');
      }

      if (!quantity || isNaN(parseFloat(quantity)) || parseFloat(quantity) <= 0) {
        throw new Error('Invalid quantity: must be a positive number');
      }

      // Get menu item details
      const menuItemQuery = `
        SELECT price, name FROM MenuItems 
        WHERE menu_item_id = $1 AND business_id = 1 AND is_active = true
      `;
      const menuItemResult = await client.query(menuItemQuery, [parseInt(menu_item_id)]);

      if (menuItemResult.rows.length === 0) {
        throw new Error(`Menu item with ID ${menu_item_id} not found or inactive`);
      }

      const itemDetails = menuItemResult.rows[0];

      // Check if recipe mapping exists for this menu item
      const recipeCheck = await client.query(`
        SELECT COUNT(*) as ingredient_count
        FROM RecipeIngredients ri
        JOIN Recipes r ON ri.recipe_id = r.recipe_id
        WHERE r.recipe_id = $1
      `, [parseInt(menu_item_id)]);

      const ingredientCount = parseInt(recipeCheck.rows[0]?.ingredient_count || 0);

      // Create incomplete recipe notification if no ingredients mapped
      if (ingredientCount === 0) {
        try {
          await fetch(`${process.env.API_BASE_URL || 'http://localhost:5000'}/api/notifications/usage/incomplete-recipe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              businessId: 1,
              userId: userId,
              dishName: itemDetails.name,
              missingIngredients: ['Recipe mapping required']
            })
          });
        } catch (notifError) {
          console.log('Incomplete recipe notification failed:', notifError.message);
        }
      }

      const estimatedCost = parseFloat(quantity) * parseFloat(itemDetails.price);
      totalEstimatedCost += estimatedCost;

      // Create usage item record in UsageItems table
      const usageItemQuery = `
        INSERT INTO UsageItems (
          event_id, dish_id, quantity_produced, unit, notes
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING usage_item_id
      `;

      const usageItemResult = await client.query(usageItemQuery, [
        eventId, // from the UsageEvent created earlier
        parseInt(menu_item_id),
        parseFloat(quantity),
        unit || 'Servings',
        notes || `Production usage recorded - ${shift} shift`
      ]);

      const usageItemId = usageItemResult.rows[0].usage_item_id;
      usageRecords.push({
        usage_item_id: usageItemId,
        item_name: itemDetails.name,
        quantity: parseFloat(quantity),
        unit: unit || 'Servings',
        estimated_cost: estimatedCost
      });
    }

    // Submit the usage event (change status from draft to submitted)
    await client.query(
      `UPDATE UsageEvents 
       SET status = 'submitted', 
           submitted_by_user_id = $1, 
           updated_at = NOW() 
       WHERE event_id = $2`,
      [userId, eventId]
    );

    await client.query('COMMIT');

    // Create successful submission notification
    try {
      const dishNames = usageRecords.map(record => record.item_name);
      await fetch(`${process.env.API_BASE_URL || 'http://localhost:5000'}/api/notifications/usage/successful-submission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 1,
          userId: userId,
          date: production_date,
          dishCount: items.length,
          totalIngredients: usageRecords.length,
          dishNames: dishNames
        })
      });
    } catch (notifError) {
      console.log('Usage submission notification failed:', notifError.message);
    }

    // Check for unusual sales volume (if more than 20 items or total cost > 5000)
    if (items.length > 20 || totalEstimatedCost > 5000) {
      try {
        await fetch(`${process.env.API_BASE_URL || 'http://localhost:5000'}/api/notifications/usage/unusual-sales`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessId: 1,
            userId: userId,
            date: production_date,
            actualVolume: items.length,
            averageVolume: '10-15 items',
            percentage: `${Math.round((items.length / 15) * 100)}%`,
            isHigh: true
          })
        });
      } catch (notifError) {
        console.log('Unusual sales volume notification failed:', notifError.message);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Usage event created successfully',
      data: {
        event_id: eventId,
        total_items: items.length,
        total_estimated_cost: totalEstimatedCost.toFixed(2),
        production_date,
        shift: `${shift} (${shift_time})`,
        records: usageRecords
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error recording usage:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to record usage',
      details: error.message
    });
  } finally {
    client.release();
  }
});

// GET /api/usage/records - Get usage records
router.get('/records', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const query = `
      SELECT 
        ue.event_id,
        ue.production_date,
        ue.shift,
        ue.notes,
        ue.status,
        ue.created_at,
        ue.submitted_at,
        u1.name as created_by_name,
        u2.name as submitted_by_name,
        COUNT(ui.usage_item_id) as total_items,
        SUM(ui.quantity_produced * mi.price) as total_estimated_cost,
        JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(
          'dish_id', mi.menu_item_id,
          'name', mi.name,
          'price', mi.price,
          'image_url', mi.image_url
        )) FILTER (WHERE mi.menu_item_id IS NOT NULL) as dishes
      FROM UsageEvents ue
      LEFT JOIN Users u1 ON ue.created_by_user_id = u1.user_id
      LEFT JOIN Users u2 ON ue.submitted_by_user_id = u2.user_id
      LEFT JOIN UsageItems ui ON ue.event_id = ui.event_id
      LEFT JOIN MenuItems mi ON ui.dish_id = mi.menu_item_id
      WHERE ue.business_id = 1
      GROUP BY ue.event_id, ue.production_date, ue.shift, ue.notes, ue.status, 
               ue.created_at, ue.submitted_at, u1.name, u2.name
      ORDER BY ue.created_at DESC, ue.production_date DESC
      LIMIT $1 OFFSET $2
    `;

    const result = await pool.query(query, [limit, offset]);

    // Augment dishes with image meta using shared utility (if any dishes present)
    const { buildImageMeta } = require('../utils/imageAugment');
    const protocol = 'http';
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    const augmented = result.rows.map(row => {
      if (!row.dishes) return row;
      try {
        const dishes = row.dishes.map(d => ({
          ...d,
          ...buildImageMeta({ name: d.name, image_url: d.image_url }, baseUrl)
        }));
        return { ...row, dishes };
      } catch (e) {
        return row; // fail silently for robustness
      }
    });

    res.status(200).json({
      success: true,
      data: augmented,
      pagination: {
        page,
        limit,
        total_records: augmented.length
      }
    });
  } catch (error) {
    console.error('Error fetching usage records:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch usage records',
      details: error.message
    });
  }
});

// GET /api/usage/summary - Get usage summary by date range
router.get('/summary', async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    let dateFilter = '';
    let queryParams = [1]; // business_id
    
    if (start_date && end_date) {
      dateFilter = 'AND ue.production_date BETWEEN $2 AND $3';
      queryParams.push(start_date, end_date);
    } else if (start_date) {
      dateFilter = 'AND ue.production_date >= $2';
      queryParams.push(start_date);
    } else if (end_date) {
      dateFilter = 'AND ue.production_date <= $2';
      queryParams.push(end_date);
    }

    const query = `
      SELECT 
        ue.production_date,
        ue.shift,
        COUNT(DISTINCT ui.dish_id) as total_items_produced,
        SUM(ui.quantity_produced) as total_quantity,
        SUM(ui.quantity_produced * mi.price) as total_estimated_cost,
        STRING_AGG(DISTINCT mi.name, ', ') as items_produced
      FROM UsageEvents ue
      JOIN UsageItems ui ON ue.event_id = ui.event_id
      JOIN MenuItems mi ON ui.dish_id = mi.menu_item_id
      WHERE ue.business_id = $1 AND ue.status = 'submitted' ${dateFilter}
      GROUP BY ue.production_date, ue.shift
      ORDER BY ue.production_date DESC, ue.shift
    `;

    const result = await pool.query(query, queryParams);

    res.status(200).json({
      success: true,
      data: result.rows,
      summary: {
        total_production_days: result.rows.length,
        total_estimated_cost: result.rows.reduce((sum, row) => sum + parseFloat(row.total_estimated_cost || 0), 0)
      }
    });
  } catch (error) {
    console.error('Error fetching usage summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch usage summary',
      details: error.message
    });
  }
});

module.exports = router;