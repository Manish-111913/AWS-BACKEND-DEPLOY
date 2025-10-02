const { Translate } = require('@google-cloud/translate').v2;
const { GoogleGenerativeAI } = require('@google/generative-ai');

class RobustTranslationService {
    constructor(apiKey, geminiApiKey) {
        // Google Translate API (Primary translation method) - handle missing API gracefully
        try {
            this.translator = new Translate({
                key: apiKey,
                projectId: process.env.GOOGLE_CLOUD_PROJECT_ID || 'auto-detect'
            });
            this.translateApiAvailable = true;
        } catch (error) {
            console.log('🔧 Google Translate API not configured, using Gemini AI only');
            this.translator = null;
            this.translateApiAvailable = false;
        }
        
        // Gemini AI (Fallback and context validation)
        this.genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;
        this.geminiModel = this.genAI ? this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" }) : null;
        
        // Supported languages for high-accuracy translation
        this.supportedLanguages = {
            'te': 'Telugu',
            'hi': 'Hindi', 
            'ta': 'Tamil',
            'kn': 'Kannada',
            'ml': 'Malayalam',
            'gu': 'Gujarati',
            'bn': 'Bengali',
            'or': 'Odia',
            'pa': 'Punjabi',
            'mr': 'Marathi'
        };
        
        // Regional script Unicode ranges for detection
        this.scriptRanges = {
            telugu: { start: 0x0C00, end: 0x0C7F, code: 'te' },
            hindi: { start: 0x0900, end: 0x097F, code: 'hi' },
            tamil: { start: 0x0B80, end: 0x0BFF, code: 'ta' },
            kannada: { start: 0x0C80, end: 0x0CFF, code: 'kn' },
            malayalam: { start: 0x0D00, end: 0x0D7F, code: 'ml' },
            gujarati: { start: 0x0A80, end: 0x0AFF, code: 'gu' },
            bengali: { start: 0x0980, end: 0x09FF, code: 'bn' },
            odia: { start: 0x0B00, end: 0x0B7F, code: 'or' },
            punjabi: { start: 0x0A00, end: 0x0A7F, code: 'pa' },
            marathi: { start: 0x0900, end: 0x097F, code: 'hi' } // Uses Devanagari script
        };
    }

    /**
     * Detect the language of the given text
     */
    detectLanguage(text) {
        const cleanText = text.trim();
        if (!cleanText) return null;

        // Count characters in each script
        const scriptCounts = {};
        let totalChars = 0;

        for (const char of cleanText) {
            const charCode = char.charCodeAt(0);
            totalChars++;

            for (const [scriptName, range] of Object.entries(this.scriptRanges)) {
                if (charCode >= range.start && charCode <= range.end) {
                    scriptCounts[scriptName] = (scriptCounts[scriptName] || 0) + 1;
                    break;
                }
            }
        }

        // Find the dominant script (threshold: 10% of characters)
        const threshold = Math.max(1, Math.floor(totalChars * 0.1));
        
        for (const [scriptName, count] of Object.entries(scriptCounts)) {
            if (count >= threshold) {
                return {
                    language: scriptName,
                    code: this.scriptRanges[scriptName].code,
                    confidence: count / totalChars,
                    totalChars,
                    scriptChars: count
                };
            }
        }

        return null; // English or unsupported language
    }

    /**
     * Primary translation using Google Translate API
     */
    async translateWithGoogleAPI(text, sourceLanguage, targetLanguage = 'en') {
        if (!this.translateApiAvailable || !this.translator) {
            return {
                success: false,
                error: 'Google Translate API not available',
                method: 'google-translate-api'
            };
        }

        try {
            console.log(`🌐 Translating with Google Translate API: ${sourceLanguage} → ${targetLanguage}`);
            
            const [translation] = await this.translator.translate(text, {
                from: sourceLanguage,
                to: targetLanguage
            });

            // Get confidence score from the API if available
            const [detection] = await this.translator.detect(text);
            const confidence = detection.confidence || 0.95; // Default high confidence

            return {
                success: true,
                translatedText: translation,
                originalText: text,
                sourceLanguage,
                targetLanguage,
                confidence,
                method: 'google-translate-api',
                detectedLanguage: detection.language
            };
        } catch (error) {
            console.error('❌ Google Translate API error:', error.message);
            return {
                success: false,
                error: error.message,
                method: 'google-translate-api'
            };
        }
    }

    /**
     * Fallback translation using Gemini AI with context awareness
     */
    async translateWithGeminiAI(text, sourceLanguage, targetLanguage = 'en') {
        if (!this.geminiModel) {
            return { success: false, error: 'Gemini AI not available', method: 'gemini-ai' };
        }

        try {
            console.log(`🤖 Translating with Gemini AI: ${sourceLanguage} → ${targetLanguage}`);
            
            const languageName = this.supportedLanguages[sourceLanguage] || sourceLanguage;
            
            const prompt = `
You are a professional translator specializing in Indian regional languages and receipt/invoice translation.

TASK: Translate the following ${languageName} text from a receipt/invoice to English.

REQUIREMENTS:
1. Maintain exact meaning - no interpretation or reformatting
2. Preserve item names, quantities, and prices accurately
3. Keep numerical values exactly as they appear
4. Translate item names but preserve brand names when appropriate
5. Maintain receipt structure and formatting

IMPORTANT: This is from a receipt/invoice, so accuracy is critical for inventory management.

TEXT TO TRANSLATE:
${text}

RESPONSE FORMAT: Provide only the English translation, maintaining the same structure and line breaks.
`;

            const result = await this.geminiModel.generateContent(prompt);
            const translatedText = result.response.text();

            return {
                success: true,
                translatedText: translatedText.trim(),
                originalText: text,
                sourceLanguage,
                targetLanguage,
                confidence: 0.85, // Slightly lower confidence than Google Translate
                method: 'gemini-ai',
                contextAware: true
            };
        } catch (error) {
            console.error('❌ Gemini AI translation error:', error.message);
            return {
                success: false,
                error: error.message,
                method: 'gemini-ai'
            };
        }
    }

