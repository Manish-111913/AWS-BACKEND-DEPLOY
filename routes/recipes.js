const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const fetch = require('node-fetch');
const { buildImageMeta } = require('../utils/imageAugment');

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

// Helper to ensure a unit exists in GlobalUnits and return its unit_id
async function ensureUnit(client, symbol) {
  const sym = (symbol || 'g').trim();
  let res = await client.query('SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $1 LIMIT 1', [sym]);
  if (res.rows.length > 0) return res.rows[0].unit_id;

  // Infer unit type and name
  const lower = sym.toLowerCase();
  let unit_type = 'Other';
  if (['g', 'kg'].includes(lower)) unit_type = 'Weight';
  else if (['ml', 'l', 'tsp', 'tbsp', 'cup'].includes(lower)) unit_type = 'Volume';
  else if (['pc', 'pcs'].includes(lower)) unit_type = 'Count';
  const unit_name = sym; // keep simple; symbol as name

  await client.query(`
    INSERT INTO GlobalUnits (unit_name, unit_symbol, unit_type, is_active, created_at)
    VALUES ($1, $2, $3, TRUE, CURRENT_TIMESTAMP)
    ON CONFLICT (unit_symbol) DO NOTHING
  `, [unit_name, sym, unit_type]);
  res = await client.query('SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $1 LIMIT 1', [sym]);
  return res.rows[0]?.unit_id || 1; // last fallback
}

// GET /api/recipes - Get all recipes with ingredients
router.get('/', async (req, res) => {
  try {
    const { category } = req.query || {};
    const businessId = parseInt(req.headers['x-tenant-id'] || req.headers['X-Tenant-Id'] || req.query.businessId || 1, 10) || 1;
    const includeComplimentary = ['1', 'true', 'yes'].includes(String(req.query?.includeComplimentary || '').toLowerCase());
    console.log('🔍 Fetching recipes...', category ? `(category=${category})` : '');
    
    // Build dynamic filters
    const filters = ['mi.is_active = true', 'mi.business_id = $1'];
    const params = [businessId];
    if (category) {
      params.push(category);
      filters.push(`LOWER(mc.name) = LOWER($${params.length})`);
    }
    // Exclude complimentary items from listing (server-side) unless explicitly requested
    if (!includeComplimentary) {
      // Exclude names ending with these words (common complimentary dishes)
      filters.push(`mi.name !~* '(chutney|sambar|podi|raita|pickle|salad)\\s*$'`);
    }

    const baseSelect = `
      SELECT 
        r.recipe_id as id,
        mi.name,
        CAST(mi.price AS DECIMAL(10,2)) as price,
        CAST(mi.servings_per_batch AS DECIMAL(10,2)) as servings,
        mc.name as category,
        mi.image_url,
        r.instructions,
        r.estimated_cost,
        r.prep_time_minutes,
        r.cook_time_minutes,
        COUNT(ri.recipe_ingredient_id) as ingredientsCount,
        bs.setting_value as status
      FROM Recipes r
      JOIN MenuItems mi ON r.recipe_id = mi.menu_item_id
      LEFT JOIN MenuCategories mc ON mi.category_id = mc.category_id
      LEFT JOIN RecipeIngredients ri ON r.recipe_id = ri.recipe_id
      LEFT JOIN BusinessSettings bs ON bs.business_id = mi.business_id AND bs.setting_key = ('recipe_status:' || r.recipe_id)
      WHERE ${filters.join(' AND ')}
      GROUP BY r.recipe_id, mi.name, mi.price, mi.servings_per_batch, mc.name, mi.image_url, r.instructions, r.estimated_cost, r.prep_time_minutes, r.cook_time_minutes, bs.setting_value
      ORDER BY mi.name`;
    
    let result;
    try {
      // Set tenant context for RLS
      await pool.query("SELECT set_config('app.current_business_id', $1, false)", [String(businessId)]);
      result = await pool.query(baseSelect, params);
    } catch (e) {
      // Fallback if BusinessSettings table doesn't exist
      if (e && e.code === '42P01') {
        const fbFilters = ['mi.is_active = true', 'mi.business_id = $1'];
        const fbParams = [businessId];
        if (category) {
          fbParams.push(category);
          fbFilters.push(`LOWER(mc.name) = LOWER($${fbParams.length})`);
        }
        if (!includeComplimentary) {
          fbFilters.push(`mi.name !~* '(chutney|sambar|podi|raita|pickle|salad)\\s*$'`);
        }
        const fallbackQuery = `
          SELECT 
            r.recipe_id as id,
            mi.name,
            CAST(mi.price AS DECIMAL(10,2)) as price,
            CAST(mi.servings_per_batch AS DECIMAL(10,2)) as servings,
            mc.name as category,
            mi.image_url,
            r.instructions,
            r.estimated_cost,
            r.prep_time_minutes,
            r.cook_time_minutes,
            COUNT(ri.recipe_ingredient_id) as ingredientsCount,
            NULL::text as status
          FROM Recipes r
          JOIN MenuItems mi ON r.recipe_id = mi.menu_item_id
          LEFT JOIN MenuCategories mc ON mi.category_id = mc.category_id
          LEFT JOIN RecipeIngredients ri ON r.recipe_id = ri.recipe_id
          WHERE ${fbFilters.join(' AND ')}
          GROUP BY r.recipe_id, mi.name, mi.price, mi.servings_per_batch, mc.name, mi.image_url, r.instructions, r.estimated_cost, r.prep_time_minutes, r.cook_time_minutes
          ORDER BY mi.name`;
        await pool.query("SELECT set_config('app.current_business_id', $1, false)", [String(businessId)]);
        result = await pool.query(fallbackQuery, fbParams);
      } else {
        throw e;
      }
    }
    console.log(`📦 Found ${result.rows.length} recipes`);
    
    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;
    
    const recipes = result.rows.map(recipe => {
      const meta = buildImageMeta({ name: recipe.name, image_url: recipe.image_url }, baseUrl, { enableGridFs: true });
      return {
        ...recipe,
        price: parseFloat(recipe.price),
        servings: parseFloat(recipe.servings),
        image: meta.img,
        fallback_img: meta.fallback_img,
        // Expose the complete list of fallback URLs so the UI can try multiple
        // candidates (different extensions, slug variants, GridFS) before
        // showing a placeholder.
        fallbacks: meta.fallbacks,
        placeholder_img: meta.placeholder_img,
        status: recipe.status || null
      };
    });
    
    res.json({
      success: true,
      data: recipes
    });
  } catch (error) {
    console.error('❌ Error fetching recipes:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recipes',
      details: error.message
    });
  }
});

