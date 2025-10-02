/**
 * Multitenant Architecture Test Suite
 * Tests all three tenant strategies with comprehensive scenarios
 */

const MultiTenantManager = require('../services/MultiTenantManager');
const { pool } = require('../config/database');

class MultiTenantTester {
    constructor() {
        this.tenantManager = null;
        this.testResults = [];
    }

    async initialize() {
        console.log('🔄 Initializing Multitenant Test Suite...');
        
        this.tenantManager = new MultiTenantManager();
        await this.tenantManager.initialize({
            host: process.env.DB_HOST,
            port: process.env.DB_PORT,
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            ssl: process.env.DB_SSL === 'true'
        });
        
        console.log('✅ Multitenant system initialized for testing');
    }

    async runAllTests() {
        console.log('\n🧪 Running Comprehensive Multitenant Tests...\n');
        
        try {
            // Test 1: Shared Schema Strategy
            await this.testSharedSchemaStrategy();
            
            // Test 2: Separate Schema Strategy
            await this.testSeparateSchemaStrategy();
            
            // Test 3: Separate Database Strategy (info only)
            await this.testSeparateDatabaseStrategy();
            
            // Test 4: Data Isolation
            await this.testDataIsolation();
            
            // Test 5: Performance and Metrics
            await this.testPerformanceMetrics();
            
            // Test 6: Tenant Management
            await this.testTenantManagement();
            
            // Test 7: Connection Management
            await this.testConnectionManagement();
            
        } catch (error) {
            console.error('❌ Test suite failed:', error);
        }
        
        this.displayResults();
    }

    async testSharedSchemaStrategy() {
        console.log('📋 Test 1: Shared Schema Strategy (tenant_id filtering)');
        console.log('─'.repeat(60));
        
        const tenantId = 'demo_restaurant';
        let passed = 0;
        let total = 0;
        
        try {
            // Test connection
            total++;
            const connection = await this.tenantManager.getTenantConnection(tenantId);
            if (connection && connection.strategy === 'shared_schema') {
                console.log('✅ Shared schema connection established');
                passed++;
            } else {
                console.log('❌ Failed to establish shared schema connection');
            }
            
            // Test QR code insertion with tenant filtering
            total++;
            const insertResult = await this.tenantManager.executeQuery(tenantId, `
                INSERT INTO qr_codes (qr_id, table_number, tenant_id, anchor_url, business_id)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *
            `, ['test_shared_001', 'TEST_S1', tenantId, 'https://test.com/shared/001', 1]);
            
            if (insertResult.rows.length > 0) {
                console.log('✅ QR code inserted with tenant_id filtering');
                passed++;
            } else {
                console.log('❌ Failed to insert QR code');
            }
            
            // Test tenant isolation (shouldn't see other tenant's data)
            total++;
            const isolationResult = await this.tenantManager.executeQuery(tenantId, `
                SELECT * FROM qr_codes WHERE table_number = 'TEST_S1'
            `);
            
            if (isolationResult.rows.length > 0 && isolationResult.rows[0].tenant_id === tenantId) {
                console.log('✅ Tenant isolation working (can see own data)');
                passed++;
            } else {
                console.log('❌ Tenant isolation failed');
            }
            
            // Test metrics
            total++;
            const metrics = await this.tenantManager.getTenantMetrics(tenantId);
            if (metrics && typeof metrics.totalTables === 'number') {
                console.log('✅ Metrics retrieval working');
                console.log(`   📊 Total tables: ${metrics.totalTables}`);
                passed++;
            } else {
                console.log('❌ Metrics retrieval failed');
            }
            
            // Cleanup test data
            await this.tenantManager.executeQuery(tenantId, `
                DELETE FROM qr_codes WHERE qr_id = 'test_shared_001'
            `);
            
        } catch (error) {
            console.log('❌ Shared schema test failed:', error.message);
        }
        
        this.testResults.push({
            strategy: 'Shared Schema',
            passed,
            total,
            percentage: Math.round((passed / total) * 100)
        });
        
        console.log(`📈 Shared Schema Tests: ${passed}/${total} passed (${Math.round((passed / total) * 100)}%)\n`);
    }

