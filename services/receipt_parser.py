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
        }
        
        # Enhanced patterns for various receipt formats
        self.item_patterns = [
            # Standard format: Item Quantity Price
            r'([A-Za-z\s\-\.]+?)\s*[-–]\s*(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*=\s*(\d+\.?\d*)',
            r'([A-Za-z\s\-\.]+?)\s+(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*=\s*(\d+\.?\d*)',
            r'([A-Za-z\s\-\.]+?)\s+(\d+\.?\d*)\s+(kg|g|gm|gram|l|ltr|liter|pcs?|pieces?)\s+(\d+\.?\d*)',
            r'([A-Za-z\s\-\.]+?)\s+(\d+\.?\d*)\s*\$?(\d+\.?\d*)',
            
            # Handwritten patterns with dimensions
            r'(\d+)\s*x\s*(\d+)\s*[-–]\s*([A-Za-z\s]+)\s*[-–]\s*(\d+\.?\d*)',
            r'([A-Za-z\s]+)\s*[-–]\s*(\d+)\s*x\s*(\d+\.?\d*)\s*=\s*(\d+\.?\d*)',
            
            # Weight-based patterns
            r'([A-Za-z\s]+)\s*[-–]\s*(\d+\.?\d*)\s*(kg|g|gm|gram)\s*[-–]\s*(\d+\.?\d*)',
            r'(\d+\.?\d*)\s*(kg|g|gm|gram)\s*[-–]\s*([A-Za-z\s]+)\s*[-–]\s*(\d+\.?\d*)',
            
            # Volume-based patterns
            r'([A-Za-z\s]+)\s*[-–]\s*(\d+\.?\d*)\s*(ml|l|ltr|liter)\s*[-–]\s*(\d+\.?\d*)',
            r'(\d+\.?\d*)\s*(ml|l|ltr|liter)\s*[-–]\s*([A-Za-z\s]+)\s*[-–]\s*(\d+\.?\d*)',
            
            # Simple quantity patterns
            r'([A-Za-z\s]+)\s*[-–]\s*(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*)',
        ]
        
        # Enhanced unit mappings
        self.unit_mappings = {
            'kg': 'kg', 'kilogram': 'kg', 'kilo': 'kg', 'kilos': 'kg',
            'g': 'gram', 'gm': 'gram', 'gram': 'gram', 'grams': 'gram',
            'l': 'liter', 'ltr': 'liter', 'liter': 'liter', 'litre': 'liter', 'litres': 'liter',
            'ml': 'ml', 'milliliter': 'ml', 'millilitre': 'ml',
            'pcs': 'pieces', 'pc': 'pieces', 'piece': 'pieces', 'pieces': 'pieces',
            'dozen': 'dozen', 'dz': 'dozen',
            'packet': 'packet', 'pack': 'packet', 'pkt': 'packet',
            'box': 'box', 'boxes': 'box',
            'bottle': 'bottle', 'btl': 'bottle',
            'can': 'can', 'cans': 'can'
        }

    def detect_regional_language(self, text: str) -> str:
        """Detect if text contains regional languages (Telugu, Tamil, Hindi, etc.)"""
        try:
            if not text:
                return 'english'
            
            # Count characters in each script
            script_counts = {}
            total_chars = 0
            
            for char in text:
                char_code = ord(char)
                total_chars += 1
                
                # Check each regional script
                for script_name, (start, end) in self.regional_scripts.items():
                    if start <= char_code <= end:
                        script_counts[script_name] = script_counts.get(script_name, 0) + 1
                        break
            
            # If more than 10% of characters are from a regional script, consider it regional
            if total_chars > 0:
                for script_name, count in script_counts.items():
                    if count / total_chars > 0.1:  # 10% threshold
                        logger.info(f"Detected regional language: {script_name} ({count}/{total_chars} chars)")
                        return script_name
            
            return 'english'
            
        except Exception as e:
            logger.warning(f"Language detection failed: {e}")
            return 'english'

    # ---------------- Deterministic (Regex/Heuristic) Parsing ---------------- #
    def _approx_equal(self, a: float, b: float, rel: float = 0.02, abs_tol: float = 0.5) -> bool:
        """Return True if a and b are approximately equal within ratio/absolute tolerances."""
        try:
            if a == 0 or b == 0:
                return abs(a - b) <= abs_tol
            return abs(a - b) <= max(abs(a), abs(b)) * rel or abs(a - b) <= abs_tol
        except Exception:
            return False

    def _deterministic_parse_items(self, ocr_text: str) -> List[Dict[str, Any]]:
        """Primary deterministic parser.

        Goals:
        - Handle lines like "Chicken - 2 x 140 = 280" or "2 x 140 = 280".
        - Handle dimension quantity lines: "5x6 - Parel Sheet - 180".
        - Handle column style receipts with headers (ITEM/QTY/RATE/AMOUNT etc.).
        - Handle weight lines: "Tomatoes 1.25kg 45.00" or "Tomatoes - 1.25kg - 45".
        - Be resilient to stray currency symbols and spacing.
        """
        items: List[Dict[str, Any]] = []
        added_keys = set()
        # Preserve original order for context-aware second pass
        raw_lines = ocr_text.splitlines()
        lines = [l.strip() for l in raw_lines if l and l.strip()]

        if not lines:
            return []

        # Detect if a header line exists for column style receipts
        header_index = -1
        header_tokens = {'item', 'qty', 'quantity', 'rate', 'price', 'amount', 'total'}
        for idx, line in enumerate(lines[:10]):
            token_hits = sum(1 for t in header_tokens if re.search(rf"\b{t}\b", line, re.IGNORECASE))
            if token_hits >= 3:
                header_index = idx
                break

        # Precompile patterns
        mult_pattern = re.compile(r'^(?:(?P<name>[A-Za-z][A-Za-z0-9 /&\-\(\)]*?)\s*[-:])?\s*(?P<q>\d+(?:\.\d+)?)\s*[xX*]\s*(?P<p>\d+(?:\.\d+)?)\s*=\s*(?P<t>\d+(?:\.\d+)?)(?:\s|$)')
        # Bare multiplication with no name (handled with previous line association)
        bare_mult_pattern = re.compile(r'^(?P<q>\d+(?:\.\d+)?)\s*[xX*]\s*(?P<p>\d+(?:\.\d+)?)\s*=\s*(?P<t>\d+(?:\.\d+)?)(?:\s|$)')
        dimension_pattern = re.compile(r'^(?P<a>\d+)\s*[xX]\s*(?P<b>\d+)\s*[-: ]+?(?P<name>[A-Za-z][A-Za-z0-9 /&\-\(\)]*?)\s*[-: ]+?(?P<price>\d+(?:\.\d+)?)$')
        weight_pattern = re.compile(r'^(?P<name>[A-Za-z][A-Za-z0-9 /&\-\(\)]*?)\s+(?P<qty>\d+(?:\.\d+)?)(?P<unit>kg|kgs?|g|gm|grams?|ml|l|ltr)\b.*?(?P<price>\d+(?:\.\d+)?)(?:\s|$)', re.IGNORECASE)

        skip_line = re.compile(r'^(total|subtotal|tax|cash|change|thank|balance|date|time|invoice|bill)\b', re.IGNORECASE)
        currency_cleanup = re.compile(r'[₹$€£]')

        prev_non_empty = None
        for raw_line in lines:
            line = currency_cleanup.sub('', raw_line).strip()
            # Normalize trailing lone decimal points (e.g. 280.)
            line = re.sub(r'(\d+)\.(?=\s|$)', r'\1', line)
            if not line or len(line) < 3:
                continue
            if skip_line.search(line):
                continue
            # Straight multiplication pattern
            m = mult_pattern.match(line)
            if m:
                name = m.group('name') or 'Unknown Item'
                quantity = float(m.group('q'))
                unit_price = float(m.group('p'))
                total = float(m.group('t'))
                # Basic sanity: quantity * unit_price ≈ total
                if not self._approx_equal(quantity * unit_price, total):
                    # If mismatch but still plausible keep (some receipts misprint totals)
                    pass
                item = {
                    'item_name': name.strip(),
                    'quantity': quantity,
                    'unit': 'pieces',
                    'unit_price': unit_price,
                    'total_price': total,
                    'confidence': 0.95
                }
                key = (item['item_name'].lower(), item['quantity'], item['unit_price'])
                if key not in added_keys:
                    items.append(self._enhance_item(item))
                    added_keys.add(key)
                prev_non_empty = raw_line
                continue

            # Bare multiplication line referencing previous description
            m = bare_mult_pattern.match(line)
            if m and prev_non_empty and re.search(r'[A-Za-z]', prev_non_empty) and not re.search(r'\d+\s*[xX*]\s*\d+', prev_non_empty):
                name = prev_non_empty.strip().strip('-:')
                quantity = float(m.group('q'))
                unit_price = float(m.group('p'))
                total = float(m.group('t'))
                item = {
                    'item_name': name,
                    'quantity': quantity,
                    'unit': 'pieces',
                    'unit_price': unit_price,
                    'total_price': total,
                    'confidence': 0.9
                }
                key = (item['item_name'].lower(), item['quantity'], item['unit_price'])
                if key not in added_keys:
                    items.append(self._enhance_item(item))
                    added_keys.add(key)
                prev_non_empty = raw_line
                continue

            # Dimension pattern (e.g., 5x6 - Parel Sheet - 180)
            m = dimension_pattern.match(line)
            if m:
                a = float(m.group('a'))
                b = float(m.group('b'))
                quantity = a * b
                price = float(m.group('price'))
                item = {
                    'item_name': f"{m.group('name').strip()} ({int(a)}x{int(b)})",
                    'quantity': quantity,
                    'unit': 'pieces',
                    'unit_price': price / quantity if quantity > 0 else price,
                    'total_price': price,
                    'confidence': 0.9
                }
                key = (item['item_name'].lower(), item['quantity'], item['unit_price'])
                if key not in added_keys:
                    items.append(self._enhance_item(item))
                    added_keys.add(key)
                prev_non_empty = raw_line
                continue

            # Weight pattern
            m = weight_pattern.match(line)
            if m:
                qty = float(m.group('qty'))
                unit_raw = m.group('unit').lower().rstrip('s')
                unit_norm = self.unit_mappings.get(unit_raw, unit_raw)
                price = float(m.group('price'))
                item = {
                    'item_name': m.group('name').strip(),
                    'quantity': qty,
                    'unit': unit_norm,
                    'unit_price': price / qty if qty > 0 else price,
                    'total_price': price,
                    'confidence': 0.85
                }
                key = (item['item_name'].lower(), item['quantity'], round(item['unit_price'], 4))
                if key not in added_keys:
                    items.append(self._enhance_item(item))
                    added_keys.add(key)
                prev_non_empty = raw_line
                continue

            # Column style or generic numeric trailing tokens
            # Extract last 3 numeric tokens if present
            nums = re.findall(r'(\d+(?:\.\d+)?)', line)
            if len(nums) >= 3:
                # Consider last three only to avoid picking date fragments etc.
                a, b, c = map(float, nums[-3:])
                product_match = self._approx_equal(a * b, c)
                if product_match:
                    # Remove trailing numbers from description
                    desc = re.sub(r'(\d+(?:\.\d+)?\s*){3}$', '', line).strip('-: ')
                    # If description still contains header artifacts skip
                    if not desc or skip_line.search(desc.lower()):
                        continue
                    # Heuristic: smaller of a,b is quantity (often) if one < 20 and not price-like
                    if a <= 20 and (b > a or not b <= 20):
                        quantity, unit_price, total = a, b, c
                    elif b <= 20:
                        quantity, unit_price, total = b, a, c
                    else:
                        # Fallback: treat a as quantity
                        quantity, unit_price, total = a, b, c
                    item = {
                        'item_name': desc,
                        'quantity': quantity,
                        'unit': 'pieces',
                        'unit_price': unit_price,
                        'total_price': total,
                        'confidence': 0.8
                    }
                    key = (item['item_name'].lower(), item['quantity'], item['unit_price'])
                    if key not in added_keys and quantity > 0 and unit_price > 0:
                        items.append(self._enhance_item(item))
                        added_keys.add(key)
        # end for
        return items

    def parse_with_gemini(self, ocr_text: str) -> List[Dict[str, Any]]:
        """Enhanced Gemini AI parsing with better context understanding"""
        try:
            if not self.model:
                raise RuntimeError("Gemini model unavailable")
            # Clean and prepare text
            cleaned_text = self._preprocess_text(ocr_text)
            
            # Truncate if too long
            max_text_length = 8000
            if len(cleaned_text) > max_text_length:
                cleaned_text = cleaned_text[:max_text_length] + "..."
            
            prompt = f"""
            You are an expert receipt parser with deep understanding of various receipt formats including handwritten ones in multiple languages.
            
            RECEIPT TEXT TO PARSE:
            {cleaned_text}
            
            LANGUAGE SUPPORT:
            - You can read and understand text in Telugu (తెలుగు), Hindi (हिन्दी), Tamil (தமிழ்), English, and other Indian languages
            - Preserve original script/language in item names - DO NOT translate
            - Recognize common Indian grocery items in various languages
            - Understand regional measurement units and currency formats
            
            PARSING INSTRUCTIONS:
            **OCR CORRECTION FIRST**: Before parsing, correct common OCR errors:
            - "LOOS" or "L005" or "L00S" → "LOOSE"
            - "TOOR" or "T00R" or "T0OR" → "TUR" (as in Tur Dal)
            - "AJINOMATO" → "AJINOMOTO"
            - Numbers like "0" might be misread as "O", correct appropriately
            
            **CRITICAL - UNDERSTAND RECEIPT FORMAT**: This receipt uses a columnar format:
            - Line 1: Item Description (e.g., "UAMA LOOS")
            - Line 2: Rate (price per unit) then Qty (quantity) (e.g., "290.00 0.526")  
            - Line 3: Amount (total price) (e.g., "152.54")
            
            **PARSING RULES FOR THIS FORMAT**:
            1. Look for pattern: Item name on one line, then "Rate Qty" on next line, then "Amount" on third line
            2. Extract: item_name from first line, unit_price from Rate, quantity from Qty, total_price from Amount
            3. For "UAMA LOOS / 290.00 0.526 / 152.54" extract:
               - item_name: "Uama Loose" 
               - unit_price: 290.00
               - quantity: 0.526
               - total_price: 152.54
            4. Always verify: quantity × unit_price ≈ total_price
            
            1. Extract ALL grocery/retail items with their details
            2. Handle various formats:
               - "Item - Quantity x Price = Total" (మామిడి x 20 x 50 = 1000)
               - "Quantity x Price - Item" 
               - "Item - Weight/Volume - Price"
               - "Dimensions (like 5x6) - Item - Price"
               - Simple "Item - Quantity - Price"
            3. For unclear handwriting, use context clues and language patterns
            4. Common Indian items: రైస్/चावल/Rice, దాల్/दाल/Dal, వేడుকలు/सब्जी/Vegetables
            5. Common abbreviations: kg=kilogram, g/gm=gram, l/ltr=liter, pcs=pieces
            6. If you see calculations like "2 x 140 = 280", extract: quantity=2, unit_price=140
            7. For items with dimensions (like "5x6"), treat as quantity and include in item name
            8. Ignore store details, totals, dates, taxes
            9. Keep item names in original script (తెలుగు/हिन्दी/English) - DO NOT translate
            10. Always include category based on item type
            11. Recognize Telugu/Hindi number patterns and calculations
            12. Weight patterns like "1Kg", "250gm" should be parsed as quantities with units
            
            RETURN FORMAT - ONLY JSON ARRAY:
            [
                {{
                    "item_name": "Clean item name",
                    "quantity": numeric_quantity,
                    "unit": "standardized_unit",
                    "unit_price": price_per_unit,
                    "total_price": total_amount,
                    "category": "estimated_category",
                    "confidence": confidence_score_0_to_1
                }}
            ]
            
            EXAMPLE FOR "Chicken - 2 x 140 = 280":
            [
                {{
                    "item_name": "Chicken",
                    "quantity": 2.0,
                    "unit": "kg",
                    "unit_price": 140.0,
                    "total_price": 280.0,
                    "category": "meat_seafood",
                    "confidence": 0.9
                }}
            ]
            
            EXAMPLE FOR COLUMNAR FORMAT "UAMA LOOS / 290.00 0.526 / 152.54":
            [
                {{
                    "item_name": "Uama Loose",
                    "quantity": 0.526,
                    "unit": "kg",
                    "unit_price": 290.0,
                    "total_price": 152.54,
                    "category": "pulses",
                    "confidence": 0.9
                }}
            ]
            
            EXAMPLE FOR Telugu "మామిడి x 20 x 50 = 1000":
            [
                {{
                    "item_name": "మామిడి",
                    "quantity": 20.0,
                    "unit": "pieces",
                    "unit_price": 50.0,
                    "total_price": 1000.0,
                    "category": "fruits",
                    "confidence": 0.85
                }}
            ]
            
            Return ONLY the JSON array:
            """
            
            response = self.model.generate_content(prompt)
            response_text = response.text.strip()
            
            # Clean response
            response_text = self._clean_json_response(response_text)
            
            # Parse JSON
            items = json.loads(response_text)
            
            # Validate and enhance items
            validated_items = []
            for item in items:
                if self._validate_enhanced_item(item):
                    validated_items.append(self._enhance_item(item))
            
            return validated_items
            
        except Exception as e:
            logger.error(f"Gemini parsing failed: {e}")
            return self._enhanced_fallback_parse(ocr_text)

    def _preprocess_text(self, text: str) -> str:
        """Clean and preprocess OCR text"""
        # Remove extra whitespace
        text = re.sub(r'\s+', ' ', text)
        
        # Fix common OCR errors
        corrections = {
            'lOg': '10g', 'l0g': '10g', 'O': '0', 'S': '5',
            'B': '8', 'G': '6', 'I': '1', 'Z': '2'
        }
        
        for wrong, right in corrections.items():
            text = text.replace(wrong, right)
        
        return text.strip()

    def _clean_json_response(self, response_text: str) -> str:
        """Clean Gemini response to extract valid JSON"""
        # Remove markdown formatting
        if '```json' in response_text:
            response_text = response_text.split('```json')[1].split('```')[0]
        elif '```' in response_text:
            response_text = response_text.split('```')[1]
        
        # Find JSON array bounds
        start = response_text.find('[')
        end = response_text.rfind(']') + 1
        
        if start != -1 and end != 0:
            response_text = response_text[start:end]
        
        return response_text.strip()


    def _validate_enhanced_item(self, item: Dict) -> bool:
        """Validate enhanced item structure"""
        required_fields = ['item_name', 'quantity', 'unit', 'unit_price']
        
        # Check required fields exist
        for field in required_fields:
            if field not in item or item[field] is None:
                return False
        
        # Check data types
        try:
            float(item['quantity'])
            float(item['unit_price'])
        except (ValueError, TypeError):
            return False
        
        # Item name should not be empty
        if not str(item['item_name']).strip():
            return False
        
        return True

    def _enhance_item(self, item: Dict) -> Dict:
        """Enhance and standardize item data"""
        # Clean item name
        item['item_name'] = self._clean_item_name(str(item['item_name']))
        
        # Ensure numeric values
        item['quantity'] = float(item['quantity'])
        item['unit_price'] = float(item['unit_price'])
        
        # Calculate total if not provided
        if 'total_price' not in item or item['total_price'] is None:
            item['total_price'] = item['quantity'] * item['unit_price']
        else:
            item['total_price'] = float(item.get('total_price', 0))
        
        # Standardize unit
        item['unit'] = self._standardize_unit(str(item.get('unit', 'pieces')))
        
        # Add category if not provided
        if 'category' not in item:
            item['category'] = self._categorize_item(item['item_name'])
        
        # Add confidence if not provided
        if 'confidence' not in item:
            item['confidence'] = 0.8
        
        # Add expiry estimation
        item['estimated_expiry'] = self._get_default_expiry(item['category'])
        
        return item

    def _clean_item_name(self, name: str) -> str:
        """Clean and standardize item names with OCR correction"""
        # Remove extra characters and whitespace
        name = re.sub(r'[^\w\s\-\.]', '', name)
        name = re.sub(r'\s+', ' ', name)
        name = name.strip().title()
        
        # OCR correction for common misreads
        ocr_corrections = {
            'Loos': 'Loose',
            'L005': 'Loose', 
            'L00S': 'Loose',
            'Loo5': 'Loose',
            'Lo0': 'Loose',  # Handle LO0 as well
            'Toor': 'Tur',  # Toor Dal -> Tur Dal
            'T00R': 'Tur',
            'T0OR': 'Tur',
            'Ajinomato': 'Ajinomoto',  # Brand name correction
        }
        
        # Apply OCR corrections (case-insensitive, whole word)
        for wrong, correct in ocr_corrections.items():
            # Use word boundaries to avoid partial replacements
            pattern = r'\b' + re.escape(wrong) + r'\b'
            name = re.sub(pattern, correct, name, flags=re.IGNORECASE)
        
        # Handle common naming issues
        name = name.replace('Kg', '').replace('Gm', '').replace('Ltr', '')
        name = name.replace('Pcs', '').replace('Pack', '').strip()
        
        return name

    def _standardize_unit(self, unit: str) -> str:
        """Standardize unit names"""
        unit_lower = unit.lower().strip()
        return self.unit_mappings.get(unit_lower, unit_lower)

    def _categorize_item(self, item_name: str) -> str:
        """Enhanced categorization with fuzzy matching"""
        item_lower = item_name.lower()
        
        # Direct keyword matching
        for category, keywords in self.categories.items():
            for keyword in keywords:
                if keyword in item_lower or item_lower in keyword:
                    return category
        
        # Fuzzy matching for partial matches
        for category, keywords in self.categories.items():
            for keyword in keywords:
                if any(part in item_lower for part in keyword.split()) or \
                   any(part in keyword for part in item_lower.split()):
                    return category
        
        return 'other'

    def _get_default_expiry(self, category: str) -> str:
        """Get estimated expiry date based on category"""
        days_map = {
            'meat_seafood': 3,
            'dairy_eggs': 7,
            'vegetables': 5,
            'fruits': 7,
            'grains_bakery': 30,
            'spices_condiments': 365,
            'beverages': 60,
            'household': 730,
            'snacks': 90,
            'kitchen_items': 3650,
            'other': 30
        }
        
        days = days_map.get(category, 30)
        expiry_date = datetime.now() + timedelta(days=days)
        return expiry_date.strftime('%Y-%m-%d')

    def _enhanced_fallback_parse(self, ocr_text: str) -> List[Dict[str, Any]]:
        """Enhanced regex-based parsing with multiple pattern attempts"""
        items = []
        lines = ocr_text.split('\n')
        
        for line in lines:
            line = line.strip()
            if not line or len(line) < 3:
                continue
                
            # Skip obvious non-item lines
            skip_patterns = [
                r'^(total|tax|bill|date|store|thank|subtotal)',
                r'^\d{1,2}/\d{1,2}/\d{2,4}',  # dates
                r'^[_\-=]{3,}',  # separators
                r'^\$?\d+\.?\d*$'  # standalone numbers
            ]
            
            if any(re.match(pattern, line, re.IGNORECASE) for pattern in skip_patterns):
                continue
            
            # Try enhanced patterns
            item = self._try_parse_line(line)
            if item:
                items.append(item)
        
        return items

    def _try_parse_line(self, line: str) -> Optional[Dict[str, Any]]:
        """Try to parse a single line with multiple patterns"""
        
        # Pattern 1: Multiplication format (Item - Quantity x Price = Total)
        match = re.search(r'([A-Za-z\s]+?)\s*[-–]\s*(\d+\.?\d*)\s*x\s*(\d+\.?\d*)\s*=\s*(\d+\.?\d*)', line, re.IGNORECASE)
        if match:
            return {
                'item_name': match.group(1).strip(),
                'quantity': float(match.group(2)),
                'unit': 'pieces',
                'unit_price': float(match.group(3)),
                'total_price': float(match.group(4)),
                'confidence': 0.9
            }
        
        # Pattern 2: Weight/Volume format
        match = re.search(r'([A-Za-z\s]+?)\s*[-–]\s*(\d+\.?\d*)\s*(kg|g|gm|l|ltr|ml)\s*[-–]\s*(\d+\.?\d*)', line, re.IGNORECASE)
        if match:
            return {
                'item_name': match.group(1).strip(),
                'quantity': float(match.group(2)),
                'unit': match.group(3).lower(),
                'unit_price': float(match.group(4)),
                'total_price': float(match.group(2)) * float(match.group(4)),
                'confidence': 0.85
            }
        
        # Pattern 3: Simple format (Item - Quantity - Price)
        match = re.search(r'([A-Za-z\s]+?)\s*[-–]\s*(\d+\.?\d*)\s*[-–]\s*(\d+\.?\d*)', line, re.IGNORECASE)
        if match:
            return {
                'item_name': match.group(1).strip(),
                'quantity': float(match.group(2)),
                'unit': 'pieces',
                'unit_price': float(match.group(3)),
                'total_price': float(match.group(2)) * float(match.group(3)),
                'confidence': 0.7
            }
        
        # Pattern 4: Dimension format (5x6 - Item - Price)
        match = re.search(r'(\d+)\s*x\s*(\d+)\s*[-–]\s*([A-Za-z\s]+?)\s*[-–]\s*(\d+\.?\d*)', line, re.IGNORECASE)
        if match:
            quantity = float(match.group(1)) * float(match.group(2))
            return {
                'item_name': f"{match.group(3).strip()} ({match.group(1)}x{match.group(2)})",
                'quantity': quantity,
                'unit': 'pieces',
                'unit_price': float(match.group(4)) / quantity if quantity > 0 else float(match.group(4)),
                'total_price': float(match.group(4)),
                'confidence': 0.8
            }
        
        return None

    # ---------------- Vendor Extraction ---------------- #
    def extract_vendor_info(self, ocr_text: str) -> Dict[str, Optional[str]]:
        """Extract vendor name and optional phone from raw OCR text.

        Heuristics:
        - Vendor name is typically in the top few lines and not a date/total/tax.
        - Prefer lines that look like store/firm names (e.g., Traders, Store, Mart).
        - Phone number is matched via label keywords or by 10-13 digit patterns.
        """
        name = self._extract_vendor_name(ocr_text)
        phone = self._extract_phone_number(ocr_text)
        return {"name": name, "phone": phone}

    def _extract_vendor_name(self, ocr_text: str) -> Optional[str]:
        """Best-effort extraction of vendor/store name from the first lines.

        Strategy:
        1) Score top lines with store-like heuristics.
        2) If no candidate, take the line immediately above a GST/GSTIN/GSTN line.
        3) Prefer UPPERCASE short names without amounts/dates.
        """
        try:
            lines_raw = [l for l in ocr_text.splitlines()]
            lines = [l.strip() for l in lines_raw if l and l.strip()]
            if not lines:
                return None

            blacklist = re.compile(
                r"\b(invoice|bill|receipt|date|time|gst|gstin|gstn|vat|tax|subtotal|total|amount|balance|cash|card|thank|qty|price|mrp|rate|no\.?|#)\b",
                re.IGNORECASE,
            )
            address_keywords = re.compile(
                r"\b(road|street|st\.|rd\.|lane|nagar|city|state|india|pincode|pin|zip|door|near|opp|dist|blk|sec|area|mandal|village)\b",
                re.IGNORECASE,
            )
            money_pattern = re.compile(r"(rs\.?|inr|usd|\$|€|£|\d+\.\d{2})", re.IGNORECASE)

            def score_line(line: str) -> int:
                s = 0
                if line.isupper():
                    s += 3
                if line.istitle():
                    s += 1
                nw = len(line.split())
                if 1 <= nw <= 6:
                    s += 2
                if re.search(r"(&|traders?|trading|store|stores|mart|market|super|supermarket|bazaar|bazar|provisions?|wholesale|retail|enterprises?|foods?|hotel|bakers?|bakery|kirana|departmental|dept)", line, re.IGNORECASE):
                    s += 3
                if re.search(r"\d", line):
                    s -= 1
                if blacklist.search(line) or address_keywords.search(line) or money_pattern.search(line):
                    s -= 3
                return s

            candidates: List[tuple] = []
            top_k = min(20, len(lines))
            for i in range(top_k):
                line = lines[i]
                if sum(c.isalpha() for c in line) < 3:
                    continue
                candidates.append((score_line(line), line))

            candidates = [c for c in candidates if c[0] > 0]
            if not candidates:
                # Fallback: pick the line above a GST line
                for idx, line in enumerate(lines):
                    if re.search(r"\bgst(in)?\b|\bgstn\b", line, re.IGNORECASE):
                        above = None
                        # Walk upwards to find a suitable name
                        for j in range(idx - 1, max(-1, idx - 5), -1):
                            if j < 0:
                                break
                            l = lines[j].strip(" -–|")
                            if not l or blacklist.search(l) or money_pattern.search(l):
                                continue
                            above = l
                            break
                        if above:
                            cleaned = re.sub(r"\s{2,}", " ", re.sub(r"[^\w\s&\.-]", "", above)).strip()
                            if cleaned:
                                return cleaned if cleaned.isupper() else cleaned.title()
                return None

            candidates.sort(key=lambda x: x[0], reverse=True)
            best = candidates[0][1].strip(" -–|")
            cleaned = re.sub(r"\s{2,}", " ", re.sub(r"[^\w\s&\.-]", "", best)).strip()
            if not cleaned:
                return None
            return cleaned if cleaned.isupper() else cleaned.title()
        except Exception:
            return None

    def _extract_phone_number(self, text: str) -> Optional[str]:
        """Extract a plausible phone number from the text if present."""
        try:
            label_pattern = re.compile(
                r"(phone|ph|tel|mobile|mob|contact|whatsapp)[:\s\-]*([+()\d][\d\s()\-+]{6,})",
                re.IGNORECASE,
            )
            m = label_pattern.search(text)
            raw = m.group(2) if m else None

            if not raw:
                # Fallback: generic digit chunks, filter for 10-13 digits
                generic = re.findall(r"(\+?\d[\d\s\-()]{9,})", text)
                for cand in generic:
                    digits = re.sub(r"\D", "", cand)
                    if 10 <= len(digits) <= 13:
                        raw = cand
                        break

            if not raw:
                return None

            digits = re.sub(r"\D", "", raw)
            # Normalize common cases
            if len(digits) == 10:
                return digits
            if len(digits) == 11 and digits.startswith("0"):
                return digits[1:]
            if len(digits) >= 12:
                # Prefer +91XXXXXXXXXX for Indian numbers
                if digits.startswith("91") and len(digits) >= 12:
                    return "+91" + digits[-10:]
                if digits.startswith("1") and len(digits) == 11:
                    return "+1" + digits[-10:]
                return "+" + digits
            return digits
        except Exception:
            return None

    def detect_regional_language(self, text: str) -> str:
        """Detect if text contains regional language scripts"""
        if not text:
            return 'english'
        
        # Count characters in each script
        script_counts = {}
        total_chars = 0
        
        for char in text:
            char_code = ord(char)
            total_chars += 1
            
            for script_name, (start, end) in self.regional_scripts.items():
                if start <= char_code <= end:
                    script_counts[script_name] = script_counts.get(script_name, 0) + 1
                    break
        
        if total_chars == 0:
            return 'english'
        
        # Find dominant script (threshold: 10% of total characters)
        threshold = max(1, total_chars * 0.1)
        
        for script_name, count in script_counts.items():
            if count >= threshold:
                return script_name
        
        return 'english'

    def _extract_vendor_info(self, text: str) -> Dict[str, Optional[str]]:
        """Extract vendor information from OCR text"""
        vendor_info = self.extract_vendor_info(text)
        return vendor_info

    def _extract_total_amount(self, text: str) -> Optional[float]:
        """Extract total amount from receipt text"""
        try:
            # Look for total patterns
            total_patterns = [
                r'total[:\s]*₹?(\d+\.?\d*)',
                r'grand\s*total[:\s]*₹?(\d+\.?\d*)',
                r'net\s*total[:\s]*₹?(\d+\.?\d*)',
                r'amount[:\s]*₹?(\d+\.?\d*)'
            ]
            
            for pattern in total_patterns:
                match = re.search(pattern, text, re.IGNORECASE)
                if match:
                    return float(match.group(1))
            
            return None
        except:
            return None

    def calculate_complementary_items(self, items: List[Dict]) -> Dict[str, int]:
        """Calculate complementary items based on breakfast items"""
        breakfast_items = [
            'dosa', 'idli', 'vada', 'utappam', 'rava', 'masala dosa', 
            'plain dosa', 'set dosa', 'onion dosa', 'pesarattu', 'upma'
        ]
        
        total_breakfast_quantity = 0
        
        for item in items:
            # Fix: Use 'item_name' field instead of 'name'
            item_name = item.get('item_name', '').lower()
            quantity = item.get('quantity', 0)
            
            # Check if item is a breakfast item
            for breakfast_item in breakfast_items:
                if breakfast_item in item_name:
                    total_breakfast_quantity += quantity
                    break
        
        # Calculate complementary items based on breakfast quantity
        # For every breakfast item, provide standard accompaniments
        complementary = {
            'groundnut_chutney': total_breakfast_quantity,
            'tomato_chutney': total_breakfast_quantity,
            'karam_podi': total_breakfast_quantity,
            'sambar': total_breakfast_quantity
        }
        
        return complementary

    def parse_receipt(self, ocr_text: str, include_metadata: bool = True) -> Dict[str, Any]:
        """Enhanced main parsing function with metadata and regional language preservation"""
        try:
            # Detect if this is a regional language receipt
            detected_language = self.detect_regional_language(ocr_text)
            
            # For regional languages (Telugu, Tamil, Hindi, etc.), preserve original text
            if detected_language != 'english':
                logger.info(f"Regional language detected: {detected_language}. Preserving original OCR text.")
                
                # Return original OCR text with minimal processing for regional languages
                result = {
                    'success': True,
                    'items': [],
                    'raw_ocr_text': ocr_text.strip(),
                    'language': detected_language,
                    'preserved_text': True,
                    'summary': {
                        'parsing_method': 'text_preservation',
                        'total_items': 0,
                        'language_detected': detected_language,
                        'note': 'Original OCR text preserved without AI formatting to maintain accuracy'
                    }
                }
                
                if include_metadata:
                    result.update({
                        'confidence': 1.0,  # High confidence for preservation
                        'timestamp': datetime.now().isoformat(),
                        'processing_time': 0.1,
                        'vendor_info': self._extract_vendor_info(ocr_text),
                        'total_amount': self._extract_total_amount(ocr_text)
                    })
                
                return result
            
            # For English text, proceed with normal parsing
            # 1. Try new deterministic parser first
            items = self._deterministic_parse_items(ocr_text)
            parsing_method = 'deterministic'

            # 2. If none found, try existing enhanced fallback regex patterns
            if not items:
                items = self._enhanced_fallback_parse(ocr_text)
                parsing_method = 'regex_fallback'

            # (Optional) 3. If still empty and Gemini model available, try AI (disabled by default)
            # Keeping code path simple: only invoke AI if both previous methods failed and model exists.
            if not items and self.model:
                ai_items = self.parse_with_gemini(ocr_text)
                if ai_items:
                    items = ai_items
                    parsing_method = 'gemini_ai'
            
            # Calculate complementary items
            complementary_items = self.calculate_complementary_items(items)
            
            # Extract vendor info
            vendor = self.extract_vendor_info(ocr_text)

            # Calculate summary statistics
            total_amount = sum(item.get('total_price', 0) for item in items)
            avg_confidence = sum(item.get('confidence', 0) for item in items) / len(items) if items else 0
            
            # Group by category
            category_summary = {}
            for item in items:
                category = item.get('category', 'other')
                if category not in category_summary:
                    category_summary[category] = {'count': 0, 'total_value': 0}
                category_summary[category]['count'] += 1
                category_summary[category]['total_value'] += item.get('total_price', 0)
            
            total_items = len(items)
            result = {
                'success': True,
                'items': items,
                'vendor': vendor,
                # Top-level fields for frontend compatibility
                'vendor_name': vendor.get('name'),
                'vendor_phone': vendor.get('phone'),
                'complementary_items': complementary_items,
                # Frequently accessed flattened fields
                'total_items': total_items,
                'parsing_method': parsing_method,
                'summary': {
                    'total_items': total_items,
                    'total_amount': round(total_amount, 2),
                    'average_confidence': round(avg_confidence, 2),
                    'parsing_method': parsing_method,
                    'categories': category_summary
                }
            }
            
            if include_metadata:
                result['metadata'] = {
                    'parsed_at': datetime.now().isoformat(),
                    'raw_text_length': len(ocr_text),
                    'unique_categories': len(category_summary),
                    'vendor_detected': bool(vendor.get('name')),
                    'phone_detected': bool(vendor.get('phone')),
                }
            
            return result
            
        except Exception as e:
            logger.error(f"Receipt parsing failed: {e}")
            return {
                'success': False,
                'error': str(e),
                'items': [],
                'summary': {
                    'total_items': 0,
                    'total_amount': 0,
                    'average_confidence': 0,
                    'parsing_method': 'failed'
                }
            }

