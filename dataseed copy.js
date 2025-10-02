// dataseed.js - Minimal, idempotent seed aligned to DBfinal schema
// Goal: Seed core lookups, one business, vendors, categories, units/conversions,
// inventory items for ALL ingredients used by the menu, menu items + recipes,
// wastage reasons (same list), and stock-in that covers every menu ingredient.

require('dotenv').config();
const { pool, testConnection } = require('./config/database');

class DataSeed {
  constructor() {
    this.pool = pool;
    this.ctx = {};
  }

  async run() {
    try {
      console.log('🚀 Starting DB seed (dataseed.js)\n');
      await this.ensureConnection();

      await this.createGlobalUnits();
      await this.createBusinessCore();
      await this.createUsersAndRoles();
      await this.createCategories();
      await this.createVendors();
      await this.createUnitConversions();
      await this.createInventoryItems();
      await this.createMenu();
      await this.createWastageReasons();
      await this.createStockInForAllMenuIngredients();

      console.log('\n🎉 Seed complete.');
    } catch (err) {
      console.error('❌ Seed failed:', err.message);
      console.error(err.stack);
      process.exit(1);
    } finally {
      console.log('🔄 Seed process finished. Connection remains open (managed by pool).');
    }
  }

  async ensureConnection() {
    console.log('🔗 Testing DB connection...');
    await testConnection();
    console.log('✅ DB connection OK');
  }

  // ---------- Global Units ----------
  async createGlobalUnits() {
    console.log('🏷️ Creating global units...');
    const units = [
      { name: 'Kilogram', symbol: 'kg', type: 'Weight' },
      { name: 'Gram', symbol: 'g', type: 'Weight' },
      { name: 'Liter', symbol: 'L', type: 'Volume' },
      { name: 'Milliliter', symbol: 'ml', type: 'Volume' },
      { name: 'Piece', symbol: 'pcs', type: 'Count' },
      { name: 'Serving', symbol: 'serving', type: 'Prepared Dish' },
      { name: 'Portion', symbol: 'portion', type: 'Prepared Dish' },
      { name: 'Plate', symbol: 'plate', type: 'Prepared Dish' },
      { name: 'Bowl', symbol: 'bowl', type: 'Prepared Dish' },
      { name: 'Cup', symbol: 'cup', type: 'Volume' }
    ];

    this.unitsByName = {};
    for (const u of units) {
      const res = await this.pool.query(
        `INSERT INTO GlobalUnits (unit_name, unit_symbol, unit_type, is_system_defined)
         VALUES ($1,$2,$3,true)
         ON CONFLICT (unit_name) DO UPDATE SET unit_symbol = EXCLUDED.unit_symbol, unit_type = EXCLUDED.unit_type
         RETURNING unit_id, unit_name`,
        [u.name, u.symbol, u.type]
      );
      const row = res.rows[0];
      this.unitsByName[row.unit_name] = row.unit_id;
    }
    console.log(`  ✅ Units ready: ${Object.keys(this.unitsByName).length}`);
  }

  unitId(name) { return this.unitsByName[name]; }

  // ---------- Business core ----------
  async createBusinessCore() {
    console.log('🏢 Creating business core...');

    // BusinessTypes
    const bt = await this.pool.query(
      `INSERT INTO BusinessTypes (type_name, description)
       VALUES ('Restaurant','Full-service restaurant')
       ON CONFLICT (type_name) DO UPDATE SET description = EXCLUDED.description
       RETURNING type_id`
    );

    // BillingMachineModels
    const bm = await this.pool.query(
      `INSERT INTO BillingMachineModels (model_name, description)
       VALUES ('Advanced POS','Advanced POS with inventory integration')
       ON CONFLICT (model_name) DO UPDATE SET description = EXCLUDED.description
       RETURNING billing_model_id`
    );

    // Languages
    const lang = await this.pool.query(
      `INSERT INTO Languages (language_name, language_code, is_active)
       VALUES ('English','en',true)
       ON CONFLICT (language_name) DO UPDATE SET language_code = EXCLUDED.language_code
       RETURNING language_id`
    );

    // Business
    const biz = await this.pool.query(
      `INSERT INTO Businesses (name, business_type_id, num_workers, business_size, billing_model_id, preferred_language_id, is_onboarded)
       VALUES ('Spice Garden Restaurant', $1, 15, 'Medium', $2, $3, true)
       ON CONFLICT (name) DO UPDATE SET is_onboarded = EXCLUDED.is_onboarded
       RETURNING business_id`,
      [bt.rows[0].type_id, bm.rows[0].billing_model_id, lang.rows[0].language_id]
    );

    this.businessId = biz.rows[0].business_id;

    // Default location
    await this.pool.query(
      `INSERT INTO BusinessLocations (business_id, name, address_street, address_city, address_state, address_zip_code)
       VALUES ($1,'Main Kitchen','123 Food Street','Mumbai','Maharashtra','400001')
       ON CONFLICT (business_id, name) DO NOTHING`,
      [this.businessId]
    );

    console.log(`  ✅ Business ready (ID=${this.businessId})`);
  }