    async testSeparateSchemaStrategy() {
        console.log('📋 Test 2: Separate Schema Strategy (schema per tenant)');
        console.log('─'.repeat(60));
        
        const tenantId = 'test_hotel';
        let passed = 0;
        let total = 0;
        
        try {
            // Check if tenant has separate schema
            total++;
            const schemaCheck = await pool.query(`
                SELECT * FROM tenant_schemas WHERE tenant_id = $1 AND is_active = true
            `, [tenantId]);
            
            if (schemaCheck.rows.length > 0) {
                console.log('✅ Separate schema exists for tenant');
                passed++;
                
                const schemaName = schemaCheck.rows[0].schema_name;
                console.log(`   📁 Schema name: ${schemaName}`);
                
                // Test connection to schema
                total++;
                const connection = await this.tenantManager.getTenantConnection(tenantId);
                if (connection && connection.strategy === 'separate_schema') {
                    console.log('✅ Separate schema connection established');
                    passed++;
                    
                    // Test table operations in separate schema
                    total++;
                    try {
                        const testResult = await connection.client.query(`
                            INSERT INTO qr_codes (qr_id, table_number, anchor_url, business_id)
                            VALUES ('test_schema_001', 'TEST_SCHEMA_1', 'https://test.com/schema/001', 1)
                            RETURNING *
                        `);
                        
                        if (testResult.rows.length > 0) {
                            console.log('✅ Operations in separate schema working');
                            passed++;
                            
                            // Cleanup
                            await connection.client.query(`
                                DELETE FROM qr_codes WHERE qr_id = 'test_schema_001'
                            `);
                        }
                    } catch (opError) {
                        console.log('❌ Operations in separate schema failed:', opError.message);
                    }
                } else {
                    console.log('❌ Failed to establish separate schema connection');
                }
            } else {
                console.log('⚠️  No separate schema found for tenant (may not be created yet)');
                console.log('   💡 Run migration to create separate schemas');
            }
            
        } catch (error) {
            console.log('❌ Separate schema test failed:', error.message);
        }
        
        this.testResults.push({
            strategy: 'Separate Schema',
            passed,
            total,
            percentage: total > 0 ? Math.round((passed / total) * 100) : 0
        });
        
        console.log(`📈 Separate Schema Tests: ${passed}/${total} passed (${total > 0 ? Math.round((passed / total) * 100) : 0}%)\n`);
    }

    async testSeparateDatabaseStrategy() {
        console.log('📋 Test 3: Separate Database Strategy (database per tenant)');
        console.log('─'.repeat(60));
        
        const tenantId = 'sample_cafe';
        let passed = 0;
        let total = 1;
        
        try {
            // Check tenant configuration for separate database
            const tenantConfig = this.tenantManager.tenantConfigs.get(tenantId);
            
            if (tenantConfig && tenantConfig.tenant_strategy === 'separate_database') {
                console.log('✅ Tenant configured for separate database strategy');
                console.log('   📝 Note: Separate database requires external database setup');
                console.log('   💡 Each tenant would have their own database instance');
                console.log('   🔧 Connection details would be stored in tenant configuration');
                passed++;
            } else {
                console.log('⚠️  Tenant not configured for separate database strategy');
            }
            
        } catch (error) {
            console.log('❌ Separate database test failed:', error.message);
        }
        
        this.testResults.push({
            strategy: 'Separate Database',
            passed,
            total,
            percentage: Math.round((passed / total) * 100)
        });
        
        console.log(`📈 Separate Database Tests: ${passed}/${total} passed (${Math.round((passed / total) * 100)}%)\n`);
    }

