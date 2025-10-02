const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Lightweight in-memory cache for calculated ABC responses
// Keyed by businessId + start/end dates (no itemId for full-page list)
const abcCache = new Map();
const ABC_CACHE_TTL_MS = 5000; // 5 seconds TTL for near real-time but responsive UI

function makeCacheKey({ businessId, startDate, endDate, itemId }) {
    // Only cache full calculations (no itemId-specific) to keep logic simple
    return itemId ? null : `${businessId}|${startDate}|${endDate}`;
}

// SSE client registry: businessId -> Set of response streams
const sseClients = new Map();
function getClientBucket(businessId) {
    if (!sseClients.has(businessId)) sseClients.set(businessId, new Set());
    return sseClients.get(businessId);
}
function sseSend(res, event, data) {
    try {
        if (event) res.write(`event: ${event}\n`);
        if (data !== undefined) res.write(`data: ${JSON.stringify(data)}\n`);
        res.write(`\n`);
    } catch (e) {
        // Ignore broken pipe errors
    }
}
function broadcast(businessId, event, data) {
    const bucket = getClientBucket(String(businessId));
    for (const res of bucket) {
        sseSend(res, event, data);
    }
}

// SSE stream for ABC invalidations/updates
router.get('/stream', (req, res) => {
    const businessId = String(req.query.businessId || req.user?.businessId || 1);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders?.();

    // register
    const bucket = getClientBucket(businessId);
    bucket.add(res);

    // initial hello
    sseSend(res, 'hello', { ok: true, businessId });

    // heartbeat to keep connection alive
    const hb = setInterval(() => sseSend(res, 'ping', Date.now()), 25000);

    req.on('close', () => {
        clearInterval(hb);
        bucket.delete(res);
        res.end?.();
    });
});

/**
 * Calculate ABC Analysis for inventory items
 * GET /abc-analysis/calculate
 * Query params (all optional with defaults):
 * - businessId: number (defaults to 1 or from session)
 * - startDate: string (YYYY-MM-DD) (defaults to 30 days ago)
 * - endDate: string (YYYY-MM-DD) (defaults to today)
 * - itemId: number (optional) - to recalculate for specific item
 */
