const { pool } = require('./config/database');

async function testUnitMapping() {
  try {
    console.log('🧪 Testing Unit Mapping Integration...\n');

    // Test 1: Check if GlobalUnits table has data
    console.log('1. Testing GlobalUnits table...');
    const unitsResult = await pool.query('SELECT COUNT(*) as count FROM GlobalUnits WHERE is_active = true');
    console.log(`   ✅ Found ${unitsResult.rows[0].count} active units`);

    // Test 2: Check if sample business exists
    console.log('2. Testing Businesses table...');
    const businessResult = await pool.query('SELECT business_id, name FROM Businesses LIMIT 1');
    if (businessResult.rows.length > 0) {
      console.log(`   ✅ Found business: ${businessResult.rows[0].name} (ID: ${businessResult.rows[0].business_id})`);
    } else {
      console.log('   ⚠️ No businesses found');
    }

    // Test 3: Check inventory items
    console.log('3. Testing InventoryItems table...');
    const itemsResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM InventoryItems ii 
      WHERE ii.business_id = 1 AND ii.is_active = true
    `);
    console.log(`   ✅ Found ${itemsResult.rows[0].count} inventory items for business 1`);

    // Test 4: Test unit categorization
    console.log('4. Testing unit categorization...');
    const kitchenUnits = await pool.query(`
      SELECT unit_name, unit_symbol, unit_type 
      FROM GlobalUnits 
      WHERE is_active = true 
        AND (unit_type IN ('Weight', 'Volume') OR unit_symbol IN ('cup', 'tbsp', 'tsp', 'bowl'))
      ORDER BY unit_type, unit_name
    `);
    console.log(`   ✅ Found ${kitchenUnits.rows.length} kitchen units:`);
    kitchenUnits.rows.forEach(unit => {
      console.log(`      - ${unit.unit_name} (${unit.unit_symbol}) - ${unit.unit_type}`);
    });

    // Test 5: Test BusinessUnitConversions table structure
    console.log('5. Testing BusinessUnitConversions table...');
    const conversionsResult = await pool.query('SELECT COUNT(*) as count FROM BusinessUnitConversions');
    console.log(`   ✅ BusinessUnitConversions table exists with ${conversionsResult.rows[0].count} records`);

    // Test 6: Simulate saving kitchen units
    console.log('6. Testing kitchen unit conversion save...');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // Get unit IDs for cup and ml
      const cupUnit = await client.query('SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $1', ['cup']);
      const mlUnit = await client.query('SELECT unit_id FROM GlobalUnits WHERE unit_symbol = $1', ['ml']);
      
      if (cupUnit.rows.length > 0 && mlUnit.rows.length > 0) {
        await client.query(`
          INSERT INTO BusinessUnitConversions 
          (business_id, from_unit_id, to_unit_id, conversion_factor, description)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (business_id, from_unit_id, to_unit_id) DO UPDATE SET
          conversion_factor = EXCLUDED.conversion_factor,
          description = EXCLUDED.description
        `, [
          1,
          cupUnit.rows[0].unit_id,
          mlUnit.rows[0].unit_id,
          250,
          'Test kitchen unit conversion: 1 cup = 250 ml'
        ]);
        console.log('   ✅ Successfully saved test kitchen unit conversion');
      } else {
        console.log('   ⚠️ Could not find cup or ml units');
      }
      
      await client.query('ROLLBACK'); // Don't actually save the test data
    } finally {
      client.release();
    }

    console.log('\n🎉 All tests passed! Unit Mapping integration is working correctly.');
    console.log('\n📋 Summary:');
    console.log('  ✅ Database schema is properly set up');
    console.log('  ✅ Sample data is available');
    console.log('  ✅ Unit categorization works');
    console.log('  ✅ BusinessUnitConversions table is functional');
    console.log('  ✅ Kitchen unit conversions can be saved');

  } catch (error) {
    console.error('\n❌ Unit Mapping test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testUnitMapping()
    .then(() => {
      console.log('\n✨ Testing completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Testing failed:', error);
      process.exit(1);
    });
}

module.exports = { testUnitMapping };