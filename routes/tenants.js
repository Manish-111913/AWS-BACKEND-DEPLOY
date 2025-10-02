/**
 * Tenant Management API Routes
 * Provides endpoints for creating, managing, and configuring tenants
 * Supports all three multitenant strategies
 */

const express = require('express');
const router = express.Router();

/**
 * GET /api/tenants
 * List all tenants (admin only)
 */
router.get('/', async (req, res) => {
    try {
        const { page = 1, limit = 10, status, strategy } = req.query;
        const offset = (page - 1) * limit;
        
        let whereConditions = [];
        let params = [];
        let paramCount = 1;
        
        if (status) {
            whereConditions.push(`status = $${paramCount++}`);
            params.push(status);
        }
        
        if (strategy) {
            whereConditions.push(`tenant_strategy = $${paramCount++}`);
            params.push(strategy);
        }
        
        const whereClause = whereConditions.length > 0 ? 
            `WHERE ${whereConditions.join(' AND ')}` : '';
        
        const query = `
            SELECT 
                tenant_id, name, tenant_strategy, status, 
                subscription_plan, max_tables, max_users,
                created_at, last_login_at, contact_email
            FROM tenants 
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT $${paramCount} OFFSET $${paramCount + 1}
        `;
        
        params.push(limit, offset);
        
        const result = await req.masterDb.query(query, params);
        
        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM tenants ${whereClause}`;
        const countResult = await req.masterDb.query(countQuery, params.slice(0, -2));
        
        res.json({
            success: true,
            tenants: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: parseInt(countResult.rows[0].total),
                totalPages: Math.ceil(countResult.rows[0].total / limit)
            }
        });
        
    } catch (error) {
        console.error('Error listing tenants:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list tenants',
            details: error.message
        });
    }
});

/**
 * POST /api/tenants
 * Create a new tenant
 */
router.post('/', async (req, res) => {
    try {
        const {
            tenant_id,
            name,
            tenant_strategy = 'shared_schema',
            contact_name,
            contact_email,
            max_tables = 50,
            max_users = 10,
            subscription_plan = 'basic'
        } = req.body;
        
        // Validate required fields
        if (!tenant_id || !name || !contact_email) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: tenant_id, name, contact_email'
            });
        }
        
        // Validate tenant strategy
        const validStrategies = ['shared_schema', 'separate_schema', 'separate_database'];
        if (!validStrategies.includes(tenant_strategy)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid tenant_strategy',
                validStrategies
            });
        }
        
        // Create tenant using MultiTenantManager
        const tenant = await req.tenantManager.createTenant({
            tenant_id,
            name,
            tenant_strategy,
            contact_name,
            contact_email,
            max_tables,
            max_users,
            subscription_plan
        });
        
        res.status(201).json({
            success: true,
            message: 'Tenant created successfully',
            tenant: {
                tenant_id: tenant.tenant_id,
                name: tenant.name,
                tenant_strategy: tenant.tenant_strategy,
                api_key: tenant.api_key,
                status: tenant.status,
                created_at: tenant.created_at
            }
        });
        
    } catch (error) {
        console.error('Error creating tenant:', error);
        
        if (error.code === '23505') { // Unique violation
            return res.status(409).json({
                success: false,
                error: 'Tenant ID already exists'
            });
        }
        
        res.status(500).json({
            success: false,
            error: 'Failed to create tenant',
            details: error.message
        });
    }
});

/**
 * GET /api/tenants/:tenantId
 * Get tenant details
 */
router.get('/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        
        const result = await req.masterDb.query(`
            SELECT * FROM tenants WHERE tenant_id = $1
        `, [tenantId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Tenant not found'
            });
        }
        
        const tenant = result.rows[0];
        
        // Remove sensitive information
        delete tenant.api_key;
        delete tenant.db_password_encrypted;
        
        // Get tenant metrics
        try {
            const metrics = await req.tenantManager.getTenantMetrics(tenantId);
            tenant.metrics = metrics;
        } catch (error) {
            console.warn(`Could not get metrics for tenant ${tenantId}:`, error.message);
            tenant.metrics = null;
        }
        
        res.json({
            success: true,
            tenant
        });
        
    } catch (error) {
        console.error('Error getting tenant:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get tenant details',
            details: error.message
        });
    }
});

/**
 * PUT /api/tenants/:tenantId
 * Update tenant configuration
 */
router.put('/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const updates = req.body;
        
        // Remove sensitive fields that shouldn't be updated via API
        delete updates.api_key;
        delete updates.db_password_encrypted;
        delete updates.created_at;
        
        // Validate tenant strategy if being updated
        if (updates.tenant_strategy) {
            const validStrategies = ['shared_schema', 'separate_schema', 'separate_database'];
            if (!validStrategies.includes(updates.tenant_strategy)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid tenant_strategy',
                    validStrategies
                });
            }
        }
        
        // Build update query
        const setClause = Object.keys(updates)
            .map((key, i) => `${key} = $${i + 2}`)
            .join(', ');
        
        if (!setClause) {
            return res.status(400).json({
                success: false,
                error: 'No valid fields to update'
            });
        }
        
        const values = [tenantId, ...Object.values(updates)];
        
        const result = await req.masterDb.query(`
            UPDATE tenants 
            SET ${setClause}, updated_at = CURRENT_TIMESTAMP 
            WHERE tenant_id = $1
            RETURNING *
        `, values);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Tenant not found'
            });
        }
        
        // Update cached configuration
        await req.tenantManager.loadTenantConfigurations();
        
        const updatedTenant = result.rows[0];
        delete updatedTenant.api_key;
        delete updatedTenant.db_password_encrypted;
        
        res.json({
            success: true,
            message: 'Tenant updated successfully',
            tenant: updatedTenant
        });
        
    } catch (error) {
        console.error('Error updating tenant:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update tenant',
            details: error.message
        });
    }
});

/**
 * DELETE /api/tenants/:tenantId
 * Delete/deactivate tenant
 */
router.delete('/:tenantId', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { force = false } = req.query;
        
        if (force === 'true') {
            // Hard delete (use with extreme caution)
            const result = await req.masterDb.query(`
                DELETE FROM tenants WHERE tenant_id = $1 RETURNING *
            `, [tenantId]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Tenant not found'
                });
            }
            
            // Update cache
            await req.tenantManager.loadTenantConfigurations();
            
            res.json({
                success: true,
                message: 'Tenant permanently deleted'
            });
        } else {
            // Soft delete (deactivate)
            const result = await req.masterDb.query(`
                UPDATE tenants 
                SET status = 'terminated', updated_at = CURRENT_TIMESTAMP
                WHERE tenant_id = $1
                RETURNING *
            `, [tenantId]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Tenant not found'
                });
            }
            
            // Update cache
            await req.tenantManager.loadTenantConfigurations();
            
            res.json({
                success: true,
                message: 'Tenant deactivated successfully'
            });
        }
        
    } catch (error) {
        console.error('Error deleting tenant:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete tenant',
            details: error.message
        });
    }
});

/**
 * POST /api/tenants/:tenantId/regenerate-api-key
 * Regenerate API key for tenant
 */
router.post('/:tenantId/regenerate-api-key', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const crypto = require('crypto');
        const newApiKey = crypto.randomBytes(32).toString('hex');
        
        const result = await req.masterDb.query(`
            UPDATE tenants 
            SET api_key = $1, updated_at = CURRENT_TIMESTAMP
            WHERE tenant_id = $2
            RETURNING tenant_id, name, api_key
        `, [newApiKey, tenantId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Tenant not found'
            });
        }
        
        // Update cache
        await req.tenantManager.loadTenantConfigurations();
        
        res.json({
            success: true,
            message: 'API key regenerated successfully',
            tenant: result.rows[0]
        });
        
    } catch (error) {
        console.error('Error regenerating API key:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to regenerate API key',
            details: error.message
        });
    }
});

/**
 * GET /api/tenants/:tenantId/metrics
 * Get detailed tenant metrics and analytics
 */
router.get('/:tenantId/metrics', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { days = 7 } = req.query;
        
        // Validate tenant exists
        const tenantCheck = await req.masterDb.query(`
            SELECT tenant_id, name, tenant_strategy FROM tenants WHERE tenant_id = $1
        `, [tenantId]);
        
        if (tenantCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Tenant not found'
            });
        }
        
        const tenantInfo = tenantCheck.rows[0];
        
        try {
            // Get basic metrics
            const basicMetrics = await req.tenantManager.getTenantMetrics(tenantId);
            
            // Get activity logs for the specified period
            const activityResult = await req.masterDb.query(`
                SELECT 
                    activity_type,
                    COUNT(*) as count,
                    DATE(created_at) as date
                FROM tenant_activity_logs
                WHERE tenant_id = $1 
                AND created_at >= CURRENT_DATE - INTERVAL '${parseInt(days)} days'
                GROUP BY activity_type, DATE(created_at)
                ORDER BY date DESC, activity_type
            `, [tenantId]);
            
            // Get recent activity
            const recentActivityResult = await req.masterDb.query(`
                SELECT activity_type, activity_description, created_at
                FROM tenant_activity_logs
                WHERE tenant_id = $1
                ORDER BY created_at DESC
                LIMIT 10
            `, [tenantId]);
            
            res.json({
                success: true,
                tenant: tenantInfo,
                metrics: {
                    ...basicMetrics,
                    activityBreakdown: activityResult.rows,
                    recentActivity: recentActivityResult.rows
                },
                period: `${days} days`
            });
            
        } catch (metricsError) {
            console.warn(`Could not get full metrics for tenant ${tenantId}:`, metricsError.message);
            
            // Return basic info even if detailed metrics fail
            res.json({
                success: true,
                tenant: tenantInfo,
                metrics: {
                    message: 'Detailed metrics unavailable',
                    error: metricsError.message
                }
            });
        }
        
    } catch (error) {
        console.error('Error getting tenant metrics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get tenant metrics',
            details: error.message
        });
    }
});

/**
 * POST /api/tenants/:tenantId/migrate-strategy
 * Migrate tenant to different strategy (advanced operation)
 */
router.post('/:tenantId/migrate-strategy', async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { newStrategy, confirmMigration = false } = req.body;
        
        const validStrategies = ['shared_schema', 'separate_schema', 'separate_database'];
        if (!validStrategies.includes(newStrategy)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid new strategy',
                validStrategies
            });
        }
        
        // Get current tenant configuration
        const tenantResult = await req.masterDb.query(`
            SELECT * FROM tenants WHERE tenant_id = $1
        `, [tenantId]);
        
        if (tenantResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Tenant not found'
            });
        }
        
        const currentTenant = tenantResult.rows[0];
        
        if (currentTenant.tenant_strategy === newStrategy) {
            return res.status(400).json({
                success: false,
                error: 'Tenant is already using the specified strategy'
            });
        }
        
        if (!confirmMigration) {
            return res.json({
                success: true,
                message: 'Migration plan prepared',
                currentStrategy: currentTenant.tenant_strategy,
                newStrategy: newStrategy,
                warning: 'This operation will migrate tenant data and may cause downtime',
                instructions: 'Set confirmMigration=true to proceed with migration'
            });
        }
        
        // TODO: Implement actual migration logic
        // This is a complex operation that would involve:
        // 1. Data migration between strategies
        // 2. Schema creation/modification
        // 3. Connection updates
        // 4. Validation
        
        res.json({
            success: false,
            error: 'Strategy migration not yet implemented',
            message: 'This feature requires manual migration process'
        });
        
    } catch (error) {
        console.error('Error migrating tenant strategy:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to migrate tenant strategy',
            details: error.message
        });
    }
});

module.exports = router;