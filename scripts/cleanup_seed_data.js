/**
 * Cleanup script to remove seeded test/demo ABC data from the database.
 * Targets items, menu items, recipes, categories, stock-outs, and test sales created by abcTest routes.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { pool } = require('../config/database');

async function tableExists(client, table) {
  const r = await client.query(`SELECT to_regclass($1) AS reg`, [table]);
  return !!r.rows[0].reg;
}

async function run() {
  const client = await pool.connect();
  try {
    console.log('Starting cleanup of seeded ABC test data...');
    await client.query('BEGIN');

    // Delete SaleLineItems and SalesTransactions tied to seeded menu items
    const seededMenuNames = ['ABC Test Dish', 'ABC Dynamic Dish'];
    const saleIdsRes = await client.query(
      `SELECT DISTINCT st.sale_id
       FROM SalesTransactions st
       JOIN SaleLineItems sli ON sli.sale_id = st.sale_id
       JOIN MenuItems mi ON mi.menu_item_id = sli.menu_item_id
       WHERE mi.name = ANY($1::text[])`,
      [seededMenuNames]
    );
    const saleIds = saleIdsRes.rows.map(r => r.sale_id);
    if (saleIds.length) {
      await client.query(`DELETE FROM SaleLineItems WHERE sale_id = ANY($1::int[])`, [saleIds]);
      await client.query(`DELETE FROM SalesTransactions WHERE sale_id = ANY($1::int[])`, [saleIds]);
      console.log(`Deleted ${saleIds.length} SalesTransactions and related SaleLineItems.`);
    }

    // Collect MenuItems that were created by seeds
    const menuNames = ['ABC Test Dish', 'ABC Dynamic Dish'];
    const menuRes = await client.query(
      `SELECT menu_item_id FROM MenuItems WHERE name = ANY($1::text[])`,
      [menuNames]
    );
    const menuItemIds = menuRes.rows.map(r => r.menu_item_id);

    // Delete RecipeIngredients and Recipes linked to those menu items
    if (menuItemIds.length) {
      await client.query(`DELETE FROM RecipeIngredients WHERE recipe_id = ANY($1::int[])`, [menuItemIds]);
      const recDel = await client.query(`DELETE FROM Recipes WHERE recipe_id = ANY($1::int[])`, [menuItemIds]);
      const miDel = await client.query(`DELETE FROM MenuItems WHERE menu_item_id = ANY($1::int[])`, [menuItemIds]);
      console.log(`Deleted ${recDel.rowCount} Recipes and ${miDel.rowCount} MenuItems.`);
    }

    // Delete StockOutRecords made for seeded "Dyn" items or ABC Test items (by names via join)
    const itemNamePatterns = [
      'ABC Test %',
      'Dyn %',
      'ABC Dynamic %'
    ];
    const soDel = await client.query(
      `DELETE FROM StockOutRecords sor
       USING InventoryItems ii
       WHERE sor.item_id = ii.item_id
         AND (
           ${itemNamePatterns.map((_, i) => `ii.name ILIKE $${i+1}`).join(' OR ')}
         )`,
      itemNamePatterns
    );
    console.log(`Deleted ${soDel.rowCount} StockOutRecords for seeded items.`);

    // Collect seeded InventoryItem ids
    const itemIdsRes = await client.query(
      `SELECT item_id FROM InventoryItems WHERE ${itemNamePatterns.map((_, i) => `name ILIKE $${i+1}`).join(' OR ')}`,
      itemNamePatterns
    );
    const itemIds = itemIdsRes.rows.map(r => r.item_id);

    if (itemIds.length) {
      // Delete dependent rows in known tables if they exist
      if (await tableExists(client, 'ABCAnalysisResults')) {
        const r = await client.query(`DELETE FROM ABCAnalysisResults WHERE item_id = ANY($1::int[])`, [itemIds]);
        console.log(`Deleted ${r.rowCount} ABCAnalysisResults.`);
      }
      if (await tableExists(client, 'ReorderPointCalculations')) {
        const r = await client.query(`DELETE FROM ReorderPointCalculations WHERE item_id = ANY($1::int[])`, [itemIds]);
        console.log(`Deleted ${r.rowCount} ReorderPointCalculations.`);
      }
      if (await tableExists(client, 'InventoryBatches')) {
        const r = await client.query(`DELETE FROM InventoryBatches WHERE item_id = ANY($1::int[])`, [itemIds]);
        console.log(`Deleted ${r.rowCount} InventoryBatches.`);
      }
      // StockInLineItems references item_id; remove any line items for seeded items
      if (await tableExists(client, 'StockInLineItems')) {
        const r = await client.query(`DELETE FROM StockInLineItems WHERE item_id = ANY($1::int[])`, [itemIds]);
        console.log(`Deleted ${r.rowCount} StockInLineItems.`);
      }
      if (await tableExists(client, 'StockOutRecords')) {
        const r = await client.query(`DELETE FROM StockOutRecords WHERE item_id = ANY($1::int[])`, [itemIds]);
        if (r.rowCount) console.log(`Deleted additional ${r.rowCount} StockOutRecords by item_id.`);
      }
      if (await tableExists(client, 'WastageRecords')) {
        const r = await client.query(`DELETE FROM WastageRecords WHERE item_id = ANY($1::int[])`, [itemIds]);
        console.log(`Deleted ${r.rowCount} WastageRecords.`);
      }
    }

    // Finally delete the InventoryItems themselves
    const delItems = await client.query(
      `DELETE FROM InventoryItems WHERE ${itemNamePatterns.map((_, i) => `name ILIKE $${i+1}`).join(' OR ')}`,
      itemNamePatterns
    );
    console.log(`Deleted ${delItems.rowCount} InventoryItems.`);

    // Attempt to remove the test categories if now unused
    const invCatNames = ['ABC Test Ingredients', 'ABC Dynamic Ingredients'];
    const menuCatNames = ['ABC Test', 'ABC Dynamic'];

    // Inventory categories
    const invCatDel = await client.query(
      `DELETE FROM InventoryCategories ic
       WHERE ic.name = ANY($1::text[])
         AND NOT EXISTS (
           SELECT 1 FROM InventoryItems ii WHERE ii.category_id = ic.category_id
         )`,
      [invCatNames]
    );
    console.log(`Deleted ${invCatDel.rowCount} InventoryCategories.`);

    // Menu categories
    const menuCatDel = await client.query(
      `DELETE FROM MenuCategories mc
       WHERE mc.name = ANY($1::text[])
         AND NOT EXISTS (
           SELECT 1 FROM MenuItems mi WHERE mi.category_id = mc.category_id
         )`,
      [menuCatNames]
    );
    console.log(`Deleted ${menuCatDel.rowCount} MenuCategories.`);

    await client.query('COMMIT');
    console.log('Cleanup complete.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Cleanup failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
