// Function to display all available routes
function displayAllRoutes() {
  const routes = [
    // Health Routes
    { method: 'GET', path: '/api/health', description: 'Basic health check', category: 'Health' },
    { method: 'GET', path: '/api/health/db-status', description: 'Database status check', category: 'Health' },
    
    // Stock In Routes
    { method: 'GET', path: '/api/stock-in', description: 'Get all stock in records', category: 'Stock In' },
    { method: 'POST', path: '/api/stock-in', description: 'Create new stock in record', category: 'Stock In' },
    { method: 'POST', path: '/api/stock-in/draft', description: 'Create draft stock in record', category: 'Stock In' },
    { method: 'GET', path: '/api/stock-in/inventory/overview', description: 'Get inventory overview', category: 'Stock In' },
    { method: 'GET', path: '/api/stock-in/:id', description: 'Get specific stock in record', category: 'Stock In' },
    { method: 'PUT', path: '/api/stock-in/:id/complete', description: 'Convert draft to completed', category: 'Stock In' },
    { method: 'DELETE', path: '/api/stock-in/:id', description: 'Delete stock in record', category: 'Stock In' },
    
    // Menu Routes
    { method: 'GET', path: '/api/menu/items', description: 'Get all menu items', category: 'Menu' },
    { method: 'GET', path: '/api/menu/categories', description: 'Get menu categories', category: 'Menu' },
    { method: 'GET', path: '/api/menu/test-image/:filename', description: 'Test image accessibility', category: 'Menu' },
    
    // Usage Routes (Stock Out)
    { method: 'POST', path: '/api/usage/record', description: 'Record production usage', category: 'Usage' },
    { method: 'GET', path: '/api/usage/records', description: 'Get usage records', category: 'Usage' },
    { method: 'GET', path: '/api/usage/summary', description: 'Get usage summary by date range', category: 'Usage' },
    
    // Unit Mapping Routes
    { method: 'GET', path: '/api/unit-mapping/units', description: 'Get all available units', category: 'Unit Mapping' },
    { method: 'GET', path: '/api/unit-mapping/conversions/:businessId', description: 'Get business unit conversions', category: 'Unit Mapping' },
    { method: 'GET', path: '/api/unit-mapping/kitchen-units/:businessId', description: 'Get kitchen units', category: 'Unit Mapping' },
    { method: 'POST', path: '/api/unit-mapping/kitchen-units/:businessId', description: 'Save kitchen units', category: 'Unit Mapping' },
    { method: 'GET', path: '/api/unit-mapping/inventory-items/:businessId', description: 'Get inventory items', category: 'Unit Mapping' },
    { method: 'GET', path: '/api/unit-mapping/supplier-conversions/:businessId', description: 'Get supplier conversions', category: 'Unit Mapping' },
    { method: 'POST', path: '/api/unit-mapping/supplier-conversions/:businessId', description: 'Save supplier conversions', category: 'Unit Mapping' },
    { method: 'POST', path: '/api/unit-mapping/complete-setup/:businessId', description: 'Complete unit mapping setup', category: 'Unit Mapping' },
    
    // User Routes
    { method: 'GET', path: '/api/users', description: 'Get all users for a business', category: 'Users' },
    { method: 'GET', path: '/api/users/:id', description: 'Get specific user', category: 'Users' },
    { method: 'POST', path: '/api/users', description: 'Create new user', category: 'Users' },
    
    // OCR Routes
    { method: 'POST', path: '/api/ocr/upload', description: 'Upload and process image/document', category: 'OCR' },
    { method: 'GET', path: '/api/ocr/images', description: 'Get uploaded images', category: 'OCR' },
    { method: 'POST', path: '/api/ocr/process/:imageId', description: 'Process OCR for image', category: 'OCR' },
    
    // Wastage Routes
    { method: 'GET', path: '/api/wastage', description: 'Get wastage records', category: 'Wastage' },
    { method: 'POST', path: '/api/wastage', description: 'Record wastage', category: 'Wastage' },
    { method: 'GET', path: '/api/wastage/reasons', description: 'Get wastage reasons', category: 'Wastage' },
    { method: 'GET', path: '/api/wastage/summary', description: 'Get wastage summary', category: 'Wastage' },
    
    // ABC Analysis Routes  
    { method: 'GET', path: '/api/abc-analysis/calculate', description: 'Calculate ABC analysis for inventory', category: 'ABC Analysis' },
    { method: 'GET', path: '/api/abc-analysis/history', description: 'Get historical ABC analysis results', category: 'ABC Analysis' },
    { method: 'GET', path: '/api/abc-analysis/recommendations', description: 'Get ABC-based inventory recommendations', category: 'ABC Analysis' },
    
    // Inventory Routes
    { method: 'DELETE', path: '/api/inventory/items/:itemId/batches/:batchId', description: 'Delete inventory batch', category: 'Inventory' },
    { method: 'GET', path: '/api/inventory/items/:itemId/batches', description: 'Get all batches for an item', category: 'Inventory' }
  ];

  console.log('\n🎯 Available API Endpoints:');
  console.log('━'.repeat(80));
  
  // Group routes by category
  const groupedRoutes = routes.reduce((acc, route) => {
    if (!acc[route.category]) {
      acc[route.category] = [];
    }
    acc[route.category].push(route);
    return acc;
  }, {});

  // Display routes by category
  Object.entries(groupedRoutes).forEach(([category, categoryRoutes]) => {
    console.log(`\n📂 ${category} Routes:`);
    categoryRoutes.forEach(route => {
      const methodColor = getMethodColor(route.method);
      console.log(`   ${methodColor} ${route.method.padEnd(6)} ${route.path.padEnd(50)} - ${route.description}`);
    });
  });

  console.log('\n━'.repeat(80));
  console.log(`📊 Total Routes: ${routes.length}`);
  console.log(`🌐 Base URL: http://localhost:5000/api`);
  console.log(`🖥️ Frontend: http://localhost:3000`);
  console.log('━'.repeat(80));

  return routes;
}

function getMethodColor(method) {
  const colors = {
    'GET': '🟢',
    'POST': '🔵', 
    'PUT': '🟡',
    'DELETE': '🔴'
  };
  return colors[method] || '⚪';
}

// Function to test and display routes
async function testAndDisplayRoutes() {
  try {
    console.log('🧪 Testing all routes before displaying...');
    
    // Import and run the route test
    const { testAllRoutes } = require('./testAllRoutes');
    const testResults = await testAllRoutes();
    
    if (testResults && testResults.allRoutesWorking) {
      console.log('\n✅ All routes tested successfully! Displaying complete route list...');
      displayAllRoutes();
      return true;
    } else {
      console.log('\n⚠️ Some routes failed testing. Displaying available routes anyway...');
      displayAllRoutes();
      return false;
    }
  } catch (error) {
    console.error('❌ Error testing routes:', error.message);
    console.log('\n📋 Displaying available routes...');
    displayAllRoutes();
    return false;
  }
}

module.exports = { displayAllRoutes, testAndDisplayRoutes };