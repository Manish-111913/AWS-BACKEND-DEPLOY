const { pool } = require('./config/database');

async function updateExistingVendorCounts() {
    const client = await pool.connect();
    try {
        console.log('🔄 Updating vendor total_orders based on existing purchase orders...');
        
        // Update vendor total_orders based on existing purchase orders
        const updateResult = await client.query(`
            UPDATE Vendors 
            SET total_orders = (
                SELECT COUNT(*) 
                FROM PurchaseOrders 
                WHERE PurchaseOrders.vendor_id = Vendors.vendor_id
            ),
            last_order_date = (
                SELECT MAX(order_date) 
                FROM PurchaseOrders 
                WHERE PurchaseOrders.vendor_id = Vendors.vendor_id
            ),
            last_ordered_at = (
                SELECT MAX(created_at) 
                FROM PurchaseOrders 
                WHERE PurchaseOrders.vendor_id = Vendors.vendor_id
            ),
            updated_at = NOW()
            WHERE business_id = 1
        `);
        
        console.log(`✅ Updated ${updateResult.rowCount} vendors`);
        
        // Check updated counts
        const afterResult = await client.query(`
            SELECT vendor_id, name, total_orders, last_order_date, last_ordered_at
            FROM Vendors 
            WHERE business_id = 1
            ORDER BY vendor_id
        `);
        
        console.log('\n📊 Updated vendor order counts:');
        afterResult.rows.forEach(vendor => {
            console.log(`  Vendor ${vendor.vendor_id} (${vendor.name}): ${vendor.total_orders} orders`);
            console.log(`    Last order date: ${vendor.last_order_date || 'Never'}`);
        });
        
    } catch (error) {
        console.error('❌ Error updating vendor counts:', error);
    } finally {
        client.release();
    }
}

updateExistingVendorCounts().then(() => {
    process.exit(0);
}).catch(error => {
    console.error('Script error:', error);
    process.exit(1);
});