// GET /api/recipes/:id/ingredients - Get ingredients for a specific recipe
router.get('/:id/ingredients', async (req, res) => {
  try {
    const { id } = req.params;
    const debugRecipes = process.env.DEBUG_RECIPES === 'true';
    if (debugRecipes) console.log(`🔍 Fetching ingredients for recipe ${id}`);
    
    const query = `
      SELECT 
        ri.recipe_ingredient_id,
        ii.name,
        CAST(ri.quantity AS DECIMAL(10,4)) as quantity,
        gu.unit_symbol as unit,
        ri.notes
      FROM RecipeIngredients ri
      JOIN InventoryItems ii ON ri.item_id = ii.item_id
      JOIN GlobalUnits gu ON ri.unit_id = gu.unit_id
      WHERE ri.recipe_id = $1
      ORDER BY ii.name
    `;
    
    const result = await pool.query(query, [id]);
  if (debugRecipes) console.log(`📦 Found ${result.rows.length} ingredients for recipe ${id}`);
    
    const ingredients = result.rows.map(ingredient => ({
      ...ingredient,
      quantity: parseFloat(ingredient.quantity)
    }));
    
    res.json({
      success: true,
      data: ingredients
    });
  } catch (error) {
    console.error('❌ Error fetching recipe ingredients:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recipe ingredients',
      details: error.message
    });
  }
});

