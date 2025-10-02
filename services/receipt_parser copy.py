#!/usr/bin/env python3
"""
Enhanced Receipt Parser using Google Gemini AI
Handles handwritten receipts, complex formats, and real-world edge cases
"""

import json
import re
import sys
import os
from typing import List, Dict, Any, Optional, Union
import google.generativeai as genai
from datetime import datetime, timedelta
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class EnhancedReceiptParser:
    def __init__(self, api_key: str):
        """Initialize with Google API key and enhanced patterns"""
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-1.5-flash')
        
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
        
        # Common grocery categories with more variations
        self.categories = {
            'meat_seafood': [
                'chicken', 'beef', 'pork', 'mutton', 'fish', 'lamb', 'turkey', 
                'prawns', 'shrimp', 'crab', 'salmon', 'tuna', 'cod', 'meat'
            ],
            'vegetables': [
                'tomato', 'onion', 'potato', 'carrot', 'cabbage', 'spinach', 
                'broccoli', 'cauliflower', 'cucumber', 'pepper', 'lettuce',
                'garlic', 'ginger', 'beetroot', 'radish', 'capsicum'
            ],
            'fruits': [
                'apple', 'banana', 'orange', 'mango', 'grape', 'strawberry',
                'pineapple', 'watermelon', 'melon', 'kiwi', 'peach', 'plum'
            ],
            'dairy_eggs': [
                'milk', 'cheese', 'butter', 'yogurt', 'cream', 'eggs', 
                'paneer', 'curd', 'ghee'
            ],
            'grains_bakery': [
                'rice', 'wheat', 'flour', 'bread', 'pasta', 'noodles',
                'oats', 'quinoa', 'barley', 'cereal'
            ],
            'spices_condiments': [
                'salt', 'pepper', 'turmeric', 'chili', 'cumin', 'coriander',
                'garam masala', 'sauce', 'ketchup', 'vinegar', 'oil'
            ],
            'beverages': [
                'juice', 'soda', 'water', 'tea', 'coffee', 'beer', 'wine'
            ],
            'household': [
                'soap', 'detergent', 'shampoo', 'toothpaste', 'tissue',
                'toilet paper', 'cleaning', 'dishwash', 'scrubs', 'sponge'
            ],
            'snacks': [
                'chips', 'biscuits', 'cookies', 'nuts', 'chocolate', 'candy'
            ],
            'kitchen_items': [
                'spoons', 'cups', 'plates', 'bowls', 'containers', 'sheet', 'foil'
            ]
        }

    def parse_with_gemini(self, ocr_text: str) -> List[Dict[str, Any]]:
        """Enhanced Gemini AI parsing with better context understanding"""
        try:
            # Clean and prepare text
            cleaned_text = self._preprocess_text(ocr_text)
            
            # Truncate if too long
            max_text_length = 8000
            if len(cleaned_text) > max_text_length:
                cleaned_text = cleaned_text[:max_text_length] + "..."
            
            prompt = f"""
            You are an expert receipt parser with deep understanding of various receipt formats including handwritten ones.
            
            RECEIPT TEXT TO PARSE:
            {cleaned_text}
            
            PARSING INSTRUCTIONS:
            1. Extract ALL grocery/retail items with their details
            2. Handle various formats:
               - "Item - Quantity x Price = Total"
               - "Quantity x Price - Item"
               - "Item - Weight/Volume - Price"
               - "Dimensions (like 5x6) - Item - Price"
               - Simple "Item - Quantity - Price"
            3. For unclear handwriting, use context clues
            4. Common abbreviations: kg=kilogram, g/gm=gram, l/ltr=liter, pcs=pieces
            5. If you see calculations like "2 x 140 = 280", extract: quantity=2, unit_price=140
            6. If you see "3 x 140 = 420", extract: quantity=3, unit_price=140
            7. For items with dimensions (like "5x6"), treat as quantity and include in item name
            8. Ignore store details, totals, dates, taxes
            9. Clean item names (remove extra characters, standardize)
            10. Always include category based on item type
            11. Look for patterns like "Parel Sheet", "Spoons", "Scrubs", "Cups" as kitchen/household items
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
        """Clean and standardize item names"""
        # Remove extra characters and whitespace
        name = re.sub(r'[^\w\s\-\.]', '', name)
        name = re.sub(r'\s+', ' ', name)
        name = name.strip().title()
        
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

    def parse_receipt(self, ocr_text: str, include_metadata: bool = True) -> Dict[str, Any]:
        """Enhanced main parsing function with metadata"""
        try:
            # Parse items
            items = self.parse_with_gemini(ocr_text)
            
            # If no items found, try fallback
            if not items:
                items = self._enhanced_fallback_parse(ocr_text)
            
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
            
            result = {
                'success': True,
                'items': items,
                'summary': {
                    'total_items': len(items),
                    'total_amount': round(total_amount, 2),
                    'average_confidence': round(avg_confidence, 2),
                    'parsing_method': 'gemini_ai' if items else 'regex_fallback',
                    'categories': category_summary
                }
            }
            
            if include_metadata:
                result['metadata'] = {
                    'parsed_at': datetime.now().isoformat(),
                    'raw_text_length': len(ocr_text),
                    'unique_categories': len(category_summary)
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
            print("Usage: python enhanced_receipt_parser.py <api_key> <ocr_text> [--include-metadata]")
            sys.exit(1)
        
        api_key = sys.argv[1]
        ocr_text = sys.argv[2]
        include_metadata = '--include-metadata' in sys.argv
        
        parser = EnhancedReceiptParser(api_key)
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
