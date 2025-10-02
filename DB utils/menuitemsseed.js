/*
  menuitemsseed.js (ingredients-only)
  - Seeds ONLY the inventory items for the 10 recipes in the main seed script.
  - Upserts the 8 ingredients used across those recipes:
    Tomatoes, Onions, Turmeric Powder, Red Chili Powder, Fresh Milk,
    Paneer, Basmati Rice, Cooking Oil.
*/

const { pool, testConnection } = require('./config/database');

async function getBusinessId() {
  const envId = process.env.BUSINESS_ID && Number(process.env.BUSINESS_ID);
  if (envId && Number.isFinite(envId)) return envId;
  const res = await pool.query('SELECT business_id FROM Businesses ORDER BY business_id LIMIT 1');
  if (!res.rows.length) throw new Error('No Businesses found. Seed base data first.');
  return res.rows[0].business_id;
}

async function getUnitIdBySymbol(symbol) {
  const res = await pool.query('SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $1 LIMIT 1', [symbol]);
  if (res.rows.length) return res.rows[0].unit_id;
  const any = await pool.query('SELECT unit_id FROM GlobalUnits ORDER BY unit_id LIMIT 1');
  if (!any.rows.length) throw new Error('GlobalUnits is empty. Seed units first.');
  return any.rows[0].unit_id;
}

async function upsertInventoryItem({ businessId, name, unitSymbol }) {
  const unitId = await getUnitIdBySymbol(unitSymbol);
  const before = await pool.query('SELECT item_id FROM InventoryItems WHERE business_id = $1 AND name = $2', [businessId, name]);
  const res = await pool.query(
    `INSERT INTO InventoryItems (business_id, name, standard_unit_id, is_active)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (business_id, name) DO UPDATE SET standard_unit_id = EXCLUDED.standard_unit_id, is_active = true
     RETURNING item_id`,
    [businessId, name, unitId]
  );
  return { id: res.rows[0].item_id, created: before.rows.length === 0 };
}

async function main() {
  console.log('🌱 Seeding only 10-recipe ingredients into InventoryItems...');
  await testConnection();
  const businessId = await getBusinessId();
  console.log('🏢 Using business_id =', businessId);

  // Ingredients from the 10 recipes defined in seeddata copy.js (createTestMenuItems)
  const ingredients = [
    { name: 'Tomatoes', unitSymbol: 'kg' },
    { name: 'Onions', unitSymbol: 'kg' },
    { name: 'Turmeric Powder', unitSymbol: 'g' },
    { name: 'Red Chili Powder', unitSymbol: 'g' },
    { name: 'Fresh Milk', unitSymbol: 'L' },
    { name: 'Paneer', unitSymbol: 'kg' },
    { name: 'Basmati Rice', unitSymbol: 'kg' },
    { name: 'Cooking Oil', unitSymbol: 'L' }
  ];

  let created = 0, updated = 0;
  for (const ing of ingredients) {
    const { id, created: isNew } = await upsertInventoryItem({ businessId, name: ing.name, unitSymbol: ing.unitSymbol });
    if (isNew) created++; else updated++;
    console.log(`  ✅ ${isNew ? 'Created' : 'Upserted'}: ${ing.name} (unit=${ing.unitSymbol}, id=${id})`);
  }

  console.log(`\n🎉 Done. Created: ${created}, Updated: ${updated}, Total processed: ${ingredients.length}`);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((err) => { console.error('❌ Error:', err.message); process.exit(1); });
}

module.exports = { main };
