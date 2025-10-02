/**
 * Tenant Context Middleware
 * Handles tenant identification, validation, and context setting
 * for all API routes in the multitenant architecture
 */

const MultiTenantManager = require('../services/MultiTenantManager');

class TenantMiddleware {
    constructor(multiTenantManager) {
        this.tenantManager = multiTenantManager;
    }

    /**
     * Main tenant context middleware
     * Identifies tenant from request and sets context
     */
    tenantContext() {
        return async (req, res, next) => {
            try {
                // Extract tenant information from various sources
                const tenantInfo = this.extractTenantInfo(req);
                
                if (!tenantInfo.tenantId) {
                    return res.status(400).json({
                        success: false,
                        error: 'Tenant identification required',
                        hint: 'Provide tenant_id in header, subdomain, or request body'
                    });
                }

                // Validate tenant access
                const isValidTenant = await this.validateTenantAccess(
                    tenantInfo.tenantId, 
                    tenantInfo.apiKey
                );

                if (!isValidTenant) {
                    return res.status(401).json({
                        success: false,
                        error: 'Invalid tenant credentials or inactive tenant'
                    });
                }

                // Get tenant configuration
                const tenantConfig = this.tenantManager.tenantConfigs.get(tenantInfo.tenantId);
                
                if (!tenantConfig) {
                    return res.status(404).json({
                        success: false,
                        error: 'Tenant not found or not configured'
                    });
                }

                // Set tenant context in request
                req.tenant = {
                    id: tenantInfo.tenantId,
                    name: tenantConfig.name,
                    strategy: tenantConfig.tenant_strategy,
                    config: tenantConfig,
                    apiKey: tenantInfo.apiKey
                };

                // Get tenant-specific database connection
                req.tenantConnection = await this.tenantManager.getTenantConnection(tenantInfo.tenantId);

                // Log tenant activity
                await this.tenantManager.logTenantActivity(tenantInfo.tenantId, 'api_request', {
                    endpoint: req.path,
                    method: req.method,
                    userAgent: req.get('User-Agent'),
                    ip: req.ip
                });

                next();
                
            } catch (error) {
                console.error('Tenant context middleware error:', error);
                res.status(500).json({
                    success: false,
                    error: 'Tenant context setup failed',
                    details: error.message
                });
            }
        };
    }

    /**
     * Extract tenant information from request
     * Supports multiple identification methods:
     * 1. X-Tenant-ID header + X-API-Key header
     * 2. Subdomain (e.g., tenant1.yourdomain.com)
     * 3. Request body (tenant_id + api_key)
     * 4. URL parameter (legacy business_id)
     */
    extractTenantInfo(req) {
        let tenantId = null;
        let apiKey = null;

        // Method 1: Headers (Recommended for API access)
        if (req.headers['x-tenant-id']) {
            tenantId = req.headers['x-tenant-id'];
            apiKey = req.headers['x-api-key'];
        }

        // Method 2: Subdomain extraction
        if (!tenantId && req.headers.host) {
            const host = req.headers.host;
            const subdomain = host.split('.')[0];
            
            // Check if it's a tenant subdomain (not www, api, etc.)
            if (subdomain && !['www', 'api', 'admin', 'localhost'].includes(subdomain)) {
                tenantId = subdomain;
                apiKey = req.headers['x-api-key'] || req.body?.api_key;
            }
        }

        // Method 3: Request body
        if (!tenantId && req.body) {
            tenantId = req.body.tenant_id;
            apiKey = req.body.api_key;
        }

        // Method 4: Query parameters
        if (!tenantId && req.query) {
            tenantId = req.query.tenant_id;
            apiKey = req.query.api_key;
        }

        // Legacy support: Convert business_id to tenant_id
        if (!tenantId && req.body?.businessId) {
            tenantId = `business_${req.body.businessId}`;
        }

        return { tenantId, apiKey };
    }

