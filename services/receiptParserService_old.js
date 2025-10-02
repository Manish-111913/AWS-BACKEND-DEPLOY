const { spawn } = require('child_process');
const path = require('path');
const RobustTranslationService = require('./RobustTranslationService');

class ReceiptParserService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.pythonPath = 'python'; // or 'python3' depending on system
    this.parserScript = path.join(__dirname, 'receipt_parser_pro.py'); // Use new professional parser
    
    // Remove translation service for now as requested
    // this.translationService = new RobustTranslationService(apiKey, apiKey);
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
        console.log(`� Extracted ${result.items?.length || 0} items`);
        
        // Add additional metadata
        return {
          ...result,
          parsed_by: 'gemini-pro',
          timestamp: new Date().toISOString()
        };
      } else {
        console.log('❌ Python parser failed:', result.error);
        return result;
      }
      
    } catch (error) {
      console.error('❌ Receipt parsing error:', error);
      return {
        success: false,
        error: `Receipt parsing failed: ${error.message}`,
        success: false,
        error: `Receipt parsing failed: ${error.message}`,
        items: []
      };
    }
  }

  /**
   * Run the Python parser and return the result
   */
  async runPythonParser(ocrText, forceEnglish = false) {
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
        resolve({
          success: false,
          error: 'Failed to start Python parser',
          details: error.message,
          items: []
        });
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
   * Translate regional language text to English and parse it
   */
  async translateAndParse(regionalText, sourceLanguage) {
    try {
      console.log('🔄 Translating regional language text to English...');
      
      // Translate the text using robust translation service
      const translationResult = await this.translationService.translateText(regionalText, {
        validate: true, // Enable cross-validation
        targetLanguage: 'en'
      });

      if (!translationResult.success) {
        console.error('❌ Translation failed:', translationResult.error);
        return {
          success: false,
          error: translationResult.error,
          translatedText: null,
          items: []
        };
      }

      console.log(`✅ Translation successful using ${translationResult.method}`);
      console.log(`🎯 Confidence: ${(translationResult.confidence * 100).toFixed(1)}%`);
      
      if (translationResult.validation) {
        console.log(`🔍 Validation: ${translationResult.validation.validated ? 'PASSED' : 'FAILED'} (${(translationResult.validation.similarity * 100).toFixed(1)}% similarity)`);
      }

      // Parse the translated English text using the Python parser
      console.log('📝 Parsing translated English text...');
      const parseResult = await this.parseTranslatedText(translationResult.translatedText);

      return {
        success: true,
        translatedText: translationResult.translatedText,
        originalText: regionalText,
        sourceLanguage: sourceLanguage,
        confidence: translationResult.confidence,
        method: translationResult.method,
        validated: translationResult.validation?.validated || false,
        similarity: translationResult.validation?.similarity || 0,
        items: parseResult.items || [],
        summary: parseResult.summary,
        parseSuccess: parseResult.success
      };

    } catch (error) {
      console.error('❌ Translation and parsing error:', error);
      return {
        success: false,
        error: `Translation and parsing failed: ${error.message}`,
        translatedText: null,
        items: []
      };
    }
  }

  /**
   * Parse translated English text to extract items
   */
  async parseTranslatedText(englishText) {
    console.log('🐍 Parsing translated text with Python parser...');
    return this.runPythonParser(englishText, true); // Use force-english flag
  }
}

module.exports = ReceiptParserService;