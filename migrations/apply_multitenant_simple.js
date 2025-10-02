/**
 * Step-by-step Multitenant Migration
 * Applies multitenant schema in smaller, manageable chunks
 */

const { pool } = require('../config/database');
const crypto = require('crypto');

async function applyMultitenantStep1() {
    const client = await pool.connect();
    
    try {
        console.log('🔄 Step 1: Creating tenant management tables...');
        
        await client.query('BEGIN');
        
        // Create tenants table
        await client.query(`
            CREATE TABLE IF NOT EXISTS tenants (
                id SERIAL PRIMARY KEY,
                tenant_id VARCHAR(50) UNIQUE NOT NULL,
                name VARCHAR(255) NOT NULL,
                domain VARCHAR(255),
                subdomain VARCHAR(100),
                tenant_strategy VARCHAR(20) NOT NULL DEFAULT 'shared_schema',
                database_name VARCHAR(100),
                schema_name VARCHAR(100),
                db_host VARCHAR(255),
                db_port INTEGER,
                db_user VARCHAR(100),
                db_password_encrypted TEXT,
                db_ssl_enabled BOOLEAN DEFAULT TRUE,
                status VARCHAR(20) DEFAULT 'active',
                subscription_plan VARCHAR(50) DEFAULT 'basic',
                max_tables INTEGER DEFAULT 50,
                max_users INTEGER DEFAULT 10,
                max_orders_per_day INTEGER DEFAULT 1000,
                subscription_start_date DATE,
                subscription_end_date DATE,
                billing_cycle VARCHAR(20) DEFAULT 'monthly',
                monthly_fee DECIMAL(10, 2) DEFAULT 0.00,
                timezone VARCHAR(50) DEFAULT 'UTC',
                currency VARCHAR(3) DEFAULT 'USD',
                language VARCHAR(5) DEFAULT 'en',
                country VARCHAR(2) DEFAULT 'US',
                contact_name VARCHAR(255),
                contact_email VARCHAR(255),
                contact_phone VARCHAR(50),
                address TEXT,
                api_key VARCHAR(64) UNIQUE,
                webhook_url TEXT,
                custom_logo_url TEXT,
                custom_theme_colors JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_by INTEGER,
                last_login_at TIMESTAMP
            )
        `);
        
        console.log('✅ Tenants table created');
        
        // Create tenant_users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS tenant_users (
                id SERIAL PRIMARY KEY,
                tenant_id VARCHAR(50) NOT NULL,
                user_id INTEGER NOT NULL,
                role VARCHAR(50) DEFAULT 'staff',
                permissions JSONB DEFAULT '{}',
                is_active BOOLEAN DEFAULT TRUE,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_access_at TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
            )
        `);
        
        console.log('✅ Tenant users table created');
        
        await client.query('COMMIT');
        console.log('✅ Step 1 completed successfully');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Step 1 failed:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

async function applyMultitenantStep2() {
    const client = await pool.connect();
    
    try {
        console.log('🔄 Step 2: Creating configuration and logging tables...');
        
        await client.query('BEGIN');
        
        // Create tenant_settings table
        await client.query(`
            CREATE TABLE IF NOT EXISTS tenant_settings (
                id SERIAL PRIMARY KEY,
                tenant_id VARCHAR(50) NOT NULL,
                setting_key VARCHAR(100) NOT NULL,
                setting_value TEXT,
                setting_type VARCHAR(20) DEFAULT 'string',
                is_encrypted BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
                UNIQUE (tenant_id, setting_key)
            )
        `);
        
        console.log('✅ Tenant settings table created');
        
        // Create tenant_schemas table
        await client.query(`
            CREATE TABLE IF NOT EXISTS tenant_schemas (
                id SERIAL PRIMARY KEY,
                tenant_id VARCHAR(50) NOT NULL,
                schema_name VARCHAR(100) NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                schema_version VARCHAR(20) DEFAULT '1.0.0',
                migration_status VARCHAR(20) DEFAULT 'completed',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_migration_at TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
                UNIQUE (tenant_id, schema_name)
            )
        `);
        
        console.log('✅ Tenant schemas table created');
        
        // Create tenant_activity_logs table
        await client.query(`
            CREATE TABLE IF NOT EXISTS tenant_activity_logs (
                id SERIAL PRIMARY KEY,
                tenant_id VARCHAR(50) NOT NULL,
                user_id INTEGER,
                activity_type VARCHAR(50) NOT NULL,
                activity_description TEXT,
                ip_address INET,
                user_agent TEXT,
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
            )
        `);
        
        console.log('✅ Tenant activity logs table created');
        
        await client.query('COMMIT');
        console.log('✅ Step 2 completed successfully');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Step 2 failed:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

async function applyMultitenantStep3() {
    const client = await pool.connect();
    
    try {
        console.log('🔄 Step 3: Adding tenant_id columns to existing tables...');
        
        await client.query('BEGIN');
        
        const tables = ['qr_codes', 'dining_sessions', 'qr_scans', 'session_orders', 'qr_settings'];
        
        for (const tableName of tables) {
            try {
                // Check if table exists
                const tableCheck = await client.query(`
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables 
                        WHERE table_name = $1
                    )
                `, [tableName]);
                
                if (tableCheck.rows[0].exists) {
                    // Check if tenant_id column already exists
                    const columnCheck = await client.query(`
                        SELECT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = $1 AND column_name = 'tenant_id'
                        )
                    `, [tableName]);
                    
                    if (!columnCheck.rows[0].exists) {
                        await client.query(`ALTER TABLE ${tableName} ADD COLUMN tenant_id VARCHAR(50)`);
                        console.log(`✅ Added tenant_id to ${tableName}`);
                    } else {
                        console.log(`⏭️  tenant_id already exists in ${tableName}`);
                    }
                } else {
                    console.log(`⏭️  Table ${tableName} doesn't exist, skipping...`);
                }
            } catch (error) {
                console.warn(`⚠️  Error with table ${tableName}:`, error.message);
            }
        }
        
        await client.query('COMMIT');
        console.log('✅ Step 3 completed successfully');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Step 3 failed:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

