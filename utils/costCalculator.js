const { pool } = require('../config/database');

/**
 * Calculate raw material cost for a menu item based on its recipe ingredients
 * Formula: Sum of (ingredient_quantity * latest_unit_cost) for all recipe ingredients
 * @param {number} menuItemId - The menu item ID (which equals recipe_id)
 * @param {Object} client - Database client (optional, uses pool if not provided)
 * @returns {Promise<{rawMaterialCost: number, ingredientsUsed: Array}>}
 */
async function calculateRawMaterialCost(menuItemId, client = null) {
  const db = client || pool;
  
  try {
    // Get all ingredients for this recipe with their quantities and latest costs
    const query = `
      SELECT 
        ri.quantity AS recipe_quantity,
        ri.unit_id AS recipe_unit_id,
        gu.unit_symbol AS recipe_unit,
        ii.name AS item_name,
        ii.item_id,
        COALESCE(
          (SELECT AVG(sub.unit_cost)
             FROM (
               SELECT ib.unit_cost
               FROM InventoryBatches ib
               WHERE ib.item_id = ii.item_id AND ib.quantity > 0
               ORDER BY ib.batch_id DESC
               LIMIT 5
             ) sub),
          0
        ) AS latest_unit_cost,
        gu2.unit_symbol AS inventory_unit
      FROM RecipeIngredients ri
      JOIN InventoryItems ii ON ri.item_id = ii.item_id
      JOIN GlobalUnits gu ON ri.unit_id = gu.unit_id
      LEFT JOIN GlobalUnits gu2 ON ii.standard_unit_id = gu2.unit_id
      WHERE ri.recipe_id = $1
        AND ii.is_active = TRUE
      ORDER BY ii.name;
    `;
    
    const result = await db.query(query, [menuItemId]);
    
    if (result.rows.length === 0) {
      console.log(`⚠️ No recipe ingredients found for menu item ID: ${menuItemId}`);
      return {
        rawMaterialCost: 0,
        ingredientsUsed: [],
        hasRecipe: false
      };
    }
    
    let totalCost = 0;
    const ingredientsUsed = [];
    
    for (const ingredient of result.rows) {
      const {
        recipe_quantity,
        recipe_unit,
        item_name,
        item_id,
        latest_unit_cost,
        inventory_unit
      } = ingredient;
      
      // For now, assume units are compatible (future enhancement: add unit conversion)
      // Calculate cost for this ingredient: quantity * unit_cost
      const qtyVal = Number(recipe_quantity) || 0;
      const unitCostVal = Number(latest_unit_cost) || 0;
      if (unitCostVal === 0) {
        console.warn(`⚠️ No recent batch cost for item_id=${item_id} (${item_name}); treating cost as 0.`);
      }
      const ingredientCost = qtyVal * unitCostVal;
      
      totalCost += ingredientCost;
      
      ingredientsUsed.push({
        item_id,
        item_name,
  recipe_quantity: qtyVal,
        recipe_unit,
        inventory_unit,
  latest_unit_cost: unitCostVal,
        ingredient_cost: ingredientCost
      });
      
  console.log(`💰 ${item_name}: ${qtyVal}${recipe_unit} × ₹${unitCostVal} = ₹${ingredientCost.toFixed(2)}`);
    }
    
    console.log(`🧮 Total raw material cost for menu item ${menuItemId}: ₹${totalCost.toFixed(2)}`);
    
    return {
      rawMaterialCost: totalCost,
      ingredientsUsed,
      hasRecipe: true
    };
    
  } catch (error) {
    console.error('❌ Error calculating raw material cost:', error);
    throw new Error(`Failed to calculate raw material cost for menu item ${menuItemId}: ${error.message}`);
  }
}

