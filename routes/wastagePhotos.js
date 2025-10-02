const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { pool } = require('../config/database');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    fieldSize: 10 * 1024 * 1024, // 10MB field limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif|bmp|tiff|webp)$/i)) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  }
});

// Ensure upload directories exist
const createUploadDirectories = () => {
  const directories = [
    path.join(__dirname, '..', 'uploads'),
    path.join(__dirname, '..', 'uploads', 'stock-out'),
    path.join(__dirname, '..', 'uploads', 'stock-out', 'original'),
    path.join(__dirname, '..', 'uploads', 'stock-out', 'thumbnails')
  ];

  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Created directory: ${dir}`);
    }
  });
};

// Create directories on server start
createUploadDirectories();

// POST /api/wastage/photos/upload - Upload photos for a waste record
router.post('/upload', upload.array('photos', 5), async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { stock_out_id } = req.body;
    
    if (!stock_out_id) {
      return res.status(400).json({
        success: false,
        error: 'stock_out_id is required'
      });
    }
    
    // Check if stock_out_id exists
    const checkQuery = `
      SELECT stock_out_id FROM StockOutRecords 
      WHERE stock_out_id = $1
    `;
    
    const checkResult = await client.query(checkQuery, [stock_out_id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: `Stock out record with ID ${stock_out_id} not found`
      });
    }
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No photos provided'
      });
    }
    
    const uploadedImages = [];
    
    // Process each uploaded file
    for (const file of req.files) {
      // Generate unique filename
      const timestamp = Date.now();
      const fileExt = path.extname(file.originalname);
      const newFilename = `stockout_${stock_out_id}_${timestamp}${fileExt}`;
      
      // Define file paths
      const originalPath = path.join('uploads', 'stock-out', 'original', newFilename);
      const thumbnailPath = path.join('uploads', 'stock-out', 'thumbnails', newFilename);
      
      // Full system paths
      const originalFullPath = path.join(__dirname, '..', originalPath);
      const thumbnailFullPath = path.join(__dirname, '..', thumbnailPath);
      
      // Save original image
      await fs.promises.writeFile(originalFullPath, file.buffer);
      
      // Generate thumbnail
      await sharp(file.buffer)
        .resize(300, 200, { fit: 'cover' })
        .jpeg({ quality: 85 })
        .toFile(thumbnailFullPath);
      
      // Get file stats
      const stats = await fs.promises.stat(originalFullPath);
      
      // Save to ScannedImages table
      const imageQuery = `
        INSERT INTO ScannedImages (
          business_id, file_url, file_path, thumbnail_url, scan_type, 
          uploaded_by_user_id, file_size, mime_type, status, alt_text, upload_date
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        RETURNING image_id
      `;
      
      const imageResult = await client.query(imageQuery, [
        1, // business_id
        `/${originalPath}`,
        originalFullPath,
        `/${thumbnailPath}`,
        'Stock Out',
        req.body.uploaded_by_user_id || 1, // Default to admin if not provided
        stats.size,
        file.mimetype,
        'Uploaded',
        `Waste record photo for stock_out_id ${stock_out_id}`
      ]);
      
      const imageId = imageResult.rows[0].image_id;
      
      // Update StockOutRecords with image reference
      const updateQuery = `
        UPDATE StockOutRecords 
        SET image_id = $1, updated_at = NOW() 
        WHERE stock_out_id = $2
      `;
      
      await client.query(updateQuery, [imageId, stock_out_id]);
      
      uploadedImages.push({
        image_id: imageId,
        file_url: `/${originalPath}`,
        thumbnail_url: `/${thumbnailPath}`,
        file_size: stats.size,
        mime_type: file.mimetype
      });
    }
    
    await client.query('COMMIT');
    
    res.status(201).json({
      success: true,
      message: `Successfully uploaded ${uploadedImages.length} photos for waste record`,
      data: {
        stock_out_id,
        images: uploadedImages
      }
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error uploading waste record photos:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to upload waste record photos',
      details: error.message
    });
  } finally {
    client.release();
  }
});

// GET /api/wastage/photos/:stock_out_id - Get photos for a waste record
router.get('/:stock_out_id', async (req, res) => {
  try {
    const { stock_out_id } = req.params;
    
    const query = `
      SELECT 
        si.image_id,
        si.file_url,
        si.thumbnail_url,
        si.file_size,
        si.mime_type,
        si.upload_date
      FROM StockOutRecords sor
      JOIN ScannedImages si ON sor.image_id = si.image_id
      WHERE sor.stock_out_id = $1
    `;
    
    const result = await pool.query(query, [stock_out_id]);
    
    res.status(200).json({
      success: true,
      data: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching waste record photos:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch waste record photos',
      details: error.message
    });
  }
});

// Error handler middleware
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large',
        details: 'Maximum file size is 10MB'
      });
    }
    
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        error: 'Too many files',
        details: 'Maximum 5 photos allowed'
      });
    }
    
    return res.status(400).json({
      success: false,
      error: 'File upload error',
      details: error.message
    });
  }
  
  if (error.message === 'Only image files are allowed!') {
    return res.status(400).json({
      success: false,
      error: 'Invalid file type',
      details: 'Only image files (jpg, jpeg, png, gif, bmp, tiff, webp) are allowed'
    });
  }

  next(error);
});

module.exports = router;