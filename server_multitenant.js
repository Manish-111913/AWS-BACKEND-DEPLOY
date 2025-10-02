const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

// Original routes
const stockInRoutes = require('./routes/stockIn');
const inventoryRoutes = require('./routes/inventory');
const ocrRoutes = require('./routes/ocr');
const salesReportRoutes = require('./routes/salesReport');
const menuRoutes = require('./routes/menu');
const recipesRoutes = require('./routes/recipes');
const wastageRoutes = require('./routes/wastage');
const usersRoutes = require('./routes/users');
const healthRoutes = require('./routes/health');
const usageRoutes = require('./routes/usage');
const unitMappingRoutes = require('./routes/unitMapping');
const authRoutes = require('./routes/auth');
const totalSales=require('./routes/totalSales');
const reportsRoutes = require('./routes/reports');
const abcAnalysisRoutes = require('./routes/abcAnalysis');
const recipeLibraryRoutes = require('./routes/recipeLibrary');
const imagesRoutes = require('./routes/images');
const rolesRoutes = require('./routes/roles');
const settingsRoutes = require('./routes/settings');
const inventoryCategoriesRoutes = require('./routes/inventoryCategories');
const minimalStockRoutes = require('./routes/minimalStock');
const vendorManagementRoutes = require('./routes/vendorManagement');
const reorderManagementRoutes = require('./routes/reorderManagement');
const notificationsRoutes = require('./routes/notifications');
const testCategoryAssignmentsRoutes = require('./routes/testCategoryAssignments');
const stockRepoRoutes = require('./routes/stockrepo'); 

// QR Code System Routes
const qrCodesRoutes = require('./routes/qrCodes');
const qrScanRoutes = require('./routes/qrScan');

// === MULTITENANT ARCHITECTURE ===
// Multitenant components
const MultiTenantManager = require('./services/MultiTenantManager');
const TenantMiddleware = require('./middleware/tenantMiddleware');
const tenantsRoutes = require('./routes/tenants');

// Report Scheduler Service
const reportScheduler = require('./services/reportScheduler');
const { testConnection, pool } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 5000;

// === MULTITENANT INITIALIZATION ===
let multiTenantManager;
let tenantMiddleware;

async function initializeMultiTenant() {
    try {
        console.log('🔄 Initializing Multitenant Architecture...');
        
        // Initialize MultiTenant Manager
        multiTenantManager = new MultiTenantManager();
        await multiTenantManager.initialize({
            connectionString: process.env.DATABASE_URL,
            ssl: {
                rejectUnauthorized: false
            }
        });
        
        // Initialize Tenant Middleware
        tenantMiddleware = new TenantMiddleware(multiTenantManager);
        
        console.log('✅ Multitenant architecture initialized successfully');
        return true;
    } catch (error) {
        console.error('❌ Failed to initialize multitenant architecture:', error);
        return false;
    }
}

// Set up EJS template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(helmet());

// CORS configuration
const corsOptions = {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'Cache-Control',
        'X-Tenant-ID',        // Multitenant headers
        'X-API-Key'
    ]
};

app.use(cors(corsOptions));

// Add Cross-Origin-Resource-Policy header to all responses
app.use((req, res, next) => {
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
});

// Minimal logging - only log OCR requests
app.use('/api/ocr', (req, res, next) => {
    console.log(`OCR ${req.method} request triggered`);
    next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// === MULTITENANT MIDDLEWARE SETUP ===
// Add master database connection to all requests
app.use((req, res, next) => {
    req.masterDb = pool;
    req.tenantManager = multiTenantManager;
    next();
});

// Serve static files from uploads directory with CORS headers
app.use('/uploads', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
}, express.static('uploads'));

// Serve static files from images directory with CORS headers
app.use('/images', (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    res.header('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
}, express.static('images'));

// === HEALTH CHECK AND PUBLIC ROUTES ===
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        multitenant: {
            enabled: !!multiTenantManager,
            tenantsLoaded: multiTenantManager ? multiTenantManager.tenantConfigs.size : 0
        }
    });
});

