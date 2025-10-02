const { pool, testConnection } = require('./config/database');

require('dotenv').config();

class SeedData {
  constructor() {
    this.pool = pool;
  }

  async insertSeedData() {
    try {
      console.log('🌱 Starting comprehensive seed data insertion...\n');

      // Test database connection first
      console.log('🔌 Testing database connection...');
      await testConnection();
      console.log('✅ Database connection successful\n');

      // 1. Create lookup tables first (no dependencies)
      await this.createGlobalUnits();
      await this.createBusinessTypes();
      await this.createBillingMachineModels();
      await this.createLanguages();

      // 2. Create a test business
      await this.createTestBusiness();

      // 3. Create test roles and users
      await this.createTestUsersAndRoles();

      // 4. Create permissions and role permissions
      await this.createPermissionsAndRolePermissions();

      // 5. Create dashboard widgets and user preferences
      await this.createDashboardWidgetsAndPreferences();

      // 6. Create notification preferences
      await this.createNotificationPreferences();

      // 7. Create test vendors
      await this.createTestVendors();

      // 8. Create test categories
      await this.createTestCategories();

      // 9. Create unit conversions
      await this.createBusinessUnitConversions();

      // 10. Create 8 test inventory items
      await this.createTestInventoryItems();

      // 11. Create inventory batches for the items
      await this.createTestInventoryBatches();

      // 12. Create stock in records
      await this.createTestStockInRecords();

      // 13. Create vendor ratings
      await this.createVendorRatings();

      // 14. Create purchase orders
      await this.createPurchaseOrders();

      // 15. Create 10 menu items with recipes
      await this.createTestMenuItems();

      // 16. Create test sales data
      await this.createTestSalesData();

      // 17. Create scanned images
      await this.createScannedImages();

      // 19. Create extracted sales reports
      await this.createExtractedSalesReports();

      // 20. Create exactly 7 wastage reasons
      await this.createTestWastageReasons();

      // 21. Create wastage records
      await this.createWastageRecords();

      // 22. Create inventory transactions
      await this.createInventoryTransactions();

      // 23. Create complimentary items
      await this.createComplimentaryItems();

      // 24. Create report registry and user report data
      await this.createReportRegistryAndUserData();

      // 25. Create production planning data
      await this.createProductionPlanningData();

      // 26. Create business settings
      await this.createBusinessSettings();

      // 27. Create subscription plans and business subscriptions
      await this.createSubscriptionPlans();

      // 28. Create usage events and production tracking
      await this.createUsageEventsAndProductionTracking();

      // 29. Create summary metrics and reports
      // await this.createSummaryMetrics(); // Disabled - optional summary metrics

      // 30. Create test alerts
      // await this.createTestAlerts(); // Disabled - optional alerts

      console.log('\n🎉 Comprehensive seed data insertion completed successfully!');
      console.log('📊 Your database now has complete test data for ALL tables in DBfinal.js.');
    } catch (error) {
      console.error('\n❌ Seed data insertion failed:', error.message);
      console.error('Stack trace:', error.stack);
      process.exit(1);
    } finally {
      // Pool is managed by the database config, so we don't close it here
      console.log('🔄 Seed data process completed. Database connection remains active.');
    }
  }

  async createGlobalUnits() {
    console.log('🏷️ Creating global units...');

    const units = [
      { unit_name: 'Kilogram', unit_symbol: 'kg', unit_type: 'Weight' },
      { unit_name: 'Gram', unit_symbol: 'g', unit_type: 'Weight' },
      { unit_name: 'Liter', unit_symbol: 'L', unit_type: 'Volume' },
      { unit_name: 'Milliliter', unit_symbol: 'ml', unit_type: 'Volume' },
      { unit_name: 'Piece', unit_symbol: 'pcs', unit_type: 'Count' },
      { unit_name: 'Serving', unit_symbol: 'serving', unit_type: 'Prepared Dish' },
      { unit_name: 'Portion', unit_symbol: 'portion', unit_type: 'Prepared Dish' },
      { unit_name: 'Plate', unit_symbol: 'plate', unit_type: 'Prepared Dish' },
      { unit_name: 'Bowl', unit_symbol: 'bowl', unit_type: 'Prepared Dish' },
  { unit_name: 'Cup', unit_symbol: 'cup', unit_type: 'Volume' },
  { unit_name: 'Tablespoon', unit_symbol: 'tbsp', unit_type: 'Volume' },
  { unit_name: 'Teaspoon', unit_symbol: 'tsp', unit_type: 'Volume' }
    ];

    this.unitIds = [];
    for (const unit of units) {
      const result = await this.pool.query(`
        INSERT INTO GlobalUnits (unit_name, unit_symbol, unit_type, is_system_defined)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (unit_name) DO UPDATE SET
          unit_symbol = EXCLUDED.unit_symbol,
          unit_type = EXCLUDED.unit_type
        RETURNING unit_id
      `, [unit.unit_name, unit.unit_symbol, unit.unit_type]);

      this.unitIds.push(result.rows[0].unit_id);
    }

    console.log(`  ✅ Created ${units.length} global units`);
  }

  async createBusinessTypes() {
    console.log('🏢 Creating business types...');

    const businessTypes = [
      { type_id: 1, type_name: 'Restaurant', description: 'Full-service restaurant' },
      { type_id: 2, type_name: 'Fast Food', description: 'Quick service restaurant' },
      { type_id: 3, type_name: 'Café', description: 'Coffee shop and light meals' },
      { type_id: 4, type_name: 'Catering', description: 'Catering services' },
      { type_id: 5, type_name: 'Food Truck', description: 'Mobile food service' }
    ];

    for (const type of businessTypes) {
      await this.pool.query(`
        INSERT INTO BusinessTypes (type_id, type_name, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (type_id) DO UPDATE SET
          type_name = EXCLUDED.type_name,
          description = EXCLUDED.description
      `, [type.type_id, type.type_name, type.description]);
    }

    console.log(`  ✅ Created ${businessTypes.length} business types`);
  }

  async createBillingMachineModels() {
    console.log('💳 Creating billing machine models...');

    const models = [
      { model_name: 'Basic POS', description: 'Basic point of sale system' },
      { model_name: 'Advanced POS', description: 'Advanced POS with inventory integration' },
      { model_name: 'Mobile POS', description: 'Tablet-based mobile POS' }
    ];

    this.billingModelIds = [];
    for (const model of models) {
      const result = await this.pool.query(`
        INSERT INTO BillingMachineModels (model_name, description)
        VALUES ($1, $2)
        ON CONFLICT (model_name) DO UPDATE SET
          description = EXCLUDED.description
        RETURNING billing_model_id
      `, [model.model_name, model.description]);

      this.billingModelIds.push(result.rows[0].billing_model_id);
    }

    console.log(`  ✅ Created ${models.length} billing machine models`);
  }

  async createLanguages() {
    console.log('🌐 Creating languages...');

    const languages = [
      { language_name: 'English', language_code: 'en' },
      { language_name: 'Hindi', language_code: 'hi' },
      { language_name: 'Tamil', language_code: 'ta' },
      { language_name: 'Telugu', language_code: 'te' },
      { language_name: 'Marathi', language_code: 'mr' }
    ];

    this.languageIds = [];
    for (const language of languages) {
      const result = await this.pool.query(`
        INSERT INTO Languages (language_name, language_code)
        VALUES ($1, $2)
        ON CONFLICT (language_name) DO UPDATE SET
          language_code = EXCLUDED.language_code
        RETURNING language_id
      `, [language.language_name, language.language_code]);

      this.languageIds.push(result.rows[0].language_id);
    }

    console.log(`  ✅ Created ${languages.length} languages`);
  }

  async createTestBusiness() {
    console.log('🏢 Creating test business...');

    // Use default IDs if arrays are empty (from previous seed runs)
    const businessTypeId = this.businessTypeIds && this.businessTypeIds.length > 0 ? this.businessTypeIds[0] : 1;
    const billingModelId = this.billingModelIds && this.billingModelIds.length > 0 ? this.billingModelIds[0] : 1;
    const languageId = this.languageIds && this.languageIds.length > 0 ? this.languageIds[0] : 1;

    // Insert test business
    const businessResult = await this.pool.query(`
      INSERT INTO Businesses (name, business_type_id, num_workers, business_size, billing_model_id, preferred_language_id, is_onboarded)
      VALUES ('Spice Garden Restaurant', $1, 15, 'Medium', $2, $3, true)
      ON CONFLICT (name) DO UPDATE SET
        num_workers = EXCLUDED.num_workers,
        business_size = EXCLUDED.business_size,
        is_onboarded = EXCLUDED.is_onboarded
      RETURNING business_id
    `, [businessTypeId, billingModelId, languageId]);

    this.businessId = businessResult.rows[0].business_id;
    console.log(`  ✅ Created business with ID: ${this.businessId}`);

    // Create business location
    await this.pool.query(`
      INSERT INTO BusinessLocations (business_id, name, address_street, address_city, address_state, address_zip_code)
      VALUES ($1, 'Main Kitchen', '123 Food Street', 'Mumbai', 'Maharashtra', '400001')
      ON CONFLICT (business_id, name) DO NOTHING
    `, [this.businessId]);
  }

  async createTestUsersAndRoles() {
    console.log('👥 Creating test roles and users...');

    // Create roles
    const ownerRoleResult = await this.pool.query(`
      INSERT INTO Roles (business_id, role_name, description, is_system_default, is_active)
      VALUES ($1, 'Owner', 'Business owner with full access', true, true)
      ON CONFLICT (business_id, role_name) DO UPDATE SET
        description = EXCLUDED.description
      RETURNING role_id
    `, [this.businessId]);

    const managerRoleResult = await this.pool.query(`
      INSERT INTO Roles (business_id, role_name, description, is_system_default, is_active)
      VALUES ($1, 'Manager', 'Kitchen manager with inventory access', true, true)
      ON CONFLICT (business_id, role_name) DO UPDATE SET
        description = EXCLUDED.description
      RETURNING role_id
    `, [this.businessId]);

    this.ownerRoleId = ownerRoleResult.rows[0].role_id;
    this.managerRoleId = managerRoleResult.rows[0].role_id;

    // Create test users
    const ownerResult = await this.pool.query(`
      INSERT INTO Users (business_id, email, password_hash, name, phone_number, role_id, is_active)
      VALUES ($1, 'owner@spicegarden.com', '$2b$10$test.hash', 'Raj Patel', '+91-9876543210', $2, true)
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        phone_number = EXCLUDED.phone_number
      RETURNING user_id
    `, [this.businessId, this.ownerRoleId]);

    const managerResult = await this.pool.query(`
      INSERT INTO Users (business_id, email, password_hash, name, phone_number, role_id, is_active)
      VALUES ($1, 'manager@spicegarden.com', '$2b$10$test.hash', 'Priya Sharma', '+91-9876543211', $2, true)
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        phone_number = EXCLUDED.phone_number
      RETURNING user_id
    `, [this.businessId, this.managerRoleId]);

    this.ownerUserId = ownerResult.rows[0].user_id;
    this.managerUserId = managerResult.rows[0].user_id;

    console.log(`  ✅ Created users: Owner (${this.ownerUserId}), Manager (${this.managerUserId})`);
  }

