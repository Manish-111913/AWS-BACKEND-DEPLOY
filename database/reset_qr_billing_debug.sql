-- RESET SCRIPT: QR Billing & Ordering Data (Legacy + Modern Schemas)
-- Purpose: Provide a clean slate to debug color logic (/api/sessions/overview) from scratch.
-- Safe Usage: Run in a transaction; optionally limit by business_id so you don't wipe other tenants.
-- NOTE: This removes ONLY QR/session/order related data (both legacy and modern). Inventory/Menu/etc remain.

-- ============================
-- CONFIGURATION (edit first!)
-- ============================
-- Set the business you want to purge. If you want ALL businesses, set this to NULL and remove the business filters.
-- Example: \set business_id 1  (psql variable) ; In plain SQL replace :business_id with an integer.
-- For direct execution without psql variables, manually replace :business_id with the integer literal.

-- BEGIN TRANSACTION
BEGIN;

-- (Optional) Replace this with a literal if not using psql variables
-- DO NOT leave :business_id placeholder if executing outside psql with \set.

-- =============================================
-- 1. Modern schema deletions (session_orders -> qr_scans -> dining_sessions -> qr_codes)
-- =============================================
-- Use business filter if desired

-- session_orders depends on dining_sessions
DELETE FROM session_orders
WHERE session_id IN (
  SELECT id FROM dining_sessions
  WHERE (:business_id IS NULL OR business_id = :business_id)
);

-- qr_scans references qr_codes & dining_sessions (ON DELETE CASCADE not guaranteed across both) so explicit delete
DELETE FROM qr_scans
WHERE qr_code_id IN (
  SELECT id FROM qr_codes WHERE (:business_id IS NULL OR business_id = :business_id)
);

-- Modern dining_sessions
DELETE FROM dining_sessions
WHERE (:business_id IS NULL OR business_id = :business_id);

-- Modern qr_codes
DELETE FROM qr_codes
WHERE (:business_id IS NULL OR business_id = :business_id);

-- =============================================
-- 2. Legacy schema deletions (SpecialRequests -> OrderItems -> OrderIssues -> CustomerNotifications -> SplitPayments -> Orders -> DiningSessions -> QRCodes)
-- =============================================

-- SpecialRequests depends on OrderItems
DELETE FROM SpecialRequests
WHERE order_item_id IN (
  SELECT order_item_id FROM OrderItems oi
  JOIN Orders o ON o.order_id = oi.order_id
  WHERE (:business_id IS NULL OR o.business_id = :business_id)
);

-- OrderItems
DELETE FROM OrderItems
USING Orders o
WHERE OrderItems.order_id = o.order_id
  AND (:business_id IS NULL OR o.business_id = :business_id);

-- OrderIssues
DELETE FROM OrderIssues
WHERE order_id IN (
  SELECT order_id FROM Orders WHERE (:business_id IS NULL OR business_id = :business_id)
);

-- CustomerNotifications (may reference orders and/or dining sessions)
DELETE FROM CustomerNotifications
WHERE ((order_id IS NOT NULL AND order_id IN (
          SELECT order_id FROM Orders WHERE (:business_id IS NULL OR business_id = :business_id)
        ))
    OR (dining_session_id IS NOT NULL AND dining_session_id IN (
          SELECT session_id FROM DiningSessions ds
          JOIN QRCodes q ON q.qr_code_id = ds.qr_code_id
          WHERE (:business_id IS NULL OR q.business_id = :business_id)
        ))
      )
  AND (:business_id IS NULL OR business_id = :business_id);

-- SplitPayments
DELETE FROM SplitPayments
WHERE order_id IN (
  SELECT order_id FROM Orders WHERE (:business_id IS NULL OR business_id = :business_id)
);

-- Orders (CASCADE deletes OrderItems already if ON DELETE CASCADE present; we already removed dependents for clarity)
DELETE FROM Orders
WHERE (:business_id IS NULL OR business_id = :business_id);

-- Clear legacy current_session_id linkage first (avoid dangling FK refs when deleting DiningSessions)
UPDATE QRCodes SET current_session_id = NULL
WHERE (:business_id IS NULL OR business_id = :business_id);

-- DiningSessions
DELETE FROM DiningSessions
WHERE qr_code_id IN (
  SELECT qr_code_id FROM QRCodes WHERE (:business_id IS NULL OR business_id = :business_id)
);

-- QRCodes (legacy)
DELETE FROM QRCodes
WHERE (:business_id IS NULL OR business_id = :business_id);

-- =============================================
-- 3. (Optional) Reset sequences (Uncomment if you want IDs to restart at 1)
-- NOTE: Only safe if you are not replicating or relying on historical ID references elsewhere.
-- SELECT setval(pg_get_serial_sequence('qr_codes','id'), 1, false);
-- SELECT setval(pg_get_serial_sequence('dining_sessions','id'), 1, false);
-- SELECT setval(pg_get_serial_sequence('session_orders','id'), 1, false);
-- SELECT setval(pg_get_serial_sequence('qr_scans','id'), 1, false);
-- SELECT setval(pg_get_serial_sequence('qrcodes','qr_code_id'), 1, false);
-- SELECT setval(pg_get_serial_sequence('diningsessions','session_id'), 1, false);
-- SELECT setval(pg_get_serial_sequence('orders','order_id'), 1, false);
-- SELECT setval(pg_get_serial_sequence('orderitems','order_item_id'), 1, false);
-- SELECT setval(pg_get_serial_sequence('specialrequests','request_id'), 1, false);
-- SELECT setval(pg_get_serial_sequence('orderissues','issue_id'), 1, false);
-- SELECT setval(pg_get_serial_sequence('customernotifications','notification_id'), 1, false);
-- SELECT setval(pg_get_serial_sequence('splitpayments','split_payment_id'), 1, false);

COMMIT;

-- =============================================
-- 4. Post-reset sanity checks (run after COMMIT)
-- =============================================
-- Expect all zero:
-- SELECT COUNT(*) FROM dining_sessions;         -- modern
-- SELECT COUNT(*) FROM qr_codes;               -- modern
-- SELECT COUNT(*) FROM session_orders;
-- SELECT COUNT(*) FROM qr_scans;
-- SELECT COUNT(*) FROM DiningSessions;         -- legacy
-- SELECT COUNT(*) FROM QRCodes;                -- legacy
-- SELECT COUNT(*) FROM Orders;                 -- legacy orders

-- =============================================
-- 5. Minimal re-bootstrap for color logic testing
-- =============================================
-- a. Regenerate QR codes (legacy or modern depending on flow) via API or manual inserts.
-- b. Hit /api/sessions/overview?businessId=1&mode=eat_later -> should show ash for all onboarded tables.
-- c. Scan one QR (/qr/<qrId>) -> observe [QR-SCAN] log -> overview should change to yellow for that table.
-- d. Create an Order (legacy path) tied to the legacy DiningSession if testing eat_later green path.
-- e. Mark order payment_status='paid' (and ensure orders_count>0 & all paid) -> becomes green (eat_later).
-- f. For pay_first: first READY/COMPLETED order shifts yellow -> green.

-- END OF SCRIPT