// === ADMIN ROUTES (No tenant context required) ===
app.use('/api/admin/tenants', tenantsRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);

// === TENANT-AWARE ROUTES ===
// Apply tenant middleware to all API routes except admin and health
app.use('/api', (req, res, next) => {
    // Skip tenant middleware for admin and auth routes
    if (req.path.startsWith('/admin/') || req.path.startsWith('/auth') || req.path.startsWith('/health')) {
        return next();
    }
    
    // Development bypass for QR routes - temporarily skip tenant validation
    if (process.env.NODE_ENV === 'development' && req.path.startsWith('/qr')) {
        // Set minimal tenant context for QR routes in development
        req.tenant = {
            id: '1',
            name: 'Development Tenant',
            strategy: 'shared_schema',
            config: { tenant_id: '1', name: 'Development Tenant', tenant_strategy: 'shared_schema' }
        };
        req.tenantConnection = null; // Will fall back to default pool
        return next();
    }
    
    // Apply tenant context middleware
    if (multiTenantManager && tenantMiddleware) {
        return tenantMiddleware.tenantContext()(req, res, next);
    } else {
        // Fallback for backward compatibility
        console.warn('⚠️  Multitenant not initialized, using legacy mode');
        return next();
    }
});

// Apply tenant query wrapper to tenant-aware routes
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/admin/') || req.path.startsWith('/auth') || req.path.startsWith('/health')) {
        return next();
    }
    
    if (multiTenantManager && tenantMiddleware && req.tenant) {
        return tenantMiddleware.tenantQueryWrapper()(req, res, next);
    }
    
    next();
});

// Apply tenant rate limiting
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/admin/') || req.path.startsWith('/auth') || req.path.startsWith('/health')) {
        return next();
    }
    
    if (multiTenantManager && tenantMiddleware && req.tenant) {
        return tenantMiddleware.tenantRateLimit()(req, res, next);
    }
    
    next();
});

// Apply tenant resource validation
app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/admin/') || req.path.startsWith('/auth') || req.path.startsWith('/health')) {
        return next();
    }
    
    if (multiTenantManager && tenantMiddleware && req.tenant) {
        return tenantMiddleware.tenantResourceValidation()(req, res, next);
    }
    
    next();
});