  async createPermissionsAndRolePermissions() {
    console.log('🔐 Creating permissions and role permissions...');

    // Create permissions
    const permissions = [
      { permission_name: 'can_view_dashboard', module_name: 'Dashboard', description: 'View dashboard and metrics' },
      { permission_name: 'can_manage_inventory', module_name: 'Inventory', description: 'Manage inventory items and stock' },
      { permission_name: 'can_view_inventory', module_name: 'Inventory', description: 'View inventory data' },
      { permission_name: 'can_manage_sales', module_name: 'Sales', description: 'Manage sales transactions' },
      { permission_name: 'can_view_sales', module_name: 'Sales', description: 'View sales data' },
      { permission_name: 'can_manage_menu', module_name: 'Menu', description: 'Manage menu items and recipes' },
      { permission_name: 'can_view_menu', module_name: 'Menu', description: 'View menu items' },
      { permission_name: 'can_manage_vendors', module_name: 'Vendors', description: 'Manage vendor information' },
      { permission_name: 'can_view_reports', module_name: 'Reports', description: 'View reports and analytics' },
      { permission_name: 'can_manage_users', module_name: 'Users', description: 'Manage user accounts and roles' },
      { permission_name: 'can_manage_settings', module_name: 'Settings', description: 'Manage business settings' }
    ];

    this.permissionIds = [];
    for (const permission of permissions) {
      const result = await this.pool.query(`
        INSERT INTO Permissions (permission_name, module_name, description, is_active)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (permission_name) DO UPDATE SET
          module_name = EXCLUDED.module_name,
          description = EXCLUDED.description
        RETURNING permission_id
      `, [permission.permission_name, permission.module_name, permission.description]);

      this.permissionIds.push(result.rows[0].permission_id);
    }

    // Assign all permissions to owner role
    for (const permissionId of this.permissionIds) {
      await this.pool.query(`
        INSERT INTO RolePermissions (role_id, permission_id)
        VALUES ($1, $2)
        ON CONFLICT (role_id, permission_id) DO NOTHING
      `, [this.ownerRoleId, permissionId]);
    }

    // Assign limited permissions to manager role
    const managerPermissions = this.permissionIds.slice(0, 8); // First 8 permissions
    for (const permissionId of managerPermissions) {
      await this.pool.query(`
        INSERT INTO RolePermissions (role_id, permission_id)
        VALUES ($1, $2)
        ON CONFLICT (role_id, permission_id) DO NOTHING
      `, [this.managerRoleId, permissionId]);
    }

    console.log(`  ✅ Created ${permissions.length} permissions and role assignments`);
  }

  async createDashboardWidgetsAndPreferences() {
    console.log('📊 Creating dashboard widgets and user preferences...');

    // Create dashboard widgets
    const widgets = [
      { name: 'Sales Overview', description: 'Daily sales summary', widget_icon: 'chart-line', widget_type: 'Metric', default_order: 1 },
      { name: 'Low Stock Items', description: 'Items below reorder point', widget_icon: 'exclamation-triangle', widget_type: 'List', default_order: 2 },
      { name: 'Recent Transactions', description: 'Latest sales transactions', widget_icon: 'receipt', widget_type: 'List', default_order: 3 },
      { name: 'Inventory Value', description: 'Total inventory value', widget_icon: 'boxes', widget_type: 'Metric', default_order: 4 },
      { name: 'Top Selling Items', description: 'Best performing menu items', widget_icon: 'star', widget_type: 'Graph', default_order: 5 },
      { name: 'Vendor Performance', description: 'Vendor delivery metrics', widget_icon: 'truck', widget_type: 'Graph', default_order: 6 }
    ];

    this.widgetIds = [];
    for (const widget of widgets) {
      const result = await this.pool.query(`
        INSERT INTO DashboardWidgets (name, description, widget_icon, widget_type, default_order, is_active)
        VALUES ($1, $2, $3, $4, $5, true)
        ON CONFLICT (name) DO UPDATE SET
          description = EXCLUDED.description,
          widget_icon = EXCLUDED.widget_icon,
          widget_type = EXCLUDED.widget_type,
          default_order = EXCLUDED.default_order
        RETURNING widget_id
      `, [widget.name, widget.description, widget.widget_icon, widget.widget_type, widget.default_order]);

      this.widgetIds.push(result.rows[0].widget_id);
    }

    // Create user dashboard preferences
    const userIds = [this.ownerUserId, this.managerUserId];
    for (const userId of userIds) {
      for (let i = 0; i < this.widgetIds.length; i++) {
        await this.pool.query(`
          INSERT INTO UserDashboardPreferences (user_id, widget_id, is_enabled, display_order)
          VALUES ($1, $2, true, $3)
          ON CONFLICT (user_id, widget_id) DO NOTHING
        `, [userId, this.widgetIds[i], i + 1]);
      }
    }

    console.log(`  ✅ Created ${widgets.length} dashboard widgets and user preferences`);
  }

  async createNotificationPreferences() {
    console.log('🔔 Creating notification preferences...');

    const alertTypes = [
      { alert_type: 'Low Stock Alert', threshold_value: 10.0 },
      { alert_type: 'Expiry Alert', threshold_value: 3.0 },
      { alert_type: 'High Usage Alert', threshold_value: 80.0 },
      { alert_type: 'Sales Target Alert', threshold_value: 1000.0 },
      { alert_type: 'Vendor Payment Due', threshold_value: 7.0 }
    ];

    const userIds = [this.ownerUserId, this.managerUserId];
    for (const userId of userIds) {
      for (const alertType of alertTypes) {
        await this.pool.query(`
          INSERT INTO NotificationPreferences (user_id, alert_type, is_enabled, threshold_value)
          VALUES ($1, $2, true, $3)
          ON CONFLICT (user_id, alert_type) DO UPDATE SET
            threshold_value = EXCLUDED.threshold_value
        `, [userId, alertType.alert_type, alertType.threshold_value]);
      }
    }

    console.log(`  ✅ Created notification preferences for ${userIds.length} users`);
  }

  async createTestVendors() {
    console.log('🏪 Creating test vendors...');

    const vendors = [
      {
        name: 'Fresh Veggie Suppliers',
        description: 'Premium fresh vegetables and herbs',
        contact_phone: '+91-9876543220',
        contact_email: 'orders@freshveggie.com',
        address: 'Wholesale Market, Mumbai',
        average_rating: 4.5,
        on_time_delivery_rate: 92.5
      },
      {
        name: 'Spice World Distributors',
        description: 'Authentic spices and seasonings',
        contact_phone: '+91-9876543221',
        contact_email: 'sales@spiceworld.com',
        address: 'Spice Market, Mumbai',
        average_rating: 4.8,
        on_time_delivery_rate: 95.0
      },
      {
        name: 'Dairy Fresh Co.',
        description: 'Fresh dairy products and milk',
        contact_phone: '+91-9876543222',
        contact_email: 'supply@dairyfresh.com',
        address: 'Andheri East, Mumbai',
        average_rating: 4.3,
        on_time_delivery_rate: 88.0
      },
      // Added to ensure all inventory items referenced by menu recipes appear in StockIn
      {
        vendor_index: 0,
        total_cost: 6400.0,
        days_ago: 2,
        items: [
          // Basmati Rice and Cooking Oil
          { item_index: 6, quantity: 50.0, unit_cost: 80.0 },
          { item_index: 7, quantity: 20.0, unit_cost: 120.0 }
        ]
      }
    ];

    this.vendorIds = [];
    for (const vendor of vendors) {
      const result = await this.pool.query(`
        INSERT INTO Vendors (business_id, name, description, contact_phone, contact_email, address, average_rating, on_time_delivery_rate, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
        ON CONFLICT (business_id, name) DO UPDATE SET
          description = EXCLUDED.description,
          contact_phone = EXCLUDED.contact_phone,
          contact_email = EXCLUDED.contact_email,
          address = EXCLUDED.address,
          average_rating = EXCLUDED.average_rating,
          on_time_delivery_rate = EXCLUDED.on_time_delivery_rate
        RETURNING vendor_id
      `, [this.businessId, vendor.name, vendor.description, vendor.contact_phone, vendor.contact_email, vendor.address, vendor.average_rating, vendor.on_time_delivery_rate]);

      this.vendorIds.push(result.rows[0].vendor_id);
    }

    console.log(`  ✅ Created ${vendors.length} vendors`);
  }

  async createTestCategories() {
    console.log('📂 Creating test categories...');

    const categories = [
      'Vegetables',
      'Spices & Seasonings',
      'Dairy Products',
      'Grains & Cereals',
      'Beverages',
      'Meat & Seafood'
    ];

    this.categoryIds = [];
    for (const category of categories) {
      const result = await this.pool.query(`
        INSERT INTO InventoryCategories (business_id, name, is_active)
        VALUES ($1, $2, true)
        ON CONFLICT (business_id, name) DO NOTHING
        RETURNING category_id
      `, [this.businessId, category]);

      if (result.rows.length > 0) {
        this.categoryIds.push(result.rows[0].category_id);
      }
    }

    // Get existing category IDs if conflicts occurred
    if (this.categoryIds.length === 0) {
      const result = await this.pool.query(`
        SELECT category_id FROM InventoryCategories WHERE business_id = $1 ORDER BY category_id
      `, [this.businessId]);
      this.categoryIds = result.rows.map(row => row.category_id);
    }

    console.log(`  ✅ Created/found ${this.categoryIds.length} categories`);
  }

