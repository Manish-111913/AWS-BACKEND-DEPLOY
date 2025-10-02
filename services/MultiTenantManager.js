/**
 * Multitenant Manager Service
 * Handles all three tenant strategies:
 * 1. Shared Database + Shared Schema (tenant_id filtering)
 * 2. Shared Database + Separate Schemas (schema per tenant)
 * 3. Separate Databases (database per tenant)
 */

const { Pool } = require('pg');
const crypto = require('crypto');

class MultiTenantManager {
    constructor() {
        this.tenantConnections = new Map(); // Cache for tenant-specific connections
        this.tenantConfigs = new Map();     // Cache for tenant configurations
        this.masterPool = null;             // Master database connection
        this.encryptionKey = process.env.TENANT_ENCRYPTION_KEY || 'default_key_change_in_production';
    }

    /**
     * Initialize the multitenant manager with master database connection
     */
    async initialize(masterDbConfig) {
        this.masterPool = new Pool(masterDbConfig);
        
        try {
            // Test master connection
            const client = await this.masterPool.connect();
            console.log('✅ Master database connected successfully');
            client.release();
            
            // Load all tenant configurations into cache
            await this.loadTenantConfigurations();
            
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize multitenant manager:', error);
            throw error;
        }
    }

    /**
     * Load all tenant configurations from master database
     */
    async loadTenantConfigurations() {
        const client = await this.masterPool.connect();
        
        try {
            const result = await client.query(`
                SELECT 
                    tenant_id, name, tenant_strategy, database_name, schema_name,
                    db_host, db_port, db_user, db_password_encrypted, db_ssl_enabled,
                    status, max_tables, max_users, api_key
                FROM tenants 
                WHERE status = 'active'
            `);
            
            for (const tenant of result.rows) {
                this.tenantConfigs.set(tenant.tenant_id, {
                    ...tenant,
                    db_password: tenant.db_password_encrypted ? 
                        this.decrypt(tenant.db_password_encrypted) : null
                });
            }
            
            console.log(`✅ Loaded ${result.rows.length} tenant configurations`);
        } finally {
            client.release();
        }
    }

    /**
     * Get database connection for a specific tenant
     */
    async getTenantConnection(tenantId) {
        const tenantConfig = this.tenantConfigs.get(tenantId);
        
        if (!tenantConfig) {
            throw new Error(`Tenant '${tenantId}' not found or inactive`);
        }

        switch (tenantConfig.tenant_strategy) {
            case 'shared_schema':
                return await this.getSharedSchemaConnection(tenantId);
            
            case 'separate_schema':
                return await this.getSeparateSchemaConnection(tenantId);
            
            case 'separate_database':
                return await this.getSeparateDatabaseConnection(tenantId);
            
            default:
                throw new Error(`Unknown tenant strategy: ${tenantConfig.tenant_strategy}`);
        }
    }

    /**
     * Strategy 1: Shared Database + Shared Schema
     * Uses tenant_id filtering and row-level security
     */
    async getSharedSchemaConnection(tenantId) {
        if (!this.tenantConnections.has(`shared_${tenantId}`)) {
            const client = await this.masterPool.connect();
            
            // Set tenant context for RLS (Row Level Security)
            await client.query(`SET app.current_tenant_id = '${tenantId}'`);
            
            this.tenantConnections.set(`shared_${tenantId}`, {
                client,
                strategy: 'shared_schema',
                tenantId,
                lastUsed: new Date()
            });
        }
        
        const connection = this.tenantConnections.get(`shared_${tenantId}`);
        connection.lastUsed = new Date();
        return connection;
    }

    /**
     * Strategy 2: Shared Database + Separate Schemas
     * Each tenant has its own schema in the same database
     */
    async getSeparateSchemaConnection(tenantId) {
        const connectionKey = `schema_${tenantId}`;
        const tenantConfig = this.tenantConfigs.get(tenantId);
        
        if (!this.tenantConnections.has(connectionKey)) {
            const client = await this.masterPool.connect();
            
            // Set schema search path to tenant-specific schema
            const schemaName = tenantConfig.schema_name || `tenant_${tenantId}`;
            await client.query(`SET search_path TO ${schemaName}, public`);
            
            this.tenantConnections.set(connectionKey, {
                client,
                strategy: 'separate_schema',
                tenantId,
                schemaName,
                lastUsed: new Date()
            });
        }
        
        const connection = this.tenantConnections.get(connectionKey);
        connection.lastUsed = new Date();
        return connection;
    }

