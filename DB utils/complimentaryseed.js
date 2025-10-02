/*
  complimentaryseed.js
  - Seeds a comprehensive set of complimentary items into the database
  - Creates/ensures:
    • Inventory category "Complimentary Items"
    • GlobalUnits for bowl, portion, pcs, cup (created if missing)
    • InventoryItems for all complimentary sides (idempotent)
    • ComplimentaryItemTemplates for BusinessType = 'Restaurant' (or first type)
    • BusinessComplimentaryItems default mappings to common main items if present

  Safe to run multiple times. Requires DB schema from DBfinal.js.
*/

require('dotenv').config();
const { pool, testConnection } = require('./config/database');

// ---- Helpers ----
async function getBusinessId() {
  const envId = process.env.BUSINESS_ID && Number(process.env.BUSINESS_ID);
  if (envId && Number.isFinite(envId)) return envId;
  const res = await pool.query('SELECT business_id FROM Businesses ORDER BY business_id LIMIT 1');
  if (!res.rows.length) throw new Error('No Businesses found. Please seed core data first.');
  return res.rows[0].business_id;
}

async function getBusinessTypeId() {
  // Prefer 'Restaurant', else first available
  const pref = await pool.query(`SELECT type_id FROM BusinessTypes WHERE type_name = 'Restaurant' LIMIT 1`);
  if (pref.rows.length) return pref.rows[0].type_id;
  const any = await pool.query(`SELECT type_id FROM BusinessTypes ORDER BY type_id LIMIT 1`);
  if (!any.rows.length) throw new Error('No BusinessTypes found. Please seed business core first.');
  return any.rows[0].type_id;
}

async function ensureCategory(businessId, name) {
  const ins = await pool.query(
    `INSERT INTO InventoryCategories (business_id, name, is_active)
     VALUES ($1,$2,true)
     ON CONFLICT (business_id, name) DO UPDATE SET is_active = true
     RETURNING category_id`,
    [businessId, name]
  );
  return ins.rows[0].category_id;
}

function titleCase(str) {
  return String(str).replace(/\b\w/g, (c) => c.toUpperCase());
}

async function ensureUnitBySymbol(symbol) {
  // Find by symbol first
  const found = await pool.query('SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $1 LIMIT 1', [symbol]);
  if (found.rows.length) return found.rows[0].unit_id;

  // Create sensible defaults by symbol
  const meta = {
    bowl: { name: 'Bowl', type: 'Prepared Dish' },
    portion: { name: 'Portion', type: 'Prepared Dish' },
  pcs: { name: 'Piece', type: 'Count' },
  cup: { name: 'Cup', type: 'Volume' },
  tsp: { name: 'Teaspoon', type: 'Custom' },
  tbsp: { name: 'Tablespoon', type: 'Custom' },
  g: { name: 'Gram', type: 'Weight' },
  kg: { name: 'Kilogram', type: 'Weight' },
  ml: { name: 'Milliliter', type: 'Volume' },
  L: { name: 'Liter', type: 'Volume' }
  }[symbol];

  if (!meta) {
    // Fallback: treat unknown as Portion
    const fb = await ensureUnitBySymbol('portion');
    return fb;
  }

  // Create by unit_name upsert to satisfy unique(unit_name)
  const created = await pool.query(
    `INSERT INTO GlobalUnits (unit_name, unit_symbol, unit_type, is_system_defined)
     VALUES ($1,$2,$3,true)
     ON CONFLICT (unit_name) DO UPDATE SET unit_symbol = EXCLUDED.unit_symbol, unit_type = EXCLUDED.unit_type
     RETURNING unit_id`,
    [meta.name, symbol, meta.type]
  );
  return created.rows[0].unit_id;
}

async function ensureInventoryItem(businessId, name, categoryName, unitSymbol) {
  const unitId = await ensureUnitBySymbol(unitSymbol);
  const categoryId = await ensureCategory(businessId, categoryName);
  const res = await pool.query(
    `INSERT INTO InventoryItems (business_id, name, category_id, standard_unit_id, is_active)
     VALUES ($1,$2,$3,$4,true)
     ON CONFLICT (business_id, name) DO UPDATE SET
       category_id = COALESCE(InventoryItems.category_id, EXCLUDED.category_id),
       standard_unit_id = EXCLUDED.standard_unit_id,
       is_active = true
     RETURNING item_id`,
    [businessId, name, categoryId, unitId]
  );
  return res.rows[0].item_id;
}

