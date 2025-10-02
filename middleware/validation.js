const Joi = require('joi');

// Schema for sale items
const saleItemSchema = Joi.object({
  menuItemId: Joi.number().integer().positive().required()
    .messages({
      'number.base': 'Menu item ID must be a number',
      'number.integer': 'Menu item ID must be an integer',
      'number.positive': 'Menu item ID must be positive',
      'any.required': 'Menu item ID is required'
    }),
  quantity: Joi.number().positive().required()
    .messages({
      'number.base': 'Quantity must be a number',
      'number.positive': 'Quantity must be positive',
      'any.required': 'Quantity is required'
    }),
  unitPrice: Joi.number().positive().precision(2).required()
    .messages({
      'number.base': 'Unit price must be a number',
      'number.positive': 'Unit price must be positive',
      'any.required': 'Unit price is required'
    })
});

// Schema for complete sale data
const saleSchema = Joi.object({
  businessId: Joi.number().integer().positive().required()
    .messages({
      'number.base': 'Business ID must be a number',
      'number.integer': 'Business ID must be an integer',
      'number.positive': 'Business ID must be positive',
      'any.required': 'Business ID is required'
    }),
  customerId: Joi.number().integer().positive().allow(null).optional()
    .messages({
      'number.base': 'Customer ID must be a number',
      'number.integer': 'Customer ID must be an integer',
      'number.positive': 'Customer ID must be positive'
    }),
  items: Joi.array().items(saleItemSchema).min(1).required()
    .messages({
      'array.base': 'Items must be an array',
      'array.min': 'At least one item is required',
      'any.required': 'Items array is required'
    }),
  paymentMethod: Joi.string().valid('Cash', 'Card', 'UPI', 'Other').default('Cash')
    .messages({
      'string.base': 'Payment method must be a string',
      'any.only': 'Payment method must be one of: Cash, Card, UPI, Other'
    })
});

// Schema for sales report parameters
const salesReportSchema = Joi.object({
  businessId: Joi.number().integer().positive().required()
    .messages({
      'number.base': 'Business ID must be a number',
      'number.integer': 'Business ID must be an integer',
      'number.positive': 'Business ID must be positive',
      'any.required': 'Business ID is required'
    }),
  startDate: Joi.date().iso().required()
    .messages({
      'date.base': 'Start date must be a valid date',
      'any.required': 'Start date is required'
    }),
  endDate: Joi.date().iso().min(Joi.ref('startDate')).required()
    .messages({
      'date.base': 'End date must be a valid date',
      'date.min': 'End date cannot be before start date',
      'any.required': 'End date is required'
    }),
  groupBy: Joi.string().valid('day', 'week', 'month').default('day')
    .messages({
      'string.base': 'Group by must be a string',
      'any.only': 'Group by must be one of: day, week, month'
    })
});

const stockInItemSchema = Joi.object({
  item_name: Joi.string().trim().min(1).max(255).required()
    .messages({
      'string.empty': 'Item name cannot be empty',
      'string.min': 'Item name must be at least 1 character long',
      'string.max': 'Item name cannot exceed 255 characters',
      'any.required': 'Item name is required'
    }),
  category: Joi.string().trim().valid('Meat','Seafood','Vegetables','Dairy','Spices','Grains','Beverages','Oils').required()
    .messages({
      'any.only': 'Category must be one of: Meat, Seafood, Vegetables, Dairy, Spices, Grains, Beverages, Oils',
      'string.empty': 'Category cannot be empty',
      'any.required': 'Category is required'
    }),
  quantity: Joi.number().positive().precision(3).required()
    .messages({
      'number.positive': 'Quantity must be a positive number',
      'any.required': 'Quantity is required'
    }),
  unit: Joi.string().trim().min(1).max(50).required()
    .messages({
      'string.empty': 'Unit cannot be empty',
      'any.required': 'Unit is required'
    }),
  unit_price: Joi.number().min(0).precision(2).required()
    .messages({
      'number.min': 'Unit price cannot be negative',
      'any.required': 'Unit price is required'
    }),
  batch_number: Joi.string().trim().min(1).max(100).required()
    .messages({
      'any.required': 'Batch number is required',
      'string.empty': 'Batch number cannot be empty'
    }),
  expiry_date: Joi.date().iso().allow(null).optional()
    .messages({
      'date.min': 'Expiry date cannot be in the past'
    }),
  time: Joi.string().pattern(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).optional()
    .messages({
      'string.pattern.base': 'Time must be in HH:MM format'
    })
  ,
  client_lock: Joi.boolean().optional(),
  original_ocr_name: Joi.string().trim().max(255).allow('', null).optional()
});

