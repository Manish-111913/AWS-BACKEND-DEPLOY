const { pool } = require('../config/database');

async function updateMenuCategories() {
  const client = await pool.connect();
  try {
    console.log('🚀 Starting category update...');

    // Update the category name
    const updateResult = await client.query(
      `UPDATE menucategories SET name = 'Snacks' WHERE name = 'Appetizers' AND business_id = 1`
    );

    if (updateResult.rowCount > 0) {
      console.log(`✅ Successfully updated ${updateResult.rowCount} category from "Appetizers" to "Snacks".`);
    } else {
      console.log('ℹ️ No category named "Appetizers" found to update.');
    }

    // Verify the change
    const verifyResult = await client.query(
      `SELECT * FROM menucategories WHERE business_id = 1 ORDER BY name`
    );

    console.log('\n📋 Current Menu Categories for business_id = 1:');
    verifyResult.rows.forEach(category => {
      console.log(`  - ID: ${category.category_id}, Name: ${category.name}`);
    });

  } catch (error) {
    console.error('❌ Error updating categories:', error);
  } finally {
    client.release();
  }
}

updateMenuCategories().then(() => {
  console.log('\n🎉 Category update process finished.');
  pool.end();
});
