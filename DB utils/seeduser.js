const { pool, testConnection } = require('./config/database');
const bcrypt = require('bcrypt');

require('dotenv').config();

class SeedUser {
  constructor() {
    this.pool = pool;
  }

  async seedTestUser() {
    try {
      console.log('👤 Starting test user seeding...\n');

      // Test database connection first
      console.log('🔌 Testing database connection...');
      await testConnection();
      console.log('✅ Database connection successful\n');

      // Get the first business (or Spice Garden Restaurant if exists)
      console.log('🏢 Finding business for user...');
      const businessResult = await this.pool.query(`
        SELECT business_id, name FROM Businesses 
        WHERE name = 'Spice Garden Restaurant'
        UNION ALL
        SELECT business_id, name FROM Businesses 
        ORDER BY business_id 
        LIMIT 1
      `);

      if (businessResult.rows.length === 0) {
        throw new Error('No businesses found. Please run seeddata.js first to create test business.');
      }

      const business = businessResult.rows[0];
      console.log(`  ✅ Using business: ${business.name} (ID: ${business.business_id})`);

      // Set tenant context for RLS
      await this.pool.query('SELECT set_config($1, $2, true)', [
        'app.current_tenant', 
        business.business_id.toString()
      ]);

      // Get a role for the user (prefer Manager, then Owner, then any)
      console.log('🔑 Finding role for user...');
      const roleResult = await this.pool.query(`
        SELECT role_id, role_name FROM Roles 
        WHERE business_id = $1 
        ORDER BY CASE role_name 
          WHEN 'Manager' THEN 0 
          WHEN 'Owner' THEN 1 
          ELSE 2 
        END 
        LIMIT 1
      `, [business.business_id]);

      if (roleResult.rows.length === 0) {
        throw new Error('No roles found for business. Please run seeddata.js first to create roles.');
      }

      const role = roleResult.rows[0];
      console.log(`  ✅ Using role: ${role.role_name} (ID: ${role.role_id})`);

      // Hash the password
      console.log('🔒 Hashing password...');
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash('123456', saltRounds);
      console.log('  ✅ Password hashed successfully');

      // Insert or update the test user
      console.log('👤 Creating/updating test user...');
      const userResult = await this.pool.query(`
        INSERT INTO Users (
          business_id, email, password_hash, name, role_id, is_active
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (email) DO UPDATE SET
          name = EXCLUDED.name,
          password_hash = EXCLUDED.password_hash,
          role_id = EXCLUDED.role_id,
          is_active = EXCLUDED.is_active,
          updated_at = CURRENT_TIMESTAMP
        RETURNING user_id, email, name, is_active
      `, [
        business.business_id,
        'test@gmail.com',
        hashedPassword,
        'TestUser',
        role.role_id,
        true
      ]);

      const user = userResult.rows[0];
      console.log('  ✅ Test user created/updated successfully!');
      console.log(`     User ID: ${user.user_id}`);
      console.log(`     Email: ${user.email}`);
      console.log(`     Name: ${user.name}`);
      console.log(`     Active: ${user.is_active}`);
      console.log(`     Business: ${business.name}`);
      console.log(`     Role: ${role.role_name}`);

      console.log('\n🎉 Test user seeding completed successfully!');
      console.log('📧 Email: test@gmail.com');
      console.log('🔑 Password: 123456');
      console.log('🏢 Business: ' + business.name);
      console.log('👤 Role: ' + role.role_name);

    } catch (error) {
      console.error('\n❌ Test user seeding failed:', error.message);
      console.error('Stack trace:', error.stack);
      process.exit(1);
    } finally {
      // Pool is managed by the database config, so we don't close it here
      console.log('🔄 User seeding process completed. Database connection remains active.');
    }
  }
}

// Export the class for use in other files
module.exports = SeedUser;

// Run user seeding if this file is executed directly
if (require.main === module) {
  const seeder = new SeedUser();
  seeder.seedTestUser()
    .then(() => {
      console.log('✅ User seeding process completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ User seeding process failed:', error);
      process.exit(1);
    });
}
