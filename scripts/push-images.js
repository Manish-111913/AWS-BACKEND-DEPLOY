// Upload all files in backend/images to MongoDB GridFS and update MenuItems.image_url
const fs = require('fs');
const path = require('path');
const { connectMongo } = require('../config/mongo');
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

async function main() {
  const imagesDir = path.join(__dirname, '..', 'images');
  if (!fs.existsSync(imagesDir)) {
    console.error('❌ images directory not found at', imagesDir);
    process.exit(1);
  }

  const { bucket, db } = await connectMongo();
  console.log('✅ Connected to MongoDB for GridFS');

  const files = fs.readdirSync(imagesDir).filter(f => fs.statSync(path.join(imagesDir, f)).isFile());
  console.log(`📂 Found ${files.length} files to process`);

  let uploaded = 0, updated = 0, skipped = 0;

  for (const fname of files) {
    const full = path.join(imagesDir, fname);
    const ext = path.extname(fname);
    const base = path.basename(fname);
    const ct = contentTypeFor(ext);

    // Upload if not present by filename
    const existing = await bucket.find({ filename: base }).toArray();
    if (existing.length === 0) {
      await new Promise((resolve, reject) => {
        const upload = bucket.openUploadStream(base, { metadata: { contentType: ct } });
        fs.createReadStream(full).pipe(upload)
          .on('error', reject)
          .on('finish', resolve);
      });
      uploaded++;
      console.log(`⬆️  Uploaded ${base}`);
    } else {
      skipped++;
      console.log(`⏭️  Skipped ${base} (already in GridFS)`);
    }

    // Try to map to a MenuItem by name
    const filenameName = normalizeNameForCompare(path.basename(base, ext));
    const query = `
      SELECT menu_item_id, name FROM MenuItems WHERE business_id = 1 AND is_active = true`;
    const res = await pool.query(query);
    const match = res.rows.find(r => normalizeNameForCompare(r.name) === filenameName);
    if (match) {
      const url = `/api/images/by-name/${base}`;
      await pool.query('UPDATE MenuItems SET image_url = $1, updated_at = CURRENT_TIMESTAMP WHERE menu_item_id = $2', [url, match.menu_item_id]);
      updated++;
      console.log(`🔗 Linked ${base} -> MenuItem ${match.menu_item_id} (${match.name})`);
    } else {
      console.warn(`⚠️  No MenuItem match for ${base}`);
    }
  }

  console.log(`\n✅ Done. Uploaded: ${uploaded}, Skipped: ${skipped}, Linked: ${updated}`);
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
