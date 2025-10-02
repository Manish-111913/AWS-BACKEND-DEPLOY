/*
  Seed InventoryItems from menu item ingredients
  - Reads ingredients from backend/data/menuItems.js
  - Ensures a target business_id (from env BUSINESS_ID, or first business)
  - Ensures a category 'Auto Ingredients' exists (optional grouping)
  - Maps common units to GlobalUnits and upserts InventoryItems
*/

const { pool, testConnection } = require('./config/database');
const { menuItems } = require('./data/menuItems');

// Map incoming unit strings to GlobalUnits.unit_symbol values
const normalizeUnitSymbol = (uRaw) => {
  if (!uRaw) return 'kg';
  const u = String(uRaw).trim().toLowerCase();
  switch (u) {
    case 'kg':
    case 'kilogram':
      return 'kg';
    case 'g':
    case 'gram':
    case 'grams':
      return 'g';
    case 'l':
    case 'lt':
    case 'liter':
    case 'litre':
      return 'L';
    case 'ml':
    case 'milliliter':
    case 'millilitre':
      return 'ml';
    case 'pc':
    case 'pcs':
    case 'piece':
    case 'pieces':
      return 'pcs';
    case 'cup':
      return 'cup';
    case 'tbsp':
    case 'tablespoon':
      return 'tbsp';
    case 'tsp':
    case 'teaspoon':
      return 'tsp';
    default:
      // Fallback based on common hints in the string
      if (u.includes('ml')) return 'ml';
      if (u.includes('l')) return 'L';
      if (u.includes('g')) return 'g';
      return 'kg';
  }
};

async function getBusinessId() {
  // Try env, else pick the first business
  const envId = process.env.BUSINESS_ID && Number(process.env.BUSINESS_ID);
  if (envId && Number.isFinite(envId)) return envId;
  const res = await pool.query('SELECT business_id FROM Businesses ORDER BY business_id LIMIT 1');
  if (!res.rows.length) throw new Error('No Businesses found. Seed base data first.');
  return res.rows[0].business_id;
}

async function getUnitIdBySymbol(symbol) {
  const res = await pool.query('SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $1 LIMIT 1', [symbol]);
  if (res.rows.length) return res.rows[0].unit_id;
  // Fallback to any available unit to avoid failure
  const any = await pool.query('SELECT unit_id FROM GlobalUnits ORDER BY unit_id LIMIT 1');
  if (!any.rows.length) throw new Error('GlobalUnits is empty. Seed units first.');
  return any.rows[0].unit_id;
}

async function getOrCreateCategory(businessId, name) {
  // Optional grouping for auto-created ingredients
  const check = await pool.query(
    'SELECT category_id FROM InventoryCategories WHERE business_id = $1 AND name = $2 LIMIT 1',
    [businessId, name]
  );
  if (check.rows.length) return check.rows[0].category_id;
  const ins = await pool.query(
    'INSERT INTO InventoryCategories (business_id, name, is_active) VALUES ($1, $2, true) RETURNING category_id',
    [businessId, name]
  );
  return ins.rows[0].category_id;
}

async function upsertInventoryItem({ businessId, name, unitId, categoryId }) {
  const res = await pool.query(
    `INSERT INTO InventoryItems (business_id, name, category_id, standard_unit_id, is_active)
     VALUES ($1, $2, $3, $4, true)
     ON CONFLICT (business_id, name) DO UPDATE SET
       standard_unit_id = EXCLUDED.standard_unit_id,
       is_active = true
     RETURNING item_id`,
    [businessId, name, categoryId || null, unitId]
  );
  return res.rows[0].item_id;
}

async function main() {
  console.log('🌱 Seeding InventoryItems from menu ingredients...');
  await testConnection();

  const businessId = await getBusinessId();
  console.log('🏢 Using business_id =', businessId);

  // Create/resolve a default category for auto ingredients
  let categoryId = null;
  try {
    categoryId = await getOrCreateCategory(businessId, 'Auto Ingredients');
    console.log('📂 Category ensured: Auto Ingredients (id:', categoryId + ')');
  } catch (e) {
    console.log('ℹ️ Could not ensure category, proceeding without one:', e.message);
  }

  // Collect unique ingredients and their most common unit
  const ingredientUnitMap = new Map(); // name -> unit_symbol

  for (const mi of menuItems) {
    const list = Array.isArray(mi.ingredients) ? mi.ingredients : [];
    for (const ing of list) {
      if (!ing || !ing.name) continue;
      const name = String(ing.name).trim();
      const unitSym = normalizeUnitSymbol(ing.unit);

      // Prefer first seen mapping; do not overwrite to avoid oscillation
      if (!ingredientUnitMap.has(name)) {
        ingredientUnitMap.set(name, unitSym);
      }
    }
  }

  console.log(`🧾 Found ${ingredientUnitMap.size} unique ingredients in menu dataset`);

  let created = 0, updated = 0;
  for (const [name, unitSym] of ingredientUnitMap.entries()) {
    const unitId = await getUnitIdBySymbol(unitSym);
    const before = await pool.query(
      'SELECT item_id, standard_unit_id FROM InventoryItems WHERE business_id = $1 AND name = $2',
      [businessId, name]
    );
    const itemId = await upsertInventoryItem({ businessId, name, unitId, categoryId });
    if (before.rows.length === 0) created++; else updated++;
    console.log(`  ✅ ${before.rows.length ? 'Upserted' : 'Created'}: ${name} (unit=${unitSym}, id=${itemId})`);
  }

  console.log(`\n🎉 Done. Created: ${created}, Updated: ${updated}, Total processed: ${ingredientUnitMap.size}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('❌ Seeding failed:', err.message);
      process.exit(1);
    });
}

module.exports = { main };
