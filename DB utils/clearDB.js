const { pool, testConnection } = require('./config/database');
require('dotenv').config();

class DatabaseCleaner {
    constructor() {
        this.pool = pool;
    }

    async connectToDatabase() {
        console.log('🔗 Testing database connection...');
        try {
            await testConnection();
            const client = await this.pool.connect();
            const result = await client.query('SELECT current_database()');
            console.log(`✅ Connected to database: ${result.rows[0].current_database}`);
            client.release();
            return true;
        } catch (error) {
            console.log(`ℹ️ Database connection failed: ${error.message}`);
            return false;
        }
    }

    async dropViews() {
        console.log('🗑️ Dropping views...');
        const viewQueries = [
            'DROP VIEW IF EXISTS StockInSummary CASCADE'
        ];

        for (const query of viewQueries) {
            try {
                await this.pool.query(query);
            } catch (error) {
                console.error('Error dropping view:', error.message);
            }
        }
        console.log('✅ Views dropped successfully');
    }

    async dropTables() {
        console.log('🗑️ Dropping tables...');

        // Drop tables in reverse order of creation to handle foreign key constraints
        const dropQueries = [
            'DROP TABLE IF EXISTS OCRProcessingLogs CASCADE',
            'DROP TABLE IF EXISTS ScannedImages CASCADE',
            'DROP TABLE IF EXISTS StockOutRecords CASCADE',
            'DROP TABLE IF EXISTS InventoryBatches CASCADE',
            'DROP TABLE IF EXISTS StockInLineItems CASCADE',
            'DROP TABLE IF EXISTS StockInRecords CASCADE',
            'DROP TABLE IF EXISTS InventoryItems CASCADE',
            'DROP TABLE IF EXISTS WastageReasons CASCADE',
            'DROP TABLE IF EXISTS InventoryCategories CASCADE',
            'DROP TABLE IF EXISTS BusinessUnitConversions CASCADE',
            'DROP TABLE IF EXISTS GlobalUnits CASCADE'
        ];

        for (const query of dropQueries) {
            try {
                await this.pool.query(query);
            } catch (error) {
                console.error('Error dropping table:', error.message);
            }
        }
        console.log('✅ All tables dropped successfully');
    }

    async dropIndexes() {
        console.log('🗑️ Dropping indexes...');

        // Get all custom indexes and drop them
        const getIndexesQuery = `
            SELECT indexname 
            FROM pg_indexes 
            WHERE schemaname = 'public' 
            AND indexname NOT LIKE '%_pkey'
            AND indexname NOT LIKE '%_key'
        `;

        try {
            const result = await this.pool.query(getIndexesQuery);
            for (const row of result.rows) {
                try {
                    await this.pool.query(`DROP INDEX IF EXISTS ${row.indexname}`);
                } catch (error) {
                    console.error(`Error dropping index ${row.indexname}:`, error.message);
                }
            }
            console.log('✅ Custom indexes dropped successfully');
        } catch (error) {
            console.error('Error getting indexes:', error.message);
        }
    }

    async dropDatabase() {
        console.log('💥 Performing complete database cleanup (equivalent to dropping)...');
        console.log('ℹ️  Note: For managed databases like Neon, we cannot drop the database itself,');
        console.log('ℹ️  but we will remove ALL content including schemas, extensions, and functions.');

        try {
            const connected = await this.connectToDatabase();
            
            if (!connected) {
                console.log('ℹ️ Database connection failed, nothing to clear');
                return;
            }

            // Drop all schemas except information_schema and pg_* schemas
            console.log('🗑️ Dropping all user schemas...');
            const schemasQuery = `
                SELECT schema_name 
                FROM information_schema.schemata 
                WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast', 'pg_temp_1', 'pg_toast_temp_1')
                AND schema_name NOT LIKE 'pg_%'
            `;
            
            const schemasResult = await this.pool.query(schemasQuery);
            for (const row of schemasResult.rows) {
                try {
                    await this.pool.query(`DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`);
                    console.log(`✅ Schema "${row.schema_name}" dropped`);
                } catch (error) {
                    console.error(`Error dropping schema ${row.schema_name}:`, error.message);
                }
            }

            // Recreate the public schema
            console.log('🔄 Recreating public schema...');
            await this.pool.query('CREATE SCHEMA IF NOT EXISTS public');
            await this.pool.query('GRANT ALL ON SCHEMA public TO public');
            await this.pool.query('GRANT ALL ON SCHEMA public TO postgres');

            // Drop all extensions (except system ones)
            console.log('🗑️ Dropping extensions...');
            const extensionsQuery = `
                SELECT extname 
                FROM pg_extension 
                WHERE extname NOT IN ('plpgsql')
            `;
            
            try {
                const extensionsResult = await this.pool.query(extensionsQuery);
                for (const row of extensionsResult.rows) {
                    try {
                        await this.pool.query(`DROP EXTENSION IF EXISTS "${row.extname}" CASCADE`);
                        console.log(`✅ Extension "${row.extname}" dropped`);
                    } catch (error) {
                        console.error(`Error dropping extension ${row.extname}:`, error.message);
                    }
                }
            } catch (error) {
                console.error('Error getting extensions:', error.message);
            }

            // Drop all custom functions
            console.log('🗑️ Dropping custom functions...');
            const functionsQuery = `
                SELECT routine_name, routine_schema
                FROM information_schema.routines 
                WHERE routine_schema = 'public'
                AND routine_type = 'FUNCTION'
            `;
            
            try {
                const functionsResult = await this.pool.query(functionsQuery);
                for (const row of functionsResult.rows) {
                    try {
                        await this.pool.query(`DROP FUNCTION IF EXISTS "${row.routine_schema}"."${row.routine_name}" CASCADE`);
                        console.log(`✅ Function "${row.routine_name}" dropped`);
                    } catch (error) {
                        console.error(`Error dropping function ${row.routine_name}:`, error.message);
                    }
                }
            } catch (error) {
                console.error('Error getting functions:', error.message);
            }

            console.log('✅ Complete database cleanup finished');
            console.log('📊 Database is now completely empty and reset to initial state');

        } catch (error) {
            console.error('Error performing complete database cleanup:', error.message);
            throw error;
        }
    }

