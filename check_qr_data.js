const { pool } = require('./config/database');

async function checkQRData() {
    try {
        // Get total count
        const countResult = await pool.query('SELECT COUNT(*) as total FROM qr_codes');
        console.log('📊 Total QR codes in Neon database:', countResult.rows[0].total);
        
        // Get recent entries
        const recentResult = await pool.query(`
            SELECT table_number, qr_id, anchor_url, created_at, business_id
            FROM qr_codes 
            ORDER BY created_at DESC 
            LIMIT 10
        `);
        
        console.log('\n🕒 Most Recent QR Codes:');
        console.log('─'.repeat(80));
        
        recentResult.rows.forEach((row, i) => {
            const shortQRId = row.qr_id.substring(0, 8) + '...';
            const date = new Date(row.created_at).toLocaleString();
            console.log(`${(i+1).toString().padStart(2)}. Table: ${row.table_number.toString().padStart(3)} | QR: ${shortQRId} | Business: ${row.business_id} | ${date}`);
        });
        
        // Get table distribution
        const tableStats = await pool.query(`
            SELECT 
                business_id,
                COUNT(*) as table_count,
                MIN(table_number) as first_table,
                MAX(table_number) as last_table
            FROM qr_codes 
            GROUP BY business_id 
            ORDER BY business_id
        `);
        
        console.log('\n📈 QR Code Distribution by Business:');
        console.log('─'.repeat(50));
        tableStats.rows.forEach(stat => {
            console.log(`Business ${stat.business_id}: ${stat.table_count} tables (${stat.first_table} - ${stat.last_table})`);
        });
        
    } catch (error) {
        console.error('❌ Error checking QR data:', error.message);
    } finally {
        await pool.end();
    }
}

checkQRData();