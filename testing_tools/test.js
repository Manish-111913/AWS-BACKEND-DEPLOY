// Quick check for Vegetable Biryani ingredients in InventoryItems and recipe mapping
// Usage: from repo root or backend folder, ensure backend/.env has DATABASE_URL, then run:
//   node backend/testing_tools/test.js

const path = require('path');
const { pool, testConnection } = require('../config/database');

const BUSINESS_ID = Number(process.env.BUSINESS_ID || 1);

const EXPECTED_INGREDIENTS = [
  { name: 'Basmati Rice' },
  { name: 'Tomatoes' },
  { name: 'Onions' },
  { name: 'Red Chili Powder' },
  { name: 'Cooking Oil' },
];

async function checkInventoryPresence() {
  const names = EXPECTED_INGREDIENTS.map(i => i.name);
  const { rows } = await pool.query(
    `SELECT item_id, name, standard_unit_id, reorder_point, safety_stock
     FROM InventoryItems
     WHERE business_id = $1 AND name = ANY($2::text[])`,
    [BUSINESS_ID, names]
  );
  const map = new Map(rows.map(r => [r.name, r]));
  return EXPECTED_INGREDIENTS.map(x => ({
    name: x.name,
    present: map.has(x.name),
    info: map.get(x.name) || null,
  }));
}

async function fetchRecipeMapping() {
  // Try to read the DB recipe mapping for 'Vegetable Biryani'
  // Tables/columns are inferred from seed scripts; adjust if your schema differs.
  const sql = `
    SELECT mi.name AS menu_item, ii.name AS inventory_item, ri.quantity AS quantity
    FROM MenuItems mi
    JOIN Recipes r ON r.recipe_id = mi.menu_item_id
    JOIN RecipeIngredients ri ON ri.recipe_id = r.recipe_id
    JOIN InventoryItems ii ON ii.item_id = ri.item_id
    WHERE mi.business_id = $1 AND mi.name = 'Vegetable Biryani'
    ORDER BY ii.name;
  `;
  try {
    const { rows } = await pool.query(sql, [BUSINESS_ID]);
    return rows;
  } catch (err) {
    console.warn('Recipe join failed (fallback to inventory-only check):', err.message);
    return [];
  }
}

async function checkPresenceAndStockFor(names) {
  if (!names.length) return [];
  const { rows } = await pool.query(
    `SELECT ii.item_id, ii.name,
            COALESCE(SUM(CASE WHEN ib.is_expired = false THEN ib.quantity ELSE 0 END), 0) AS current_stock
     FROM InventoryItems ii
     LEFT JOIN InventoryBatches ib ON ib.item_id = ii.item_id
     WHERE ii.business_id = $1 AND ii.name = ANY($2::text[])
     GROUP BY ii.item_id, ii.name`,
    [BUSINESS_ID, names]
  );
  const map = new Map(rows.map(r => [r.name, r]));
  return names.map(n => ({
    name: n,
    present: map.has(n),
    current_stock: map.has(n) ? Number(rows.find(r => r.name === n).current_stock) : 0,
  }));
}

async function main() {
  try {
    await testConnection(1);

    console.log('\n== Expected Ingredients for Vegetable Biryani (from seed assumptions) ==');
    console.table([
      { name: 'Basmati Rice', quantity: 0.25, unit: 'kg' },
      { name: 'Tomatoes', quantity: 0.10, unit: 'kg' },
      { name: 'Onions', quantity: 0.10, unit: 'kg' },
      { name: 'Red Chili Powder', quantity: 0.02, unit: 'kg' },
      { name: 'Cooking Oil', quantity: 0.04, unit: 'liter' },
    ]);

    const presence = await checkInventoryPresence();
    console.log('\n== Seeded In Inventory? ==');
    console.table(presence.map(p => ({ name: p.name, present: p.present })));

    const recipe = await fetchRecipeMapping();
    if (recipe.length) {
      console.log('\n== Recipe mapping from DB (MenuItems/Recipes/RecipeIngredients) ==');
      console.table(recipe.map(r => ({ ingredient: r.inventory_item, quantity: Number(r.quantity) })));

      const ingredientNames = Array.from(new Set(recipe.map(r => r.inventory_item)));
      const presenceAndStock = await checkPresenceAndStockFor(ingredientNames);
      console.log('\n== Real-time presence and current stock for all recipe ingredients ==');
      console.table(presenceAndStock);
    } else {
      console.log('\n(no recipe ingredients found in DB; relying on seed expectations above)');
    }
  } catch (e) {
    console.error('Test failed:', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