// === BUSINESS LOGIC ROUTES (Now Tenant-Aware) ===
app.use('/api/stock-in', stockInRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/sales-report', salesReportRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/recipes', recipesRoutes);
app.use('/api/wastage', wastageRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/unit-mapping', unitMappingRoutes);
app.use('/api/total-sales', totalSales);
app.use('/api/reports', reportsRoutes);
app.use('/api/abc-analysis', abcAnalysisRoutes);
app.use('/api/recipe-library', recipeLibraryRoutes);
app.use('/api/images', imagesRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/inventory-categories', inventoryCategoriesRoutes);
app.use('/api/minimal-stock', minimalStockRoutes);
app.use('/api/vendor-management', vendorManagementRoutes);
app.use('/api/reorder', reorderManagementRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/test', testCategoryAssignmentsRoutes);
app.use('/api/stockrepo', stockRepoRoutes);

// === QR CODE SYSTEM ROUTES (Tenant-Aware) ===
app.use('/api/qr', qrCodesRoutes);
app.use('/qr', qrScanRoutes);  // Direct QR scan routes (no /api prefix)
app.use('/', qrScanRoutes);    // Session routes

// === MULTITENANT API INFORMATION ===
app.get('/api/multitenant/info', (req, res) => {
    if (!multiTenantManager) {
        return res.status(503).json({
            success: false,
            error: 'Multitenant system not initialized'
        });
    }
    
    const tenants = Array.from(multiTenantManager.tenantConfigs.values()).map(tenant => ({
        tenant_id: tenant.tenant_id,
        name: tenant.name,
        strategy: tenant.tenant_strategy,
        status: tenant.status,
        created_at: tenant.created_at
    }));
    
    res.json({
        success: true,
        multitenant: {
            enabled: true,
            totalTenants: tenants.length,
            strategies: {
                shared_schema: tenants.filter(t => t.strategy === 'shared_schema').length,
                separate_schema: tenants.filter(t => t.strategy === 'separate_schema').length,
                separate_database: tenants.filter(t => t.strategy === 'separate_database').length
            },
            tenants: tenants
        }
    });
});

// === ERROR HANDLING ===
// Tenant-specific error handler
app.use((err, req, res, next) => {
    if (multiTenantManager && tenantMiddleware && req.tenant) {
        return tenantMiddleware.tenantErrorHandler()(err, req, res, next);
    }
    
    // Fallback to default error handler
    next(err);
});

// Default error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);

    // Handle different types of errors
    if (err.name === 'ValidationError') {
        return res.status(400).json({
            success: false,
            error: 'Validation Error',
            details: err.message
        });
    }

    if (err.code === '23505') { // PostgreSQL unique constraint violation
        return res.status(409).json({
            success: false,
            error: 'Duplicate Entry',
            details: 'A record with this information already exists'
        });
    }

    if (err.code === '23503') { // PostgreSQL foreign key constraint violation
        return res.status(400).json({
            success: false,
            error: 'Invalid Reference',
            details: 'Referenced record does not exist'
        });
    }

    if (err.code === '22P02') { // PostgreSQL invalid input syntax
        return res.status(400).json({
            success: false,
            error: 'Invalid Data Format',
            details: 'The provided data format is invalid'
        });
    }

    // Default server error
    res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        details: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// Start server with multitenant initialization
async function startServer() {
    try {
        // Test database connection
        console.log('🔄 Testing database connection...');
        await testConnection();
        console.log('✅ Database connection successful');
        
        // Initialize multitenant architecture
        const multitenantInitialized = await initializeMultiTenant();
        
        if (!multitenantInitialized) {
            console.warn('⚠️  Multitenant initialization failed, starting in legacy mode');
        }
        
        // Start report scheduler
        console.log('🔄 Starting report scheduler...');
        await reportScheduler.initialize();
        console.log('✅ Report scheduler started');
        
        // Start server
        app.listen(PORT, () => {
            console.log('🚀 Server is running on port', PORT);
            console.log('📊 Available endpoints:');
            console.log('   • Health Check: http://localhost:' + PORT + '/health');
            console.log('   • Multitenant Info: http://localhost:' + PORT + '/api/multitenant/info');
            console.log('   • Admin Panel: http://localhost:' + PORT + '/api/admin/tenants');
            console.log('   • QR Management: http://localhost:' + PORT + '/api/qr');
            
            if (multitenantInitialized) {
                console.log('🏢 Multitenant Architecture Status:');
                console.log('   ✅ Shared Schema Strategy: tenant_id filtering + RLS');
                console.log('   ✅ Separate Schema Strategy: schema per tenant');
                console.log('   ✅ Separate Database Strategy: database per tenant');
                console.log('   📊 Loaded Tenants:', multiTenantManager.tenantConfigs.size);
            }
        });
        
        // Setup graceful shutdown with cleanup
        const gracefulShutdown = async (signal) => {
            console.log(`\n📴 Received ${signal}. Starting graceful shutdown...`);
            
            // Stop report scheduler
            if (reportScheduler) {
                await reportScheduler.stop();
                console.log('✅ Report scheduler stopped');
            }
            
            // Cleanup multitenant connections
            if (multiTenantManager) {
                await multiTenantManager.shutdown();
                console.log('✅ Multitenant manager shutdown complete');
            }
            
            // Close database pool
            if (pool) {
                await pool.end();
                console.log('✅ Database connections closed');
            }
            console.log('👋 Server shutdown complete');
            process.exit(0);
        };      
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        
        // Periodic cleanup of tenant connections
        if (multiTenantManager) {
            setInterval(() => {
                multiTenantManager.cleanupConnections().catch(console.error);
            }, 10 * 60 * 1000); // Every 10 minutes
        }
        
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}
// Start the server
startServer();
module.exports = app;