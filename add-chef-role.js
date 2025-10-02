const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.RUNTIME_DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function addChefRole() {
  try {
    console.log('👨‍🍳 Adding Chef role to the database...');
    
    // Get all businesses to add chef role to each
    const businessesResult = await pool.query('SELECT business_id, name FROM Businesses ORDER BY business_id');
    
    for (const business of businessesResult.rows) {
      // Add Chef role
      const chefRoleResult = await pool.query(`
        INSERT INTO Roles (business_id, role_name, description, is_system_default, is_active)
        VALUES ($1, 'Chef', 'Kitchen chef responsible for order preparation and cooking', true, true)
        ON CONFLICT (business_id, role_name) 
        DO UPDATE SET description = EXCLUDED.description
        RETURNING role_id
      `, [business.business_id]);
      
      console.log(`✅ Chef role added/updated for business: ${business.name} (ID: ${business.business_id})`);
      console.log(`   Chef Role ID: ${chefRoleResult.rows[0].role_id}`);
    }

    console.log('\n📋 Current roles in the database:');
    const rolesResult = await pool.query(`
      SELECT b.name as business_name, r.role_name, r.description, r.role_id, r.business_id
      FROM Roles r
      JOIN Businesses b ON r.business_id = b.business_id
      WHERE r.is_active = true
      ORDER BY b.business_id, r.role_name
    `);
    
    rolesResult.rows.forEach(role => {
      console.log(`   ${role.business_name}: ${role.role_name} (ID: ${role.role_id})`);
    });

  } catch (error) {
    console.error('❌ Error adding chef role:', error.message);
  } finally {
    await pool.end();
  }
}

addChefRole();