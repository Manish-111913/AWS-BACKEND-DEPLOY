-- Multitenant Architecture Schema for QR Billing System
-- This schema supports three tenant strategies:
-- 1. Shared Database + Shared Schema (tenant_id filtering)
-- 2. Shared Database + Separate Schemas (schema per tenant)
-- 3. Separate Databases (database per tenant)

-- =====================================================
-- TENANT MANAGEMENT TABLES
-- =====================================================

-- Tenants Master Table
CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(50) UNIQUE NOT NULL,          -- Unique identifier (e.g., 'restaurant_abc', 'hotel_xyz')
    name VARCHAR(255) NOT NULL,                     -- Display name
    domain VARCHAR(255),                            -- Custom domain (optional)
    subdomain VARCHAR(100),                         -- Subdomain (e.g., 'abc.invexis.com')
    
    -- Tenant Strategy Configuration
    tenant_strategy VARCHAR(20) NOT NULL DEFAULT 'shared_schema', -- 'shared_schema', 'separate_schema', 'separate_database'
    database_name VARCHAR(100),                     -- For separate database strategy
    schema_name VARCHAR(100),                       -- For separate schema strategy
    
    -- Database Connection Details (for separate database strategy)
    db_host VARCHAR(255),
    db_port INTEGER,
    db_user VARCHAR(100),
    db_password_encrypted TEXT,                     -- Encrypted password
    db_ssl_enabled BOOLEAN DEFAULT TRUE,
    
    -- Tenant Status and Limits
    status VARCHAR(20) DEFAULT 'active',            -- 'active', 'suspended', 'terminated'
    subscription_plan VARCHAR(50) DEFAULT 'basic',  -- 'basic', 'premium', 'enterprise'
    max_tables INTEGER DEFAULT 50,                  -- Table limit
    max_users INTEGER DEFAULT 10,                   -- User limit
    max_orders_per_day INTEGER DEFAULT 1000,        -- Daily order limit
    
    -- Billing and Subscription
    subscription_start_date DATE,
    subscription_end_date DATE,
    billing_cycle VARCHAR(20) DEFAULT 'monthly',    -- 'monthly', 'yearly'
    monthly_fee DECIMAL(10, 2) DEFAULT 0.00,
    
    -- Tenant Metadata
    timezone VARCHAR(50) DEFAULT 'UTC',
    currency VARCHAR(3) DEFAULT 'USD',
    language VARCHAR(5) DEFAULT 'en',
    country VARCHAR(2) DEFAULT 'US',
    
    -- Contact Information
    contact_name VARCHAR(255),
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    address TEXT,
    
    -- Technical Configuration
    api_key VARCHAR(64) UNIQUE,                     -- For API access
    webhook_url TEXT,                               -- For notifications
    custom_logo_url TEXT,
    custom_theme_colors JSONB,                      -- Custom branding
    
    -- Audit Fields
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER,
    last_login_at TIMESTAMP
);

-- Tenant Users (for multi-user tenants)
CREATE TABLE IF NOT EXISTS tenant_users (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(50) NOT NULL,
    user_id INTEGER NOT NULL,                       -- Reference to main users table
    role VARCHAR(50) DEFAULT 'staff',               -- 'owner', 'admin', 'manager', 'staff'
    permissions JSONB DEFAULT '{}',                 -- Custom permissions
    is_active BOOLEAN DEFAULT TRUE,
    
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_access_at TIMESTAMP,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

-- Tenant Configuration Settings
CREATE TABLE IF NOT EXISTS tenant_settings (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(50) NOT NULL,
    setting_key VARCHAR(100) NOT NULL,
    setting_value TEXT,
    setting_type VARCHAR(20) DEFAULT 'string',      -- 'string', 'number', 'boolean', 'json'
    is_encrypted BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    UNIQUE (tenant_id, setting_key)
);

-- Tenant Database Schemas (for schema-per-tenant strategy)
CREATE TABLE IF NOT EXISTS tenant_schemas (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(50) NOT NULL,
    schema_name VARCHAR(100) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    schema_version VARCHAR(20) DEFAULT '1.0.0',
    migration_status VARCHAR(20) DEFAULT 'completed', -- 'pending', 'running', 'completed', 'failed'
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_migration_at TIMESTAMP,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    UNIQUE (tenant_id, schema_name)
);

-- Tenant Activity Logs
CREATE TABLE IF NOT EXISTS tenant_activity_logs (
    id SERIAL PRIMARY KEY,
    tenant_id VARCHAR(50) NOT NULL,
    user_id INTEGER,
    activity_type VARCHAR(50) NOT NULL,             -- 'login', 'qr_generate', 'order_create', etc.
    activity_description TEXT,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB DEFAULT '{}',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

-- =====================================================
-- UPDATED EXISTING TABLES FOR MULTITENANT
-- =====================================================

-- Add tenant_id to existing tables (if not already present)
-- Note: We'll keep business_id for backward compatibility but add tenant_id

ALTER TABLE qr_codes ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50);
ALTER TABLE dining_sessions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50);
ALTER TABLE qr_scans ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50);
ALTER TABLE session_orders ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50);
ALTER TABLE qr_settings ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(50);

