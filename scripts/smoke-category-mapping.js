const {
  getVendorCategoryForInventory,
  groupItemsByVendorCategory
} = require('../utils/categoryMapping');

function test(name, category) {
  const res = getVendorCategoryForInventory(category, name);
  console.log(`${name} [${category}] -> ${res}`);
}

console.log('--- Vendor Category Mapping Smoke Test ---');
// Name-based overrides
test('Chicken Breast', 'Auto Ingredients'); // expect meat
test('Fresh Milk', 'Auto Ingredients'); // expect dairy
test('Chicken Masala', 'Auto Ingredients'); // expect wholesale (processed)
test('Chicken Soup', 'Auto Ingredients'); // expect wholesale (processed)
test('Chicken Pepper', 'Auto Ingredients'); // expect wholesale (processed)
// Category-based mapping
test('Rohu Fish', 'Meat & Seafood'); // expect meat (primary)
// Vegetables
test('Tomato', 'vegetables'); // expect vegetables
// Unknown
test('Random Item', 'Unknown Category'); // expect wholesale

console.log('\nGroup items by vendor category:');
const items = [
  { name: 'Chicken Breast', category: 'Auto Ingredients' },
  { name: 'Fresh Milk', category: 'Auto Ingredients' },
  { name: 'Chicken Masala', category: 'Auto Ingredients' },
  { name: 'Chicken Soup', category: 'Auto Ingredients' },
  { name: 'Chicken Pepper', category: 'Auto Ingredients' },
  { name: 'Tomato', category: 'Vegetables' },
  { name: 'Cumin Seeds', category: 'Spices' }
];
const grouped = groupItemsByVendorCategory(items);
console.log(Object.keys(grouped));
for (const k of Object.keys(grouped)) {
  console.log(`  ${k}: ${grouped[k].map(i => i.name).join(', ')}`);
}
