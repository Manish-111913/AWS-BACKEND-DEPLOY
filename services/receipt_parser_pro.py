#!/usr/bin/env python3
"""
Professional Receipt Parser using Google Gemini Pro
Handles complex wholesale invoices, retail receipts, and business transactions.
Focuses on accurate item extraction with pricing, quantities, and tax handling.
"""

import json
import re
import sys
import os
from typing import List, Dict, Any, Optional, Union
from datetime import datetime, timedelta
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ProfessionalReceiptParser:
    def __init__(self, api_key: str):
        """Initialize with Google API key for Gemini Pro"""
        self.model = None
        if api_key:
            try:
                import google.generativeai as genai
                genai.configure(api_key=api_key)
                # Use Gemini Pro for better accuracy
                self.model = genai.GenerativeModel('gemini-1.5-pro')
                logger.info("Gemini Pro model initialized successfully")
            except Exception as e:
                logger.error(f"Failed to initialize Gemini Pro: {e}")
                raise
        else:
            raise ValueError("API key is required for Gemini Pro parser")
        
        # Standard business categories
        self.categories = {
            'grains_flour': ['maida', 'flour', 'wheat', 'rice', 'rava', 'sooji', 'atta'],
            'spices_condiments': ['haldi', 'turmeric', 'chilli', 'powder', 'garam', 'masala', 'jeera', 'cumin'],
            'pulses_dals': ['dal', 'chana', 'toor', 'besan', 'gram'],
            'oils_fats': ['palm oil', 'cooking oil', 'ghee'],
            'dairy_products': ['milk', 'butter', 'paneer', 'cheese'],
            'sweeteners': ['sugar', 'jaggery', 'gur'],
            'snacks_ready': ['namkeen', 'mixture', 'palli', 'nuts'],
            'beverages': ['tea', 'coffee', 'drinks'],
            'household_items': ['soap', 'detergent', 'cleaning'],
            'vegetables': ['onion', 'potato', 'tomato', 'garlic', 'ginger'],
            'other': ['transport', 'delivery', 'service']
        }

    def parse_receipt(self, ocr_text: str) -> Dict[str, Any]:
        """
        Parse receipt text using Gemini Pro with professional prompting
        """
        try:
            if not ocr_text or not ocr_text.strip():
                return {
                    "success": False,
                    "error": "Empty OCR text provided",
                    "items": []
                }

            logger.info("Starting professional receipt parsing with Gemini Pro")
            
            # Clean and prepare text
            cleaned_text = self._clean_text(ocr_text)
            
            # Generate response using Gemini Pro
            gemini_result = self._parse_with_gemini_pro(cleaned_text)
            
            if gemini_result and gemini_result.get('success'):
                logger.info(f"Successfully extracted {len(gemini_result.get('items', []))} items")
                return gemini_result
            else:
                return {
                    "success": False,
                    "error": "Gemini Pro parsing failed",
                    "items": []
                }
                
        except Exception as e:
            logger.error(f"Receipt parsing failed: {str(e)}")
            return {
                "success": False,
                "error": f"Parsing error: {str(e)}",
                "items": []
            }

    def _clean_text(self, text: str) -> str:
        """Clean and normalize text for processing"""
        if not text:
            return ""
        
        # Remove excessive whitespace but preserve structure
        lines = [line.strip() for line in text.split('\n')]
        cleaned = '\n'.join(line for line in lines if line)
        
        # Limit text length to avoid token limits
        max_length = 8000
        if len(cleaned) > max_length:
            cleaned = cleaned[:max_length] + "...[TRUNCATED]"
            
        return cleaned

    def _parse_with_gemini_pro(self, text: str) -> Dict[str, Any]:
        """Parse using Gemini Pro with professional prompt"""
        try:
            prompt = f"""
You are a professional invoice and receipt parsing AI system. Your task is to extract structured item data from business receipts, wholesale invoices, and retail bills with maximum accuracy.

RECEIPT/INVOICE TEXT:
{text}

PARSING INSTRUCTIONS:

1. IDENTIFY RECEIPT TYPE:
   - Wholesale invoice (with HSN codes, bulk quantities, discounts)
   - Retail receipt (simple item-price format)
   - Tax invoice (with CGST/SGST/IGST)

2. EXTRACT ITEMS ACCURATELY:
   - Item name (clean, without codes/suffixes)
   - Actual quantity purchased
   - Unit of measurement (KG, GM, LTR, PC, etc.)
   - Unit price (price per unit before discounts)
   - Total price (final amount after all discounts)
   - Tax percentage if applicable
   - HSN/SAC code if present

3. HANDLE DISCOUNTS PROPERLY:
   - If you see "**DISCOUNT** (-350.00)" after an item, this is a discount amount
   - Calculate: Final Price = Original Price - Discount Amount
   - Use the discounted price as total_price

4. IGNORE NON-ITEMS:
   - Store details, headers, footers
   - Tax summaries, totals, payment details
   - Transport charges, delivery fees
   - Credit/debit details

5. QUANTITY EXTRACTION RULES:
   - For "SHALIMAR MAIDA 50 KG-KG" with "1.000" → quantity: 50, unit: "KG"
   - For "SWAS CHILLI POWDER 500 GM-PC" with "10.000" → quantity: 10, unit: "PC" (packets)
   - For weight-based items: extract the weight from item name or quantity field
   - For count-based items: use the quantity number directly

6. PRICE EXTRACTION:
   - Find the rate/price per unit
   - Apply any discounts shown
   - Use final calculated amount as total_price

7. CATEGORIZATION:
   - Assign appropriate business category
   - Use: grains_flour, spices_condiments, pulses_dals, oils_fats, dairy_products, sweeteners, snacks_ready, beverages, household_items, vegetables, other

RESPONSE FORMAT - RETURN ONLY VALID JSON:
{{
    "success": true,
    "receipt_type": "wholesale|retail|tax_invoice",
    "vendor_name": "extracted_vendor_name",
    "total_amount": total_invoice_amount,
    "items": [
        {{
            "item_name": "Clean item name without codes",
            "quantity": numeric_quantity,
            "unit": "standardized_unit",
            "unit_price": price_per_unit,
            "total_price": final_amount_after_discounts,
            "tax_rate": tax_percentage_or_0,
            "hsn_code": "hsn_code_if_present",
            "category": "appropriate_category",
            "confidence": 0.8_to_1.0
        }}
    ]
}}

CRITICAL REQUIREMENTS:
- Extract ALL legitimate items (ignore headers/footers)
- Handle discounts correctly in calculations
- Use proper units (KG, GM, LTR, PC, BOX, etc.)
- Ensure quantity × unit_price ≈ total_price (after discounts)
- Return only valid JSON, no explanations

Parse the above receipt/invoice now:
"""

            response = self.model.generate_content(prompt)
            response_text = response.text.strip()
            
            # Clean and parse JSON response
            json_response = self._extract_json_from_response(response_text)
            
            if json_response:
                # Validate and enhance the response
                return self._validate_and_enhance_response(json_response)
            else:
                raise ValueError("Invalid JSON response from Gemini Pro")
                
        except Exception as e:
            logger.error(f"Gemini Pro parsing error: {str(e)}")
            return {
                "success": False,
                "error": f"Gemini Pro error: {str(e)}",
                "items": []
            }

    def _extract_json_from_response(self, response_text: str) -> Optional[Dict]:
        """Extract JSON from Gemini response"""
        try:
            # Remove code blocks and extra text
            response_text = re.sub(r'```json\s*', '', response_text)
            response_text = re.sub(r'```\s*', '', response_text)
            response_text = response_text.strip()
            
            # Find JSON object
            start_idx = response_text.find('{')
            end_idx = response_text.rfind('}')
            
            if start_idx != -1 and end_idx != -1:
                json_str = response_text[start_idx:end_idx + 1]
                return json.loads(json_str)
            else:
                # Try parsing entire response
                return json.loads(response_text)
                
        except json.JSONDecodeError as e:
            logger.error(f"JSON parsing error: {e}")
            logger.error(f"Response text: {response_text[:500]}...")
            return None

    def _validate_and_enhance_response(self, data: Dict) -> Dict[str, Any]:
        """Validate and enhance the parsed response"""
        try:
            if not isinstance(data, dict) or not data.get('items'):
                return {
                    "success": False,
                    "error": "Invalid response format",
                    "items": []
                }
            
            validated_items = []
            
            for item in data.get('items', []):
                if self._is_valid_item(item):
                    enhanced_item = self._enhance_item(item)
                    validated_items.append(enhanced_item)
            
            return {
                "success": True,
                "receipt_type": data.get('receipt_type', 'unknown'),
                "vendor_name": data.get('vendor_name', ''),
                "total_amount": data.get('total_amount', 0),
                "items": validated_items,
                "extracted_count": len(validated_items)
            }
            
        except Exception as e:
            logger.error(f"Validation error: {str(e)}")
            return {
                "success": False,
                "error": f"Validation error: {str(e)}",
                "items": []
            }

    def _is_valid_item(self, item: Dict) -> bool:
        """Validate if item has required fields"""
        required_fields = ['item_name', 'quantity', 'unit_price', 'total_price']
        return all(field in item and item[field] is not None for field in required_fields)

    def _enhance_item(self, item: Dict) -> Dict[str, Any]:
        """Enhance item with additional processing"""
        # Ensure numeric fields are properly typed
        item['quantity'] = float(item.get('quantity', 0))
        item['unit_price'] = float(item.get('unit_price', 0))
        item['total_price'] = float(item.get('total_price', 0))
        item['tax_rate'] = float(item.get('tax_rate', 0))
        item['confidence'] = float(item.get('confidence', 0.8))
        
        # Standardize unit
        item['unit'] = self._standardize_unit(item.get('unit', ''))
        
        # Enhance category
        if not item.get('category') or item['category'] == 'other':
            item['category'] = self._categorize_item(item['item_name'])
        
        return item

    def _standardize_unit(self, unit: str) -> str:
        """Standardize unit of measurement"""
        unit_mappings = {
            'kg': 'kg', 'kilogram': 'kg', 'kilo': 'kg',
            'gm': 'gm', 'gram': 'gm', 'g': 'gm',
            'ltr': 'ltr', 'litre': 'ltr', 'liter': 'ltr', 'l': 'ltr',
            'pc': 'pc', 'piece': 'pc', 'pieces': 'pc', 'pcs': 'pc',
            'box': 'box', 'packet': 'packet', 'pack': 'packet'
        }
        
        unit_lower = unit.lower().strip()
        return unit_mappings.get(unit_lower, unit_lower)

    def _categorize_item(self, item_name: str) -> str:
        """Categorize item based on name"""
        item_lower = item_name.lower()
        
        for category, keywords in self.categories.items():
            for keyword in keywords:
                if keyword in item_lower:
                    return category
        
        return 'other'


def main():
    """Main function for command-line usage"""
    try:
        # Get API key from environment
        api_key = os.getenv('GOOGLE_API_KEY') or os.getenv('GOOGLE_VISION_API_KEY')
        
        if not api_key:
            print(json.dumps({
                "success": False,
                "error": "Google API key not found in environment variables"
            }))
            sys.exit(1)
        
        # Read OCR text from stdin or command line argument
        if len(sys.argv) > 1:
            ocr_text = sys.argv[1]
        else:
            ocr_text = sys.stdin.read()
        
        if not ocr_text.strip():
            print(json.dumps({
                "success": False,
                "error": "No OCR text provided"
            }))
            sys.exit(1)
        
        # Initialize parser and process
        parser = ProfessionalReceiptParser(api_key)
        result = parser.parse_receipt(ocr_text)
        
        # Output result as JSON
        print(json.dumps(result, indent=2, ensure_ascii=False))
        
    except Exception as e:
        error_result = {
            "success": False,
            "error": f"Parser initialization failed: {str(e)}"
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()