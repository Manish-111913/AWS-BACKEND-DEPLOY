-- Migration: 20250918_retrofit_business_id_children.sql
-- Purpose: Add business_id to child tables lacking it for consistent RLS (OrderItems, SpecialRequests, CustomerFeedback, VendorRatings)
-- Idempotent: Yes

/* 1. OrderItems.business_id */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='orderitems' AND column_name='business_id'
  ) THEN
    ALTER TABLE OrderItems ADD COLUMN business_id INT REFERENCES Businesses(business_id);
    UPDATE OrderItems oi SET business_id = o.business_id FROM Orders o WHERE oi.order_id = o.order_id AND oi.business_id IS NULL;
    ALTER TABLE OrderItems ALTER COLUMN business_id SET NOT NULL;
  END IF;
END $$;

/* 2. SpecialRequests.business_id */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='specialrequests' AND column_name='business_id'
  ) THEN
    ALTER TABLE SpecialRequests ADD COLUMN business_id INT REFERENCES Businesses(business_id);
    UPDATE SpecialRequests sr
    SET business_id = o.business_id
    FROM OrderItems oi JOIN Orders o ON oi.order_id = o.order_id
    WHERE sr.order_item_id = oi.order_item_id AND sr.business_id IS NULL;
    ALTER TABLE SpecialRequests ALTER COLUMN business_id SET NOT NULL;
  END IF;
END $$;

/* 3. CustomerFeedback.business_id */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='customerfeedback' AND column_name='business_id'
  ) THEN
    ALTER TABLE CustomerFeedback ADD COLUMN business_id INT REFERENCES Businesses(business_id);
    UPDATE CustomerFeedback cf
    SET business_id = o.business_id
    FROM Orders o
    WHERE cf.order_id = o.order_id AND cf.business_id IS NULL;
    ALTER TABLE CustomerFeedback ALTER COLUMN business_id SET NOT NULL;
  END IF;
END $$;

/* 4. VendorRatings.business_id */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='vendorratings' AND column_name='business_id'
  ) THEN
    ALTER TABLE VendorRatings ADD COLUMN business_id INT REFERENCES Businesses(business_id);
    UPDATE VendorRatings vr
    SET business_id = v.business_id
    FROM Vendors v
    WHERE vr.vendor_id = v.vendor_id AND vr.business_id IS NULL;
    ALTER TABLE VendorRatings ALTER COLUMN business_id SET NOT NULL;
  END IF;
END $$;

/* 5. Indexes */
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_orderitems_business ON OrderItems(business_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_specialrequests_business ON SpecialRequests(business_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customerfeedback_business ON CustomerFeedback(business_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vendorratings_business ON VendorRatings(business_id);

/* 6. RLS enable & policies (if missing) */
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['OrderItems','SpecialRequests','CustomerFeedback','VendorRatings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy WHERE polname = lower('tenant_'||t||'_policy')
    ) THEN
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO PUBLIC USING (business_id = current_setting(''app.current_tenant'', true)::int) WITH CHECK (business_id = current_setting(''app.current_tenant'', true)::int);', lower('tenant_'||t||'_policy'), t);
    END IF;
  END LOOP;
END $$;