/**
 * Calculate gross profit for a menu item
 * Formula: Gross Profit = Menu Price - Raw Material Cost
 * @param {number} menuItemId - The menu item ID
 * @param {number} menuPrice - The menu item price (optional, will fetch if not provided)
 * @param {Object} client - Database client (optional)
 * @returns {Promise<{grossProfit: number, grossProfitPercentage: number, menuPrice: number, rawMaterialCost: number}>}
 */
async function calculateGrossProfit(menuItemId, menuPrice = null, client = null) {
  const db = client || pool;
  
  try {
    // Get menu price if not provided
    let actualMenuPrice = menuPrice;
    if (!actualMenuPrice) {
      const priceQuery = `
        SELECT CAST(price AS DECIMAL(10,2)) as price, name
        FROM MenuItems 
        WHERE menu_item_id = $1 AND is_active = true
      `;
      const priceResult = await db.query(priceQuery, [menuItemId]);
      
      if (priceResult.rows.length === 0) {
        throw new Error(`Menu item with ID ${menuItemId} not found or inactive`);
      }
      
      actualMenuPrice = parseFloat(priceResult.rows[0].price);
      console.log(`📋 Found menu item: ${priceResult.rows[0].name} - Price: ₹${actualMenuPrice}`);
    }
    
    // Calculate raw material cost
    const { rawMaterialCost, ingredientsUsed, hasRecipe } = await calculateRawMaterialCost(menuItemId, db);
    
    // Calculate gross profit
    const grossProfit = actualMenuPrice - rawMaterialCost;
    const grossProfitPercentage = actualMenuPrice > 0 ? (grossProfit / actualMenuPrice) * 100 : 0;
    
    console.log(`📊 Gross Profit Analysis for Menu Item ${menuItemId}:`);
    console.log(`   Menu Price: ₹${actualMenuPrice.toFixed(2)}`);
    console.log(`   Raw Material Cost: ₹${rawMaterialCost.toFixed(2)}`);
    console.log(`   Gross Profit: ₹${grossProfit.toFixed(2)} (${grossProfitPercentage.toFixed(1)}%)`);
    
    return {
      grossProfit,
      grossProfitPercentage,
      menuPrice: actualMenuPrice,
      rawMaterialCost,
      ingredientsUsed,
      hasRecipe
    };
    
  } catch (error) {
    console.error('❌ Error calculating gross profit:', error);
    throw error;
  }
}

/**
 * Calculate gross profit for multiple menu items in bulk
 * @param {Array<number>} menuItemIds - Array of menu item IDs
 * @param {Object} client - Database client (optional)
 * @returns {Promise<Array>} Array of gross profit calculations
 */
async function calculateBulkGrossProfit(menuItemIds, client = null) {
  const db = client || pool;
  
  if (!Array.isArray(menuItemIds) || menuItemIds.length === 0) {
    return [];
  }
  
  try {
    console.log(`🔄 Calculating bulk gross profit for ${menuItemIds.length} menu items...`);
    
    const results = [];
    
    // Process in batches to avoid overwhelming the database
    const batchSize = 10;
    for (let i = 0; i < menuItemIds.length; i += batchSize) {
      const batch = menuItemIds.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (menuItemId) => {
        try {
          const result = await calculateGrossProfit(menuItemId, null, db);
          return { menuItemId, success: true, ...result };
        } catch (error) {
          console.error(`❌ Failed to calculate gross profit for menu item ${menuItemId}:`, error.message);
          return { 
            menuItemId, 
            success: false, 
            error: error.message,
            grossProfit: 0,
            grossProfitPercentage: 0,
            rawMaterialCost: 0
          };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }
    
    const successful = results.filter(r => r.success).length;
    console.log(`✅ Successfully calculated gross profit for ${successful}/${menuItemIds.length} menu items`);
    
    return results;
    
  } catch (error) {
    console.error('❌ Error in bulk gross profit calculation:', error);
    throw error;
  }
}

module.exports = {
  calculateRawMaterialCost,
  calculateGrossProfit,
  calculateBulkGrossProfit
};