  // ---------- Users & Roles ----------
  async createUsersAndRoles() {
    console.log('👤 Creating roles and users...');

    const rOwner = await this.pool.query(
      `INSERT INTO Roles (business_id, role_name, description, is_system_default, is_active)
       VALUES ($1,'Owner','Business owner with full access',true,true)
       ON CONFLICT (business_id, role_name) DO UPDATE SET description = EXCLUDED.description
       RETURNING role_id`,
      [this.businessId]
    );

    const rManager = await this.pool.query(
      `INSERT INTO Roles (business_id, role_name, description, is_system_default, is_active)
       VALUES ($1,'Manager','Kitchen manager with inventory access',true,true)
       ON CONFLICT (business_id, role_name) DO UPDATE SET description = EXCLUDED.description
       RETURNING role_id`,
      [this.businessId]
    );

    const owner = await this.pool.query(
      `INSERT INTO Users (business_id, email, password_hash, name, phone_number, role_id, is_active)
       VALUES ($1,'owner@spicegarden.com','$2b$10$test.hash','Raj Patel','+91-9876543210',$2,true)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING user_id`,
      [this.businessId, rOwner.rows[0].role_id]
    );

    const manager = await this.pool.query(
      `INSERT INTO Users (business_id, email, password_hash, name, phone_number, role_id, is_active)
       VALUES ($1,'manager@spicegarden.com','$2b$10$test.hash','Priya Sharma','+91-9876543211',$2,true)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING user_id`,
      [this.businessId, rManager.rows[0].role_id]
    );

    this.ownerUserId = owner.rows[0].user_id;
    this.managerUserId = manager.rows[0].user_id;
    console.log('  ✅ Users ready');
  }

  // ---------- Categories ----------
  async createCategories() {
    console.log('📂 Creating inventory categories...');
    const names = [
      'Vegetables','Spices & Seasonings','Dairy Products','Grains & Cereals','Beverages','Meat & Seafood'
    ];
    this.categoryIdByName = {};
    for (const n of names) {
      const res = await this.pool.query(
        `INSERT INTO InventoryCategories (business_id, name, is_active)
         VALUES ($1,$2,true)
         ON CONFLICT (business_id, name) DO NOTHING
         RETURNING category_id, name`,
        [this.businessId, n]
      );
      if (res.rows[0]) {
        this.categoryIdByName[res.rows[0].name] = res.rows[0].category_id;
      }
    }
    // backfill any missing via SELECT
    const backfill = await this.pool.query(
      `SELECT category_id, name FROM InventoryCategories WHERE business_id=$1`,
      [this.businessId]
    );
    for (const row of backfill.rows) this.categoryIdByName[row.name] = row.category_id;
    console.log(`  ✅ Categories ready: ${Object.keys(this.categoryIdByName).length}`);
  }