  async createBusinessUnitConversions() {
    console.log('🔄 Creating business unit conversions...');

    // Only create conversions if we have enough units
    if (!this.unitIds || this.unitIds.length < 5) {
      console.log('  ⚠️ Skipping unit conversions - insufficient units created');
      return;
    }

    const conversions = [
      { from_unit_index: 0, to_unit_index: 1, conversion_factor: 1000.0, description: 'Kilogram to Gram' }, // kg to g
      { from_unit_index: 1, to_unit_index: 0, conversion_factor: 0.001, description: 'Gram to Kilogram' }, // g to kg
      { from_unit_index: 2, to_unit_index: 3, conversion_factor: 1000.0, description: 'Liter to Milliliter' }, // L to ml
      { from_unit_index: 3, to_unit_index: 2, conversion_factor: 0.001, description: 'Milliliter to Liter' }, // ml to L
    ];

    // Add cup conversions if we have enough units
    if (this.unitIds.length >= 10) {
      conversions.push(
        { from_unit_index: 9, to_unit_index: 3, conversion_factor: 250.0, description: 'Cup to Milliliter' }, // cup to ml
        { from_unit_index: 3, to_unit_index: 9, conversion_factor: 0.004, description: 'Milliliter to Cup' } // ml to cup
      );
    }

    for (const conversion of conversions) {
      await this.pool.query(`
        INSERT INTO BusinessUnitConversions (business_id, from_unit_id, to_unit_id, conversion_factor, description)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (business_id, from_unit_id, to_unit_id) DO UPDATE SET
          conversion_factor = EXCLUDED.conversion_factor,
          description = EXCLUDED.description
      `, [this.businessId, this.unitIds[conversion.from_unit_index], this.unitIds[conversion.to_unit_index], conversion.conversion_factor, conversion.description]);
    }

    console.log(`  ✅ Created ${conversions.length} unit conversions`);
  }

  async createTestInventoryItems() {
    console.log('📦 Creating 8 test inventory items...');

    const items = [
      {
        name: 'Tomatoes',
        category_index: 0, // Vegetables
        unit_id: 1, // Kilogram
        reorder_point: 5.0,
        safety_stock: 2.0,
        vendor_index: 0, // Fresh Veggie Suppliers
        track_expiry: true,
        shelf_life_days: 7
      },
      {
        name: 'Onions',
        category_index: 0, // Vegetables
        unit_id: 1, // Kilogram
        reorder_point: 10.0,
        safety_stock: 5.0,
        vendor_index: 0, // Fresh Veggie Suppliers
        track_expiry: true,
        shelf_life_days: 14
      },
      {
        name: 'Turmeric Powder',
        category_index: 1, // Spices & Seasonings
        unit_id: 2, // Gram
        reorder_point: 500.0,
        safety_stock: 200.0,
        vendor_index: 1, // Spice World Distributors
        track_expiry: true,
        shelf_life_days: 365
      },
      {
        name: 'Red Chili Powder',
        category_index: 1, // Spices & Seasonings
        unit_id: 2, // Gram
        reorder_point: 1000.0,
        safety_stock: 500.0,
        vendor_index: 1, // Spice World Distributors
        track_expiry: true,
        shelf_life_days: 365
      },
      {
        name: 'Fresh Milk',
        category_index: 2, // Dairy Products
        unit_id: 3, // Liter
        reorder_point: 20.0,
        safety_stock: 10.0,
        vendor_index: 2, // Dairy Fresh Co.
        track_expiry: true,
        shelf_life_days: 3
      },
      {
        name: 'Paneer',
        category_index: 2, // Dairy Products
        unit_id: 1, // Kilogram
        reorder_point: 2.0,
        safety_stock: 1.0,
        vendor_index: 2, // Dairy Fresh Co.
        track_expiry: true,
        shelf_life_days: 5
      },
      {
        name: 'Basmati Rice',
        category_index: 3, // Grains & Cereals
        unit_id: 1, // Kilogram
        reorder_point: 25.0,
        safety_stock: 10.0,
        vendor_index: 0, // Fresh Veggie Suppliers
        track_expiry: false,
        shelf_life_days: null
      },
      {
        name: 'Cooking Oil',
        category_index: 4, // Beverages (using as general liquids)
        unit_id: 3, // Liter
        reorder_point: 10.0,
        safety_stock: 5.0,
        vendor_index: 0, // Fresh Veggie Suppliers
        track_expiry: true,
        shelf_life_days: 180
      }
    ];

    this.itemIds = [];
    for (const item of items) {
      const result = await this.pool.query(`
        INSERT INTO InventoryItems (
          business_id, name, category_id, standard_unit_id, reorder_point,
          safety_stock, default_vendor_id, track_expiry, shelf_life_days, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
        ON CONFLICT (business_id, name) DO UPDATE SET
          category_id = EXCLUDED.category_id,
          standard_unit_id = EXCLUDED.standard_unit_id,
          reorder_point = EXCLUDED.reorder_point,
          safety_stock = EXCLUDED.safety_stock,
          default_vendor_id = EXCLUDED.default_vendor_id,
          track_expiry = EXCLUDED.track_expiry,
          shelf_life_days = EXCLUDED.shelf_life_days
        RETURNING item_id
      `, [
        this.businessId,
        item.name,
        this.categoryIds[item.category_index],
        item.unit_id,
        item.reorder_point,
        item.safety_stock,
        this.vendorIds[item.vendor_index],
        item.track_expiry,
        item.shelf_life_days
      ]);

      this.itemIds.push(result.rows[0].item_id);
    }

    console.log(`  ✅ Created 8 inventory items`);
  }

