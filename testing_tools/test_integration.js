require('dotenv').config();
const ReceiptParserService = require('./services/receiptParserService');

async function testIntegration() {
  console.log('🧪 Testing Node.js + Python Integration...\n');
  
  const GOOGLE_API_KEY = process.env.GOOGLE_VISION_API_KEY;
  const parser = new ReceiptParserService(GOOGLE_API_KEY);
  
  const testText = "ORGANIC BANANAS 1.25 845.00\nTOMATOES 0.80 40.00";
  
  try {
    console.log('📤 Sending to Python parser...');
    const result = await parser.parseReceipt(testText);
    
    console.log('📥 Result received:');
    console.log('✅ Success:', result.success);
    console.log('📦 Items:', result.items?.length || 0);
    console.log('🔧 Method:', result.parsing_method);
    
    if (result.items) {
      result.items.forEach((item, i) => {
        console.log(`${i+1}. ${item.item_name} - ${item.quantity} ${item.unit} @ $${item.unit_price}`);
      });
    }
    
    console.log('\n🎉 Integration test successful!');
  } catch (error) {
    console.error('❌ Integration test failed:', error.message);
  }
}

testIntegration();