// POST /api/recipes - Create a new recipe
router.post('/', async (req, res) => {
  try {
    const { name, price, servings } = req.body;
    const businessId = parseInt(req.headers['x-tenant-id'] || req.headers['X-Tenant-Id'] || req.body?.businessId || 1, 10) || 1;
    await pool.query("SELECT set_config('app.current_business_id', $1, false)", [String(businessId)]);
    
    console.log(`➕ Creating new recipe:`, { name, price, servings });
    
    if (!name) {
      return res.status(400).json({ success: false, error: 'Name required' });
    }
    
    const menuItemResult = await pool.query(`
      INSERT INTO MenuItems (business_id, name, category_id, price, servings_per_batch, serving_unit_id, is_active, created_at, updated_at)
      VALUES ($1, $2, 1, $3, $4, 6, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING menu_item_id
    `, [businessId, name, price || 0, servings || 1]);
    
    const menuItemId = menuItemResult.rows[0].menu_item_id;
    
    await pool.query(`
      INSERT INTO Recipes (recipe_id, instructions, created_at, updated_at) 
      VALUES ($1, 'Instructions', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [menuItemId]);
    
    console.log(`✅ Created recipe with ID: ${menuItemId}`);
    
    // Fire-and-forget: zero-cost recipe alert (new recipes have 0 cost)
    try {
      await fetch(`${process.env.API_BASE_URL || 'http://localhost:5000'}/api/notifications/ingredient-mapping/check-zero-cost-recipes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, userId: 1, mode: 'detail', maxPerRun: 3 })
      });
    } catch (_) {}

    res.json({
      success: true,
      data: { id: menuItemId, name, price: parseFloat(price || 0), servings: parseInt(servings || 1), ingredientscount: 0 }
    });
  } catch (error) {
    console.error('❌ Error creating recipe:', error);
    res.status(500).json({ success: false, error: 'Failed to create recipe', details: error.message });
  }
});

// PUT /api/recipes/:id - Update a recipe
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, servings } = req.body;
    
    console.log(`🔄 Updating recipe ${id}:`, { name, price, servings });
    
    // Update menu item
    // Determine business from the menu item itself
    const bizRow = await pool.query('SELECT business_id FROM MenuItems WHERE menu_item_id = $1 LIMIT 1', [id]);
    const businessId = bizRow.rows[0]?.business_id || 1;
    await pool.query("SELECT set_config('app.current_business_id', $1, false)", [String(businessId)]);
    const updateMenuQuery = `
      UPDATE MenuItems 
      SET name = $1, price = $2, servings_per_batch = $3, updated_at = CURRENT_TIMESTAMP
      WHERE menu_item_id = $4 AND business_id = $5
      RETURNING menu_item_id, name, price, servings_per_batch
    `;
    
    const result = await pool.query(updateMenuQuery, [name, price, servings, id, businessId]);
    
    if (result.rows.length === 0) {
      throw new Error('Recipe not found or not authorized');
    }
    
    const updatedRecipe = result.rows[0];
    console.log(`✅ Recipe ${id} updated successfully`);
    
    res.json({
      success: true,
      data: {
        id: updatedRecipe.menu_item_id,
        name: updatedRecipe.name,
        price: parseFloat(updatedRecipe.price),
        servings: parseFloat(updatedRecipe.servings_per_batch)
      }
    });
  } catch (error) {
    console.error('❌ Error updating recipe:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update recipe',
      details: error.message
    });
  }
});

