const { pool } = require('./config/database');

async function cleanupDuplicateConversions() {
  const client = await pool.connect();
  
  try {
    console.log('🧹 Cleaning up duplicate unit conversions...');
    
    await client.query('BEGIN');

    // First, let's see what duplicates exist
    const duplicatesResult = await client.query(`
      SELECT 
        business_id, 
        from_unit_id, 
        to_unit_id, 
        COUNT(*) as count,
        STRING_AGG(conversion_id::text, ', ') as conversion_ids
      FROM BusinessUnitConversions 
      GROUP BY business_id, from_unit_id, to_unit_id 
      HAVING COUNT(*) > 1
      ORDER BY business_id, from_unit_id, to_unit_id
    `);

    if (duplicatesResult.rows.length > 0) {
      console.log(`Found ${duplicatesResult.rows.length} sets of duplicate conversions:`);
      
      for (const duplicate of duplicatesResult.rows) {
        console.log(`  Business ${duplicate.business_id}: from_unit ${duplicate.from_unit_id} to_unit ${duplicate.to_unit_id} (${duplicate.count} duplicates)`);
        
        // Keep the most recent one and delete the others
        await client.query(`
          DELETE FROM BusinessUnitConversions 
          WHERE business_id = $1 
            AND from_unit_id = $2 
            AND to_unit_id = $3
            AND conversion_id NOT IN (
              SELECT conversion_id 
              FROM BusinessUnitConversions 
              WHERE business_id = $1 AND from_unit_id = $2 AND to_unit_id = $3
              ORDER BY created_at DESC 
              LIMIT 1
            )
        `, [duplicate.business_id, duplicate.from_unit_id, duplicate.to_unit_id]);
        
        console.log(`    ✅ Cleaned up duplicates for business ${duplicate.business_id}`);
      }
    } else {
      console.log('✅ No duplicate conversions found');
    }

    // Show final count
    const finalCountResult = await client.query('SELECT COUNT(*) as count FROM BusinessUnitConversions');
    console.log(`📊 Final count: ${finalCountResult.rows[0].count} unit conversions`);

    await client.query('COMMIT');
    console.log('✅ Cleanup completed successfully');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error during cleanup:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Run cleanup if this file is executed directly
if (require.main === module) {
  cleanupDuplicateConversions()
    .then(() => {
      console.log('🎉 Cleanup completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Cleanup failed:', error);
      process.exit(1);
    });
}

module.exports = { cleanupDuplicateConversions };