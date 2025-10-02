/**
 * Unified deterministic receipt parser (JavaScript) replacing Python parser.
 * Patterns handled:
 *  - Item - Q x P = T
 *  - (Previous line item name) followed by Q x P = T
 *  - Dimension lines: 5x6 - Parel Sheet - 180
 *  - Weight lines: Tomatoes 1.25kg 45.00 / Tomatoes - 1.25kg - 45
 *  - Column/trailing numbers: Item .... Q P (Q*P)
 */
const approxEqual = (a, b, rel = 0.02, absTol = 0.5) => {
  if (a === 0 || b === 0) return Math.abs(a - b) <= absTol;
  return Math.abs(a - b) <= Math.max(Math.abs(a), Math.abs(b)) * rel || Math.abs(a - b) <= absTol;
};

function cleanName(name) {
  return name.replace(/[₹$€£]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[-:]+$/,'')
    .trim();
}

function categorize(itemName) {
  const n = itemName.toLowerCase();
  const cats = {
    meat_seafood: ['chicken','mutton','beef','pork','fish','tuna','salmon','meat'],
    vegetables: ['tomato','onion','potato','carrot','cabbage','spinach','lettuce','ginger','garlic'],
    fruits: ['apple','banana','orange','mango','grape','melon'],
    dairy_eggs: ['milk','cheese','butter','yogurt','cream','egg','paneer','curd','ghee'],
    grains_bakery: ['rice','wheat','flour','bread','pasta','noodle','oats','cereal'],
    beverages: ['water','juice','tea','coffee','soda','beer','wine'],
    snacks: ['chips','biscuit','cookie','chocolate','candy','nuts'],
    kitchen_items: ['spoon','cup','plate','bowl','container','sheet','foil','scrub'],
    spices_condiments: ['salt','pepper','turmeric','chili','cumin','coriander','sauce','oil']
  };
  for (const [cat, arr] of Object.entries(cats)) if (arr.some(k => n.includes(k))) return cat;
  return 'other';
}

function normalizeUnit(u) {
  const map = { kg:'kg', kgs:'kg', g:'gram', gm:'gram', grams:'gram', l:'liter', ltr:'liter', ml:'ml', pcs:'pieces', pc:'pieces', piece:'pieces', pieces:'pieces' };
  return map[u.toLowerCase()] || u.toLowerCase();
}

