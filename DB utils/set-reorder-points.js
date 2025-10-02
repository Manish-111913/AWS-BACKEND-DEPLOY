// Quick script to set reorder points for items that don't have them
const { pool } = require('./config/database');

async function setDefaultReorderPoints() {
    try {
        console.log('🔧 Setting Default Reorder Points for Items Without Thresholds');
        console.log('===============================================================');

        // Find items without reorder points
        const itemsWithoutThresholds = await pool.query(`
            SELECT item_id, name
                   COALESCE(SUM(ib.quantity), 0) as current_stock,
                   gu.unit_symbol
            FROM InventoryItems ii
            LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
            LEFT JOIN GlobalUnits gu ON ii.standard_unit_id = gu.unit_id
            WHERE ii.business_id = 1 
              AND ii.is_active = true
              AND ii.reorder_point IS NULL
              AND ii.safety_stock IS NULL
            GROUP BY ii.item_id, ii.name gu.unit_symbol
            ORDER BY ii.name
        `);

        console.log(`Found ${itemsWithoutThresholds.rows.length} items without reorder points:`);

        for (const item of itemsWithoutThresholds.rows) {
            // Set intelligent default reorder points based on ABC category and current stock
            let reorderPoint, safetyStock;
            
            switch (item.) {
                case 'A':
                    // Category A: Higher safety margins
                    reorderPoint = Math.max(20, item.current_stock * 2);
                    safetyStock = Math.max(10, item.current_stock);
                    break;
                case 'B':
                    // Category B: Moderate safety margins
                    reorderPoint = Math.max(15, item.current_stock * 1.5);
                    safetyStock = Math.max(8, item.current_stock * 0.8);
                    break;
                case 'C':
                    // Category C: Lower safety margins
                    reorderPoint = Math.max(10, item.current_stock * 1.2);
                    safetyStock = Math.max(5, item.current_stock * 0.6);
                    break;
                default:
                    // Unassigned: Conservative approach
                    reorderPoint = Math.max(15, item.current_stock * 1.5);
                    safetyStock = Math.max(8, item.current_stock * 0.8);
            }

            // Update the item with calculated thresholds
            await pool.query(`
                UPDATE InventoryItems 
                SET reorder_point = $1, 
                    safety_stock = $2, 
                    updated_at = NOW()
                WHERE item_id = $3
            `, [reorderPoint, safetyStock, item.item_id]);

            console.log(`✅ ${item.name} (Category ${item. || 'Unassigned'})`);
            console.log(`   Current: ${item.current_stock} ${item.unit_symbol}`);
            console.log(`   Reorder Point: ${reorderPoint} ${item.unit_symbol}`);
            console.log(`   Safety Stock: ${safetyStock} ${item.unit_symbol}`);
            console.log('');
        }

        console.log('✅ All items now have reorder points configured!');
        
        // Test the result
        console.log('\n🧪 Testing Updated Query...');
        const updatedLowStock = await pool.query(`
            SELECT COUNT(*) as count
            FROM InventoryItems ii
            LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
            WHERE ii.business_id = 1 AND ii.is_active = true
            GROUP BY ii.item_id, ii.reorder_point, ii.safety_stock
            HAVING 
              (COALESCE(SUM(ib.quantity), 0) < COALESCE(ii.reorder_point, 0) OR 
               COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.safety_stock, 0))
              AND (ii.reorder_point IS NOT NULL OR ii.safety_stock IS NOT NULL)
        `);
        
        console.log(`New low stock count: ${updatedLowStock.rowCount} items`);

    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        process.exit();
    }
}

// Uncomment the line below to run this script
// setDefaultReorderPoints();

console.log('📋 This script can set intelligent reorder points for all items.');
console.log('💡 Reorder Point Strategy:');
console.log('   Category A: Current Stock × 2 (minimum 20)');
console.log('   Category B: Current Stock × 1.5 (minimum 15)');
console.log('   Category C: Current Stock × 1.2 (minimum 10)');
console.log('   Unassigned: Current Stock × 1.5 (minimum 15)');
console.log('');
console.log('🚀 To run: Uncomment the last line and run: node set-reorder-points.js');
