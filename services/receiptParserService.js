const { spawn } = require('child_process');
const path = require('path');

class ReceiptParserService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    // Try multiple Python executable names
    this.pythonPath = process.env.PYTHON_PATH || 'python3'; 
    this.parserScript = path.join(__dirname, 'receipt_parser.py'); // Use the existing parser script
  }

  async parseReceipt(ocrText) {
    try {
      if (!this.apiKey) {
        return {
          success: false,
          error: 'API key not provided',
          items: []
        };
      }

      console.log('🐍 Starting Python parser with Gemini Pro...');
      
      // Use the professional parser directly
      const result = await this.runPythonParser(ocrText);
      
      if (result.success) {
        console.log('✅ Python parser completed successfully');
        console.log(`📦 Extracted ${result.items?.length || 0} items`);
        
        // Add additional metadata
        return {
          ...result,
          parsed_by: 'gemini-pro',
          timestamp: new Date().toISOString()
        };
      } else {
        console.log('❌ Python parser failed:', result.error);
        
        // If Python is not available, return a graceful fallback response
        if (result.fallback_required) {
          console.log('🔄 Returning graceful fallback response for deployment environment');
          return {
            success: true,
            items: this._extractBasicItemsFromText(ocrText),
            parsed_by: 'javascript-fallback',
            note: 'Using JavaScript fallback parser (Python not available in deployment)',
            timestamp: new Date().toISOString()
          };
        }
        
        return result;
      }
      
    } catch (error) {
      console.error('❌ Receipt parsing error:', error);
      return {
        success: false,
        error: `Receipt parsing failed: ${error.message}`,
        items: []
      };
    }
  }

  /**
   * Run the Python parser and return the result
   */
  async runPythonParser(ocrText) {
    return new Promise((resolve, reject) => {
      // Set environment variables for the Python process
      const env = { 
        ...process.env, 
        GOOGLE_API_KEY: this.apiKey,
        GOOGLE_VISION_API_KEY: this.apiKey
      };

      const pythonProcess = spawn(this.pythonPath, [this.parserScript], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: env
      });

      let stdout = '';
      let stderr = '';

      // Send OCR text to Python process via stdin
      pythonProcess.stdin.write(ocrText);
      pythonProcess.stdin.end();

      pythonProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      pythonProcess.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            console.log('✅ Python parser completed successfully');
            resolve(result);
          } catch (parseError) {
            console.error('❌ Failed to parse Python output:', parseError);
            resolve({
              success: false,
              error: 'Failed to parse parser output',
              items: [],
              raw_output: stdout
            });
          }
        } else {
          console.error('❌ Python parser failed with code:', code);
          console.error('Python stderr:', stderr);
          resolve({
            success: false,
            error: `Python parser failed with code ${code}`,
            details: stderr,
            items: []
          });
        }
      });

      pythonProcess.on('error', (error) => {
        console.error('❌ Failed to spawn Python process:', error);
        // Check if this is a "Python not found" error
        if (error.code === 'ENOENT') {
          console.log('🔄 Python not found in deployment environment. This is expected in AWS Lambda.');
          resolve({
            success: false,
            error: 'Python runtime not available in deployment environment',
            details: 'Python parser disabled - using JavaScript fallback',
            items: [],
            fallback_required: true
          });
        } else {
          resolve({
            success: false,
            error: 'Failed to start Python parser',
            details: error.message,
            items: []
          });
        }
      });

      // Set timeout for Python process
      setTimeout(() => {
        pythonProcess.kill();
        resolve({
          success: false,
          error: 'Python parser timeout after 30 seconds',
          items: []
        });
      }, 30000);
    });
  }

  /**
   * JavaScript fallback parser for when Python is not available
   * @param {string} ocrText - Raw OCR text
   * @returns {Array} Array of basic extracted items
   */
  _extractBasicItemsFromText(ocrText) {
    try {
      const lines = ocrText.split('\n').filter(line => line.trim().length > 0);
      const items = [];
      
      for (const line of lines) {
        const trimmed = line.trim();
        
        // Skip common non-item lines
        if (this._isSkippableLine(trimmed)) {
          continue;
        }
        
        // Try to extract item information using regex patterns
        const item = this._parseLineForItem(trimmed);
        if (item) {
          items.push(item);
        }
      }
      
      console.log(`📦 JavaScript fallback parser extracted ${items.length} items`);
      return items;
      
    } catch (error) {
      console.error('❌ JavaScript fallback parser error:', error);
      return [];
    }
  }

  /**
   * Check if a line should be skipped during parsing
   */
  _isSkippableLine(line) {
    const skipPatterns = [
      /^(total|subtotal|tax|gst|amount|bill|invoice|date|time)\b/i,
      /^[\-\=\*]{3,}$/, // separator lines
      /^\d{1,2}\/\d{1,2}\/\d{2,4}/, // dates
      /^thank\s+you/i,
      /^[\s]*$/
    ];
    
    return skipPatterns.some(pattern => pattern.test(line));
  }

  /**
   * Parse a single line to extract item information
   */
  _parseLineForItem(line) {
    // Pattern: Item - Quantity x Price = Total
    let match = line.match(/([A-Za-z\s\-\.]+?)\s*[-–]\s*(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*=\s*(\d+\.?\d*)/);
    if (match) {
      return {
        item_name: match[1].trim(),
        quantity: parseFloat(match[2]),
        unit: 'pieces',
        unit_price: parseFloat(match[3]),
        total_price: parseFloat(match[4]),
        category: 'other',
        confidence: 0.7
      };
    }
    
    // Pattern: Item - Weight - Price
    match = line.match(/([A-Za-z\s\-\.]+?)\s*[-–]\s*(\d+\.?\d*)\s*(kg|g|gm|l|ltr|ml)\s*[-–]\s*(\d+\.?\d*)/);
    if (match) {
      const quantity = parseFloat(match[2]);
      const price = parseFloat(match[4]);
      return {
        item_name: match[1].trim(),
        quantity: quantity,
        unit: match[3].toLowerCase(),
        unit_price: price / quantity,
        total_price: price,
        category: 'other',
        confidence: 0.8
      };
    }
    
    // Pattern: Item - Quantity - Price
    match = line.match(/([A-Za-z\s\-\.]+?)\s*[-–]\s*(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*)/);
    if (match) {
      const quantity = parseFloat(match[2]);
      const price = parseFloat(match[3]);
      return {
        item_name: match[1].trim(),
        quantity: quantity,
        unit: 'pieces',
        unit_price: price / quantity,
        total_price: price,
        category: 'other',
        confidence: 0.6
      };
    }
    
    return null;
  }
}

module.exports = ReceiptParserService;