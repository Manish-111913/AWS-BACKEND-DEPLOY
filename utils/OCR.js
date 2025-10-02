const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

class OCRService {
  constructor() {
    this.apiKey = process.env.GOOGLE_VISION_API_KEY;
    this.baseUrl = 'https://vision.googleapis.com/v1/images:annotate';
    this.maxRetries = 3;
    this.retryDelay = 2000; // 2 seconds (increased from 1 second)
    this.visionTimeout = 60000; // 60 seconds (increased from 30 seconds)
    this.geminiTimeout = 90000; // 90 seconds for Gemini AI processing
    
    if (!this.apiKey) {
      throw new Error('GOOGLE_VISION_API_KEY environment variable is required');
    }
  }

  /**
   * Process image using Google Vision API
   * @param {Buffer|string} imageInput - Image buffer, file path, or URL
   * @param {Object} options - OCR processing options
   * @returns {Promise<Object>} OCR result with extracted text
   */
  async processImage(imageInput, options = {}) {
    const defaultOptions = {
      language: 'en',
      detectOrientation: true,
      useDocumentTextDetection: false, // Use TEXT_DETECTION by default
      includeRegionalLanguages: true, // Enable Indian language support
      preferredParser: 'python' // Use Python parser by default for better language support
    };

    const ocrOptions = { ...defaultOptions, ...options };

    try {
      console.log('🔍 Starting Google Vision API OCR processing...');
      
      // Enhance language hints for Indian languages
      if (ocrOptions.includeRegionalLanguages) {
        ocrOptions.languageHints = this.getIndianLanguageHints(ocrOptions.language);
      }

      // Convert input to base64 format required by Google Vision API
      const base64Image = await this.prepareImageForVisionAPI(imageInput);
      
      if (!base64Image) {
        throw new Error('Failed to prepare image for Google Vision API');
      }

      // Use Google Vision API
      return await this.processImageWithVisionAPI(base64Image, ocrOptions);

    } catch (error) {
      console.error('❌ OCR processing error:', error);
      return {
        success: false,
        error: error.message,
        rawText: null,
        extractedItems: []
      };
    }
  }

  /**
   * Prepare image input for Google Vision API (convert to base64)
   * @param {Buffer|string} imageInput - Image buffer, file path, URL, or data URI
   * @returns {Promise<string>} Base64 encoded image
   */
  async prepareImageForVisionAPI(imageInput) {
    try {
      if (Buffer.isBuffer(imageInput)) {
        // Convert buffer to base64
        return imageInput.toString('base64');
      } else if (typeof imageInput === 'string') {
        if (imageInput.startsWith('http')) {
          // Download URL and convert to base64
          console.log('🌐 Downloading image from URL...');
          const response = await fetch(imageInput, { timeout: this.visionTimeout });
          if (!response.ok) {
            throw new Error(`Failed to download image: ${response.status}`);
          }
          const buffer = await response.buffer();
          return buffer.toString('base64');
        } else if (imageInput.startsWith('data:')) {
          // Extract base64 from data URI
          const base64Data = imageInput.split(',')[1];
          if (!base64Data) {
            throw new Error('Invalid data URI format');
          }
          return base64Data;
        } else if (this.isRawBase64Image(imageInput)) {
          // Raw base64 string (no data: prefix) – pass through
          console.log('📎 Detected raw base64 image string input');
          return imageInput;
        } else {
          // File path - read and convert to base64
          if (!fs.existsSync(imageInput)) {
            throw new Error(`Image file not found: ${imageInput}`);
          }
          const buffer = fs.readFileSync(imageInput);
          return buffer.toString('base64');
        }
      } else {
        throw new Error('Invalid image input type');
      }
    } catch (error) {
      console.error('❌ Error preparing image for Vision API:', error);
      throw error;
    }
  }

  /**
   * Heuristic to detect raw base64 (image) strings without a data URI prefix
   * @param {string} str
   * @returns {boolean}
   */
  isRawBase64Image(str) {
    // Reject if it looks like a path (contains slash or backslash or dot with common image ext)
    if (/[/\\]/.test(str)) return false;
    if (/\.(png|jpe?g|gif|webp|pdf)$/i.test(str)) return false;
    // Base64 chars only and length multiple of 4
    if (!/^[A-Za-z0-9+/=]+$/.test(str)) return false;
    if (str.length < 40) return false; // too short to be an image (avoid false positives like 'test')
    if (str.length % 4 !== 0) return false;
    // Typically image base64 ends with = or == padding (not always) – not mandatory
    return true;
  }

