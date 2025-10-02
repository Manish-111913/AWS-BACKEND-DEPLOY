const { Pool } = require('pg');
require('dotenv').config();

// Database configuration
const dbConfig = {
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'invexis_db',
  password: process.env.DB_PASSWORD || 'root',
  port: process.env.DB_PORT || 5432,
};

const pool = new Pool(dbConfig);

async function updateImageUrls() {
  try {
    console.log('🔄 Updating menu item image URLs...\n');

    // Get all menu items
    const menuItemsResult = await pool.query(`
      SELECT menu_item_id, name, image_url 
      FROM MenuItems 
      WHERE business_id = 1 AND is_active = true
    `);

    console.log(`Found ${menuItemsResult.rows.length} menu items to update:`);

    for (const item of menuItemsResult.rows) {
      // Generate clean image name based on item name
      const cleanImageName = item.name.toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9_]/g, '') + '.jpg';
      
      const newImageUrl = `/uploads/menu-items/original/${cleanImageName}`;
      
      console.log(`  ${item.name}:`);
      console.log(`    Old: ${item.image_url}`);
      console.log(`    New: ${newImageUrl}`);

      // Update the database
      await pool.query(`
        UPDATE MenuItems 
        SET image_url = $1, updated_at = CURRENT_TIMESTAMP 
        WHERE menu_item_id = $2
      `, [newImageUrl, item.menu_item_id]);

      console.log(`    ✅ Updated\n`);
    }

    console.log('🎉 All image URLs updated successfully!');
  } catch (error) {
    console.error('❌ Error updating image URLs:', error);
  } finally {
    await pool.end();
  }
}

// Run the update
updateImageUrls();