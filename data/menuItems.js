const menuItems = [
  { id: 1, name: 'Masala Dosa', category: 'Breakfast', price: 80, servings: 1, ingredients: [
    { name: 'Rice', quantity: 0.15, unit: 'kg' }, { name: 'Urad Dal', quantity: 0.05, unit: 'kg' },
    { name: 'Potato', quantity: 0.1, unit: 'kg' }, { name: 'Onion', quantity: 0.03, unit: 'kg' }
  ]},
  { id: 2, name: 'Idli Sambar', category: 'Breakfast', price: 60, servings: 1, ingredients: [
    { name: 'Rice', quantity: 0.1, unit: 'kg' }, { name: 'Urad Dal', quantity: 0.03, unit: 'kg' },
    { name: 'Toor Dal', quantity: 0.02, unit: 'kg' }, { name: 'Tomato', quantity: 0.05, unit: 'kg' }
  ]},
  { id: 3, name: 'Poha', category: 'Breakfast', price: 40, servings: 1, ingredients: [
    { name: 'Poha', quantity: 0.08, unit: 'kg' }, { name: 'Onion', quantity: 0.03, unit: 'kg' }
  ]},
  { id: 4, name: 'Upma', category: 'Breakfast', price: 35, servings: 1, ingredients: [
    { name: 'Semolina', quantity: 0.08, unit: 'kg' }, { name: 'Onion', quantity: 0.03, unit: 'kg' }
  ]},
  { id: 5, name: 'Aloo Paratha', category: 'Breakfast', price: 70, servings: 1, ingredients: [
    { name: 'Wheat Flour', quantity: 0.1, unit: 'kg' }, { name: 'Potato', quantity: 0.12, unit: 'kg' }
  ]},
  { id: 6, name: 'Puri Bhaji', category: 'Breakfast', price: 60, servings: 1, ingredients: [
    { name: 'Wheat Flour', quantity: 0.1, unit: 'kg' }, { name: 'Potato', quantity: 0.12, unit: 'kg' }, { name: 'Oil', quantity: 30, unit: 'ml' }
  ]},
  { id: 7, name: 'Medu Vada', category: 'Breakfast', price: 55, servings: 1, ingredients: [
    { name: 'Urad Dal', quantity: 0.07, unit: 'kg' }, { name: 'Oil', quantity: 40, unit: 'ml' }
  ]},
  { id: 8, name: 'Pongal', category: 'Breakfast', price: 65, servings: 1, ingredients: [
    { name: 'Rice', quantity: 0.1, unit: 'kg' }, { name: 'Moong Dal', quantity: 0.04, unit: 'kg' }, { name: 'Ghee', quantity: 15, unit: 'ml' }
  ]},
  { id: 9, name: 'Chole Bhature', category: 'Lunch', price: 140, servings: 1, ingredients: [
    { name: 'Chickpeas', quantity: 0.1, unit: 'kg' }, { name: 'All Purpose Flour', quantity: 0.12, unit: 'kg' }, { name: 'Oil', quantity: 30, unit: 'ml' }
  ]},
  { id: 10, name: 'Rajma Chawal', category: 'Lunch', price: 130, servings: 1, ingredients: [
    { name: 'Kidney Beans', quantity: 0.08, unit: 'kg' }, { name: 'Rice', quantity: 0.15, unit: 'kg' }
  ]},
  { id: 11, name: 'Veg Pulao', category: 'Lunch', price: 120, servings: 1, ingredients: [
    { name: 'Rice', quantity: 0.15, unit: 'kg' }, { name: 'Mixed Vegetables', quantity: 0.12, unit: 'kg' }
  ]},
  { id: 12, name: 'Jeera Rice', category: 'Lunch', price: 90, servings: 1, ingredients: [
    { name: 'Rice', quantity: 0.18, unit: 'kg' }, { name: 'Cumin', quantity: 5, unit: 'g' }
  ]},
  { id: 13, name: 'Butter Naan', category: 'Lunch', price: 50, servings: 1, ingredients: [
    { name: 'All Purpose Flour', quantity: 0.1, unit: 'kg' }, { name: 'Butter', quantity: 10, unit: 'g' }
  ]},
  { id: 14, name: 'Tandoori Roti', category: 'Lunch', price: 25, servings: 1, ingredients: [
    { name: 'Wheat Flour', quantity: 0.09, unit: 'kg' }
  ]},
  { id: 15, name: 'Veg Thali', category: 'Lunch', price: 220, servings: 1, ingredients: [
    { name: 'Rice', quantity: 0.15, unit: 'kg' }, { name: 'Dal', quantity: 0.08, unit: 'kg' }, { name: 'Paneer', quantity: 0.08, unit: 'kg' }, { name: 'Vegetables', quantity: 0.1, unit: 'kg' }
  ]},
  { id: 16, name: 'Chicken Biryani', category: 'Lunch', price: 250, servings: 1, ingredients: [
    { name: 'Basmati Rice', quantity: 0.15, unit: 'kg' }, { name: 'Chicken', quantity: 0.2, unit: 'kg' },
    { name: 'Onion', quantity: 0.08, unit: 'kg' }, { name: 'Yogurt', quantity: 0.05, unit: 'kg' }
  ]},
  { id: 17, name: 'Mutton Curry', category: 'Lunch', price: 280, servings: 1, ingredients: [
    { name: 'Mutton', quantity: 0.25, unit: 'kg' }, { name: 'Onion', quantity: 0.1, unit: 'kg' }
  ]},
  { id: 18, name: 'Paneer Butter Masala', category: 'Lunch', price: 180, servings: 1, ingredients: [
    { name: 'Paneer', quantity: 0.15, unit: 'kg' }, { name: 'Tomato', quantity: 0.1, unit: 'kg' }
  ]},
  { id: 19, name: 'Dal Tadka', category: 'Lunch', price: 80, servings: 1, ingredients: [
    { name: 'Toor Dal', quantity: 0.08, unit: 'kg' }, { name: 'Onion', quantity: 0.03, unit: 'kg' }
  ]},
  { id: 20, name: 'Palak Paneer', category: 'Lunch', price: 170, servings: 1, ingredients: [
    { name: 'Spinach', quantity: 0.2, unit: 'kg' }, { name: 'Paneer', quantity: 0.12, unit: 'kg' }
  ]},
  { id: 21, name: 'Chana Masala', category: 'Lunch', price: 110, servings: 1, ingredients: [
    { name: 'Chickpeas', quantity: 0.1, unit: 'kg' }, { name: 'Onion', quantity: 0.06, unit: 'kg' }
  ]},
  { id: 22, name: 'Kadhai Paneer', category: 'Lunch', price: 190, servings: 1, ingredients: [
    { name: 'Paneer', quantity: 0.16, unit: 'kg' }, { name: 'Capsicum', quantity: 0.08, unit: 'kg' }
  ]},
  { id: 23, name: 'Egg Curry', category: 'Lunch', price: 130, servings: 1, ingredients: [
    { name: 'Eggs', quantity: 2, unit: 'pc' }, { name: 'Onion', quantity: 0.06, unit: 'kg' }
  ]},
  { id: 24, name: 'Fish Curry', category: 'Lunch', price: 220, servings: 1, ingredients: [
    { name: 'Fish', quantity: 0.22, unit: 'kg' }, { name: 'Coconut Milk', quantity: 120, unit: 'ml' }
  ]},
  { id: 25, name: 'Veg Fried Rice', category: 'Lunch', price: 120, servings: 1, ingredients: [
    { name: 'Rice', quantity: 0.16, unit: 'kg' }, { name: 'Mixed Vegetables', quantity: 0.12, unit: 'kg' }, { name: 'Soy Sauce', quantity: 10, unit: 'ml' }
  ]},
  { id: 26, name: 'Hakka Noodles', category: 'Lunch', price: 130, servings: 1, ingredients: [
    { name: 'Noodles', quantity: 0.15, unit: 'kg' }, { name: 'Mixed Vegetables', quantity: 0.12, unit: 'kg' }
  ]},
  { id: 27, name: 'Veg Manchurian', category: 'Lunch', price: 140, servings: 1, ingredients: [
    { name: 'Cabbage', quantity: 0.12, unit: 'kg' }, { name: 'Corn Flour', quantity: 0.02, unit: 'kg' }, { name: 'Soy Sauce', quantity: 10, unit: 'ml' }
  ]},
  { id: 28, name: 'Pav Bhaji', category: 'Snacks', price: 90, servings: 1, ingredients: [
    { name: 'Potato', quantity: 0.15, unit: 'kg' }, { name: 'Mixed Vegetables', quantity: 0.1, unit: 'kg' }, { name: 'Butter', quantity: 10, unit: 'g' }
  ]},
  { id: 29, name: 'Vada Pav', category: 'Snacks', price: 35, servings: 1, ingredients: [
    { name: 'Potato', quantity: 0.12, unit: 'kg' }, { name: 'Bread', quantity: 2, unit: 'pc' }
  ]},
  { id: 30, name: 'Dabeli', category: 'Snacks', price: 40, servings: 1, ingredients: [
    { name: 'Bread', quantity: 2, unit: 'pc' }, { name: 'Peanuts', quantity: 15, unit: 'g' }
  ]},
  { id: 31, name: 'Bhel Puri', category: 'Snacks', price: 45, servings: 1, ingredients: [
    { name: 'Puffed Rice', quantity: 0.05, unit: 'kg' }, { name: 'Sev', quantity: 0.02, unit: 'kg' }
  ]},
  { id: 32, name: 'Pani Puri', category: 'Snacks', price: 50, servings: 1, ingredients: [
    { name: 'Puri', quantity: 6, unit: 'pc' }, { name: 'Tamarind Water', quantity: 80, unit: 'ml' }
  ]},
  { id: 33, name: 'Sev Puri', category: 'Snacks', price: 55, servings: 1, ingredients: [
    { name: 'Puri', quantity: 6, unit: 'pc' }, { name: 'Sev', quantity: 20, unit: 'g' }
  ]},
  { id: 34, name: 'Dahi Puri', category: 'Snacks', price: 60, servings: 1, ingredients: [
    { name: 'Puri', quantity: 6, unit: 'pc' }, { name: 'Curd', quantity: 80, unit: 'ml' }
  ]},
  { id: 35, name: 'Rasgulla', category: 'Desserts', price: 70, servings: 1, ingredients: [
    { name: 'Chenna', quantity: 0.08, unit: 'kg' }, { name: 'Sugar Syrup', quantity: 100, unit: 'ml' }
  ]},
  { id: 36, name: 'Gulab Jamun', category: 'Desserts', price: 80, servings: 1, ingredients: [
    { name: 'Khoya', quantity: 0.08, unit: 'kg' }, { name: 'Sugar', quantity: 0.1, unit: 'kg' }
  ]},
  { id: 37, name: 'Jalebi', category: 'Desserts', price: 60, servings: 1, ingredients: [
    { name: 'All Purpose Flour', quantity: 0.06, unit: 'kg' }, { name: 'Sugar Syrup', quantity: 120, unit: 'ml' }
  ]},
  { id: 38, name: 'Kheer', category: 'Desserts', price: 70, servings: 1, ingredients: [
    { name: 'Rice', quantity: 0.05, unit: 'kg' }, { name: 'Milk', quantity: 0.2, unit: 'L' }, { name: 'Sugar', quantity: 0.04, unit: 'kg' }
  ]},
  { id: 39, name: 'Lassi', category: 'Drinks', price: 50, servings: 1, ingredients: [
    { name: 'Curd', quantity: 0.2, unit: 'L' }, { name: 'Sugar', quantity: 0.02, unit: 'kg' }
  ]},
  { id: 40, name: 'Cold Coffee', category: 'Drinks', price: 70, servings: 1, ingredients: [
    { name: 'Milk', quantity: 0.25, unit: 'L' }, { name: 'Coffee', quantity: 8, unit: 'g' }
  ]},
  { id: 41, name: 'Masala Chai', category: 'Drinks', price: 25, servings: 1, ingredients: [
    { name: 'Tea Leaves', quantity: 0.005, unit: 'kg' }, { name: 'Milk', quantity: 0.15, unit: 'L' }
  ]},
  { id: 42, name: 'Filter Coffee', category: 'Drinks', price: 30, servings: 1, ingredients: [
    { name: 'Coffee', quantity: 0.008, unit: 'kg' }, { name: 'Milk', quantity: 0.12, unit: 'L' }
  ]},
  { id: 43, name: 'Nimbu Pani', category: 'Drinks', price: 20, servings: 1, ingredients: [
    { name: 'Lemon Juice', quantity: 25, unit: 'ml' }, { name: 'Sugar Syrup', quantity: 15, unit: 'ml' }
  ]},
  { id: 44, name: 'Badam Milk', category: 'Drinks', price: 60, servings: 1, ingredients: [
    { name: 'Milk', quantity: 0.25, unit: 'L' }, { name: 'Almonds', quantity: 12, unit: 'g' }
  ]},
  { id: 45, name: 'Pakora', category: 'Snacks', price: 45, servings: 1, ingredients: [
    { name: 'Gram Flour', quantity: 0.06, unit: 'kg' }, { name: 'Onion', quantity: 0.05, unit: 'kg' }
  ]},
  { id: 46, name: 'Samosa', category: 'Snacks', price: 20, servings: 1, ingredients: [
    { name: 'All Purpose Flour', quantity: 0.05, unit: 'kg' }, { name: 'Potato', quantity: 0.08, unit: 'kg' }
  ]},
  { id: 47, name: 'Kathi Roll', category: 'Snacks', price: 90, servings: 1, ingredients: [
    { name: 'Paratha', quantity: 1, unit: 'pc' }, { name: 'Paneer/Chicken', quantity: 0.12, unit: 'kg' }
  ]},
  { id: 48, name: 'Chicken Tikka', category: 'Lunch', price: 210, servings: 1, ingredients: [
    { name: 'Chicken', quantity: 0.2, unit: 'kg' }, { name: 'Yogurt', quantity: 80, unit: 'ml' }
  ]},
  { id: 49, name: 'Tandoori Chicken', category: 'Lunch', price: 260, servings: 1, ingredients: [
    { name: 'Chicken', quantity: 0.25, unit: 'kg' }, { name: 'Yogurt', quantity: 100, unit: 'ml' }
  ]},
  { id: 50, name: 'Veg Sandwich', category: 'Snacks', price: 60, servings: 1, ingredients: [
    { name: 'Bread', quantity: 2, unit: 'pc' }, { name: 'Vegetables', quantity: 0.08, unit: 'kg' }
  ]}
];

module.exports = { menuItems };