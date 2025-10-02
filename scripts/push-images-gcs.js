// Upload all files in backend/images to Google Cloud Storage and update MenuItems.image_url
// Requires env vars in backend/.env: GOOGLE_APPLICATION_CREDENTIALS, GCS_BUCKET, IMAGE_CDN_BASE
// Usage: npm run images:push

const fs = require('fs');
const path = require('path');

// Load backend env explicitly so running from project root still works
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
}

const { Storage } = require('@google-cloud/storage');
const { pool } = require('../config/database');

function contentTypeFor(ext) {
  const e = (ext || '').toLowerCase();
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.png') return 'image/png';
  if (e === '.webp') return 'image/webp';
  if (e === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

function normalizeNameForCompare(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function ensurePublic(file) {
  // Make the object publicly readable; ignore errors if already public
  try {
    await file.makePublic();
  } catch (e) {
    if (e && e.code !== 412) { // 412 Precondition may occur on some ACL configs
      console.warn('⚠️  makePublic warning:', e.message);
    }
  }
}

async function main() {
  const bucketName = process.env.GCS_BUCKET;
  const cdnBase = process.env.IMAGE_CDN_BASE || '';

  if (!bucketName) {
    console.error('❌ GCS_BUCKET not set in backend/.env');
    process.exit(1);
  }

  const imagesDir = path.join(__dirname, '..', 'images');
  if (!fs.existsSync(imagesDir)) {
    console.error('❌ images directory not found at', imagesDir);
    process.exit(1);
  }

  // Initialize GCS client (uses GOOGLE_APPLICATION_CREDENTIALS)
  const storage = new Storage();
  const bucket = storage.bucket(bucketName);

  const files = fs.readdirSync(imagesDir).filter(f => fs.statSync(path.join(imagesDir, f)).isFile());
  console.log(`📂 Found ${files.length} files to process`);

  // Fetch active menu items for name matching
  const sql = `SELECT menu_item_id, name FROM MenuItems WHERE business_id = 1 AND is_active = true`;
  const menuRes = await pool.query(sql);
  const items = menuRes.rows || [];

  let uploaded = 0, skipped = 0, linked = 0, notMatched = 0;

  for (const fname of files) {
    const full = path.join(imagesDir, fname);
    const ext = path.extname(fname);
    const base = path.basename(fname);
    const ct = contentTypeFor(ext);

    // Destination path inside bucket
    const destPath = `menu-items/${base}`;
    const file = bucket.file(destPath);

    // Check if exists
    const [exists] = await file.exists();
    if (!exists) {
      await bucket.upload(full, {
        destination: destPath,
        contentType: ct,
        metadata: { contentType: ct },
        // If uniform bucket-level access is disabled, the following works; otherwise we call makePublic
        predefinedAcl: 'publicRead'
      }).catch(async (err) => {
        // Fallback without predefinedAcl if bucket enforces uniform access
        console.warn('⚠️  upload with predefinedAcl failed, retrying without ACL:', err.message);
        await bucket.upload(full, { destination: destPath, metadata: { contentType: ct } });
      });
      await ensurePublic(file);
      uploaded++;
      console.log(`⬆️  Uploaded gs://${bucketName}/${destPath}`);
    } else {
      skipped++;
      // still ensure public
      await ensurePublic(file);
      console.log(`⏭️  Skipped existing gs://${bucketName}/${destPath}`);
    }

    // Build public URL
    const publicUrl = cdnBase ? `${cdnBase}/${destPath}` : `https://storage.googleapis.com/${bucketName}/${destPath}`;

    // Try to map to a MenuItem by name (match filename without ext to item name)
    const filenameName = normalizeNameForCompare(path.basename(base, ext));
    const match = items.find(r => normalizeNameForCompare(r.name) === filenameName);
    if (match) {
      await pool.query(
        'UPDATE MenuItems SET image_url = $1, updated_at = CURRENT_TIMESTAMP WHERE menu_item_id = $2',
        [publicUrl, match.menu_item_id]
      );
      linked++;
      console.log(`🔗 Linked ${base} -> MenuItem ${match.menu_item_id} (${match.name})`);
    } else {
      notMatched++;
      console.warn(`⚠️  No MenuItem match for ${base}`);
    }
  }

  console.log(`\n✅ Done. Uploaded: ${uploaded}, Skipped: ${skipped}, Linked: ${linked}, Unmatched: ${notMatched}`);
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
