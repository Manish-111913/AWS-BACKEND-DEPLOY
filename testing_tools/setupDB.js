const { pool, testConnection } = require('./config/database');

require('dotenv').config();

class DatabaseSetup {
    constructor() {
        this.pool = pool;
    }

    async connectToDatabase() {
        console.log('🔌 Testing database connection...');
        await testConnection();
        const client = await this.pool.connect();
        const result = await client.query('SELECT current_database()');
        console.log(`✅ Connected to database: ${result.rows[0].current_database}`);
        client.release();
    }

    async createTables() {
        console.log('📋 Creating tables...');
        // 1. Authentication & Onboarding Module Tables
        await this.createAuthTables();
        // 2. Dashboard Module Tables
        await this.createDashboardTables();
        // 3. Alerts & Notifications Tables
        await this.createAlertsTables();
        // 4. Inventory Management Tables
        await this.createInventoryTables();
        // 5. Sales Management Tables
        await this.createSalesTables();
        // 6. OCR & Processing Tables
        await this.createOCRTables();
        // 7. Vendor Management Tables
        await this.createVendorTables();
        // 8. Recipe & Menu Management Tables
        await this.createRecipeTables();
        // 9. Usage Events Tables (NEW)
        await this.createUsageEventsTables();
        // 10. Reports Module Tables
        await this.createReportsTables();
        // 11. Settings & User Management Tables
        await this.createSettingsTables();
        // 12. Subscription & Billing Tables
        await this.createSubscriptionTables();
        console.log('✅ All tables created successfully');
    }

