const { pool } = require('./config/database');

async function updateRecipeData() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('🔄 Updating recipe data...');
    
    // Update Lassi recipe
    console.log('Updating Lassi recipe...');
    
    // First get Lassi menu item ID
    const lassiResult = await client.query(`
      SELECT menu_item_id FROM MenuItems WHERE name = 'Lassi' AND business_id = 1
    `);
    
    if (lassiResult.rows.length > 0) {
      const lassiId = lassiResult.rows[0].menu_item_id;
      
      // Update price
      await client.query(`
        UPDATE MenuItems SET price = 60.00 WHERE menu_item_id = $1
      `, [lassiId]);
      
      // Clear existing ingredients
      await client.query('DELETE FROM RecipeIngredients WHERE recipe_id = $1', [lassiId]);
      
      // Add correct ingredients for Lassi
      const lassiIngredients = [
        { name: 'Yogurt', quantity: 200, unit: 'ml' },
        { name: 'Sugar', quantity: 30, unit: 'g' },
        { name: 'Water', quantity: 100, unit: 'ml' },
        { name: 'Salt', quantity: 2, unit: 'g' }
      ];
      
      for (const ingredient of lassiIngredients) {
        // Create inventory item if doesn't exist
        await client.query(`
          INSERT INTO InventoryItems (business_id, name, standard_unit_id, is_active)
          VALUES (1, $1, (SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $2 LIMIT 1), true)
          ON CONFLICT (business_id, name) DO NOTHING
        `, [ingredient.name, ingredient.unit]);
        
        // Add to recipe
        await client.query(`
          INSERT INTO RecipeIngredients (recipe_id, item_id, quantity, unit_id)
          VALUES ($1, 
            (SELECT item_id FROM InventoryItems WHERE name = $2 AND business_id = 1 LIMIT 1),
            $3,
            (SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $4 LIMIT 1)
          )
        `, [lassiId, ingredient.name, ingredient.quantity, ingredient.unit]);
      }
      
      console.log('✅ Lassi updated with 4 ingredients, price ₹60');
    }
    
    // Update Chicken Tikka recipe
    console.log('Updating Chicken Tikka recipe...');
    
    const chickenResult = await client.query(`
      SELECT menu_item_id FROM MenuItems WHERE name = 'Chicken Tikka' AND business_id = 1
    `);
    
    if (chickenResult.rows.length > 0) {
      const chickenId = chickenResult.rows[0].menu_item_id;
      
      // Update price
      await client.query(`
        UPDATE MenuItems SET price = 380.00 WHERE menu_item_id = $1
      `, [chickenId]);
      
      // Clear existing ingredients
      await client.query('DELETE FROM RecipeIngredients WHERE recipe_id = $1', [chickenId]);
      
      // Add correct ingredients for Chicken Tikka
      const chickenIngredients = [
        { name: 'Chicken (Boneless)', quantity: 500, unit: 'g' },
        { name: 'Yogurt', quantity: 100, unit: 'ml' },
        { name: 'Ginger Garlic Paste', quantity: 20, unit: 'g' },
        { name: 'Red Chili Powder', quantity: 10, unit: 'g' },
        { name: 'Garam Masala', quantity: 5, unit: 'g' },
        { name: 'Lemon Juice', quantity: 30, unit: 'ml' },
        { name: 'Oil', quantity: 20, unit: 'ml' }
      ];
      
      for (const ingredient of chickenIngredients) {
        // Create inventory item if doesn't exist
        await client.query(`
          INSERT INTO InventoryItems (business_id, name, standard_unit_id, is_active)
          VALUES (1, $1, (SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $2 LIMIT 1), true)
          ON CONFLICT (business_id, name) DO NOTHING
        `, [ingredient.name, ingredient.unit]);
        
        // Add to recipe
        await client.query(`
          INSERT INTO RecipeIngredients (recipe_id, item_id, quantity, unit_id)
          VALUES ($1, 
            (SELECT item_id FROM InventoryItems WHERE name = $2 AND business_id = 1 LIMIT 1),
            $3,
            (SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $4 LIMIT 1)
          )
        `, [chickenId, ingredient.name, ingredient.quantity, ingredient.unit]);
      }
      
      console.log('✅ Chicken Tikka updated with 7 ingredients, price ₹380');
    }
    
    await client.query('COMMIT');
    console.log('🎉 Recipe data updated successfully!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error updating recipe data:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run if called directly
if (require.main === module) {
  updateRecipeData()
    .then(() => {
      console.log('✅ Recipe update completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Recipe update failed:', error);
      process.exit(1);
    });
}

module.exports = { updateRecipeData };