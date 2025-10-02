-- Migration: 20250918_add_qr_billing_module.sql
-- Purpose: Add QR Billing / Real-Time Ordering & Loyalty/Recommendation layer + billing_type column
-- Idempotent: YES (safe to re-run)
-- Apply order: Run as-is (no explicit transaction due to CREATE INDEX CONCURRENTLY usage)

/* ===================== 1. ENUM DEFINITIONS ===================== */
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='billing_type_enum') THEN
    CREATE TYPE billing_type_enum AS ENUM('thermal_pos','qr_billing');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='session_status_enum') THEN
    CREATE TYPE session_status_enum AS ENUM('active','completed','cleared');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='order_status_enum') THEN
    CREATE TYPE order_status_enum AS ENUM('PLACED','IN_PROGRESS','READY','COMPLETED','DELAYED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='order_item_status_enum') THEN
    CREATE TYPE order_item_status_enum AS ENUM('QUEUED','IN_PROGRESS','COMPLETED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='order_payment_status_enum') THEN
    CREATE TYPE order_payment_status_enum AS ENUM('unpaid','partially_paid','paid');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='recommendation_rule_type_enum') THEN
    CREATE TYPE recommendation_rule_type_enum AS ENUM('pairing','time_based','upsell');
  END IF;
END $$;

/* ===================== 2. COLUMN ADDITIONS ===================== */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='businesses' AND column_name='billing_type'
  ) THEN
    ALTER TABLE Businesses
      ADD COLUMN billing_type billing_type_enum NOT NULL DEFAULT 'thermal_pos';
  END IF;
END $$;

/* ===================== 3. CORE QR ORDERING TABLES ===================== */
CREATE TABLE IF NOT EXISTS QRCodes (
  qr_code_id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES Businesses(business_id),
  table_number VARCHAR(50) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, table_number)
);

CREATE TABLE IF NOT EXISTS DiningSessions (
  session_id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES Businesses(business_id),
  qr_code_id INT NOT NULL REFERENCES QRCodes(qr_code_id),
  start_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  end_time TIMESTAMP,
  status session_status_enum NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='qrcodes' AND column_name='current_session_id'
  ) THEN
    ALTER TABLE QRCodes
      ADD COLUMN current_session_id INT REFERENCES DiningSessions(session_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS Orders (
  order_id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES Businesses(business_id),
  dining_session_id INT NOT NULL REFERENCES DiningSessions(session_id) ON DELETE CASCADE,
  status order_status_enum NOT NULL DEFAULT 'PLACED',
  customer_prep_time_minutes INT NOT NULL,
  customer_timer_paused BOOLEAN NOT NULL DEFAULT FALSE,
  payment_status order_payment_status_enum NOT NULL DEFAULT 'unpaid',
  placed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS OrderItems (
  order_item_id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES Orders(order_id) ON DELETE CASCADE,
  menu_item_id INT NOT NULL REFERENCES MenuItems(menu_item_id),
  item_status order_item_status_enum NOT NULL DEFAULT 'QUEUED',
  prep_start_time TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS SpecialRequests (
  request_id SERIAL PRIMARY KEY,
  order_item_id INT NOT NULL REFERENCES OrderItems(order_item_id) ON DELETE CASCADE,
  free_form_note TEXT,
  kitchen_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='orderitems' AND column_name='special_requests_id'
  ) THEN
    ALTER TABLE OrderItems ADD COLUMN special_requests_id INT REFERENCES SpecialRequests(request_id);
  END IF;
END $$;

/* ===================== 4. RECOMMENDATION & LOYALTY ===================== */
CREATE TABLE IF NOT EXISTS RecommendationRules (
  rule_id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES Businesses(business_id),
  rule_type recommendation_rule_type_enum NOT NULL,
  priority INT NOT NULL,
  if_condition JSONB NOT NULL,
  then_recommend_item_id INT NOT NULL REFERENCES MenuItems(menu_item_id),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS AnonymousCustomers (
  anon_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id INT NOT NULL REFERENCES Businesses(business_id),
  anonymous_cookie_id VARCHAR(255) NOT NULL,
  first_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_visits INT NOT NULL DEFAULT 1,
  total_spend DECIMAL(12,2) NOT NULL DEFAULT 0,
  UNIQUE (business_id, anonymous_cookie_id)
);

CREATE TABLE IF NOT EXISTS CustomerLoyaltyProfiles (
  profile_id SERIAL PRIMARY KEY,
  business_id INT NOT NULL REFERENCES Businesses(business_id),
  anon_id UUID REFERENCES AnonymousCustomers(anon_id) ON DELETE SET NULL,
  lifetime_value DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_orders INT NOT NULL DEFAULT 0,
  last_order_at TIMESTAMP,
  average_order_value DECIMAL(10,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS CustomerFeedback (
  feedback_id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES Orders(order_id) ON DELETE CASCADE,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  improvement_comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

/* ===================== 5. OPTIONAL HARDENING ===================== */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_customerfeedback_order_unique'
  ) THEN
    ALTER TABLE CustomerFeedback ADD CONSTRAINT uq_customerfeedback_order_unique UNIQUE (order_id);
  END IF;
END $$;

/* ===================== 6. INDEXES (CONCURRENT) ===================== */
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qrcodes_business ON QRCodes(business_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_qrcodes_business_table ON QRCodes(business_id, table_number);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_diningsessions_business_status ON DiningSessions(business_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_business_status ON Orders(business_id, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orders_business_session ON Orders(business_id, dining_session_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orderitems_order ON OrderItems(order_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orderitems_menu_item ON OrderItems(menu_item_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recommendation_rules_business_type ON RecommendationRules(business_id, rule_type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_anonymous_customers_cookie ON AnonymousCustomers(business_id, anonymous_cookie_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_loyalty_profiles_business ON CustomerLoyaltyProfiles(business_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_feedback_order ON CustomerFeedback(order_id);

/* ===================== 7. RLS (follow existing pattern) ===================== */
-- Enable RLS only if policy not already created by bootstrap; examples below.
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['QRCodes','DiningSessions','Orders','OrderItems','SpecialRequests','RecommendationRules','AnonymousCustomers','CustomerLoyaltyProfiles','CustomerFeedback'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy WHERE polname = lower('tenant_'||t||'_policy')
    ) THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO PUBLIC USING (business_id = current_setting(''app.current_tenant'', true)::int) WITH CHECK (business_id = current_setting(''app.current_tenant'', true)::int);',
        lower('tenant_'||t||'_policy'), t);
    END IF;
  END LOOP;
END $$;

-- End of migration
