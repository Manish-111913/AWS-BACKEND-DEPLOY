-- Phase A: QR Order -> Inventory Deduction Integration
-- Idempotent migration

BEGIN;

-- 1. Add columns to Orders if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='inventory_deducted'
  ) THEN
    ALTER TABLE Orders ADD COLUMN inventory_deducted BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='inventory_deducted_at'
  ) THEN
    ALTER TABLE Orders ADD COLUMN inventory_deducted_at TIMESTAMP;
  END IF;
END $$;

-- 2. Create / replace function
-- Worker function (callable manually and by trigger wrapper)
CREATE OR REPLACE FUNCTION process_qr_order_inventory_by_id(p_order_id INT)
RETURNS VOID AS $$
DECLARE
  v_business_id INT;
  v_status order_status_enum;
  v_inventory_deducted BOOLEAN;
  v_report_id INT;
BEGIN
  SELECT business_id, status, inventory_deducted
  INTO v_business_id, v_status, v_inventory_deducted
  FROM Orders
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE NOTICE 'Order % not found', p_order_id; RETURN; END IF;

  IF v_status NOT IN ('COMPLETED') THEN RETURN; END IF;
  IF v_inventory_deducted THEN RETURN; END IF;

  SELECT report_id INTO v_report_id
  FROM DailySaleReports
  WHERE business_id = v_business_id AND report_date = CURRENT_DATE;

  IF v_report_id IS NULL THEN
    INSERT INTO DailySaleReports(business_id, report_date, ocr_sales_data, complimentary_sales_data)
    VALUES (v_business_id, CURRENT_DATE, '{}'::json, '{}'::json)
    ON CONFLICT (business_id, report_date) DO UPDATE SET report_date = EXCLUDED.report_date
    RETURNING report_id INTO v_report_id;
  END IF;

  INSERT INTO InventoryTransactions(business_id, item_id, quantity, transaction_type, related_report_id)
  SELECT v_business_id, ri.item_id, SUM(ri.quantity) AS total_qty, 'Sale', v_report_id
  FROM OrderItems oi
  JOIN Recipes r ON r.recipe_id = oi.menu_item_id
  JOIN RecipeIngredients ri ON ri.recipe_id = r.recipe_id
  WHERE oi.order_id = p_order_id
  GROUP BY ri.item_id;

  UPDATE InventoryItems inv
  SET current_stock = GREATEST(0, inv.current_stock - usage.total_qty)
  FROM (
    SELECT ri.item_id, SUM(ri.quantity) AS total_qty
    FROM OrderItems oi
    JOIN Recipes r ON r.recipe_id = oi.menu_item_id
    JOIN RecipeIngredients ri ON ri.recipe_id = r.recipe_id
    WHERE oi.order_id = p_order_id
    GROUP BY ri.item_id
  ) usage
  WHERE inv.item_id = usage.item_id AND inv.business_id = v_business_id;

  UPDATE Orders SET inventory_deducted = TRUE, inventory_deducted_at = NOW(), updated_at = NOW()
  WHERE order_id = p_order_id;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Failed inventory deduction for order %: %', p_order_id, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Backwards compatible stub (if any code already calls old signature taking INT directly)
DROP FUNCTION IF EXISTS process_qr_order_inventory(INT);

-- Trigger wrapper (no args)
CREATE OR REPLACE FUNCTION process_qr_order_inventory()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM process_qr_order_inventory_by_id(NEW.order_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Trigger (create only if missing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_orders_inventory_deduction') THEN
  CREATE TRIGGER trg_orders_inventory_deduction
  AFTER UPDATE OF status ON Orders
  FOR EACH ROW
  WHEN (NEW.status = 'COMPLETED')
  EXECUTE FUNCTION process_qr_order_inventory();
  END IF;
END $$;

COMMIT;

-- 4. (Optional) Backfill pending completed orders (safe batch)
-- Uncomment to run once; keep commented in default migration to avoid heavy load automatically.
-- DO $$
-- DECLARE r RECORD; counter INT := 0;
-- BEGIN
--   FOR r IN (
--     SELECT order_id FROM Orders
--     WHERE status IN ('COMPLETED','SERVED','PAID') AND (inventory_deducted = FALSE OR inventory_deducted IS NULL)
--     ORDER BY order_id
--     LIMIT 500
--   ) LOOP
--     PERFORM process_qr_order_inventory(r.order_id);
--     counter := counter + 1;
--   END LOOP;
--   RAISE NOTICE 'Processed % legacy orders for inventory deduction (preview batch).', counter;
-- END $$;