    async verifyCleanup() {
        console.log('🔍 Verifying cleanup...');

        try {
            // Check if any tables remain
            const checkTablesQuery = `
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_type = 'BASE TABLE'
            `;
            const result = await this.pool.query(checkTablesQuery);

            if (result.rows.length === 0) {
                console.log('✅ All tables successfully removed');
            } else {
                console.log(`⚠️ ${result.rows.length} tables still exist:`, result.rows.map(r => r.table_name));
            }
        } catch (error) {
            console.error('Error verifying cleanup:', error.message);
        }
    }

    // Connection is managed by the database config module

    async clearDatabase() {
        try {
            console.log('🧹 Starting database cleanup...\n');

            const connected = await this.connectToDatabase();

            if (connected) {
                await this.dropViews();
                await this.dropIndexes();
                await this.dropTables();
            }

            await this.verifyCleanup();

            console.log('\n🎉 Database cleanup completed successfully!');
            console.log('📊 All tables, views, and indexes have been removed from the database.');

        } catch (error) {
            console.error('\n❌ Database cleanup failed:', error.message);
            console.error('Stack trace:', error.stack);
            process.exit(1);
        } finally {
            console.log('🔄 Database cleanup process completed. Connection remains active.');
        }
    }

    // Method to clear only data but keep structure
    async clearDataOnly() {
        // Backward-compatible alias; use truncateAllData for robust cleanup
        return this.truncateAllData();
    }

    // Preferred method: wipe ALL data in all user tables, keep structure, reset identities
    async truncateAllData() {
        try {
            console.log('🧹 Starting FULL data wipe (keeping structure)...\n');

            const connected = await this.connectToDatabase();
            if (!connected) {
                console.log('ℹ️ Database connection failed, nothing to clear');
                return;
            }

            // Collect all non-system tables across non-system schemas
            const tablesResult = await this.pool.query(`
                SELECT '"' || table_schema || '"."' || table_name || '"' AS fqtn
                FROM information_schema.tables
                WHERE table_type = 'BASE TABLE'
                  AND table_schema NOT IN ('pg_catalog', 'information_schema')
                  AND table_schema NOT LIKE 'pg_%'
            `);

            if (tablesResult.rows.length === 0) {
                console.log('ℹ️ No user tables found. Nothing to truncate.');
                return;
            }

            const tableList = tablesResult.rows.map(r => r.fqtn).join(', ');
            const truncateSql = `TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`;
            console.log('🗑️ Truncating all tables (CASCADE) and resetting identities...');
            await this.pool.query(truncateSql);

            console.log('\n🎉 Full data wipe completed successfully!');
            console.log('📊 All rows removed; table structures and sequences reset.');
        } catch (error) {
            console.error('\n❌ Full data wipe failed:', error.message);
            console.error('Stack trace:', error.stack);
            process.exit(1);
        } finally {
            console.log('🔄 Data wipe process completed. Connection remains active.');
        }
    }
}

// Export the class for use in other files
module.exports = DatabaseCleaner;

// Run cleanup if this file is executed directly
if (require.main === module) {
    const dbCleaner = new DatabaseCleaner();

    // Parse command line arguments
    const args = process.argv.slice(2);
    const dropDatabase = args.includes('-d') || args.includes('--drop-database');
    const dataOnly = args.includes('--data-only') || args.includes('--clear-data');

    if (dropDatabase) {
        console.log('⚠️  WARNING: This will completely drop the entire database!');
        console.log('⚠️  All data and structure will be permanently lost!');

        dbCleaner.dropDatabase()
            .then(() => {
                console.log('✅ Database drop process completed successfully');
                process.exit(0);
            })
            .catch((error) => {
                console.error('❌ Database drop process failed:', error);
                process.exit(1);
            });
    } else if (dataOnly) {
        dbCleaner.truncateAllData()
            .then(() => {
                console.log('✅ Data cleanup process completed successfully');
                process.exit(0);
            })
            .catch((error) => {
                console.error('❌ Data cleanup process failed:', error);
                process.exit(1);
            });
    } else {
        dbCleaner.clearDatabase()
            .then(() => {
                console.log('✅ Database cleanup process completed successfully');
                process.exit(0);
            })
            .catch((error) => {
                console.error('❌ Database cleanup process failed:', error);
                process.exit(1);
            });
    }
}