  // ---------- Vendors ----------
  async createVendors() {
    console.log('🏪 Creating vendors...');
    const vendors = [
      { name: 'Fresh Veggie Suppliers', description: 'Premium fresh vegetables and herbs', phone: '+91-9876543220', email: 'orders@freshveggie.com', address: 'Wholesale Market, Mumbai', vendor_category: 'vegetables', avg: 4.5, ontime: 92.5, quality: 90.0 },
      { name: 'Spice World Distributors', description: 'Authentic spices and seasonings', phone: '+91-9876543221', email: 'sales@spiceworld.com', address: 'Spice Market, Mumbai', vendor_category: 'others', avg: 4.8, ontime: 95.0, quality: 93.0 },
      { name: 'Dairy Fresh Co.', description: 'Fresh dairy products and milk', phone: '+91-9876543222', email: 'supply@dairyfresh.com', address: 'Andheri East, Mumbai', vendor_category: 'dairy', avg: 4.3, ontime: 88.0, quality: 86.0 }
    ];
    this.vendorIdByName = {};
    for (const v of vendors) {
      const res = await this.pool.query(
        `INSERT INTO Vendors (business_id, name, description, contact_phone, contact_email, address, vendor_category, average_rating, on_time_delivery_rate, quality_score, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)
         ON CONFLICT (business_id, name) DO UPDATE SET description = EXCLUDED.description
         RETURNING vendor_id, name`,
        [this.businessId, v.name, v.description, v.phone, v.email, v.address, v.vendor_category, v.avg, v.ontime, v.quality]
      );
      const row = res.rows[0];
      this.vendorIdByName[row.name] = row.vendor_id;
    }
    console.log('  ✅ Vendors ready');
  }

  // ---------- Unit conversions ----------
  async createUnitConversions() {
    console.log('🔄 Creating unit conversions...');
    const kg = this.unitId('Kilogram');
    const g = this.unitId('Gram');
    const L = this.unitId('Liter');
    const ml = this.unitId('Milliliter');

    const convs = [
      { from: kg, to: g, factor: 1000.0, desc: 'Kilogram to Gram' },
      { from: g, to: kg, factor: 0.001, desc: 'Gram to Kilogram' },
      { from: L, to: ml, factor: 1000.0, desc: 'Liter to Milliliter' },
      { from: ml, to: L, factor: 0.001, desc: 'Milliliter to Liter' }
    ];

    for (const c of convs) {
      if (!c.from || !c.to) continue;
      await this.pool.query(
        `INSERT INTO BusinessUnitConversions (business_id, from_unit_id, to_unit_id, conversion_factor, description)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (business_id, from_unit_id, to_unit_id) DO UPDATE SET conversion_factor = EXCLUDED.conversion_factor`,
        [this.businessId, c.from, c.to, c.factor, c.desc]
      );
    }
    console.log('  ✅ Conversions ready');
  }

