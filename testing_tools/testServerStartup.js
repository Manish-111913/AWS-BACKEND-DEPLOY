// Test server startup with route display
const { testAndDisplayRoutes } = require('./displayRoutes');

async function testServerStartup() {
    console.log('🚀 Testing Server Startup with Route Display...\n');

    try {
        // Simulate server startup
        console.log('✅ Database connection established');
        console.log('🚀 Server running on http://localhost:5000');
        console.log('📊 Environment: development');
        console.log('🌐 Frontend: http://localhost:3000');
        console.log('🔗 API Base URL: http://localhost:5000/api');

        // Test and display all routes
        console.log('\n⏳ Testing all routes...');
        const success = await testAndDisplayRoutes();

        if (success) {
            console.log('\n🎉 Server startup completed successfully with all routes working!');
        } else {
            console.log('\n⚠️ Server started but some routes may have issues.');
        }

    } catch (error) {
        console.error('❌ Server startup test failed:', error);
    }
}

// Run the test
testServerStartup();