-- Add foreign key constraints to existing tables
-- (We'll handle this in the migration scripts to avoid conflicts)

-- =====================================================
-- TENANT STRATEGY SPECIFIC INDEXES
-- =====================================================

-- Indexes for shared schema strategy (tenant_id filtering)
CREATE INDEX IF NOT EXISTS idx_qr_codes_tenant ON qr_codes(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dining_sessions_tenant ON dining_sessions(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_qr_scans_tenant ON qr_scans(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_session_orders_tenant ON session_orders(tenant_id) WHERE tenant_id IS NOT NULL;

-- Compound indexes for performance
CREATE INDEX IF NOT EXISTS idx_qr_codes_tenant_active ON qr_codes(tenant_id, is_active) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dining_sessions_tenant_active ON dining_sessions(tenant_id, is_active) WHERE tenant_id IS NOT NULL;

-- Tenant management indexes
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_strategy ON tenants(tenant_strategy);
CREATE INDEX IF NOT EXISTS idx_tenants_domain ON tenants(domain) WHERE domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenants_subdomain ON tenants(subdomain) WHERE subdomain IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_users_tenant ON tenant_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_user ON tenant_users(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_users_active ON tenant_users(tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_tenant_settings_tenant ON tenant_settings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_settings_key ON tenant_settings(setting_key);

CREATE INDEX IF NOT EXISTS idx_tenant_activity_tenant_time ON tenant_activity_logs(tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tenant_activity_type ON tenant_activity_logs(activity_type);

-- =====================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS on tables for additional security
ALTER TABLE qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE dining_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_orders ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (these can be enabled/disabled per tenant strategy)
-- Policy for shared schema strategy
CREATE POLICY IF NOT EXISTS tenant_isolation_qr_codes ON qr_codes 
    USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY IF NOT EXISTS tenant_isolation_dining_sessions ON dining_sessions 
    USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY IF NOT EXISTS tenant_isolation_qr_scans ON qr_scans 
    USING (tenant_id = current_setting('app.current_tenant_id', true));

CREATE POLICY IF NOT EXISTS tenant_isolation_session_orders ON session_orders 
    USING (tenant_id = current_setting('app.current_tenant_id', true));

-- =====================================================
-- SAMPLE DATA FOR TESTING
-- =====================================================

-- Insert sample tenants for testing different strategies
INSERT INTO tenants (tenant_id, name, tenant_strategy, max_tables, api_key, status) VALUES 
('restaurant_demo', 'Demo Restaurant', 'shared_schema', 10, 'demo_api_key_123', 'active'),
('hotel_premium', 'Premium Hotel', 'separate_schema', 100, 'hotel_api_key_456', 'active'),
('cafe_enterprise', 'Enterprise Cafe Chain', 'separate_database', 500, 'cafe_api_key_789', 'active')
ON CONFLICT (tenant_id) DO NOTHING;

-- Update existing data to have tenant_id (migration step)
-- This will be handled in the application logic

-- =====================================================
-- UTILITY FUNCTIONS
-- =====================================================

-- Function to get tenant configuration
CREATE OR REPLACE FUNCTION get_tenant_config(p_tenant_id VARCHAR(50))
RETURNS TABLE (
    tenant_id VARCHAR(50),
    name VARCHAR(255),
    tenant_strategy VARCHAR(20),
    database_name VARCHAR(100),
    schema_name VARCHAR(100),
    status VARCHAR(20)
) AS $$
BEGIN
    RETURN QUERY
    SELECT t.tenant_id, t.name, t.tenant_strategy, t.database_name, t.schema_name, t.status
    FROM tenants t
    WHERE t.tenant_id = p_tenant_id AND t.status = 'active';
END;
$$ LANGUAGE plpgsql;

-- Function to validate tenant access
CREATE OR REPLACE FUNCTION validate_tenant_access(p_tenant_id VARCHAR(50), p_api_key VARCHAR(64))
RETURNS BOOLEAN AS $$
DECLARE
    tenant_exists BOOLEAN DEFAULT FALSE;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM tenants 
        WHERE tenant_id = p_tenant_id 
        AND api_key = p_api_key 
        AND status = 'active'
    ) INTO tenant_exists;
    
    RETURN tenant_exists;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE tenants IS 'Master table for all tenants supporting multiple isolation strategies';
COMMENT ON TABLE tenant_users IS 'User access management per tenant';
COMMENT ON TABLE tenant_settings IS 'Flexible configuration system per tenant';
COMMENT ON TABLE tenant_schemas IS 'Schema management for separate schema strategy';
COMMENT ON TABLE tenant_activity_logs IS 'Activity tracking and audit logs per tenant';

COMMENT ON COLUMN tenants.tenant_strategy IS 'Isolation strategy: shared_schema, separate_schema, or separate_database';
COMMENT ON COLUMN tenants.database_name IS 'Used for separate_database strategy';
COMMENT ON COLUMN tenants.schema_name IS 'Used for separate_schema strategy';