async function ensureMenuCategory(businessId, name) {
  const res = await pool.query(
    `INSERT INTO MenuCategories (business_id, name, is_active)
     VALUES ($1,$2,true)
     ON CONFLICT (business_id, name) DO NOTHING
     RETURNING category_id`,
    [businessId, name]
  );
  if (res.rows[0]) return res.rows[0].category_id;
  const q = await pool.query(`SELECT category_id FROM MenuCategories WHERE business_id=$1 AND name=$2`, [businessId, name]);
  return q.rows[0]?.category_id;
}

async function ensureMenuItem(businessId, name, categoryId, price, servingsPerBatch, servingUnitSymbol, imageUrl) {
  const unitId = await ensureUnitBySymbol(servingUnitSymbol);
  const res = await pool.query(
    `INSERT INTO MenuItems (business_id, name, category_id, price, servings_per_batch, serving_unit_id, image_url, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,true)
     ON CONFLICT (business_id, name) DO UPDATE SET
       category_id = EXCLUDED.category_id,
       price = EXCLUDED.price,
       servings_per_batch = EXCLUDED.servings_per_batch,
       serving_unit_id = EXCLUDED.serving_unit_id,
       image_url = EXCLUDED.image_url,
       is_active = true
     RETURNING menu_item_id`,
    [businessId, name, categoryId, price, servingsPerBatch, unitId, imageUrl || null]
  );
  return res.rows[0].menu_item_id;
}

async function ensureRecipe(recipeId, name) {
  await pool.query(
    `INSERT INTO Recipes (recipe_id, instructions, estimated_cost, prep_time_minutes, cook_time_minutes)
     VALUES ($1,$2,$3,10,15)
     ON CONFLICT (recipe_id) DO UPDATE SET instructions = EXCLUDED.instructions, estimated_cost = EXCLUDED.estimated_cost`,
    [recipeId, `Basic preparation steps for ${name}`, 0]
  );
}

async function upsertRecipeIngredient(recipeId, invItemId, qty, unitSymbol, notes) {
  const unitId = await ensureUnitBySymbol(unitSymbol);
  await pool.query(
    `INSERT INTO RecipeIngredients (recipe_id, item_id, quantity, unit_id, notes)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (recipe_id, item_id) DO UPDATE SET quantity = EXCLUDED.quantity, unit_id = EXCLUDED.unit_id, notes = EXCLUDED.notes`,
    [recipeId, invItemId, qty, unitId, notes || null]
  );
}

async function upsertInventoryItem(businessId, categoryId, name, unitSymbol) {
  const unitId = await ensureUnitBySymbol(unitSymbol);
  const res = await pool.query(
    `INSERT INTO InventoryItems (business_id, name, category_id, standard_unit_id, is_active)
     VALUES ($1,$2,$3,$4,true)
     ON CONFLICT (business_id, name) DO UPDATE SET
       category_id = COALESCE(InventoryItems.category_id, EXCLUDED.category_id),
       standard_unit_id = EXCLUDED.standard_unit_id,
       is_active = true
     RETURNING item_id`,
    [businessId, name, categoryId, unitId]
  );
  return res.rows[0].item_id;
}

async function upsertTemplate(businessTypeId, itemName, uom) {
  const res = await pool.query(
    `INSERT INTO ComplimentaryItemTemplates (business_type_id, item_name, unit_of_measurement)
     VALUES ($1,$2,$3)
     ON CONFLICT (business_type_id, item_name) DO UPDATE SET unit_of_measurement = EXCLUDED.unit_of_measurement
     RETURNING template_id`,
    [businessTypeId, itemName, uom]
  );
  return res.rows[0].template_id;
}

async function upsertBusinessMapping(businessId, mainItemId, compItemId, qty, uom) {
  await pool.query(
    `INSERT INTO BusinessComplimentaryItems (
       business_id, main_dish_item_id, complimentary_item_id, standard_quantity, unit_of_measurement
     ) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (business_id, main_dish_item_id, complimentary_item_id) DO UPDATE SET
       standard_quantity = EXCLUDED.standard_quantity,
       unit_of_measurement = EXCLUDED.unit_of_measurement`,
    [businessId, mainItemId, compItemId, qty, uom]
  );
}