// PUT /api/recipes/:id/ingredients - Update recipe ingredients
router.put('/:id/ingredients', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { ingredients } = req.body;
  // TODO: pull real userId from auth once available
  const userId = parseInt(req.body?.userId, 10) || 1;
  // Fetch dish/business for notifications
  const dishRow = await client.query('SELECT name, business_id FROM MenuItems WHERE menu_item_id = $1', [id]);
  const dishName = dishRow.rows[0]?.name || `Recipe ${id}`;
  const businessId = dishRow.rows[0]?.business_id || 1;
  await client.query("SELECT set_config('app.current_business_id', $1, false)", [String(businessId)]);
    
    console.log(`🔄 Updating ingredients for recipe ${id}:`, ingredients);
    
    // Delete existing ingredients
    await client.query('DELETE FROM RecipeIngredients WHERE recipe_id = $1', [id]);
    console.log(`🗑️ Deleted existing ingredients for recipe ${id}`);
    
    let ingredientCount = 0;
  const processed = []; // track inserted/updated ingredients for notifications
    
    // Add new ingredients
    if (ingredients && ingredients.length > 0) {
      for (const ingredient of ingredients) {
        if (ingredient.quantity > 0 && ingredient.name && ingredient.name !== 'New Ingredient') {
          console.log(`📦 Processing ingredient: ${ingredient.name} - ${ingredient.quantity} ${ingredient.unit}`);
          
          // First, try to find existing inventory item
          let itemResult = await client.query(
            'SELECT item_id FROM InventoryItems WHERE LOWER(TRIM(name)) = LOWER(TRIM($1)) AND business_id = $2 LIMIT 1',
            [ingredient.name, businessId]
          );
          
          let itemId;
          let createdNewItem = false;
          if (itemResult.rows.length === 0) {
            // Create new inventory item if it doesn't exist
            console.log(`➕ Creating new inventory item: ${ingredient.name}`);
            
            // Get or create unit_id for the ingredient unit
            const unitId = await ensureUnit(client, ingredient.unit || 'g');
            
            const newItemResult = await client.query(`
              INSERT INTO InventoryItems (business_id, name, standard_unit_id, is_active, created_at, updated_at, source)
              VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'ingredient_mapping')
              RETURNING item_id
            `, [businessId, ingredient.name.trim(), unitId]);
            
            itemId = newItemResult.rows[0].item_id;
            createdNewItem = true;
            console.log(`✅ Created inventory item with ID: ${itemId}`);

            // Also notify ingredient not in inventory (guides user to Stock-In)
            try {
              await fetch(`${process.env.API_BASE_URL || 'http://localhost:5000'}/api/notifications/ingredient-mapping/ingredient-not-in-inventory`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ businessId, userId, ingredientName: ingredient.name })
              });
            } catch (_) {}
          } else {
            itemId = itemResult.rows[0].item_id;
            console.log(`🔍 Found existing inventory item with ID: ${itemId}`);
          }
          
          // Get or create unit_id for recipe ingredient
          const recipeUnitId = await ensureUnit(client, ingredient.unit || 'g');
          
          // Insert recipe ingredient
          await client.query(`
            INSERT INTO RecipeIngredients (recipe_id, item_id, quantity, unit_id, created_at, updated_at)
            VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (recipe_id, item_id)
            DO UPDATE SET quantity = EXCLUDED.quantity, unit_id = EXCLUDED.unit_id, updated_at = CURRENT_TIMESTAMP
          `, [id, itemId, ingredient.quantity, recipeUnitId]);
          
          ingredientCount++;
          console.log(`✅ Added recipe ingredient: ${ingredient.name}`);

          // Collect data for notifications
          // Fetch standard unit and symbols
          const unitInfo = await client.query(
            `SELECT ii.standard_unit_id, 
                    COALESCE(NULLIF(TRIM(gu1.unit_symbol), ''), gu1.unit_name) AS standard_unit_symbol,
                    COALESCE(NULLIF(TRIM(gu2.unit_symbol), ''), gu2.unit_name) AS recipe_unit_symbol
             FROM InventoryItems ii
             JOIN GlobalUnits gu1 ON gu1.unit_id = ii.standard_unit_id
             JOIN GlobalUnits gu2 ON gu2.unit_id = $3
             WHERE ii.item_id = $1 AND ii.business_id = $2
             LIMIT 1`,
            [itemId, businessId, recipeUnitId]
          );
          const ui = unitInfo.rows[0] || {};
          processed.push({
            itemId,
            ingredientName: ingredient.name,
            recipeUnitId,
            recipeUnitSymbol: ui.recipe_unit_symbol,
            standardUnitId: ui.standard_unit_id,
            standardUnitSymbol: ui.standard_unit_symbol,
            createdNewItem
          });
        }
      }
    }
    // Create notifications
    try {
      if (ingredientCount > 0) {
        // Info notification for recipe updated (same title format as notifications module)
        const title = `Recipe Updated: ${dishName}`;
        const description = `The recipe for ${dishName} was updated. ${ingredientCount} ingredient${ingredientCount > 1 ? 's' : ''} saved. Review ingredient mapping and costs if needed.`;
        await insertNotification(client, {
          businessId,
          userId,
          type: 'info',
          title,
          description,
          relatedUrl: `/recipes?dish=${id}`
        });

        // Per-ingredient: notify on new inventory item creation
        for (const p of processed) {
          if (p.createdNewItem) {
            const createTitle = `New Inventory Item Created: ${p.ingredientName}`;
            const createDesc = `We created a new inventory item "${p.ingredientName}" when updating the recipe ${dishName}.${p.standardUnitSymbol ? ` Standard unit: ${p.standardUnitSymbol}.` : ''} You may want to set reorder points, vendor, and ABC category.`;
            await insertNotification(client, {
              businessId,
              userId,
              type: 'success',
              title: createTitle,
              description: createDesc,
              relatedUrl: `/inventory?search=${encodeURIComponent(p.ingredientName)}`
            });
          }
        }

        // Per-ingredient unmapped unit warnings
        for (const p of processed) {
          // Skip when units match
          if (!p.standardUnitId || !p.recipeUnitId || Number(p.standardUnitId) === Number(p.recipeUnitId)) continue;
          const conv = await client.query(
            `SELECT 1 FROM BusinessUnitConversions bc
             WHERE bc.business_id = $1 AND (
               (bc.from_unit_id = $2 AND bc.to_unit_id = $3) OR
               (bc.from_unit_id = $3 AND bc.to_unit_id = $2)
             ) LIMIT 1`,
            [businessId, p.recipeUnitId, p.standardUnitId]
          );
          if (conv.rows.length === 0) {
            const warnTitle = `Unmapped Ingredient Unit: ${p.ingredientName}`;
            const warnDesc = `The ingredient ${p.ingredientName} in recipe ${dishName} uses unit "${p.recipeUnitSymbol || p.recipeUnitId}" but the inventory item uses "${p.standardUnitSymbol || p.standardUnitId}". Add a unit conversion so deductions are accurate.`;
            await insertNotification(client, {
              businessId,
              userId,
              type: 'warning',
              title: warnTitle,
              description: warnDesc,
              relatedUrl: `/recipes?dish=${id}`
            });
          }
        }

        // Zero-cost recipe alert for this dish
        const costRes = await client.query('SELECT estimated_cost FROM Recipes WHERE recipe_id = $1 LIMIT 1', [id]);
        const estCost = Number(costRes.rows[0]?.estimated_cost || 0);
        if (!estCost) {
          try {
            await insertNotification(client, {
              businessId,
              userId,
              type: 'warning',
              title: `Zero-Cost Recipe: ${dishName}`,
              description: `The recipe for ${dishName} has no cost data. Ensure raw ingredients have cost per unit in Stock In/Inventory.`,
              relatedUrl: `/recipes?dish=${id}`
            });
          } catch (_) {}
        }
      }
    } catch (nerr) {
      // Log but don't fail the main transaction
      console.warn('⚠️ Notification creation failed:', nerr?.message || nerr);
    }

    await client.query('COMMIT');
    console.log(`🎉 Successfully updated ${ingredientCount} ingredients for recipe ${id}`);
    
    res.json({
      success: true,
      message: 'Recipe ingredients updated successfully',
      ingredientCount,
      data: { recipeId: id, ingredientCount }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error updating recipe ingredients:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update recipe ingredients',
      details: error.message
    });
  } finally {
    client.release();
  }
});

