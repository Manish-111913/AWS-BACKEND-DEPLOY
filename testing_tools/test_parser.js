require('dotenv').config();
const ReceiptParserService = require('./services/receiptParserService');

// Test the advanced receipt parser
async function testParser() {
  const GOOGLE_API_KEY = process.env.GOOGLE_VISION_API_KEY || 'your-google-api-key-here';
  
  if (GOOGLE_API_KEY === 'your-google-api-key-here') {
    console.log('❌ Please set your GOOGLE_VISION_API_KEY in environment variables');
    process.exit(1);
  }

  const parser = new ReceiptParserService(GOOGLE_API_KEY);

  const sampleReceipt = `
FRESHMART GROCERIES
BILL DATE         2025-07-25
ITEM         QTY    PRICE
ORGANIC BANANAS 1.25    $45.00
TOMATOES        0.80    $40.00
CHICKEN BREAST  1.50    $320.00
MUTTON          1.00    $650.00
TOTAL           $829.95
  `;

  console.log('🧪 Testing Advanced Receipt Parser...\n');
  console.log('📄 Sample Receipt:');
  console.log(sampleReceipt);
  console.log('\n🔄 Processing...\n');

  try {
    const result = await parser.parseReceipt(sampleReceipt);
    
    if (result.success) {
      console.log('✅ Parsing successful!');
      console.log(`📊 Method: ${result.parsing_method}`);
      console.log(`📦 Items found: ${result.total_items}\n`);
      
      result.items.forEach((item, index) => {
        console.log(`${index + 1}. ${item.item_name}`);
        console.log(`   Quantity: ${item.quantity} ${item.unit}`);
        console.log(`   Price: $${item.unit_price}`);
        console.log(`   Category: ${item.category}`);
        console.log(`   Expiry: ${item.expiry_date}`);
        console.log(`   Batch: ${item.batch_number}\n`);
      });
    } else {
      console.log('❌ Parsing failed:', result.error);
    }
  } catch (error) {
    console.log('❌ Test failed:', error.message);
  }
}

testParser();