    /**
     * Validate tenant access credentials
     */
    async validateTenantAccess(tenantId, apiKey) {
        if (!tenantId) return false;
        
        // For development/demo purposes, allow access without API key
        if (process.env.NODE_ENV === 'development' && !apiKey) {
            console.log(`⚠️  Development mode: Allowing access to tenant '${tenantId}' without API key`);
            return this.tenantManager.tenantConfigs.has(tenantId);
        }

        // Production: Require API key validation
        if (!apiKey) return false;
        
        return await this.tenantManager.validateTenantAccess(tenantId, apiKey);
    }

    /**
     * Tenant query wrapper middleware
     * Provides easy methods for database operations with tenant context
     */
    tenantQueryWrapper() {
        return (req, res, next) => {
            // Add tenant-aware query methods to request
            req.tenantQuery = {
                // Execute raw query with tenant context
                execute: async (query, params = []) => {
                    return await this.tenantManager.executeQuery(req.tenant.id, query, params);
                },

                // Get all records from a table with tenant filtering
                getAll: async (tableName, conditions = {}) => {
                    let whereClause = '';
                    const params = [];
                    let paramCount = 1;

                    // Add tenant filtering for shared schema strategy
                    if (req.tenant.strategy === 'shared_schema') {
                        conditions.tenant_id = req.tenant.id;
                    }

                    // Build WHERE clause
                    if (Object.keys(conditions).length > 0) {
                        const conditionParts = [];
                        for (const [key, value] of Object.entries(conditions)) {
                            conditionParts.push(`${key} = $${paramCount++}`);
                            params.push(value);
                        }
                        whereClause = `WHERE ${conditionParts.join(' AND ')}`;
                    }

                    const query = `SELECT * FROM ${tableName} ${whereClause}`;
                    return await this.tenantManager.executeQuery(req.tenant.id, query, params);
                },

                // Insert record with automatic tenant_id
                insert: async (tableName, data) => {
                    // Add tenant_id for shared schema strategy
                    if (req.tenant.strategy === 'shared_schema') {
                        data.tenant_id = req.tenant.id;
                    }

                    const columns = Object.keys(data);
                    const values = Object.values(data);
                    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

                    const query = `
                        INSERT INTO ${tableName} (${columns.join(', ')})
                        VALUES (${placeholders})
                        RETURNING *
                    `;
                    
                    return await this.tenantManager.executeQuery(req.tenant.id, query, values);
                },

                // Update records with tenant filtering
                update: async (tableName, data, conditions) => {
                    // Add tenant filtering for shared schema strategy
                    if (req.tenant.strategy === 'shared_schema') {
                        conditions.tenant_id = req.tenant.id;
                    }

                    const setClause = Object.keys(data)
                        .map((key, i) => `${key} = $${i + 1}`)
                        .join(', ');
                    
                    const whereConditions = Object.keys(conditions)
                        .map((key, i) => `${key} = $${Object.keys(data).length + i + 1}`)
                        .join(' AND ');

                    const params = [...Object.values(data), ...Object.values(conditions)];
                    
                    const query = `
                        UPDATE ${tableName} 
                        SET ${setClause} 
                        WHERE ${whereConditions}
                        RETURNING *
                    `;
                    
                    return await this.tenantManager.executeQuery(req.tenant.id, query, params);
                },

                // Delete records with tenant filtering
                delete: async (tableName, conditions) => {
                    // Add tenant filtering for shared schema strategy
                    if (req.tenant.strategy === 'shared_schema') {
                        conditions.tenant_id = req.tenant.id;
                    }

                    const whereConditions = Object.keys(conditions)
                        .map((key, i) => `${key} = $${i + 1}`)
                        .join(' AND ');

                    const params = Object.values(conditions);
                    
                    const query = `DELETE FROM ${tableName} WHERE ${whereConditions} RETURNING *`;
                    
                    return await this.tenantManager.executeQuery(req.tenant.id, query, params);
                }
            };

            next();
        };
    }

