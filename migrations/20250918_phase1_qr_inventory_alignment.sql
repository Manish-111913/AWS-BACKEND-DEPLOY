-- Migration: 20250918_phase1_qr_inventory_alignment.sql
-- Purpose: Phase 1 alignment to spec for QR-related inventory & menu enhancements
-- Adds: InventoryItems.is_essential, MenuItems.avg_prep_time_minutes, MenuItems.is_available_to_customer
-- Idempotent: Yes

/* 1. InventoryItems.is_essential */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='inventoryitems' AND column_name='is_essential'
  ) THEN
    ALTER TABLE InventoryItems ADD COLUMN is_essential BOOLEAN;
    UPDATE InventoryItems SET is_essential = TRUE WHERE is_essential IS NULL;
    ALTER TABLE InventoryItems ALTER COLUMN is_essential SET NOT NULL;
    ALTER TABLE InventoryItems ALTER COLUMN is_essential SET DEFAULT TRUE;
  END IF;
END $$;

/* 2. MenuItems.avg_prep_time_minutes */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='menuitems' AND column_name='avg_prep_time_minutes'
  ) THEN
    ALTER TABLE MenuItems ADD COLUMN avg_prep_time_minutes INT CHECK (avg_prep_time_minutes >= 0);
  END IF;
END $$;

/* 3. MenuItems.is_available_to_customer */
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='menuitems' AND column_name='is_available_to_customer'
  ) THEN
    ALTER TABLE MenuItems ADD COLUMN is_available_to_customer BOOLEAN;
    UPDATE MenuItems SET is_available_to_customer = TRUE WHERE is_available_to_customer IS NULL;
    ALTER TABLE MenuItems ALTER COLUMN is_available_to_customer SET NOT NULL;
    ALTER TABLE MenuItems ALTER COLUMN is_available_to_customer SET DEFAULT TRUE;
  END IF;
END $$;

/* Optional Index (if filtering often by availability) */
CREATE INDEX IF NOT EXISTS idx_menuitems_business_available ON MenuItems(business_id, is_available_to_customer);