    /**
     * Strategy 3: Separate Databases
     * Each tenant has its own complete database
     */
    async getSeparateDatabaseConnection(tenantId) {
        const connectionKey = `db_${tenantId}`;
        const tenantConfig = this.tenantConfigs.get(tenantId);
        
        if (!this.tenantConnections.has(connectionKey)) {
            const dbConfig = {
                host: tenantConfig.db_host,
                port: tenantConfig.db_port,
                database: tenantConfig.database_name,
                user: tenantConfig.db_user,
                password: tenantConfig.db_password,
                ssl: tenantConfig.db_ssl_enabled
            };
            
            const pool = new Pool(dbConfig);
            const client = await pool.connect();
            
            this.tenantConnections.set(connectionKey, {
                client,
                pool,
                strategy: 'separate_database',
                tenantId,
                databaseName: tenantConfig.database_name,
                lastUsed: new Date()
            });
        }
        
        const connection = this.tenantConnections.get(connectionKey);
        connection.lastUsed = new Date();
        return connection;
    }

    /**
     * Execute query with tenant context
     */
    async executeQuery(tenantId, query, params = []) {
        const connection = await this.getTenantConnection(tenantId);
        const tenantConfig = this.tenantConfigs.get(tenantId);
        
        let finalQuery = query;
        let finalParams = params;
        
        // For shared schema strategy, automatically add tenant_id filtering
        if (tenantConfig.tenant_strategy === 'shared_schema') {
            finalQuery = this.addTenantFilter(query, tenantId);
        }
        
        try {
            const result = await connection.client.query(finalQuery, finalParams);
            
            // Log tenant activity
            await this.logTenantActivity(tenantId, 'query_executed', {
                query: query.substring(0, 100) + '...',
                rowCount: result.rowCount
            });
            
            return result;
        } catch (error) {
            console.error(`Query execution failed for tenant ${tenantId}:`, error);
            throw error;
        }
    }

    /**
     * Add tenant_id filtering to queries for shared schema strategy
     */
    addTenantFilter(query, tenantId) {
        // This is a simplified implementation
        // In production, you'd want a more sophisticated SQL parser
        const tables = ['qr_codes', 'dining_sessions', 'qr_scans', 'session_orders'];
        let modifiedQuery = query;
        
        tables.forEach(table => {
            // Add WHERE tenant_id = $tenantId if not already present
            if (modifiedQuery.includes(table) && !modifiedQuery.includes('tenant_id')) {
                // This would need more sophisticated logic for complex queries
                modifiedQuery = modifiedQuery.replace(
                    new RegExp(`FROM ${table}`, 'gi'),
                    `FROM ${table} WHERE tenant_id = '${tenantId}'`
                );
            }
        });
        
        return modifiedQuery;
    }

