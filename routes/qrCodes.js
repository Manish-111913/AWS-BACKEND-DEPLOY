const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/database');
const router = express.Router();

// Utility function to generate secure random QR ID
const generateQRId = () => {
    return crypto.randomBytes(16).toString('hex'); // 32 character hex string
};

// Utility function to generate session ID
const generateSessionId = () => {
    return crypto.randomBytes(32).toString('hex'); // 64 character hex string
};

// Utility function to detect device type from user agent
const detectDeviceType = (userAgent) => {
    if (!userAgent) return 'unknown';
    
    if (/tablet|ipad/i.test(userAgent)) return 'tablet';
    if (/mobile|android|iphone/i.test(userAgent)) return 'mobile';
    return 'desktop';
};

// Utility function to extract browser name
const extractBrowserName = (userAgent) => {
    if (!userAgent) return 'unknown';
    
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return 'other';
};

/**
 * POST /api/qr/generate
 * Generate QR codes for tables
 * Body: {
 *   tables: ["T1", "T2", "T3"] or { start: 1, end: 10, prefix: "T" }
 *   businessId: 1 (optional)
 * }
 */
router.post('/generate', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Resolve businessId from headers/query/body with fallback default
        const headerBid = req.headers['x-business-id'] || req.headers['x-tenant-id'] || req.headers['x-bid'];
        const queryBid = req.query?.businessId || req.query?.tenantId;
        const bodyBid = req.body?.businessId || req.body?.tenantId;
        const resolvedBusinessId = parseInt(bodyBid || queryBid || headerBid || req.body?.businessId || 1, 10) || 1;

        // Ensure tenant context for this transaction
        try {
            await client.query("SELECT set_config('app.current_tenant', $1, true)", [String(resolvedBusinessId)]);
            await client.query("SELECT set_config('app.current_business_id', $1, true)", [String(resolvedBusinessId)]);
            console.log(`✅ Set tenant context for business_id: ${resolvedBusinessId}`);
        } catch (e) {
            console.warn('⚠️ Failed to set tenant GUC in /api/qr/generate:', e.message);
        }

        const { tables } = req.body;
        const businessId = resolvedBusinessId;
        let tableNumbers = [];
        
        // Handle different input formats
        if (Array.isArray(tables)) {
            tableNumbers = tables;
        } else if (tables && tables.start && tables.end) {
            const { start, end, prefix = 'T' } = tables;
            for (let i = start; i <= end; i++) {
                tableNumbers.push(`${prefix}${i}`);
            }
        } else {
            return res.status(400).json({
                success: false,
                error: 'Invalid input format. Provide either an array of table numbers or {start, end, prefix}'
            });
        }
        
    // Get base URL from settings (kept for future use)
    const settingsResult = await client.query(
        'SELECT base_url FROM qr_settings WHERE business_id = $1',
        [businessId]
    );
    // Public backend origin where scanner is hosted
    const backendOrigin = (process.env.BACKEND_PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
        
        const generatedQRs = [];
        const errors = [];
        
        for (const tableNumber of tableNumbers) {
            try {
                // Check if table already exists
                const existingCheck = await client.query(
                    'SELECT id, qr_id, anchor_url FROM qr_codes WHERE table_number = $1 AND business_id = $2',
                    [tableNumber, businessId]
                );
                
                if (existingCheck.rows.length > 0) {
                    errors.push({
                        table: tableNumber,
                        error: 'Table already has a QR code',
                        existing: existingCheck.rows[0]
                    });
                    continue;
                }
                
                // Generate unique QR ID
                const qrId = generateQRId();
                                // Direct link to backend scanner; backend will create session and redirect to menu app
                                const anchorUrl = backendOrigin
                                    ? `${backendOrigin}/qr/${qrId}`
                                    : `${req.protocol}://${req.headers.host}/qr/${qrId}`;
                
                // Insert into database
                const insertResult = await client.query(`
                    INSERT INTO qr_codes (qr_id, table_number, business_id, anchor_url, created_by)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING id, qr_id, table_number, anchor_url, created_at
                `, [qrId, tableNumber, businessId, anchorUrl, req.user?.id || null]);
                
                generatedQRs.push(insertResult.rows[0]);
                
            } catch (error) {
                errors.push({
                    table: tableNumber,
                    error: error.message
                });
            }
        }
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            generated: generatedQRs.length,
            qrCodes: generatedQRs,
            errors: errors
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('QR Generation Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate QR codes',
            details: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * GET /api/qr/list
 * Get all QR codes for a business
 */
router.get('/list', async (req, res) => {
    try {
        const { businessId = 1, includeInactive = false } = req.query;
        
        let query = `
            SELECT 
                qc.id,
                qc.qr_id,
                qc.table_number,
                qc.anchor_url,
                qc.is_active,
                qc.created_at,
                qc.updated_at,
                ds.id as active_session_id,
                ds.session_id as active_session_code,
                ds.is_active as has_active_session,
                ds.started_at as session_started,
                ds.customer_count,
                ds.total_amount as session_total
            FROM qr_codes qc
            LEFT JOIN dining_sessions ds ON qc.id = ds.qr_code_id AND ds.is_active = TRUE
            WHERE qc.business_id = $1
        `;
        
        const params = [businessId];
        
        if (!includeInactive) {
            query += ' AND qc.is_active = TRUE';
        }
        
        query += ' ORDER BY qc.table_number';
        
        const result = await pool.query(query, params);
        
        res.json({
            success: true,
            qrCodes: result.rows
        });
        
    } catch (error) {
        console.error('QR List Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch QR codes',
            details: error.message
        });
    }
});

/**
 * PUT /api/qr/:qrId/toggle
 * Toggle QR code active status
 */
router.put('/:qrId/toggle', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { qrId } = req.params;
        const { isActive } = req.body;
        
        // Update QR code status
        const updateResult = await client.query(`
            UPDATE qr_codes 
            SET is_active = $1, updated_at = CURRENT_TIMESTAMP
            WHERE qr_id = $2
            RETURNING id, table_number, is_active
        `, [isActive, qrId]);
        
        if (updateResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'QR code not found'
            });
        }
        
        const qrCode = updateResult.rows[0];
        
        // If deactivating, also end any active sessions
        if (!isActive) {
            await client.query(`
                UPDATE dining_sessions 
                SET is_active = FALSE, ended_at = CURRENT_TIMESTAMP
                WHERE qr_code_id = $1 AND is_active = TRUE
            `, [qrCode.id]);
        }
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: `QR code for table ${qrCode.table_number} ${isActive ? 'activated' : 'deactivated'}`,
            qrCode: qrCode
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('QR Toggle Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update QR code status',
            details: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * DELETE /api/qr/:qrId
 * Delete a QR code (careful operation!)
 */
router.delete('/:qrId', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { qrId } = req.params;
        const { confirmDelete } = req.body;
        
        if (!confirmDelete) {
            return res.status(400).json({
                success: false,
                error: 'Deletion must be confirmed. Set confirmDelete: true in request body.'
            });
        }
        
        // Check for active sessions
        const activeSessionCheck = await client.query(`
            SELECT ds.id 
            FROM dining_sessions ds
            JOIN qr_codes qc ON qc.id = ds.qr_code_id
            WHERE qc.qr_id = $1 AND ds.is_active = TRUE
        `, [qrId]);
        
        if (activeSessionCheck.rows.length > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Cannot delete QR code with active dining sessions. End sessions first.'
            });
        }
        
        // Delete QR code (cascades to related tables)
        const deleteResult = await client.query(`
            DELETE FROM qr_codes 
            WHERE qr_id = $1
            RETURNING table_number
        `, [qrId]);
        
        if (deleteResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'QR code not found'
            });
        }
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: `QR code for table ${deleteResult.rows[0].table_number} deleted successfully`
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('QR Delete Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete QR code',
            details: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * GET /api/qr/analytics
 * Get QR code scan analytics
 */
router.get('/analytics', async (req, res) => {
    try {
        const { businessId = 1, days = 7, tableNumber } = req.query;
        
        let whereClause = `
            WHERE qc.business_id = $1 
            AND qs.scanned_at >= CURRENT_DATE - INTERVAL '${days} days'
        `;
        
        const params = [businessId];
        
        if (tableNumber) {
            whereClause += ' AND qs.table_number = $2';
            params.push(tableNumber);
        }
        
        // Get scan statistics
        const statsQuery = `
            SELECT 
                COUNT(*) as total_scans,
                COUNT(DISTINCT qs.table_number) as unique_tables,
                COUNT(DISTINCT DATE(qs.scanned_at)) as active_days,
                AVG(qs.response_time_ms) as avg_response_time,
                COUNT(CASE WHEN qs.action_taken = 'new_session' THEN 1 END) as new_sessions,
                COUNT(CASE WHEN qs.action_taken = 'joined_existing' THEN 1 END) as joined_sessions
            FROM qr_scans qs
            JOIN qr_codes qc ON qc.id = qs.qr_code_id
            ${whereClause}
        `;
        
        // Get daily breakdown
        const dailyQuery = `
            SELECT 
                DATE(qs.scanned_at) as scan_date,
                COUNT(*) as daily_scans,
                COUNT(DISTINCT qs.table_number) as unique_tables
            FROM qr_scans qs
            JOIN qr_codes qc ON qc.id = qs.qr_code_id
            ${whereClause}
            GROUP BY DATE(qs.scanned_at)
            ORDER BY scan_date DESC
        `;
        
        // Get device type breakdown
        const deviceQuery = `
            SELECT 
                qs.device_type,
                COUNT(*) as scans
            FROM qr_scans qs
            JOIN qr_codes qc ON qc.id = qs.qr_code_id
            ${whereClause}
            GROUP BY qs.device_type
            ORDER BY scans DESC
        `;
        
        const [statsResult, dailyResult, deviceResult] = await Promise.all([
            pool.query(statsQuery, params),
            pool.query(dailyQuery, params),
            pool.query(deviceQuery, params)
        ]);
        
        res.json({
            success: true,
            analytics: {
                summary: statsResult.rows[0],
                daily: dailyResult.rows,
                devices: deviceResult.rows
            }
        });
        
    } catch (error) {
        console.error('QR Analytics Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch analytics',
            details: error.message
        });
    }
});

