-- Database migration: Create Orders and OrderItems tables for QR billing integration

-- Create Orders table
CREATE TABLE IF NOT EXISTS Orders (
    order_id SERIAL PRIMARY KEY,
    business_id INTEGER NOT NULL,
    customer_name VARCHAR(255),
    customer_phone VARCHAR(20),
    table_number VARCHAR(50),
    order_source VARCHAR(50) DEFAULT 'QR_BILLING', -- QR_BILLING, DINE_IN, TAKEAWAY, DELIVERY
    status VARCHAR(20) DEFAULT 'PLACED', -- PLACED, PREPARING, READY, COMPLETED, CANCELLED
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    special_requests TEXT,
    estimated_time INTEGER DEFAULT 20, -- minutes
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create OrderItems table
CREATE TABLE IF NOT EXISTS OrderItems (
    order_item_id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES Orders(order_id) ON DELETE CASCADE,
    menu_item_id INTEGER, -- Optional reference to MenuItems
    item_name VARCHAR(255) NOT NULL, -- Store name in case menu item is deleted
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    customizations TEXT, -- JSON array of customizations
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_orders_business_id ON Orders(business_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON Orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON Orders(created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON OrderItems(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_menu_item_id ON OrderItems(menu_item_id);

-- Add RLS policies for multi-tenancy
ALTER TABLE Orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE OrderItems ENABLE ROW LEVEL SECURITY;

-- Orders RLS policy
CREATE POLICY orders_business_policy ON Orders
    FOR ALL
    USING (business_id = COALESCE(current_setting('rls.business_id', true)::integer, business_id));

-- OrderItems RLS policy (through Orders table)
CREATE POLICY order_items_business_policy ON OrderItems
    FOR ALL
    USING (order_id IN (
        SELECT order_id FROM Orders 
        WHERE business_id = COALESCE(current_setting('rls.business_id', true)::integer, business_id)
    ));

-- Add a trigger to update item_name from MenuItems when inserting OrderItems
CREATE OR REPLACE FUNCTION update_order_item_name()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.menu_item_id IS NOT NULL AND (NEW.item_name IS NULL OR NEW.item_name = '') THEN
        SELECT name INTO NEW.item_name 
        FROM MenuItems 
        WHERE menu_item_id = NEW.menu_item_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_order_item_name
    BEFORE INSERT OR UPDATE ON OrderItems
    FOR EACH ROW
    EXECUTE FUNCTION update_order_item_name();

-- Add some sample data for testing (optional)
-- You can remove this section if you don't want sample data

/*
INSERT INTO Orders (business_id, customer_name, table_number, order_source, status, total_amount, special_requests) VALUES
(1, 'QR Customer 1', 'QR-001', 'QR_BILLING', 'PLACED', 150.00, '["No spicy food"]'),
(1, 'QR Customer 2', 'QR-002', 'QR_BILLING', 'PREPARING', 200.50, '["Extra sauce", "Rush order"]'),
(1, 'Walk-in Customer', 'Table 05', 'DINE_IN', 'READY', 180.00, '[]');

INSERT INTO OrderItems (order_id, menu_item_id, item_name, quantity, unit_price, customizations) VALUES
(1, 16, 'Chicken Biryani', 1, 250.00, '["Medium spice"]'),
(1, 6, 'Lassi', 2, 50.00, '["Sweet"]'),
(2, 18, 'Paneer Butter Masala', 1, 180.00, '["Extra cream"]'),
(2, 3, 'Masala Chai', 1, 25.00, '[]'),
(3, 16, 'Chicken Biryani', 1, 250.00, '["Spicy"]');
*/

COMMENT ON TABLE Orders IS 'Customer orders from QR billing and other sources';
COMMENT ON TABLE OrderItems IS 'Individual items within each order';
COMMENT ON COLUMN Orders.order_source IS 'Source of the order: QR_BILLING, DINE_IN, TAKEAWAY, DELIVERY';
COMMENT ON COLUMN Orders.status IS 'Order status: PLACED, PREPARING, READY, COMPLETED, CANCELLED';
COMMENT ON COLUMN OrderItems.customizations IS 'JSON array of item customizations like ["Extra spicy", "No onions"]';