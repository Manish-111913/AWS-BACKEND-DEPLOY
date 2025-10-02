const express = require('express');
const cors = require('cors');
require('dotenv').config();

const unitMappingRoutes = require('./routes/unitMapping');
const { testConnection } = require('./config/database');

const app = express();
const PORT = 5001; // Use a different port

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/unit-mapping', unitMappingRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Test server running' });
});

// Start server
const startServer = async () => {
  try {
    await testConnection();
    console.log('✅ Database connection established');

    app.listen(PORT, () => {
      console.log(`🚀 Test server running on http://localhost:${PORT}`);
      console.log('🧪 Testing unit mapping endpoints...');
    });
  } catch (error) {
    console.error('❌ Failed to start test server:', error);
    process.exit(1);
  }
};

startServer();