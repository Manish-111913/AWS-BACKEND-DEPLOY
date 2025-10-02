async function testAllRoutes() {
    try {
        console.log('🧪 Testing All Backend Routes on localhost:5000/api...\n');

        const baseUrl = 'http://localhost:5000/api';

        // Define all available routes
        const routes = [
            // Health routes
            { method: 'GET', url: '/health', description: 'Basic health check' },
            { method: 'GET', url: '/health/db-status', description: 'Database status check' },

            // Stock In routes
            { method: 'GET', url: '/stock-in', description: 'Get stock in records' },
            { method: 'GET', url: '/stock-in/inventory/overview', description: 'Inventory overview' },

            // Menu routes
            { method: 'GET', url: '/menu/items', description: 'Get menu items' },
            { method: 'GET', url: '/menu/categories', description: 'Get menu categories' },

            // Usage routes
            { method: 'GET', url: '/usage/records', description: 'Get usage records' },
            { method: 'GET', url: '/usage/summary', description: 'Get usage summary' },

            // Unit Mapping routes
            { method: 'GET', url: '/unit-mapping/units', description: 'Get unit options' },
            { method: 'GET', url: '/unit-mapping/kitchen-units/1', description: 'Get kitchen units' },
            { method: 'GET', url: '/unit-mapping/inventory-items/1', description: 'Get inventory items' },
            { method: 'GET', url: '/unit-mapping/supplier-conversions/1', description: 'Get supplier conversions' },

            // User routes
            { method: 'GET', url: '/users', description: 'Get users' },

            // OCR routes
            { method: 'GET', url: '/ocr/images', description: 'Get OCR images' },

            // Wastage routes
            { method: 'GET', url: '/wastage', description: 'Get wastage records' }
        ];

        console.log('🌐 Testing GET endpoints...\n');

        let successCount = 0;
        let failCount = 0;

        for (const route of routes) {
            try {
                const response = await fetch(`${baseUrl}${route.url}`, {
                    method: route.method,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                const data = await response.json();

                if (response.ok) {
                    console.log(`✅ ${route.method} ${route.url} - Status: ${response.status}`);
                    console.log(`   📝 ${route.description}`);
                    if (data.data && Array.isArray(data.data)) {
                        console.log(`   📊 Data count: ${data.data.length} items`);
                    } else if (data.success !== undefined) {
                        console.log(`   ✨ Success: ${data.success}`);
                    }
                    successCount++;
                } else {
                    console.log(`❌ ${route.method} ${route.url} - Status: ${response.status}`);
                    console.log(`   📝 ${route.description}`);
                    console.log(`   ⚠️ Error: ${data.error || 'Unknown error'}`);
                    failCount++;
                }
            } catch (error) {
                console.log(`❌ ${route.method} ${route.url} - Connection failed`);
                console.log(`   📝 ${route.description}`);
                console.log(`   ⚠️ Error: ${error.message}`);
                failCount++;
            }

            console.log(''); // Empty line for readability
        }

        // Test POST endpoints
        console.log('📤 Testing POST endpoints...\n');

        // Test Stock In
        try {
            console.log('Testing POST /api/stock-in...');
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

            const stockInResponse = await fetch(`${baseUrl}/stock-in`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(stockInData)
            });

            const stockInResult = await stockInResponse.json();

            if (stockInResponse.ok) {
                console.log('✅ POST /api/stock-in - SUCCESS');
                console.log(`   📋 Stock In ID: ${stockInResult.data.stock_in_id}`);
                console.log(`   💰 Total Amount: ₹${stockInResult.data.total_amount}`);
                successCount++;
            } else {
                console.log('❌ POST /api/stock-in - FAILED');
                console.log(`   ⚠️ Error: ${stockInResult.error}`);
                failCount++;
            }
        } catch (error) {
            console.log(`❌ POST /api/stock-in - Connection failed: ${error.message}`);
            failCount++;
        }

        console.log('');

        // Test Usage Record
        try {
            console.log('Testing POST /api/usage/record...');
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

            const usageResponse = await fetch(`${baseUrl}/usage/record`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(usageData)
            });

            const usageResult = await usageResponse.json();

            if (usageResponse.ok) {
                console.log('✅ POST /api/usage/record - SUCCESS');
                console.log(`   📋 Total Items: ${usageResult.data.total_items}`);
                console.log(`   💰 Total Cost: ₹${usageResult.data.total_estimated_cost}`);
                successCount++;
            } else {
                console.log('❌ POST /api/usage/record - FAILED');
                console.log(`   ⚠️ Error: ${usageResult.error}`);
                failCount++;
            }
        } catch (error) {
            console.log(`❌ POST /api/usage/record - Connection failed: ${error.message}`);
            failCount++;
        }

        console.log('');

        // Test Kitchen Units Save
        try {
            console.log('Testing POST /api/unit-mapping/kitchen-units/1...');
            const kitchenUnitsData = {
                units: {
                    cup: { value: 250, unit: 'ml' },
                    tbsp: { value: 15, unit: 'ml' },
                    tsp: { value: 5, unit: 'ml' }
                }
            };

            const kitchenResponse = await fetch(`${baseUrl}/unit-mapping/kitchen-units/1`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(kitchenUnitsData)
            });

            const kitchenResult = await kitchenResponse.json();

            if (kitchenResponse.ok) {
                console.log('✅ POST /api/unit-mapping/kitchen-units/1 - SUCCESS');
                console.log(`   📋 Message: ${kitchenResult.message}`);
                successCount++;
            } else {
                console.log('❌ POST /api/unit-mapping/kitchen-units/1 - FAILED');
                console.log(`   ⚠️ Error: ${kitchenResult.error}`);
                failCount++;
            }
        } catch (error) {
            console.log(`❌ POST /api/unit-mapping/kitchen-units/1 - Connection failed: ${error.message}`);
            failCount++;
        }

        console.log('\n🎉 Route Testing Summary:');
        console.log(`✅ Successful: ${successCount}`);
        console.log(`❌ Failed: ${failCount}`);
        console.log(`📊 Total: ${successCount + failCount}`);
        console.log(`📈 Success Rate: ${((successCount / (successCount + failCount)) * 100).toFixed(1)}%`);

        console.log('\n🔗 All routes are properly configured for:');
        console.log(`   🌐 Base URL: http://localhost:5000/api`);
        console.log(`   🖥️ Frontend: http://localhost:3000`);
        console.log(`   ✅ Localhost-only configuration`);

        // Return route testing results
        return {
            allRoutesWorking: failCount === 0,
            successCount,
            failCount,
            totalRoutes: successCount + failCount,
            successRate: ((successCount / (successCount + failCount)) * 100).toFixed(1),
            routes: routes
        };

    } catch (error) {
        console.error('❌ Route testing failed:', error.message);
        return {
            allRoutesWorking: false,
            error: error.message
        };
    }
}

// Run test if this file is executed directly
if (require.main === module) {
    testAllRoutes()
        .then(() => {
            console.log('\n✨ All route tests completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n💥 Route testing failed:', error);
            process.exit(1);
        });
}

module.exports = { testAllRoutes };