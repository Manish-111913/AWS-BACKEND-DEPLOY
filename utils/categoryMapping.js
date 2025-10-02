/**
 * Category Mapping Utility
 * Maps inventory categories to vendor categories for intelligent order distribution
 */

// Mapping from inventory categories to vendor categories
const INVENTORY_TO_VENDOR_CATEGORY_MAP = {
    // Direct matches (case-insensitive handling below)
    'vegetables': 'vegetables',
    'dairy': 'dairy', 
    'meat': 'meat',
    'seafood': 'seafood',
    'fruits': 'fruits',
    
    // Mixed categories - map to primary category
    'Meat & Seafood': 'meat',  // Primary mapping to meat
    'meat & seafood': 'meat',  // Case variation
    
    // Wholesale categories (fallback)
    'Auto Ingredients': 'wholesale',
    'Spices & Seasonings': 'wholesale', 
    'Grains & Cereals': 'wholesale',
    'Legumes & Flours': 'wholesale',
    'Oils & Fats': 'wholesale',
    'Beverages': 'wholesale',
    'Spices': 'wholesale',
    
    // Exclude from orders
    'Complimentary Items': 'exclude'
};

// Normalize a raw category string to a canonical vendor category key
function normalizeCategoryKey(raw) {
    const s = (raw || '').toString().trim().toLowerCase();
    if (!s) return 'wholesale';
    const map = [
        { key: 'meat', keys: ['meat', 'butcher', 'poultry', 'chicken', 'mutton', 'non veg', 'non-veg', 'nonvegetarian'] },
        { key: 'seafood', keys: ['seafood', 'sea food', 'fish', 'prawn', 'prawns', 'shrimp'] },
        { key: 'dairy', keys: ['dairy', 'milk', 'milk products', 'paneer', 'amul', 'ghee', 'butter', 'cheese', 'curd', 'yogurt'] },
        { key: 'vegetables', keys: ['vegetables', 'veg', 'produce', 'greens'] },
        { key: 'fruits', keys: ['fruits', 'fruit'] },
        { key: 'spices', keys: ['spices', 'seasonings', 'masala', 'masalas'] },
        { key: 'grains', keys: ['grains', 'cereals', 'pulses', 'flour', 'atta', 'rice', 'dal', 'millets'] },
        { key: 'oils', keys: ['oils', 'oil', 'fats'] },
        { key: 'beverages', keys: ['beverages', 'drinks', 'juice', 'tea', 'coffee'] },
        { key: 'bakery', keys: ['bakery', 'bread'] },
        { key: 'frozen', keys: ['frozen'] },
        { key: 'wholesale', keys: ['wholesale', 'general', 'grocery', 'staples'] },
    ];
    for (const m of map) {
        if (m.keys.some(k => s.includes(k))) return m.key;
    }
    // Fall back to wholesale if unknown
    return 'wholesale';
}

// Item-specific overrides for misclassified items
const ITEM_NAME_OVERRIDES = {
    // Meat items that might be misclassified
    'chicken': 'meat',
    'beef': 'meat', 
    'lamb': 'meat',
    'mutton': 'meat',
    'pork': 'meat',
    'meat': 'meat',
    
    // Seafood items
    'fish': 'seafood',
    'salmon': 'seafood',
    'tuna': 'seafood',
    'shrimp': 'seafood',
    'prawns': 'seafood',
    'crab': 'seafood',
    'lobster': 'seafood',
    'seafood': 'seafood',
    
    // Dairy items
    'milk': 'dairy',
    'cheese': 'dairy',
    'butter': 'dairy',
    'cream': 'dairy',
    'yogurt': 'dairy',
    'paneer': 'dairy',
    
    // Vegetables
    'tomato': 'vegetables',
    'onion': 'vegetables',
    'potato': 'vegetables',
    'carrot': 'vegetables',
    
    // Fruits
    'apple': 'fruits',
    'banana': 'fruits',
    'orange': 'fruits',
    'mango': 'fruits'
};

/**
 * Get vendor category for an inventory category
 * @param {string} inventoryCategory - The inventory category name
 * @param {string} itemName - The item name for intelligent override
 * @returns {string} - The corresponding vendor category or 'wholesale' as fallback
 */
function getVendorCategoryForInventory(inventoryCategory, itemName = '') {
    // First, check for item-specific overrides based on item name
    if (itemName) {
        const itemNameLower = itemName.toLowerCase();
        // Skip overrides for processed/packaged items to avoid misclassifying into meat/dairy
        const processedKeywords = [
            'masala', 'powder', 'mix', 'premix', 'soup', 'broth', 'stock', 'seasoning', 'spice', 'spices', 'gravy', 'base', 'paste',
            'pepper', 'tikka', 'tandoori', 'marinade', 'marination', 'rub', 'coating', 'batter'
        ];
        const isProcessed = processedKeywords.some(k => itemNameLower.includes(k));
        if (!isProcessed) {
        for (const [keyword, category] of Object.entries(ITEM_NAME_OVERRIDES)) {
            if (itemNameLower.includes(keyword)) {
                // Item override found - using item name to determine category
                return category;
            }
        }
        }
    }
    
    // Then check category mapping (case-insensitive)
    if (!inventoryCategory) return 'wholesale'; // Default fallback
    
    // Try exact match first
    let mapped = INVENTORY_TO_VENDOR_CATEGORY_MAP[inventoryCategory];
    if (mapped) return mapped;
    
    // Try case-insensitive match
    const categoryLower = inventoryCategory.toLowerCase();
    for (const [key, value] of Object.entries(INVENTORY_TO_VENDOR_CATEGORY_MAP)) {
        if (key.toLowerCase() === categoryLower) {
            return value;
        }
    }
    
    // Wholesale as universal fallback
    return 'wholesale';
}

