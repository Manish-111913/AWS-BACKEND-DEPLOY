async function testCompleteUnitMappingFlow() {
  try {
    console.log('🚀 Testing Complete Unit Mapping Flow...\n');

    const businessId = 1;
    const baseUrl = 'http://localhost:5000/api/unit-mapping';

    // Test 1: Get unit options
    console.log('1. Testing unit options...');
    const unitsResponse = await fetch(`${baseUrl}/units`);
    const unitsData = await unitsResponse.json();
    
    if (unitsData.success) {
      console.log(`✅ Found ${unitsData.data.kitchen.length} kitchen units, ${unitsData.data.supplier.length} supplier units, ${unitsData.data.container.length} container units`);
    } else {
      throw new Error('Failed to get unit options');
    }

    // Test 2: Save kitchen units
    console.log('\n2. Testing kitchen units save...');
    const kitchenUnits = {
      cup: { value: 250, unit: 'ml' },
      tbsp: { value: 15, unit: 'ml' },
      tsp: { value: 5, unit: 'ml' }
    };

    const kitchenResponse = await fetch(`${baseUrl}/kitchen-units/${businessId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ units: kitchenUnits })
    });
    
    const kitchenResult = await kitchenResponse.json();
    if (kitchenResult.success) {
      console.log('✅ Kitchen units saved successfully');
    } else {
      throw new Error(`Kitchen units save failed: ${kitchenResult.error}`);
    }

    // Test 3: Get inventory items
    console.log('\n3. Testing inventory items...');
    const inventoryResponse = await fetch(`${baseUrl}/inventory-items/${businessId}`);
    const inventoryData = await inventoryResponse.json();
    
    if (inventoryData.success && inventoryData.data.length > 0) {
      console.log(`✅ Found ${inventoryData.data.length} inventory items`);
      console.log(`   Sample items: ${inventoryData.data.slice(0, 3).map(item => item.name).join(', ')}`);
    } else {
      throw new Error('No inventory items found');
    }

    // Test 4: Save supplier conversions
    console.log('\n4. Testing supplier conversions save...');
    const supplierConversions = [
      {
        item: inventoryData.data[0].name, // Use first inventory item
        containerType: 'bag',
        quantity: 25,
        unit: 'kg'
      },
      {
        item: inventoryData.data[1].name, // Use second inventory item
        containerType: 'box',
        quantity: 12,
        unit: 'pc'
      }
    ];

    const supplierResponse = await fetch(`${baseUrl}/supplier-conversions/${businessId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversions: supplierConversions })
    });
    
    const supplierResult = await supplierResponse.json();
    if (supplierResult.success) {
      console.log('✅ Supplier conversions saved successfully');
    } else {
      throw new Error(`Supplier conversions save failed: ${supplierResult.error}`);
    }

    // Test 5: Get saved kitchen units
    console.log('\n5. Testing kitchen units retrieval...');
    const savedKitchenResponse = await fetch(`${baseUrl}/kitchen-units/${businessId}`);
    const savedKitchenData = await savedKitchenResponse.json();
    
    if (savedKitchenData.success) {
      console.log('✅ Kitchen units retrieved successfully');
      console.log(`   Conversions: ${Object.entries(savedKitchenData.data).map(([key, val]) => `1 ${key} = ${val.value} ${val.unit}`).join(', ')}`);
    } else {
      throw new Error('Failed to retrieve kitchen units');
    }

    // Test 6: Get saved supplier conversions
    console.log('\n6. Testing supplier conversions retrieval...');
    const savedSupplierResponse = await fetch(`${baseUrl}/supplier-conversions/${businessId}`);
    const savedSupplierData = await savedSupplierResponse.json();
    
    if (savedSupplierData.success) {
      console.log(`✅ Supplier conversions retrieved successfully (${savedSupplierData.data.length} conversions)`);
    } else {
      throw new Error('Failed to retrieve supplier conversions');
    }

    // Test 7: Complete setup
    console.log('\n7. Testing setup completion...');
    const completeResponse = await fetch(`${baseUrl}/complete-setup/${businessId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const completeResult = await completeResponse.json();
    if (completeResult.success) {
      console.log('✅ Setup completed successfully');
    } else {
      throw new Error(`Setup completion failed: ${completeResult.error}`);
    }

    console.log('\n🎉 Complete Unit Mapping Flow Test PASSED!');
    console.log('\n📋 Summary:');
    console.log('  ✅ Unit options loaded');
    console.log('  ✅ Kitchen units saved and retrieved');
    console.log('  ✅ Inventory items loaded');
    console.log('  ✅ Supplier conversions saved and retrieved');
    console.log('  ✅ Setup marked as complete');
    console.log('\n🚀 The unit mapping system is fully functional!');

  } catch (error) {
    console.error('\n❌ Complete flow test failed:', error.message);
    throw error;
  }
}

// Run test if this file is executed directly
if (require.main === module) {
  testCompleteUnitMappingFlow()
    .then(() => {
      console.log('\n✨ All tests completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = { testCompleteUnitMappingFlow };