const { pool } = require('./config/database');

async function seedUnits() {
  const client = await pool.connect();
  try {
    console.log('🌱 Seeding global units (carton, bowl, packet)...');
    await client.query('BEGIN');

    const units = [
      { name: 'Carton', symbol: 'carton', type: 'Count' },
      { name: 'Bowl', symbol: 'bowl', type: 'Count' },
      { name: 'Packet', symbol: 'packet', type: 'Count' }
    ];

    for (const u of units) {
      await client.query(`
        INSERT INTO GlobalUnits (unit_name, unit_symbol, unit_type, is_active, is_system_defined)
        VALUES ($1, $2, $3, true, true)
        ON CONFLICT (unit_name) DO NOTHING
      `, [u.name, u.symbol, u.type]);
    }

    await client.query('COMMIT');
    console.log('✅ seedunits.js: Units seeded (or already present)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error seeding units:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seedUnits()
    .then(() => {
      console.log('🎉 seedUnits completed');
      process.exit(0);
    })
    .catch((err) => {
      console.error('💥 seedUnits failed:', err);
      process.exit(1);
    });
}

module.exports = { seedUnits };