def main():
    """Enhanced CLI interface"""
    try:
        if len(sys.argv) < 3:
            print("Usage: python receipt_parser.py <api_key> <ocr_text> [--include-metadata] [--force-english]")
            sys.exit(1)
        
        api_key = sys.argv[1]
        ocr_text = sys.argv[2]
        include_metadata = '--include-metadata' in sys.argv
        force_english = '--force-english' in sys.argv
        
        parser = EnhancedReceiptParser(api_key)
        
        # If force-english flag is set, bypass regional language detection
        if force_english:
            # Parse as English text without regional language preservation
            items = parser._deterministic_parse_items(ocr_text)
            parsing_method = 'deterministic'

            # If no items found, try regex fallback
            if not items:
                items = parser._enhanced_fallback_parse(ocr_text)
                parsing_method = 'regex_fallback'

            # If still no items and Gemini available, try AI
            if not items and parser.model:
                ai_items = parser.parse_with_gemini(ocr_text)
                if ai_items:
                    items = ai_items
                    parsing_method = 'gemini_ai'

            # Build result for translated English text
            vendor = parser.extract_vendor_info(ocr_text)
            total_amount = sum(item.get('total_price', 0) for item in items)
            avg_confidence = sum(item.get('confidence', 0) for item in items) / len(items) if items else 0

            result = {
                'success': True,
                'items': items,
                'vendor': vendor,
                'vendor_name': vendor.get('name'),
                'vendor_phone': vendor.get('phone'),
                'total_items': len(items),
                'parsing_method': parsing_method,
                'summary': {
                    'total_items': len(items),
                    'total_amount': round(total_amount, 2),
                    'average_confidence': round(avg_confidence, 2),
                    'parsing_method': parsing_method,
                    'translated_text': True
                }
            }
        else:
            # Normal parsing with regional language detection
            result = parser.parse_receipt(ocr_text, include_metadata)
        
        print(json.dumps(result, indent=2))
        sys.stdout.flush()
        sys.exit(0)
        
    except Exception as e:
        error_result = {
            'success': False,
            'error': str(e),
            'items': [],
            'summary': {'parsing_method': 'error'}
        }
        print(json.dumps(error_result, indent=2))
        sys.stdout.flush()
        sys.exit(1)

if __name__ == "__main__":
    main()