    /**
     * Tenant rate limiting middleware
     */
    tenantRateLimit() {
        const rateLimitMap = new Map();

        return (req, res, next) => {
            const tenantId = req.tenant.id;
            const tenantConfig = req.tenant.config;
            
            // Get current request count for this tenant
            const key = `${tenantId}_${Math.floor(Date.now() / (60 * 1000))}`; // Per minute
            const currentCount = rateLimitMap.get(key) || 0;
            
            // Check tenant-specific limits
            let limit = 100; // Default limit per minute
            
            if (tenantConfig.subscription_plan === 'premium') {
                limit = 500;
            } else if (tenantConfig.subscription_plan === 'enterprise') {
                limit = 1000;
            }
            
            if (currentCount >= limit) {
                return res.status(429).json({
                    success: false,
                    error: 'Rate limit exceeded for tenant',
                    limit: limit,
                    retryAfter: '60 seconds'
                });
            }
            
            // Increment counter
            rateLimitMap.set(key, currentCount + 1);
            
            // Cleanup old entries (simple cleanup)
            if (rateLimitMap.size > 1000) {
                const cutoff = Math.floor(Date.now() / (60 * 1000)) - 5;
                for (const [k] of rateLimitMap) {
                    if (parseInt(k.split('_')[1]) < cutoff) {
                        rateLimitMap.delete(k);
                    }
                }
            }
            
            next();
        };
    }

    /**
     * Tenant resource validation middleware
     * Ensures tenant doesn't exceed their plan limits
     */
    tenantResourceValidation() {
        return async (req, res, next) => {
            const tenantConfig = req.tenant.config;
            
            try {
                // Check table limits for QR code generation
                if (req.path.includes('/qr/generate') && req.method === 'POST') {
                    const currentTableCount = await this.getCurrentTableCount(req.tenant.id);
                    const requestedTables = req.body.tables ? req.body.tables.length : 1;
                    
                    if (currentTableCount + requestedTables > tenantConfig.max_tables) {
                        return res.status(403).json({
                            success: false,
                            error: 'Table limit exceeded',
                            current: currentTableCount,
                            limit: tenantConfig.max_tables,
                            requested: requestedTables
                        });
                    }
                }
                
                // Check daily order limits
                if (req.path.includes('/orders') && req.method === 'POST') {
                    const todayOrders = await this.getTodayOrderCount(req.tenant.id);
                    
                    if (todayOrders >= tenantConfig.max_orders_per_day) {
                        return res.status(403).json({
                            success: false,
                            error: 'Daily order limit exceeded',
                            limit: tenantConfig.max_orders_per_day
                        });
                    }
                }
                
                next();
                
            } catch (error) {
                console.error('Resource validation error:', error);
                next(); // Don't block on validation errors
            }
        };
    }

    /**
     * Helper methods
     */
    async getCurrentTableCount(tenantId) {
        const metrics = await this.tenantManager.getTenantMetrics(tenantId);
        return metrics.totalTables;
    }

    async getTodayOrderCount(tenantId) {
        const connection = await this.tenantManager.getTenantConnection(tenantId);
        const tenantConfig = this.tenantManager.tenantConfigs.get(tenantId);
        
        let query;
        let params = [];
        
        if (tenantConfig.tenant_strategy === 'shared_schema') {
            query = `SELECT COUNT(*) as count FROM session_orders WHERE tenant_id = $1 AND DATE(ordered_at) = CURRENT_DATE`;
            params = [tenantId];
        } else {
            query = `SELECT COUNT(*) as count FROM session_orders WHERE DATE(ordered_at) = CURRENT_DATE`;
        }
        
        const result = await connection.client.query(query, params);
        return parseInt(result.rows[0].count);
    }

    /**
     * Error handler for tenant-specific errors
     */
    tenantErrorHandler() {
        return (err, req, res, next) => {
            console.error('Tenant-specific error:', {
                tenantId: req.tenant?.id,
                error: err.message,
                stack: err.stack
            });

            // Log error for tenant
            if (req.tenant?.id) {
                this.tenantManager.logTenantActivity(req.tenant.id, 'error', {
                    endpoint: req.path,
                    error: err.message,
                    stack: err.stack.substring(0, 500)
                }).catch(console.error);
            }

            res.status(500).json({
                success: false,
                error: 'Internal server error',
                tenantId: req.tenant?.id,
                timestamp: new Date().toISOString()
            });
        };
    }
}

module.exports = TenantMiddleware;