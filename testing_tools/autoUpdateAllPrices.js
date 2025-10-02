const { pool } = require('./config/database');

async function autoUpdateAllPrices() {
  const client = await pool.connect();
  
  try {
    console.log('🔄 Auto-updating prices for all recipes...');
    
    // Get all recipes
    const recipesResult = await client.query(`
      SELECT menu_item_id, name, price FROM MenuItems 
      WHERE business_id = 1 AND is_active = true
    `);
    
    for (const recipe of recipesResult.rows) {
      const recipeId = recipe.menu_item_id;
      const recipeName = recipe.name;
      const currentPrice = parseFloat(recipe.price);
      
      // Get ingredient count
      const ingredientResult = await client.query(`
        SELECT COUNT(*) as count FROM RecipeIngredients WHERE recipe_id = $1
      `, [recipeId]);
      
      const ingredientCount = parseInt(ingredientResult.rows[0].count);
      
      // Calculate new price based on ingredients (base price + ingredient multiplier)
      let newPrice;
      if (ingredientCount === 0) {
        newPrice = 25; // Base price for items with no ingredients
      } else {
        // Price formula: base price + (ingredient count * multiplier)
        const basePrice = 50;
        const ingredientMultiplier = 30;
        newPrice = basePrice + (ingredientCount * ingredientMultiplier);
        
        // Category-based adjustments
        if (recipeName.toLowerCase().includes('chicken') || recipeName.toLowerCase().includes('tikka')) {
          newPrice += 100; // Premium for chicken dishes
        } else if (recipeName.toLowerCase().includes('paneer')) {
          newPrice += 50; // Premium for paneer dishes
        } else if (recipeName.toLowerCase().includes('biryani')) {
          newPrice += 80; // Premium for biryani
        } else if (recipeName.toLowerCase().includes('naan') || recipeName.toLowerCase().includes('samosa')) {
          newPrice = Math.max(newPrice, 40); // Minimum for bread/snacks
        } else if (recipeName.toLowerCase().includes('lassi') || recipeName.toLowerCase().includes('chai')) {
          newPrice = Math.max(newPrice, 30); // Minimum for beverages
        } else if (recipeName.toLowerCase().includes('ladoo')) {
          newPrice = Math.max(newPrice, 25); // Minimum for sweets
        }
      }
      
      // Update price if different
      if (Math.abs(newPrice - currentPrice) > 0.01) {
        await client.query(`
          UPDATE MenuItems SET price = $1, updated_at = CURRENT_TIMESTAMP 
          WHERE menu_item_id = $2
        `, [newPrice, recipeId]);
        
        console.log(`✅ ${recipeName}: ₹${currentPrice} → ₹${newPrice} (${ingredientCount} ingredients)`);
      } else {
        console.log(`⚪ ${recipeName}: ₹${currentPrice} (no change needed)`);
      }
    }
    
    console.log('🎉 All recipe prices updated successfully!');
    
  } catch (error) {
    console.error('❌ Error updating prices:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run if called directly
if (require.main === module) {
  autoUpdateAllPrices()
    .then(() => {
      console.log('✅ Price update completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Price update failed:', error);
      process.exit(1);
    });
}

module.exports = { autoUpdateAllPrices };