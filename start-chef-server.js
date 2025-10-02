const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Simple test server to verify chef endpoints
const app = express();
app.use(cors());
app.use(express.json());

// Import the orders routes
const ordersRoutes = require('./routes/orders');

// Mount routes
app.use('/api/orders', ordersRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Chef endpoints server is running' });
});

// Test endpoint to create sample orders
app.post('/api/test/create-sample-orders', async (req, res) => {
  try {
    const sampleOrders = [
      {
        customer_name: 'Test Customer 1',
        customer_phone: '1234567890',
        table_number: 'T1',
        items: [
          {
            menu_item_id: 1,
            quantity: 2,
            price: 12.99,
            item_name: 'Burger'
          }
        ],
        total_amount: 25.98,
        payment_method: 'Online',
        payment_status: 'paid'
      },
      {
        customer_name: 'Test Customer 2', 
        customer_phone: '0987654321',
        table_number: 'T2',
        items: [
          {
            menu_item_id: 2,
            quantity: 1,
            price: 8.99,
            item_name: 'Pizza Slice'
          }
        ],
        total_amount: 8.99,
        payment_method: 'Cash',
        payment_status: 'paid'
      }
    ];

    const results = [];
    for (const order of sampleOrders) {
      // This would create orders in the database
      results.push({ message: `Sample order for ${order.customer_name} would be created` });
    }

    res.json({ success: true, results });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log('🍽️ Chef Dashboard Test Server Started!');
  console.log(`📍 Server running on http://localhost:${PORT}`);
  console.log('\n📋 Available Chef Endpoints:');
  console.log(`   GET  /api/orders/chef/pending - Get pending orders`);
  console.log(`   GET  /api/orders/chef/stats - Get chef statistics`);
  console.log(`   PATCH /api/orders/:id/start-preparing - Start order preparation`);
  console.log(`   PATCH /api/orders/:id/complete - Complete order`);
  console.log(`   GET  /api/health - Health check`);
  console.log(`   POST /api/test/create-sample-orders - Create test orders`);
  console.log('\n🧪 Test the endpoints:');
  console.log(`   curl http://localhost:${PORT}/api/health`);
  console.log(`   curl -H "X-Business-Id: 1" http://localhost:${PORT}/api/orders/chef/pending`);
  console.log(`   curl -H "X-Business-Id: 1" http://localhost:${PORT}/api/orders/chef/stats`);
  console.log('\n🌐 Frontend URLs:');
  console.log('   Chef Dashboard: http://localhost:3000/chef/dashboard');
  console.log('   Customer Orders: http://localhost:3000/customer/orders/1');
  console.log('   Owner Dashboard: http://localhost:3000/owner/dashboard');
});