async function applyMultitenantStep4() {
    const client = await pool.connect();
    
    try {
        console.log('🔄 Step 4: Creating indexes and demo tenants...');
        
        await client.query('BEGIN');
        
        // Create performance indexes
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status)',
            'CREATE INDEX IF NOT EXISTS idx_tenants_strategy ON tenants(tenant_strategy)',
            'CREATE INDEX IF NOT EXISTS idx_tenants_api_key ON tenants(api_key)',
            'CREATE INDEX IF NOT EXISTS idx_tenant_activity_tenant_time ON tenant_activity_logs(tenant_id, created_at)',
            'CREATE INDEX IF NOT EXISTS idx_qr_codes_tenant ON qr_codes(tenant_id)',
            'CREATE INDEX IF NOT EXISTS idx_dining_sessions_tenant ON dining_sessions(tenant_id)',
        ];
        
        for (const indexSQL of indexes) {
            try {
                await client.query(indexSQL);
            } catch (error) {
                console.warn(`⚠️  Index warning:`, error.message);
            }
        }
        
        console.log('✅ Indexes created');
        
        // Create demo tenants
        const demoTenants = [
            {
                tenant_id: 'demo_restaurant',
                name: 'Demo Restaurant',
                strategy: 'shared_schema',
                email: 'admin@demo-restaurant.com'
            },
            {
                tenant_id: 'test_hotel',
                name: 'Test Hotel Chain',
                strategy: 'separate_schema',
                email: 'admin@test-hotel.com'
            },
            {
                tenant_id: 'sample_cafe',
                name: 'Sample Cafe Network',
                strategy: 'separate_database',
                email: 'admin@sample-cafe.com'
            }
        ];
        
        for (const demo of demoTenants) {
            const apiKey = crypto.randomBytes(32).toString('hex');
            
            try {
                await client.query(`
                    INSERT INTO tenants (
                        tenant_id, name, tenant_strategy, api_key, 
                        status, max_tables, max_users, contact_email
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    ON CONFLICT (tenant_id) DO NOTHING
                `, [
                    demo.tenant_id,
                    demo.name,
                    demo.strategy,
                    apiKey,
                    'active',
                    50,
                    10,
                    demo.email
                ]);
                
                console.log(`✅ Created demo tenant: ${demo.tenant_id}`);
                
            } catch (error) {
                console.warn(`⚠️  Demo tenant ${demo.tenant_id}:`, error.message);
            }
        }
        
        // Migrate existing business_id data to tenant_id
        console.log('🔄 Migrating existing business_id to tenant_id...');
        
        // Get existing businesses
        const businessResult = await client.query(`
            SELECT DISTINCT business_id 
            FROM qr_codes 
            WHERE business_id IS NOT NULL AND tenant_id IS NULL
            ORDER BY business_id
        `);
        
        for (const business of businessResult.rows) {
            const businessId = business.business_id;
            const tenantId = `business_${businessId}`;
            const apiKey = crypto.randomBytes(32).toString('hex');
            
            // Create tenant for existing business
            try {
                await client.query(`
                    INSERT INTO tenants (
                        tenant_id, name, tenant_strategy, api_key, status
                    ) VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (tenant_id) DO NOTHING
                `, [tenantId, `Business ${businessId}`, 'shared_schema', apiKey, 'active']);
            } catch (error) {
                console.warn(`⚠️  Business tenant ${tenantId}:`, error.message);
            }
            
            // Update existing records
            const tables = ['qr_codes', 'dining_sessions', 'qr_scans', 'session_orders', 'qr_settings'];
            for (const tableName of tables) {
                try {
                    const updateResult = await client.query(`
                        UPDATE ${tableName} 
                        SET tenant_id = $1
                        WHERE business_id = $2 AND tenant_id IS NULL
                    `, [tenantId, businessId]);
                    
                    if (updateResult.rowCount > 0) {
                        console.log(`✅ Updated ${updateResult.rowCount} records in ${tableName} for ${tenantId}`);
                    }
                } catch (error) {
                    console.warn(`⚠️  Error updating ${tableName}:`, error.message);
                }
            }
        }
        
        await client.query('COMMIT');
        console.log('✅ Step 4 completed successfully');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Step 4 failed:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