/**
 * POST /api/qr/rebuild-anchors
 * Rebuild anchor_url for existing QR codes to point to backend redirect endpoint.
 * Body: { businessId?: number }
 */
router.post('/rebuild-anchors', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const headerBid = req.headers['x-business-id'] || req.headers['x-tenant-id'] || req.headers['x-bid'];
        const bodyBid = req.body?.businessId || req.body?.tenantId;
        const businessId = parseInt(bodyBid || headerBid || 1, 10) || 1;

        // Ensure tenant context for this transaction to satisfy RLS
        try {
            await client.query("SELECT set_config('app.current_tenant', $1, true)", [String(businessId)]);
            await client.query("SELECT set_config('app.current_business_id', $1, true)", [String(businessId)]);
            console.log(`✅ Set tenant context for business_id: ${businessId}`);
        } catch (e) {
            console.warn('⚠️ Failed to set tenant GUC in /api/qr/rebuild-anchors:', e.message);
        }

        const backendOrigin = (process.env.BACKEND_PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
        const rows = (await client.query(
            `SELECT id, qr_id, table_number FROM qr_codes WHERE business_id = $1`,
            [businessId]
        )).rows;

        const updates = [];
        for (const r of rows) {
                        const anchor = backendOrigin
                            ? `${backendOrigin}/qr/${r.qr_id}`
                            : `${req.protocol}://${req.headers.host}/qr/${r.qr_id}`;
            await client.query(`UPDATE qr_codes SET anchor_url = $1 WHERE id = $2`, [anchor, r.id]);
            updates.push({ id: r.id, qr_id: r.qr_id, table_number: r.table_number, anchor_url: anchor });
        }

        await client.query('COMMIT');
        res.json({ success: true, updated: updates.length, qrCodes: updates });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Rebuild anchors failed:', error.message);
        res.status(500).json({ success: false, error: 'Failed to rebuild anchors', details: error.message });
    } finally {
        client.release();
    }
});