    /**
     * Create a new tenant
     */
    async createTenant(tenantData) {
        const client = await this.masterPool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Generate tenant_id if not provided
            const tenantId = tenantData.tenant_id || 'tenant_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            
            // Generate API key
            const apiKey = crypto.randomBytes(32).toString('hex');
            
            // Insert tenant record
            const tenantResult = await client.query(`
                INSERT INTO tenants (
                    tenant_id, name, tenant_strategy, max_tables, max_users,
                    api_key, contact_name, contact_email, status, timezone, currency, language, country
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, $11, $12)
                RETURNING *
            `, [
                tenantId,
                tenantData.name,
                tenantData.tenant_strategy || 'shared_schema',
                tenantData.max_tables || 50,
                tenantData.max_users || 10,
                apiKey,
                tenantData.contact_name,
                tenantData.contact_email,
                tenantData.settings?.timezone || 'UTC',
                tenantData.settings?.currency || 'USD',
                tenantData.settings?.language || 'en',
                tenantData.settings?.country || 'US'
            ]);
            
            const tenant = tenantResult.rows[0];
            
            // Setup tenant based on strategy
            if (tenant.tenant_strategy === 'separate_schema') {
                await this.createTenantSchema(client, tenant.tenant_id);
            } else if (tenant.tenant_strategy === 'separate_database') {
                await this.createTenantDatabase(tenant);
            }
            
            await client.query('COMMIT');
            
            // Update cache
            this.tenantConfigs.set(tenant.tenant_id, tenant);
            
            console.log(`✅ Created tenant: ${tenant.tenant_id} (${tenant.tenant_strategy})`);
            return tenant;
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Failed to create tenant:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    /**
     * Create schema for separate schema strategy
     */
    async createTenantSchema(client, tenantId) {
        const schemaName = `tenant_${tenantId}`;
        
        // Create schema
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${schemaName}`);
        
        // Create tables in the new schema (copy structure from public schema)
        const tables = ['qr_codes', 'dining_sessions', 'qr_scans', 'session_orders', 'qr_settings'];
        
        for (const table of tables) {
            await client.query(`
                CREATE TABLE ${schemaName}.${table} 
                (LIKE public.${table} INCLUDING ALL)
            `);
        }
        
        // Update tenant_schemas table
        await client.query(`
            INSERT INTO tenant_schemas (tenant_id, schema_name, is_active)
            VALUES ($1, $2, true)
        `, [tenantId, schemaName]);
        
        console.log(`✅ Created schema '${schemaName}' for tenant '${tenantId}'`);
    }

    /**
     * Create separate database for tenant (requires external database creation)
     */
    async createTenantDatabase(tenant) {
        // This would typically involve:
        // 1. Creating a new database on the same or different server
        // 2. Running migration scripts to create tables
        // 3. Setting up connection credentials
        
        console.log(`📝 Separate database creation for tenant '${tenant.tenant_id}' requires manual setup`);
        console.log('   1. Create new database:', `${tenant.tenant_id}_db`);
        console.log('   2. Run migration scripts');
        console.log('   3. Update tenant configuration with connection details');
    }

    /**
     * Validate tenant access using API key
     */
    async validateTenantAccess(tenantId, apiKey) {
        const client = await this.masterPool.connect();
        
        try {
            const result = await client.query(`
                SELECT tenant_id, name, status, api_key
                FROM tenants
                WHERE tenant_id = $1 AND api_key = $2 AND status = 'active'
            `, [tenantId, apiKey]);
            
            return result.rows.length > 0;
        } finally {
            client.release();
        }
    }

    /**
     * Log tenant activity for analytics and auditing
     */
    async logTenantActivity(tenantId, activityType, metadata = {}) {
        try {
            const client = await this.masterPool.connect();
            
            await client.query(`
                INSERT INTO tenant_activity_logs (tenant_id, activity_type, metadata)
                VALUES ($1, $2, $3)
            `, [tenantId, activityType, JSON.stringify(metadata)]);
            
            client.release();
        } catch (error) {
            console.error('Failed to log tenant activity:', error);
        }
    }

    /**
     * Get tenant metrics and analytics
     */
    async getTenantMetrics(tenantId) {
        const connection = await this.getTenantConnection(tenantId);
        const tenantConfig = this.tenantConfigs.get(tenantId);
        
        let queries;
        
        if (tenantConfig.tenant_strategy === 'shared_schema') {
            queries = {
                totalTables: `SELECT COUNT(*) as count FROM qr_codes WHERE tenant_id = $1`,
                activeSessions: `SELECT COUNT(*) as count FROM dining_sessions WHERE tenant_id = $1 AND is_active = true`,
                todayScans: `SELECT COUNT(*) as count FROM qr_scans WHERE tenant_id = $1 AND DATE(scanned_at) = CURRENT_DATE`
            };
        } else {
            // For separate schema/database, no tenant_id filtering needed
            queries = {
                totalTables: `SELECT COUNT(*) as count FROM qr_codes`,
                activeSessions: `SELECT COUNT(*) as count FROM dining_sessions WHERE is_active = true`,
                todayScans: `SELECT COUNT(*) as count FROM qr_scans WHERE DATE(scanned_at) = CURRENT_DATE`
            };
        }
        
        const results = {};
        
        for (const [key, query] of Object.entries(queries)) {
            const params = tenantConfig.tenant_strategy === 'shared_schema' ? [tenantId] : [];
            const result = await connection.client.query(query, params);
            results[key] = parseInt(result.rows[0].count);
        }
        
        return results;
    }

    /**
     * Cleanup unused connections
     */
    async cleanupConnections(maxIdleTime = 30 * 60 * 1000) { // 30 minutes
        const now = new Date();
        
        for (const [key, connection] of this.tenantConnections.entries()) {
            if (now - connection.lastUsed > maxIdleTime) {
                try {
                    connection.client.release();
                    if (connection.pool) {
                        await connection.pool.end();
                    }
                    this.tenantConnections.delete(key);
                    console.log(`🧹 Cleaned up connection for ${key}`);
                } catch (error) {
                    console.error(`Failed to cleanup connection ${key}:`, error);
                }
            }
        }
    }

    /**
     * Utility functions
     */
    encrypt(text) {
        const cipher = crypto.createCipher('aes192', this.encryptionKey);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    }

    decrypt(encryptedText) {
        const decipher = crypto.createDecipher('aes192', this.encryptionKey);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }

    /**
     * Shutdown and cleanup all connections
     */
    async shutdown() {
        console.log('🔄 Shutting down multitenant manager...');
        
        // Close all tenant connections
        for (const [key, connection] of this.tenantConnections.entries()) {
            try {
                connection.client.release();
                if (connection.pool) {
                    await connection.pool.end();
                }
            } catch (error) {
                console.error(`Error closing connection ${key}:`, error);
            }
        }
        
        // Close master pool
        if (this.masterPool) {
            await this.masterPool.end();
        }
        
        console.log('✅ Multitenant manager shutdown complete');
    }
}

module.exports = MultiTenantManager;