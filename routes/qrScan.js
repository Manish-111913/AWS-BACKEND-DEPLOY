const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/database');
const router = express.Router();

// Utility functions (same as in qrCodes.js)
const generateSessionId = () => {
    return crypto.randomBytes(32).toString('hex');
};

const detectDeviceType = (userAgent) => {
    if (!userAgent) return 'unknown';
    if (/tablet|ipad/i.test(userAgent)) return 'tablet';
    if (/mobile|android|iphone/i.test(userAgent)) return 'mobile';
    return 'desktop';
};

const extractBrowserName = (userAgent) => {
    if (!userAgent) return 'unknown';
    if (userAgent.includes('Chrome')) return 'Chrome';
    if (userAgent.includes('Firefox')) return 'Firefox';
    if (userAgent.includes('Safari')) return 'Safari';
    if (userAgent.includes('Edge')) return 'Edge';
    return 'other';
};

/**
 * Record QR code scan for analytics
 */
const recordScan = async (client, scanData) => {
    try {
        await client.query(`
            INSERT INTO qr_scans (
                qr_code_id, session_id, table_number, user_agent, device_type, 
                browser_name, ip_address, referrer, action_taken, redirect_url, response_time_ms
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
            scanData.qr_code_id,
            scanData.session_id,
            scanData.table_number,
            scanData.user_agent,
            scanData.device_type,
            scanData.browser_name,
            scanData.ip_address,
            scanData.referrer,
            scanData.action_taken,
            scanData.redirect_url,
            scanData.response_time_ms
        ]);
    } catch (error) {
        console.error('Failed to record scan:', error);
        // Don't throw error - analytics failure shouldn't break the flow
    }
};

/**
 * GET /qr/:qrId
 * The main QR code anchor endpoint - this is what users scan
 * This handles the dynamic redirection logic based on table status
 */
router.get('/:qrId', async (req, res) => {
    const startTime = Date.now();
    const client = await pool.connect();
    
    try {
        const { qrId } = req.params;
        const userAgent = req.get('User-Agent');
        const deviceType = detectDeviceType(userAgent);
        const browserName = extractBrowserName(userAgent);
        const ipAddress = req.ip || req.connection.remoteAddress;
        const referrer = req.get('Referer');
        
        // Step 1: Validate QR code and get table info
        const qrResult = await client.query(`
            SELECT 
                qc.id as qr_code_id,
                qc.table_number,
                qc.business_id,
                qc.is_active as qr_active,
                qs.base_url,
                qs.default_billing_model,
                qs.custom_redirect_inactive,
                qs.custom_redirect_error
            FROM qr_codes qc
            LEFT JOIN qr_settings qs ON qs.business_id = qc.business_id
            WHERE qc.qr_id = $1
        `, [qrId]);
        
        if (qrResult.rows.length === 0) {
            // Invalid QR code
            const scanData = {
                qr_code_id: null,
                session_id: null,
                table_number: 'UNKNOWN',
                user_agent: userAgent,
                device_type: deviceType,
                browser_name: browserName,
                ip_address: ipAddress,
                referrer: referrer,
                action_taken: 'invalid_qr',
                redirect_url: null,
                response_time_ms: Date.now() - startTime
            };
            
            return res.status(404).render('error', {
                title: 'Invalid QR Code',
                message: 'This QR code is not valid or has expired.',
                supportMessage: 'Please contact the restaurant staff for assistance.'
            });
        }
        
        const qrData = qrResult.rows[0];
        
        // Step 2: Check if QR code is active
        if (!qrData.qr_active) {
            await recordScan(client, {
                qr_code_id: qrData.qr_code_id,
                session_id: null,
                table_number: qrData.table_number,
                user_agent: userAgent,
                device_type: deviceType,
                browser_name: browserName,
                ip_address: ipAddress,
                referrer: referrer,
                action_taken: 'table_inactive',
                redirect_url: qrData.custom_redirect_inactive,
                response_time_ms: Date.now() - startTime
            });
            
            if (qrData.custom_redirect_inactive) {
                return res.redirect(qrData.custom_redirect_inactive);
            }
            
            return res.render('table-unavailable', {
                tableNumber: qrData.table_number,
                message: 'This table is currently not available.',
                supportMessage: 'Please choose another table or contact staff for assistance.'
            });
        }
        
        // Step 3: Check for existing active session
        const sessionResult = await client.query(`
            SELECT 
                id as session_db_id,
                session_id,
                session_url,
                billing_model,
                customer_count,
                total_amount,
                started_at,
                last_activity
            FROM dining_sessions
            WHERE qr_code_id = $1 AND is_active = TRUE
            ORDER BY started_at DESC
            LIMIT 1
        `, [qrData.qr_code_id]);
        
        if (sessionResult.rows.length > 0) {
            // Existing active session found
            const session = sessionResult.rows[0];
            
            // Update last activity
            await client.query(`
                UPDATE dining_sessions 
                SET last_activity = CURRENT_TIMESTAMP 
                WHERE id = $1
            `, [session.session_db_id]);
            
            const redirectUrl = session.session_url || 
                `${qrData.base_url}/session/${session.session_id}`;
            
            await recordScan(client, {
                qr_code_id: qrData.qr_code_id,
                session_id: session.session_db_id,
                table_number: qrData.table_number,
                user_agent: userAgent,
                device_type: deviceType,
                browser_name: browserName,
                ip_address: ipAddress,
                referrer: referrer,
                action_taken: 'joined_existing',
                redirect_url: redirectUrl,
                response_time_ms: Date.now() - startTime
            });
            
            return res.redirect(redirectUrl);
        }
        
        // Step 4: No active session - create new one
        await client.query('BEGIN');
        
        const sessionId = generateSessionId();
        const sessionUrl = `${qrData.base_url}/session/${sessionId}`;
        
        const newSessionResult = await client.query(`
            INSERT INTO dining_sessions (
                session_id, qr_code_id, table_number, business_id, 
                billing_model, session_url, started_at, last_activity
            ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            RETURNING id as session_db_id
        `, [
            sessionId,
            qrData.qr_code_id,
            qrData.table_number,
            qrData.business_id,
            qrData.default_billing_model,
            sessionUrl
        ]);
        
        const newSessionDbId = newSessionResult.rows[0].session_db_id;
        
        await recordScan(client, {
            qr_code_id: qrData.qr_code_id,
            session_id: newSessionDbId,
            table_number: qrData.table_number,
            user_agent: userAgent,
            device_type: deviceType,
            browser_name: browserName,
            ip_address: ipAddress,
            referrer: referrer,
            action_taken: 'new_session',
            redirect_url: sessionUrl,
            response_time_ms: Date.now() - startTime
        });
        
        await client.query('COMMIT');
        
        // Redirect to new session
        res.redirect(sessionUrl);
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('QR Scan Error:', error);
        
        // Record error scan if possible
        try {
            await recordScan(client, {
                qr_code_id: null,
                session_id: null,
                table_number: 'ERROR',
                user_agent: req.get('User-Agent'),
                device_type: detectDeviceType(req.get('User-Agent')),
                browser_name: extractBrowserName(req.get('User-Agent')),
                ip_address: req.ip,
                referrer: req.get('Referer'),
                action_taken: 'error',
                redirect_url: null,
                response_time_ms: Date.now() - startTime
            });
        } catch (recordError) {
            console.error('Failed to record error scan:', recordError);
        }
        
        res.status(500).render('error', {
            title: 'Service Temporarily Unavailable',
            message: 'We are experiencing a temporary issue.',
            supportMessage: 'Please try again in a moment or contact restaurant staff.'
        });
        
    } finally {
        client.release();
    }
});

/**
 * GET /session/:sessionId
 * Handle session-specific URLs
 * This is where customers land after scanning QR codes
 */
router.get('/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        // Get session details
        const sessionResult = await pool.query(`
            SELECT 
                ds.id,
                ds.session_id,
                ds.table_number,
                ds.business_id,
                ds.billing_model,
                ds.customer_count,
                ds.total_amount,
                ds.final_amount,
                ds.payment_status,
                ds.started_at,
                ds.is_active,
                qc.qr_id,
                qc.table_number as qr_table
            FROM dining_sessions ds
            JOIN qr_codes qc ON qc.id = ds.qr_code_id
            WHERE ds.session_id = $1
        `, [sessionId]);
        
        if (sessionResult.rows.length === 0) {
            return res.status(404).render('session-not-found', {
                title: 'Session Not Found',
                message: 'This dining session is not valid or has expired.'
            });
        }
        
        const session = sessionResult.rows[0];
        
        if (!session.is_active) {
            return res.render('session-ended', {
                title: 'Session Ended',
                tableNumber: session.table_number,
                message: 'This dining session has ended.',
                totalAmount: session.final_amount
            });
        }
        
        // Update last activity
        await pool.query(`
            UPDATE dining_sessions 
            SET last_activity = CURRENT_TIMESTAMP 
            WHERE session_id = $1
        `, [sessionId]);
        
        // Get session orders
        const ordersResult = await pool.query(`
            SELECT 
                id,
                menu_item_id,
                item_name,
                quantity,
                unit_price,
                total_price,
                special_instructions,
                order_status,
                ordered_at
            FROM session_orders
            WHERE session_id = $1
            ORDER BY ordered_at DESC
        `, [session.id]);
        
        // Render the dining session page
        res.render('dining-session', {
            session: session,
            orders: ordersResult.rows,
            canOrder: session.billing_model === 'eat_first',
            showPayment: session.billing_model === 'eat_first' && session.total_amount > 0
        });
        
    } catch (error) {
        console.error('Session Error:', error);
        res.status(500).render('error', {
            title: 'Service Error',
            message: 'Unable to load your dining session.',
            supportMessage: 'Please try scanning the QR code again.'
        });
    }
});

/**
 * POST /session/:sessionId/order
 * Add items to session order
 */
router.post('/session/:sessionId/order', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { sessionId } = req.params;
        const { items } = req.body; // Array of {menu_item_id, item_name, quantity, unit_price, special_instructions}
        
        // Validate session
        const sessionResult = await client.query(`
            SELECT id, table_number, billing_model, is_active
            FROM dining_sessions
            WHERE session_id = $1
        `, [sessionId]);
        
        if (sessionResult.rows.length === 0 || !sessionResult.rows[0].is_active) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Session not found or inactive'
            });
        }
        
        const session = sessionResult.rows[0];
        
        if (session.billing_model !== 'eat_first') {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Orders can only be placed in "eat first" billing model'
            });
        }
        
        // Add items to session
        const orderIds = [];
        let totalAmount = 0;
        
        for (const item of items) {
            const itemTotal = parseFloat(item.unit_price) * parseInt(item.quantity);
            totalAmount += itemTotal;
            
            const orderResult = await client.query(`
                INSERT INTO session_orders (
                    session_id, menu_item_id, item_name, quantity, 
                    unit_price, total_price, special_instructions
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id
            `, [
                session.id,
                item.menu_item_id || null,
                item.item_name,
                item.quantity,
                item.unit_price,
                itemTotal,
                item.special_instructions || null
            ]);
            
            orderIds.push(orderResult.rows[0].id);
        }
        
        // Update session total
        await client.query(`
            UPDATE dining_sessions
            SET 
                total_amount = total_amount + $1,
                final_amount = total_amount + $1,
                last_activity = CURRENT_TIMESTAMP
            WHERE id = $2
        `, [totalAmount, session.id]);
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: `Added ${items.length} items to order`,
            orderIds: orderIds,
            addedAmount: totalAmount
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Order Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add items to order',
            details: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * POST /session/:sessionId/end
 * End a dining session (payment complete)
 */
router.post('/session/:sessionId/end', async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { sessionId } = req.params;
        const { paymentMethod, paidAmount } = req.body;
        
        // Update session to ended
        const updateResult = await client.query(`
            UPDATE dining_sessions
            SET 
                is_active = FALSE,
                ended_at = CURRENT_TIMESTAMP,
                payment_status = 'paid'
            WHERE session_id = $1 AND is_active = TRUE
            RETURNING id, table_number, final_amount
        `, [sessionId]);
        
        if (updateResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Session not found or already ended'
            });
        }
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: 'Session ended successfully',
            session: updateResult.rows[0]
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('End Session Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to end session',
            details: error.message
        });
    } finally {
        client.release();
    }
});

module.exports = router;