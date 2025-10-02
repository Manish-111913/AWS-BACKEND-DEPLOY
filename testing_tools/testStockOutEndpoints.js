async function testStockOutEndpoints() {
  try {
    console.log('🧪 Testing Stock Out Related Endpoints...\n');

    const baseUrl = 'http://localhost:5000/api';
    const endpoints = [
      { method: 'GET', url: '/health', description: 'Health check' },
      { method: 'GET', url: '/usage/records', description: 'Usage records' },
      { method: 'GET', url: '/usage/summary', description: 'Usage summary' },
      { method: 'GET', url: '/menu/items', description: 'Menu items' },
      { method: 'GET', url: '/menu/categories', description: 'Menu categories' },
      { method: 'GET', url: '/stock-in/inventory/overview', description: 'Inventory overview' }
    ];

    for (const endpoint of endpoints) {
      try {
        console.log(`Testing ${endpoint.method} ${endpoint.url} - ${endpoint.description}`);
        
        const response = await fetch(`${baseUrl}${endpoint.url}`, {
          method: endpoint.method,
          headers: {
            'Content-Type': 'application/json'
          }
        });

        const data = await response.json();
        
        if (response.ok) {
          console.log(`✅ ${endpoint.url} - Status: ${response.status}`);
          if (data.data && Array.isArray(data.data)) {
            console.log(`   Data count: ${data.data.length} items`);
          } else if (data.success) {
            console.log(`   Success: ${data.success}`);
          }
        } else {
          console.log(`❌ ${endpoint.url} - Status: ${response.status}`);
          console.log(`   Error: ${data.error || 'Unknown error'}`);
        }
      } catch (error) {
        console.log(`❌ ${endpoint.url} - Connection failed: ${error.message}`);
      }
      
      console.log(''); // Empty line for readability
    }

    // Test a sample usage record creation
    console.log('Testing usage record creation...');
    try {
      const sampleUsageData = {
        production_date: '2025-08-15',
        shift: 'Night',
        shift_time: '6:00 PM - 12:00 AM',
        recorded_by_user_id: 1,
        notes: 'Test usage record',
        items: [
          {
            menu_item_id: 1,
            quantity: 2,
            unit: 'servings'
          }
        ]
      };

      const response = await fetch(`${baseUrl}/usage/record`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(sampleUsageData)
      });

      const result = await response.json();
      
      if (response.ok) {
        console.log('✅ Usage record creation - SUCCESS');
        console.log(`   Total items: ${result.data.total_items}`);
        console.log(`   Total cost: ₹${result.data.total_estimated_cost}`);
      } else {
        console.log('❌ Usage record creation - FAILED');
        console.log(`   Error: ${result.error}`);
        console.log(`   Details: ${result.details}`);
      }
    } catch (error) {
      console.log(`❌ Usage record creation - Connection failed: ${error.message}`);
    }

  } catch (error) {
    console.error('❌ Test suite failed:', error.message);
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testStockOutEndpoints()
    .then(() => {
      console.log('\n🎉 Stock Out endpoints test completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test failed:', error);
      process.exit(1);
    });
}

module.exports = { testStockOutEndpoints };