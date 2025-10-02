// Seed inventory to cover 50 plates of Vegetable Biryani using current DB recipe mapping (13 ingredients)
// Run: node backend/testing_tools/seedBiryaniFor50.js

const { pool, testConnection } = require('../config/database');

const BUSINESS_ID = Number(process.env.BUSINESS_ID || 1);
const MENU_ITEM_NAME = 'Vegetable Biryani';
const PLATES = 50;

async function getRecipeIngredients() {
  const sql = `
    SELECT ri.item_id,
           ii.name,
           CAST(ri.quantity AS DECIMAL) AS per_plate,
           ii.standard_unit_id,
           ii.default_vendor_id,
           COALESCE(ii.track_expiry, false) AS track_expiry,
           ii.shelf_life_days
    FROM MenuItems mi
    JOIN Recipes r ON r.recipe_id = mi.menu_item_id
    JOIN RecipeIngredients ri ON ri.recipe_id = r.recipe_id
    JOIN InventoryItems ii ON ii.item_id = ri.item_id
    WHERE mi.business_id = $1 AND mi.name = $2
    ORDER BY ii.name`;
  const { rows } = await pool.query(sql, [BUSINESS_ID, MENU_ITEM_NAME]);
  return rows.map(r => ({
    item_id: r.item_id,
    name: r.name,
    per_plate: Number(r.per_plate),
    standard_unit_id: r.standard_unit_id,
    default_vendor_id: r.default_vendor_id,
    track_expiry: r.track_expiry,
    shelf_life_days: r.shelf_life_days === null ? null : Number(r.shelf_life_days),
  }));
}

async function getCurrentStock(itemId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN is_expired = false THEN quantity ELSE 0 END), 0) AS stock
     FROM InventoryBatches WHERE item_id = $1`,
    [itemId]
  );
  return Number(rows[0].stock || 0);
}

async function getLastUnitCost(itemId) {
  const { rows } = await pool.query(
    `SELECT unit_cost FROM InventoryBatches WHERE item_id = $1 ORDER BY batch_id DESC LIMIT 1`,
    [itemId]
  );
  return rows.length ? Number(rows[0].unit_cost) : 1.0;
}

async function insertBatch({ item_id, quantity, vendor_id, expiry_date }) {
  const unit_cost = await getLastUnitCost(item_id);
  const received_date = new Date();
  await pool.query(
    `INSERT INTO InventoryBatches (item_id, quantity, unit_cost, expiry_date, received_date, vendor_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [item_id, quantity, unit_cost, expiry_date, received_date, vendor_id]
  );
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function main() {
  await testConnection(1);

  const ingredients = await getRecipeIngredients();
  if (!ingredients.length) {
    console.error(`No recipe ingredients found for ${MENU_ITEM_NAME}. Aborting.`);
    process.exitCode = 1;
    await pool.end();
    return;
  }

  console.log(`\nSeeding for ${PLATES} plates of ${MENU_ITEM_NAME} (business_id=${BUSINESS_ID})`);

  const summary = [];

  for (const ing of ingredients) {
    const required = ing.per_plate * PLATES;
    const current = await getCurrentStock(ing.item_id);
    const deficit = Math.max(0, required - current);
    let inserted = 0;

    if (deficit > 0) {
      const vendor = ing.default_vendor_id || null;
      const expiry = ing.track_expiry && ing.shelf_life_days
        ? addDays(new Date(), ing.shelf_life_days)
        : null;
      await insertBatch({ item_id: ing.item_id, quantity: deficit, vendor_id: vendor, expiry_date: expiry });
      inserted = deficit;
    }

    summary.push({
      ingredient: ing.name,
      per_plate: ing.per_plate,
      required_total: required,
      current_stock: current,
      inserted_quantity: inserted,
      final_stock: current + inserted,
    });
  }

  console.log(`\n== Seed Summary ==`);
  console.table(summary);

  await pool.end();
}

main().catch(async (e) => {
  console.error('Seeding failed:', e);
  await pool.end();
  process.exitCode = 1;
});
