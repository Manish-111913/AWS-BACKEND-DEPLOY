async function testStockInAPI() {
  try {
    console.log('🧪 Testing Stock In API...\n');

    const baseUrl = 'http://localhost:5000/api/stock-in';

    // Test data that matches the frontend format
    const testStockInData = {
      shift: 'Night',
      items: [
        {
          item_name: 'Fresh Milk',
          category: 'Dairy',
          quantity: 30,
          unit: 'ltr',
          unit_price: 60,
          batch_number: 'FRESH-508-0001',
          expiry_date: '2025-08-20'
        },
        {
          item_name: 'Chicken Breast',
          category: 'Meat',
          quantity: 5,
          unit: 'kg',
          unit_price: 250,
          batch_number: 'CHKN-001',
          expiry_date: '2025-08-18'
        }
      ]
    };

    console.log('1. Testing stock-in submission...');
    console.log('Data to send:', JSON.stringify(testStockInData, null, 2));

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testStockInData),
    });

    const result = await response.json();
    
    console.log('Response status:', response.status);
    console.log('Response data:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('✅ Stock-in submission successful!');
      console.log(`   Stock In ID: ${result.data.stock_in_id}`);
      console.log(`   Total Items: ${result.data.total_items}`);
      console.log(`   Total Amount: ₹${result.data.total_amount}`);
      
      // Test 2: Get the created record
      console.log('\n2. Testing record retrieval...');
      const getResponse = await fetch(`${baseUrl}/${result.data.stock_in_id}`);
      const getResult = await getResponse.json();
      
      if (getResult.success) {
        console.log('✅ Record retrieved successfully');
        console.log(`   Record Date: ${getResult.data.received_date}`);
        console.log(`   Status: ${getResult.data.status}`);
      } else {
        console.log('❌ Failed to retrieve record:', getResult.error);
      }

      // Test 3: Get inventory overview
      console.log('\n3. Testing inventory overview...');
      const inventoryResponse = await fetch(`${baseUrl}/inventory/overview`);
      const inventoryResult = await inventoryResponse.json();
      
      if (inventoryResult.success) {
        console.log('✅ Inventory overview retrieved successfully');
        console.log(`   Total items in inventory: ${inventoryResult.count}`);
        if (inventoryResult.data.length > 0) {
          console.log('   Sample items:');
          inventoryResult.data.slice(0, 3).forEach(item => {
            console.log(`     - ${item.item_name}: ${item.quantity} ${item.unit} (${item.status})`);
          });
        }
      } else {
        console.log('❌ Failed to get inventory overview:', inventoryResult.error);
      }

    } else {
      console.log('❌ Stock-in submission failed:', result.error);
      if (result.details) {
        console.log('   Validation errors:');
        result.details.forEach(detail => {
          console.log(`     - ${detail.field}: ${detail.message}`);
        });
      }
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.error('Stack trace:', error.stack);
  }
}

// Test with minimal data (like what frontend might send)
async function testMinimalStockIn() {
  try {
    console.log('\n🧪 Testing Minimal Stock In Data...\n');

    const minimalData = {
      shift: 'Night',
      items: [
        {
          item_name: 'Test Item',
          category: 'Test Category',
          quantity: 1,
          unit: 'pc',
          unit_price: 10
          // No batch_number, no expiry_date, no time
        }
      ]
    };

    console.log('Minimal data:', JSON.stringify(minimalData, null, 2));

    const response = await fetch('http://localhost:5000/api/stock-in', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(minimalData),
    });

    const result = await response.json();
    
    console.log('Response status:', response.status);
    console.log('Response:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log('✅ Minimal stock-in submission successful!');
    } else {
      console.log('❌ Minimal stock-in submission failed');
    }

  } catch (error) {
    console.error('❌ Minimal test failed:', error.message);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  Promise.resolve()
    .then(() => testStockInAPI())
    .then(() => testMinimalStockIn())
    .then(() => {
      console.log('\n🎉 Stock In API tests completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Tests failed:', error);
      process.exit(1);
    });
}

module.exports = { testStockInAPI, testMinimalStockIn };