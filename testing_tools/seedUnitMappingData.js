const { pool } = require('./config/database');

async function seedUnitMappingData() {
  const client = await pool.connect();
  
  try {
    console.log('🌱 Seeding unit mapping data...');
    
    await client.query('BEGIN');

    // Insert additional units if they don't exist
    const additionalUnits = [
      { name: 'Box', symbol: 'box', type: 'Count' },
      { name: 'Carton', symbol: 'carton', type: 'Count' },
      { name: 'Bag', symbol: 'bag', type: 'Count' },
      { name: 'Sack', symbol: 'sack', type: 'Count' },
      { name: 'Crate', symbol: 'crate', type: 'Count' },
      { name: 'Packet', symbol: 'pkt', type: 'Count' },
      { name: 'Bottle', symbol: 'btl', type: 'Count' }
    ];

    for (const unit of additionalUnits) {
      await client.query(`
        INSERT INTO GlobalUnits (unit_name, unit_symbol, unit_type, is_active, is_system_defined)
        VALUES ($1, $2, $3, true, true)
        ON CONFLICT (unit_name) DO NOTHING
      `, [unit.name, unit.symbol, unit.type]);
    }

    // Create a sample business if it doesn't exist
    const businessResult = await client.query(`
      INSERT INTO Businesses (
        name, 
        business_type_id, 
        business_size, 
        billing_model_id, 
        is_onboarded
      )
      SELECT 
        'Sample Restaurant',
        1,
        'Small',
        1,
        false
      WHERE NOT EXISTS (SELECT 1 FROM Businesses WHERE business_id = 1)
      RETURNING business_id
    `);

    let businessId = 1;
    if (businessResult.rows.length > 0) {
      businessId = businessResult.rows[0].business_id;
      console.log(`✅ Created sample business with ID: ${businessId}`);
    }

    // Create sample inventory categories
    await client.query(`
      INSERT INTO InventoryCategories (business_id, name)
      VALUES 
        ($1, 'Vegetables'),
        ($1, 'Spices'),
        ($1, 'Grains'),
        ($1, 'Dairy'),
        ($1, 'Meat')
      ON CONFLICT (business_id, name) DO NOTHING
    `, [businessId]);

    // Create sample inventory items
    const sampleItems = [
      { name: 'Onions', category: 'Vegetables', unit: 'kg' },
      { name: 'Tomatoes', category: 'Vegetables', unit: 'kg' },
      { name: 'Potatoes', category: 'Vegetables', unit: 'kg' },
      { name: 'Rice', category: 'Grains', unit: 'kg' },
      { name: 'Wheat Flour', category: 'Grains', unit: 'kg' },
      { name: 'Turmeric Powder', category: 'Spices', unit: 'g' },
      { name: 'Red Chili Powder', category: 'Spices', unit: 'g' },
      { name: 'Milk', category: 'Dairy', unit: 'l' },
      { name: 'Chicken', category: 'Meat', unit: 'kg' }
    ];

    for (const item of sampleItems) {
      // Get category ID
      const categoryResult = await client.query(`
        SELECT category_id FROM InventoryCategories 
        WHERE business_id = $1 AND name = $2
      `, [businessId, item.category]);

      // Get unit ID
      const unitResult = await client.query(`
        SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $1
      `, [item.unit]);

      if (categoryResult.rows.length > 0 && unitResult.rows.length > 0) {
        await client.query(`
          INSERT INTO InventoryItems (
            business_id, 
            name, 
            category_id, 
            standard_unit_id,
            reorder_point,
            safety_stock
          )
          VALUES ($1, $2, $3, $4, 10, 5)
          ON CONFLICT (business_id, name) DO NOTHING
        `, [
          businessId,
          item.name,
          categoryResult.rows[0].category_id,
          unitResult.rows[0].unit_id
        ]);
      }
    }

    await client.query('COMMIT');
    console.log('✅ Unit mapping sample data seeded successfully');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding unit mapping data:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run if called directly
if (require.main === module) {
  seedUnitMappingData()
    .then(() => {
      console.log('🎉 Seeding completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Seeding failed:', error);
      process.exit(1);
    });
}

module.exports = { seedUnitMappingData };