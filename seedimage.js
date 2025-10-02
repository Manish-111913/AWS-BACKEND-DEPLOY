const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { pool, testConnection } = require('./config/database');

require('dotenv').config();

class SeedImages {
  constructor() {
    this.pool = pool;
    this.businessId = 1; // Default business ID from seeddata
  }

  async seedMenuItemImages() {
    try {
      console.log('🖼️ Starting menu item image seeding...\n');

      // Test database connection
      console.log('🔌 Testing database connection...');
      await testConnection();
      console.log('✅ Database connection successful\n');

      // Create upload directories
      this.createUploadDirectories();

      // Image mappings - filename to menu item name
      const imageMap = {
        'chicken_tikka.jpg': 'Chicken Tikka',
        'garlic_naan.jpg': 'Garlic Naan',
        'lassi.jpg': 'Lassi',
        'masala_chai.jpg': 'Masala Chai',
        'paneer_butter_masala.jpg': 'Paneer Butter Masala',
        'paneer_tikka.jpg': 'Paneer Tikka',
        'sweet_ladoo.jpg': 'Sweet Ladoo',
        'tandoori_chicken.jpg': 'Tandoori Chicken',
        'vegetable_biryani.jpg': 'Vegetable Biryani',
        'veggie_samosa.jpg': 'Veggie Samosa'
      };

      // Get menu items from database
      const menuItemsResult = await this.pool.query(`
        SELECT menu_item_id, name 
        FROM MenuItems 
        WHERE business_id = $1 AND is_active = true
      `, [this.businessId]);

      const menuItems = {};
      menuItemsResult.rows.forEach(item => {
        menuItems[item.name] = item.menu_item_id;
      });

      let processedCount = 0;
      let successCount = 0;

      // Process each image
      for (const [filename, menuItemName] of Object.entries(imageMap)) {
        try {
          const sourcePath = path.join(__dirname, 'images', filename);

          // Check if source image exists
          if (!fs.existsSync(sourcePath)) {
            console.log(`  ⚠️ Image not found: ${filename}`);
            continue;
          }

          // Check if menu item exists
          if (!menuItems[menuItemName]) {
            console.log(`  ⚠️ Menu item not found: ${menuItemName}`);
            continue;
          }

          const menuItemId = menuItems[menuItemName];
          const newFilename = filename;

          const originalPath = path.join(__dirname, 'uploads', 'menu-items', 'original', newFilename);
          const thumbnailPath = path.join(__dirname, 'uploads', 'menu-items', 'thumbnails', newFilename);

          // Copy original image
          fs.copyFileSync(sourcePath, originalPath);

          // Generate thumbnail
          await sharp(sourcePath)
            .resize(300, 200, { fit: 'cover' })
            .jpeg({ quality: 85 })
            .toFile(thumbnailPath);

          // Get file stats
          const stats = fs.statSync(originalPath);

          // Save to ScannedImages table
          const imageRecord = await this.pool.query(`
            INSERT INTO ScannedImages (
              business_id, file_url, file_path, thumbnail_url, scan_type, 
              uploaded_by_user_id, file_size, mime_type, status, alt_text, upload_date
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            RETURNING image_id
          `, [
            this.businessId,
            `/uploads/menu-items/original/${newFilename}`,
            originalPath,
            `/uploads/menu-items/thumbnails/${newFilename}`,
            'Menu Item',
            1, // Owner user ID
            stats.size,
            'image/jpeg',
            'Uploaded',
            `Image of ${menuItemName}`
          ]);

          // Update menu item with image reference
          await this.pool.query(`
            UPDATE MenuItems 
            SET image_url = $1, updated_at = CURRENT_TIMESTAMP 
            WHERE menu_item_id = $2 AND business_id = $3
          `, [
            `/uploads/menu-items/original/${newFilename}`,
            menuItemId,
            this.businessId
          ]);

          console.log(`  ✅ Processed: ${menuItemName} -> ${newFilename}`);
          successCount++;

        } catch (error) {
          console.error(`  ❌ Error processing ${filename}:`, error.message);
        }

        processedCount++;
      }

      console.log(`\n🎉 Image seeding completed!`);
      console.log(`📊 Processed: ${processedCount} images`);
      console.log(`✅ Successful: ${successCount} images`);
      console.log(`❌ Failed: ${processedCount - successCount} images`);

    } catch (error) {
      console.error('\n❌ Image seeding failed:', error.message);
      console.error('Stack trace:', error.stack);
      process.exit(1);
    } finally {
      console.log('🔄 Image seeding process completed. Connection remains active.');
    }
  }

  createUploadDirectories() {
    const directories = [
      path.join(__dirname, 'uploads'),
      path.join(__dirname, 'uploads', 'menu-items'),
      path.join(__dirname, 'uploads', 'menu-items', 'original'),
      path.join(__dirname, 'uploads', 'menu-items', 'thumbnails')
    ];

    directories.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`📁 Created directory: ${dir}`);
      }
    });
  }
}

// Export the class for use in other files
module.exports = SeedImages;

// Run image seeding if this file is executed directly
if (require.main === module) {
  const seeder = new SeedImages();
  seeder.seedMenuItemImages()
    .then(() => {
      console.log('✅ Image seeding process completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Image seeding process failed:', error);
      process.exit(1);
    });
}
