const OCRService = require('../utils/OCR');

describe('OCRService smoke', () => {
  test('parseReceiptText extracts items from sample text', async () => {
    const svc = new OCRService();
    const sample = `Fresh Tomatoes    2.5kg    $15.75\nChicken Breast    1.2kg    $18.60\nRandom Line`;    
    const items = await svc.parseReceiptText(sample);
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBeGreaterThan(0);
    const tomato = items.find(i => /Tomatoes/i.test(i.item_name));
    expect(tomato).toBeTruthy();
  });

  test('validateApiKey returns structured object (mocked fetch)', async () => {
    const originalFetch = global.fetch || require('node-fetch');
    // Monkey patch fetch for this test only
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ responses: [ { fullTextAnnotation: { text: '' } } ] })
    }));

    const svc = new OCRService();
    const result = await svc.validateApiKey();
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('timestamp');

    // restore
    global.fetch = originalFetch;
  });
});
