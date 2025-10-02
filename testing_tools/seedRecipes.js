const { pool } = require('./config/database');

async function seedRecipes() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('🌱 Seeding sample recipes...');
    
    // First, ensure we have a business
    const businessResult = await client.query(`
      INSERT INTO Businesses (name, business_type_id, business_size, billing_model_id, is_onboarded)
      VALUES ('Sample Restaurant', 1, 'Small', 1, true)
      ON CONFLICT (name) DO NOTHING
      RETURNING business_id
    `);
    
    let businessId = 1;
    if (businessResult.rows.length > 0) {
      businessId = businessResult.rows[0].business_id;
    }
    
    // Create menu categories
    await client.query(`
      INSERT INTO MenuCategories (business_id, name, is_active) VALUES
      ($1, 'Vegetarian', true),
      ($1, 'Non-Vegetarian', true),
      ($1, 'Beverages', true)
      ON CONFLICT (business_id, name) DO NOTHING
    `, [businessId]);
    
    // Create some inventory items for ingredients
    const inventoryItems = [
      { name: 'Basmati Rice', unit: 'kg' },
      { name: 'Chicken (Bone-in)', unit: 'kg' },
      { name: 'Ginger Garlic Paste', unit: 'g' },
      { name: 'Onions', unit: 'kg' },
      { name: 'Garam Masala', unit: 'g' },
      { name: 'Palak', unit: 'g' },
      { name: 'Paneer', unit: 'g' },
      { name: 'Tomatoes', unit: 'kg' },
      { name: 'Garlic', unit: 'g' },
      { name: 'Ginger', unit: 'g' },
      { name: 'Green Chili', unit: 'g' },
      { name: 'Butter', unit: 'g' },
      { name: 'Cream', unit: 'ml' },
      { name: 'Oil', unit: 'ml' },
      { name: 'Salt', unit: 'g' }
    ];
    
    for (const item of inventoryItems) {
      await client.query(`
        INSERT INTO InventoryItems (business_id, name, standard_unit_id, is_active)
        VALUES ($1, $2, (SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $3 LIMIT 1), true)
        ON CONFLICT (business_id, name) DO NOTHING
      `, [businessId, item.name, item.unit]);
    }
    
    // Create menu items and recipes
    const recipes = [
      {
        name: 'Butter Chicken',
        category: 'Non-Vegetarian',
        price: 450,
        servings: 4,
        instructions: 'Marinate chicken, cook in butter and spices, add cream',
        ingredients: [
          { name: 'Chicken (Bone-in)', quantity: 1.5, unit: 'kg' },
          { name: 'Butter', quantity: 100, unit: 'g' },
          { name: 'Cream', quantity: 200, unit: 'ml' },
          { name: 'Ginger Garlic Paste', quantity: 30, unit: 'g' },
          { name: 'Garam Masala', quantity: 10, unit: 'g' },
          { name: 'Onions', quantity: 0.5, unit: 'kg' },
          { name: 'Tomatoes', quantity: 0.3, unit: 'kg' }
        ]
      },
      {
        name: 'Palak Paneer',
        category: 'Vegetarian',
        price: 350,
        servings: 3,
        instructions: 'Blanch spinach, cook paneer, combine with spices',
        ingredients: [
          { name: 'Palak', quantity: 500, unit: 'g' },
          { name: 'Paneer', quantity: 250, unit: 'g' },
          { name: 'Onions', quantity: 0.2, unit: 'kg' },
          { name: 'Tomatoes', quantity: 0.1, unit: 'kg' },
          { name: 'Garlic', quantity: 20, unit: 'g' },
          { name: 'Ginger', quantity: 15, unit: 'g' },
          { name: 'Green Chili', quantity: 10, unit: 'g' },
          { name: 'Garam Masala', quantity: 5, unit: 'g' }
        ]
      },
      {
        name: 'Vegetable Biryani',
        category: 'Vegetarian',
        price: 280,
        servings: 2,
        instructions: 'Layer rice with vegetables and spices, cook in dum style',
        ingredients: [
          { name: 'Basmati Rice', quantity: 1, unit: 'kg' },
          { name: 'Onions', quantity: 0.3, unit: 'kg' },
          { name: 'Ginger Garlic Paste', quantity: 25, unit: 'g' },
          { name: 'Garam Masala', quantity: 8, unit: 'g' },
          { name: 'Oil', quantity: 50, unit: 'ml' }
        ]
      }
    ];
    
    for (const recipe of recipes) {
      // Create menu item
      const menuItemResult = await client.query(`
        INSERT INTO MenuItems (business_id, name, category_id, price, servings_per_batch, serving_unit_id, is_active)
        VALUES ($1, $2, 
          (SELECT category_id FROM MenuCategories WHERE name = $3 AND business_id = $1 LIMIT 1),
          $4, $5, 
          (SELECT unit_id FROM GlobalUnits WHERE unit_symbol = 'plt' LIMIT 1), 
          true)
        ON CONFLICT (business_id, name) DO UPDATE SET
          price = EXCLUDED.price,
          servings_per_batch = EXCLUDED.servings_per_batch
        RETURNING menu_item_id
      `, [businessId, recipe.name, recipe.category, recipe.price, recipe.servings]);
      
      const menuItemId = menuItemResult.rows[0].menu_item_id;
      
      // Create recipe
      await client.query(`
        INSERT INTO Recipes (recipe_id, instructions)
        VALUES ($1, $2)
        ON CONFLICT (recipe_id) DO UPDATE SET
          instructions = EXCLUDED.instructions
      `, [menuItemId, recipe.instructions]);
      
      // Delete existing ingredients and add new ones
      await client.query('DELETE FROM RecipeIngredients WHERE recipe_id = $1', [menuItemId]);
      
      // Add ingredients
      for (const ingredient of recipe.ingredients) {
        await client.query(`
          INSERT INTO RecipeIngredients (recipe_id, item_id, quantity, unit_id)
          VALUES ($1, 
            (SELECT item_id FROM InventoryItems WHERE name = $2 AND business_id = $3 LIMIT 1),
            $4,
            (SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $5 LIMIT 1)
          )
        `, [menuItemId, ingredient.name, businessId, ingredient.quantity, ingredient.unit]);
      }
    }
    
    await client.query('COMMIT');
    console.log('✅ Sample recipes seeded successfully');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding recipes:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run if called directly
if (require.main === module) {
  seedRecipes()
    .then(() => {
      console.log('🎉 Recipe seeding completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Recipe seeding failed:', error);
      process.exit(1);
    });
}

module.exports = { seedRecipes };