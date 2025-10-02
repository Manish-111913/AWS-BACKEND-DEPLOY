/**
 * Multitenant Migration Script
 * Applies the multitenant schema to existing database
 * Migrates existing business_id data to tenant_id structure
 */

const { pool } = require('../config/database');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

async function runMultitenantMigration() {
    const client = await pool.connect();
    
    try {
        console.log('🔄 Starting Multitenant Migration...');
        
        await client.query('BEGIN');
        
        // Step 1: Apply multitenant schema
        console.log('📋 Step 1: Applying multitenant schema...');
        const schemaSQL = await fs.readFile(
            path.join(__dirname, '../database/multitenant_schema.sql'), 
            'utf8'
        );
        await client.query(schemaSQL);
        console.log('✅ Multitenant schema applied');
        
        // Step 2: Migrate existing business data to tenant structure
        console.log('📋 Step 2: Migrating existing business data...');
        
        // Get existing unique business_id values
        const businessResult = await client.query(`
            SELECT DISTINCT business_id 
            FROM qr_codes 
            WHERE business_id IS NOT NULL
            ORDER BY business_id
        `);
        
        console.log(`Found ${businessResult.rows.length} existing businesses`);
        
        // Create tenant records for existing businesses
        for (const business of businessResult.rows) {
            const businessId = business.business_id;
            const tenantId = `business_${businessId}`;
            const apiKey = crypto.randomBytes(32).toString('hex');
            
            try {
                await client.query(`
                    INSERT INTO tenants (
                        tenant_id, name, tenant_strategy, 
                        api_key, status, max_tables, max_users
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                    ON CONFLICT (tenant_id) DO NOTHING
                `, [
                    tenantId,
                    `Business ${businessId}`,
                    'shared_schema',
                    apiKey,
                    'active',
                    100,
                    20
                ]);
                
                console.log(`✅ Created tenant: ${tenantId}`);
            } catch (error) {
                console.warn(`⚠️  Tenant ${tenantId} already exists or error:`, error.message);
            }
        }
        
        // Step 3: Update existing tables with tenant_id
        console.log('📋 Step 3: Updating existing records with tenant_id...');
        
        const tables = [
            'qr_codes',
            'dining_sessions', 
            'qr_scans',
            'session_orders',
            'qr_settings'
        ];
        
        for (const tableName of tables) {
            try {
                // Check if table exists
                const tableCheck = await client.query(`
                    SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables 
                        WHERE table_name = $1
                    )
                `, [tableName]);
                
                if (!tableCheck.rows[0].exists) {
                    console.log(`⏭️  Table ${tableName} doesn't exist, skipping...`);
                    continue;
                }
                
                // Update records where tenant_id is null but business_id exists
                const updateResult = await client.query(`
                    UPDATE ${tableName} 
                    SET tenant_id = 'business_' || business_id::text
                    WHERE tenant_id IS NULL AND business_id IS NOT NULL
                `);
                
                console.log(`✅ Updated ${updateResult.rowCount} records in ${tableName}`);
                
            } catch (error) {
                console.warn(`⚠️  Error updating table ${tableName}:`, error.message);
            }
        }
        
        // Step 4: Create default demo tenants for testing
        console.log('📋 Step 4: Creating demo tenants for testing...');
        
        const demoTenants = [
            {
                tenant_id: 'demo_restaurant',
                name: 'Demo Restaurant',
                strategy: 'shared_schema',
                max_tables: 20
            },
            {
                tenant_id: 'test_hotel',
                name: 'Test Hotel Chain',
                strategy: 'separate_schema',
                max_tables: 50
            },
            {
                tenant_id: 'sample_cafe',
                name: 'Sample Cafe Network',
                strategy: 'separate_database',
                max_tables: 100
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
                    demo.max_tables,
                    10,
                    `admin@${demo.tenant_id}.com`
                ]);
                
                console.log(`✅ Created demo tenant: ${demo.tenant_id} (${demo.strategy})`);
                
                // For separate_schema strategy, create the schema
                if (demo.strategy === 'separate_schema') {
                    const schemaName = `tenant_${demo.tenant_id}`;
                    
                    try {
                        await client.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
                        
                        // Copy table structures to new schema
                        const tablesToCopy = ['qr_codes', 'dining_sessions', 'qr_scans', 'session_orders'];
                        
                        for (const table of tablesToCopy) {
                            await client.query(`
                                CREATE TABLE IF NOT EXISTS ${schemaName}.${table} 
                                (LIKE public.${table} INCLUDING ALL)
                            `);
                        }
                        
                        // Record schema creation
                        await client.query(`
                            INSERT INTO tenant_schemas (tenant_id, schema_name, is_active)
                            VALUES ($1, $2, true)
                            ON CONFLICT (tenant_id, schema_name) DO NOTHING
                        `, [demo.tenant_id, schemaName]);
                        
                        console.log(`   📁 Created schema: ${schemaName}`);
                        
                    } catch (schemaError) {
                        console.warn(`   ⚠️  Schema creation failed for ${schemaName}:`, schemaError.message);
                    }
                }
                
            } catch (error) {
                console.warn(`⚠️  Demo tenant ${demo.tenant_id} already exists or error:`, error.message);
            }
        }
        
        // Step 5: Create indexes for performance
        console.log('📋 Step 5: Creating performance indexes...');
        
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_tenant_activity_tenant_date ON tenant_activity_logs(tenant_id, created_at)',
            'CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant_active ON tenant_users(tenant_id, is_active)',
            'CREATE INDEX IF NOT EXISTS idx_tenants_api_key ON tenants(api_key) WHERE status = \'active\'',
        ];
        
        for (const indexSQL of indexes) {
            try {
                await client.query(indexSQL);
            } catch (error) {
                console.warn(`⚠️  Index creation warning:`, error.message);
            }
        }
        
        console.log('✅ Performance indexes created');
        
        await client.query('COMMIT');
        
        // Step 6: Verify migration
        console.log('📋 Step 6: Verifying migration...');
        
        const verificationQueries = [
            { name: 'Total Tenants', query: 'SELECT COUNT(*) as count FROM tenants' },
            { name: 'Active Tenants', query: 'SELECT COUNT(*) as count FROM tenants WHERE status = \'active\'' },
            { name: 'QR Codes with tenant_id', query: 'SELECT COUNT(*) as count FROM qr_codes WHERE tenant_id IS NOT NULL' },
            { name: 'Tenant Schemas', query: 'SELECT COUNT(*) as count FROM tenant_schemas WHERE is_active = true' }
        ];
        
        for (const verification of verificationQueries) {
            try {
                const result = await client.query(verification.query);
                console.log(`   ✅ ${verification.name}: ${result.rows[0].count}`);
            } catch (error) {
                console.warn(`   ⚠️  ${verification.name}: Error -`, error.message);
            }
        }
        
        console.log('🎉 Multitenant Migration Completed Successfully!');
        
        // Display tenant information
        const tenantsResult = await client.query(`
            SELECT tenant_id, name, tenant_strategy, api_key, status 
            FROM tenants 
            ORDER BY created_at DESC
        `);
        
        console.log('\n📊 Available Tenants:');
        console.log('─'.repeat(100));
        
        for (const tenant of tenantsResult.rows) {
            console.log(`🏢 ${tenant.name} (${tenant.tenant_id})`);
            console.log(`   Strategy: ${tenant.tenant_strategy}`);
            console.log(`   API Key: ${tenant.api_key}`);
            console.log(`   Status: ${tenant.status}`);
            console.log('');
        }
        
        console.log('🚀 You can now use the multitenant QR system with the following headers:');
        console.log('   X-Tenant-ID: <tenant_id>');
        console.log('   X-API-Key: <api_key>');
        console.log('');
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Run migration if called directly
if (require.main === module) {
    runMultitenantMigration()
        .then(() => {
            console.log('✅ Migration completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Migration failed:', error);
            process.exit(1);
        });
}

module.exports = { runMultitenantMigration };