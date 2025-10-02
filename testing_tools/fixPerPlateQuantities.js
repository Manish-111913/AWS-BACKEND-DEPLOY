const { pool } = require('./config/database');

async function fixPerPlateQuantities() {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    console.log('🔧 Fixing per-plate quantities...');
    
    // Update Lassi ingredients to realistic per-plate quantities
    const lassiUpdates = [
      { name: 'Yogurt', quantity: 20, unit: 'ml' },
      { name: 'Sugar', quantity: 3, unit: 'g' },
      { name: 'Water', quantity: 10, unit: 'ml' },
      { name: 'Salt', quantity: 0.2, unit: 'g' }
    ];
    
    const lassiResult = await client.query(`
      SELECT menu_item_id FROM MenuItems WHERE name = 'Lassi' AND business_id = 1
    `);
    
    if (lassiResult.rows.length > 0) {
      const lassiId = lassiResult.rows[0].menu_item_id;
      
      for (const ingredient of lassiUpdates) {
        await client.query(`
          UPDATE RecipeIngredients 
          SET quantity = $1
          WHERE recipe_id = $2 
          AND item_id = (SELECT item_id FROM InventoryItems WHERE name = $3 AND business_id = 1)
        `, [ingredient.quantity, lassiId, ingredient.name]);
      }
      console.log('✅ Updated Lassi per-plate quantities');
    }
    
    // Update Chicken Tikka ingredients to realistic per-plate quantities
    const chickenUpdates = [
      { name: 'Chicken (Boneless)', quantity: 50, unit: 'g' },
      { name: 'Yogurt', quantity: 10, unit: 'ml' },
      { name: 'Ginger Garlic Paste', quantity: 2, unit: 'g' },
      { name: 'Red Chili Powder', quantity: 1, unit: 'g' },
      { name: 'Garam Masala', quantity: 0.5, unit: 'g' },
      { name: 'Lemon Juice', quantity: 3, unit: 'ml' },
      { name: 'Oil', quantity: 2, unit: 'ml' }
    ];
    
    const chickenResult = await client.query(`
      SELECT menu_item_id FROM MenuItems WHERE name = 'Chicken Tikka' AND business_id = 1
    `);
    
    if (chickenResult.rows.length > 0) {
      const chickenId = chickenResult.rows[0].menu_item_id;
      
      for (const ingredient of chickenUpdates) {
        await client.query(`
          UPDATE RecipeIngredients 
          SET quantity = $1
          WHERE recipe_id = $2 
          AND item_id = (SELECT item_id FROM InventoryItems WHERE name = $3 AND business_id = 1)
        `, [ingredient.quantity, chickenId, ingredient.name]);
      }
      console.log('✅ Updated Chicken Tikka per-plate quantities');
    }
    
    await client.query('COMMIT');
    console.log('🎉 Per-plate quantities fixed successfully!');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error fixing quantities:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run if called directly
if (require.main === module) {
  fixPerPlateQuantities()
    .then(() => {
      console.log('✅ Quantity fix completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Quantity fix failed:', error);
      process.exit(1);
    });
}

module.exports = { fixPerPlateQuantities };