  // ---------- Inventory items (ALL menu ingredients) ----------
  async createInventoryItems() {
    console.log('📦 Creating inventory items (menu ingredients)...');
    const cat = (name) => this.categoryIdByName[name];
    const kg = this.unitId('Kilogram');
    const g = this.unitId('Gram');
    const L = this.unitId('Liter');

    const vendor = (name) => this.vendorIdByName[name];

    // Items reused exactly as in existing seed, covering all used by menu
    const items = [
      { name: 'Tomatoes', category: 'Vegetables', unit: kg, reorder_point: 5.0, safety: 2.0, vendor: 'Fresh Veggie Suppliers', track_expiry: true, shelf: 7 },
      { name: 'Onions', category: 'Vegetables', unit: kg, reorder_point: 10.0, safety: 5.0, vendor: 'Fresh Veggie Suppliers', track_expiry: true, shelf: 14 },
      { name: 'Turmeric Powder', category: 'Spices & Seasonings', unit: g, reorder_point: 500.0, safety: 200.0, vendor: 'Spice World Distributors', track_expiry: true, shelf: 365 },
      { name: 'Red Chili Powder', category: 'Spices & Seasonings', unit: g, reorder_point: 1000.0, safety: 500.0, vendor: 'Spice World Distributors', track_expiry: true, shelf: 365 },
      { name: 'Fresh Milk', category: 'Dairy Products', unit: L, reorder_point: 20.0, safety: 10.0, vendor: 'Dairy Fresh Co.', track_expiry: true, shelf: 3 },
      { name: 'Paneer', category: 'Dairy Products', unit: kg, reorder_point: 2.0, safety: 1.0, vendor: 'Dairy Fresh Co.', track_expiry: true, shelf: 5 },
      { name: 'Basmati Rice', category: 'Grains & Cereals', unit: kg, reorder_point: 25.0, safety: 10.0, vendor: 'Fresh Veggie Suppliers', track_expiry: false, shelf: null },
      { name: 'Cooking Oil', category: 'Beverages', unit: L, reorder_point: 10.0, safety: 5.0, vendor: 'Fresh Veggie Suppliers', track_expiry: true, shelf: 180 }
    ];

    this.itemIdByName = {};
    for (const it of items) {
      const res = await this.pool.query(
        `INSERT INTO InventoryItems (
           business_id, name, category_id, standard_unit_id, reorder_point, safety_stock,
           default_vendor_id, track_expiry, shelf_life_days, is_active
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
         ON CONFLICT (business_id, name) DO UPDATE SET
           category_id = EXCLUDED.category_id,
           standard_unit_id = EXCLUDED.standard_unit_id,
           reorder_point = EXCLUDED.reorder_point,
           safety_stock = EXCLUDED.safety_stock,
           default_vendor_id = EXCLUDED.default_vendor_id,
           track_expiry = EXCLUDED.track_expiry,
           shelf_life_days = EXCLUDED.shelf_life_days
         RETURNING item_id, name`,
        [
          this.businessId,
          it.name,
          cat(it.category),
          it.unit,
          it.reorder_point,
          it.safety,
          vendor(it.vendor),
          it.track_expiry,
          it.shelf
        ]
      );
      const row = res.rows[0];
      this.itemIdByName[row.name] = row.item_id;
    }
    console.log('  ✅ Inventory items ready');
  }