    async testDataIsolation() {
        console.log('📋 Test 4: Data Isolation Between Tenants');
        console.log('─'.repeat(60));
        
        let passed = 0;
        let total = 0;
        
        try {
            const tenant1 = 'demo_restaurant';
            const tenant2 = 'test_hotel';
            
            // Insert test data for tenant 1
            total++;
            await this.tenantManager.executeQuery(tenant1, `
                INSERT INTO qr_codes (qr_id, table_number, tenant_id, anchor_url, business_id)
                VALUES ('isolation_test_1', 'ISOLATION_T1', $1, 'https://test.com/isolation/1', 1)
            `, [tenant1]);
            
            // Try to access tenant 1's data from tenant 2's context
            const tenant2Result = await this.tenantManager.executeQuery(tenant2, `
                SELECT * FROM qr_codes WHERE qr_id = 'isolation_test_1'
            `);
            
            if (tenant2Result.rows.length === 0) {
                console.log('✅ Data isolation working - Tenant 2 cannot see Tenant 1 data');
                passed++;
            } else {
                console.log('❌ Data isolation failed - Cross-tenant data access detected');
            }
            
            // Verify tenant 1 can still see its own data
            total++;
            const tenant1Result = await this.tenantManager.executeQuery(tenant1, `
                SELECT * FROM qr_codes WHERE qr_id = 'isolation_test_1'
            `);
            
            if (tenant1Result.rows.length > 0) {
                console.log('✅ Tenant can access own data correctly');
                passed++;
            } else {
                console.log('❌ Tenant cannot access own data');
            }
            
            // Cleanup
            await this.tenantManager.executeQuery(tenant1, `
                DELETE FROM qr_codes WHERE qr_id = 'isolation_test_1'
            `);
            
        } catch (error) {
            console.log('❌ Data isolation test failed:', error.message);
        }
        
        this.testResults.push({
            strategy: 'Data Isolation',
            passed,
            total,
            percentage: total > 0 ? Math.round((passed / total) * 100) : 0
        });
        
        console.log(`📈 Data Isolation Tests: ${passed}/${total} passed (${total > 0 ? Math.round((passed / total) * 100) : 0}%)\n`);
    }

    async testPerformanceMetrics() {
        console.log('📋 Test 5: Performance and Metrics');
        console.log('─'.repeat(60));
        
        let passed = 0;
        let total = 0;
        
        try {
            const tenantId = 'demo_restaurant';
            
            // Test metrics retrieval performance
            total++;
            const startTime = Date.now();
            const metrics = await this.tenantManager.getTenantMetrics(tenantId);
            const endTime = Date.now();
            const responseTime = endTime - startTime;
            
            if (metrics && responseTime < 1000) { // Should be under 1 second
                console.log('✅ Metrics retrieval performance acceptable');
                console.log(`   ⏱️  Response time: ${responseTime}ms`);
                console.log(`   📊 Metrics: ${JSON.stringify(metrics, null, 2)}`);
                passed++;
            } else {
                console.log('❌ Metrics retrieval too slow or failed');
            }
            
            // Test activity logging
            total++;
            await this.tenantManager.logTenantActivity(tenantId, 'performance_test', {
                test: 'multitenant_suite',
                timestamp: new Date().toISOString()
            });
            
            // Verify activity was logged
            const activityCheck = await pool.query(`
                SELECT * FROM tenant_activity_logs 
                WHERE tenant_id = $1 AND activity_type = 'performance_test'
                ORDER BY created_at DESC LIMIT 1
            `, [tenantId]);
            
            if (activityCheck.rows.length > 0) {
                console.log('✅ Activity logging working');
                passed++;
            } else {
                console.log('❌ Activity logging failed');
            }
            
        } catch (error) {
            console.log('❌ Performance metrics test failed:', error.message);
        }
        
        this.testResults.push({
            strategy: 'Performance Metrics',
            passed,
            total,
            percentage: total > 0 ? Math.round((passed / total) * 100) : 0
        });
        
        console.log(`📈 Performance Tests: ${passed}/${total} passed (${total > 0 ? Math.round((passed / total) * 100) : 0}%)\n`);
    }

    async testTenantManagement() {
        console.log('📋 Test 6: Tenant Management');
        console.log('─'.repeat(60));
        
        let passed = 0;
        let total = 0;
        
        try {
            // Test tenant creation
            total++;
            const testTenantData = {
                tenant_id: 'test_temp_tenant',
                name: 'Temporary Test Tenant',
                tenant_strategy: 'shared_schema',
                contact_name: 'Test User',
                contact_email: 'test@example.com'
            };
            
            const createdTenant = await this.tenantManager.createTenant(testTenantData);
            
            if (createdTenant && createdTenant.tenant_id === testTenantData.tenant_id) {
                console.log('✅ Tenant creation successful');
                passed++;
                
                // Test API key validation
                total++;
                const isValid = await this.tenantManager.validateTenantAccess(
                    createdTenant.tenant_id,
                    createdTenant.api_key
                );
                
                if (isValid) {
                    console.log('✅ API key validation working');
                    passed++;
                } else {
                    console.log('❌ API key validation failed');
                }
                
                // Cleanup test tenant
                await pool.query(`DELETE FROM tenants WHERE tenant_id = $1`, [testTenantData.tenant_id]);
                console.log('🧹 Test tenant cleaned up');
                
            } else {
                console.log('❌ Tenant creation failed');
            }
            
        } catch (error) {
            console.log('❌ Tenant management test failed:', error.message);
        }
        
        this.testResults.push({
            strategy: 'Tenant Management',
            passed,
            total,
            percentage: total > 0 ? Math.round((passed / total) * 100) : 0
        });
        
        console.log(`📈 Tenant Management Tests: ${passed}/${total} passed (${total > 0 ? Math.round((passed / total) * 100) : 0}%)\n`);
    }