async function runCompleteMultitenantMigration() {
    try {
        console.log('🚀 Starting Complete Multitenant Migration...\n');
        
        await applyMultitenantStep1();
        await applyMultitenantStep2();
        await applyMultitenantStep3();
        await applyMultitenantStep4();
        
        // Verification
        console.log('\n🔍 Verifying migration...');
        const client = await pool.connect();
        
        const verificationQueries = [
            { name: 'Total Tenants', query: 'SELECT COUNT(*) as count FROM tenants' },
            { name: 'Active Tenants', query: 'SELECT COUNT(*) as count FROM tenants WHERE status = \'active\'' },
            { name: 'QR Codes with tenant_id', query: 'SELECT COUNT(*) as count FROM qr_codes WHERE tenant_id IS NOT NULL' }
        ];
        
        for (const verification of verificationQueries) {
            try {
                const result = await client.query(verification.query);
                console.log(`   ✅ ${verification.name}: ${result.rows[0].count}`);
            } catch (error) {
                console.warn(`   ⚠️  ${verification.name}: Error`);
            }
        }
        
        // Display available tenants
        const tenantsResult = await client.query(`
            SELECT tenant_id, name, tenant_strategy, api_key, status 
            FROM tenants 
            ORDER BY created_at DESC
        `);
        
        console.log('\n🏢 Available Tenants:');
        console.log('─'.repeat(80));
        
        for (const tenant of tenantsResult.rows) {
            console.log(`${tenant.name} (${tenant.tenant_id})`);
            console.log(`   Strategy: ${tenant.tenant_strategy}`);
            console.log(`   API Key: ${tenant.api_key}`);
            console.log(`   Status: ${tenant.status}`);
            console.log('');
        }
        
        client.release();
        
        console.log('🎉 Multitenant Migration Completed Successfully!');
        console.log('\n📖 Usage Instructions:');
        console.log('1. Use X-Tenant-ID header with tenant_id');
        console.log('2. Use X-API-Key header with the API key');
        console.log('3. Or include tenant_id and api_key in request body');
        
    } catch (error) {
        console.error('❌ Complete migration failed:', error);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    runCompleteMultitenantMigration()
        .then(() => {
            console.log('✅ Migration completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Migration failed:', error);
            process.exit(1);
        });
}

module.exports = { runCompleteMultitenantMigration };