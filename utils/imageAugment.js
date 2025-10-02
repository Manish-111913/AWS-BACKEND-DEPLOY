const fs = require('fs');
const path = require('path');

// Cache scan results to avoid repeated fs.existsSync calls per request
const fileExistenceCache = new Map(); // key: absolutePath -> boolean
const slugCache = new Map(); // key: originalName -> slug

const CANDIDATE_EXTS = ['jpg','jpeg','png','webp'];

function slugify(name = '') {
  if (slugCache.has(name)) return slugCache.get(name);
  const slug = name.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
  slugCache.set(name, slug);
  return slug;
}

function existsCached(absPath) {
  if (fileExistenceCache.has(absPath)) return fileExistenceCache.get(absPath);
  const exists = fs.existsSync(absPath);
  fileExistenceCache.set(absPath, exists);
  return exists;
}

function findBestImageVariants(baseDir, uploadsDir, slug) {
  let foundUpload = '';
  let foundStatic = '';
  for (const ext of CANDIDATE_EXTS) {
    if (!foundStatic) {
      const staticCandidate = path.join(baseDir, 'images', `${slug}.${ext}`);
      if (existsCached(staticCandidate)) {
        foundStatic = `images/${slug}.${ext}`; // relative path (server will prefix baseUrl)
      }
    }
    if (!foundUpload) {
      const uploadCandidate = path.join(uploadsDir, 'menu-items', 'original', `${slug}.${ext}`);
      if (existsCached(uploadCandidate)) {
        foundUpload = `uploads/menu-items/original/${slug}.${ext}`;
      }
    }
    if (foundUpload && foundStatic) break;
  }
  return { foundUpload, foundStatic };
}

function buildImageMeta(item, baseUrl, options = {}) {
  // Default to NOT using GridFS now that we serve from CDN/GCS
  const { enableGridFs = false } = options;
  const slug = slugify(item.name || '');
  const slugDash = (item.name || '').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9_-]/g,'');
  const baseDir = path.join(__dirname, '..');
  const uploadsDir = path.join(baseDir, 'uploads');

  const normalizedDbUrl = (() => {
    const url = item.image_url ? String(item.image_url) : '';
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    const rel = url.startsWith('/') ? url : `/${url}`;
    return `${baseUrl}${rel}`;
  })();

  const { foundUpload, foundStatic } = findBestImageVariants(baseDir, uploadsDir, slug);

  // Build GridFS candidate URLs across extensions and slug variants
  const gridFsCandidates = [];
  if (enableGridFs) {
    for (const ext of CANDIDATE_EXTS) {
      gridFsCandidates.push(`${baseUrl}/api/images/by-name/${slug}.${ext}`);
      if (slugDash && slugDash !== slug) {
        gridFsCandidates.push(`${baseUrl}/api/images/by-name/${slugDash}.${ext}`);
      }
    }
  }

  // Compute primary
  // Priority: Explicit DB URL (should point to CDN) -> uploads/static -> (optional) GridFS -> ''
  const primary = normalizedDbUrl || (foundUpload && `${baseUrl}/${foundUpload}`) || (foundStatic && `${baseUrl}/${foundStatic}`) || (enableGridFs ? gridFsCandidates[0] : '') || '';

  // Build ordered fallback list (exclude duplicates and the chosen primary)
  const fallbacks = [];
  const seen = new Set([primary]);
  const pushIf = (u) => { if (u && !seen.has(u)) { fallbacks.push(u); seen.add(u); } };
  // Prefer static/upload alternates first
  pushIf(foundStatic ? `${baseUrl}/${foundStatic}` : '');
  pushIf(foundUpload ? `${baseUrl}/${foundUpload}` : '');
  // Then try all GridFS candidates (only if enabled)
  if (enableGridFs) {
    for (const u of gridFsCandidates) pushIf(u);
  }

  const placeholderSvg = `<svg width="300" height="200" xmlns="http://www.w3.org/2000/svg">\n  <rect width="300" height="200" fill="#ff6b35"/>\n  <text x="150" y="105" font-family="Roboto" font-size="18" font-weight="bold" fill="white" text-anchor="middle">${(item.name||'').substring(0,12)}</text>\n</svg>`;
  const placeholder = `data:image/svg+xml;base64,${Buffer.from(placeholderSvg).toString('base64')}`;

  return {
    img: primary,
    fallback_img: fallbacks[0] || '',
    fallbacks,
    placeholder_img: placeholder,
    _image_debug: { slug, normalizedDbUrl, foundUpload, foundStatic, gridfs: enableGridFs }
  };
}

module.exports = { buildImageMeta };
