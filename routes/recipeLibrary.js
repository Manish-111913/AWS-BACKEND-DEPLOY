const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { menuItems } = require('../data/menuItems');

// GET /api/recipe-library/search?q=chicken
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim().toLowerCase();
    let results = menuItems;
    if (q) {
      results = menuItems.filter(m => m.name.toLowerCase().includes(q));
    }
    res.json({ success: true, data: results.slice(0, 25) });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to search library', details: err.message });
  }
});

// POST /api/recipe-library/import -> create MenuItem + Recipe + Ingredients from library template
router.post('/import', async (req, res) => {
  const client = await pool.connect();
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const tpl = menuItems.find(m => m.name.toLowerCase() === name.toLowerCase());
    if (!tpl) return res.status(404).json({ success: false, error: 'template not found' });

    await client.query('BEGIN');

    // Create menu item
    const mi = await client.query(`
      INSERT INTO MenuItems (business_id, name, category_id, price, servings_per_batch, serving_unit_id, is_active, created_at, updated_at)
      VALUES (1, $1, 1, $2, $3, 6, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (business_id, name) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
      RETURNING menu_item_id
    `, [tpl.name, tpl.price || 0, tpl.servings || 1]);

    const recipeId = mi.rows[0].menu_item_id;

    // Ensure recipe row exists
    await client.query(`
      INSERT INTO Recipes (recipe_id, instructions, created_at, updated_at)
      VALUES ($1, 'Imported from library', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT (recipe_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
    `, [recipeId]);

    // Clear existing ingredients
    await client.query('DELETE FROM RecipeIngredients WHERE recipe_id = $1', [recipeId]);

    // Insert ingredients; also upsert inventory items by name
    for (const ing of (tpl.ingredients || [])) {
      // Inventory item
      const unitRes = await client.query('SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $1 LIMIT 1', [ing.unit || 'g']);
      const unitId = unitRes.rows[0]?.unit_id || 1;

      const inv = await client.query(`
        INSERT INTO InventoryItems (business_id, name, standard_unit_id, is_active, created_at, updated_at)
        VALUES (1, $1, $2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (business_id, name) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
        RETURNING item_id
      `, [ing.name, unitId]);

      const itemId = inv.rows[0].item_id;

      // Per-plate quantity from template is already per-serving
      await client.query(`
        INSERT INTO RecipeIngredients (recipe_id, item_id, quantity, unit_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [recipeId, itemId, ing.quantity, unitId]);
    }

    await client.query('COMMIT');
    res.json({ success: true, data: { id: recipeId, name: tpl.name } });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: 'Failed to import recipe', details: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