    /**
     * Validate translation quality by cross-checking with alternative method
     */
    async validateTranslation(originalResult, text, sourceLanguage) {
        try {
            // Use the alternative method for validation
            const validationMethod = originalResult.method === 'google-translate-api' ? 'gemini-ai' : 'google-translate-api';
            
            let validationResult;
            if (validationMethod === 'gemini-ai') {
                validationResult = await this.translateWithGeminiAI(text, sourceLanguage);
            } else {
                validationResult = await this.translateWithGoogleAPI(text, sourceLanguage);
            }

            if (!validationResult.success) {
                return { validated: false, reason: 'Validation method failed' };
            }

            // Simple similarity check (could be enhanced with more sophisticated algorithms)
            const similarity = this.calculateSimilarity(
                originalResult.translatedText.toLowerCase(),
                validationResult.translatedText.toLowerCase()
            );

            return {
                validated: similarity > 0.7, // 70% similarity threshold
                similarity,
                validationMethod,
                validationTranslation: validationResult.translatedText,
                reason: similarity > 0.7 ? 'High similarity between methods' : 'Low similarity - possible translation discrepancy'
            };
        } catch (error) {
            return { validated: false, reason: `Validation error: ${error.message}` };
        }
    }

    /**
     * Calculate basic similarity between two strings
     */
    calculateSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;
        
        if (longer.length === 0) return 1.0;
        
        const editDistance = this.levenshteinDistance(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    /**
     * Calculate Levenshtein distance between two strings
     */
    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    /**
     * Main translation method with robust fallback and validation
     */
    async translateText(text, options = {}) {
        try {
            console.log('🔄 Starting robust translation process...');
            
            // Detect language
            const detection = this.detectLanguage(text);
            if (!detection) {
                return {
                    success: false,
                    error: 'No regional language detected - text appears to be in English or unsupported language',
                    originalText: text
                };
            }

            console.log(`🔍 Detected language: ${detection.language} (${detection.code}) with ${(detection.confidence * 100).toFixed(1)}% confidence`);

            if (!this.supportedLanguages[detection.code]) {
                return {
                    success: false,
                    error: `Language ${detection.language} (${detection.code}) is not supported`,
                    detection
                };
            }

            const targetLanguage = options.targetLanguage || 'en';
            let primaryResult, fallbackResult;

            // Try primary method (Google Translate API)
            primaryResult = await this.translateWithGoogleAPI(text, detection.code, targetLanguage);
            
            if (primaryResult.success) {
                console.log('✅ Primary translation (Google Translate) successful');
                
                // Validate translation if validation is enabled
                if (options.validate !== false) {
                    console.log('🔍 Validating translation...');
                    const validation = await this.validateTranslation(primaryResult, text, detection.code);
                    primaryResult.validation = validation;
                    
                    if (!validation.validated) {
                        console.log('⚠️ Translation validation failed - using both results');
                    }
                }
                
                return {
                    ...primaryResult,
                    detection,
                    robust: true
                };
            }

            // Fallback to Gemini AI
            console.log('🔄 Primary method failed, trying Gemini AI fallback...');
            fallbackResult = await this.translateWithGeminiAI(text, detection.code, targetLanguage);
            
            if (fallbackResult.success) {
                console.log('✅ Fallback translation (Gemini AI) successful');
                return {
                    ...fallbackResult,
                    detection,
                    robust: true,
                    fallbackUsed: true,
                    primaryError: primaryResult.error
                };
            }

            // Both methods failed
            return {
                success: false,
                error: 'All translation methods failed',
                primaryError: primaryResult.error,
                fallbackError: fallbackResult.error,
                detection,
                originalText: text
            };

        } catch (error) {
            console.error('❌ Translation service error:', error);
            return {
                success: false,
                error: `Translation service error: ${error.message}`,
                originalText: text
            };
        }
    }

    /**
     * Check service health and API availability
     */
    async checkHealth() {
        const health = {
            googleTranslate: false,
            geminiAI: false,
            overall: false
        };

        try {
            // Test Google Translate
            const testResult = await this.translateWithGoogleAPI('Hello', 'en', 'hi');
            health.googleTranslate = testResult.success;
        } catch (error) {
            console.log('Google Translate health check failed:', error.message);
        }

        try {
            // Test Gemini AI
            if (this.geminiModel) {
                const testResult = await this.translateWithGeminiAI('Hello', 'en', 'hi');
                health.geminiAI = testResult.success;
            }
        } catch (error) {
            console.log('Gemini AI health check failed:', error.message);
        }

        health.overall = health.googleTranslate || health.geminiAI;
        return health;
    }
}

module.exports = RobustTranslationService;