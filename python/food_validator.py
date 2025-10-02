#!/usr/bin/env python3
"""
Lightweight food item validator for StockIn.

Input (stdin JSON):
{
  "items": [
    { "item_name": "Tomatoes", "category": "Vegetables" },
    ...
  ]
}

Output (stdout JSON):
{
  "results": [
    { "index": 0, "valid": true, "confidence": 0.92, "reason": "", "suggested_category": "Vegetables", "normalized_name": "tomatoes" },
    ...
  ]
}

No external dependencies; uses a curated whitelist/blacklist and heuristics.
"""

import sys
import json
import re
import os
from typing import List, Dict, Any


ALLOWED_CATEGORIES = {
    'meat','seafood','vegetables','dairy','spices','grains','beverages','oils',
    'fruits','herbs','pulses','nuts','condiments','bakery','eggs','frozen','cereals'
}

# Common food keywords (not exhaustive, just a safety net)
FOOD_KEYWORDS = {
    'tomato','tomatoes','potato','potatoes','onion','onions','garlic','ginger','chili','chilli','capsicum','pepper',
    'cabbage','carrot','beans','pea','peas','spinach','lettuce','coriander','cilantro','mint','basil','parsley','dill',
    'chicken','mutton','beef','pork','fish','prawn','prawns','shrimp','salmon','tuna','egg','eggs',
    'milk','curd','yogurt','paneer','cheese','butter','ghee','cream',
    'rice','wheat','flour','maida','atta','rava','suji','semolina','corn','oats','barley',
    'sugar','salt','turmeric','cumin','coriander powder','chilli powder','cardamom','cinnamon','clove','mustard','fenugreek',
    'oil','sunflower oil','groundnut oil','coconut oil','olive oil',
    'apple','banana','orange','mango','grape','grapes','pineapple','papaya','lemon','lime',
    'almond','cashew','raisins','walnut','peanut','pistachio','dates',
    'water','soda','juice','tea','coffee','milkshake','buttermilk'
}

# Obvious non-food and vendor/billing terms
BLACKLIST_TERMS = {
    'invoice','gst','sgst','cgst','igst','bill','token','delivery','charge','charges','tips','tip','discount',
    'room','table','service','pvt','ltd','private','limited','street','road','lane','nagar','colony','area','landmark',
    'gstin','pan','hsn','sac','qty','mrp','rate','amount','total','subtotal','roundoff','round off'
}

# Common Indian/English names and cities (very small sample to avoid false positives)
PERSON_OR_PLACE = {
    'ram','shyam','raju','rahul','ramesh','suresh','anita','sunita','priya','amit','rohit','arun','kumar',
    'shiva','shankar','shankar','ganesh','krishna','alak','anshul','suraj','vikram','vijay',
    'bangalore','bengaluru','mumbai','delhi','chennai','kolkata','hyderabad','pune','ahmedabad','kochi','cochin'
}

MONTHS = {'january','february','march','april','may','june','july','august','september','october','november','december',
          'jan','feb','mar','apr','jun','jul','aug','sep','sept','oct','nov','dec'}


def is_mostly_digits_or_codes(s: str) -> bool:
    s2 = re.sub(r"[^A-Za-z0-9]", "", s)
    if not s2:
        return True
    digits = sum(c.isdigit() for c in s2)
    letters = sum(c.isalpha() for c in s2)
    # Many digits or very few letters likely a code
    return digits > letters or letters == 0


