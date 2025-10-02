const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { buildImageMeta } = require('../utils/imageAugment');

// Helper: get business id from headers/query with default
function getBusinessId(req) {
  const val = req.headers['x-tenant-id'] || req.headers['X-Tenant-Id'] ||
              req.headers['x-business-id'] || req.headers['X-Business-Id'] ||
              req.query.tenant || req.query.businessId || '1';
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

// GET /api/qr-billing/items -> All menu items mapped to inventory (via recipes), with images
router.get('/items', async (req, res) => {
  try {
    const businessId = getBusinessId(req);
    const includeComplimentary = ['1', 'true', 'yes'].includes(String(req.query?.includeComplimentary || '').toLowerCase());

    // Enforce tenant context (RLS) for this connection
    await pool.query("SELECT set_config('app.current_business_id', $1, false)", [businessId]);

    // Base conditions
    const conditions = [
      'mi.business_id = $1',
      'mi.is_active = true',
      'mi.is_available_to_customer = true'
    ];

    // Exclude complimentary items (category or common complimentary suffixes) unless explicitly requested
    if (!includeComplimentary) {
      // Exclude if category looks complimentary
      conditions.push("(mc.name IS NULL OR mc.name !~* '^complimentary( items)?$')");
      // Exclude names ending with common complimentary words (space or end)
      conditions.push("mi.name !~* '(chutney|sambar|podi|raita|pickle|papad|buttermilk|curd|lemon|onion|carrot|mint|coconut|salad)\\s*$'");
    }

    const query = `
      SELECT 
        mi.menu_item_id AS id,
        mi.name,
        mi.price,
        mi.image_url,
        mi.avg_prep_time_minutes,
        mi.is_available_to_customer,
        COALESCE(mc.name, 'Other') AS category,
        COUNT(ri.recipe_ingredient_id) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM InventoryItems iix
            WHERE iix.item_id = ri.item_id AND iix.business_id = $1
          )
        ) AS ingredient_count
      FROM MenuItems mi
      LEFT JOIN MenuCategories mc ON mi.category_id = mc.category_id
      LEFT JOIN RecipeIngredients ri ON ri.recipe_id = mi.menu_item_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY mi.menu_item_id, mi.name, mi.price, mi.image_url, mi.avg_prep_time_minutes, mi.is_available_to_customer, mc.name
      HAVING COUNT(ri.recipe_ingredient_id) FILTER (
        WHERE EXISTS (
          SELECT 1 FROM InventoryItems iih
          WHERE iih.item_id = ri.item_id AND iih.business_id = $1
        )
      ) > 0
      ORDER BY mc.name, mi.name;`;

    const result = await pool.query(query, [businessId]);

    const protocol = req.protocol;
    const host = req.get('host');
    const baseUrl = `${protocol}://${host}`;

    const items = result.rows.map(r => {
      const meta = buildImageMeta({ name: r.name, image_url: r.image_url }, baseUrl, { enableGridFs: false });
      const primaryImage = meta.img || meta.fallback_img || r.image_url || meta.placeholder_img;
      return {
        id: r.id,
        name: r.name,
        category: r.category,
        price: Number(r.price),
        avg_prep_time_minutes: r.avg_prep_time_minutes || null,
        is_available_to_customer: !!r.is_available_to_customer,
        // Backward-compat primary field
        image: primaryImage,
        // Full metadata for robust UIs
        img: meta.img,
        fallback_img: meta.fallback_img,
        fallbacks: meta.fallbacks,
        placeholder_img: meta.placeholder_img,
        ingredient_count: Number(r.ingredient_count) || 0
      };
    });

    return res.json({ success: true, business_id: businessId, count: items.length, data: items });
  } catch (err) {
    console.error('Error fetching QR Billing items:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch QR Billing items' });
  }
});

module.exports = router;