// ---- Data set: complimentary items ----
// Unit symbols: bowl, portion, pcs, cup
const COMPLIMENTARY_ITEMS = [
  // South Indian staples
  { name: 'Sambar', uom: 'bowl' },
  { name: 'Rasam', uom: 'bowl' },
  { name: 'Coconut Chutney', uom: 'bowl' },
  { name: 'Tomato Chutney', uom: 'bowl' },
  { name: 'Groundnut Chutney', uom: 'bowl' },
  { name: 'Mint Chutney', uom: 'bowl' },
  { name: 'Tamarind Chutney', uom: 'bowl' },
  { name: 'Coriander Chutney', uom: 'bowl' },
  { name: 'Garlic Chutney', uom: 'bowl' },
  { name: 'Karam Podi', uom: 'portion' },

  // Raitas and curd
  { name: 'Plain Curd', uom: 'bowl' },
  { name: 'Cucumber Raita', uom: 'bowl' },
  { name: 'Onion Raita', uom: 'bowl' },
  { name: 'Boondi Raita', uom: 'bowl' },

  // Pickles
  { name: 'Mango Pickle', uom: 'portion' },
  { name: 'Lemon Pickle', uom: 'portion' },
  { name: 'Mixed Pickle', uom: 'portion' },
  { name: 'Garlic Pickle', uom: 'portion' },

  // Salads and small sides
  { name: 'Kachumber Salad', uom: 'portion' },
  { name: 'Onion Rings', uom: 'portion' },
  { name: 'Lemon Wedges', uom: 'portion' },
  { name: 'Green Chilies', uom: 'portion' },

  // Dry sides
  { name: 'Papad', uom: 'pcs' }
];

