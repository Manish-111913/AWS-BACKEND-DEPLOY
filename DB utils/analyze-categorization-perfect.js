const { pool } = require('./config/database.js');

async function analyzeCategorizationPerfectly() {
  try {
    console.log('🔍 PERFECT CATEGORIZATION ANALYSIS\n');
    
    // 1. Check all vendors and their categories
    console.log('1️⃣ VENDOR ANALYSIS:');
    const vendors = await pool.query(`
      SELECT vendor_id, name, vendor_category, is_active
      FROM Vendors 
      WHERE business_id = 1 
      ORDER BY vendor_category, name.
    `);
    
    console.log('   Available vendors by category:');
    const vendorsByCategory = {};
    vendors.rows.forEach(vendor => {
      if (!vendorsByCategory[vendor.vendor_category]) {
        vendorsByCategory[vendor.vendor_category] = [];
      }
      vendorsByCategory[vendor.vendor_category].push(vendor);
      console.log(`     ${vendor.vendor_category}: ${vendor.name} (${vendor.is_active ? 'Active' : 'Inactive'})`);
    });
    
    // 2. Check low stock items and their categories
    console.log('\n2️⃣ LOW STOCK ITEMS ANALYSIS:');
    const lowStockQuery = `
      SELECT 
        ii.item_id,
        ii.name,
        ii.reorder_point,
        COALESCE(SUM(ib.quantity), 0) as current_stock,
        ic.name as inventory_category
      FROM InventoryItems ii
      LEFT JOIN InventoryBatches ib ON ii.item_id = ib.item_id AND ib.is_expired = false
      LEFT JOIN InventoryCategories ic ON ii.category_id = ic.category_id
      WHERE ii.business_id = 1 
        AND ii.is_active = true
        AND (ic.name IS NULL OR ic.name <> 'Complimentary Items')
      GROUP BY ii.item_id, ii.name, ii.reorder_point, ic.name
      HAVING COALESCE(SUM(ib.quantity), 0) <= COALESCE(ii.reorder_point, 0)
      ORDER BY ii.name
    `;
    
    const lowStockItems = await pool.query(lowStockQuery, [1]);
    console.log(`   Found ${lowStockItems.rows.length} low stock items:`);
    
    // 3. Apply smart categorization and show results
    console.log('\n3️⃣ SMART CATEGORIZATION RESULTS:');
    
    function getSmartCategory(itemName, inventoryCategory) {
      const categoryMapping = {
        'Auto Ingredients': 'wholesale',
        'Spices & Seasonings': 'wholesale', 
        'Grains & Cereals': 'wholesale',
        'Vegetables': 'vegetables',
        'vegetables': 'vegetables',
        'Dairy Products': 'dairy',
        'dairy': 'dairy',
        'Meat & Seafood': 'meat',
        'Seafood': 'seafood'
      };

      if (inventoryCategory && categoryMapping[inventoryCategory]) {
        return categoryMapping[inventoryCategory];
      }
      
      const name = itemName.toLowerCase();
      
      if (name.includes('tomato') || name.includes('onion') || name.includes('potato') || 
          name.includes('carrot') || name.includes('cabbage') || name.includes('capsicum') ||
          name.includes('spinach') || name.includes('lettuce') || name.includes('broccoli') ||
          name.includes('cauliflower') || name.includes('peas') || name.includes('beans') ||
          name.includes('cucumber') || name.includes('radish') || name.includes('beetroot') ||
          name.includes('vegetables') || name.includes('veggie')) {
        return 'vegetables';
      }
      
      if (name.includes('milk') || name.includes('cheese') || name.includes('butter') || 
          name.includes('cream') || name.includes('yogurt') || name.includes('paneer') ||
          name.includes('curd') || name.includes('ghee')) {
        return 'dairy';
      }
      
      if (name.includes('chicken') || name.includes('mutton') || name.includes('beef') || 
          name.includes('pork') || name.includes('fish') || name.includes('prawn') ||
          name.includes('crab') || name.includes('lobster') || name.includes('meat') ||
          name.includes('seafood')) {
        return name.includes('fish') || name.includes('prawn') || name.includes('crab') || 
               name.includes('lobster') ? 'seafood' : 'meat';
      }
      
      if (name.includes('apple') || name.includes('banana') || name.includes('orange') || 
          name.includes('mango') || name.includes('grape') || name.includes('lemon') ||
          name.includes('lime') || name.includes('fruit')) {
        return 'fruits';
      }
      
      return 'wholesale';
    }
    
    const categorization = {};
    lowStockItems.rows.forEach(item => {
      const category = getSmartCategory(item.name, item.inventory_category);
      if (!categorization[category]) {
        categorization[category] = [];
      }
      categorization[category].push({
        name: item.name,
        inventory_category: item.inventory_category,
        current_stock: item.current_stock,
        reorder_point: item.reorder_point
      });
    });
    
    // Show categorization results
    Object.keys(categorization).forEach(category => {
      const items = categorization[category];
      const hasVendor = vendorsByCategory[category] && vendorsByCategory[category].length > 0;
      const vendorName = hasVendor ? vendorsByCategory[category][0].name : 'NO VENDOR FOUND';
      
      console.log(`\n   📦 ${category.toUpperCase()} (${items.length} items) → ${vendorName}`);
      console.log(`       Vendor Available: ${hasVendor ? '✅' : '❌'}`);
      
      // Show sample items
      items.slice(0, 5).forEach(item => {
        console.log(`         - ${item.name} (${item.inventory_category || 'No Category'}) [Stock: ${item.current_stock}/${item.reorder_point}]`);
      });
      
      if (items.length > 5) {
        console.log(`         ... and ${items.length - 5} more items`);
      }
    });
    
    // 4. Show any missing vendor categories
    console.log('\n4️⃣ MISSING VENDOR CATEGORIES:');
    const availableVendorCategories = Object.keys(vendorsByCategory);
    const neededCategories = Object.keys(categorization);
    const missingCategories = neededCategories.filter(cat => !availableVendorCategories.includes(cat));
    
    if (missingCategories.length > 0) {
      console.log('   ❌ Missing vendors for categories:');
      missingCategories.forEach(cat => {
        console.log(`       - ${cat} (${categorization[cat].length} items need this vendor)`);
      });
    } else {
      console.log('   ✅ All needed vendor categories are available');
    }
    
    console.log('\n🎯 RECOMMENDATION:');
    if (missingCategories.length > 0) {
      console.log('   Add vendors for missing categories to improve distribution');
    } else {
      console.log('   Categorization logic is working perfectly! Check if reorder process is using this endpoint correctly.');
    }
    
    await pool.end();
  } catch (error) {
    console.error('❌ Analysis failed:', error.message);
    await pool.end();
  }
}

analyzeCategorizationPerfectly();
