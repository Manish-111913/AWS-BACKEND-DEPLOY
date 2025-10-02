-- QR Code System Database Schema (Simplified for Testing)
-- Run this to create the necessary tables for the anchor-based QR code system

-- QR Codes Table: Stores the permanent QR codes for each table
CREATE TABLE IF NOT EXISTS qr_codes (
    id SERIAL PRIMARY KEY,
    qr_id VARCHAR(32) UNIQUE NOT NULL,              
    table_number VARCHAR(10) UNIQUE NOT NULL,        
    business_id INTEGER DEFAULT 1,                             
    anchor_url TEXT NOT NULL,                        
    is_active BOOLEAN DEFAULT TRUE,                  
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER
);

-- Dining Sessions Table: Tracks active dining sessions for each table
CREATE TABLE IF NOT EXISTS dining_sessions (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(64) UNIQUE NOT NULL,         
    qr_code_id INTEGER NOT NULL,                    
    table_number VARCHAR(10) NOT NULL,              
    business_id INTEGER DEFAULT 1,                             
    is_active BOOLEAN DEFAULT TRUE,                  
    billing_model VARCHAR(20) DEFAULT 'eat_first',  
    customer_count INTEGER DEFAULT 1,               
    session_url TEXT,                                
    
    -- Order and billing information
    total_amount DECIMAL(10, 2) DEFAULT 0.00,
    tax_amount DECIMAL(10, 2) DEFAULT 0.00,
    discount_amount DECIMAL(10, 2) DEFAULT 0.00,
    final_amount DECIMAL(10, 2) DEFAULT 0.00,
    payment_status VARCHAR(20) DEFAULT 'pending',   
    
    -- Session timestamps
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMP NULL,
    last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Staff actions
    assigned_staff INTEGER,                          
    notes TEXT,                                      
    
    -- Constraints
    FOREIGN KEY (qr_code_id) REFERENCES qr_codes(id) ON DELETE CASCADE
);

-- QR Code Scans Table: For analytics and tracking
CREATE TABLE IF NOT EXISTS qr_scans (
    id SERIAL PRIMARY KEY,
    qr_code_id INTEGER NOT NULL,
    session_id INTEGER,                              
    table_number VARCHAR(10) NOT NULL,
    
    -- Device and browser information
    user_agent TEXT,
    device_type VARCHAR(20),                         
    browser_name VARCHAR(50),
    ip_address INET,
    
    -- Location and referrer
    referrer TEXT,
    location_lat DECIMAL(10, 6),
    location_lng DECIMAL(10, 6),
    
    -- Timing information
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    response_time_ms INTEGER,                        
    
    -- Action taken
    action_taken VARCHAR(50),                        
    redirect_url TEXT,
    
    -- Constraints
    FOREIGN KEY (qr_code_id) REFERENCES qr_codes(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES dining_sessions(id) ON DELETE SET NULL
);

-- Orders Table: Links to dining sessions
CREATE TABLE IF NOT EXISTS session_orders (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL,
    order_id INTEGER,                                
    menu_item_id INTEGER,
    item_name VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10, 2) NOT NULL,
    total_price DECIMAL(10, 2) NOT NULL,
    special_instructions TEXT,
    order_status VARCHAR(20) DEFAULT 'placed',       
    ordered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (session_id) REFERENCES dining_sessions(id) ON DELETE CASCADE
);

-- Business Settings Table: For QR code configuration per business
CREATE TABLE IF NOT EXISTS qr_settings (
    id SERIAL PRIMARY KEY,
    business_id INTEGER UNIQUE,                      
    base_url VARCHAR(255) DEFAULT 'https://invexis.com',
    default_billing_model VARCHAR(20) DEFAULT 'eat_first',
    session_timeout_minutes INTEGER DEFAULT 180,    
    enable_analytics BOOLEAN DEFAULT TRUE,
    enable_location_tracking BOOLEAN DEFAULT FALSE,
    custom_redirect_inactive TEXT,                   
    custom_redirect_error TEXT,                      
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_qr_codes_qr_id ON qr_codes(qr_id);
CREATE INDEX IF NOT EXISTS idx_qr_codes_table_number ON qr_codes(table_number);
CREATE INDEX IF NOT EXISTS idx_qr_codes_business_active ON qr_codes(business_id, is_active);

CREATE INDEX IF NOT EXISTS idx_dining_sessions_qr_code ON dining_sessions(qr_code_id);
CREATE INDEX IF NOT EXISTS idx_dining_sessions_active ON dining_sessions(is_active, table_number);
CREATE INDEX IF NOT EXISTS idx_dining_sessions_session_id ON dining_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_dining_sessions_business ON dining_sessions(business_id);

CREATE INDEX IF NOT EXISTS idx_qr_scans_qr_code ON qr_scans(qr_code_id);
CREATE INDEX IF NOT EXISTS idx_qr_scans_date ON qr_scans(scanned_at);
CREATE INDEX IF NOT EXISTS idx_qr_scans_table ON qr_scans(table_number);

CREATE INDEX IF NOT EXISTS idx_session_orders_session ON session_orders(session_id);
CREATE INDEX IF NOT EXISTS idx_session_orders_status ON session_orders(order_status);

-- Add unique constraint for active sessions (only one active session per table)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_session 
ON dining_sessions(qr_code_id) 
WHERE is_active = TRUE;

-- Insert default QR settings
INSERT INTO qr_settings (business_id, base_url, default_billing_model) 
VALUES (1, 'https://invexis.com', 'eat_first')
ON CONFLICT (business_id) DO NOTHING;

-- Comments for documentation
COMMENT ON TABLE qr_codes IS 'Stores permanent QR codes for tables with anchor URLs';
COMMENT ON TABLE dining_sessions IS 'Tracks active dining sessions and customer interactions';
COMMENT ON TABLE qr_scans IS 'Analytics table for tracking QR code usage and customer behavior';
COMMENT ON TABLE session_orders IS 'Orders placed within dining sessions';
COMMENT ON TABLE qr_settings IS 'Business-specific QR code system configuration';