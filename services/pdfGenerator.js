const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

class PDFGenerator {
    static async generatePurchaseOrderPDF(orderData) {
        try {
            const {
                poNumber,
                businessInfo,
                vendorInfo,
                orderDate,
                deliveryDate,
                items,
                orderNotes,
                fromNumber = '8919997308' // Default from number
            } = orderData;

            // Create PDF document with better page settings
            const doc = new PDFDocument({ 
                margin: 40,
                size: 'A4',
                layout: 'portrait'
            });
            
            // Generate filename
            const fileName = `PO_${poNumber}_${Date.now()}.pdf`;
            const filePath = path.join(__dirname, '../uploads/purchase_orders', fileName);
            
            // Ensure directory exists
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            // Pipe PDF to file
            doc.pipe(fs.createWriteStream(filePath));
            
            // Helper function to add header on each page
            const addHeader = (pageNumber = 1) => {
                // Header with border
                doc.rect(40, 40, 515, 60).stroke();
                
                // Main title
                doc.fontSize(22).fillColor('#2c3e50').text('PURCHASE ORDER', 50, 55, { align: 'center' });
                
                // PO details in header
                doc.fontSize(10).fillColor('#000')
                    .text(`PO Number: ${poNumber}`, 420, 50)
                    .text(`Date: ${new Date(orderDate).toLocaleDateString()}`, 420, 65)
                    
            };
            
            // Helper function to add footer
            const addFooter = () => {
                const footerY = doc.page.height - 60;
                doc.fontSize(8).fillColor('#666')
                    .text('This is a computer-generated purchase order.', 40, footerY, { align: 'center' })
                    .text(`Generated on: ${new Date().toLocaleString()}`, 40, footerY + 12, { align: 'center' });
            };
            
            // Helper function to check if we need a new page
            const checkNewPage = (currentY, requiredSpace = 50) => {
                if (currentY + requiredSpace > doc.page.height - 80) {
                    doc.addPage();
                    addHeader(Math.ceil((doc.bufferedPageRange().count || 1)));
                    return 120; // Return new starting Y position
                }
                return currentY;
            };
            
            // Start first page
            addHeader();
            let yPosition = 120;
            
            // Business and Vendor Info in a table layout
            doc.rect(40, yPosition, 515, 80).stroke();
            
            // Business Info
            doc.fontSize(12).fillColor('#2c3e50').text('FROM:', 50, yPosition + 10);
            doc.fontSize(10).fillColor('#000')
                .text(businessInfo.name || 'Business Name', 50, yPosition + 25)
                .text(businessInfo.address || 'Business Address', 50, yPosition + 38)
                .text(`Phone: ${fromNumber}`, 50, yPosition + 51);
            
            // Vendor Info
            doc.fontSize(12).fillColor('#2c3e50').text('TO:', 300, yPosition + 10);
            doc.fontSize(10).fillColor('#000')
                .text(vendorInfo.name || 'Vendor Name', 300, yPosition + 25)
                .text(vendorInfo.address || 'Vendor Address', 300, yPosition + 38)
                .text(`Phone: ${vendorInfo.phone || 'N/A'}`, 300, yPosition + 51);
            
            yPosition += 100;
            yPosition = checkNewPage(yPosition, 80);
            
            // Order Details Section
            doc.fontSize(14).fillColor('#2c3e50').text('ORDER DETAILS:', 40, yPosition);
            yPosition += 25;
            
            // Enhanced Table Headers
            const tableTop = yPosition;
            const col1X = 50;  // S.No
            const col2X = 80;  // Item Name
            const col3X = 350; // Quantity
            const col4X = 430; // Unit
            const col5X = 480; // Price (if available)
            // Table header background
            doc.rect(40, tableTop, 515, 25).fillAndStroke('#f8f9fa', '#ddd');
            // Table headers
            doc.fontSize(11).fillColor('#2c3e50')
                .text('S.No', col1X, tableTop + 8)
                .text('Item ', col2X, tableTop + 8)
                .text('Quantity', col3X, tableTop + 8)
                .text('Unit', col4X, tableTop + 8);
            // Add price column if any item has unit price
            const hasPrice = items.some(item => item.unitPrice && item.unitPrice > 0);
            if (hasPrice) {
                doc.text('Price', col5X, tableTop + 8);
            }
            yPosition = tableTop + 25;
            
            // Table Rows with alternating colors
            let totalAmount = 0;
            items.forEach((item, index) => {
                yPosition = checkNewPage(yPosition, 25);
                // Alternating row colors
                if (index % 2 === 0) {
                    doc.rect(40, yPosition, 515, 20).fillAndStroke('#fafafa', '#eee');
                } else {
                    doc.rect(40, yPosition, 515, 20).stroke('#eee');
                }
                const serialNumber = (index + 1).toString().padStart(2, '0');
                const quantityWithUnit = `${(item.orderQuantity || 0)}`.trim();
                const unit = item.unit || 'units';
                const itemPrice = item.unitPrice || 0;
                const lineTotal = (item.orderQuantity || 0) * itemPrice;
                totalAmount += lineTotal;
                // Row data
                doc.fontSize(10).fillColor('#000')
                    .text(serialNumber, col1X, yPosition + 6)
                    .text(item.name || 'Item Name', col2X, yPosition + 6, { width: 260, ellipsis: true })
                    .text(quantityWithUnit, col3X, yPosition + 6)
                    .text(unit, col4X, yPosition + 6);
                if (hasPrice && itemPrice > 0) {
                    doc.text(`₹${itemPrice.toFixed(2)}`, col5X, yPosition + 6);
                }
                yPosition += 20;
            });
            
            // Table footer
            doc.rect(40, yPosition, 515, 1).fillAndStroke('#000');
            yPosition += 10;
            // Order Summary (no total pages, no category-based line)
            if (hasPrice && totalAmount > 0) {
                yPosition = checkNewPage(yPosition, 40);
                doc.fontSize(12).fillColor('#2c3e50')
                    .text(`Total Items: ${items.length}`, 350, yPosition)
                    .text(`Total Amount: ₹${totalAmount.toFixed(2)}`, 350, yPosition + 15);
                yPosition += 40;
            } else {
                doc.fontSize(12).fillColor('#2c3e50')
                    .text(`Total Items: ${items.length}`, 350, yPosition);
                yPosition += 30;
            }
            
            // ...special instructions removed...
            
            // Terms and Conditions
            yPosition = checkNewPage(yPosition, 80);
            doc.fontSize(12).fillColor('#2c3e50').text('TERMS & CONDITIONS:', 40, yPosition);
            yPosition += 20;
            
            const terms = [
                '1. Please confirm receipt of this purchase order',
                '3. All items should meet quality standards as per previous orders',
                '4. Payment terms: As per existing agreement',
                '5. Contact us immediately for any clarifications'
            ];
            
            doc.fontSize(9).fillColor('#000');
            terms.forEach(term => {
                doc.text(term, 50, yPosition);
                yPosition += 12;
            });
            
            // Add footer to all pages
            const pageCount = doc.bufferedPageRange().count || 1;
            for (let i = 0; i < pageCount; i++) {
                if (i > 0) {
                    doc.switchToPage(i);
                }
                addFooter();
            }
            // Finalize PDF and wait for completion
            return new Promise((resolve, reject) => {
                doc.end();
                doc.on('end', () => {
                    // Add small delay to ensure file is written
                    setTimeout(() => {
                        resolve({
                            success: true,
                            filePath,
                            fileName,
                            totalItems: items.length
                        });
                    }, 100);
                });
                doc.on('error', (error) => {
                    reject(error);
                });
            });
            
        } catch (error) {
            console.error('PDF Generation Error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = PDFGenerator;
