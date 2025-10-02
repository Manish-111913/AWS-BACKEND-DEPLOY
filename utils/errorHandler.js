const handleDatabaseError = (error, operation = 'database operation') => {
  console.error(`Database error during ${operation}:`, error);
  
  // PostgreSQL specific error codes
  switch (error.code) {
    case '23505': // Unique constraint violation
      return {
        status: 409,
        message: 'Duplicate entry',
        details: 'A record with this information already exists'
      };
    
    case '23503': // Foreign key violation
      return {
        status: 400,
        message: 'Invalid reference',
        details: 'Referenced record does not exist'
      };
    
    case '23502': // Not null violation
      return {
        status: 400,
        message: 'Missing required field',
        details: error.column ? `Field '${error.column}' is required` : 'Required field is missing'
      };
    
    case '23514': // Check constraint violation
      return {
        status: 400,
        message: 'Invalid data',
        details: 'Data violates database constraints'
      };
    
    case '42P01': // Undefined table
      return {
        status: 500,
        message: 'Database schema error',
        details: 'Required table does not exist'
      };
    
    case '42703': // Undefined column
      return {
        status: 500,
        message: 'Database schema error',
        details: 'Required column does not exist'
      };
    
    case '08003': // Connection does not exist
    case '08006': // Connection failure
      return {
        status: 503,
        message: 'Database connection error',
        details: 'Unable to connect to database'
      };
    
    case '53300': // Too many connections
      return {
        status: 503,
        message: 'Database overloaded',
        details: 'Too many database connections'
      };
    
    default:
      return {
        status: 500,
        message: 'Database error',
        details: error.message || 'An unexpected database error occurred'
      };
  }
};

const handleValidationError = (error) => {
  return {
    status: 400,
    message: 'Validation failed',
    details: error.details || error.message
  };
};

const createErrorResponse = (error, operation = 'operation') => {
  if (error.name === 'ValidationError') {
    return handleValidationError(error);
  }
  
  if (error.code && error.code.startsWith('23') || error.code && error.code.startsWith('42')) {
    return handleDatabaseError(error, operation);
  }
  
  // Default error response
  return {
    status: error.status || 500,
    message: error.message || 'Internal server error',
    details: error.details || null
  };
};

module.exports = {
  handleDatabaseError,
  handleValidationError,
  createErrorResponse
};