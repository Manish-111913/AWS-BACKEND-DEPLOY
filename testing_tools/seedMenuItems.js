const { pool } = require('../config/database');

async function seedMenuItems() {
  const client = await pool.connect();
  
  try {
    console.log('🌱 Seeding menu items for Stock Out testing...');
    
    await client.query('BEGIN');

    // Create menu categories if they don't exist
    const categories = [
      { name: 'Main Course', description: 'Primary dishes' },
      { name: 'Snacks', description: 'Starter dishes' },
      { name: 'Beverages', description: 'Drinks and beverages' },
      { name: 'Desserts', description: 'Sweet dishes' }
    ];

    for (const category of categories) {
      await client.query(`
        INSERT INTO MenuCategories (business_id, name, is_active, created_at)
        VALUES (1, $1, true, NOW())
        ON CONFLICT (business_id, name) DO NOTHING
      `, [category.name]);
    }

    // Get serving unit ID (plate/serving)
    const servingUnitResult = await client.query(`
      SELECT unit_id FROM GlobalUnits 
      WHERE unit_symbol IN ('plt', 'srv', 'pc') 
      ORDER BY unit_symbol 
      LIMIT 1
    `);
    
    const servingUnitId = servingUnitResult.rows.length > 0 ? servingUnitResult.rows[0].unit_id : 5; // Default to piece

    // Sample menu items
    const menuItems = [
      { name: 'Butter Chicken', category: 'Main Course', price: 280, servings: 1 },
      { name: 'Paneer Tikka Masala', category: 'Main Course', price: 250, servings: 1 },
      { name: 'Biryani', category: 'Main Course', price: 320, servings: 1 },
      { name: 'Dal Tadka', category: 'Main Course', price: 180, servings: 1 },
      { name: 'Samosa', category: 'Snacks', price: 40, servings: 2 },
      { name: 'Spring Rolls', category: 'Snacks', price: 120, servings: 4 },
      { name: 'Masala Chai', category: 'Beverages', price: 30, servings: 1 },
      { name: 'Fresh Lime Soda', category: 'Beverages', price: 50, servings: 1 },
      { name: 'Gulab Jamun', category: 'Desserts', price: 80, servings: 2 },
      { name: 'Ice Cream', category: 'Desserts', price: 60, servings: 1 }
    ];

    for (const item of menuItems) {
      // Get category ID
      const categoryResult = await client.query(`
        SELECT category_id FROM MenuCategories 
        WHERE business_id = 1 AND name = $1
      `, [item.category]);

      if (categoryResult.rows.length > 0) {
        const categoryId = categoryResult.rows[0].category_id;

        await client.query(`
          INSERT INTO MenuItems (
            business_id, name, category_id, price, 
            servings_per_batch, serving_unit_id, is_active,
            created_at, updated_at
          )
          VALUES (1, $1, $2, $3, $4, $5, true, NOW(), NOW())
          ON CONFLICT (business_id, name) DO UPDATE SET
            price = EXCLUDED.price,
            servings_per_batch = EXCLUDED.servings_per_batch,
            updated_at = NOW()
        `, [item.name, categoryId, item.price, item.servings, servingUnitId]);

        console.log(`✅ Created/Updated menu item: ${item.name} - ₹${item.price}`);
      }
    }

    await client.query('COMMIT');
    console.log('✅ Menu items seeded successfully');

    // Verify the data
    const verifyResult = await client.query(`
      SELECT 
        mi.name, 
        mi.price, 
        mc.name as category,
        mi.servings_per_batch
      FROM MenuItems mi
      JOIN MenuCategories mc ON mi.category_id = mc.category_id
      WHERE mi.business_id = 1 AND mi.is_active = true
      ORDER BY mc.name, mi.name
    `);

    console.log('\n📋 Menu items in database:');
    verifyResult.rows.forEach(item => {
      console.log(`  - ${item.name} (${item.category}): ₹${item.price} - ${item.servings_per_batch} servings`);
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding menu items:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run seeding if this file is executed directly
if (require.main === module) {
  seedMenuItems()
    .then(() => {
      console.log('\n🎉 Menu items seeding completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Seeding failed:', error);
      process.exit(1);
    });
}

module.exports = { seedMenuItems };