/**
 * Group items by their vendor categories
 * @param {Array} items - Array of inventory items with category information
 * @returns {Object} - Items grouped by vendor category
 */
function groupItemsByVendorCategory(items) {
    const grouped = {};
    
    items.forEach(item => {
        const vendorCategory = getVendorCategoryForInventory(item.category, item.name);
        
        // Skip items marked for exclusion
        if (vendorCategory === 'exclude') {
            return;
        }
        
        if (!grouped[vendorCategory]) {
            grouped[vendorCategory] = [];
        }
        
        grouped[vendorCategory].push({
            ...item,
            assignedVendorCategory: vendorCategory
        });
    });
    
    return grouped;
}

/**
 * Find preferred vendors for each category
 * @param {Array} allVendors - All available vendors
 * @param {Array} requiredCategories - Categories that need vendors
 * @returns {Object} - Preferred vendors by category
 */
function getPreferredVendorsByCategory(allVendors, requiredCategories) {
    const preferredByCategory = {};

    // Index vendors by normalized category key
    const vendorsByNormKey = allVendors.reduce((acc, v) => {
        const key = normalizeCategoryKey(v.vendor_category || v.category || '');
        if (!acc[key]) acc[key] = [];
        acc[key].push({ ...v, normalizedCategoryKey: key });
        return acc;
    }, {});

    requiredCategories.forEach(category => {
        const key = normalizeCategoryKey(category);
        const list = vendorsByNormKey[key] || [];
        if (list.length > 0) {
            // Pick highest rated vendor
            const best = list.sort((a, b) => (Number(b.average_rating || 0)) - (Number(a.average_rating || 0)))[0];
            preferredByCategory[key] = best;
        }
    });

    // Ensure wholesale fallback
    if (!preferredByCategory['wholesale'] && (vendorsByNormKey['wholesale'] || []).length > 0) {
        const bestWholesale = vendorsByNormKey['wholesale'].sort((a, b) => (Number(b.average_rating || 0)) - (Number(a.average_rating || 0)))[0];
        preferredByCategory['wholesale'] = bestWholesale;
    }

    return preferredByCategory;
}

/**
 * Create category-based vendor assignments for orders
 * @param {Array} selectedItems - Items selected for ordering
 * @param {Array} allVendors - All available vendors
 * @returns {Array} - Array of vendor assignments with their items
 */
function createCategoryBasedAssignments(selectedItems, allVendors) {
    console.log('🔄 Creating category-based vendor assignments...');
    
    // Group items by vendor category
    const itemsByCategory = groupItemsByVendorCategory(selectedItems);
    
    console.log('📦 Items grouped by category:', Object.keys(itemsByCategory));
    
    // Get preferred vendors for each required category (normalized)
    const requiredCategories = Object.keys(itemsByCategory);
    const preferredVendors = getPreferredVendorsByCategory(allVendors, requiredCategories);
    
    console.log('🏪 Preferred vendors by category:', Object.keys(preferredVendors));
    
    // Create vendor assignments
    const assignments = [];
    
    Object.entries(itemsByCategory).forEach(([category, items]) => {
        const normKey = normalizeCategoryKey(category);
        const vendor = preferredVendors[normKey];
        
        if (vendor) {
            assignments.push({
                vendor: vendor,
                vendorCategory: normKey,
                items: items,
                itemCount: items.length
            });
            
            console.log(`   ✅ ${category}: ${items.length} items → ${vendor.name}`);
        } else {
            console.log(`   ⚠️ ${category}: ${items.length} items → No vendor found, will use wholesale fallback`);
            
            // Try to assign to wholesale vendor
            const wholesaleVendor = preferredVendors['wholesale'];
            if (wholesaleVendor) {
                // Find existing wholesale assignment or create new one
                let wholesaleAssignment = assignments.find(a => a.vendor.vendor_id === wholesaleVendor.vendor_id);
                if (wholesaleAssignment) {
                    wholesaleAssignment.items.push(...items);
                    wholesaleAssignment.itemCount += items.length;
                } else {
                    assignments.push({
                        vendor: wholesaleVendor,
                        vendorCategory: 'wholesale',
                        items: items,
                        itemCount: items.length
                    });
                }
            }
        }
    });
    
    return assignments;
}

module.exports = {
    INVENTORY_TO_VENDOR_CATEGORY_MAP,
    getVendorCategoryForInventory,
    groupItemsByVendorCategory,
    getPreferredVendorsByCategory,
    createCategoryBasedAssignments
};
