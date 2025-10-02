// Test simple route display
console.log('🚀 Server running on http://localhost:5000');
console.log('📊 Environment: development');
console.log('🌐 Frontend: http://localhost:3000');
console.log('🔗 API Base URL: http://localhost:5000/api');

console.log('\n📋 Available Routes:');
console.log('━'.repeat(60));

// Health Routes
console.log('🏥 Health:');
console.log('   GET  /api/health');
console.log('   GET  /api/health/db-status');

// Stock In Routes
console.log('📦 Stock In:');
console.log('   GET  /api/stock-in');
console.log('   POST /api/stock-in');
console.log('   POST /api/stock-in/draft');
console.log('   GET  /api/stock-in/inventory/overview');
console.log('   GET  /api/stock-in/:id');
console.log('   PUT  /api/stock-in/:id/complete');
console.log('   DEL  /api/stock-in/:id');

// Menu Routes
console.log('🍽️ Menu:');
console.log('   GET  /api/menu/items');
console.log('   GET  /api/menu/categories');
console.log('   GET  /api/menu/test-image/:filename');

// Usage Routes (Stock Out)
console.log('📤 Usage (Stock Out):');
console.log('   POST /api/usage/record');
console.log('   GET  /api/usage/records');
console.log('   GET  /api/usage/summary');

// Unit Mapping Routes
console.log('📏 Unit Mapping:');
console.log('   GET  /api/unit-mapping/units');
console.log('   GET  /api/unit-mapping/conversions/:businessId');
console.log('   GET  /api/unit-mapping/kitchen-units/:businessId');
console.log('   POST /api/unit-mapping/kitchen-units/:businessId');
console.log('   GET  /api/unit-mapping/inventory-items/:businessId');
console.log('   GET  /api/unit-mapping/supplier-conversions/:businessId');
console.log('   POST /api/unit-mapping/supplier-conversions/:businessId');
console.log('   POST /api/unit-mapping/complete-setup/:businessId');

// User Routes
console.log('👥 Users:');
console.log('   GET  /api/users');
console.log('   GET  /api/users/:id');
console.log('   POST /api/users');

// OCR Routes
console.log('📄 OCR:');
console.log('   POST /api/ocr/upload');
console.log('   GET  /api/ocr/images');
console.log('   POST /api/ocr/process/:imageId');

// Wastage Routes
console.log('🗑️ Wastage:');
console.log('   GET  /api/wastage');
console.log('   POST /api/wastage');
console.log('   GET  /api/wastage/reasons');
console.log('   GET  /api/wastage/summary');

// Inventory Routes
console.log('📊 Inventory:');
console.log('   DEL  /api/inventory/items/:itemId/batches/:batchId');
console.log('   GET  /api/inventory/items/:itemId/batches');

console.log('━'.repeat(60));
console.log('📈 Total: 35 routes available');
console.log('✅ All routes configured for localhost:5000/api');