async function testLocalhostEndpoints() {
  try {
    console.log('🧪 Testing Localhost-Only Configuration...\n');

    const baseUrl = 'http://localhost:5000/api';
    const endpoints = [
      { method: 'GET', url: '/health', description: 'Health check' },
      { method: 'GET', url: '/menu/items', description: 'Menu items' },
      { method: 'GET', url: '/usage/records', description: 'Usage records' },
      { method: 'GET', url: '/stock-in/inventory/overview', description: 'Inventory overview' }
    ];

    console.log('🌐 Testing API endpoints on localhost...');
    
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`${baseUrl}${endpoint.url}`, {
          method: endpoint.method,
          headers: {
            'Content-Type': 'application/json'
          }
        });

        const data = await response.json();
        
        if (response.ok) {
          console.log(`✅ ${endpoint.url} - Status: ${response.status} - ${endpoint.description}`);
          if (data.data && Array.isArray(data.data)) {
            console.log(`   📊 Data count: ${data.data.length} items`);
          }
        } else {
          console.log(`❌ ${endpoint.url} - Status: ${response.status} - ${data.error || 'Unknown error'}`);
        }
      } catch (error) {
        console.log(`❌ ${endpoint.url} - Connection failed: ${error.message}`);
      }
    }

    // Test stock-in submission
    console.log('\n📦 Testing Stock In submission...');
    try {
      const stockInData = {
        shift: 'Night',
        items: [
          {
            item_name: 'Test Item',
            category: 'Test Category',
            quantity: 1,
            unit: 'pc',
            unit_price: 10
          }
        ]
      };

      const response = await fetch(`${baseUrl}/stock-in`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(stockInData)
      });

      const result = await response.json();
      
      if (response.ok) {
        console.log('✅ Stock In submission - SUCCESS');
        console.log(`   📋 Stock In ID: ${result.data.stock_in_id}`);
        console.log(`   💰 Total Amount: ₹${result.data.total_amount}`);
      } else {
        console.log('❌ Stock In submission - FAILED');
        console.log(`   Error: ${result.error}`);
      }
    } catch (error) {
      console.log(`❌ Stock In submission - Connection failed: ${error.message}`);
    }

    // Test usage record submission
    console.log('\n📤 Testing Usage record submission...');
    try {
      const usageData = {
        production_date: '2025-08-15',
        shift: 'Night',
        shift_time: '6:00 PM - 12:00 AM',
        recorded_by_user_id: 1,
        notes: 'Test usage record',
        items: [
          {
            menu_item_id: 1,
            quantity: 1,
            unit: 'servings'
          }
        ]
      };

      const response = await fetch(`${baseUrl}/usage/record`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(usageData)
      });

      const result = await response.json();
      
      if (response.ok) {
        console.log('✅ Usage record submission - SUCCESS');
        console.log(`   📋 Total Items: ${result.data.total_items}`);
        console.log(`   💰 Total Cost: ₹${result.data.total_estimated_cost}`);
      } else {
        console.log('❌ Usage record submission - FAILED');
        console.log(`   Error: ${result.error}`);
      }
    } catch (error) {
      console.log(`❌ Usage record submission - Connection failed: ${error.message}`);
    }

    console.log('\n🎉 Localhost configuration test completed!');
    console.log('\n📋 Summary:');
    console.log('  🌐 Server: http://localhost:5000');
    console.log('  🖥️ Frontend: http://localhost:3000');
    console.log('  🔗 API Base: http://localhost:5000/api');
    console.log('  ❌ No IP detection or dynamic configuration');
    console.log('  ✅ Localhost-only setup complete');

  } catch (error) {
    console.error('❌ Test suite failed:', error.message);
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testLocalhostEndpoints()
    .then(() => {
      console.log('\n✨ All tests completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test failed:', error);
      process.exit(1);
    });
}

module.exports = { testLocalhostEndpoints };