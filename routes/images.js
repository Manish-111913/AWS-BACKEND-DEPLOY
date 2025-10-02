const express = require('express');
const router = express.Router();
const { connectMongo, getBucket, ObjectId } = require('../config/mongo');

// Ensure connection once
connectMongo().catch(err => {
  console.error('❌ Mongo connection failed for images route:', err.message);
});

function setCache(res) {
  res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=86400');
}

// GET /api/images/:id (ObjectId)
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) return res.status(400).json({ success: false, error: 'Invalid image id' });
    const bucket = getBucket();

    // Try to fetch file metadata for content type
    const files = await bucket.find({ _id: new ObjectId(id) }).toArray();
    if (!files || files.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
    const file = files[0];
    res.setHeader('Content-Type', file?.metadata?.contentType || 'image/jpeg');
    setCache(res);

    const stream = bucket.openDownloadStream(new ObjectId(id));
    stream.on('error', () => res.status(404).end());
    stream.pipe(res);
  } catch (e) {
    console.error('❌ Images by id error:', e);
    res.status(500).json({ success: false, error: 'Image fetch failed' });
  }
});

// GET /api/images/by-name/:filename
router.get('/by-name/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const bucket = getBucket();
    const files = await bucket.find({ filename }).toArray();
    if (!files || files.length === 0) return res.status(404).json({ success: false, error: 'Not found' });
    const file = files[0];
    res.setHeader('Content-Type', file?.metadata?.contentType || 'image/jpeg');
    setCache(res);
    const stream = bucket.openDownloadStreamByName(filename);
    stream.on('error', () => res.status(404).end());
    stream.pipe(res);
  } catch (e) {
    console.error('❌ Images by name error:', e);
    res.status(500).json({ success: false, error: 'Image fetch failed' });
  }
});

module.exports = router;