  /**
   * Get language hints for Indian regional languages
   * @param {string} primaryLanguage - Primary language code
   * @returns {Array} Array of language codes
   */
  getIndianLanguageHints(primaryLanguage = 'en') {
    const indianLanguages = {
      'te': ['te', 'hi', 'en'], // Telugu with Hindi and English fallback
      'hi': ['hi', 'te', 'ta', 'en'], // Hindi with other Indian languages
      'ta': ['ta', 'hi', 'te', 'en'], // Tamil
      'kn': ['kn', 'hi', 'te', 'en'], // Kannada
      'ml': ['ml', 'hi', 'te', 'en'], // Malayalam
      'gu': ['gu', 'hi', 'en'], // Gujarati
      'pa': ['pa', 'hi', 'en'], // Punjabi
      'bn': ['bn', 'hi', 'en'], // Bengali
      'or': ['or', 'hi', 'en'], // Odia
      'as': ['as', 'hi', 'en'], // Assamese
      'mr': ['mr', 'hi', 'en'], // Marathi
      'ur': ['ur', 'hi', 'en'], // Urdu
      'sa': ['sa', 'hi', 'en'], // Sanskrit
      'en': ['en', 'hi', 'te'] // English with Indian language support
    };

    return indianLanguages[primaryLanguage] || ['en', 'hi', 'te'];
  }

  /**
   * Process image using Google Vision API
   * @param {string} base64Image - Base64 encoded image
   * @param {Object} options - OCR processing options
   * @returns {Promise<Object>} OCR result with extracted text
   */
  async processImageWithVisionAPI(base64Image, options = {}) {
    try {
      // Prepare request body for Google Vision API
      const requestBody = {
        requests: [
          {
            image: {
              content: base64Image
            },
            features: [
              {
                type: options.useDocumentTextDetection ? 'DOCUMENT_TEXT_DETECTION' : 'TEXT_DETECTION'
              }
            ]
          }
        ]
      };

      // Add enhanced language hints for Indian languages
      if (options.languageHints && options.languageHints.length > 0) {
        requestBody.requests[0].imageContext = {
          languageHints: options.languageHints
        };
      } else if (options.language && options.language !== 'en') {
        requestBody.requests[0].imageContext = {
          languageHints: [options.language]
        };
      }

      console.log('📤 Making request to Google Vision API...');
      const result = await this.makeVisionAPIRequest(requestBody);
      
      if (result.responses && result.responses[0]) {
        const response = result.responses[0];
        
        if (response.error) {
          throw new Error(`Vision API error: ${response.error.message}`);
        }

        let rawText = '';
        let confidence = 0;

        if (options.useDocumentTextDetection && response.fullTextAnnotation) {
          // Use DOCUMENT_TEXT_DETECTION response
          rawText = response.fullTextAnnotation.text || '';
        } else if (response.textAnnotations && response.textAnnotations.length > 0) {
          // Use TEXT_DETECTION response (first annotation contains full text)
          rawText = response.textAnnotations[0].description || '';
          
          // Calculate average confidence from all text annotations
          const confidences = response.textAnnotations
            .filter(annotation => annotation.confidence !== undefined)
            .map(annotation => annotation.confidence);
          
          if (confidences.length > 0) {
            confidence = confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
          }
        }

        if (rawText) {
          console.log('✅ Google Vision API processing completed successfully');
          return {
            success: true,
            rawText: rawText,
            confidence: confidence,
            processedData: result,
            extractedItems: await this.parseReceiptText(rawText)
          };
        } else {
          throw new Error('No text detected in image');
        }
      } else {
        throw new Error('Invalid response from Google Vision API');
      }

    } catch (error) {
      console.error('❌ Google Vision API processing error:', error);
      return {
        success: false,
        error: error.message,
        rawText: null,
        extractedItems: []
      };
    }
  }

  /**
   * Make request to Google Vision API with retry logic
   * @param {Object} requestBody - Request body for Vision API
   * @returns {Promise<Object>} API response
   */
  async makeVisionAPIRequest(requestBody, attempt = 1) {
    try {
      const url = `${this.baseUrl}?key=${this.apiKey}`;
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        timeout: this.visionTimeout // Use configurable timeout (increased to 60 seconds)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      // Check for API errors in the response
      if (result.responses && result.responses[0] && result.responses[0].error && attempt < this.maxRetries) {
        console.log(`⚠️ Vision API attempt ${attempt} failed, retrying...`);
        await this.delay(this.retryDelay * attempt);
        return this.makeVisionAPIRequest(requestBody, attempt + 1);
      }

      return result;

    } catch (error) {
      if (attempt < this.maxRetries) {
        console.log(`⚠️ Vision API request attempt ${attempt} failed, retrying...`);
        await this.delay(this.retryDelay * attempt);
        return this.makeVisionAPIRequest(requestBody, attempt + 1);
      }
      throw error;
    }
  }