    async createAuthTables() {
        console.log('  📂 Creating Authentication & Onboarding tables...');

        // BusinessTypes Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS BusinessTypes (
                type_id SERIAL PRIMARY KEY,
                type_name VARCHAR(100) NOT NULL UNIQUE,
                description TEXT
            );
        `);

        // BillingMachineModels Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS BillingMachineModels (
                billing_model_id SERIAL PRIMARY KEY,
                model_name VARCHAR(100) NOT NULL UNIQUE,
                description TEXT
            );
        `);

        // Languages Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS Languages (
                language_id SERIAL PRIMARY KEY,
                language_name VARCHAR(100) NOT NULL UNIQUE,
                language_code VARCHAR(10) NOT NULL UNIQUE,
                is_active BOOLEAN NOT NULL DEFAULT TRUE
            );
        `);

        // Businesses Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS Businesses (
                business_id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL UNIQUE,
                business_type_id INTEGER NOT NULL REFERENCES BusinessTypes(type_id),
                num_workers INTEGER CHECK (num_workers >= 0),
                business_size VARCHAR(50) NOT NULL,
                billing_model_id INTEGER NOT NULL REFERENCES BillingMachineModels(billing_model_id),
                preferred_language_id INTEGER REFERENCES Languages(language_id),
                is_onboarded BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // Roles Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS Roles (
                role_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                role_name VARCHAR(100) NOT NULL,
                description TEXT,
                is_system_default BOOLEAN NOT NULL DEFAULT FALSE,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(business_id, role_name)
            );
        `);

        // Users Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS Users (
                user_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                email VARCHAR(255) NOT NULL UNIQUE,
                password_hash VARCHAR(255) NOT NULL,
                name VARCHAR(255) NOT NULL,
                phone_number VARCHAR(50),
                role_id INTEGER NOT NULL REFERENCES Roles(role_id),
                location_id INTEGER,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                password_reset_token VARCHAR(255) UNIQUE,
                password_reset_token_expires_at TIMESTAMP,
                two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login_at TIMESTAMP,
                last_active_at TIMESTAMP
            );
        `);

        console.log('  ✅ Authentication & Onboarding tables created');
    }

    async createDashboardTables() {
        console.log('  📊 Creating Dashboard tables...');

        // DashboardWidgets Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS DashboardWidgets (
                widget_id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL UNIQUE,
                description TEXT,
                is_active BOOLEAN DEFAULT TRUE,
                default_order INTEGER,
                widget_icon VARCHAR(50),
                widget_type VARCHAR(20) CHECK (widget_type IN ('Metric', 'Graph', 'List', 'Button'))
            );
        `);

        // UserDashboardPreferences Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS UserDashboardPreferences (
                preference_id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES Users(user_id),
                widget_id INTEGER NOT NULL REFERENCES DashboardWidgets(widget_id),
                display_order INTEGER,
                is_enabled BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, widget_id)
            );
        `);

        // SalesSummaryMetrics Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS SalesSummaryMetrics (
                summary_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                report_period VARCHAR(50) NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                total_sales_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
                total_orders INTEGER NOT NULL DEFAULT 0,
                gross_profit_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
                gross_profit_margin DECIMAL(5,2),
                wastage_cost_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
                trend_indicator VARCHAR(10) CHECK (trend_indicator IN ('Up', 'Down', 'Stable')),
                trend_percentage_change DECIMAL(5,2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(business_id, report_period, start_date, end_date)
            );
        `);

        // UpcomingPaymentsDue Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS UpcomingPaymentsDue (
                payment_due_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                vendor_id INTEGER,
                invoice_number VARCHAR(100),
                amount_due DECIMAL(12,2) NOT NULL CHECK (amount_due > 0),
                due_date DATE NOT NULL,
                status VARCHAR(20) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Paid', 'Overdue')),
                payment_recorded_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('  ✅ Dashboard tables created');
    }

    async createAlertsTables() {
        console.log('  🚨 Creating Alerts & Notifications tables...');

        // Alerts Table (Main alerts table)
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS Alerts (
                alert_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                alert_type VARCHAR(50) NOT NULL CHECK (alert_type IN ('Stock Alert', 'Payment Alert', 'Vendor Alert', 'Wastage Alert', 'System Update', 'Critical Data Alert', 'Other')),
                alert_subtype VARCHAR(100),
                title VARCHAR(255) NOT NULL,
                description TEXT,
                severity VARCHAR(20) NOT NULL CHECK (severity IN ('Low', 'Medium', 'High', 'Critical')),
                entity_type VARCHAR(100),
                entity_id INTEGER,
                is_read BOOLEAN NOT NULL DEFAULT FALSE,
                is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
                is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                read_at TIMESTAMP,
                dismissed_at TIMESTAMP,
                resolved_at TIMESTAMP,
                created_by_user_id INTEGER REFERENCES Users(user_id),
                resolved_by_user_id INTEGER REFERENCES Users(user_id)
            );
        `);

        // LowStockAlerts Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS LowStockAlerts (
                alert_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                item_id INTEGER,
                current_quantity DECIMAL(10,2) NOT NULL,
                threshold_quantity DECIMAL(10,2) NOT NULL,
                status VARCHAR(20) DEFAULT 'open',
                alert_type VARCHAR(20) CHECK (alert_type IN ('Low Stock', 'Near Expiry')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolved_at TIMESTAMP,
                resolved_by_user_id INTEGER REFERENCES Users(user_id)
            );
        `);

        console.log('  ✅ Alerts & Notifications tables created');
    }

    async createInventoryTables() {
        console.log('  📦 Creating Inventory Management tables...');

        // GlobalUnits Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS GlobalUnits (
                unit_id SERIAL PRIMARY KEY,
                unit_name VARCHAR(50) NOT NULL UNIQUE,
                unit_symbol VARCHAR(10),
                unit_type VARCHAR(50),
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                is_system_defined BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // BusinessUnitConversions Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS BusinessUnitConversions (
                conversion_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                from_unit_id INTEGER NOT NULL REFERENCES GlobalUnits(unit_id),
                to_unit_id INTEGER NOT NULL REFERENCES GlobalUnits(unit_id),
                conversion_factor DECIMAL(10, 6) NOT NULL CHECK (conversion_factor > 0),
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(business_id, from_unit_id, to_unit_id)
            );
        `);

        // InventoryCategories Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS InventoryCategories (
                category_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                name VARCHAR(100) NOT NULL,
                parent_category_id INTEGER REFERENCES InventoryCategories(category_id),
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(business_id, name)
            );
        `);

        // WastageReasons Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS WastageReasons (
                reason_id SERIAL PRIMARY KEY,
                business_id INTEGER REFERENCES Businesses(business_id),
                reason_label VARCHAR(100) NOT NULL,
                reason_category VARCHAR(50) CHECK (reason_category IN ('Ingredient Waste', 'Dish Waste', 'General Waste')),
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // InventoryItems Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS InventoryItems (
                item_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                name VARCHAR(255) NOT NULL,
                category_id INTEGER REFERENCES InventoryCategories(category_id),
                standard_unit_id INTEGER NOT NULL REFERENCES GlobalUnits(unit_id),
                reorder_point DECIMAL(10,2),
                safety_stock DECIMAL(10,2),
                default_vendor_id INTEGER,
                track_expiry BOOLEAN DEFAULT FALSE,
                shelf_life_days INTEGER,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(business_id, name)
            );
        `);

        // InventoryBatches Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS InventoryBatches (
                batch_id SERIAL PRIMARY KEY,
                item_id INTEGER NOT NULL REFERENCES InventoryItems(item_id),
                quantity DECIMAL(10,2) NOT NULL CHECK (quantity >= 0),
                unit_cost DECIMAL(10,2) NOT NULL CHECK (unit_cost >= 0),
                expiry_date DATE,
                manufacturing_date DATE,
                received_date DATE NOT NULL,
                vendor_id INTEGER,
                invoice_reference VARCHAR(100),
                is_expired BOOLEAN DEFAULT FALSE,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // StockInRecords Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS StockInRecords (
                stock_in_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                received_by_user_id INTEGER REFERENCES Users(user_id),
                received_date DATE NOT NULL,
                vendor_id INTEGER,
                total_cost DECIMAL(12,2),
                status VARCHAR(20) DEFAULT 'Submitted' CHECK (status IN ('Draft', 'Submitted', 'Processing')),
                scanned_image_id INTEGER,
                bill_date DATE,
                supplier_name_from_bill VARCHAR(255),
                entry_method VARCHAR(20) NOT NULL CHECK (entry_method IN ('Scan Bill', 'Manual Entry', 'Upload Image')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // StockInLineItems Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS StockInLineItems (
                line_item_id SERIAL PRIMARY KEY,
                stock_in_id INTEGER NOT NULL REFERENCES StockInRecords(stock_in_id),
                item_id INTEGER REFERENCES InventoryItems(item_id),
                raw_item_name_extracted VARCHAR(255) NOT NULL,
                quantity DECIMAL(10,2) NOT NULL CHECK (quantity > 0),
                unit_cost DECIMAL(10,2) NOT NULL CHECK (unit_cost >= 0),
                expiry_date DATE,
                batch_id INTEGER REFERENCES InventoryBatches(batch_id),
                received_unit_id INTEGER NOT NULL REFERENCES GlobalUnits(unit_id),
                is_mapped_to_inventory BOOLEAN DEFAULT FALSE,
                discrepancy_flag BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // StockOutRecords Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS StockOutRecords (
                stock_out_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                item_id INTEGER NOT NULL,
                item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('InventoryItem', 'MenuItem')),
                quantity DECIMAL(10,2) NOT NULL CHECK (quantity > 0),
                unit_id INTEGER NOT NULL REFERENCES GlobalUnits(unit_id),
                reason_type VARCHAR(10) NOT NULL CHECK (reason_type IN ('Usage', 'Waste')),
                waste_reason_id INTEGER REFERENCES WastageReasons(reason_id),
                notes TEXT,
                deducted_by_user_id INTEGER REFERENCES Users(user_id),
                deducted_date TIMESTAMP NOT NULL,
                production_date DATE,
                shift VARCHAR(50),
                estimated_cost_impact DECIMAL(12,2),
                status VARCHAR(20) DEFAULT 'Confirmed' CHECK (status IN ('Draft', 'Confirmed')),
                image_id INTEGER,
                usage_event_id UUID,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('  ✅ Inventory Management tables created');
    }

    async createSalesTables() {
        console.log('  💰 Creating Sales Management tables...');

        // SalesTransactions Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS SalesTransactions (
                sale_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                transaction_date DATE NOT NULL,
                transaction_time TIME,
                total_amount DECIMAL(12,2) NOT NULL CHECK (total_amount >= 0),
                discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                tax_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
                payment_method VARCHAR(50),
                scanned_image_id INTEGER,
                processed_by_user_id INTEGER REFERENCES Users(user_id),
                status VARCHAR(20) DEFAULT 'Pending Review' CHECK (status IN ('Pending Review', 'Confirmed', 'Deducted', 'Error')),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // SaleLineItems Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS SaleLineItems (
                sale_line_item_id SERIAL PRIMARY KEY,
                sale_id INTEGER NOT NULL REFERENCES SalesTransactions(sale_id),
                menu_item_id INTEGER,
                quantity_sold DECIMAL(10,2) NOT NULL CHECK (quantity_sold > 0),
                unit_price DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
                line_item_amount DECIMAL(10,2) NOT NULL CHECK (line_item_amount >= 0),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // SalesDeductionSummaries Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS SalesDeductionSummaries (
                deduction_summary_id SERIAL PRIMARY KEY,
                sale_id INTEGER NOT NULL REFERENCES SalesTransactions(sale_id),
                item_id INTEGER NOT NULL REFERENCES InventoryItems(item_id),
                quantity_before DECIMAL(10,2) NOT NULL,
                quantity_deducted DECIMAL(10,2) NOT NULL CHECK (quantity_deducted >= 0),
                quantity_after DECIMAL(10,2) NOT NULL,
                stock_status_after VARCHAR(50),
                deduction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('  ✅ Sales Management tables created');
    }

    async createOCRTables() {
        console.log('  📄 Creating OCR & Processing tables...');

        // ScannedImages Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS ScannedImages (
                image_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                file_url VARCHAR(255) NOT NULL,
                file_path VARCHAR(500),
                thumbnail_url VARCHAR(255),
                upload_date TIMESTAMP NOT NULL,
                scan_type VARCHAR(20) NOT NULL CHECK (scan_type IN ('Sales Report', 'Vendor Bill', 'Menu', 'Menu Item', 'Stock Out', 'Usage Event', 'Other')),
                uploaded_by_user_id INTEGER REFERENCES Users(user_id),
                status VARCHAR(20) DEFAULT 'Uploaded' CHECK (status IN ('Pending OCR', 'OCR Processed', 'Ready for Review', 'Reviewed', 'Uploaded', 'Error')),
                file_size INTEGER,
                mime_type VARCHAR(100),
                alt_text VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // ExtractedSalesReports Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS ExtractedSalesReports (
                extracted_report_id SERIAL PRIMARY KEY,
                scanned_image_id INTEGER NOT NULL REFERENCES ScannedImages(image_id),
                extracted_date DATE,
                extracted_total_amount DECIMAL(12,2),
                extracted_total_orders INTEGER,
                is_reviewed BOOLEAN DEFAULT FALSE,
                is_confirmed BOOLEAN DEFAULT FALSE,
                confirmed_by_user_id INTEGER REFERENCES Users(user_id),
                confirmed_at TIMESTAMP,
                linked_sale_id INTEGER REFERENCES SalesTransactions(sale_id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // ExtractedSalesLineItems Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS ExtractedSalesLineItems (
                extracted_line_id SERIAL PRIMARY KEY,
                extracted_report_id INTEGER NOT NULL REFERENCES ExtractedSalesReports(extracted_report_id),
                line_number INTEGER NOT NULL,
                raw_item_name VARCHAR(255) NOT NULL,
                raw_quantity DECIMAL(10,2),
                raw_amount DECIMAL(10,2),
                mapped_menu_item_id INTEGER,
                mapped_quantity DECIMAL(10,2),
                mapped_amount DECIMAL(10,2),
                is_mapped BOOLEAN DEFAULT FALSE,
                has_discrepancy BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // OCRProcessingLogs Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS OCRProcessingLogs (
                log_id SERIAL PRIMARY KEY,
                scanned_image_id INTEGER NOT NULL REFERENCES ScannedImages(image_id),
                processing_stage VARCHAR(50) NOT NULL,
                status VARCHAR(20) NOT NULL CHECK (status IN ('Started', 'In Progress', 'Completed', 'Failed')),
                error_message TEXT,
                processing_time_seconds DECIMAL(10,2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('  ✅ OCR & Processing tables created');
    }

    async createVendorTables() {
        console.log('  🏪 Creating Vendor Management tables...');

        // Vendors Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS Vendors (
                vendor_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                name VARCHAR(255) NOT NULL,
                description TEXT,
                contact_phone VARCHAR(50),
                contact_email VARCHAR(255),
                contact_whatsapp VARCHAR(50),
                address TEXT,
                average_rating DECIMAL(3,1) CHECK (average_rating >= 0 AND average_rating <= 5),
                on_time_delivery_rate DECIMAL(5,2) CHECK (on_time_delivery_rate >= 0 AND on_time_delivery_rate <= 100),
                quality_score DECIMAL(5,2) CHECK (quality_score >= 0 AND quality_score <= 100),
                last_order_date DATE,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(business_id, name)
            );
        `);

        // PurchaseOrders Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS PurchaseOrders (
                po_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                vendor_id INTEGER NOT NULL REFERENCES Vendors(vendor_id),
                order_date DATE NOT NULL,
                expected_delivery_date DATE,
                status VARCHAR(20) DEFAULT 'Draft' CHECK (status IN ('Draft', 'Pending', 'Sent', 'Received', 'Cancelled', 'Partially Received')),
                created_by_user_id INTEGER NOT NULL REFERENCES Users(user_id),
                special_instructions TEXT,
                total_amount DECIMAL(12,2),
                total_items INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // PurchaseOrderLineItems Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS PurchaseOrderLineItems (
                po_line_item_id SERIAL PRIMARY KEY,
                po_id INTEGER NOT NULL REFERENCES PurchaseOrders(po_id),
                item_id INTEGER NOT NULL REFERENCES InventoryItems(item_id),
                quantity_ordered DECIMAL(10,2) NOT NULL CHECK (quantity_ordered > 0),
                unit_id INTEGER NOT NULL REFERENCES GlobalUnits(unit_id),
                unit_price DECIMAL(10,2) CHECK (unit_price >= 0),
                total_line_amount DECIMAL(12,2),
                quantity_received DECIMAL(10,2) DEFAULT 0.00,
                is_fulfilled BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('  ✅ Vendor Management tables created');
    }

    async createRecipeTables() {
        console.log('  👨‍🍳 Creating Recipe & Menu Management tables...');

        // MenuCategories Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS MenuCategories (
                category_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                name VARCHAR(100) NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(business_id, name)
            );
        `);

        // MenuItems Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS MenuItems (
                menu_item_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                name VARCHAR(255) NOT NULL,
                category_id INTEGER REFERENCES MenuCategories(category_id),
                price DECIMAL(10,2) NOT NULL CHECK (price >= 0),
                servings_per_batch DECIMAL(10,2) NOT NULL DEFAULT 1,
                serving_unit_id INTEGER NOT NULL REFERENCES GlobalUnits(unit_id),
                image_url VARCHAR(255),
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(business_id, name)
            );
        `);

        // Recipes Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS Recipes (
                recipe_id INTEGER PRIMARY KEY REFERENCES MenuItems(menu_item_id),
                instructions TEXT,
                estimated_cost DECIMAL(10,2),
                prep_time_minutes INTEGER,
                cook_time_minutes INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // RecipeIngredients Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS RecipeIngredients (
                recipe_ingredient_id SERIAL PRIMARY KEY,
                recipe_id INTEGER NOT NULL REFERENCES Recipes(recipe_id),
                item_id INTEGER NOT NULL REFERENCES InventoryItems(item_id),
                quantity DECIMAL(10,4) NOT NULL CHECK (quantity >= 0),
                unit_id INTEGER NOT NULL REFERENCES GlobalUnits(unit_id),
                notes VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(recipe_id, item_id)
            );
        `);

        console.log('  ✅ Recipe & Menu Management tables created');
    }

    async createUsageEventsTables() {
        console.log('  🍽️ Creating Usage Events tables...');

        // UsageEvents Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS UsageEvents (
                event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                production_date DATE NOT NULL,
                shift VARCHAR(255) NOT NULL,
                notes TEXT,
                status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
                created_by_user_id INTEGER REFERENCES Users(user_id),
                submitted_by_user_id INTEGER REFERENCES Users(user_id),
                submitted_at TIMESTAMP,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // UsageItems Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS UsageItems (
                usage_item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                event_id UUID NOT NULL REFERENCES UsageEvents(event_id) ON DELETE CASCADE,
                dish_id INTEGER NOT NULL REFERENCES MenuItems(menu_item_id),
                quantity_produced INTEGER NOT NULL CHECK (quantity_produced > 0),
                unit VARCHAR(255) NOT NULL,
                notes TEXT,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // UsageEventImages Table (for linking images to usage events)
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS UsageEventImages (
                usage_image_id SERIAL PRIMARY KEY,
                event_id UUID NOT NULL REFERENCES UsageEvents(event_id) ON DELETE CASCADE,
                image_id INTEGER NOT NULL REFERENCES ScannedImages(image_id),
                image_type VARCHAR(50) DEFAULT 'Production Evidence',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('  ✅ Usage Events tables created');
    }

    async createReportsTables() {
        console.log('  📊 Creating Reports Module tables...');

        // ReportRegistry Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS ReportRegistry (
                report_id SERIAL PRIMARY KEY,
                report_name VARCHAR(150) NOT NULL UNIQUE,
                report_code VARCHAR(100) NOT NULL UNIQUE,
                category VARCHAR(20) NOT NULL CHECK (category IN ('Sales', 'Inventory', 'Wastage', 'Vendor', 'Financial', 'Data Health', 'Production', 'Other')),
                description TEXT,
                is_active BOOLEAN DEFAULT TRUE,
                is_visualizable BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // UserReportFavorites Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS UserReportFavorites (
                fav_id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES Users(user_id),
                report_id INTEGER NOT NULL REFERENCES ReportRegistry(report_id),
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                marked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, report_id, business_id)
            );
        `);

        // ReportAccessLogs Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS ReportAccessLogs (
                access_id SERIAL PRIMARY KEY,
                report_id INTEGER NOT NULL REFERENCES ReportRegistry(report_id),
                user_id INTEGER NOT NULL REFERENCES Users(user_id),
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                access_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                action_type VARCHAR(20) NOT NULL CHECK (action_type IN ('View', 'Export', 'Search', 'Filter Applied', 'Share')),
                filter_params JSON
            );
        `);

        // DataHealthMetrics Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS DataHealthMetrics (
                metric_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                module_name VARCHAR(100) NOT NULL,
                report_period VARCHAR(50) NOT NULL,
                start_date DATE NOT NULL,
                end_date DATE NOT NULL,
                accuracy_percentage DECIMAL(5,2) CHECK (accuracy_percentage >= 0 AND accuracy_percentage <= 100),
                health_status VARCHAR(20) CHECK (health_status IN ('Excellent', 'Good', 'Fair', 'Poor', 'Critical')),
                total_issues_found INTEGER NOT NULL DEFAULT 0,
                last_checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(business_id, module_name, report_period, start_date, end_date)
            );
        `);

        console.log('  ✅ Reports Module tables created');
    }

    async createSettingsTables() {
        console.log('  ⚙️ Creating Settings & User Management tables...');

        // Permissions Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS Permissions (
                permission_id SERIAL PRIMARY KEY,
                permission_name VARCHAR(100) NOT NULL UNIQUE,
                module_name VARCHAR(100) NOT NULL,
                description TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE
            );
        `);

        // RolePermissions Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS RolePermissions (
                role_id INTEGER REFERENCES Roles(role_id),
                permission_id INTEGER REFERENCES Permissions(permission_id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(role_id, permission_id)
            );
        `);

        // BusinessLocations Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS BusinessLocations (
                location_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                name VARCHAR(255) NOT NULL,
                address_street VARCHAR(255),
                address_city VARCHAR(100),
                address_state VARCHAR(100),
                address_zip_code VARCHAR(20),
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(business_id, name)
            );
        `);

        // BusinessSettings Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS BusinessSettings (
                setting_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                setting_key VARCHAR(100) NOT NULL,
                setting_value TEXT,
                data_type VARCHAR(20) NOT NULL CHECK (data_type IN ('string', 'boolean', 'number', 'json')),
                module_scope VARCHAR(50),
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(business_id, setting_key)
            );
        `);

        // UserInvitations Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS UserInvitations (
                invitation_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                invited_by_user_id INTEGER NOT NULL REFERENCES Users(user_id),
                invited_name VARCHAR(255) NOT NULL,
                invited_email VARCHAR(255) NOT NULL,
                invited_phone VARCHAR(50),
                invited_role_id INTEGER NOT NULL REFERENCES Roles(role_id),
                invitation_token VARCHAR(255) NOT NULL UNIQUE,
                expires_at TIMESTAMP NOT NULL,
                status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Accepted', 'Expired', 'Cancelled')),
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                accepted_at TIMESTAMP
            );
        `);

        // TaxRates Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS TaxRates (
                tax_rate_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                tax_name VARCHAR(100) NOT NULL,
                rate_percentage DECIMAL(5,2) NOT NULL CHECK (rate_percentage >= 0),
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                applies_to_category_id INTEGER REFERENCES MenuCategories(category_id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(business_id, tax_name)
            );
        `);

        // PaymentMethods Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS PaymentMethods (
                payment_method_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                method_name VARCHAR(100) NOT NULL,
                description TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(business_id, method_name)
            );
        `);

        console.log('  ✅ Settings & User Management tables created');
    }

    async createSubscriptionTables() {
        console.log('  💳 Creating Subscription & Billing tables...');

        // SubscriptionPlans Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS SubscriptionPlans (
                plan_id SERIAL PRIMARY KEY,
                plan_name VARCHAR(100) NOT NULL UNIQUE,
                description TEXT,
                base_price_monthly DECIMAL(10,2) NOT NULL CHECK (base_price_monthly >= 0),
                base_price_annually DECIMAL(10,2) CHECK (base_price_annually >= 0),
                max_users_included INTEGER,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                is_recommended BOOLEAN DEFAULT FALSE,
                is_most_popular BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        // PlanFeatures Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS PlanFeatures (
                feature_id SERIAL PRIMARY KEY,
                plan_id INTEGER NOT NULL REFERENCES SubscriptionPlans(plan_id),
                feature_name VARCHAR(255) NOT NULL,
                feature_description TEXT,
                is_active BOOLEAN NOT NULL DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(plan_id, feature_name)
            );
        `);

        // BusinessSubscriptions Table
        await this.pool.query(`
            CREATE TABLE IF NOT EXISTS BusinessSubscriptions (
                subscription_id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES Businesses(business_id),
                plan_id INTEGER NOT NULL REFERENCES SubscriptionPlans(plan_id),
                start_date DATE NOT NULL,
                end_date DATE,
                billing_cycle VARCHAR(20) NOT NULL CHECK (billing_cycle IN ('Monthly', 'Annually')),
                current_price DECIMAL(10,2) NOT NULL CHECK (current_price >= 0),
                status VARCHAR(20) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Trial', 'Expired', 'Cancelled', 'Paused')),
                last_billed_date DATE,
                next_billing_date DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        console.log('  ✅ Subscription & Billing tables created');
    }

    async addForeignKeyConstraints() {
        console.log('🔗 Adding foreign key constraints...');

        try {
            // Add foreign key constraints that couldn't be added during table creation
            await this.pool.query(`
                ALTER TABLE UpcomingPaymentsDue
                ADD CONSTRAINT fk_upcoming_payments_vendor
                FOREIGN KEY (vendor_id) REFERENCES Vendors(vendor_id)
            `);

            await this.pool.query(`
                ALTER TABLE LowStockAlerts
                ADD CONSTRAINT fk_low_stock_alerts_item
                FOREIGN KEY (item_id) REFERENCES InventoryItems(item_id)
            `);

            await this.pool.query(`
                ALTER TABLE InventoryItems
                ADD CONSTRAINT fk_inventory_items_vendor
                FOREIGN KEY (default_vendor_id) REFERENCES Vendors(vendor_id)
            `);

            await this.pool.query(`
                ALTER TABLE InventoryBatches
                ADD CONSTRAINT fk_inventory_batches_vendor
                FOREIGN KEY (vendor_id) REFERENCES Vendors(vendor_id)
            `);

            await this.pool.query(`
                ALTER TABLE StockInRecords
                ADD CONSTRAINT fk_stock_in_records_vendor
                FOREIGN KEY (vendor_id) REFERENCES Vendors(vendor_id)
            `);

            await this.pool.query(`
                ALTER TABLE StockInRecords
                ADD CONSTRAINT fk_stock_in_records_image
                FOREIGN KEY (scanned_image_id) REFERENCES ScannedImages(image_id)
            `);

            await this.pool.query(`
                ALTER TABLE SalesTransactions
                ADD CONSTRAINT fk_sales_transactions_image
                FOREIGN KEY (scanned_image_id) REFERENCES ScannedImages(image_id)
            `);

            await this.pool.query(`
                ALTER TABLE SaleLineItems
                ADD CONSTRAINT fk_sale_line_items_menu_item
                FOREIGN KEY (menu_item_id) REFERENCES MenuItems(menu_item_id)
            `);

            await this.pool.query(`
                ALTER TABLE ExtractedSalesLineItems
                ADD CONSTRAINT fk_extracted_sales_line_items_menu_item
                FOREIGN KEY (mapped_menu_item_id) REFERENCES MenuItems(menu_item_id)
            `);

            // Add the Users location constraint
            await this.pool.query(`
                ALTER TABLE Users
                ADD CONSTRAINT fk_users_location
                FOREIGN KEY (location_id) REFERENCES BusinessLocations(location_id)
            `);

            // Add StockOutRecords image constraint
            await this.pool.query(`
                ALTER TABLE StockOutRecords
                ADD CONSTRAINT fk_stock_out_records_image
                FOREIGN KEY (image_id) REFERENCES ScannedImages(image_id)
            `);

            // Add StockOutRecords usage event constraint (NEW)
            await this.pool.query(`
                ALTER TABLE StockOutRecords
                ADD CONSTRAINT fk_stock_out_records_usage_event
                FOREIGN KEY (usage_event_id) REFERENCES UsageEvents(event_id)
            `);

            console.log('✅ Foreign key constraints added');
        } catch (error) {
            console.error('Error adding foreign key constraints:', error.message);
            console.log('⚠️ Some foreign key constraints may not have been added, but setup will continue');
        }
    }

    async createIndexes() {
        console.log('📊 Creating indexes...');

        // Performance indexes
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_businesses_type ON Businesses(business_type_id)',
            'CREATE INDEX IF NOT EXISTS idx_users_business ON Users(business_id)',
            'CREATE INDEX IF NOT EXISTS idx_users_email ON Users(email)',
            'CREATE INDEX IF NOT EXISTS idx_inventory_items_business ON InventoryItems(business_id)',
            'CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON InventoryItems(category_id)',
            'CREATE INDEX IF NOT EXISTS idx_inventory_items_active ON InventoryItems(is_active)',
            'CREATE INDEX IF NOT EXISTS idx_inventory_batches_item ON InventoryBatches(item_id)',
            'CREATE INDEX IF NOT EXISTS idx_inventory_batches_expiry ON InventoryBatches(expiry_date)',
            'CREATE INDEX IF NOT EXISTS idx_inventory_batches_active ON InventoryBatches(is_active)',
            'CREATE INDEX IF NOT EXISTS idx_inventory_categories_business ON InventoryCategories(business_id)',
            'CREATE INDEX IF NOT EXISTS idx_inventory_categories_active ON InventoryCategories(is_active)',
            'CREATE INDEX IF NOT EXISTS idx_wastage_reasons_business ON WastageReasons(business_id)',
            'CREATE INDEX IF NOT EXISTS idx_wastage_reasons_active ON WastageReasons(is_active)',
            'CREATE INDEX IF NOT EXISTS idx_stock_in_records_business ON StockInRecords(business_id)',
            'CREATE INDEX IF NOT EXISTS idx_stock_in_records_date ON StockInRecords(received_date)',
            'CREATE INDEX IF NOT EXISTS idx_stock_out_records_business ON StockOutRecords(business_id)',
            'CREATE INDEX IF NOT EXISTS idx_stock_out_records_date ON StockOutRecords(deducted_date)',
            'CREATE INDEX IF NOT EXISTS idx_stock_out_records_item ON StockOutRecords(item_id, item_type)',
            'CREATE INDEX IF NOT EXISTS idx_stock_out_records_usage_event ON StockOutRecords(usage_event_id)',
            'CREATE INDEX IF NOT EXISTS idx_sales_transactions_business ON SalesTransactions(business_id)',
            'CREATE INDEX IF NOT EXISTS idx_sales_transactions_date ON SalesTransactions(transaction_date)',
            'CREATE INDEX IF NOT EXISTS idx_menu_items_business ON MenuItems(business_id)',
            'CREATE INDEX IF NOT EXISTS idx_menu_items_category ON MenuItems(category_id)',
            'CREATE INDEX IF NOT EXISTS idx_menu_items_active ON MenuItems(is_active)',
            'CREATE INDEX IF NOT EXISTS idx_vendors_business ON Vendors(business_id)',
            'CREATE INDEX IF NOT EXISTS idx_alerts_business ON Alerts(business_id)',
            'CREATE INDEX IF NOT EXISTS idx_alerts_type ON Alerts(alert_type)',
            'CREATE INDEX IF NOT EXISTS idx_alerts_severity ON Alerts(severity)',
            'CREATE INDEX IF NOT EXISTS idx_scanned_images_business ON ScannedImages(business_id)',
            'CREATE INDEX IF NOT EXISTS idx_scanned_images_type ON ScannedImages(scan_type)',
            'CREATE INDEX IF NOT EXISTS idx_scanned_images_status ON ScannedImages(status)',
            // NEW: Usage Events indexes
            'CREATE INDEX IF NOT EXISTS idx_usage_events_business ON UsageEvents(business_id)',
            'CREATE INDEX IF NOT EXISTS idx_usage_events_date ON UsageEvents(production_date)',
            'CREATE INDEX IF NOT EXISTS idx_usage_events_status ON UsageEvents(status)',
            'CREATE INDEX IF NOT EXISTS idx_usage_events_shift ON UsageEvents(shift)',
            'CREATE INDEX IF NOT EXISTS idx_usage_items_event ON UsageItems(event_id)',
            'CREATE INDEX IF NOT EXISTS idx_usage_items_dish ON UsageItems(dish_id)',
            'CREATE INDEX IF NOT EXISTS idx_usage_event_images_event ON UsageEventImages(event_id)',
            'CREATE INDEX IF NOT EXISTS idx_usage_event_images_image ON UsageEventImages(image_id)'
        ];

        for (const indexQuery of indexes) {
            try {
                await this.pool.query(indexQuery);
            } catch (error) {
                console.error(`Error creating index: ${error.message}`);
            }
        }

        console.log('✅ Indexes created');
    }

    async createViews() {
        console.log('👁️ Creating views...');

        // Current Stock Summary View
        await this.pool.query(`
            CREATE OR REPLACE VIEW CurrentStockSummary AS
            SELECT
                ii.item_id,
                ii.business_id,
                ii.name as item_name,
                ii.standard_unit_id,
                gu.unit_name,
                COALESCE(SUM(ib.quantity), 0) as total_quantity,
                ii.reorder_point,
                ii.safety_stock,
                CASE
                    WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0) THEN 'Low Stock'
                    WHEN COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0) THEN 'Critical'
                    ELSE 'Sufficient'
                END as stock_status
            FROM InventoryItems ii
            LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id
                AND ib.quantity > 0
                AND ib.is_active = true
            LEFT JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
            WHERE ii.is_active = true
            GROUP BY ii.item_id, ii.business_id, ii.name, ii.standard_unit_id, gu.unit_name, ii.reorder_point, ii.safety_stock
        `);

        // Stock In Summary View
        await this.pool.query(`
            CREATE OR REPLACE VIEW StockInSummary AS
            SELECT
                sir.stock_in_id,
                sir.business_id,
                sir.received_date,
                v.name as vendor_name,
                sir.total_cost,
                sir.status,
                COUNT(sil.line_item_id) as total_line_items,
                SUM(sil.quantity) as total_quantity
            FROM StockInRecords sir
            LEFT JOIN Vendors v ON sir.vendor_id = v.vendor_id
            LEFT JOIN StockInLineItems sil ON sir.stock_in_id = sil.stock_in_id
            GROUP BY sir.stock_in_id, sir.business_id, sir.received_date, v.name, sir.total_cost, sir.status
        `);

        // Menu Items With Images View
        await this.pool.query(`
            CREATE OR REPLACE VIEW MenuItemsWithImages AS
            SELECT
                mi.menu_item_id,
                mi.business_id,
                mi.name,
                mi.price,
                mi.image_url,
                mi.is_active,
                mc.name as category_name,
                si.image_id,
                si.thumbnail_url,
                si.alt_text,
                si.file_size,
                si.mime_type
            FROM MenuItems mi
            LEFT JOIN MenuCategories mc ON mi.category_id = mc.category_id
            LEFT JOIN ScannedImages si ON mi.image_url = si.file_url AND si.scan_type = 'Menu Item'
            WHERE mi.is_active = true
        `);

        // NEW: Usage Events Summary View
        await this.pool.query(`
            CREATE OR REPLACE VIEW UsageEventsSummary AS
            SELECT
                ue.event_id,
                ue.business_id,
                ue.production_date,
                ue.shift,
                ue.status,
                ue.created_by_user_id,
                u.name as created_by_name,
                COUNT(ui.usage_item_id) as total_dishes,
                SUM(ui.quantity_produced) as total_quantity_produced,
                COUNT(uei.image_id) as total_images,
                ue.created_at,
                ue.submitted_at
            FROM UsageEvents ue
            LEFT JOIN Users u ON ue.created_by_user_id = u.user_id
            LEFT JOIN UsageItems ui ON ue.event_id = ui.event_id
            LEFT JOIN UsageEventImages uei ON ue.event_id = uei.event_id
            GROUP BY ue.event_id, ue.business_id, ue.production_date, ue.shift, ue.status, 
                     ue.created_by_user_id, u.name, ue.created_at, ue.submitted_at
        `);

        // NEW: Production Summary View
        await this.pool.query(`
            CREATE OR REPLACE VIEW ProductionSummary AS
            SELECT
                ui.event_id,
                ui.dish_id,
                mi.name as dish_name,
                mi.price as dish_price,
                ui.quantity_produced,
                ui.unit,
                (ui.quantity_produced * mi.price) as estimated_revenue,
                ue.production_date,
                ue.shift,
                ue.business_id
            FROM UsageItems ui
            JOIN UsageEvents ue ON ui.event_id = ue.event_id
            JOIN MenuItems mi ON ui.dish_id = mi.menu_item_id
            WHERE ue.status = 'submitted'
        `);

        console.log('✅ Views created');
    }

    async createTriggers() {
        console.log('⚡ Creating triggers...');

        // Trigger to update updated_at timestamp
        await this.pool.query(`
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ language 'plpgsql'
        `);

        const tablesWithUpdatedAt = [
            'Businesses', 'Users', 'InventoryItems', 'InventoryBatches', 'StockInRecords',
            'StockInLineItems', 'StockOutRecords', 'SalesTransactions', 'SaleLineItems',
            'Vendors', 'PurchaseOrders', 'PurchaseOrderLineItems', 'MenuItems', 'Recipes',
            'RecipeIngredients', 'ScannedImages', 'ExtractedSalesReports', 'ExtractedSalesLineItems',
            'BusinessSettings', 'BusinessLocations', 'SubscriptionPlans', 'BusinessSubscriptions',
            'UserDashboardPreferences', 'DataHealthMetrics', 'BusinessUnitConversions',
            'InventoryCategories', 'WastageReasons', 'UsageEvents', 'UsageItems' // ADDED: Usage Events tables
        ];

        for (const table of tablesWithUpdatedAt) {
            try {
                await this.pool.query(`
                    CREATE TRIGGER update_${table.toLowerCase()}_updated_at
                    BEFORE UPDATE ON ${table}
                    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
                `);
            } catch (error) {
                // Ignore if trigger already exists
            }
        }

        // NEW: Trigger for automatic stock deduction when usage events are submitted
        await this.pool.query(`
            CREATE OR REPLACE FUNCTION process_usage_event_submission()
            RETURNS TRIGGER AS $$
            DECLARE
                usage_item RECORD;
                recipe_ingredient RECORD;
                total_ingredient_needed DECIMAL(10,4);
            BEGIN
                -- Only process when status changes to 'submitted'
                IF NEW.status = 'submitted' AND OLD.status = 'draft' THEN
                    -- Loop through each dish in the usage event
                    FOR usage_item IN 
                        SELECT * FROM UsageItems WHERE event_id = NEW.event_id
                    LOOP
                        -- Loop through each ingredient for this dish
                        FOR recipe_ingredient IN
                            SELECT ri.*, ii.name as ingredient_name
                            FROM RecipeIngredients ri
                            JOIN InventoryItems ii ON ri.item_id = ii.item_id
                            WHERE ri.recipe_id = usage_item.dish_id
                        LOOP
                            -- Calculate total ingredient needed
                            total_ingredient_needed := recipe_ingredient.quantity * usage_item.quantity_produced;
                            
                            -- Create stock out record for this ingredient
                            INSERT INTO StockOutRecords (
                                business_id,
                                item_id,
                                item_type,
                                quantity,
                                unit_id,
                                reason_type,
                                notes,
                                deducted_by_user_id,
                                deducted_date,
                                production_date,
                                shift,
                                status,
                                usage_event_id
                            ) VALUES (
                                NEW.business_id,
                                recipe_ingredient.item_id,
                                'InventoryItem',
                                total_ingredient_needed,
                                recipe_ingredient.unit_id,
                                'Usage',
                                FORMAT('Auto-generated from usage event for %s dishes of %s', 
                                       usage_item.quantity_produced, 
                                       (SELECT name FROM MenuItems WHERE menu_item_id = usage_item.dish_id)),
                                NEW.submitted_by_user_id,
                                CURRENT_TIMESTAMP,
                                NEW.production_date,
                                NEW.shift,
                                'Confirmed',
                                NEW.event_id
                            );
                        END LOOP;
                    END LOOP;
                    
                    -- Update submitted timestamp
                    NEW.submitted_at = CURRENT_TIMESTAMP;
                END IF;
                
                RETURN NEW;
            END;
            $$ language 'plpgsql'
        `);

        await this.pool.query(`
            CREATE TRIGGER trigger_process_usage_event_submission
            BEFORE UPDATE ON UsageEvents
            FOR EACH ROW EXECUTE FUNCTION process_usage_event_submission()
        `);

        console.log('✅ Triggers created');
    }

    async insertSampleData() {
        console.log('🌱 Inserting sample data...');

        // Insert sample business types
        await this.pool.query(`
            INSERT INTO BusinessTypes (type_name, description) VALUES
            ('Restaurant', 'Full-service restaurant'),
            ('Cafe', 'Coffee shop or cafe'),
            ('Fast Food', 'Quick service restaurant'),
            ('Bakery', 'Bakery and pastry shop'),
            ('Food Truck', 'Mobile food service')
            ON CONFLICT (type_name) DO NOTHING
        `);

        // Insert sample billing machine models
        await this.pool.query(`
            INSERT INTO BillingMachineModels (model_name, description) VALUES
            ('Thermal Billing Machine (POS)', 'Standard thermal printer POS system'),
            ('QR Code System', 'QR code based ordering system'),
            ('Terminal', 'Digital payment terminal'),
            ('Manual Bills', 'Handwritten billing system')
            ON CONFLICT (model_name) DO NOTHING
        `);

        // Insert sample languages
        await this.pool.query(`
            INSERT INTO Languages (language_name, language_code, is_active) VALUES
            ('English', 'en', true),
            ('Hindi', 'hi', true),
            ('Telugu', 'te', true),
            ('Tamil', 'ta', true),
            ('Kannada', 'kn', true)
            ON CONFLICT (language_name) DO NOTHING
        `);

        // Insert sample global units
        await this.pool.query(`
            INSERT INTO GlobalUnits (unit_name, unit_symbol, unit_type, is_active, is_system_defined) VALUES
            ('Kilogram', 'kg', 'Weight', true, true),
            ('Gram', 'g', 'Weight', true, true),
            ('Liter', 'l', 'Volume', true, true),
            ('Milliliter', 'ml', 'Volume', true, true),
            ('Piece', 'pc', 'Count', true, true),
            ('Plate', 'plt', 'Prepared Dish', true, true),
            ('Serving', 'srv', 'Prepared Dish', true, true),
            ('Bunch', 'bunch', 'Count', true, true),
            ('Dozen', 'dz', 'Count', true, true),
            ('Cup', 'cup', 'Volume', true, true),
            ('Tablespoon', 'tbsp', 'Volume', true, true),
            ('Teaspoon', 'tsp', 'Volume', true, true)
            ON CONFLICT (unit_name) DO NOTHING
        `);

        // Insert sample dashboard widgets
        await this.pool.query(`
            INSERT INTO DashboardWidgets (name, description, is_active, default_order, widget_icon, widget_type) VALUES
            ('Total Sales', 'Display total sales revenue', true, 1, 'currency', 'Metric'),
            ('Low Stock Alerts', 'Show items with low stock', true, 2, 'warning', 'List'),
            ('Sales Overview Graph', 'Sales trend visualization', true, 3, 'chart', 'Graph'),
            ('Recent Orders', 'Latest customer orders', true, 4, 'list', 'List'),
            ('Inventory Summary', 'Current inventory status', true, 5, 'package', 'Metric'),
            ('Upcoming Payments', 'Vendor payments due', true, 6, 'calendar', 'List'),
            ('Production Summary', 'Daily production overview', true, 7, 'chef-hat', 'Metric'),
            ('Usage Events', 'Recent usage events', true, 8, 'clipboard', 'List')
            ON CONFLICT (name) DO NOTHING
        `);

        // Insert sample wastage reasons
        await this.pool.query(`
            INSERT INTO WastageReasons (business_id, reason_label, reason_category, is_active) VALUES
            (NULL, 'Expired', 'Ingredient Waste', true),
            (NULL, 'Spillage', 'Ingredient Waste', true),
            (NULL, 'Overcooked', 'Dish Waste', true),
            (NULL, 'Customer Return', 'Dish Waste', true),
            (NULL, 'Spoilage', 'General Waste', true),
            (NULL, 'Contamination', 'General Waste', true),
            (NULL, 'Over Production', 'Dish Waste', true),
            (NULL, 'Quality Control', 'Dish Waste', true)
            ON CONFLICT DO NOTHING
        `);

        // Insert sample permissions
        await this.pool.query(`
            INSERT INTO Permissions (permission_name, module_name, description, is_active) VALUES
            ('can_view_dashboard', 'Dashboard', 'View dashboard and metrics', true),
            ('can_manage_inventory', 'Inventory', 'Full inventory management access', true),
            ('can_view_inventory', 'Inventory', 'View inventory items and stock levels', true),
            ('can_create_stock_in', 'Inventory', 'Create stock in records', true),
            ('can_create_stock_out', 'Inventory', 'Create stock out records', true),
            ('can_manage_sales', 'Sales', 'Full sales management access', true),
            ('can_view_sales', 'Sales', 'View sales data and reports', true),
            ('can_manage_vendors', 'Vendor', 'Full vendor management access', true),
            ('can_view_vendors', 'Vendor', 'View vendor information', true),
            ('can_manage_users', 'Users', 'Manage user accounts and permissions', true),
            ('can_view_reports', 'Reports', 'Access to all reports', true),
            ('can_export_reports', 'Reports', 'Export reports to external formats', true),
            ('can_manage_settings', 'Settings', 'Modify business settings', true),
            ('can_manage_recipes', 'Recipes', 'Create and modify recipes', true),
            ('can_view_recipes', 'Recipes', 'View recipes and ingredients', true),
            ('can_upload_images', 'Images', 'Upload and manage images', true),
            ('can_manage_menu_item_images', 'Menu', 'Manage menu item images', true),
            ('can_create_usage_events', 'Production', 'Create and manage usage events', true),
            ('can_view_usage_events', 'Production', 'View usage events and production data', true),
            ('can_submit_usage_events', 'Production', 'Submit usage events for processing', true)
            ON CONFLICT (permission_name) DO NOTHING
        `);

        // Insert sample report registry
        await this.pool.query(`
            INSERT INTO ReportRegistry (report_name, report_code, category, description, is_active, is_visualizable) VALUES
            ('Daily Sales Summary', 'daily_sales_summary', 'Sales', 'Summary of daily sales performance', true, true),
            ('Inventory Value Report', 'inventory_value_report', 'Inventory', 'Current value of all inventory items', true, true),
            ('Low Stock Alert Report', 'low_stock_alert_report', 'Inventory', 'Items below reorder point', true, false),
            ('Wastage Analysis', 'wastage_analysis', 'Wastage', 'Analysis of food wastage patterns', true, true),
            ('Vendor Performance', 'vendor_performance', 'Vendor', 'Vendor delivery and quality metrics', true, true),
            ('Peak Hour Analysis', 'peak_hour_analysis', 'Sales', 'Sales distribution by time', true, true),
            ('Data Health Overview', 'data_health_overview', 'Data Health', 'Overall data quality metrics', true, true),
            ('Monthly P&L', 'monthly_pl', 'Financial', 'Monthly profit and loss statement', true, true),
            ('Menu Item Image Report', 'menu_item_image_report', 'Inventory', 'Menu items with missing images', true, false),
            ('Stock Out Visual Report', 'stock_out_visual_report', 'Inventory', 'Stock out records with evidence images', true, true),
            ('Production Efficiency Report', 'production_efficiency_report', 'Production', 'Daily production and ingredient usage analysis', true, true),
            ('Usage Events Summary', 'usage_events_summary', 'Production', 'Summary of all production events', true, true),
            ('Dish Production Report', 'dish_production_report', 'Production', 'Production volume by dish type', true, true)
            ON CONFLICT (report_name) DO NOTHING
        `);

        // Insert sample subscription plans
        await this.pool.query(`
            INSERT INTO SubscriptionPlans (plan_name, description, base_price_monthly, base_price_annually, max_users_included, is_active, is_recommended, is_most_popular) VALUES
            ('Basic', 'Essential tools for small businesses', 1499.00, 14400.00, 4, true, false, false),
            ('Growth', 'Optimize operations with AI & automation', 3499.00, 33600.00, 10, true, true, true),
            ('Enterprise', 'For chains & franchises with advanced needs', 7499.00, 72000.00, NULL, true, false, false)
            ON CONFLICT (plan_name) DO NOTHING
        `);

        // Insert sample features for each plan
        await this.pool.query(`
            INSERT INTO PlanFeatures (plan_id, feature_name, feature_description, is_active)
            SELECT p.plan_id, f.feature_name, f.feature_description, true
            FROM SubscriptionPlans p, (VALUES
            ('Basic', 'Core Inventory Management', 'Basic inventory tracking and management'),
            ('Basic', 'Manual Stock Entry', 'Manual entry of stock in/out records'),
            ('Basic', 'Menu Item Images', 'Upload and manage menu item images'),
            ('Basic', 'Basic Production Tracking', 'Simple usage event logging'),
            ('Basic', 'Up to 4 Users', 'Support for up to 4 user accounts'),
            ('Basic', 'Email Support', 'Email-based customer support'),
            ('Growth', 'All Basic Features', 'Includes all features from Basic plan'),
            ('Growth', 'Automatic Stock In/Out using OCR', 'OCR-powered automatic data entry'),
            ('Growth', 'AI Sales Booster', 'AI-powered sales optimization suggestions'),
            ('Growth', 'Advanced Production Management', 'Comprehensive usage events with automatic ingredient deduction'),
            ('Growth', 'Advanced Image Management', 'Bulk image upload and processing'),
            ('Growth', 'Stock Out Evidence Photos', 'Visual evidence for wastage tracking'),
            ('Growth', 'Production Evidence Photos', 'Visual documentation of production events'),
            ('Growth', 'Advanced Reports & Analytics', 'Comprehensive reporting and analytics'),
            ('Growth', 'Up to 10 Users', 'Support for up to 10 user accounts'),
            ('Growth', 'Priority Support', 'Priority email and chat support'),
            ('Enterprise', 'All Growth Features', 'Includes all features from Growth plan'),
            ('Enterprise', 'Custom Roles & Permissions', 'Advanced user role management'),
            ('Enterprise', 'Unlimited Users & Locations', 'No limits on users or business locations'),
            ('Enterprise', 'Multi-location Management', 'Manage multiple business locations'),
            ('Enterprise', 'Advanced Production Analytics', 'Detailed production efficiency and cost analysis'),
            ('Enterprise', 'Advanced Image Analytics', 'AI-powered image analysis and insights'),
            ('Enterprise', 'Custom Image Workflows', 'Customizable image processing workflows'),
            ('Enterprise', 'Dedicated Account Manager', 'Personal account management'),
            ('Enterprise', '24/7 Phone & Chat Support', 'Round-the-clock premium support')
            ) AS f(plan_name, feature_name, feature_description)
            WHERE p.plan_name = f.plan_name
            ON CONFLICT (plan_id, feature_name) DO NOTHING
        `);

        console.log('✅ Sample data inserted');
    }

    async setupDatabase() {
        try {
            console.log('🚀 Starting Invexis Database Setup with Usage Events Integration...\n');
            await this.connectToDatabase();
            await this.createTables();
            await this.addForeignKeyConstraints();
            await this.createIndexes();
            await this.createViews();
            await this.createTriggers();
            await this.insertSampleData();

            console.log('\n🎉 Database setup completed successfully!');
            console.log('📊 Your Invexis application database is ready to use.');
            console.log('\n🖼️ Image system features enabled:');
            console.log('  ✅ Menu item image support');
            console.log('  ✅ Stock-out evidence photos');
            console.log('  ✅ Usage event documentation');
            console.log('  ✅ Advanced image management');
            console.log('  ✅ Thumbnail generation support');
            console.log('  ✅ Image metadata tracking');
            console.log('\n🍽️ Production Management features enabled:');
            console.log('  ✅ Usage events with shift tracking');
            console.log('  ✅ Automatic ingredient deduction');
            console.log('  ✅ Recipe-based stock calculations');
            console.log('  ✅ Production efficiency tracking');
            console.log('  ✅ Draft/Submit workflow');
            console.log('  ✅ Visual production documentation');

        } catch (error) {
            console.error('\n❌ Database setup failed:', error.message);
            console.error('Stack trace:', error.stack);
            process.exit(1);
        } finally {
            console.log('🔄 Database setup process completed. Connection remains active.');
        }
    }
}

// Export the class for use in other files
module.exports = DatabaseSetup;

// Run setup if this file is executed directly
if (require.main === module) {
    const dbSetup = new DatabaseSetup();
    dbSetup.setupDatabase().catch(console.error);
}
