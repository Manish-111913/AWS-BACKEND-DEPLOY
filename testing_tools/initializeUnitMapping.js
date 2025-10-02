const DatabaseSetup = require('./setupDB');
const { seedUnitMappingData } = require('./seedUnitMappingData');

async function initializeUnitMapping() {
  try {
    console.log('🚀 Initializing Unit Mapping System...\n');
    
    // First, set up the database schema
    const dbSetup = new DatabaseSetup();
    await dbSetup.setupDatabase();
    
    // Then, seed the unit mapping data
    await seedUnitMappingData();
    
    console.log('\n🎉 Unit Mapping System initialized successfully!');
    console.log('📋 What was created:');
    console.log('  ✅ Database schema with BusinessUnitConversions table');
    console.log('  ✅ Sample business and inventory items');
    console.log('  ✅ Global units for kitchen and supplier conversions');
    console.log('  ✅ Backend API endpoints for unit mapping');
    console.log('  ✅ Frontend service integration');
    console.log('\n🌐 API Endpoints available:');
    console.log('  GET  /api/unit-mapping/units');
    console.log('  GET  /api/unit-mapping/kitchen-units/:businessId');
    console.log('  POST /api/unit-mapping/kitchen-units/:businessId');
    console.log('  GET  /api/unit-mapping/inventory-items/:businessId');
    console.log('  GET  /api/unit-mapping/supplier-conversions/:businessId');
    console.log('  POST /api/unit-mapping/supplier-conversions/:businessId');
    console.log('  POST /api/unit-mapping/complete-setup/:businessId');
    console.log('\n🎯 Next steps:');
    console.log('  1. Start your backend server: npm start');
    console.log('  2. Start your frontend: cd ../frontend && npm start');
    console.log('  3. Navigate through the unit mapping flow');
    
  } catch (error) {
    console.error('\n❌ Unit Mapping initialization failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run initialization if this file is executed directly
if (require.main === module) {
  initializeUnitMapping().catch(console.error);
}

module.exports = { initializeUnitMapping };