/**
 * POST /api/qr/sync-config
 * Reconcile the set of qr_codes rows for a business with the provided table configuration.
 * Body: { businessId?: number, tables: [{ id: 'table-1', name: 'Table 1', isBestSpot?: bool }] }
 * Behavior:
 *  - Ensures each provided table has an active qr_codes row (creates if missing)
 *  - Deactivates qr_codes rows that are NOT in the provided list (instead of deleting for historical safety)
 *  - Does not regenerate qr_id for existing tables; preserves anchor_url (optionally rebuild could be triggered separately)
 */
router.post('/sync-config', async (req, res) => {
    // Reuse tenantContext-attached client if available so GUC stays in same session
    const externalClient = req.dbClient || req.db;
    const client = externalClient || await pool.connect();
    let startedTx = false;
    try {
        // Start transaction (even if reusing) to ensure atomicity
        await client.query('BEGIN');
        startedTx = true;
        const headerBid = req.headers['x-business-id'] || req.headers['x-tenant-id'] || req.headers['x-bid'];
        const bodyBid = req.body?.businessId || req.body?.tenantId;
        const businessId = parseInt(bodyBid || headerBid || 1, 10) || 1;
        const tables = Array.isArray(req.body?.tables) ? req.body.tables : [];
        if (!tables.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'tables array required' });
        }

        // Ensure both tenant GUCs are set in THIS session (middleware client may already have them but be defensive)
        try {
            await client.query("SELECT set_config('app.current_tenant', $1, true)", [String(businessId)]);
            await client.query("SELECT set_config('app.current_business_id', $1, true)", [String(businessId)]);
        } catch (e) { console.warn('sync-config set_config failed', e.message); }

    const backendOrigin = (process.env.BACKEND_PUBLIC_ORIGIN || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
        const existingRes = await client.query(`SELECT id, qr_id, table_number, is_active, anchor_url FROM qr_codes WHERE business_id = $1`, [businessId]);
        const existingByTable = new Map(existingRes.rows.map(r => [String(r.table_number), r]));
        const desiredTables = tables.map(t => {
            let num = null;
            if (t.name) {
                const m = /([0-9]+)$/.exec(String(t.name));
                if (m) num = m[1];
            }
            if (!num && t.id) {
                const m2 = /(\d+)$/.exec(String(t.id));
                if (m2) num = m2[1];
            }
            const table_number = num ? num : (t.id || t.name || '');
            return { raw: t, table_number: String(table_number) };
        }).filter(t => t.table_number);

        const toKeep = new Set(desiredTables.map(t => t.table_number));
        const created = []; const activated = []; const deactivated = []; const unchanged = [];

        for (const dt of desiredTables) {
            const existing = existingByTable.get(dt.table_number);
            if (existing) {
                if (!existing.is_active) {
                    await client.query(`UPDATE qr_codes SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [existing.id]);
                    activated.push({ id: existing.id, table_number: dt.table_number });
                } else {
                    unchanged.push({ id: existing.id, table_number: dt.table_number });
                }
            } else {
                const qrId = generateQRId();
                                const anchorUrl = backendOrigin
                                    ? `${backendOrigin}/qr/${qrId}`
                                    : `${req.protocol}://${req.headers.host}/qr/${qrId}`;
                const ins = await client.query(`
                    INSERT INTO qr_codes (qr_id, table_number, business_id, anchor_url, is_active, created_by)
                    VALUES ($1,$2,$3,$4,TRUE,$5)
                    RETURNING id, qr_id, table_number, anchor_url
                `, [qrId, dt.table_number, businessId, anchorUrl, req.user?.id || null]);
                created.push(ins.rows[0]);
            }
        }
        for (const r of existingRes.rows) {
            if (!toKeep.has(String(r.table_number)) && r.is_active) {
                await client.query(`UPDATE qr_codes SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [r.id]);
                deactivated.push({ id: r.id, table_number: r.table_number });
            }
        }
                // Safety: deactivate older duplicates (same table_number >1 active rows). Keep the most recently created (highest id)
                const dupRows = await client.query(`
                    SELECT table_number
                    FROM qr_codes
                    WHERE business_id = $1 AND is_active = TRUE
                    GROUP BY table_number
                    HAVING COUNT(*) > 1
                `, [businessId]);
                for (const d of dupRows.rows) {
                    const rows = await client.query(`
                        SELECT id FROM qr_codes
                        WHERE business_id = $1 AND table_number = $2 AND is_active = TRUE
                        ORDER BY id DESC
                    `, [businessId, d.table_number]);
                    const keepId = rows.rows[0]?.id;
                    const toDeactivate = rows.rows.slice(1).map(r => r.id);
                    if (toDeactivate.length) {
                        await client.query(`UPDATE qr_codes SET is_active=FALSE, updated_at=CURRENT_TIMESTAMP WHERE id = ANY($1)`, [toDeactivate]);
                        for (const x of toDeactivate) deactivated.push({ id: x, table_number: d.table_number, reason: 'duplicate' });
                    }
                }
        await client.query('COMMIT');
        return res.json({ success: true, summary: { created: created.length, reactivated: activated.length, deactivated: deactivated.length, unchanged: unchanged.length }, created, activated, deactivated, unchanged });
    } catch (e) {
        if (startedTx) {
            try { await client.query('ROLLBACK'); } catch (_) {}
        }
        // Surface clearer RLS guidance
        if (e && e.code === '42501') {
            return res.status(403).json({ success: false, error: 'rls_violation', details: 'Row-Level Security blocked sync. Ensure X-Business-Id header is set and tenant GUC established.', hint: 'Include header X-Business-Id: <id> in request.' });
        }
        console.error('sync-config error', e);
        return res.status(500).json({ success: false, error: 'Failed to sync tables', details: e.message });
    } finally {
        // Release only if we created our own client
        if (!externalClient) {
            try { client.release(); } catch (_) {}
        }
    }
});

module.exports = router;

/**
 * (Optional) Maintenance: POST /api/qr/deactivate-legacy
 * Deactivate legacy QRCodes entries that have no matching active row in new qr_codes table.
 * Body/Headers: businessId or X-Business-Id
 */
router.post('/deactivate-legacy', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const headerBid = req.headers['x-business-id'] || req.headers['x-tenant-id'] || req.headers['x-bid'];
        const bodyBid = req.body?.businessId || req.body?.tenantId;
        const businessId = parseInt(bodyBid || headerBid || 1, 10) || 1;
        await client.query("SELECT set_config('app.current_business_id', $1, true)", [String(businessId)]).catch(()=>{});
        const resNew = await client.query('SELECT table_number FROM qr_codes WHERE business_id=$1 AND is_active=TRUE', [businessId]);
        const keep = new Set(resNew.rows.map(r => String(r.table_number)));
        const legacy = await client.query('SELECT qr_code_id, table_number, is_active FROM QRCodes WHERE business_id=$1 AND is_active=TRUE', [businessId]);
        let deactivated = [];
        for (const row of legacy.rows) {
            if (!keep.has(String(row.table_number))) {
                await client.query('UPDATE QRCodes SET is_active=FALSE WHERE qr_code_id=$1', [row.qr_code_id]);
                deactivated.push({ id: row.qr_code_id, table_number: row.table_number });
            }
        }
        await client.query('COMMIT');
        return res.json({ success: true, deactivated: deactivated.length, rows: deactivated });
    } catch (e) {
        await client.query('ROLLBACK');
        return res.status(500).json({ success: false, error: e.message });
    } finally { client.release(); }
});