  async createTestInventoryBatches() {
    console.log('📦 Creating inventory batches...');

    const batches = [
      // Tomatoes - 2 batches
      { item_index: 0, quantity: 15.0, unit_cost: 30.0, vendor_index: 0, days_from_now: -2 },
      { item_index: 0, quantity: 8.0, unit_cost: 32.0, vendor_index: 0, days_from_now: -1 },

      // Onions - 1 batch (low stock alert)
      { item_index: 1, quantity: 3.0, unit_cost: 25.0, vendor_index: 0, days_from_now: -3 },

      // Turmeric Powder - 1 batch
      { item_index: 2, quantity: 2000.0, unit_cost: 0.15, vendor_index: 1, days_from_now: -5 },

      // Red Chili Powder - 1 batch (critical stock)
      { item_index: 3, quantity: 400.0, unit_cost: 0.20, vendor_index: 1, days_from_now: -4 },

      // Fresh Milk - 2 batches
      { item_index: 4, quantity: 25.0, unit_cost: 45.0, vendor_index: 2, days_from_now: 0 },
      { item_index: 4, quantity: 15.0, unit_cost: 45.0, vendor_index: 2, days_from_now: -1 },

      // Paneer - 1 batch
      { item_index: 5, quantity: 3.0, unit_cost: 250.0, vendor_index: 2, days_from_now: -1 },

      // Basmati Rice - 1 batch
      { item_index: 6, quantity: 50.0, unit_cost: 80.0, vendor_index: 0, days_from_now: -7 },

      // Cooking Oil - 1 batch
      { item_index: 7, quantity: 20.0, unit_cost: 120.0, vendor_index: 0, days_from_now: -3 }
    ];

    for (const batch of batches) {
      const received_date = new Date();
      received_date.setDate(received_date.getDate() + batch.days_from_now);

      const expiry_date = new Date(received_date);
      const item_index = batch.item_index;

      // Calculate expiry based on shelf life
      if (item_index === 0) expiry_date.setDate(expiry_date.getDate() + 7); // Tomatoes
      else if (item_index === 1) expiry_date.setDate(expiry_date.getDate() + 14); // Onions
      else if (item_index === 2 || item_index === 3) expiry_date.setDate(expiry_date.getDate() + 365); // Spices
      else if (item_index === 4) expiry_date.setDate(expiry_date.getDate() + 3); // Milk
      else if (item_index === 5) expiry_date.setDate(expiry_date.getDate() + 5); // Paneer
      else if (item_index === 7) expiry_date.setDate(expiry_date.getDate() + 180); // Oil

      await this.pool.query(`
        INSERT INTO InventoryBatches (
          item_id, quantity, unit_cost, expiry_date, received_date, vendor_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        this.itemIds[batch.item_index],
        batch.quantity,
        batch.unit_cost,
        item_index === 6 ? null : expiry_date, // Rice has no expiry
        received_date,
        this.vendorIds[batch.vendor_index]
      ]);
    }

    console.log(`  ✅ Created ${batches.length} inventory batches`);
  }

  async createTestStockInRecords() {
    console.log('📥 Creating stock in records...');

    const stockInRecords = [
      {
        vendor_index: 0,
        total_cost: 1200.0,
        days_ago: 5,
        items: [
          { item_index: 0, quantity: 20.0, unit_cost: 30.0 },
          { item_index: 1, quantity: 15.0, unit_cost: 25.0 }
        ]
      },
      {
        vendor_index: 1,
        total_cost: 800.0,
        days_ago: 3,
        items: [
          { item_index: 2, quantity: 2000.0, unit_cost: 0.15 },
          { item_index: 3, quantity: 1500.0, unit_cost: 0.20 }
        ]
      },
      {
        vendor_index: 2,
        total_cost: 1500.0,
        days_ago: 1,
        items: [
          { item_index: 4, quantity: 30.0, unit_cost: 45.0 },
          { item_index: 5, quantity: 2.0, unit_cost: 250.0 }
        ]
      }
    ];

    for (const record of stockInRecords) {
      const received_date = new Date();
      received_date.setDate(received_date.getDate() - record.days_ago);

      const stockInResult = await this.pool.query(`
        INSERT INTO StockInRecords (
          business_id, received_by_user_id, received_date, vendor_id,
          total_cost, status, entry_method
        )
        VALUES ($1, $2, $3, $4, $5, 'Submitted', 'Manual Entry')
        RETURNING stock_in_id
      `, [
        this.businessId,
        this.managerUserId,
        received_date,
        this.vendorIds[record.vendor_index],
        record.total_cost
      ]);

      const stockInId = stockInResult.rows[0].stock_in_id;

      // Create line items
      for (const item of record.items) {
        await this.pool.query(`
          INSERT INTO StockInLineItems (
            stock_in_id, item_id, raw_item_name_extracted, quantity,
            unit_cost, received_unit_id, is_mapped_to_inventory
          )
          VALUES ($1, $2, $3, $4, $5, $6, true)
        `, [
          stockInId,
          this.itemIds[item.item_index],
          `Raw ${this.itemIds[item.item_index]}`, // Mock raw name
          item.quantity,
          item.unit_cost,
          1 // Default to first unit
        ]);
      }
    }

    console.log(`  ✅ Created ${stockInRecords.length} stock in records`);
  }

  async createVendorRatings() {
    console.log('⭐ Creating vendor ratings...');

    const ratings = [
      { vendor_index: 0, rating: 4.5, user_id: this.ownerUserId, comment: 'Excellent quality vegetables, always fresh' },
      { vendor_index: 0, rating: 4.2, user_id: this.managerUserId, comment: 'Good delivery time, quality consistent' },
      { vendor_index: 1, rating: 4.8, user_id: this.ownerUserId, comment: 'Best spices in the market, authentic flavors' },
      { vendor_index: 1, rating: 4.6, user_id: this.managerUserId, comment: 'Premium quality spices, worth the price' },
      { vendor_index: 2, rating: 4.3, user_id: this.ownerUserId, comment: 'Fresh dairy products, reliable supplier' },
      { vendor_index: 2, rating: 4.1, user_id: this.managerUserId, comment: 'Good quality milk and paneer' }
    ];

    for (const rating of ratings) {
      await this.pool.query(`
        INSERT INTO VendorRatings (vendor_id, rating, user_id, review_comment)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (vendor_id, user_id) DO UPDATE SET
          rating = EXCLUDED.rating,
          review_comment = EXCLUDED.review_comment
      `, [
        this.vendorIds[rating.vendor_index],
        rating.rating,
        rating.user_id,
        rating.comment
      ]);
    }

    console.log(`  ✅ Created ${ratings.length} vendor ratings`);
  }

  async createPurchaseOrders() {
    console.log('📋 Creating purchase orders...');

    const purchaseOrders = [
      {
        vendor_index: 0,
        po_number: 'PO-001',
        total_amount: 2500.0,
        expected_delivery_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
        status: 'Submitted',
        total_items: 2,
        items: [
          { item_index: 0, quantity: 50.0, unit_cost: 28.0 },
          { item_index: 1, quantity: 30.0, unit_cost: 22.0 }
        ]
      },
      {
        vendor_index: 1,
        po_number: 'PO-002',
        total_amount: 1800.0,
        expected_delivery_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
        status: 'Received',
        total_items: 2,
        items: [
          { item_index: 2, quantity: 5000.0, unit_cost: 0.12 },
          { item_index: 3, quantity: 8000.0, unit_cost: 0.18 }
        ]
      }
    ];

    this.purchaseOrderIds = [];
    for (const po of purchaseOrders) {
      const poResult = await this.pool.query(`
        INSERT INTO PurchaseOrders (
          business_id, vendor_id, po_number, order_date, expected_delivery_date,
          total_amount, total_items, status, created_by_user_id
        )
        VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, $7, $8)
        ON CONFLICT (business_id, po_number) DO UPDATE SET
          total_amount = EXCLUDED.total_amount,
          total_items = EXCLUDED.total_items,
          status = EXCLUDED.status
        RETURNING po_id
      `, [
        this.businessId,
        this.vendorIds[po.vendor_index],
        po.po_number,
        po.expected_delivery_date,
        po.total_amount,
        po.total_items,
        po.status,
        this.ownerUserId
      ]);
      const poId = poResult.rows[0].po_id;
      this.purchaseOrderIds.push(poId);

      // Create line items
      for (const item of po.items) {
        await this.pool.query(`
          INSERT INTO PurchaseOrderLineItems (
            po_id, item_id, quantity_ordered, unit_id, unit_price, total_line_amount
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (po_id, item_id) DO UPDATE SET
            quantity_ordered = EXCLUDED.quantity_ordered,
            unit_price = EXCLUDED.unit_price,
            total_line_amount = EXCLUDED.total_line_amount
        `, [
          poId,
          this.itemIds[item.item_index],
          item.quantity,
          this.unitIds[0], // Use first unit
          item.unit_cost,
          item.quantity * item.unit_cost
        ]);
      }
    }

    console.log(`  ✅ Created ${purchaseOrders.length} purchase orders`);
  }

  async createTestMenuItems() {
    console.log('🍽️ Creating 10 menu items with recipes...');

    // Create menu categories first
    const menuCategories = ['Main Course', 'Snacks', 'Beverages', 'Desserts'];
    const menuCategoryIds = [];

    for (const category of menuCategories) {
      try {
        const result = await this.pool.query(`
          INSERT INTO MenuCategories (business_id, name, is_active)
          VALUES ($1, $2, true)
          ON CONFLICT (business_id, name) DO NOTHING
          RETURNING category_id
        `, [this.businessId, category]);

        if (result.rows.length > 0) {
          menuCategoryIds.push(result.rows[0].category_id);
        }
      } catch (error) {
        console.log(`    Warning: Could not insert category ${category}: ${error.message}`);
      }
    }

    // If no categories were inserted (due to conflicts), get existing ones
    if (menuCategoryIds.length === 0) {
      const existingResult = await this.pool.query(`
        SELECT category_id FROM MenuCategories WHERE business_id = $1 ORDER BY category_id
      `, [this.businessId]);

      if (existingResult.rows.length > 0) {
        existingResult.rows.forEach(row => menuCategoryIds.push(row.category_id));
      } else {
        // If still no categories, create at least one default
        const defaultResult = await this.pool.query(`
          INSERT INTO MenuCategories (business_id, name, is_active)
          VALUES ($1, 'General', true)
          RETURNING category_id
        `, [this.businessId]);
        menuCategoryIds.push(defaultResult.rows[0].category_id);
      }
    }

    // Create 10 menu items
    const menuItems = [
      {
        name: 'Paneer Butter Masala',
        category_index: 0,
        price: 280.0,
        servings_per_batch: 4,
        serving_unit_id: 6 // Serving
      },
      {
        name: 'Vegetable Biryani',
        category_index: 0,
        price: 220.0,
        servings_per_batch: 6,
        serving_unit_id: 6 // Serving
      },
      {
        name: 'Masala Chai',
        category_index: 2,
        price: 25.0,
        servings_per_batch: 1,
        serving_unit_id: 10 // Cup
      },
      {
        name: 'Chicken Tikka',
        category_index: 0,
        price: 350.0,
        servings_per_batch: 3,
        serving_unit_id: 6 // Serving
      },
      {
        name: 'Garlic Naan',
        category_index: 1,
        price: 40.0,
        servings_per_batch: 1,
        serving_unit_id: 5 // Piece
      },
      {
        name: 'Lassi',
        category_index: 2,
        price: 50.0,
        servings_per_batch: 1,
        serving_unit_id: 10 // Cup
      },
      {
        name: 'Tandoori Chicken',
        category_index: 0,
        price: 400.0,
        servings_per_batch: 4,
        serving_unit_id: 6 // Serving
      },
      {
        name: 'Paneer Tikka',
        category_index: 0,
        price: 320.0,
        servings_per_batch: 3,
        serving_unit_id: 6 // Serving
      },
      {
        name: 'Veggie Samosa',
        category_index: 1,
        price: 15.0,
        servings_per_batch: 4,
        serving_unit_id: 5 // Piece
      },
      {
        name: 'Sweet Ladoo',
        category_index: 3,
        price: 30.0,
        servings_per_batch: 6,
        serving_unit_id: 5 // Piece
      }
    ];

    // Ingredient mappings for each menu item (inventory item index, quantity needed)
    const ingredientMappings = [
      [[5, 0.3], [2, 0.01], [3, 0.02], [7, 0.05]], // Paneer Butter Masala
      [[6, 0.25], [0, 0.1], [1, 0.1], [3, 0.02], [7, 0.04]], // Vegetable Biryani
      [[4, 0.1], [2, 0.005]], // Masala Chai
      [[4, 0.5], [3, 0.03]], // Chicken Tikka
      [[7, 0.005], [1, 0.05]], // Garlic Naan
      [[4, 0.3], [7, 0.01]], // Lassi
      [[4, 0.4], [3, 0.04]], // Tandoori Chicken
      [[5, 0.25], [3, 0.03]], // Paneer Tikka
      [[0, 0.05], [1, 0.03], [7, 0.01]], // Veggie Samosa
      [[7, 0.02], [3, 0.01]] // Sweet Ladoo
    ];

    this.menuItemIds = [];

    for (let i = 0; i < menuItems.length; i++) {
      const item = menuItems[i];

      // Use appropriate category index, fallback to first available if out of bounds
      const categoryIndex = item.category_index < menuCategoryIds.length ? item.category_index : 0;

      // Generate image URL based on item name
      const imageName = item.name.toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
      const imageUrl = `/images/${imageName}.jpg`;

      // Create menu item
      const result = await this.pool.query(`
        INSERT INTO MenuItems (
          business_id, name, category_id, price, servings_per_batch,
          serving_unit_id, image_url, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, true)
        ON CONFLICT (business_id, name) DO UPDATE SET
          price = EXCLUDED.price,
          servings_per_batch = EXCLUDED.servings_per_batch,
          image_url = EXCLUDED.image_url
        RETURNING menu_item_id
      `, [
        this.businessId,
        item.name,
        menuCategoryIds[categoryIndex],
        item.price,
        item.servings_per_batch,
        item.serving_unit_id,
        imageUrl
      ]);

      const menuItemId = result.rows[0].menu_item_id;
      this.menuItemIds.push(menuItemId);

      // Create recipe entry
      await this.pool.query(`
        INSERT INTO Recipes (recipe_id, instructions, estimated_cost, prep_time_minutes, cook_time_minutes)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (recipe_id) DO UPDATE SET
          instructions = EXCLUDED.instructions,
          estimated_cost = EXCLUDED.estimated_cost
      `, [
        menuItemId,
        `Instructions for preparing ${item.name}`,
        item.price * 0.4, // Estimated cost as 40% of price
        15,
        30
      ]);

      // Create recipe ingredients
      const ingredients = ingredientMappings[i];
      if (ingredients && Array.isArray(ingredients)) {
        for (const [inventoryItemIndex, quantity] of ingredients) {
          if (this.itemIds && this.itemIds[inventoryItemIndex]) {
            await this.pool.query(`
              INSERT INTO RecipeIngredients (recipe_id, item_id, quantity, unit_id, notes)
              VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (recipe_id, item_id) DO UPDATE SET
                quantity = EXCLUDED.quantity
            `, [
              menuItemId,
              this.itemIds[inventoryItemIndex],
              quantity,
              1, // Default unit (kg)
              `Used in ${item.name}`
            ]);
          }
        }
      }
    }

    console.log(`  ✅ Created 10 menu items with recipes and ingredients`);
  }

  async createTestSalesData() {
    console.log('💰 Creating test sales data...');

    const salesData = [
      {
        transaction_date: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
        total_amount: 1150.0,
        payment_method: 'Cash',
        items: [
          { menu_item_index: 0, quantity: 2, unit_price: 280.0 },
          { menu_item_index: 1, quantity: 1, unit_price: 220.0 },
          { menu_item_index: 2, quantity: 3, unit_price: 25.0 },
          { menu_item_index: 4, quantity: 4, unit_price: 40.0 },
          { menu_item_index: 8, quantity: 6, unit_price: 15.0 }
        ]
      },
      {
        transaction_date: new Date(), // Today
        total_amount: 925.0,
        payment_method: 'UPI',
        items: [
          { menu_item_index: 3, quantity: 1, unit_price: 350.0 },
          { menu_item_index: 6, quantity: 1, unit_price: 400.0 },
          { menu_item_index: 5, quantity: 1, unit_price: 50.0 },
          { menu_item_index: 9, quantity: 5, unit_price: 30.0 }
        ]
      }
    ];

    for (const sale of salesData) {
      const saleResult = await this.pool.query(`
        INSERT INTO SalesTransactions (
          business_id, transaction_date, total_amount, payment_method,
          processed_by_user_id, status
        )
        VALUES ($1, $2, $3, $4, $5, 'Confirmed')
        RETURNING sale_id
      `, [
        this.businessId,
        sale.transaction_date,
        sale.total_amount,
        sale.payment_method,
        this.ownerUserId
      ]);

      const saleId = saleResult.rows[0].sale_id;

      // Create line items
      for (const item of sale.items) {
        if (this.menuItemIds && this.menuItemIds[item.menu_item_index]) {
          await this.pool.query(`
            INSERT INTO SaleLineItems (
              sale_id, menu_item_id, quantity_sold, unit_price, line_item_amount
            )
            VALUES ($1, $2, $3, $4, $5)
          `, [
            saleId,
            this.menuItemIds[item.menu_item_index],
            item.quantity,
            item.unit_price,
            item.quantity * item.unit_price
          ]);
        }
      }
    }

    console.log(`  ✅ Created ${salesData.length} sales transactions`);
  }

  async createScannedImages() {
    console.log('📸 Creating scanned images...');

    const images = [
      {
        file_url: '/uploads/sales_report_001.jpg',
        file_path: '/uploads/2024/08/sales_report_001.jpg',
        thumbnail_url: '/uploads/thumbs/sales_report_001_thumb.jpg',
        scan_type: 'Sales Report',
        status: 'OCR Processed',
        file_size: 245760,
        mime_type: 'image/jpeg',
        alt_text: 'Daily sales report for August 20, 2024'
      },
      {
        file_url: '/uploads/vendor_bill_fresh_veggie_001.jpg',
        file_path: '/uploads/2024/08/vendor_bill_fresh_veggie_001.jpg',
        thumbnail_url: '/uploads/thumbs/vendor_bill_fresh_veggie_001_thumb.jpg',
        scan_type: 'Vendor Bill',
        status: 'Ready for Review',
        file_size: 312450,
        mime_type: 'image/jpeg',
        alt_text: 'Vendor bill from Fresh Veggie Suppliers'
      },
      {
        file_url: '/uploads/menu_photo_paneer_masala.jpg',
        file_path: '/uploads/2024/08/menu_photo_paneer_masala.jpg',
        thumbnail_url: '/uploads/thumbs/menu_photo_paneer_masala_thumb.jpg',
        scan_type: 'Menu Item',
        status: 'Uploaded',
        file_size: 187320,
        mime_type: 'image/jpeg',
        alt_text: 'Photo of Paneer Butter Masala dish'
      },
      {
        file_url: '/uploads/stock_out_wastage_001.jpg',
        file_path: '/uploads/2024/08/stock_out_wastage_001.jpg',
        thumbnail_url: '/uploads/thumbs/stock_out_wastage_001_thumb.jpg',
        scan_type: 'Stock Out',
        status: 'Uploaded',
        file_size: 156890,
        mime_type: 'image/jpeg',
        alt_text: 'Evidence of spoiled vegetables'
      }
    ];

    this.scannedImageIds = [];
    for (const image of images) {
      const result = await this.pool.query(`
        INSERT INTO ScannedImages (
          business_id, file_url, file_path, thumbnail_url, upload_date,
          scan_type, uploaded_by_user_id, status, file_size, mime_type, alt_text
        )
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6, $7, $8, $9, $10)
        RETURNING image_id
      `, [
        this.businessId,
        image.file_url,
        image.file_path,
        image.thumbnail_url,
        image.scan_type,
        this.managerUserId,
        image.status,
        image.file_size,
        image.mime_type,
        image.alt_text
      ]);

      this.scannedImageIds.push(result.rows[0].image_id);
    }

    console.log(`  ✅ Created ${images.length} scanned images`);
  }

  async createExtractedSalesReports() {
    console.log('📊 Creating extracted sales reports...');

    const extractedReports = [
      {
        report_date: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
        total_sales_amount: 2850.0,
        total_orders: 15,
        image_index: 0, // First scanned image
        items: [
          { raw_item_name: 'Paneer Butter Masala', quantity_sold: 8, unit_price: 280.0 },
          { raw_item_name: 'Vegetable Biryani', quantity_sold: 5, unit_price: 220.0 },
          { raw_item_name: 'Masala Chai', quantity_sold: 12, unit_price: 25.0 },
          { raw_item_name: 'Garlic Naan', quantity_sold: 10, unit_price: 40.0 }
        ]
      }
    ];

    this.extractedReportIds = [];
    for (const report of extractedReports) {
      const reportResult = await this.pool.query(`
        INSERT INTO ExtractedSalesReports (
          scanned_image_id, extracted_date, extracted_total_amount, extracted_total_orders,
          is_reviewed, confirmed_by_user_id
        )
        VALUES ($1, $2, $3, $4, true, $5)
        RETURNING extracted_report_id
      `, [
        this.scannedImageIds[report.image_index],
        report.report_date,
        report.total_sales_amount,
        report.total_orders,
        this.ownerUserId
      ]);

      const reportId = reportResult.rows[0].extracted_report_id;
      this.extractedReportIds.push(reportId);

      // Create line items
      let lineNumber = 1;
      for (const item of report.items) {
        await this.pool.query(`
          INSERT INTO ExtractedSalesLineItems (
            extracted_report_id, line_number, raw_item_name, raw_quantity,
            raw_amount, mapped_menu_item_id, mapped_quantity
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          reportId,
          lineNumber,
          item.raw_item_name,
          item.quantity_sold,
          item.quantity_sold * item.unit_price,
          this.menuItemIds[lineNumber - 1] || null, // Map to menu item if available
          item.quantity_sold
        ]);
        lineNumber++;
      }
    }

    // Create daily sale reports
    const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await this.pool.query(`
      INSERT INTO DailySaleReports (
        business_id, report_date, ocr_sales_data, complimentary_sales_data
      )
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (business_id, report_date) DO UPDATE SET
        ocr_sales_data = EXCLUDED.ocr_sales_data,
        complimentary_sales_data = EXCLUDED.complimentary_sales_data
    `, [
      this.businessId, 
      yesterdayDate, 
      JSON.stringify({ total_sales: 2850.0, total_orders: 15, extracted_reports: 2 }),
      JSON.stringify({ total_complimentary: 150.0, complimentary_orders: 3 })
    ]);

    console.log(`  ✅ Created ${extractedReports.length} extracted sales reports`);
  }

  async createTestWastageReasons() {
    console.log('🗑️ Creating exactly 7 wastage reasons...');

    // Check if wastage reasons already exist
    const existingReasons = await this.pool.query(`
      SELECT reason_id FROM WastageReasons WHERE business_id = $1 ORDER BY reason_id
    `, [this.businessId]);

    if (existingReasons.rows.length > 0) {
      console.log(`  ✅ Found ${existingReasons.rows.length} existing wastage reasons`);
      this.createdReasonIds = existingReasons.rows.map(row => row.reason_id);
      return;
    }

    // Create exactly 7 unique wastage reasons
    const wastageReasons = [
      {
        reason_label: 'Overcooked',
        reason_category: 'Dish Waste'
      },
      {
        reason_label: 'Customer Return',
        reason_category: 'Dish Waste'
      },
      {
        reason_label: 'Preparation Error',
        reason_category: 'Dish Waste'
      },
      {
        reason_label: 'Spoilage (Prepared)',
        reason_category: 'Dish Waste'
      },
      {
        reason_label: 'Excess Preparation',
        reason_category: 'Dish Waste'
      },
      {
        reason_label: 'Billing Errors',
        reason_category: 'General Waste'
      },
      {
        reason_label: 'No wastage recorded',
        reason_category: 'General Waste'
      }
    ];

    // Store created reason IDs
    this.createdReasonIds = [];
    
    for (const reason of wastageReasons) {
      const result = await this.pool.query(`
        INSERT INTO WastageReasons (business_id, reason_label, reason_category, is_active)
        VALUES ($1, $2, $3, true)
        RETURNING reason_id
      `, [this.businessId, reason.reason_label, reason.reason_category]);
      
      this.createdReasonIds.push(result.rows[0].reason_id);
    }

    console.log(`  ✅ Created exactly ${wastageReasons.length} wastage reasons`);
  }

  async createWastageRecords() {
    console.log('🗑️ Creating wastage records...');

    const wastageRecords = [
      {
        item_index: 0, // Tomatoes
        quantity_wasted: 2.5,
        reason_index: 3, // Spoilage (Prepared)
        total_cost: 75.0,
        notes: 'Tomatoes got overripe due to heat'
      },
      {
        item_index: 4, // Fresh Milk
        quantity_wasted: 3.0,
        reason_index: 0, // Overcooked
        total_cost: 135.0,
        notes: 'Milk curdled while preparing paneer'
      },
      {
        item_index: 5, // Paneer
        quantity_wasted: 0.5,
        reason_index: 4, // Excess Preparation
        total_cost: 125.0,
        notes: 'Prepared more paneer than needed'
      }
    ];

    for (const waste of wastageRecords) {
      const waste_date = new Date();
      waste_date.setDate(waste_date.getDate() - Math.floor(Math.random() * 7)); // Random date within last week

      const reasonId = this.createdReasonIds[waste.reason_index];

      await this.pool.query(`
        INSERT INTO WastageRecords (
          business_id, item_id, quantity, reason_id,
          cost_impact, recorded_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        this.businessId,
        this.itemIds[waste.item_index],
        waste.quantity_wasted,
        reasonId, // Use actual reason ID
        waste.total_cost,
        this.managerUserId
      ]);
    }

    console.log(`  ✅ Created ${wastageRecords.length} wastage records`);
  }

  async createInventoryTransactions() {
    console.log('📦 Creating inventory transactions...');

    // First, we need a DailySaleReports entry to reference
    const reportResult = await this.pool.query(`
      SELECT report_id FROM DailySaleReports 
      WHERE business_id = $1 
      ORDER BY report_id LIMIT 1
    `, [this.businessId]);
    
    if (reportResult.rows.length === 0) {
      console.log('  ❌ No DailySaleReports found - creating one first');
      
      // Create a simple report entry
      const newReportResult = await this.pool.query(`
        INSERT INTO DailySaleReports (
          business_id, report_date, total_sales_amount, 
          total_transactions, report_data
        )
        VALUES ($1, CURRENT_DATE, 1500.00, 5, '{}')
        RETURNING report_id
      `, [this.businessId]);
      
      this.reportId = newReportResult.rows[0].report_id;
    } else {
      this.reportId = reportResult.rows[0].report_id;
    }

    const transactions = [
      { item_index: 0, transaction_type: 'Sale', quantity: 20.0 },
      { item_index: 0, transaction_type: 'Sale', quantity: -5.0 },
      { item_index: 1, transaction_type: 'Sale', quantity: 15.0 },
      { item_index: 2, transaction_type: 'Sale', quantity: 2000.0 },
      { item_index: 4, transaction_type: 'Sale', quantity: 30.0 },
      { item_index: 4, transaction_type: 'Wastage', quantity: -8.0 },
      { item_index: 5, transaction_type: 'Complimentary', quantity: 3.0 }
    ];

    for (const transaction of transactions) {
      await this.pool.query(`
        INSERT INTO InventoryTransactions (
          business_id, item_id, transaction_type, quantity, related_report_id
        )
        VALUES ($1, $2, $3, $4, $5)
      `, [
        this.businessId,
        this.itemIds[transaction.item_index],
        transaction.transaction_type,
        transaction.quantity,
        this.reportId
      ]);
    }

    console.log(`  ✅ Created ${transactions.length} inventory transactions`);
  }

  async createComplimentaryItems() {
    console.log('🎁 Creating complimentary items (coconut chutney, groundnut chutney, tomato chutney, sambar, karam podi)...');

    // Ensure we have a category for complimentary items
    let complimentaryCategoryId;
    try {
      const catRes = await this.pool.query(`
        INSERT INTO InventoryCategories (business_id, name, is_active)
        VALUES ($1, 'Complimentary Items', true)
        ON CONFLICT (business_id, name) DO NOTHING
        RETURNING category_id
      `, [this.businessId]);
      if (catRes.rows.length > 0) {
        complimentaryCategoryId = catRes.rows[0].category_id;
      } else {
        const fetchCat = await this.pool.query(`
          SELECT category_id FROM InventoryCategories WHERE business_id = $1 AND name = 'Complimentary Items' LIMIT 1
        `, [this.businessId]);
        complimentaryCategoryId = fetchCat.rows[0]?.category_id;
      }
    } catch (e) {
      console.log('    ℹ️ Using existing Complimentary Items category if present.');
    }

    if (!complimentaryCategoryId) {
      // Fallback to first existing category if complimentary not created
      const anyCat = await this.pool.query(`
        SELECT category_id FROM InventoryCategories WHERE business_id = $1 ORDER BY category_id LIMIT 1
      `, [this.businessId]);
      complimentaryCategoryId = anyCat.rows[0]?.category_id;
    }

    // Create inventory items for specified complimentary sides
    const bowlUnitId = this.unitIds && this.unitIds[8] ? this.unitIds[8] : this.unitIds[5]; // Prefer Bowl, fallback to Serving
    const portionUnitId = this.unitIds && this.unitIds[6] ? this.unitIds[6] : this.unitIds[5];

    const complimentaryInventory = [
      { name: 'Coconut Chutney', unit_id: bowlUnitId },
      { name: 'Groundnut Chutney', unit_id: bowlUnitId },
      { name: 'Tomato Chutney', unit_id: bowlUnitId },
      { name: 'Sambar', unit_id: bowlUnitId },
      { name: 'Karam Podi', unit_id: portionUnitId }
    ];

    this.complimentaryItemIds = [];
    for (const ci of complimentaryInventory) {
      const res = await this.pool.query(`
        INSERT INTO InventoryItems (
          business_id, name, category_id, standard_unit_id, is_active
        )
        VALUES ($1, $2, $3, $4, true)
        ON CONFLICT (business_id, name) DO UPDATE SET
          category_id = COALESCE(InventoryItems.category_id, EXCLUDED.category_id),
          standard_unit_id = EXCLUDED.standard_unit_id,
          is_active = EXCLUDED.is_active
        RETURNING item_id
      `, [this.businessId, ci.name, complimentaryCategoryId, ci.unit_id]);
      this.complimentaryItemIds.push(res.rows[0].item_id);
    }

    // Create complimentary item templates aligned to business type Restaurant (type_id = 1)
    const businessTypeId = 1;
    const templates = [
      { item_name: 'Coconut Chutney', unit_of_measurement: 'bowl' },
      { item_name: 'Groundnut Chutney', unit_of_measurement: 'bowl' },
      { item_name: 'Tomato Chutney', unit_of_measurement: 'bowl' },
      { item_name: 'Sambar', unit_of_measurement: 'bowl' },
      { item_name: 'Karam Podi', unit_of_measurement: 'portion' }
    ];

    this.templateIds = [];
    for (const template of templates) {
      const result = await this.pool.query(`
        INSERT INTO ComplimentaryItemTemplates (business_type_id, item_name, unit_of_measurement)
        VALUES ($1, $2, $3)
        ON CONFLICT (business_type_id, item_name) DO UPDATE SET
          unit_of_measurement = EXCLUDED.unit_of_measurement
        RETURNING template_id
      `, [businessTypeId, template.item_name, template.unit_of_measurement]);
      this.templateIds.push(result.rows[0].template_id);
    }

    // Map complimentary items to representative main inventory items used in dishes
    // We use existing items as proxies for main dishes: Rice and Paneer
    const mainRiceItemId = this.itemIds[6]; // Basmati Rice
    const mainPaneerItemId = this.itemIds[5]; // Paneer

    const mappingPairs = [
      // Rice plates typically go with Sambar and Karam Podi
      { main_item_id: mainRiceItemId, comp_name: 'Sambar', qty: 1.0, uom: 'bowl' },
      { main_item_id: mainRiceItemId, comp_name: 'Karam Podi', qty: 1.0, uom: 'portion' },
      // Paneer-based dishes can be served with Tomato/Groundnut chutney as sides
      { main_item_id: mainPaneerItemId, comp_name: 'Tomato Chutney', qty: 0.5, uom: 'bowl' },
      { main_item_id: mainPaneerItemId, comp_name: 'Groundnut Chutney', qty: 0.5, uom: 'bowl' },
      // Generic pairing for Coconut Chutney
      { main_item_id: mainPaneerItemId, comp_name: 'Coconut Chutney', qty: 0.5, uom: 'bowl' }
    ].filter(m => !!m.main_item_id);

    // Build a name->id map for complimentary items
    const compNameToId = {};
    const compRows = await this.pool.query(`
      SELECT item_id, name FROM InventoryItems WHERE business_id = $1 AND name = ANY($2)
    `, [this.businessId, templates.map(t => t.item_name)]);
    for (const row of compRows.rows) compNameToId[row.name] = row.item_id;

    let mappingsCreated = 0;
    for (const m of mappingPairs) {
      const compId = compNameToId[m.comp_name];
      if (!compId) continue;
      await this.pool.query(`
        INSERT INTO BusinessComplimentaryItems (
          business_id, main_dish_item_id, complimentary_item_id,
          standard_quantity, unit_of_measurement
        )
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (business_id, main_dish_item_id, complimentary_item_id) DO UPDATE SET
          standard_quantity = EXCLUDED.standard_quantity,
          unit_of_measurement = EXCLUDED.unit_of_measurement
      `, [this.businessId, m.main_item_id, compId, m.qty, m.uom]);
      mappingsCreated++;
    }

    console.log(`  ✅ Created ${templates.length} complimentary templates, ${this.complimentaryItemIds.length} complimentary inventory items, and ${mappingsCreated} business mappings`);
  }

  async createReportRegistryAndUserData() {
    console.log('📋 Creating report registry and user data...');

    // Create report registry
    const reports = [
      { report_name: 'Daily Sales Summary', report_code: 'daily_sales', category: 'Sales', description: 'Daily sales performance report', is_visualizable: true },
      { report_name: 'Inventory Status Report', report_code: 'inventory_status', category: 'Inventory', description: 'Current inventory levels and alerts', is_visualizable: true },
      { report_name: 'Vendor Performance Report', report_code: 'vendor_performance', category: 'Vendor', description: 'Vendor delivery and quality metrics', is_visualizable: true },
      { report_name: 'Menu Item Analysis', report_code: 'menu_analysis', category: 'Other', description: 'Menu item popularity and profitability', is_visualizable: true },
      { report_name: 'Wastage Analysis Report', report_code: 'wastage_analysis', category: 'Inventory', description: 'Food wastage patterns and cost analysis', is_visualizable: true },
      { report_name: 'Financial Summary', report_code: 'financial_summary', category: 'Financial', description: 'Revenue, costs, and profit analysis', is_visualizable: true }
    ];

    this.reportIds = [];
    for (const report of reports) {
      const result = await this.pool.query(`
        INSERT INTO ReportRegistry (report_name, report_code, category, description, is_active, is_visualizable)
        VALUES ($1, $2, $3, $4, true, $5)
        ON CONFLICT (report_name) DO UPDATE SET
          report_code = EXCLUDED.report_code,
          category = EXCLUDED.category,
          description = EXCLUDED.description,
          is_visualizable = EXCLUDED.is_visualizable
        RETURNING report_id
      `, [report.report_name, report.report_code, report.category, report.description, report.is_visualizable]);

      this.reportIds.push(result.rows[0].report_id);
    }

    // Create user favorite reports
    const userIds = [this.ownerUserId, this.managerUserId];
    for (const userId of userIds) {
      // Add first 3 reports as favorites for each user
      for (let i = 0; i < 3; i++) {
        await this.pool.query(`
          INSERT INTO UserFavoriteReports (user_id, report_id, business_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (user_id, report_id) DO NOTHING
        `, [userId, this.reportIds[i], this.businessId]);
      }
    }

    // Create report access history
    for (const userId of userIds) {
      for (let i = 0; i < this.reportIds.length; i++) {
        const access_date = new Date();
        access_date.setDate(access_date.getDate() - Math.floor(Math.random() * 30));

        await this.pool.query(`
          INSERT INTO ReportAccessHistory (user_id, report_id, business_id, access_time, action_type)
          VALUES ($1, $2, $3, $4, $5)
        `, [userId, this.reportIds[i], this.businessId, access_date, 'view']);
      }
    }

    console.log(`  ✅ Created ${reports.length} reports and user access data`);
  }

  async createProductionPlanningData() {
    console.log('🏭 Creating production planning data...');

    // Create estimated production plans
    const productionPlans = [
      { menu_item_index: 0, estimated_quantity: 25, report_date: new Date('2024-08-20'), is_confirmed: true },
      { menu_item_index: 1, estimated_quantity: 20, report_date: new Date('2024-08-21'), is_confirmed: true },
      { menu_item_index: 2, estimated_quantity: 50, report_date: new Date('2024-08-22'), is_confirmed: false },
      { menu_item_index: 3, estimated_quantity: 15, report_date: new Date('2024-08-23'), is_confirmed: false },
      { menu_item_index: 4, estimated_quantity: 40, report_date: new Date('2024-08-24'), is_confirmed: true }
    ];

    this.productionPlanIds = [];
    for (const plan of productionPlans) {
      const result = await this.pool.query(`
        INSERT INTO EstimatedProductionPlans (
          business_id, menu_item_id, estimated_quantity, report_date,
          forecasting_method, is_confirmed, confirmed_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (business_id, report_date, menu_item_id) DO UPDATE SET
          estimated_quantity = EXCLUDED.estimated_quantity,
          is_confirmed = EXCLUDED.is_confirmed
        RETURNING plan_id
      `, [
        this.businessId,
        this.menuItemIds[plan.menu_item_index],
        plan.estimated_quantity,
        plan.report_date,
        'Manual',
        plan.is_confirmed,
        this.managerUserId
      ]);

      this.productionPlanIds.push(result.rows[0].plan_id);
    }

    // Create production plan history
    for (let i = 0; i < 5; i++) {
      const history_date = new Date();
      history_date.setDate(history_date.getDate() - (i + 1));

      await this.pool.query(`
        INSERT INTO ProductionPlanHistory (
          business_id, menu_item_id, plan_date, estimated_quantity,
          actual_sales_quantity, actual_waste_quantity, variance_percentage
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        this.businessId,
        this.menuItemIds[i % this.menuItemIds.length],
        history_date,
        20,
        18 + Math.floor(Math.random() * 4), // Actual sales between 18-21
        1 + Math.floor(Math.random() * 2), // Waste between 1-2
        ((18 + Math.floor(Math.random() * 4) - 20) / 20 * 100).toFixed(2)
      ]);
    }

    // Create forecasting model metrics
    for (let i = 0; i < 3; i++) {
      await this.pool.query(`
        INSERT INTO ForecastingModelMetrics (
          business_id, menu_item_id, evaluation_period_start, evaluation_period_end,
          avg_accuracy_percentage, mean_absolute_error, total_predictions, successful_predictions
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        this.businessId,
        this.menuItemIds[i],
        new Date('2024-08-01'),
        new Date('2024-08-31'),
        85.5 + Math.random() * 10, // Accuracy between 85.5% and 95.5%
        2.3 + Math.random() * 2, // MAE between 2.3 and 4.3
        100, // Total predictions
        Math.floor(85 + Math.random() * 10) // Successful predictions 85-95
      ]);
    }

    // Create daily production insights
    for (let i = 0; i < 7; i++) {
      const insight_date = new Date();
      insight_date.setDate(insight_date.getDate() - i);

      await this.pool.query(`
        INSERT INTO DailyProductionInsights (
          business_id, report_date, total_estimated_revenue, total_actual_revenue,
          total_estimated_cost, total_actual_cost, estimated_profit, actual_profit,
          profit_variance_percentage, high_variance_items, suggested_adjustments
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (business_id, report_date) DO UPDATE SET
          total_estimated_revenue = EXCLUDED.total_estimated_revenue,
          total_actual_revenue = EXCLUDED.total_actual_revenue,
          total_estimated_cost = EXCLUDED.total_estimated_cost,
          total_actual_cost = EXCLUDED.total_actual_cost,
          estimated_profit = EXCLUDED.estimated_profit,
          actual_profit = EXCLUDED.actual_profit,
          profit_variance_percentage = EXCLUDED.profit_variance_percentage,
          high_variance_items = EXCLUDED.high_variance_items,
          suggested_adjustments = EXCLUDED.suggested_adjustments
      `, [
        this.businessId,
        insight_date,
        15000.0 + Math.random() * 5000, // Estimated revenue: 15k-20k
        14500.0 + Math.random() * 5500, // Actual revenue: 14.5k-20k
        8000.0 + Math.random() * 2000, // Estimated cost: 8k-10k
        8200.0 + Math.random() * 1800, // Actual cost: 8.2k-10k
        7000.0 + Math.random() * 3000, // Estimated profit: 7k-10k
        6300.0 + Math.random() * 3700, // Actual profit: 6.3k-10k
        Math.random() * 20 - 10, // Variance: -10% to +10%
        JSON.stringify(['Biryani', 'Curry']), // High variance items
        JSON.stringify(['Reduce portions', 'Check recipes']) // Suggestions
      ]);
    }

    console.log(`  ✅ Created production planning data with ${productionPlans.length} plans`);
  }

  async createBusinessSettings() {
    console.log('⚙️ Creating business settings...');

    // Create business settings
    const businessSettings = [
      { setting_key: 'inventory_alert_threshold', setting_value: '10', data_type: 'number', description: 'Low stock alert threshold percentage' },
      { setting_key: 'expiry_alert_days', setting_value: '3', data_type: 'number', description: 'Days before expiry to show alerts' },
      { setting_key: 'currency_symbol', setting_value: '₹', data_type: 'string', description: 'Currency symbol for display' },
      { setting_key: 'tax_rate', setting_value: '18.0', data_type: 'number', description: 'Default GST rate percentage' },
      { setting_key: 'auto_reorder', setting_value: 'false', data_type: 'boolean', description: 'Enable automatic reorder when stock is low' },
      { setting_key: 'working_hours_start', setting_value: '09:00', data_type: 'string', description: 'Business opening time' },
      { setting_key: 'working_hours_end', setting_value: '22:00', data_type: 'string', description: 'Business closing time' }
    ];

    for (const setting of businessSettings) {
      await this.pool.query(`
        INSERT INTO BusinessSettings (business_id, setting_key, setting_value, data_type, description)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (business_id, setting_key) DO UPDATE SET
          setting_value = EXCLUDED.setting_value,
          data_type = EXCLUDED.data_type,
          description = EXCLUDED.description,
          updated_at = CURRENT_TIMESTAMP
      `, [this.businessId, setting.setting_key, setting.setting_value, setting.data_type, setting.description]);
    }

    // Create location settings
    const locationResult = await this.pool.query(`
      SELECT location_id FROM BusinessLocations WHERE business_id = $1 LIMIT 1
    `, [this.businessId]);

    if (locationResult.rows.length > 0) {
      const locationId = locationResult.rows[0].location_id;

      const locationSettings = [
        { setting_key: 'storage_temperature', setting_value: '4', data_type: 'number' },
        { setting_key: 'max_capacity', setting_value: '200', data_type: 'number' },
        { setting_key: 'kitchen_area_sqft', setting_value: '800', data_type: 'number' }
      ];

      for (const setting of locationSettings) {
        await this.pool.query(`
          INSERT INTO LocationSettings (location_id, setting_key, setting_value, data_type)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (location_id, setting_key) DO UPDATE SET
            setting_value = EXCLUDED.setting_value,
            data_type = EXCLUDED.data_type,
            updated_at = CURRENT_TIMESTAMP
        `, [locationId, setting.setting_key, setting.setting_value, setting.data_type]);
      }
    }

    // Create tax rates
    const taxRates = [
      { tax_name: 'CGST', tax_rate: 9.0, tax_type: 'Percentage' },
      { tax_name: 'SGST', tax_rate: 9.0, tax_type: 'Percentage' },
      { tax_name: 'Service Charge', tax_rate: 5.0, tax_type: 'Percentage' }
    ];

    for (const tax of taxRates) {
      await this.pool.query(`
        INSERT INTO TaxRates (business_id, tax_name, rate_percentage, is_active)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (business_id, tax_name) DO UPDATE SET
          rate_percentage = EXCLUDED.rate_percentage
      `, [this.businessId, tax.tax_name, tax.tax_rate]);
    }

    // Create payment methods
    const paymentMethods = [
      { method_name: 'Cash', description: 'Cash payment' },
      { method_name: 'UPI', description: 'UPI payments' },
      { method_name: 'Credit Card', description: 'Credit card payments' },
      { method_name: 'Debit Card', description: 'Debit card payments' }
    ];

    for (const method of paymentMethods) {
      await this.pool.query(`
        INSERT INTO PaymentMethods (business_id, method_name, description, is_active)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (business_id, method_name) DO UPDATE SET
          description = EXCLUDED.description
      `, [this.businessId, method.method_name, method.description]);
    }

    console.log(`  ✅ Created business settings, tax rates, and payment methods`);
  }

  async createSubscriptionPlans() {
    console.log('💳 Creating subscription plans...');

    // Create subscription plans
    const plans = [
      {
        plan_name: 'Basic',
        description: 'Essential features for small restaurants',
        monthly_price: 999.0,
        annual_price: 9990.0,
        max_users: 3,
        max_locations: 1,
        features: ['Basic Inventory', 'Sales Tracking', 'Basic Reports']
      },
      {
        plan_name: 'Professional',
        description: 'Advanced features for growing businesses',
        monthly_price: 1999.0,
        annual_price: 19990.0,
        max_users: 10,
        max_locations: 3,
        features: ['Advanced Inventory', 'Menu Management', 'Advanced Reports', 'Vendor Management']
      },
      {
        plan_name: 'Enterprise',
        description: 'Complete solution for large operations',
        monthly_price: 3999.0,
        annual_price: 39990.0,
        max_users: -1, // Unlimited
        max_locations: -1, // Unlimited
        features: ['All Features', 'Custom Reports', 'API Access', 'Priority Support']
      }
    ];

    this.planIds = [];
    for (const plan of plans) {
      const result = await this.pool.query(`
        INSERT INTO SubscriptionPlans (
          plan_name, description, base_price_monthly, base_price_annually,
          max_users_included, is_active
        )
        VALUES ($1, $2, $3, $4, $5, true)
        ON CONFLICT (plan_name) DO UPDATE SET
          description = EXCLUDED.description,
          base_price_monthly = EXCLUDED.base_price_monthly,
          base_price_annually = EXCLUDED.base_price_annually,
          max_users_included = EXCLUDED.max_users_included
        RETURNING plan_id
      `, [
        plan.plan_name, 
        plan.description, 
        plan.monthly_price, 
        plan.annual_price, 
        plan.max_users > 0 ? plan.max_users : null
      ]);

      this.planIds.push(result.rows[0].plan_id);

      // Create plan features
      for (const feature of plan.features) {
        await this.pool.query(`
          INSERT INTO PlanFeatures (plan_id, feature_name, feature_description, is_active)
          VALUES ($1, $2, $3, true)
          ON CONFLICT (plan_id, feature_name) DO NOTHING
        `, [result.rows[0].plan_id, feature, `${feature} feature for ${plan.plan_name} plan`]);
      }
    }

    // Create business subscription (Professional plan)
    const subscription_start = new Date();
    const subscription_end = new Date();
    subscription_end.setFullYear(subscription_end.getFullYear() + 1); // 1 year from now

    await this.pool.query(`
      INSERT INTO BusinessSubscriptions (
        business_id, plan_id, start_date, end_date,
        billing_cycle, status, current_price
      )
      VALUES ($1, $2, $3, $4, 'Annually', 'Active', 19990.0)
      ON CONFLICT (business_id, plan_id, start_date) DO UPDATE SET
        end_date = EXCLUDED.end_date,
        status = EXCLUDED.status,
        current_price = EXCLUDED.current_price
    `, [this.businessId, this.planIds[1], subscription_start, subscription_end]); // Professional plan

    console.log(`  ✅ Created ${plans.length} subscription plans and business subscription`);
  }

  async createUsageEventsAndProductionTracking() {
    console.log('� Creating usage events and production tracking...');

    // Create usage events
    const usageEvents = [
      {
        menu_item_index: 0,
        event_type: 'Production',
        actual_quantity: 25,
        estimated_quantity: 25,
        production_shift: 'Morning',
        efficiency_percentage: 100.0
      },
      {
        menu_item_index: 1,
        event_type: 'Production',
        actual_quantity: 18,
        estimated_quantity: 20,
        production_shift: 'Morning',
        efficiency_percentage: 90.0
      },
      {
        menu_item_index: 2,
        event_type: 'Sale',
        actual_quantity: 45,
        estimated_quantity: 50,
        production_shift: 'Evening',
        efficiency_percentage: 90.0
      }
    ];

    this.usageEventIds = [];
    for (const event of usageEvents) {
      const result = await this.pool.query(`
        INSERT INTO UsageEvents (
          business_id, production_date, shift, notes, status, 
          created_by_user_id, submitted_by_user_id, submitted_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING event_id
      `, [
        this.businessId,
        new Date('2025-08-20'),
        'Morning',
        'Production batch for menu items',
        'submitted',
        this.ownerUserId,
        this.ownerUserId,
        new Date()
      ]);

      this.usageEventIds.push(result.rows[0].event_id);
    }

    // Create usage items for each event
    for (let i = 0; i < this.usageEventIds.length; i++) {
      const eventId = this.usageEventIds[i];
      const event = usageEvents[i];

      // Add 2-3 ingredients per usage event
      const ingredientCount = 2 + Math.floor(Math.random() * 2);
      for (let j = 0; j < ingredientCount && j < this.itemIds.length; j++) {
        await this.pool.query(`
          INSERT INTO UsageItems (
            event_id, dish_id, quantity_produced, unit, notes
          )
          VALUES ($1, $2, $3, $4, $5)
        `, [
          eventId,
          this.menuItemIds[j % this.menuItemIds.length], // Use menu items, not inventory items
          Math.floor(10 + Math.random() * 20), // Quantity between 10 and 30 (integer)
          'plates',
          `Production record for menu item ${j + 1}`
        ]);
      }
    }

    // Create usage event images
    if (this.scannedImageIds && this.scannedImageIds.length > 0) {
      for (let i = 0; i < Math.min(2, this.usageEventIds.length); i++) {
        await this.pool.query(`
          INSERT INTO UsageEventImages (event_id, image_id, image_type)
          VALUES ($1, $2, 'Production Photo')
        `, [this.usageEventIds[i], this.scannedImageIds[i % this.scannedImageIds.length]]);
      }
    }

    // Create ingredient usage estimations
    for (let i = 0; i < this.menuItemIds.length; i++) {
      for (let j = 0; j < Math.min(3, this.itemIds.length); j++) {
        await this.pool.query(`
          INSERT INTO IngredientUsageEstimations (
            business_id, usage_event_id, dish_id, ingredient_id, 
            quantity_produced, estimated_ingredient_quantity, unit_id,
            production_date, shift, estimated_cost, notes, created_by_user_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `, [
          this.businessId,
          this.usageEventIds[0], // Use first usage event
          this.menuItemIds[i],
          this.itemIds[j],
          10, // quantity_produced
          0.1 + Math.random() * 0.3, // estimated_ingredient_quantity
          this.unitIds[0], // unit_id
          new Date('2025-08-20'), // production_date
          'Morning', // shift
          (0.1 + Math.random() * 0.3) * 50, // estimated_cost
          `Estimated ingredient usage for menu item ${i + 1}`, // notes
          this.ownerUserId // created_by_user_id
        ]);
      }
    }

    console.log(`  ✅ Created ${usageEvents.length} usage events with production tracking`);
  }

  async createSummaryMetrics() {
    console.log('📈 Creating summary metrics...');

    // Create sales summary metrics
    for (let i = 0; i < 7; i++) {
      const report_date = new Date();
      report_date.setDate(report_date.getDate() - i);

      await this.pool.query(`
        INSERT INTO SalesSummaryMetrics (
          business_id, report_date, total_revenue, total_orders,
          average_order_value, top_selling_item_id, generated_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        this.businessId,
        report_date,
        15000 + Math.random() * 10000, // Revenue between 15k-25k
        50 + Math.floor(Math.random() * 30), // Orders between 50-80
        300 + Math.random() * 200, // AOV between 300-500
        this.menuItemIds[Math.floor(Math.random() * this.menuItemIds.length)],
        this.managerUserId
      ]);
    }

    // Create quick reports
    const quickReports = [
      { report_name: 'Daily Sales', report_type: 'Sales', data: '{"total_sales": 22450, "orders": 67}' },
      { report_name: 'Inventory Status', report_type: 'Inventory', data: '{"low_stock_items": 3, "total_items": 15}' },
      { report_name: 'Top Items', report_type: 'Menu', data: '{"top_item": "Paneer Butter Masala", "sales": 25}' },
      { report_name: 'Production Efficiency', report_type: 'Production', data: '{"efficiency": 92.5, "waste": 2.1}' }
    ];

    for (const report of quickReports) {
      await this.pool.query(`
        INSERT INTO QuickReports (
          business_id, report_name, report_type, report_data,
          generated_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5)
      `, [this.businessId, report.report_name, report.report_type, report.data, this.managerUserId]);
    }

    // Create data health metrics
    await this.pool.query(`
      INSERT INTO DataHealthMetrics (
        business_id, total_records, incomplete_records, data_quality_score,
        last_audit_date, generated_by_user_id
      )
      VALUES ($1, $2, $3, $4, CURRENT_DATE, $5)
    `, [
      this.businessId,
      1250, // Total records
      15, // Incomplete records
      94.2, // Data quality score
      this.ownerUserId
    ]);

    console.log(`  ✅ Created sales metrics, quick reports, and data health metrics`);
  }

  async createTestAlerts() {
    console.log('🚨 Creating test alerts...');

    // Create low stock alerts for items that are below reorder point
    const lowStockItems = [
      { item_index: 1, current_quantity: 3.0, threshold_quantity: 10.0 }, // Onions
      { item_index: 3, current_quantity: 400.0, threshold_quantity: 1000.0 } // Red Chili Powder
    ];

    for (const alert of lowStockItems) {
      if (this.itemIds && this.itemIds[alert.item_index]) {
        await this.pool.query(`
          INSERT INTO LowStockAlerts (
            business_id, item_id, current_quantity, threshold_quantity,
            alert_type, status
          )
          VALUES ($1, $2, $3, $4, 'Low Stock', 'open')
        `, [
          this.businessId,
          this.itemIds[alert.item_index],
          alert.current_quantity,
          alert.threshold_quantity
        ]);
      }
    }

    // Create general alerts
    if (this.itemIds && this.itemIds.length >= 4 && this.ownerUserId) {
      await this.pool.query(`
        INSERT INTO Alerts (
          business_id, alert_type, title, description, severity,
          entity_type, entity_id, created_by_user_id
        )
        VALUES
        ($1, 'Stock Alert', 'Low Stock: Onions', 'Onions are running low. Current stock: 3kg, Reorder point: 10kg', 'High', 'InventoryItem', $2, $3),
        ($1, 'Stock Alert', 'Critical Stock: Red Chili Powder', 'Red Chili Powder is critically low. Immediate restocking required.', 'Critical', 'InventoryItem', $4, $3),
        ($1, 'System Update', 'New Feature Available', 'Advanced reporting module is now available for your business.', 'Low', NULL, NULL, NULL)
      `, [this.businessId, this.itemIds[1], this.ownerUserId, this.itemIds[3]]);
    }

    console.log(`  ✅ Created test alerts and low stock alerts`);
  }

  // Connection is managed by the database config module
}

// Export the class for use in other files
module.exports = SeedData;

// Run seed data insertion if this file is executed directly
if (require.main === module) {
  const seeder = new SeedData();
  seeder.insertSeedData()
    .then(() => {
      console.log('✅ Seed data process completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Seed data process failed:', error);
      process.exit(1);
    });
}