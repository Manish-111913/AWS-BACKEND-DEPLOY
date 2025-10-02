// Simple manual test harness for deterministic JS receipt parser
// Run with: node backend/testing_tools/test_deterministic_parser.js

const { parseDeterministic } = require('../utils/receiptParser');

const sampleText = `Fresh Tomatoes 2 x 150 = 300\nChicken Breast 1.2 kg 1860\n5x6 - Parel Sheet - 180\nOlive Oil 500 ml 825\nOnions 3 x 45 = 135\nSugar 2 50 100\n`;

console.log('==== Deterministic Parser Test ====' );
console.log(sampleText);
const items = parseDeterministic(sampleText);
console.log('\nExtracted items:', items.length);
console.dir(items, { depth: null });

if (!items.length) {
  console.error('No items extracted – investigate patterns.');
  process.exitCode = 1;
}