router.get('/calculate', async (req, res) => {
    const client = await pool.connect();
    try {
        // Set defaults if parameters are not provided
        const businessId = req.query.businessId || req.user?.businessId || 1;
        const endDate = req.query.endDate || new Date().toISOString().split('T')[0];
        
        // Use 14-day period by default for more stable ABC analysis
        const defaultAnalysisPeriod = 14; // days
        const startDate = req.query.startDate || new Date(Date.now() - defaultAnalysisPeriod * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const itemId = req.query.itemId || null;

        // Serve from cache when possible
        const cacheKey = makeCacheKey({ businessId, startDate, endDate, itemId });
        const now = Date.now();
        if (cacheKey && abcCache.has(cacheKey)) {
            const entry = abcCache.get(cacheKey);
            if (entry && (now - entry.timestamp) < ABC_CACHE_TTL_MS) {
                res.set('X-Cache', 'HIT');
                return res.json(entry.payload);
            }
        }

        await client.query('BEGIN');

        // Build dynamic query parameters
        const queryParams = [businessId, startDate, endDate];
        const itemFilter = itemId ? 'AND ri.item_id = $4' : '';
    const itemFilter2 = itemId ? 'AND sor.item_id = $4' : '';
        const itemFilter3 = itemId ? 'AND ii.item_id = $4' : '';
        const itemFilter4 = itemId ? 'AND ii.item_id = $4' : '';
        
        if (itemId) {
            queryParams.push(itemId);
        }

        // Step 1: Calculate total consumption value from multiple sources (fixed to prevent duplicates)
    const consumptionQuery = `
            WITH MenuItemSalesAgg AS (
                -- Aggregate sales by menu item first to prevent duplicates
                SELECT 
                    sli.menu_item_id,
                    SUM(sli.quantity_sold) as total_menu_item_sold
                FROM SaleLineItems sli
                JOIN SalesTransactions st ON sli.sale_id = st.sale_id
                WHERE st.business_id = $1
                    AND st.transaction_date BETWEEN $2 AND $3
                GROUP BY sli.menu_item_id
            ),
        MenuItemRecipeUsage AS (
                -- Calculate ingredient usage from recipes (prevent duplicate counting)
                SELECT 
                    ri.item_id,
            SUM(msa.total_menu_item_sold * ri.quantity) as recipe_quantity_used
                FROM MenuItemSalesAgg msa
                JOIN MenuItems mi ON msa.menu_item_id = mi.menu_item_id
                JOIN Recipes r ON mi.menu_item_id = r.recipe_id
                JOIN RecipeIngredients ri ON r.recipe_id = ri.recipe_id
                WHERE 1=1 ${itemFilter}
                GROUP BY ri.item_id
            ),
            StockOutUsage AS (
                -- Direct usage recorded via StockOutRecords (reason_type = 'Usage')
                SELECT 
                    sor.item_id,
                    COALESCE(SUM(sor.quantity), 0) AS direct_quantity_used
                FROM StockOutRecords sor
                WHERE sor.business_id = $1
                  AND sor.reason_type = 'Usage'
                  AND COALESCE(sor.deducted_date::date, sor.created_at::date) BETWEEN $2 AND $3
                  AND sor.item_type = 'InventoryItem'
                  ${itemFilter2}
                GROUP BY sor.item_id
            ),
            TotalUsage AS (
                -- Combine both consumption sources with proper aggregation
                SELECT 
                    COALESCE(mr.item_id, su.item_id) as item_id,
                    COALESCE(mr.recipe_quantity_used, 0) + COALESCE(su.direct_quantity_used, 0) as total_quantity_used
                FROM MenuItemRecipeUsage mr
                FULL OUTER JOIN StockOutUsage su ON mr.item_id = su.item_id
                WHERE COALESCE(mr.recipe_quantity_used, 0) + COALESCE(su.direct_quantity_used, 0) > 0
            ),
            ItemCosts AS (
                -- Calculate weighted average cost per unit from recent batches
                SELECT 
                    ib.item_id,
                    CASE 
                        WHEN SUM(ib.quantity) > 0 THEN 
                            SUM(ib.unit_cost * ib.quantity) / SUM(ib.quantity)
                        ELSE AVG(ib.unit_cost)
                    END as avg_unit_cost
                FROM InventoryBatches ib
                JOIN InventoryItems ii ON ib.item_id = ii.item_id
                WHERE ii.business_id = $1
                    AND ib.quantity > 0
                    ${itemFilter3}
                GROUP BY ib.item_id
            ),
                        MonthlyWastage AS (
                                -- Real-time wastage (current month) from WastageRecords per schema
                                SELECT 
                                        wr.item_id,
                                        COALESCE(SUM(wr.quantity), 0) AS waste_month_qty
                                FROM WastageRecords wr
                                WHERE wr.business_id = $1
                                    AND wr.created_at >= date_trunc('month', CURRENT_DATE)
                                    AND wr.created_at < date_trunc('month', CURRENT_DATE) + interval '1 month'
                                GROUP BY wr.item_id
                        ),
            LatestCost AS (
                -- Latest received unit cost per item (most recent batch)
                SELECT DISTINCT ON (ib.item_id)
                    ib.item_id,
                    ib.unit_cost as latest_unit_cost,
                    COALESCE(ib.received_date, ib.created_at::date) as last_received_date
                FROM InventoryBatches ib
                ORDER BY ib.item_id, COALESCE(ib.received_date, ib.created_at::date) DESC, ib.created_at DESC
            ),
            StockOutTotals AS (
                -- Total stock out (Usage + Waste) per item across all time for this business
                SELECT 
                    sor.item_id,
                    COALESCE(SUM(sor.quantity), 0) AS total_out_qty
                FROM StockOutRecords sor
                WHERE sor.business_id = $1
                  AND sor.item_type = 'InventoryItem'
                  AND sor.reason_type IN ('Usage','Waste')
                GROUP BY sor.item_id
            ),
            CurrentStock AS (
                -- Derive current stock = non-expired batch qty - total stock-out qty
                SELECT 
                    ib.item_id,
                    GREATEST(
                        COALESCE(SUM(CASE WHEN ib.is_expired = false THEN ib.quantity ELSE 0 END), 0)
                        - COALESCE(so.total_out_qty, 0),
                        0
                    ) AS current_stock
                FROM InventoryBatches ib
                LEFT JOIN StockOutTotals so ON so.item_id = ib.item_id
                GROUP BY ib.item_id, so.total_out_qty
            ),
            PeriodPersisted AS (
                -- Persisted categories for this business and period
                SELECT item_id, abc_category
                FROM ABCAnalysisResults
                WHERE business_id = $1 AND start_date = $2 AND end_date = $3
            ),
            LatestPersisted AS (
                -- Fallback: latest known category per item across any period
                SELECT DISTINCT ON (item_id)
                    item_id, abc_category
                FROM ABCAnalysisResults
                WHERE business_id = $1
                ORDER BY item_id, created_at DESC
            ),
            -- Monthly aggregates (current calendar month)
            MonthMenuItemSalesAgg AS (
                SELECT 
                    sli.menu_item_id,
                    SUM(sli.quantity_sold) as total_menu_item_sold
                FROM SaleLineItems sli
                JOIN SalesTransactions st ON sli.sale_id = st.sale_id
                WHERE st.business_id = $1
                    AND COALESCE(st.transaction_date, st.created_at::date) >= date_trunc('month', CURRENT_DATE)
                    AND COALESCE(st.transaction_date, st.created_at::date) < date_trunc('month', CURRENT_DATE) + interval '1 month'
                GROUP BY sli.menu_item_id
            ),
            MonthRecipeUsage AS (
                SELECT 
                    ri.item_id,
                    SUM(mmsa.total_menu_item_sold * ri.quantity) as recipe_quantity_used
                FROM MonthMenuItemSalesAgg mmsa
                JOIN MenuItems mi ON mmsa.menu_item_id = mi.menu_item_id
                JOIN Recipes r ON mi.menu_item_id = r.recipe_id
                JOIN RecipeIngredients ri ON r.recipe_id = ri.recipe_id
                GROUP BY ri.item_id
            ),
            MonthStockOutUsage AS (
                SELECT 
                    sor.item_id,
                    COALESCE(SUM(sor.quantity), 0) AS direct_quantity_used
                FROM StockOutRecords sor
                WHERE sor.business_id = $1
                  AND sor.reason_type = 'Usage'
                  AND COALESCE(sor.deducted_date::date, sor.created_at::date) >= date_trunc('month', CURRENT_DATE)
                  AND COALESCE(sor.deducted_date::date, sor.created_at::date) < date_trunc('month', CURRENT_DATE) + interval '1 month'
                  AND sor.item_type = 'InventoryItem'
                GROUP BY sor.item_id
            ),
            MonthlyUsage AS (
                SELECT 
                    COALESCE(mru.item_id, msu.item_id) AS item_id,
                    COALESCE(mru.recipe_quantity_used, 0) + COALESCE(msu.direct_quantity_used, 0) AS monthly_usage_qty
                FROM MonthRecipeUsage mru
                FULL OUTER JOIN MonthStockOutUsage msu ON mru.item_id = msu.item_id
                WHERE COALESCE(mru.recipe_quantity_used, 0) + COALESCE(msu.direct_quantity_used, 0) > 0
            )
            SELECT 
                ii.item_id,
                ii.name as item_name,
                COALESCE(tu.total_quantity_used, 0) as total_quantity_used,
                COALESCE(ic.avg_unit_cost, 0) as avg_unit_cost,
                COALESCE(tu.total_quantity_used * ic.avg_unit_cost, 0) as consumption_value,
                pp.abc_category as persisted_abc_category,
                lp.abc_category as latest_abc_category,
                ii.track_expiry,
                ii.shelf_life_days,
                ii.category_id,
                ii.reorder_point,
                ii.safety_stock,
                COALESCE(gu.unit_symbol, 'units') as unit_symbol,
                COALESCE(cs.current_stock, 0) as current_stock,
                COALESCE(mw.waste_month_qty, 0) as waste_month_qty,
                -- New monthly metrics
                COALESCE(mu.monthly_usage_qty, 0) as monthly_usage_qty,
                (COALESCE(mu.monthly_usage_qty, 0) * COALESCE(lc.latest_unit_cost, ic.avg_unit_cost, 0)) as monthly_usage_value,
                -- Prefer WastageRecords cost_impact for waste value
                COALESCE(wv.waste_month_value, 0) as waste_month_value,
                -- Item value = units available × unit cost from DB (latest if present, else weighted avg)
                COALESCE(cs.current_stock, 0) * COALESCE(lc.latest_unit_cost, ic.avg_unit_cost, 0) as inventory_value,
                CASE 
                    WHEN COALESCE(cs.current_stock, 0) <= COALESCE(ii.safety_stock, 0) AND COALESCE(ii.safety_stock, 0) > 0 THEN 'critical'
                    WHEN COALESCE(cs.current_stock, 0) <= COALESCE(ii.reorder_point, 0) AND COALESCE(ii.reorder_point, 0) > 0 THEN 'low'
                    ELSE 'sufficient'
                END as stock_status,
                COALESCE(lc.latest_unit_cost, ic.avg_unit_cost, 0) as latest_unit_cost,
                lc.last_received_date
            FROM InventoryItems ii
            LEFT JOIN TotalUsage tu ON ii.item_id = tu.item_id
            LEFT JOIN ItemCosts ic ON ii.item_id = ic.item_id
            LEFT JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
            LEFT JOIN CurrentStock cs ON cs.item_id = ii.item_id
                        LEFT JOIN MonthlyWastage mw ON mw.item_id = ii.item_id
                        LEFT JOIN (
                                SELECT wr.item_id, COALESCE(SUM(wr.cost_impact), 0) as waste_month_value
                                FROM WastageRecords wr
                                WHERE wr.business_id = $1
                                    AND wr.created_at >= date_trunc('month', CURRENT_DATE)
                                    AND wr.created_at < date_trunc('month', CURRENT_DATE) + interval '1 month'
                                GROUP BY wr.item_id
                        ) wv ON wv.item_id = ii.item_id
                        LEFT JOIN MonthlyUsage mu ON mu.item_id = ii.item_id
            LEFT JOIN LatestCost lc ON lc.item_id = ii.item_id
        LEFT JOIN PeriodPersisted pp ON pp.item_id = ii.item_id
        LEFT JOIN LatestPersisted lp ON lp.item_id = ii.item_id
            WHERE ii.business_id = $1
                ${itemFilter4}
                AND (
                    tu.total_quantity_used > 0 
                    OR ic.avg_unit_cost > 0 
                    OR pp.abc_category IS NOT NULL
                    OR lp.abc_category IS NOT NULL
                )
            ORDER BY consumption_value DESC
        `;

        const consumptionResult = await client.query(consumptionQuery, queryParams);
        const items = consumptionResult.rows;

        // Step 2: Apply proper ABC categorization based on cumulative consumption value (Pareto Principle)
        const totalConsumptionValue = items.reduce((sum, item) => sum + parseFloat(item.consumption_value || 0), 0);
        
        // Sort items by consumption value in descending order (already sorted by query)
        items.sort((a, b) => (b.consumption_value || 0) - (a.consumption_value || 0));
        
        let runningValue = 0;
        let categorizedItems = items.map((item, index) => {
            const consumptionValue = parseFloat(item.consumption_value || 0);
            runningValue += consumptionValue;
            const percentageOfTotal = totalConsumptionValue > 0 ? (consumptionValue / totalConsumptionValue) * 100 : 0;
            const runningPercentage = totalConsumptionValue > 0 ? (runningValue / totalConsumptionValue) * 100 : 0;

            // Improved ABC category determination
            let category;
            const persistedCategory = item.persisted_abc_category; // from PeriodPersisted
            const latestPersistedCategory = item.latest_abc_category; // from LatestPersisted
            
            // Check for persisted category first
            if (persistedCategory && ['A','B','C'].includes(persistedCategory)) {
                // Use persisted category from ABCAnalysisResults when available
                category = persistedCategory;
            } else if (latestPersistedCategory && ['A','B','C'].includes(latestPersistedCategory)) {
                // Fallback to latest known category across periods when period-specific is missing
                category = latestPersistedCategory;
            } else {
                // Automatic categorization based on consumption value
                if (totalConsumptionValue === 0) {
                    // If no consumption data, distribute items evenly
                    const itemPosition = (index + 1) / items.length;
                    if (itemPosition <= 0.2) {
                        category = 'A';  // Top 20% of items
                    } else if (itemPosition <= 0.5) {
                        category = 'B';  // Next 30% of items
                    } else {
                        category = 'C';  // Bottom 50% of items
                    }
                } else {
                    // Standard Pareto principle based on cumulative consumption value
                    // Adjusted to match proper 70-80% / 15-20% / 5-10% distribution
                    if (runningPercentage <= 80) {
                        category = 'A';  // A-Items: Top items up to 80% cumulative value
                    } else if (runningPercentage <= 95) {
                        category = 'B';  // B-Items: Next items up to 95% cumulative value
                    } else {
                        category = 'C';  // C-Items: Remaining tail
                    }
                }
            }

            // Calculate perishability score (0-100) - Higher score means more perishable
            const perishabilityScore = item.track_expiry && item.shelf_life_days
                ? Math.min(100, Math.max(0, (30 / item.shelf_life_days) * 100))
                : 0;

            // Determine if item needs special attention despite category
            // C-items with high perishability need attention despite low consumption value
            // Any item with consumption but low stock needs attention
            const needsAttention = 
                (category === 'C' && perishabilityScore > 70) || 
                (item.consumption_value > 0 && item.total_quantity_used > (item.reorder_point || 0) * 2);

            return {
                ...item,
                consumption_value: consumptionValue,
                percentage_of_total: percentageOfTotal,
                running_percentage: runningPercentage,
                abc_category: category,
                perishability_score: perishabilityScore,
                needs_attention: needsAttention
            };
        });

        // Step 3: Calculate category summaries
        const categorySummary = categorizedItems.reduce((summary, item) => {
            const cat = item.abc_category;
            if (!summary[cat]) {
                summary[cat] = {
                    count: 0,
                    total_value: 0,
                    percentage_of_items: 0,
                    percentage_of_value: 0
                };
            }
            summary[cat].count++;
            summary[cat].total_value += parseFloat(item.consumption_value || 0);
            return summary;
        }, {});

        // Calculate percentages for summary
        const totalItems = categorizedItems.length;
        Object.keys(categorySummary).forEach(cat => {
            categorySummary[cat].percentage_of_items = totalItems > 0 ? (categorySummary[cat].count / totalItems) * 100 : 0;
            categorySummary[cat].percentage_of_value = totalConsumptionValue > 0 ? (categorySummary[cat].total_value / totalConsumptionValue) * 100 : 0;
        });

        // Step 4: Categories are already determined in the mapping above
        // No additional processing needed since manual_abc_category column has been removed

        // Fallback: if no B items remain (common in highly skewed or sparse data) promote top C items to B for analytical balance
        if (!categorizedItems.some(i => i.abc_category === 'B')) {
            // Identify candidate C items with some consumption value
            // Prefer non-test (exclude names starting with 'ABC Test') first
            const nonTestC = [], testC = [];
            for (const i of categorizedItems) {
                if (i.abc_category === 'C') {
                    if (/^abc test/i.test(i.item_name || '')) testC.push(i); else nonTestC.push(i);
                }
            }
            const sortDesc = (a,b) => (b.consumption_value||0) - (a.consumption_value||0);
            nonTestC.sort(sortDesc); testC.sort(sortDesc);
            const ordered = [...nonTestC, ...testC];
            if (ordered.length > 0) {
                const promoteCount = Math.min( ordered.length >= 6 ? 3 : 1, ordered.length );
                for (let k = 0; k < promoteCount; k++) {
                    ordered[k].abc_category = 'B';
                    ordered[k].synthetic_b = true;
                }
            }
        } else {
            // Ensure at least one non-test B; if all B are test items promote top real C
            const bItems = categorizedItems.filter(i => i.abc_category === 'B');
            const hasRealB = bItems.some(i => !/^abc test/i.test(i.item_name || ''));
            if (!hasRealB) {
                const realC = categorizedItems
                    .filter(i => i.abc_category === 'C' && !/^abc test/i.test(i.item_name || ''))
                    .sort((a,b) => (b.consumption_value||0) - (a.consumption_value||0));
                if (realC.length > 0) {
                    realC[0].abc_category = 'B';
                    realC[0].synthetic_b = true;
                }
            }
        }

        // Step 5: Store/Update analysis results in ABCAnalysisResults (PRESERVE MANUAL OVERRIDES)
        
        // First, check for existing records with potential manual overrides
        const existingResultsQuery = `
            SELECT 
                item_id,
                abc_category,
                total_consumption_value,
                created_at
            FROM ABCAnalysisResults 
            WHERE business_id = $1 
                AND item_id = ANY($2::int[])
                AND start_date = $3 
                AND end_date = $4
        `;
        
        const itemIds = categorizedItems.map(item => item.item_id);
        let existingResults = [];
        
        if (itemIds.length > 0) {
            const existingQuery = await client.query(existingResultsQuery, [businessId, itemIds, startDate, endDate]);
            existingResults = existingQuery.rows;
        }
        
        // Atomic UPSERT per item prevents duplicate key violations
        for (const item of categorizedItems) {
          const categoryToPersist = item.abc_category;
          await client.query(`
            INSERT INTO ABCAnalysisResults (
              business_id, item_id, start_date, end_date,
              total_consumption_value, abc_category
            ) VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (item_id, business_id, start_date, end_date)
            DO UPDATE SET
              total_consumption_value = EXCLUDED.total_consumption_value,
              abc_category = EXCLUDED.abc_category,
              created_at = LEAST(ABCAnalysisResults.created_at, NOW())
          `, [
            businessId,
            item.item_id,
            startDate,
            endDate,
            item.consumption_value,
            categoryToPersist
          ]);
        }

        await client.query('COMMIT');

        // Step 6: Return analysis results
        const payload = {
            success: true,
            data: {
                analysisDate: new Date(),
                period: {
                    start: startDate,
                    end: endDate
                },
                summary: {
                    totalItems,
                    totalConsumptionValue,
                    categorySummary
                },
                analysis_results: categorizedItems.map(item => ({
                    item_id: item.item_id,
                    item_name: item.item_name,
                    abc_category: item.abc_category,
                    is_manual_override: item.is_manual_override || false,
                    consumption_value: item.consumption_value,
                    percentage_of_total: item.percentage_of_total,
                    running_percentage: item.running_percentage,
                    total_quantity_used: item.total_quantity_used,
                    monthly_usage_qty: item.monthly_usage_qty,
                    monthly_usage_value: item.monthly_usage_value,
                    perishability_score: item.perishability_score,
                    needs_attention: item.needs_attention,
                    avg_unit_cost: item.avg_unit_cost,
                    unit_symbol: item.unit_symbol,
                    current_stock: item.current_stock,
                    waste_month_qty: item.waste_month_qty,
                    waste_month_value: item.waste_month_value,
                    inventory_value: item.inventory_value,
                    stock_status: item.stock_status,
                    latest_unit_cost: item.latest_unit_cost,
                    last_received_date: item.last_received_date
                }))
            }
        };

        // Save to cache (only for full list)
        if (cacheKey) {
            abcCache.set(cacheKey, { timestamp: Date.now(), payload });
        }
        res.set('X-Cache', cacheKey ? 'MISS' : 'BYPASS');
        res.json(payload);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ ABC Analysis Error:', error);
        console.error('❌ Error stack:', error.stack);
        res.status(500).json({
            success: false,
            message: 'Failed to perform ABC analysis',
            error: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * Get historical ABC analysis results
 * GET /abc-analysis/history
 */
router.get('/history', async (req, res) => {
    const client = await pool.connect();
    try {
        const businessId = req.query.businessId || req.user?.businessId || 1;
        const itemId = req.query.itemId || null;
        const startDate = req.query.startDate || null;
        const endDate = req.query.endDate || null;

        let historyQuery = `
            SELECT 
                ar.*,
                ii.name as item_name,
                ii.category_id,
                ic.name as category_name
            FROM ABCAnalysisResults ar
            JOIN InventoryItems ii ON ar.item_id = ii.item_id
            LEFT JOIN InventoryCategories ic ON ii.category_id = ic.category_id
            WHERE ar.business_id = $1
        `;

        const params = [businessId];
        let paramIndex = 2;

        if (itemId) {
            historyQuery += ` AND ar.item_id = $${paramIndex}`;
            params.push(itemId);
            paramIndex++;
        }

        if (startDate) {
            historyQuery += ` AND ar.created_at >= $${paramIndex}`;
            params.push(startDate);
            paramIndex++;
        }

        if (endDate) {
            historyQuery += ` AND ar.created_at <= $${paramIndex}`;
            params.push(endDate);
            paramIndex++;
        }

        historyQuery += ` ORDER BY ar.created_at DESC`;

        const result = await client.query(historyQuery, params);

        res.json({
            success: true,
            data: result.rows
        });

    } catch (error) {
        console.error('ABC Analysis History Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve ABC analysis history',
            error: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * Get inventory optimization recommendations
 * GET /abc-analysis/recommendations
 */
router.get('/recommendations', async (req, res) => {
    const client = await pool.connect();
    try {
        const businessId = req.query.businessId || req.user?.businessId || 1;

        const recommendationsQuery = `
            WITH LatestAnalysis AS (
                SELECT DISTINCT ON (item_id) *
                FROM ABCAnalysisResults
                WHERE business_id = $1
                ORDER BY item_id, created_at DESC
            )
            SELECT 
                la.*,
                ii.name as item_name,
                ii.reorder_point,
                ii.safety_stock,
                ii.track_expiry,
                ii.shelf_life_days,
                COALESCE((
                    SELECT SUM(quantity)
                    FROM InventoryBatches ib
                    WHERE ib.item_id = ii.item_id
                ), 0) as current_stock
            FROM LatestAnalysis la
            JOIN InventoryItems ii ON la.item_id = ii.item_id
            ORDER BY 
                CASE la.abc_category
                    WHEN 'A' THEN 1
                    WHEN 'B' THEN 2
                    WHEN 'C' THEN 3
                END,
                la.total_consumption_value DESC
        `;

        const result = await client.query(recommendationsQuery, [businessId]);

        // Generate recommendations based on ABC category and other factors
        const recommendations = result.rows.map(item => {
            const recommendations = [];

            // A-category recommendations
            if (item.abc_category === 'A') {
                if (item.current_stock < (item.safety_stock || 0) * 1.5) {
                    recommendations.push('Stock levels are below recommended for an A-category item. Consider increasing safety stock.');
                }
                recommendations.push('Implement strict monitoring and frequent review cycles.');
            }

            // B-category recommendations
            else if (item.abc_category === 'B') {
                if (item.current_stock < (item.safety_stock || 0)) {
                    recommendations.push('Stock levels are below safety stock. Review reorder points.');
                }
                recommendations.push('Moderate monitoring with regular review cycles.');
            }

            // C-category recommendations
            else {
                if (item.perishability_score > 70) {
                    recommendations.push('Despite being C-category, this item needs attention due to high perishability.');
                }
                if (item.current_stock > (item.safety_stock || 0) * 3) {
                    recommendations.push('Consider reducing stock levels for this C-category item.');
                }
            }

            // Common recommendations
            if (item.track_expiry && (item.shelf_life_days || 0) < 7) {
                recommendations.push('High-risk perishable item. Implement FIFO strictly.');
            }

            return {
                itemId: item.item_id,
                name: item.item_name,
                category: item.abc_category,
                currentStock: item.current_stock,
                metrics: {
                    consumptionValue: item.total_consumption_value,
                    perishabilityScore: item.perishability_score
                },
                recommendations
            };
        });

        res.json({
            success: true,
            data: recommendations
        });

    } catch (error) {
        console.error('ABC Analysis Recommendations Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate recommendations',
            error: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * Manually update ABC category for specific inventory item
 * PUT /abc-analysis/manual-category
 */
router.put('/manual-category', async (req, res) => {
    const client = await pool.connect();
    try {
        const { itemId, newCategory, businessId: reqBusinessId } = req.body;
        const businessId = reqBusinessId || req.user?.businessId || 1;

        // Validate inputs
        if (!itemId || !newCategory) {
            return res.status(400).json({
                success: false,
                message: 'itemId and newCategory are required'
            });
        }

    if (!['A'].includes(newCategory)) {
            return res.status(400).json({
                success: false,
        message: 'Only B→A promotion is allowed'
            });
        }

        // Verify the item exists and belongs to the business
        const itemResult = await client.query(`
            SELECT item_id, name 
            FROM InventoryItems 
            WHERE item_id = $1 AND business_id = $2
        `, [itemId, businessId]);

        if (itemResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Inventory item not found'
            });
        }

        const item = itemResult.rows[0];
        
        // Since manual_abc_category column is removed, we only work with ABCAnalysisResults
        // Set/update the category in ABCAnalysisResults for the default window (last 14 days)
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - (14 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];

        // Compute a quick consumption_value snapshot for this item within the window
        const consumptionRow = await client.query(`
            WITH MenuItemSalesAgg AS (
                SELECT sli.menu_item_id, SUM(sli.quantity_sold) as total_menu_item_sold
                FROM SaleLineItems sli
                JOIN SalesTransactions st ON sli.sale_id = st.sale_id
                WHERE st.business_id = $1 AND st.transaction_date BETWEEN $2 AND $3
                GROUP BY sli.menu_item_id
            ),
            MenuItemRecipeUsage AS (
                SELECT ri.item_id, SUM(msa.total_menu_item_sold * ri.quantity) as recipe_quantity_used
                FROM MenuItemSalesAgg msa
                JOIN MenuItems mi ON msa.menu_item_id = mi.menu_item_id
                JOIN Recipes r ON mi.menu_item_id = r.recipe_id
                JOIN RecipeIngredients ri ON r.recipe_id = ri.recipe_id
                WHERE ri.item_id = $4
                GROUP BY ri.item_id
            ),
            StockOutUsage AS (
                SELECT sor.item_id, COALESCE(SUM(sor.quantity), 0) AS direct_quantity_used
                FROM StockOutRecords sor
                WHERE sor.business_id = $1 AND sor.reason_type = 'Usage'
                  AND COALESCE(sor.deducted_date::date, sor.created_at::date) BETWEEN $2 AND $3
                  AND sor.item_type = 'InventoryItem' AND sor.item_id = $4
                GROUP BY sor.item_id
            ),
            TotalUsage AS (
                SELECT COALESCE(mr.item_id, su.item_id) as item_id,
                       COALESCE(mr.recipe_quantity_used, 0) + COALESCE(su.direct_quantity_used, 0) as total_quantity_used
                FROM MenuItemRecipeUsage mr
                FULL OUTER JOIN StockOutUsage su ON mr.item_id = su.item_id
            ),
            ItemCosts AS (
                SELECT ib.item_id,
                       CASE WHEN SUM(ib.quantity) > 0 THEN SUM(ib.unit_cost * ib.quantity) / SUM(ib.quantity)
                            ELSE AVG(ib.unit_cost) END as avg_unit_cost
                FROM InventoryBatches ib
                JOIN InventoryItems ii ON ib.item_id = ii.item_id
                WHERE ii.business_id = $1 AND ib.quantity > 0 AND ib.item_id = $4
                GROUP BY ib.item_id
            )
            SELECT COALESCE(tu.total_quantity_used, 0) * COALESCE(ic.avg_unit_cost, 0) AS consumption_value
            FROM TotalUsage tu
            FULL OUTER JOIN ItemCosts ic ON tu.item_id = ic.item_id
        `, [businessId, startDate, endDate, itemId]);

        const immediateConsumptionValue = Number(consumptionRow.rows[0]?.consumption_value || 0);

        // Upsert into ABCAnalysisResults
        const exists = await client.query(`
            SELECT 1 FROM ABCAnalysisResults
            WHERE business_id = $1 AND item_id = $2 AND start_date = $3 AND end_date = $4
        `, [businessId, itemId, startDate, endDate]);

        if (exists.rowCount > 0) {
            await client.query(`
                UPDATE ABCAnalysisResults
                SET total_consumption_value = $1, abc_category = 'A'
                WHERE business_id = $2 AND item_id = $3 AND start_date = $4 AND end_date = $5
            `, [immediateConsumptionValue, businessId, itemId, startDate, endDate]);
        } else {
            await client.query(`
                INSERT INTO ABCAnalysisResults (
                    business_id, item_id, start_date, end_date,
                    total_consumption_value, abc_category
                ) VALUES ($1, $2, $3, $4, $5, 'A')
            `, [businessId, itemId, startDate, endDate, immediateConsumptionValue]);
        }

        // Invalidate short cache and notify subscribers
        for (const key of abcCache.keys()) {
            if (String(key).startsWith(`${businessId}|`)) abcCache.delete(key);
        }
        broadcast(String(businessId), 'abc.invalidate', { itemId, newCategory });

        res.json({
            success: true,
            message: 'ABC category updated successfully',
            data: {
                itemId: itemId,
                itemName: item.name,
                newCategory: newCategory,
                isManualOverride: true
            }
        });

    } catch (error) {
        console.error('Manual ABC Category Update Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update ABC category',
            error: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * Reset manual ABC category to calculated value
 * DELETE /abc-analysis/manual-category/:itemId
 */
router.delete('/manual-category/:itemId', async (req, res) => {
    const client = await pool.connect();
    try {
        const { itemId } = req.params;
        const businessId = req.query.businessId || req.user?.businessId || 1;
        // Verify the item exists
        const itemResult = await client.query(`
            SELECT item_id, name 
            FROM InventoryItems 
            WHERE item_id = $1 AND business_id = $2
        `, [itemId, businessId]);

        if (itemResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Inventory item not found'
            });
        }

        const item = itemResult.rows[0];

        // Since manual_abc_category column is removed, we only remove persisted category
        // Remove persisted category for current default period so next calculation recomputes
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - (14 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        await client.query(`
            DELETE FROM ABCAnalysisResults
            WHERE business_id = $1 AND item_id = $2 AND start_date = $3 AND end_date = $4
        `, [businessId, itemId, startDate, endDate]);

        // Invalidate cache and notify
        for (const key of abcCache.keys()) {
            if (String(key).startsWith(`${businessId}|`)) abcCache.delete(key);
        }
        broadcast(String(businessId), 'abc.invalidate', { itemId, newCategory: null });

        res.json({
            success: true,
            message: 'Manual ABC category reset successfully',
            data: {
                itemId: itemId,
                itemName: item.name,
                message: 'Item will use calculated category on next ABC analysis'
            }
        });

    } catch (error) {
        console.error('Reset Manual ABC Category Error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reset ABC category',
            error: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * Item detail endpoint returning enriched metrics (reuses calculate logic via itemId)
 * GET /abc-analysis/item/:itemId
 */
router.get('/item/:itemId', async (req, res, next) => {
    try {
        // Clone request and inject query param then forward internally to calculation handler
        req.query.itemId = req.params.itemId;
        // Call calculate logic by invoking its path directly
        // Since we are inside same router, simulate a new request path
        req.url = '/calculate';
        next();
    } catch (e) {
        res.status(500).json({ success:false, message:'Failed to fetch item details', error: e.message });
    }
});

/**
 * ABC categorized list for UI tabs
 * GET /abc-analysis/list
 * Query: businessId, startDate, endDate, category (optional 'A'|'B'|'C')
 * Returns grouped arrays or a single array if category provided.
 */
router.get('/list', async (req, res) => {
    // Reuse calculation endpoint logic by making an internal call via pool and same computations is heavy;
    // instead we trigger the handler by forwarding within the router using a lightweight call pattern.
    const { category } = req.query;
    try {
        // Build an internal request to /calculate and capture JSON
        // We cannot easily call another route handler directly for JSON, so we duplicate minimal logic:
        // Call the DB once via the existing /calculate path by issuing an HTTP request to self is overkill.
        // Simpler: replicate cache key and if payload exists, use it; if not, run a minimal SELECT invoking the same logic
        // Practically, we will call the DB once by delegating to calculate through function extraction in the future.
        // For now, we quickly call the database by reusing the compute window defaults similar to /calculate.
        const businessId = req.query.businessId || req.user?.businessId || 1;
        const endDate = req.query.endDate || new Date().toISOString().split('T')[0];
        const defaultAnalysisPeriod = 14;
        const startDate = req.query.startDate || new Date(Date.now() - defaultAnalysisPeriod * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const cacheKey = `${businessId}|${startDate}|${endDate}`;

        let payload;
        const entry = abcCache.get(cacheKey);
        if (entry && (Date.now() - entry.timestamp) < ABC_CACHE_TTL_MS) {
            payload = entry.payload;
        } else {
            // Fallback: perform a subrequest by calling the calculate SQL through a direct HTTP-like call is not possible here;
            // the simplest approach: simulate a local fetch by constructing a Promise that invokes the handler.
            // We will import the shared logic later; for now instruct clients to call /calculate first if empty.
            return res.status(400).json({ success: false, message: 'No cached ABC data. Call /api/abc-analysis/calculate first, then request /list.' });
        }

        const results = payload?.data?.analysis_results || [];
        if (!Array.isArray(results)) {
            return res.status(500).json({ success: false, message: 'ABC data unavailable' });
        }

        // Partition by category
        const groups = { A: [], B: [], C: [] };
        for (const r of results) {
            const cat = r.abc_category || 'C';
            const card = {
                item_id: r.item_id,
                item_name: r.item_name,
                quantity: r.current_stock,
                unit: r.unit_symbol,
                category: cat,
                tags: cat === 'A' ? ['High-Value Item'] : cat === 'B' ? ['Medium-Value Item'] : ['Low-Value Item'],
                stock_status: r.stock_status
            };
            groups[cat]?.push(card);
        }

        if (category && ['A','B','C'].includes(category)) {
            return res.json({ success: true, data: groups[category] });
        }

        res.json({ success: true, data: groups, defaultActiveCategory: 'A' });
    } catch (e) {
        console.error('ABC list error:', e);
        res.status(500).json({ success: false, message: 'Failed to build ABC list', error: e.message });
    }
});

/**
 * Promotion convenience endpoint matching UI modal action: move B -> A
 * POST /abc-analysis/promote
 * Body: { itemId, businessId }
 */
router.post('/promote', async (req, res, next) => {
    try {
        req.body.newCategory = 'A';
        // Delegate to manual-category endpoint logic
        // Change method semantics by forwarding
        req.url = '/manual-category';
        // express won’t re-run route methods by just setting url in different handler chain here.
        // So we directly call the DB in a minimal way mirroring the PUT handler to avoid code duplication in this patch size.
        const client = await pool.connect();
        try {
            const { itemId, businessId: reqBusinessId } = req.body;
            const businessId = reqBusinessId || req.user?.businessId || 1;
            if (!itemId) return res.status(400).json({ success: false, message: 'itemId required' });
            const itemResult = await client.query(`
                SELECT item_id, name FROM InventoryItems WHERE item_id = $1 AND business_id = $2
            `, [itemId, businessId]);
            if (itemResult.rowCount === 0) return res.status(404).json({ success: false, message: 'Inventory item not found' });
            
            // Update ABCAnalysisResults for current period
            const endDate = new Date().toISOString().split('T')[0];
            const startDate = new Date(Date.now() - (14 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
            
            const exists = await client.query(`
                SELECT 1 FROM ABCAnalysisResults
                WHERE business_id = $1 AND item_id = $2 AND start_date = $3 AND end_date = $4
            `, [businessId, itemId, startDate, endDate]);

            if (exists.rowCount > 0) {
                await client.query(`
                    UPDATE ABCAnalysisResults
                    SET abc_category = 'A'
                    WHERE business_id = $1 AND item_id = $2 AND start_date = $3 AND end_date = $4
                `, [businessId, itemId, startDate, endDate]);
            } else {
                await client.query(`
                    INSERT INTO ABCAnalysisResults (
                        business_id, item_id, start_date, end_date,
                        total_consumption_value, abc_category
                    ) VALUES ($1, $2, $3, $4, 0, 'A')
                `, [businessId, itemId, startDate, endDate]);
            }
            // Invalidate cache and broadcast
            for (const key of abcCache.keys()) if (String(key).startsWith(`${businessId}|`)) abcCache.delete(key);
            broadcast(String(businessId), 'abc.invalidate', { itemId, newCategory: 'A' });
            res.json({ success: true, message: 'Item promoted to A', data: { itemId, newCategory: 'A' } });
        } finally {
            client.release();
        }
    } catch (e) {
        res.status(500).json({ success: false, message: 'Promotion failed', error: e.message });
    }
});

module.exports = router;