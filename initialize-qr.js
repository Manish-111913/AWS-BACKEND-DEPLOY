const { pool } = require('./config/database');
const fs = require('fs');
const path = require('path');

async function initializeQRSystem() {
    const client = await pool.connect();
    
    try {
        console.log('🔄 Initializing QR Code System...');
        
        // Read the schema file
        const schemaPath = path.join(__dirname, 'database', 'qr_schema_simple.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        // Execute the schema
        await client.query(schema);
        
        console.log('✅ QR Code System database schema initialized successfully!');
        
        // Check if tables were created
        const result = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('qr_codes', 'dining_sessions', 'qr_scans', 'session_orders', 'qr_settings')
            ORDER BY table_name;
        `);
        
        console.log('📋 Created tables:');
        result.rows.forEach(row => {
            console.log(`   - ${row.table_name}`);
        });
        
        // Show current QR settings
        const settingsResult = await client.query('SELECT * FROM qr_settings WHERE business_id = 1');
        if (settingsResult.rows.length > 0) {
            console.log('⚙️ QR Settings:');
            const settings = settingsResult.rows[0];
            console.log(`   - Base URL: ${settings.base_url}`);
            console.log(`   - Default Billing Model: ${settings.default_billing_model}`);
            console.log(`   - Session Timeout: ${settings.session_timeout_minutes} minutes`);
        }
        
        console.log('\n🚀 QR Code System is ready!');
        console.log('📌 Next steps:');
        console.log('   1. Start the backend server: npm start');
        console.log('   2. Access QR Management at: http://localhost:5000/admin/qr');
        console.log('   3. Generate QR codes for your tables');
        console.log('   4. Test scanning with a mobile device');
        
    } catch (error) {
        console.error('❌ Error initializing QR Code System:');
        console.error(error.message);
        
        if (error.message.includes('already exists')) {
            console.log('ℹ️ Tables already exist. System is ready to use.');
        } else {
            throw error;
        }
    } finally {
        client.release();
    }
}

// Run the initialization
if (require.main === module) {
    initializeQRSystem()
        .then(() => {
            console.log('\n✨ Initialization complete!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Initialization failed:');
            console.error(error);
            process.exit(1);
        });
}

module.exports = { initializeQRSystem };