  /**
   * Legacy method for backwards compatibility - processes image with Google Vision API
   * @param {Buffer|string} imageInput - Image input
   * @param {Object} options - OCR options  
   * @returns {Promise<Object>} OCR result
   */
  async processImageWithPost(imageInput, options = {}) {
    // For backwards compatibility, redirect to main processing method
    return await this.processImage(imageInput, options);
  }

  /**
   * Parse receipt text to extract inventory items
   * @param {string} rawText - Raw OCR text
   * @returns {Promise<Array>} Array of extracted items
   */
  async parseReceiptText(rawText) {
    try {
      console.log('📝 Parsing receipt text for inventory items...');
      
      const lines = rawText.split('\n').filter(line => line.trim().length > 0);
      const extractedItems = [];
      
      // Common patterns for receipt parsing
      const patterns = {
        // Sri Sai Traders specific pattern: "ITEM NAME RATE QTY TAX% TOTAL"
        sriSaiPattern: /^([A-Z\s\/]+?)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)$/i,
        
        // Pattern for items with quantity and price: "Item Name 2kg $15.50"
        itemWithQtyPrice: /^(.+?)\s+(\d+(?:\.\d+)?)\s*(kg|g|lbs?|oz|pcs?|units?|liters?|ml|dozen)\s*[\$₹€£]?(\d+(?:\.\d+)?)/i,
        
        // Pattern for simple item with price: "Item Name $15.50"
        itemWithPrice: /^(.+?)\s+[\$₹€£](\d+(?:\.\d+)?)$/i,
        
        // Pattern for quantity and item: "2kg Tomatoes $15.50"
        qtyAndItem: /^(\d+(?:\.\d+)?)\s*(kg|g|lbs?|oz|pcs?|units?|liters?|ml|dozen)\s+(.+?)\s+[\$₹€£]?(\d+(?:\.\d+)?)/i,
        
        // Date pattern for expiry detection
        datePattern: /(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/,
        
        // Total pattern to stop parsing
        totalPattern: /^(total|subtotal|amount|sum)[\s:]*[\$₹€£]?(\d+(?:\.\d+)?)/i
      };

      let currentItem = null;
      let itemCounter = 1;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines and common receipt headers/footers
        if (this.isSkippableLine(line)) {
          continue;
        }

        // Stop parsing at total
        if (patterns.totalPattern.test(line)) {
          break;
        }

        // Try different patterns
        let match = null;
        let itemData = null;

        // Pattern 0: Sri Sai Traders specific format
        match = line.match(patterns.sriSaiPattern);
        if (match) {
          itemData = {
            item_name: this.cleanItemName(match[1]),
            quantity: parseFloat(match[3]),
            unit: this.guessUnit(match[1]),
            unit_price: parseFloat(match[2]),
            total_price: parseFloat(match[5]),
            category: this.categorizeItem(match[1]),
            confidence: 0.95
          };
        }

        // Pattern 1: Item with quantity and price
        if (!itemData) {
          match = line.match(patterns.itemWithQtyPrice);
          if (match) {
            itemData = {
              item_name: this.cleanItemName(match[1]),
              quantity: parseFloat(match[2]),
              unit: this.standardizeUnit(match[3]),
              unit_price: parseFloat(match[4]),
              category: this.categorizeItem(match[1]),
              confidence: 0.9
            };
          }
        }

        // Pattern 2: Quantity and item
        if (!itemData) {
          match = line.match(patterns.qtyAndItem);
          if (match) {
            itemData = {
              item_name: this.cleanItemName(match[3]),
              quantity: parseFloat(match[1]),
              unit: this.standardizeUnit(match[2]),
              unit_price: parseFloat(match[4]),
              category: this.categorizeItem(match[3]),
              confidence: 0.85
            };
          }
        }

        // Pattern 3: Simple item with price (assume 1 unit)
        if (!itemData) {
          match = line.match(patterns.itemWithPrice);
          if (match && this.isLikelyFoodItem(match[1])) {
            itemData = {
              item_name: this.cleanItemName(match[1]),
              quantity: 1,
              unit: 'piece',
              unit_price: parseFloat(match[2]),
              category: this.categorizeItem(match[1]),
              confidence: 0.7
            };
          }
        }

        // If we found item data, process it
        if (itemData && itemData.item_name && itemData.quantity > 0 && itemData.unit_price >= 0) {
          // Generate batch number
          const today = new Date();
          const dateStr = today.getDate().toString().padStart(2, '0') + 
                         (today.getMonth() + 1).toString().padStart(2, '0');
          const itemPrefix = itemData.item_name.replace(/[^A-Za-z]/g, '').toUpperCase().substring(0, 4).padEnd(4, 'X');
          
          itemData.batch_number = `${itemPrefix}-${dateStr}-${itemCounter.toString().padStart(4, '0')}`;
          
          // Set default expiry date based on category
          itemData.expiry_date = this.getDefaultExpiryDate(itemData.category);
          
          // Set current time
          itemData.time = new Date().toTimeString().slice(0, 5);
          
          extractedItems.push(itemData);
          itemCounter++;
          
          console.log(`📦 Extracted item: ${itemData.item_name} (${itemData.quantity} ${itemData.unit})`);
        }
      }

      console.log(`✅ Extracted ${extractedItems.length} items from receipt`);
      return extractedItems;

    } catch (error) {
      console.error('❌ Error parsing receipt text:', error);
      return [];
    }
  }

  /**
   * Check if a line should be skipped during parsing
   * @param {string} line - Text line to check
   * @returns {boolean} True if line should be skipped
   */
  isSkippableLine(line) {
    const skipPatterns = [
      /^(receipt|invoice|bill|store|shop|market)/i,
      /^(date|time|cashier|clerk)/i,
      /^(thank you|thanks|visit again)/i,
      /^(phone|tel|address|email)/i,
      /^[\-=\*]{3,}$/,
      /^[0-9\-\/\s:]+$/,
      /^(tax|vat|gst|discount)/i,
      /^(cash|card|change|paid)/i
    ];

    return skipPatterns.some(pattern => pattern.test(line)) || line.length < 3;
  }

  /**
   * Clean and normalize item names
   * @param {string} itemName - Raw item name
   * @returns {string} Cleaned item name
   */
  cleanItemName(itemName) {
    return itemName
      .replace(/[^\w\s]/g, ' ') // Remove special characters
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim()
      .toLowerCase()
      .replace(/\b\w/g, l => l.toUpperCase()); // Title case
  }

  /**
   * Standardize units to match your system
   * @param {string} unit - Raw unit
   * @returns {string} Standardized unit
   */
  standardizeUnit(unit) {
    const unitMap = {
      'kg': 'kilogram',
      'g': 'gram',
      'lbs': 'pound',
      'lb': 'pound',
      'oz': 'ounce',
      'pcs': 'piece',
      'pc': 'piece',
      'units': 'piece',
      'unit': 'piece',
      'liters': 'liter',
      'liter': 'liter',
      'l': 'liter',
      'ml': 'milliliter',
      'dozen': 'dozen'
    };

    const normalizedUnit = unit.toLowerCase().replace(/s$/, ''); // Remove plural 's'
    return unitMap[normalizedUnit] || unit.toLowerCase();
  }

  /**
   * Categorize items based on name
   * @param {string} itemName - Item name
   * @returns {string} Category
   */
  categorizeItem(itemName) {
    const name = itemName.toLowerCase();
    
    const categories = {
      'Meat': ['chicken', 'beef', 'pork', 'lamb', 'fish', 'salmon', 'tuna', 'meat', 'bacon', 'ham'],
      'Vegetables': ['tomato', 'onion', 'potato', 'carrot', 'lettuce', 'spinach', 'broccoli', 'pepper', 'cucumber', 'cabbage'],
      'Dairy': ['milk', 'cheese', 'butter', 'yogurt', 'cream', 'eggs'],
      'Grains': ['rice', 'wheat', 'flour', 'bread', 'pasta', 'noodles', 'cereal', 'dal', 'besan', 'sugar'],
      'Spices': ['salt', 'pepper', 'cumin', 'turmeric', 'chili', 'chilly', 'garlic', 'ginger', 'herbs', 'jeera', 'ajwan'],
      'Beverages': ['juice', 'soda', 'water', 'tea', 'coffee', 'wine', 'beer'],
      'Oils': ['oil', 'olive oil', 'coconut oil', 'ghee', 'palm oil']
    };

    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => name.includes(keyword))) {
        return category;
      }
    }

    return 'Uncategorized';
  }

  /**
   * Guess appropriate unit based on item name
   * @param {string} itemName - Item name
   * @returns {string} Guessed unit
   */
  guessUnit(itemName) {
    const name = itemName.toLowerCase();
    
    // Weight-based items
    if (name.includes('dal') || name.includes('besan') || name.includes('sugar') || 
        name.includes('chilly') || name.includes('jeera') || name.includes('oil')) {
      return 'kg';
    }
    
    // Liquid items
    if (name.includes('oil') && name.includes('ltr')) {
      return 'liter';
    }
    
    // GM items
    if (name.includes('gm') || name.includes('gram')) {
      return 'gm';
    }
    
    // Box/packaged items
    if (name.includes('box')) {
      return 'box';
    }
    
    // Default for misc items
    return 'piece';
  }

  /**
   * Check if text is likely a food item
   * @param {string} text - Text to check
   * @returns {boolean} True if likely a food item
   */
  isLikelyFoodItem(text) {
    const foodKeywords = [
      'fresh', 'organic', 'frozen', 'dried', 'canned', 'bottled',
      'chicken', 'beef', 'pork', 'fish', 'meat', 'vegetable', 'fruit',
      'milk', 'cheese', 'bread', 'rice', 'oil', 'spice', 'sauce'
    ];

    const name = text.toLowerCase();
    return foodKeywords.some(keyword => name.includes(keyword)) || 
           text.length > 3 && text.length < 30; // Reasonable length for food items
  }

  /**
   * Get default expiry date based on category
   * @param {string} category - Item category
   * @returns {string} Default expiry date (YYYY-MM-DD)
   */
  getDefaultExpiryDate(category) {
    const today = new Date();
    let daysToAdd = 30; // Default 30 days

    const expiryMap = {
      'Meat': 3,
      'Dairy': 7,
      'Vegetables': 7,
      'Beverages': 30,
      'Grains': 365,
      'Spices': 730,
      'Oils': 365
    };

    daysToAdd = expiryMap[category] || 30;
    
    const expiryDate = new Date(today);
    expiryDate.setDate(today.getDate() + daysToAdd);
    
    return expiryDate.toISOString().split('T')[0];
  }

  /**
   * Utility function to add delay
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise} Promise that resolves after delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Process multiple images in batch
   * @param {Array} images - Array of image inputs
   * @param {Object} options - OCR options
   * @returns {Promise<Array>} Array of OCR results
   */
  async processBatch(images, options = {}) {
    console.log(`🔄 Processing batch of ${images.length} images...`);
    
    const results = [];
    const batchSize = 3; // Process 3 images at a time to avoid rate limits
    
    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize);
      const batchPromises = batch.map(image => this.processImage(image, options));
      
      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
        
        // Add delay between batches to respect rate limits
        if (i + batchSize < images.length) {
          await this.delay(2000); // 2 second delay between batches
        }
      } catch (error) {
        console.error(`❌ Error processing batch starting at index ${i}:`, error);
        // Continue with next batch even if current batch fails
      }
    }
    
    console.log(`✅ Batch processing completed. ${results.length} results.`);
    return results;
  }

  /**
   * Validate Google Vision API key
   * @returns {Promise<boolean>} True if API key is valid
   */
  async validateApiKey() {
    try {
      console.log('🔑 Validating Google Vision API key with test image...');
      const rawBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      
      // Make direct API call to validate key without expecting text
      const requestBody = {
        requests: [
          {
            image: {
              content: rawBase64
            },
            features: [
              {
                type: 'TEXT_DETECTION'
              }
            ]
          }
        ]
      };
      
      const apiResult = await this.makeVisionAPIRequest(requestBody);
      
      // Check if we got a valid response structure (even if no text detected)
      const isValid = apiResult && 
                     apiResult.responses && 
                     Array.isArray(apiResult.responses) &&
                     !apiResult.responses[0]?.error;
      
      console.log(`🔍 API key validation result: ${isValid ? 'VALID' : 'INVALID'}`);
      if (isValid) {
        console.log('✅ Google Vision API key is working correctly');
      } else if (apiResult.responses?.[0]?.error) {
        console.log('❌ Vision API error:', apiResult.responses[0].error);
      }
      
      return isValid;
    } catch (error) {
      console.error('❌ Google Vision API key validation failed:', error);
      return false;
    }
  }

  /**
   * Get API usage statistics (if available)
   * @returns {Promise<Object>} Usage statistics
   */
  async getUsageStats() {
    // Google Vision API doesn't provide a direct usage endpoint through this service
    // Users can check usage in Google Cloud Console
    return {
      message: 'Usage statistics available in Google Cloud Console',
      apiKey: this.apiKey ? this.apiKey.substring(0, 16) + '...' : 'Not configured',
      timestamp: new Date().toISOString(),
      service: 'Google Vision API'
    };
  }
}

module.exports = OCRService;