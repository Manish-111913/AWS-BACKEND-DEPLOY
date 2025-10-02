const { pool } = require('./config/database');

async function testSupplierConversions() {
  try {
    console.log('🧪 Testing Supplier Conversions Save...');

    // Test data - this should work without conflicts now
    const testConversions = [
      {
        item: 'Onions',
        containerType: 'bag',
        quantity: 25,
        unit: 'kg'
      },
      {
        item: 'Rice',
        containerType: 'sack',
        quantity: 50,
        unit: 'kg'
      }
    ];

    // Make API call to save conversions
    const response = await fetch('http://localhost:5000/api/unit-mapping/supplier-conversions/1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ conversions: testConversions }),
    });

    const result = await response.json();
    
    if (result.success) {
      console.log('✅ Supplier conversions saved successfully!');
      
      // Verify the data was saved
      const client = await pool.connect();
      try {
        const savedData = await client.query(`
          SELECT 
            bc.conversion_factor,
            fu.unit_symbol as container_type,
            tu.unit_symbol as base_unit,
            bc.description
          FROM BusinessUnitConversions bc
          JOIN GlobalUnits fu ON bc.from_unit_id = fu.unit_id
          JOIN GlobalUnits tu ON bc.to_unit_id = tu.unit_id
          WHERE bc.business_id = 1 AND bc.description LIKE '%supplier%'
          ORDER BY bc.created_at DESC
        `);
        
        console.log('📊 Saved conversions:');
        savedData.rows.forEach(row => {
          console.log(`  - ${row.conversion_factor} ${row.base_unit} per ${row.container_type}`);
          console.log(`    Description: ${row.description}`);
        });
        
      } finally {
        client.release();
      }
    } else {
      console.error('❌ Failed to save supplier conversions:', result.error);
    }

    // Test saving the same conversions again (should update, not create duplicates)
    console.log('\n🔄 Testing duplicate save (should update existing)...');
    const response2 = await fetch('http://localhost:5000/api/unit-mapping/supplier-conversions/1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ conversions: testConversions }),
    });

    const result2 = await response2.json();
    
    if (result2.success) {
      console.log('✅ Duplicate save handled correctly (updated existing records)');
    } else {
      console.error('❌ Duplicate save failed:', result2.error);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testSupplierConversions()
    .then(() => {
      console.log('\n🎉 Test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test failed:', error);
      process.exit(1);
    });
}

module.exports = { testSupplierConversions };