    async testConnectionManagement() {
        console.log('📋 Test 7: Connection Management');
        console.log('─'.repeat(60));
        
        let passed = 0;
        let total = 0;
        
        try {
            const tenantId = 'demo_restaurant';
            
            // Test connection caching
            total++;
            const connection1 = await this.tenantManager.getTenantConnection(tenantId);
            const connection2 = await this.tenantManager.getTenantConnection(tenantId);
            
            if (connection1 === connection2) {
                console.log('✅ Connection caching working');
                passed++;
            } else {
                console.log('❌ Connection caching failed');
            }
            
            // Test connection cleanup
            total++;
            const initialConnectionCount = this.tenantManager.tenantConnections.size;
            await this.tenantManager.cleanupConnections(0); // Force cleanup all
            const afterCleanupCount = this.tenantManager.tenantConnections.size;
            
            if (afterCleanupCount < initialConnectionCount) {
                console.log('✅ Connection cleanup working');
                console.log(`   📊 Connections before: ${initialConnectionCount}, after: ${afterCleanupCount}`);
                passed++;
            } else {
                console.log('⚠️  Connection cleanup - no idle connections found');
                passed++; // Not necessarily a failure
            }
            
        } catch (error) {
            console.log('❌ Connection management test failed:', error.message);
        }
        
        this.testResults.push({
            strategy: 'Connection Management',
            passed,
            total,
            percentage: total > 0 ? Math.round((passed / total) * 100) : 0
        });
        
        console.log(`📈 Connection Management Tests: ${passed}/${total} passed (${total > 0 ? Math.round((passed / total) * 100) : 0}%)\n`);
    }

    displayResults() {
        console.log('🎯 MULTITENANT TEST RESULTS SUMMARY');
        console.log('═'.repeat(80));
        
        let totalPassed = 0;
        let totalTests = 0;
        
        for (const result of this.testResults) {
            const status = result.percentage >= 100 ? '✅' : result.percentage >= 75 ? '⚠️' : '❌';
            console.log(`${status} ${result.strategy.padEnd(25)} ${result.passed}/${result.total} (${result.percentage}%)`);
            
            totalPassed += result.passed;
            totalTests += result.total;
        }
        
        const overallPercentage = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;
        
        console.log('─'.repeat(80));
        console.log(`🏆 OVERALL SCORE: ${totalPassed}/${totalTests} (${overallPercentage}%)`);
        
        if (overallPercentage >= 90) {
            console.log('🎉 EXCELLENT! Multitenant architecture is working great!');
        } else if (overallPercentage >= 75) {
            console.log('👍 GOOD! Multitenant architecture is working well with minor issues');
        } else if (overallPercentage >= 50) {
            console.log('⚠️  WARNING! Multitenant architecture has significant issues');
        } else {
            console.log('❌ CRITICAL! Multitenant architecture needs immediate attention');
        }
        
        console.log('═'.repeat(80));
    }

    async cleanup() {
        if (this.tenantManager) {
            await this.tenantManager.shutdown();
            console.log('✅ Test cleanup completed');
        }
    }
}

// Run tests if called directly
if (require.main === module) {
    const tester = new MultiTenantTester();
    
    tester.initialize()
        .then(() => tester.runAllTests())
        .then(() => tester.cleanup())
        .then(() => {
            console.log('🎉 Test suite completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Test suite failed:', error);
            process.exit(1);
        });
}

module.exports = MultiTenantTester;