  // ---------- Menu (same items) + Recipes mapping to inventory ----------
  async createMenu() {
    console.log('🍽️ Creating menu and recipes...');
    // We assume MenuCategories, MenuItems, Recipes, RecipeIngredients exist per DBfinal
    const menuCategories = ['Main Course','Snacks','Beverages','Desserts'];
    const catIds = [];
    for (const c of menuCategories) {
      const res = await this.pool.query(
        `INSERT INTO MenuCategories (business_id, name, is_active)
         VALUES ($1,$2,true)
         ON CONFLICT (business_id, name) DO NOTHING
         RETURNING category_id`,
        [this.businessId, c]
      );
      if (res.rows[0]) catIds.push(res.rows[0].category_id);
    }
    if (catIds.length === 0) {
      const existing = await this.pool.query(
        `SELECT category_id FROM MenuCategories WHERE business_id=$1 ORDER BY category_id`,
        [this.businessId]
      );
      for (const r of existing.rows) catIds.push(r.category_id);
    }

    const serving = this.unitId('Serving');
    const cup = this.unitId('Cup');
    const piece = this.unitId('Piece');

    const menuItems = [
      { name: 'Paneer Butter Masala', cat: 0, price: 280.0, servings_per_batch: 4, unit: serving },
      { name: 'Vegetable Biryani', cat: 0, price: 220.0, servings_per_batch: 6, unit: serving },
      { name: 'Masala Chai', cat: 2, price: 25.0, servings_per_batch: 1, unit: cup },
      { name: 'Chicken Tikka', cat: 0, price: 350.0, servings_per_batch: 3, unit: serving },
      { name: 'Garlic Naan', cat: 1, price: 40.0, servings_per_batch: 1, unit: piece },
      { name: 'Lassi', cat: 2, price: 50.0, servings_per_batch: 1, unit: cup },
      { name: 'Tandoori Chicken', cat: 0, price: 400.0, servings_per_batch: 4, unit: serving },
      { name: 'Paneer Tikka', cat: 0, price: 320.0, servings_per_batch: 3, unit: serving },
      { name: 'Veggie Samosa', cat: 1, price: 15.0, servings_per_batch: 4, unit: piece },
      { name: 'Sweet Ladoo', cat: 3, price: 30.0, servings_per_batch: 6, unit: piece }
    ];

    this.menuIdByName = {};
    for (const m of menuItems) {
      const imageName = m.name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
      const res = await this.pool.query(
        `INSERT INTO MenuItems (business_id, name, category_id, price, servings_per_batch, serving_unit_id, image_url, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)
         ON CONFLICT (business_id, name) DO UPDATE SET price = EXCLUDED.price
         RETURNING menu_item_id, name`,
        [this.businessId, m.name, catIds[Math.min(m.cat, catIds.length-1)], m.price, m.servings_per_batch, m.unit, `/images/${imageName}.jpg`]
      );
      const row = res.rows[0];
      this.menuIdByName[row.name] = row.menu_item_id;

      // Recipe entry with recipe_id = menu_item_id for simplicity (as used in existing seed)
      await this.pool.query(
        `INSERT INTO Recipes (recipe_id, instructions, estimated_cost, prep_time_minutes, cook_time_minutes)
         VALUES ($1,$2,$3,15,30)
         ON CONFLICT (recipe_id) DO UPDATE SET instructions = EXCLUDED.instructions, estimated_cost = EXCLUDED.estimated_cost`,
        [row.menu_item_id, `Instructions for preparing ${m.name}`, m.price * 0.4]
      );
    }

    // Ingredient mappings (inventory item name, qty)
    const inv = (n) => this.itemIdByName[n];
    const recipeMap = new Map([
      ['Paneer Butter Masala', [ ['Paneer',0.3], ['Turmeric Powder',0.01], ['Red Chili Powder',0.02], ['Cooking Oil',0.05] ]],
      ['Vegetable Biryani',   [ ['Basmati Rice',0.25], ['Tomatoes',0.1], ['Onions',0.1], ['Red Chili Powder',0.02], ['Cooking Oil',0.04] ]],
      ['Masala Chai',         [ ['Fresh Milk',0.1], ['Turmeric Powder',0.005] ]],
      ['Chicken Tikka',       [ ['Fresh Milk',0.5], ['Red Chili Powder',0.03] ]],
      ['Garlic Naan',         [ ['Cooking Oil',0.005], ['Onions',0.05] ]],
      ['Lassi',               [ ['Fresh Milk',0.3], ['Cooking Oil',0.01] ]],
      ['Tandoori Chicken',    [ ['Fresh Milk',0.4], ['Red Chili Powder',0.04] ]],
      ['Paneer Tikka',        [ ['Paneer',0.25], ['Red Chili Powder',0.03] ]],
      ['Veggie Samosa',       [ ['Tomatoes',0.05], ['Onions',0.03], ['Cooking Oil',0.01] ]],
      ['Sweet Ladoo',         [ ['Cooking Oil',0.02], ['Red Chili Powder',0.01] ]]
    ]);

    for (const [menuName, ings] of recipeMap.entries()) {
      const recipeId = this.menuIdByName[menuName];
      for (const [ingName, qty] of ings) {
        if (!inv(ingName)) continue; // skip if not present
        await this.pool.query(
          `INSERT INTO RecipeIngredients (recipe_id, item_id, quantity, unit_id, notes)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (recipe_id, item_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
          [recipeId, inv(ingName), qty, this.unitId('Kilogram'), `Used in ${menuName}`]
        );
      }
    }
    console.log('  ✅ Menu + recipes ready');
  }

  // ---------- Wastage reasons (exact list) ----------
  async createWastageReasons() {
    console.log('🗑️ Creating wastage reasons (exact 7)...');
    const reasons = [
      { label: 'Overcooked', category: 'Dish Waste' },
      { label: 'Customer Return', category: 'Dish Waste' },
      { label: 'Preparation Error', category: 'Dish Waste' },
      { label: 'Spoilage (Prepared)', category: 'Dish Waste' },
      { label: 'Excess Preparation', category: 'Dish Waste' },
      { label: 'Billing Errors', category: 'General Waste' },
      { label: 'No wastage recorded', category: 'General Waste' }
    ];

    // Map to DB enum values
    const asEnum = (c) => {
      if (c === 'Dish Waste') return 'Dish Waste';
      if (c === 'Ingredient Waste') return 'Ingredient Waste';
      return 'General Waste';
    };

    for (const r of reasons) {
      await this.pool.query(
        `INSERT INTO WastageReasons (business_id, reason_label, reason_category, is_active)
         VALUES ($1,$2,$3,true)
         ON CONFLICT (business_id, reason_label) DO UPDATE SET reason_category = EXCLUDED.reason_category`,
        [this.businessId, r.label, asEnum(r.category)]
      );
    }
    console.log('  ✅ Wastage reasons ready');
  }

  // ---------- Stock-In to cover ALL menu ingredients ----------
  async createStockInForAllMenuIngredients() {
    console.log('📥 Creating stock-in to cover all menu ingredients...');

    const today = new Date();
    const receivedDate = new Date(today);
    receivedDate.setDate(receivedDate.getDate() - 1);

    // Group items by their default vendors for realistic data
    const itemsByVendor = new Map();
    for (const [name, itemId] of Object.entries(this.itemIdByName)) {
      const q = await this.pool.query(`SELECT default_vendor_id, standard_unit_id, shelf_life_days, track_expiry FROM InventoryItems WHERE item_id=$1`, [itemId]);
      const row = q.rows[0];
      const v = row.default_vendor_id || null;
      if (!itemsByVendor.has(v)) itemsByVendor.set(v, []);
      itemsByVendor.get(v).push({ itemId, name, unitId: row.standard_unit_id, shelf: row.shelf_life_days, track_expiry: row.track_expiry });
    }

    for (const [vendorId, arr] of itemsByVendor.entries()) {
      const res = await this.pool.query(
        `INSERT INTO StockInRecords (business_id, received_by_user_id, received_date, vendor_id, total_cost, status, entry_method)
         VALUES ($1,$2,$3,$4,$5,'Submitted','Manual Entry') RETURNING stock_in_id`,
        [this.businessId, this.managerUserId, receivedDate, vendorId, 0]
      );
      const stockInId = res.rows[0].stock_in_id;

      let total = 0;
      for (const it of arr) {
        const quantity = this.suggestQuantity(it.name);
        const unitCost = this.suggestUnitCost(it.name);
        total += quantity * unitCost;

        const expiry = it.track_expiry && it.shelf ? new Date(receivedDate.getTime() + it.shelf*24*60*60*1000) : null;

        await this.pool.query(
          `INSERT INTO StockInLineItems (stock_in_id, item_id, raw_item_name_extracted, quantity, unit_cost, expiry_date, received_unit_id, is_mapped_to_inventory)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
          [stockInId, it.itemId, `Raw ${it.name}`, quantity, unitCost, expiry, it.unitId]
        );
      }

      // Update header total
      await this.pool.query(`UPDATE StockInRecords SET total_cost=$1 WHERE stock_in_id=$2`, [total, stockInId]);
    }

    console.log('  ✅ Stock-in ready (all menu ingredients covered)');
  }

  suggestQuantity(name) {
    // Simple defaults by item type
    if (/Milk|Oil/i.test(name)) return 20;      // liters
    if (/Powder|Chili|Turmeric/i.test(name)) return 2000; // grams
    if (/Rice|Paneer|Tomatoes|Onions/i.test(name)) return 30; // kg
    return 10;
  }

  suggestUnitCost(name) {
    if (/Tomatoes/i.test(name)) return 30;
    if (/Onions/i.test(name)) return 25;
    if (/Turmeric/i.test(name)) return 0.15;
    if (/Chili/i.test(name)) return 0.20;
    if (/Milk/i.test(name)) return 45;
    if (/Paneer/i.test(name)) return 250;
    if (/Rice/i.test(name)) return 80;
    if (/Oil/i.test(name)) return 120;
    return 10;
  }
}

if (require.main === module) {
  new DataSeed().run()
    .then(() => { console.log('✅ dataseed.js finished'); process.exit(0); })
    .catch((e) => { console.error('❌ dataseed.js error', e); process.exit(1); });
}