async function main() {
  console.log('🎁 Seeding complimentary items...');
  await testConnection();

  const businessId = await getBusinessId();
  const businessTypeId = await getBusinessTypeId();
  console.log(`🏢 Business ID: ${businessId} | 🏷️ Business Type ID: ${businessTypeId}`);

  const categoryId = await ensureCategory(businessId, 'Complimentary Items');
  console.log(`📂 Using category 'Complimentary Items' (ID: ${categoryId})`);

  // Ensure units exist up front
  const unitSymbols = Array.from(new Set(COMPLIMENTARY_ITEMS.map(i => i.uom)));
  const unitIdBySymbol = {};
  for (const sym of unitSymbols) unitIdBySymbol[sym] = await ensureUnitBySymbol(sym);
  console.log('📏 Units ensured:', Object.keys(unitIdBySymbol).join(', '));

  // Upsert inventory items and templates
  const itemIdByName = {};
  let createdItems = 0, updatedItems = 0, templateCount = 0;
  for (const item of COMPLIMENTARY_ITEMS) {
    // Check existence before upsert to track created/updated
    const before = await pool.query(
      'SELECT item_id FROM InventoryItems WHERE business_id = $1 AND name = $2',
      [businessId, item.name]
    );
    const itemId = await upsertInventoryItem(businessId, categoryId, item.name, item.uom);
    if (before.rows.length) updatedItems++; else createdItems++;
    itemIdByName[item.name] = itemId;

    await upsertTemplate(businessTypeId, item.name, item.uom);
    templateCount++;
  }

  console.log(`✅ InventoryItems upserted. Created: ${createdItems}, Updated: ${updatedItems}`);
  console.log(`✅ ComplimentaryItemTemplates upserted: ${templateCount}`);

  // Optional default mappings to common mains if present
  // We use existing inventory items as proxies for mains (schema expects InventoryItems)
  const mainsToCheck = ['Basmati Rice', 'Paneer'];
  const mainRows = await pool.query(
    `SELECT item_id, name FROM InventoryItems WHERE business_id = $1 AND name = ANY($2)`,
    [businessId, mainsToCheck]
  );
  const mainIdByName = {};
  for (const r of mainRows.rows) mainIdByName[r.name] = r.item_id;

  let mappings = 0;
  const tryMap = async (mainName, compName, qty, uom) => {
    const mainId = mainIdByName[mainName];
    const compId = itemIdByName[compName];
    if (!mainId || !compId) return;
    await upsertBusinessMapping(businessId, mainId, compId, qty, uom);
    mappings++;
  };

  // Rice plate typical sides
  await tryMap('Basmati Rice', 'Sambar', 1.0, 'bowl');
  await tryMap('Basmati Rice', 'Rasam', 0.5, 'bowl');
  await tryMap('Basmati Rice', 'Karam Podi', 1.0, 'portion');

  // Paneer/gravies typical sides
  await tryMap('Paneer', 'Onion Rings', 1.0, 'portion');
  await tryMap('Paneer', 'Lemon Wedges', 1.0, 'portion');
  await tryMap('Paneer', 'Mint Chutney', 0.5, 'bowl');
  await tryMap('Paneer', 'Tamarind Chutney', 0.5, 'bowl');

  console.log(`✅ BusinessComplimentaryItems mappings upserted: ${mappings}`);

  // ---- Ingredient mapping via MenuItems + Recipes ----
  console.log('🧩 Creating menu + recipe ingredient mappings for complimentary items...');
  const compMenuCategoryId = await ensureMenuCategory(businessId, 'Complimentary');
  const servingSymbolFor = (uom) => (uom === 'bowl' || uom === 'portion' || uom === 'pcs' || uom === 'cup') ? uom : 'portion';

  // Ensure common base ingredients exist
  const invId = async (name, cat, unit) => ensureInventoryItem(businessId, name, cat, unit);

  const base = {
    Tomatoes: await invId('Tomatoes', 'Vegetables', 'kg'),
    Onions: await invId('Onions', 'Vegetables', 'kg'),
    'Green Chilies': await invId('Green Chilies', 'Vegetables', 'kg'),
    Ginger: await invId('Ginger', 'Vegetables', 'kg'),
    Garlic: await invId('Garlic', 'Vegetables', 'kg'),
    'Curry Leaves': await invId('Curry Leaves', 'Vegetables', 'kg'),
    'Coriander Leaves': await invId('Coriander Leaves', 'Vegetables', 'kg'),
    'Mint Leaves': await invId('Mint Leaves', 'Vegetables', 'kg'),
    Lemon: await invId('Lemon', 'Vegetables', 'kg'),
    Cucumber: await invId('Cucumber', 'Vegetables', 'kg'),
    Boondi: await invId('Boondi', 'Grains & Cereals', 'kg'),
    'Roasted Chana Dal': await invId('Roasted Chana Dal', 'Grains & Cereals', 'kg'),
    Peanuts: await invId('Peanuts', 'Grains & Cereals', 'kg'),
    'Grated Coconut': await invId('Grated Coconut', 'Vegetables', 'kg'),
    'Dry Coconut Powder': await invId('Dry Coconut Powder', 'Grains & Cereals', 'kg'),
    Tamarind: await invId('Tamarind', 'Spices & Seasonings', 'kg'),
    Jaggery: await invId('Jaggery', 'Spices & Seasonings', 'kg'),
    'Sambar Powder': await invId('Sambar Powder', 'Spices & Seasonings', 'kg'),
    'Rasam Powder': await invId('Rasam Powder', 'Spices & Seasonings', 'kg'),
    'Cumin Powder': await invId('Cumin Powder', 'Spices & Seasonings', 'kg'),
    'Red Chili Powder': await invId('Red Chili Powder', 'Spices & Seasonings', 'g'),
    Salt: await invId('Salt', 'Spices & Seasonings', 'kg'),
    'Mustard Seeds': await invId('Mustard Seeds', 'Spices & Seasonings', 'kg'),
    'Cooking Oil': await invId('Cooking Oil', 'Beverages', 'L'),
    Water: await invId('Water', 'Beverages', 'L'),
    'Fresh Milk': await invId('Fresh Milk', 'Dairy Products', 'L'),
    Curd: await invId('Curd', 'Dairy Products', 'kg'),
    Papad: await invId('Papad', 'Grains & Cereals', 'pcs')
  };

  // Define recipes mapping: name -> [{ing, qty, unit}]
  const recipes = new Map([
    ['Sambar', [
      { ing: 'Sambar Powder', qty: 5, unit: 'g' },
      { ing: 'Tamarind', qty: 10, unit: 'g' },
      { ing: 'Tomatoes', qty: 30, unit: 'g' },
      { ing: 'Onions', qty: 20, unit: 'g' },
      { ing: 'Mustard Seeds', qty: 2, unit: 'g' },
      { ing: 'Curry Leaves', qty: 2, unit: 'g' },
      { ing: 'Cooking Oil', qty: 5, unit: 'ml' },
      { ing: 'Salt', qty: 5, unit: 'g' },
      { ing: 'Water', qty: 150, unit: 'ml' }
    ]],
    ['Rasam', [
      { ing: 'Rasam Powder', qty: 4, unit: 'g' },
      { ing: 'Tamarind', qty: 8, unit: 'g' },
      { ing: 'Tomatoes', qty: 20, unit: 'g' },
      { ing: 'Garlic', qty: 5, unit: 'g' },
      { ing: 'Mustard Seeds', qty: 2, unit: 'g' },
      { ing: 'Curry Leaves', qty: 2, unit: 'g' },
      { ing: 'Cooking Oil', qty: 4, unit: 'ml' },
      { ing: 'Salt', qty: 5, unit: 'g' },
      { ing: 'Water', qty: 120, unit: 'ml' }
    ]],
    ['Coconut Chutney', [
      { ing: 'Grated Coconut', qty: 50, unit: 'g' },
      { ing: 'Roasted Chana Dal', qty: 20, unit: 'g' },
      { ing: 'Green Chilies', qty: 3, unit: 'g' },
      { ing: 'Ginger', qty: 3, unit: 'g' },
      { ing: 'Curd', qty: 20, unit: 'ml' },
      { ing: 'Salt', qty: 4, unit: 'g' },
      { ing: 'Cooking Oil', qty: 3, unit: 'ml' },
      { ing: 'Mustard Seeds', qty: 2, unit: 'g' },
      { ing: 'Curry Leaves', qty: 2, unit: 'g' },
      { ing: 'Water', qty: 20, unit: 'ml' }
    ]],
    ['Tomato Chutney', [
      { ing: 'Tomatoes', qty: 60, unit: 'g' },
      { ing: 'Onions', qty: 20, unit: 'g' },
      { ing: 'Red Chili Powder', qty: 3, unit: 'g' },
      { ing: 'Tamarind', qty: 5, unit: 'g' },
      { ing: 'Cooking Oil', qty: 6, unit: 'ml' },
      { ing: 'Mustard Seeds', qty: 2, unit: 'g' },
      { ing: 'Curry Leaves', qty: 2, unit: 'g' },
      { ing: 'Salt', qty: 4, unit: 'g' }
    ]],
    ['Groundnut Chutney', [
      { ing: 'Peanuts', qty: 40, unit: 'g' },
      { ing: 'Garlic', qty: 5, unit: 'g' },
      { ing: 'Red Chili Powder', qty: 3, unit: 'g' },
      { ing: 'Tamarind', qty: 5, unit: 'g' },
      { ing: 'Cooking Oil', qty: 5, unit: 'ml' },
      { ing: 'Curry Leaves', qty: 2, unit: 'g' },
      { ing: 'Mustard Seeds', qty: 2, unit: 'g' },
      { ing: 'Salt', qty: 4, unit: 'g' },
      { ing: 'Water', qty: 20, unit: 'ml' }
    ]],
    ['Mint Chutney', [
      { ing: 'Mint Leaves', qty: 20, unit: 'g' },
      { ing: 'Coriander Leaves', qty: 20, unit: 'g' },
      { ing: 'Green Chilies', qty: 3, unit: 'g' },
      { ing: 'Curd', qty: 30, unit: 'ml' },
      { ing: 'Lemon', qty: 10, unit: 'g' },
      { ing: 'Salt', qty: 3, unit: 'g' },
      { ing: 'Water', qty: 10, unit: 'ml' }
    ]],
    ['Tamarind Chutney', [
      { ing: 'Tamarind', qty: 20, unit: 'g' },
      { ing: 'Jaggery', qty: 20, unit: 'g' },
      { ing: 'Cumin Powder', qty: 2, unit: 'g' },
      { ing: 'Red Chili Powder', qty: 2, unit: 'g' },
      { ing: 'Salt', qty: 3, unit: 'g' },
      { ing: 'Water', qty: 50, unit: 'ml' }
    ]],
    ['Coriander Chutney', [
      { ing: 'Coriander Leaves', qty: 40, unit: 'g' },
      { ing: 'Green Chilies', qty: 3, unit: 'g' },
      { ing: 'Lemon', qty: 10, unit: 'g' },
      { ing: 'Salt', qty: 3, unit: 'g' },
      { ing: 'Water', qty: 10, unit: 'ml' }
    ]],
    ['Garlic Chutney', [
      { ing: 'Garlic', qty: 20, unit: 'g' },
      { ing: 'Red Chili Powder', qty: 6, unit: 'g' },
      { ing: 'Cooking Oil', qty: 6, unit: 'ml' },
      { ing: 'Salt', qty: 3, unit: 'g' }
    ]],
    ['Karam Podi', [
      { ing: 'Red Chili Powder', qty: 10, unit: 'g' },
      { ing: 'Roasted Chana Dal', qty: 10, unit: 'g' },
      { ing: 'Garlic', qty: 5, unit: 'g' },
      { ing: 'Dry Coconut Powder', qty: 5, unit: 'g' },
      { ing: 'Salt', qty: 3, unit: 'g' }
    ]],
    ['Plain Curd', [
      { ing: 'Fresh Milk', qty: 150, unit: 'ml' }
    ]],
    ['Cucumber Raita', [
      { ing: 'Curd', qty: 120, unit: 'ml' },
      { ing: 'Cucumber', qty: 50, unit: 'g' },
      { ing: 'Cumin Powder', qty: 2, unit: 'g' },
      { ing: 'Salt', qty: 3, unit: 'g' }
    ]],
    ['Onion Raita', [
      { ing: 'Curd', qty: 120, unit: 'ml' },
      { ing: 'Onions', qty: 40, unit: 'g' },
      { ing: 'Cumin Powder', qty: 2, unit: 'g' },
      { ing: 'Salt', qty: 3, unit: 'g' }
    ]],
    ['Boondi Raita', [
      { ing: 'Curd', qty: 120, unit: 'ml' },
      { ing: 'Boondi', qty: 40, unit: 'g' },
      { ing: 'Cumin Powder', qty: 2, unit: 'g' },
      { ing: 'Salt', qty: 3, unit: 'g' }
    ]],
    ['Mango Pickle', [
      { ing: 'Cooking Oil', qty: 4, unit: 'ml' },
      { ing: 'Red Chili Powder', qty: 3, unit: 'g' },
      { ing: 'Mustard Seeds', qty: 2, unit: 'g' },
      { ing: 'Salt', qty: 3, unit: 'g' }
    ]],
    ['Lemon Pickle', [
      { ing: 'Cooking Oil', qty: 4, unit: 'ml' },
      { ing: 'Red Chili Powder', qty: 3, unit: 'g' },
      { ing: 'Mustard Seeds', qty: 2, unit: 'g' },
      { ing: 'Salt', qty: 3, unit: 'g' }
    ]],
    ['Mixed Pickle', [
      { ing: 'Cooking Oil', qty: 4, unit: 'ml' },
      { ing: 'Red Chili Powder', qty: 3, unit: 'g' },
      { ing: 'Mustard Seeds', qty: 2, unit: 'g' },
      { ing: 'Salt', qty: 3, unit: 'g' }
    ]],
    ['Garlic Pickle', [
      { ing: 'Garlic', qty: 10, unit: 'g' },
      { ing: 'Cooking Oil', qty: 4, unit: 'ml' },
      { ing: 'Red Chili Powder', qty: 3, unit: 'g' },
      { ing: 'Mustard Seeds', qty: 2, unit: 'g' },
      { ing: 'Salt', qty: 3, unit: 'g' }
    ]],
    ['Kachumber Salad', [
      { ing: 'Tomatoes', qty: 40, unit: 'g' },
      { ing: 'Onions', qty: 40, unit: 'g' },
      { ing: 'Cucumber', qty: 40, unit: 'g' },
      { ing: 'Lemon', qty: 10, unit: 'g' },
      { ing: 'Salt', qty: 3, unit: 'g' }
    ]],
    ['Onion Rings', [
      { ing: 'Onions', qty: 50, unit: 'g' }
    ]],
    ['Lemon Wedges', [
      { ing: 'Lemon', qty: 30, unit: 'g' }
    ]],
    ['Green Chilies', [
      { ing: 'Green Chilies', qty: 5, unit: 'g' }
    ]],
    ['Papad', [
      { ing: 'Papad', qty: 1, unit: 'pcs' }
    ]]
  ]);

  let recipesCreated = 0, ingredientsUpserted = 0;
  for (const item of COMPLIMENTARY_ITEMS) {
    const servingUnitSymbol = servingSymbolFor(item.uom);
    const menuItemId = await ensureMenuItem(
      businessId,
      item.name,
      compMenuCategoryId,
      0,
      1,
      servingUnitSymbol,
      `/images/${item.name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'')}.jpg`
    );
    await ensureRecipe(menuItemId, item.name);
    recipesCreated++;

    const ingList = recipes.get(item.name) || [];
    for (const ing of ingList) {
      const invIdForIng = base[ing.ing];
      if (!invIdForIng) continue;
      await upsertRecipeIngredient(menuItemId, invIdForIng, ing.qty, ing.unit, `Used in ${item.name}`);
      ingredientsUpserted++;
    }
  }

  console.log(`✅ MenuItems/Recipes created: ${recipesCreated} | RecipeIngredients upserted: ${ingredientsUpserted}`);

  console.log('🎉 Complimentary seeding complete.');
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => { console.error('❌ Complimentary seeding failed:', err.message); process.exit(1); });
}

module.exports = { main };