def guess_category(name: str) -> str:
    n = name.lower()
    # Crude mapping by keyword; extend as needed
    if any(w in n for w in ['chicken','mutton','beef','pork']):
        return 'Meat'
    if any(w in n for w in ['fish','prawn','shrimp','salmon','tuna']):
        return 'Seafood'
    if any(w in n for w in ['milk','curd','yogurt','paneer','cheese','butter','ghee','cream']):
        return 'Dairy'
    if any(w in n for w in ['oil','sunflower','groundnut','coconut','olive']):
        return 'Oils'
    if any(w in n for w in ['turmeric','cumin','coriander','cardamom','cinnamon','clove','mustard','fenugreek','spice','masala']):
        return 'Spices'
    if any(w in n for w in ['rice','wheat','flour','maida','atta','rava','suji','semolina','oats','barley','corn']):
        return 'Grains'
    if any(w in n for w in ['tea','coffee','juice','soda','water','milkshake','buttermilk']):
        return 'Beverages'
    if any(w in n for w in ['apple','banana','orange','mango','grape','pineapple','papaya']):
        return 'Fruits'
    if any(w in n for w in ['coriander','cilantro','mint','basil','parsley','dill']):
        return 'Herbs'
    # Default to Vegetables if it contains common veg tokens
    if any(w in n for w in ['tomato','potato','onion','garlic','ginger','cabbage','carrot','beans','pea','spinach','lettuce','capsicum','pepper']):
        return 'Vegetables'
    return ''