function parseDeterministic(rawText) {
  const lines = rawText.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const items = [];
  const seen = new Set();
  const skip = /^(total|subtotal|tax|balance|thank|date|time|invoice|bill)\b/i;
  const headerLike = /^(item|i?iem)\s+qty\s+price$/i;
  const multFull = /^(?:(?<name>[A-Za-z][A-Za-z0-9 /&()\-]*?)\s*[-:])?\s*(?<q>\d+(?:\.\d+)?)\s*[xX*]\s*(?<p>\d+(?:\.\d+)?)\s*=\s*(?<t>\d+(?:\.\d+)?)(?:\s|$)/;
  const multBare = /^(?<q>\d+(?:\.\d+)?)\s*[xX*]\s*(?<p>\d+(?:\.\d+)?)\s*=\s*(?<t>\d+(?:\.\d+)?)(?:\s|$)/;
  const dimension = /^(?<a>\d+)\s*[xX]\s*(?<b>\d+)\s*[-: ]+?(?<name>[A-Za-z][A-Za-z0-9 /&()\-]*?)\s*[-: ]+?(?<price>\d+(?:\.\d+)?)$/;
  const weight = /^(?<name>[A-Za-z][A-Za-z0-9 /&()\-]*?)\s+(?<qty>\d+(?:\.\d+)?)(?<unit>kg|kgs?|g|gm|grams?|ml|l|ltr)\b.*?(?<price>\d+(?:\.\d+)?)(?:\s|$)/i;
  // New: name + qty + unit + price (currency optional)
  const qtyUnitPrice = /^(?<name>[A-Za-z][A-Za-z0-9 /&()\-]*?)\s+(?<qty>\d+(?:\.\d+)?)\s*(?<unit>kg|kgs?|g|gm|grams?|ml|l|ltr|pcs?|pieces?)\s*[₹$€£]?\s*(?<price>\d+(?:\.\d+)?)(?:\s|$)/i;
  // New: name + single price (treat quantity=1)
  const namePrice = /^(?<name>[A-Za-z][A-Za-z0-9 /&()\-]{3,}?)\s*[₹$€£]\s*(?<price>\d+(?:\.\d+)?)(?:\s|$)/;
  // New: name + qty + price (no unit) e.g. 'TOMATOES 0.80 40.00'
  const nameQtyPrice = /^(?<name>[A-Za-z][A-Za-z0-9 /&()\-]*?)\s+(?<qty>\d+(?:\.\d+)?)\s+[₹$€£]?\s*(?<price>\d+(?:\.\d+)?)(?:\s|$)/;

  let prevName = null;
  for (const raw of lines) {
    let line = raw.replace(/[₹$€£]/g,'').replace(/(\d+)\.(?=\s|$)/g,'$1').trim();
  if (!line || skip.test(line) || headerLike.test(line.toLowerCase().replace(/\s+/g,' '))) { prevName = line || prevName; continue; }

    // 1. Full multiplication
    let m = line.match(multFull);
    if (m) {
      const name = cleanName(m.groups.name || 'Unknown Item');
      const q = parseFloat(m.groups.q); const p = parseFloat(m.groups.p); const t = parseFloat(m.groups.t);
      if (!isNaN(q) && !isNaN(p) && !isNaN(t) && (approxEqual(q*p,t) || t>0)) {
        const key = `${name}|${q}|${p}`; if (!seen.has(key)) {
          items.push(enhanceItem({ item_name:name, quantity:q, unit:'pieces', unit_price:p, total_price:t, confidence:0.95 }));
          seen.add(key);
        }
      }
      prevName = name; continue;
    }

    // 2. Bare multiplication uses previous line as name
    m = line.match(multBare);
    if (m && prevName && /[A-Za-z]/.test(prevName) && !multFull.test(prevName)) {
      const q = parseFloat(m.groups.q); const p = parseFloat(m.groups.p); const t = parseFloat(m.groups.t);
      const name = cleanName(prevName);
      const key = `${name}|${q}|${p}`;
      if (!seen.has(key)) {
        items.push(enhanceItem({ item_name:name, quantity:q, unit:'pieces', unit_price:p, total_price:t, confidence:0.9 }));
        seen.add(key);
      }
      prevName = name; continue;
    }

    // 3. Dimension pattern
    m = line.match(dimension);
    if (m) {
      const a = parseFloat(m.groups.a); const b = parseFloat(m.groups.b); const price = parseFloat(m.groups.price);
      const qty = a*b; const name = `${cleanName(m.groups.name)} (${a}x${b})`;
      const key = `${name}|${qty}|${price}`;
      if (!seen.has(key)) {
        items.push(enhanceItem({ item_name:name, quantity:qty, unit:'pieces', unit_price: price/qty, total_price: price, confidence:0.9 }));
        seen.add(key);
      }
      prevName = name; continue;
    }

    // 4. Weight pattern
    m = line.match(weight);
    if (m) {
      const qty = parseFloat(m.groups.qty); const price = parseFloat(m.groups.price);
      let unit = normalizeUnit(m.groups.unit.replace(/s$/,''));
      const name = cleanName(m.groups.name);
      const key = `${name}|${qty}|${price}`;
      if (!seen.has(key) && qty>0) {
        items.push(enhanceItem({ item_name:name, quantity:qty, unit, unit_price: price/qty, total_price: price, confidence:0.85 }));
        seen.add(key);
      }
      prevName = name; continue;
    }

    // 4b. Qty + Unit + Price pattern
    m = line.match(qtyUnitPrice);
    if (m) {
      const qty = parseFloat(m.groups.qty); const price = parseFloat(m.groups.price);
      const unit = normalizeUnit(m.groups.unit.replace(/s$/,''));
      const name = cleanName(m.groups.name);
      const key = `${name}|${qty}|${price}`;
      if (!seen.has(key) && qty>0) {
        items.push(enhanceItem({ item_name:name, quantity:qty, unit, unit_price: price/qty, total_price: price, confidence:0.8 }));
        seen.add(key);
      }
      prevName = name; continue;
    }

    // 4c. Name + Price only (assume quantity 1 piece)
    m = line.match(namePrice);
    if (m) {
      const price = parseFloat(m.groups.price);
      const name = cleanName(m.groups.name);
      const key = `${name}|1|${price}`;
      if (!seen.has(key)) {
        items.push(enhanceItem({ item_name:name, quantity:1, unit:'pieces', unit_price: price, total_price: price, confidence:0.6 }));
        seen.add(key);
      }
      prevName = name; continue;
    }

    // 5. Name + Qty + Price (no unit)
    m = line.match(nameQtyPrice);
    if (m) {
      const qty = parseFloat(m.groups.qty); const price = parseFloat(m.groups.price);
      const name = cleanName(m.groups.name);
      if (qty>0 && price>0 && price > qty && !/\b(x|\*)\b/i.test(line)) {
        const key = `${name}|${qty}|${price}`;
        if (!seen.has(key)) {
          items.push(enhanceItem({ item_name:name, quantity:qty, unit:'pieces', unit_price: price/qty, total_price: price, confidence:0.7 }));
          seen.add(key);
        }
        prevName = name; continue;
      }
    }

    // 6. Column style: last three numerics a b c with a*b≈c
    const nums = line.match(/(\d+(?:\.\d+)?)/g);
    if (nums && nums.length >=3) {
      const a = parseFloat(nums[nums.length-3]);
      const b = parseFloat(nums[nums.length-2]);
      const c = parseFloat(nums[nums.length-1]);
      if (!isNaN(a)&&!isNaN(b)&&!isNaN(c) && approxEqual(a*b,c)) {
        const desc = line.replace(new RegExp(`(\\d+(?:\\.\\d+)?\\s*){3}$`),'').trim().replace(/[-:]+$/,'');
        if (desc && !skip.test(desc)) {
          let quantity=a, unitPrice=b, total=c;
            if (a<=20 && (b>a || b>20)) { quantity=a; unitPrice=b; total=c; }
            else if (b<=20) { quantity=b; unitPrice=a; total=c; }
          const name = cleanName(desc);
          const key = `${name}|${quantity}|${unitPrice}`;
          if (!seen.has(key) && quantity>0 && unitPrice>0) {
            items.push(enhanceItem({ item_name:name, quantity, unit:'pieces', unit_price:unitPrice, total_price: total, confidence:0.8 }));
            seen.add(key);
          }
          prevName = name; continue;
        }
      }
    }

    prevName = line; // For bare multiplication that may follow
  }
  if (!items.length) {
    console.log('[deterministic-parser] 0 items extracted. First 10 lines:', lines.slice(0,10));
  }
  return items;
}

function enhanceItem(item) {
  const category = categorize(item.item_name);
  return { ...item, category };
}

module.exports = { parseDeterministic };