const stockInSchema = Joi.object({
  vendor_name: Joi.string().trim().min(1).max(255).required()
    .messages({
      'string.empty': 'Vendor name cannot be empty',
      'any.required': 'Vendor name is required'
    }),
  vendor_phone: Joi.string().trim().allow('', null).optional(),
  shift: Joi.string().valid('Morning', 'Afternoon', 'Evening', 'Night').required()
    .messages({
      'any.only': 'Shift must be one of: Morning, Afternoon, Evening, Night',
      'any.required': 'Shift is required'
    }),
  items: Joi.array().items(stockInItemSchema).min(1).max(50).required()
    .messages({
      'array.min': 'At least one item is required',
      'array.max': 'Cannot exceed 50 items per submission',
      'any.required': 'Items array is required'
    })
});

const validateStockIn = (req, res, next) => {
  try {
    // Check if request body exists
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: [{ field: 'body', message: 'Request body is required' }]
      });
    }

    const { error, value } = stockInSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
      convert: true
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        }))
      });
    }

    // Additional business logic validation
    const duplicateBatches = [];
    const batchNumbers = value.items.map(item => item.batch_number);
    const uniqueBatches = [...new Set(batchNumbers)];
    
    if (batchNumbers.length !== uniqueBatches.length) {
      batchNumbers.forEach((batch, index) => {
        if (batchNumbers.indexOf(batch) !== index) {
          duplicateBatches.push({
            field: `items.${index}.batch_number`,
            message: `Duplicate batch number: ${batch}`,
            value: batch
          });
        }
      });
    }

    // Check for case-insensitive duplicate item names within the same submission
    const duplicateItems = [];
    const itemNames = value.items.map(item => item.item_name.toLowerCase().trim());
    const seenNames = new Set();
    
    itemNames.forEach((lowerName, index) => {
      if (seenNames.has(lowerName)) {
        duplicateItems.push({
          field: `items.${index}.item_name`,
          message: `Duplicate item name (case-insensitive): ${value.items[index].item_name}`,
          value: value.items[index].item_name
        });
      } else {
        seenNames.add(lowerName);
      }
    });

    const allErrors = [...duplicateBatches, ...duplicateItems];
    if (allErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: allErrors
      });
    }

    req.validatedData = value;
    next();
  } catch (validationError) {
    console.error('Validation middleware error:', validationError);
    return res.status(500).json({
      success: false,
      error: 'Validation processing failed',
      details: validationError.message
    });
  }
};

// Validation middleware for sale data
const validateSaleData = (req, res, next) => {
  try {
    const { error, value } = saleSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
      convert: true
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        }))
      });
    }

    req.validatedData = value;
    next();
  } catch (validationError) {
    console.error('Sale validation error:', validationError);
    return res.status(500).json({
      success: false,
      error: 'Validation processing failed',
      details: validationError.message
    });
  }
};

// Validation middleware for sales report parameters
const validateSalesReportParams = (req, res, next) => {
  try {
    const { error, value } = salesReportSchema.validate(req.query, {
      abortEarly: false,
      stripUnknown: true,
      convert: true
    });

    if (error) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        }))
      });
    }

    req.validatedParams = value;
    next();
  } catch (validationError) {
    console.error('Sales report validation error:', validationError);
    return res.status(500).json({
      success: false,
      error: 'Validation processing failed',
      details: validationError.message
    });
  }
};

module.exports = { 
  validateStockIn,
  validateSaleData,
  validateSalesReportParams
};
