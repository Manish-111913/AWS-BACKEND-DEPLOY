import json
import re
import sys
import os
from typing import List, Dict, Any, Optional
import google.generativeai as genai
from datetime import datetime

class AdvancedSalesReportParser:
    def __init__(self, api_key: str):
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-1.5-flash')
        # keywords for basic F&B categorization
        self.categories = {
            'dosa': ['dosa'],
            'idli': ['idli'], 
            'coffee': ['coffee'],
            'vada': ['vada'],
            'upma': ['upma'],
            'beverages': ['tea', 'juice', 'milk'],
            'other': []
        }

    def _clean_json_response(self, response_text: str) -> str:
        # Remove markdown formatting
        if '```json' in response_text:
            response_text = response_text.split('```json')[1].split('```')[0]
        elif '```' in response_text:
            response_text = response_text.split('```')[1]
        # Find JSON array/object bounds
        start = response_text.find('{')
        end = response_text.rfind('}') + 1
        if start != -1 and end != 0:
            response_text = response_text[start:end]
        return response_text.strip()

    def parse_with_gemini(self, ocr_text: str) -> Dict[str, Any]:
        try:
            prompt = f"""
You are an expert total sales report parser for restaurants.

Analyze this sales report text and extract the exact item names, total quantities, and prices:

{ocr_text}

If individual transactions are shown, aggregate by item name.
If already aggregated, use the data as-is.

Return ONLY valid JSON:
{{
  "summary": {{
    "total_revenue": number,
    "total_items_sold": number,
    "unique_items_count": number
  }},
  "items": [
    {{
      "item_name": "exact item name",
      "total_quantity": total_number,
      "unit": "plates/cups/pieces",
      "unit_price": price_per_unit,
      "total_amount": total_price_for_item
    }}
  ]
}}

Parse "10 plates" as total_quantity=10, unit="plates".
Calculate unit_price = total_amount / total_quantity.
End with total revenue sum.
            """
            response = self.model.generate_content(prompt)
            clean_text = self._clean_json_response(response.text.strip())
            result = json.loads(clean_text)

            # Identify breakfast items using AI first; fallback to keywords
            items_list = result.get('items', [])
            ai_breakfast = self._ai_identify_breakfast_items(items_list)
            complementary = self._calculate_complementary_from_items(items_list, ai_breakfast)
            complementary_breakdown = self._breakfast_breakdown_from_items(items_list, ai_breakfast)
            result['complementary_items'] = complementary
            result['complementary_breakdown'] = complementary_breakdown
            result['parsing_timestamp'] = datetime.now().isoformat()
            result['parsing_confidence'] = 0.95
            return result
        except Exception as e:
            print(f"Gemini parsing failed: {e}", file=sys.stderr)
            return self.fallback_parsing(ocr_text)

    def fallback_parsing(self, ocr_text: str) -> Dict[str, Any]:
        lines = [line for line in ocr_text.split('\n') if line.strip()]
        item_aggregation = {}  # item_name -> {quantity, unit, total_amount}
        
        # Detect report type
        header_line = lines[0].lower() if lines else ""
        is_summary_format = "item" in header_line and "customer" not in header_line
        
        for line in lines:
            row = re.split(r'\s{2,}|\t+', line.strip())
            
            # Skip header row
            if any(header in row[0].lower() for header in ['customer', 'item']) or len(row) < 3:
                continue
            
            if is_summary_format:
                # Format: Item | Quantity | Amount
                if len(row) < 3:
                    continue
                item = row[0].strip()
                qstr = row[1].strip()
                amount_str = row[2].replace('₹', '').replace(',', '').strip()
            else:
                # Format: Customer | Item | Quantity | Amount - aggregate by item
                if len(row) < 4:
                    continue
                item = row[1].strip()
                qstr = row[2].strip()
                amount_str = row[3].replace('₹', '').replace(',', '').strip()
            
            # Parse quantity and unit
            m = re.match(r'(\d+)\s*(\w+)', qstr)
            if m:
                quantity, unit = int(m.group(1)), m.group(2).lower()
            else:
                # Try to extract just the number
                num_match = re.search(r'(\d+)', qstr)
                if num_match:
                    quantity = int(num_match.group(1))
                    unit = "units"
                else:
                    quantity, unit = 1, "units"
            
            try:
                clean_amount = re.sub(r'[^\d.]', '', amount_str)
                total_amount = float(clean_amount) if clean_amount else 0
            except Exception:
                total_amount = 0
            
            # Aggregate by item
            if item in item_aggregation:
                item_aggregation[item]['total_quantity'] += quantity
                item_aggregation[item]['total_amount'] += total_amount
            else:
                item_aggregation[item] = {
                    'total_quantity': quantity,
                    'unit': unit,
                    'total_amount': total_amount
                }
        
        # Convert aggregated data to final format
        items = []
        total_revenue = 0
        total_items_sold = 0
        
        for item_name, data in item_aggregation.items():
            unit_price = data['total_amount'] / data['total_quantity'] if data['total_quantity'] > 0 else 0
            
            item_entry = {
                "item_name": item_name,
                "total_quantity": data['total_quantity'],
                "unit": data['unit'],
                "unit_price": round(unit_price, 2),
                "total_amount": round(data['total_amount'], 2)
            }
            
            items.append(item_entry)
            total_revenue += data['total_amount']
            total_items_sold += data['total_quantity']
        
        # Sort items by total_amount descending (like TSR5)
        items.sort(key=lambda x: x['total_amount'], reverse=True)
        
        summary = {
            "total_revenue": round(total_revenue, 2),
            "total_items_sold": total_items_sold,
            "unique_items_count": len(items)
        }
        
        return {
            "summary": summary,
            "items": items,
            # Include complementary items (e.g., chutneys/sambar) equal to total breakfast plates
            "complementary_items": self._calculate_complementary_from_items(items),
            "complementary_breakdown": self._breakfast_breakdown_from_items(items, None),
            "parsing_confidence": 0.7,
            "parsing_timestamp": datetime.now().isoformat()
        }

    def _calculate_complementary_from_items(self, items: List[Dict[str, Any]], ai_breakfast_names: Optional[set] = None) -> Dict[str, int]:
        """Calculate complementary accompaniments based on total breakfast plates.
        If ai_breakfast_names provided, use it; otherwise fallback to keywords.
        """
        # Expanded common breakfast keywords
        breakfast_keywords = [
            'dosa', 'idli', 'vada', 'uttapam', 'utappam', 'rava', 'masala dosa', 'plain dosa',
            'set dosa', 'onion dosa', 'pesarattu', 'upma', 'poha', 'pongal', 'poori', 'puri',
            'paratha', 'bhatura', 'bhature', 'chole bhature'
        ]

        total_breakfast_qty = 0
        use_ai = bool(ai_breakfast_names)
        ai_set = {n.lower() for n in (ai_breakfast_names or set())}

        for it in items or []:
            name = (it.get('item_name') or '').lower()
            qty = int(it.get('total_quantity') or 0)
            if use_ai:
                if name in ai_set:
                    total_breakfast_qty += qty
            else:
                if any(k in name for k in breakfast_keywords):
                    total_breakfast_qty += qty

        return {
            'groundnut_chutney': total_breakfast_qty,
            'tomato_chutney': total_breakfast_qty,
            'karam_podi': total_breakfast_qty,
            'sambar': total_breakfast_qty,
        }

    def _ai_identify_breakfast_items(self, items: List[Dict[str, Any]]) -> set:
        """Use Gemini to decide which of the parsed items are Indian breakfast items.
        Returns a set of exact item_name strings that are breakfast items.
        Falls back to empty set on any error.
        """
        try:
            if not items:
                return set()
            names = [it.get('item_name', '') for it in items if it.get('item_name')]
            if not names:
                return set()
            prompt = (
                "You are an Indian F&B expert. Given the following item names from a restaurant's daily sales, "
                "mark which ones are Indian breakfast items or typical breakfast combos (e.g., dosa, idli, vada, uttapam, "
                "upma, poha, pongal, poori/puri, paratha, chole bhature, etc.).\n\n"
                f"ITEMS:\n{json.dumps(names)}\n\n"
                "Return ONLY valid JSON of the exact names that are breakfast items:\n"
                "{\n  \"breakfast_items\": [\"Exact Name From List\", ...]\n}"
            )

            resp = self.model.generate_content(prompt)
            text = self._clean_json_response(resp.text.strip())
            data = json.loads(text)
            arr = data.get('breakfast_items', [])
            # Keep only names that exist in the original list to avoid hallucinations
            names_set = set(names)
            return {n for n in arr if n in names_set}
        except Exception:
            return set()

    def _breakfast_breakdown_from_items(self, items: List[Dict[str, Any]], ai_breakfast_names: Optional[set]) -> Dict[str, int]:
        """Return a mapping of breakfast item_name -> quantity for per-item complementary display."""
        # Use AI names if available; otherwise use keyword match
        kw = [
            'dosa', 'idli', 'vada', 'uttapam', 'utappam', 'rava', 'masala dosa', 'plain dosa',
            'set dosa', 'onion dosa', 'pesarattu', 'upma', 'poha', 'pongal', 'poori', 'puri',
            'paratha', 'bhatura', 'bhature', 'chole bhature'
        ]
        breakdown: Dict[str, int] = {}
        ai_set = {n.lower() for n in (ai_breakfast_names or set())}
        use_ai = bool(ai_set)

        for it in items or []:
            name = it.get('item_name') or ''
            lname = name.lower()
            qty = int(it.get('total_quantity') or 0)
            is_breakfast = (lname in ai_set) if use_ai else any(k in lname for k in kw)
            if is_breakfast:
                breakdown[name] = breakdown.get(name, 0) + qty
        return breakdown

if __name__ == "__main__":
    try:
        # Read input from stdin (Node.js sends OCR text here)
        input_text = sys.stdin.read().strip()
        
        # Get API key from environment
        api_key = os.getenv("GOOGLE_VISION_API_KEY", "")
        
        # Create parser and process the text
        parser = AdvancedSalesReportParser(api_key)
        result = parser.parse_with_gemini(input_text)
        
        # Output only JSON (no extra text)
        print(json.dumps(result))
        
    except Exception as e:
        # Output error as JSON
        error_result = {
            "success": False,
            "error": str(e),
            "summary": {"total_revenue": 0, "total_items_sold": 0, "unique_items_count": 0},
            "items": []
        }
        print(json.dumps(error_result))
