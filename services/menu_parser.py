#!/usr/bin/env python3
import sys
import json
import re
import os
from difflib import SequenceMatcher

def load_menu_items():
    """Load menu items from the Node.js module"""
    try:
        # Get the directory of this script
        script_dir = os.path.dirname(os.path.abspath(__file__))
        backend_dir = os.path.dirname(script_dir)
        menu_file = os.path.join(backend_dir, 'data', 'menuItems.js')
        
        # Read the JavaScript file
        with open(menu_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Extract the menuItems array using regex
        pattern = r'const menuItems = (\[.*?\]);'
        match = re.search(pattern, content, re.DOTALL)
        
        if match:
            # Convert JS object to Python-compatible JSON
            js_array = match.group(1)
            # Replace single quotes with double quotes for JSON
            js_array = re.sub(r"'([^']*)'", r'"\1"', js_array)
            # Handle object keys without quotes
            js_array = re.sub(r'(\w+):', r'"\1":', js_array)
            
            menu_items = json.loads(js_array)
            return menu_items
        else:
            return []
    except Exception as e:
        print(f"Error loading menu items: {e}", file=sys.stderr)
        return []

def similarity(a, b):
    """Calculate similarity between two strings"""
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()

def extract_menu_items_from_text(ocr_text):
    """Extract menu items from OCR text"""
    try:
        menu_items = load_menu_items()
        if not menu_items:
            return {"success": False, "error": "No menu items loaded", "items": []}
        
        found_items = []
        lines = ocr_text.split('\n')
        
        for line in lines:
            line = line.strip()
            if not line or len(line) < 3:
                continue
                
            # Skip lines that are just prices or numbers
            if re.match(r'^[\d\s₹\-\.]+$', line):
                continue
                
            # Clean the line
            clean_line = re.sub(r'[₹\d\-\.\s]+$', '', line).strip()
            clean_line = re.sub(r'[^\w\s]', ' ', clean_line).strip()
            
            if len(clean_line) < 3:
                continue
            
            # Find matching menu items
            for menu_item in menu_items:
                item_name = menu_item['name']
                
                # Exact match
                if clean_line.lower() == item_name.lower():
                    if not any(item['id'] == menu_item['id'] for item in found_items):
                        found_items.append(menu_item)
                        continue
                
                # Partial match with high similarity
                if similarity(clean_line, item_name) > 0.7:
                    if not any(item['id'] == menu_item['id'] for item in found_items):
                        found_items.append(menu_item)
                        continue
                
                # Word-based matching
                line_words = clean_line.lower().split()
                item_words = item_name.lower().split()
                
                if len(line_words) >= 2 and len(item_words) >= 2:
                    common_words = set(line_words) & set(item_words)
                    if len(common_words) >= min(2, len(item_words)):
                        if not any(item['id'] == menu_item['id'] for item in found_items):
                            found_items.append(menu_item)
        
        return {
            "success": True,
            "items": found_items,
            "count": len(found_items)
        }
        
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "items": []
        }

def main():
    if len(sys.argv) != 2:
        print(json.dumps({"success": False, "error": "Usage: python menu_parser.py <ocr_text>"}))
        sys.exit(1)
    
    ocr_text = sys.argv[1]
    result = extract_menu_items_from_text(ocr_text)
    print(json.dumps(result))

if __name__ == "__main__":
    main()