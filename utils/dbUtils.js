const { pool } = require('../config/database');

/**
 * Execute a database query with proper error handling
 * @param {string} query - SQL query
 * @param {Array} params - Query parameters
 * @param {string} operation - Description of the operation for error logging
 * @returns {Promise<Object>} Query result
 */
const executeQuery = async (query, params = [], operation = 'query') => {
  let client;
  
  try {
    client = await pool.connect();
    const result = await client.query(query, params);
    return result;
  } catch (error) {
    console.error(`Database error during ${operation}:`, error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Execute multiple queries in a transaction
 * @param {Array} queries - Array of {query, params, description} objects
 * @param {string} operation - Description of the transaction
 * @returns {Promise<Array>} Array of query results
 */
const executeTransaction = async (queries, operation = 'transaction') => {
  let client;
  
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    
    const results = [];
    
    for (const { query, params = [], description = 'query' } of queries) {
      try {
        const result = await client.query(query, params);
        results.push(result);
      } catch (error) {
        console.error(`Error in ${description} during ${operation}:`, error);
        throw error;
      }
    }
    
    await client.query('COMMIT');
    return results;
    
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error during rollback:', rollbackError);
      }
    }
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Check if a table exists
 * @param {string} tableName - Name of the table to check
 * @returns {Promise<boolean>} True if table exists
 */
const tableExists = async (tableName) => {
  try {
    const query = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = $1
      )
    `;
    const result = await executeQuery(query, [tableName], `check table ${tableName}`);
    return result.rows[0].exists;
  } catch (error) {
    console.error(`Error checking if table ${tableName} exists:`, error);
    return false;
  }
};

/**
 * Validate database connection
 * @returns {Promise<boolean>} True if connection is valid
 */
const validateConnection = async () => {
  try {
    await executeQuery('SELECT 1', [], 'connection validation');
    return true;
  } catch (error) {
    console.error('Database connection validation failed:', error);
    return false;
  }
};

/**
 * Get database statistics
 * @returns {Promise<Object>} Database statistics
 */
const getDatabaseStats = async () => {
  try {
    const queries = [
      {
        query: 'SELECT COUNT(*) as table_count FROM information_schema.tables WHERE table_schema = \'public\'',
        key: 'tables'
      },
      {
        query: 'SELECT COUNT(*) as count FROM InventoryItems WHERE is_active = true',
        key: 'active_items'
      },
      {
        query: 'SELECT COUNT(*) as count FROM StockInRecords',
        key: 'stock_records'
      },
      {
        query: 'SELECT COUNT(*) as count FROM InventoryBatches WHERE is_active = true',
        key: 'active_batches'
      }
    ];

    const stats = {};
    
    for (const { query, key } of queries) {
      try {
        const result = await executeQuery(query, [], `get ${key} stats`);
        stats[key] = parseInt(result.rows[0].count || result.rows[0].table_count || 0);
      } catch (error) {
        console.error(`Error getting ${key} stats:`, error);
        stats[key] = 0;
      }
    }

    return stats;
  } catch (error) {
    console.error('Error getting database stats:', error);
    return {
      tables: 0,
      active_items: 0,
      stock_records: 0,
      active_batches: 0
    };
  }
};

module.exports = {
  executeQuery,
  executeTransaction,
  tableExists,
  validateConnection,
  getDatabaseStats
};