def validate_item(name: str, category: str) -> Dict[str, Any]:
    original = name or ''
    n = (name or '').strip()
    c = (category or '').strip()
    lower = n.lower()
    tokens = set(re.findall(r"[a-zA-Z]+", lower))

    confidence = 0.50
    reason_parts: List[str] = []

    if not n:
        return {"valid": False, "confidence": 0.0, "reason": "Empty item name", "suggested_category": "", "normalized_name": ""}

    # Category check
    if c.lower() in ALLOWED_CATEGORIES:
        confidence += 0.25
    else:
        reason_parts.append(f"Category '{c}' is not allowed")

    # Blacklists
    if tokens & BLACKLIST_TERMS:
        reason_parts.append("Contains billing/vendor terms")
        confidence -= 0.4

    if tokens & PERSON_OR_PLACE:
        reason_parts.append("Contains name/place terms")
        confidence -= 0.3

    if tokens & MONTHS:
        reason_parts.append("Contains month name (likely date)")
        confidence -= 0.2

    flagged_code = False
    if is_mostly_digits_or_codes(lower):
        reason_parts.append("Looks like a code/number, not a food item")
        confidence -= 0.5
        flagged_code = True

    # Whitelist
    has_food_keyword = bool(tokens & FOOD_KEYWORDS)
    if has_food_keyword:
        confidence += 0.25

    suggested = guess_category(n)
    if suggested and suggested.lower() != c.lower():
        reason_parts.append(f"Suggested category: {suggested}")

    # Clamp confidence
    confidence = max(0.0, min(1.0, confidence))

    # Heuristic mode stricter: if no obvious food keyword, mark invalid to avoid false positives like names
    valid = (confidence >= 0.6) and (not flagged_code) and has_food_keyword

    return {
        "valid": valid,
        "confidence": round(confidence, 2),
        "reason": "; ".join(reason_parts),
        "suggested_category": suggested,
        "normalized_name": lower
    }


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception as e:
        print(json.dumps({"error": f"Invalid JSON input: {e}"}))
        return 1

    items = data.get('items') or []

    # Try Gemini if available
    api_key = os.environ.get('GOOGLE_VISION_API_KEY') or os.environ.get('GEMINI_API_KEY')
    use_ai = bool(api_key)
    ai_results: List[Dict[str, Any]] = []

    if use_ai:
        try:
            import google.generativeai as genai
            genai.configure(api_key=api_key)

            allowed_list = sorted(list(ALLOWED_CATEGORIES))
            sys_prompt = (
                "You are a food inventory intake validator. "
                "Classify each item as a valid raw food or kitchen consumable used in restaurants. "
                "Return STRICT JSON with key 'results' as an array, each element: "
                "{index:number, valid:boolean, confidence:number (0..1), reason:string, suggested_category:string}. "
                f"Suggested category MUST be one of: {allowed_list}. "
                "Rules: \n"
                "- Invalid examples: invoice terms (gst, sgst, bill), addresses, human names, codes, pure numbers.\n"
                "- 'Stock' or 'Broth' derived from animal (e.g., chicken stock) is valid; prefer category 'Meat'.\n"
                "- Vegetable stock/broth is valid; prefer category 'Vegetables'.\n"
                "- Drinks (tea, coffee, juice) -> 'Beverages'. Oils -> 'Oils'. Spices/masala -> 'Spices'.\n"
                "- If unsure but likely a food item, set valid=true with confidence around 0.6..0.7 and give best category.\n"
            )

            # Build compact JSON-like input for robustness
            items_compact = [
                {
                    "index": i,
                    "item_name": (it or {}).get('item_name', ''),
                    "category": (it or {}).get('category', ''),
                }
                for i, it in enumerate(items)
            ]

            prompt = (
                f"ALLOWED_CATEGORIES={allowed_list}\n"
                f"ITEMS={json.dumps(items_compact, ensure_ascii=False)}\n"
                "Respond with JSON only, like: {\"results\":[{...}]}"
            )

            # Use text model (widely available with this SDK version)
            model = genai.GenerativeModel('gemini-pro')
            resp = model.generate_content([sys_prompt, prompt])
            text = (resp.text or '').strip()

            # Extract JSON from response robustly
            def extract_json(s: str) -> Dict[str, Any]:
                first = s.find('{')
                last = s.rfind('}')
                if first != -1 and last != -1 and last > first:
                    return json.loads(s[first:last+1])
                return json.loads(s)

            parsed = extract_json(text)
            res_list = parsed.get('results') if isinstance(parsed, dict) else None
            if not isinstance(res_list, list):
                raise ValueError('No results array in model output')

            # Normalize and coerce to expected format
            mapped: Dict[int, Dict[str, Any]] = {}
            for r in res_list:
                try:
                    idx = int(r.get('index'))
                except Exception:
                    continue
                valid = bool(r.get('valid'))
                conf = float(r.get('confidence', 0))
                reason = str(r.get('reason', ''))
                suggested = str(r.get('suggested_category', ''))
                # Normalize suggested category capitalization and ensure allowed
                suggested_norm = suggested.strip().capitalize()
                if suggested_norm.lower() not in ALLOWED_CATEGORIES:
                    suggested_norm = guess_category((items[idx] or {}).get('item_name', '')).capitalize() or ''

                ai_entry = {
                    "valid": valid,
                    "confidence": max(0.0, min(1.0, conf)),
                    "reason": reason,
                    "suggested_category": suggested_norm,
                }
                mapped[idx] = ai_entry

            for i, it in enumerate(items):
                name = (it or {}).get('item_name', '')
                category = (it or {}).get('category', '')
                if i in mapped:
                    merged = mapped[i]
                    # If AI didn't provide a suggested category, try to guess
                    suggested = merged.get('suggested_category') or guess_category(name) or ''
                    r = {
                        "valid": bool(merged.get('valid')),
                        "confidence": max(0.0, min(1.0, float(merged.get('confidence', 0.0)))) or 0.6,
                        "reason": merged.get('reason') or '',
                        "suggested_category": suggested,
                        "normalized_name": (name or '').strip().lower(),
                        "index": i,
                    }
                else:
                    # If AI skipped this row, fallback to heuristic for this item
                    base = validate_item(name, category)
                    base['index'] = i
                    r = base
                ai_results.append(r)

        except Exception as e:
            # Fallback to heuristic for all
            ai_results = []

    results = []
    engine = 'heuristic'
    if use_ai and ai_results:
        results = ai_results
        engine = 'gemini'
    else:
        for idx, it in enumerate(items):
            name = (it or {}).get('item_name', '')
            category = (it or {}).get('category', '')
            r = validate_item(name, category)
            r['index'] = idx
            results.append(r)

    print(json.dumps({"engine": engine, "results": results}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