// DELETE /api/recipes/:id - Delete a recipe
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    console.log(`🗑️ Deleting recipe ${id}`);
    
    // Delete recipe ingredients first
    await client.query('DELETE FROM RecipeIngredients WHERE recipe_id = $1', [id]);
    
    // Delete recipe
    await client.query('DELETE FROM Recipes WHERE recipe_id = $1', [id]);
    
    // Delete menu item
    const result = await client.query(
      'DELETE FROM MenuItems WHERE menu_item_id = $1 AND business_id = 1 RETURNING menu_item_id',
      [id]
    );
    
    if (result.rows.length === 0) {
      throw new Error('Recipe not found or not authorized');
    }
    
    await client.query('COMMIT');
    console.log(`✅ Recipe ${id} deleted successfully`);
    
    res.json({
      success: true,
      message: 'Recipe deleted successfully'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error deleting recipe:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete recipe',
      details: error.message
    });
  } finally {
    client.release();
  }
});

// PUT /api/recipes/:id/status - Set recipe confirmation status (persisted)
router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!['confirmed', 'draft', null, undefined].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status. Use "confirmed" or "draft".' });
    }

    const settingKey = `recipe_status:${id}`;

    // Upsert into BusinessSettings (business_id fixed to 1 for now)
    const upsert = await pool.query(`
      INSERT INTO BusinessSettings (business_id, setting_key, setting_value, data_type, module_scope, description, updated_at)
      VALUES (1, $1, $2, 'string', 'recipes', 'Recipe confirmation status', CURRENT_TIMESTAMP)
      ON CONFLICT (business_id, setting_key)
      DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP
      RETURNING setting_value
    `, [settingKey, status || null]);

    res.json({ success: true, data: { recipeId: Number(id), status: upsert.rows[0]?.setting_value || null } });
  } catch (error) {
    console.error('❌ Error setting recipe status:', error);
    res.status(500).json({ success: false, error: 'Failed to set recipe status', details: error.message });
  }
});

module.exports = router;