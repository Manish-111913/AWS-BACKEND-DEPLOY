const { pool } = require('./config/database');

async function testRecipeCreation() {
  const client = await pool.connect();
  
  try {
    console.log('🧪 Testing Recipe Creation...');
    
    await client.query('BEGIN');
    
    const name = 'Test Recipe';
    const category = 'Vegetarian';
    const price = 150;
    const servings = 2;
    
    // Get or create category
    let categoryId = null;
    const categoryResult = await client.query(`
      SELECT category_id FROM MenuCategories WHERE name = $1 AND business_id = 1
    `, [category]);
    
    if (categoryResult.rows.length > 0) {
      categoryId = categoryResult.rows[0].category_id;
      console.log(`✅ Found existing category: ${category} (ID: ${categoryId})`);
    } else {
      const newCategoryResult = await client.query(`
        INSERT INTO MenuCategories (business_id, name, is_active)
        VALUES (1, $1, true)
        RETURNING category_id
      `, [category]);
      categoryId = newCategoryResult.rows[0].category_id;
      console.log(`✅ Created new category: ${category} (ID: ${categoryId})`);
    }
    
    // Create menu item
    const menuItemResult = await client.query(`
      INSERT INTO MenuItems (business_id, name, category_id, price, servings_per_batch, serving_unit_id, is_active)
      VALUES (1, $1, $2, $3, $4, (SELECT unit_id FROM GlobalUnits WHERE unit_symbol = 'plt' LIMIT 1), true)
      RETURNING menu_item_id
    `, [name, categoryId, price, servings]);
    
    const menuItemId = menuItemResult.rows[0].menu_item_id;
    console.log(`✅ Created menu item: ${name} (ID: ${menuItemId})`);
    
    // Create recipe
    await client.query(`
      INSERT INTO Recipes (recipe_id, instructions)
      VALUES ($1, $2)
    `, [menuItemId, 'Recipe instructions']);
    
    console.log(`✅ Created recipe entry`);
    
    await client.query('COMMIT');
    
    console.log('🎉 Recipe creation test successful!');
    
    // Clean up test data
    await client.query('DELETE FROM Recipes WHERE recipe_id = $1', [menuItemId]);
    await client.query('DELETE FROM MenuItems WHERE menu_item_id = $1', [menuItemId]);
    console.log('✅ Test data cleaned up');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Recipe creation test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    client.release();
  }
}

// Run test
if (require.main === module) {
  testRecipeCreation()
    .then(() => {
      console.log('✅ Test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Test failed:', error);
      process.exit(1);
    });
}

module.exports = { testRecipeCreation };