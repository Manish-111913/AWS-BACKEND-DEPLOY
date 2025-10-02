const path = require('path');
const { spawn } = require('child_process');
const OCRService = require('../utils/OCR');

class SalesReportOCRService extends OCRService {
    constructor() {
        super();
        this.pythonParser = path.join(__dirname, 'sales_report_parser.py');
    }

    /**
     * Process a sales report image and extract sales data
     * @param {Buffer|string} imageInput - Image buffer or file path
     * @param {Object} options - OCR processing options
     * @returns {Promise<Object>} Processed sales report data
     */
    async processSalesReport(imageInput, options = {}) {
        try {
            console.log('🔍 Starting sales report OCR processing...');
            
            let ocrResult;
            
            // If imageInput is a file path, convert to base64 (same as stock-in)
            if (typeof imageInput === 'string' && require('fs').existsSync(imageInput)) {
                console.log('📁 Converting file to base64 for OCR...');
                const fs = require('fs');
                const fileBuffer = fs.readFileSync(imageInput);
                const mimeType = 'image/jpeg'; // Default mime type
                const dataUri = `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
                
                ocrResult = await this.processImage(dataUri, {
                    ...options,
                    mode: options.mode || 'auto'
                });
            } else {
                // Direct processing for buffer or data URI
                ocrResult = await this.processImage(imageInput, {
                    ...options,
                    mode: options.mode || 'auto'
                });
            }

            if (!ocrResult.success) {
                console.log('❌ OCR extraction failed:', ocrResult.error);
                throw new Error(ocrResult.error || 'OCR processing failed');
            }

            console.log('✅ OCR extraction completed, text length:', ocrResult.rawText?.length || 0);
            
            // Now parse the OCR text using our Python parser
            console.log('🐍 Attempting Python parser...');
            const salesData = await this.parseSalesReport(ocrResult.rawText);
            
            if (salesData && salesData.items) {
                console.log(`✅ Python parser succeeded, extracted ${salesData.items.length} items`);
            } else {
                console.log('⚠️ Python parser returned no items');
            }

            return {
                success: true,
                salesData,
                rawText: ocrResult.rawText,
                confidence: ocrResult.confidence
            };

        } catch (error) {
            console.error('❌ Sales report processing error:', error);
            return {
                success: false,
                error: error.message,
                salesData: null,
                rawText: null
            };
        }
    }

    /**
     * Parse extracted text using Python parser
     * @param {string} text - OCR extracted text
     * @returns {Promise<Object>} Parsed sales data
     */
    async parseSalesReport(text) {
        return new Promise((resolve, reject) => {
            const pythonProcess = spawn('python', [this.pythonParser], {
                env: {
                    ...process.env,
                    GOOGLE_API_KEY: process.env.GOOGLE_VISION_API_KEY
                }
            });

            let outputData = '';
            let errorData = '';

            pythonProcess.stdout.on('data', (data) => {
                outputData += data;
            });

            pythonProcess.stderr.on('data', (data) => {
                errorData += data;
            });

            pythonProcess.stdin.write(text);
            pythonProcess.stdin.end();

            pythonProcess.on('close', (code) => {
                if (code !== 0) {
                    console.error('❌ Python parser error (exit code ' + code + '):', errorData);
                    reject(new Error('Failed to parse sales report'));
                    return;
                }

                try {
                    const parsedData = JSON.parse(outputData);
                    console.log('✅ Python parser completed successfully');
                    resolve(parsedData);
                } catch (error) {
                    console.error('❌ Failed to parse Python JSON output:', error);
                    console.error('Raw output:', outputData);
                    reject(error);
                }
            });
        });
    }

    /**
     * Process a batch of sales report images
     * @param {Array<Buffer|string>} imageInputs - Array of image buffers or file paths
     * @param {Object} options - OCR processing options
     * @returns {Promise<Array<Object>>} Array of processed sales reports
     */
    async processBatchSalesReports(imageInputs, options = {}) {
        const results = await Promise.all(
            imageInputs.map(input => this.processSalesReport(input, options))
        );

        // Aggregate results
        const successfulResults = results.filter(r => r.success);
        const failedResults = results.filter(r => !r.success);

        return {
            success: failedResults.length === 0,
            processedCount: successfulResults.length,
            failedCount: failedResults.length,
            results: results,
            aggregatedData: this.aggregateReports(successfulResults)
        };
    }

    /**
     * Aggregate data from multiple sales reports
     * @param {Array<Object>} reports - Array of successful sales report results
     * @returns {Object} Aggregated sales data
     */
    aggregateReports(reports) {
        const aggregated = {
            total_revenue: 0,
            total_items_sold: 0,
            sales_by_category: {},
            payment_methods: {
                cash: 0,
                card: 0
            },
            servers: new Set(),
            date_range: {
                start: null,
                end: null
            }
        };

        reports.forEach(report => {
            if (!report.salesData) return;

            const { summary, sales_by_category, servers = [] } = report.salesData;

            // Aggregate summary data
            aggregated.total_revenue += summary.total_revenue || 0;
            aggregated.total_items_sold += summary.total_items_sold || 0;

            // Aggregate payment methods
            if (summary.payment_methods) {
                aggregated.payment_methods.cash += summary.payment_methods.cash || 0;
                aggregated.payment_methods.card += summary.payment_methods.card || 0;
            }

            // Aggregate sales by category
            Object.entries(sales_by_category).forEach(([category, sales]) => {
                if (!aggregated.sales_by_category[category]) {
                    aggregated.sales_by_category[category] = [];
                }
                aggregated.sales_by_category[category].push(...sales);
            });

            // Add unique servers
            servers.forEach(server => aggregated.servers.add(server));

            // Update date range
            if (summary.date) {
                const reportDate = new Date(summary.date);
                if (!aggregated.date_range.start || reportDate < aggregated.date_range.start) {
                    aggregated.date_range.start = reportDate;
                }
                if (!aggregated.date_range.end || reportDate > aggregated.date_range.end) {
                    aggregated.date_range.end = reportDate;
                }
            }
        });

        // Convert Set to Array for servers
        aggregated.servers = Array.from(aggregated.servers);

        return aggregated;
    }
}

module.exports = SalesReportOCRService;