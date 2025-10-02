const { pool } = require('./config/database');

async function testKitchenUnits() {
  try {
    console.log('🧪 Testing Kitchen Units Save...');

    // Test data
    const testUnits = {
      cup: { value: 250, unit: 'ml' },
      tbsp: { value: 15, unit: 'ml' },
      tsp: { value: 5, unit: 'ml' }
    };

    // Make API call to save kitchen units
    const response = await fetch('http://localhost:5000/api/unit-mapping/kitchen-units/1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ units: testUnits }),
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Kitchen units saved successfully!');
      
      // Verify the data was saved
      const client = await pool.connect();
      try {
        const savedData = await client.query(`
          SELECT 
            bc.conversion_factor,
            fu.unit_symbol as from_unit,
            tu.unit_symbol as to_unit,
            bc.description
          FROM BusinessUnitConversions bc
          JOIN GlobalUnits fu ON bc.from_unit_id = fu.unit_id
          JOIN GlobalUnits tu ON bc.to_unit_id = tu.unit_id
          WHERE bc.business_id = 1 AND bc.description LIKE '%kitchen%'
          ORDER BY fu.unit_symbol
        `);
        
        console.log('📊 Saved kitchen units:');
        savedData.rows.forEach(row => {
          console.log(`  - 1 ${row.from_unit} = ${row.conversion_factor} ${row.to_unit}`);
        });
        
      } finally {
        client.release();
      }
    } else {
      console.error('❌ Failed to save kitchen units:', result.error);
    }

    // Test saving again with different values (should update)
    console.log('\n🔄 Testing update with different values...');
    const updatedUnits = {
      cup: { value: 240, unit: 'ml' }, // Changed from 250 to 240
      tbsp: { value: 15, unit: 'ml' },
      tsp: { value: 5, unit: 'ml' }
    };

    const response2 = await fetch('http://localhost:5000/api/unit-mapping/kitchen-units/1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ units: updatedUnits }),
    });

    const result2 = await response2.json();
    
    if (result2.success) {
      console.log('✅ Kitchen units updated successfully');
      
      // Verify the update
      const client = await pool.connect();
      try {
        const updatedData = await client.query(`
          SELECT conversion_factor, fu.unit_symbol as from_unit
          FROM BusinessUnitConversions bc
          JOIN GlobalUnits fu ON bc.from_unit_id = fu.unit_id
          WHERE bc.business_id = 1 AND fu.unit_symbol = 'cup'
        `);
        
        if (updatedData.rows.length > 0) {
          console.log(`📊 Cup conversion updated to: ${updatedData.rows[0].conversion_factor} ml`);
        }
        
      } finally {
        client.release();
      }
    } else {
      console.error('❌ Failed to update kitchen units:', result2.error);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testKitchenUnits()
    .then(() => {
      console.log('\n🎉 Kitchen units test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test failed:', error);
      process.exit(1);
    });
}

module.exports = { testKitchenUnits };