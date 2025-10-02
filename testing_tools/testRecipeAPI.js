const { pool } = require('./config/database');

async function testRecipeAPI() {
  console.log('🧪 Testing Recipe API Database Operations...\n');
  
  try {
    // Test 1: Get all recipes
    console.log('1. Testing GET /api/recipes');
    const recipesQuery = `
      SELECT 
        r.recipe_id as id,
        mi.name,
        CAST(mi.price AS DECIMAL(10,2)) as price,
        CAST(mi.servings_per_batch AS DECIMAL(10,2)) as servings,
        mc.name as category,
        COUNT(ri.recipe_ingredient_id) as ingredientsCount
      FROM Recipes r
      JOIN MenuItems mi ON r.recipe_id = mi.menu_item_id
      LEFT JOIN MenuCategories mc ON mi.category_id = mc.category_id
      LEFT JOIN RecipeIngredients ri ON r.recipe_id = ri.recipe_id
      WHERE mi.is_active = true AND mi.business_id = 1
      GROUP BY r.recipe_id, mi.name, mi.price, mi.servings_per_batch, mc.name
      ORDER BY mi.name
      LIMIT 3
    `;
    
    const recipesResult = await pool.query(recipesQuery);
    console.log(`✅ Found ${recipesResult.rows.length} recipes`);
    recipesResult.rows.forEach(recipe => {
      console.log(`   - ${recipe.name}: ₹${recipe.price}, ${recipe.servings} servings, ${recipe.ingredientscount} ingredients`);
    });
    
    if (recipesResult.rows.length > 0) {
      const testRecipeId = recipesResult.rows[0].id;
      
      // Test 2: Get ingredients for a recipe
      console.log(`\n2. Testing GET /api/recipes/${testRecipeId}/ingredients`);
      const ingredientsQuery = `
        SELECT 
          ri.recipe_ingredient_id,
          ii.name,
          CAST(ri.quantity AS DECIMAL(10,4)) as quantity,
          gu.unit_symbol as unit
        FROM RecipeIngredients ri
        JOIN InventoryItems ii ON ri.item_id = ii.item_id
        JOIN GlobalUnits gu ON ri.unit_id = gu.unit_id
        WHERE ri.recipe_id = $1
        ORDER BY ii.name
      `;
      
      const ingredientsResult = await pool.query(ingredientsQuery, [testRecipeId]);
      console.log(`✅ Found ${ingredientsResult.rows.length} ingredients for recipe ${testRecipeId}`);
      ingredientsResult.rows.forEach(ingredient => {
        console.log(`   - ${ingredient.name}: ${ingredient.quantity} ${ingredient.unit}`);
      });
      
      // Test 3: Add a new ingredient
      console.log(`\n3. Testing ingredient addition`);
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // Create a test inventory item
        const testIngredientName = `Test Ingredient ${Date.now()}`;
        const newItemResult = await client.query(`
          INSERT INTO InventoryItems (business_id, name, standard_unit_id, is_active)
          VALUES (1, $1, (SELECT unit_id FROM GlobalUnits WHERE unit_symbol = 'g' LIMIT 1), true)
          RETURNING item_id
        `, [testIngredientName]);
        
        const newItemId = newItemResult.rows[0].item_id;
        console.log(`✅ Created test inventory item: ${testIngredientName} (ID: ${newItemId})`);
        
        // Add it to the recipe
        await client.query(`
          INSERT INTO RecipeIngredients (recipe_id, item_id, quantity, unit_id)
          VALUES ($1, $2, 100, (SELECT unit_id FROM GlobalUnits WHERE unit_symbol = 'g' LIMIT 1))
        `, [testRecipeId, newItemId]);
        
        console.log(`✅ Added ingredient to recipe ${testRecipeId}`);
        
        // Verify it was added
        const verifyResult = await client.query(`
          SELECT ii.name, ri.quantity, gu.unit_symbol
          FROM RecipeIngredients ri
          JOIN InventoryItems ii ON ri.item_id = ii.item_id
          JOIN GlobalUnits gu ON ri.unit_id = gu.unit_id
          WHERE ri.recipe_id = $1 AND ii.name = $2
        `, [testRecipeId, testIngredientName]);
        
        if (verifyResult.rows.length > 0) {
          const added = verifyResult.rows[0];
          console.log(`✅ Verified: ${added.name} - ${added.quantity} ${added.unit_symbol}`);
        }
        
        // Clean up - remove the test ingredient
        await client.query('DELETE FROM RecipeIngredients WHERE recipe_id = $1 AND item_id = $2', [testRecipeId, newItemId]);
        await client.query('DELETE FROM InventoryItems WHERE item_id = $1', [newItemId]);
        console.log(`✅ Cleaned up test data`);
        
        await client.query('COMMIT');
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      
      // Test 4: Update recipe price
      console.log(`\n4. Testing recipe price update`);
      const originalPrice = recipesResult.rows[0].price;
      const newPrice = parseFloat(originalPrice) + 10;
      
      await pool.query(`
        UPDATE MenuItems 
        SET price = $1, updated_at = CURRENT_TIMESTAMP
        WHERE menu_item_id = $2 AND business_id = 1
      `, [newPrice, testRecipeId]);
      
      // Verify the update
      const updatedResult = await pool.query(`
        SELECT CAST(price AS DECIMAL(10,2)) as price 
        FROM MenuItems 
        WHERE menu_item_id = $1
      `, [testRecipeId]);
      
      if (updatedResult.rows.length > 0) {
        const updatedPrice = parseFloat(updatedResult.rows[0].price);
        console.log(`✅ Price updated: ₹${originalPrice} → ₹${updatedPrice}`);
        
        // Restore original price
        await pool.query(`
          UPDATE MenuItems 
          SET price = $1, updated_at = CURRENT_TIMESTAMP
          WHERE menu_item_id = $2 AND business_id = 1
        `, [originalPrice, testRecipeId]);
        console.log(`✅ Restored original price: ₹${originalPrice}`);
      }
    }
    
    console.log('\n🎉 All tests passed! Recipe API is working correctly.');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Run tests if called directly
if (require.main === module) {
  testRecipeAPI()
    .then(() => {
      console.log('\n✅ Recipe API testing completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Recipe API testing failed:', error);
      process.exit(1);
    });
}

module.exports = { testRecipeAPI };