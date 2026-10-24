-- Clear test data from the Ashirbad hotel database.
--
-- KEEPS: admin / app users and their PINs, settings (hotel name, GST, PIN, ...),
--        rooms, banquet halls, menu items, staff list, expense categories,
--        inventory item list.
-- DELETES: guests, bookings, stay extensions, bills, food orders, payments and
--          expenses (ledger), staff salary payments, banquet bookings and banquet
--          bills, inventory stock entries, audit trail.
-- RESETS: inventory stock to 0, occupied / booked rooms to Vacant and all rooms to Clean (rooms under
--         Maintenance stay in Maintenance), banquet halls to Available, and the
--         invoice number back to INV-0001.
--
-- Run it in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Everything runs in one transaction: if any line fails, nothing is deleted.
-- This cannot be undone, so take a backup first (Supabase: Database > Backups).

BEGIN;

DELETE FROM "OrderItem";
DELETE FROM "FoodOrder";
DELETE FROM "BookingExtension";
DELETE FROM "Bill";
DELETE FROM "Booking";
DELETE FROM "Guest";
DELETE FROM "LedgerEntry";
DELETE FROM "StaffPayment";
DELETE FROM "BanquetBill";
DELETE FROM "BanquetBooking";
DELETE FROM "AuditLog";

UPDATE "Room"
SET "status" = CASE WHEN "status" = 'MAINTENANCE' THEN 'MAINTENANCE' ELSE 'VACANT' END,
    "housekeeping" = 'CLEAN';

UPDATE "BanquetHall" SET "status" = 'AVAILABLE' WHERE "status" <> 'MAINTENANCE';

UPDATE "Setting" SET "value" = '1' WHERE "key" = 'invoiceCounter';

-- Inventory tables exist once the app has run with the inventory feature
DO $$
BEGIN
  IF to_regclass('"InventoryMovement"') IS NOT NULL THEN
    DELETE FROM "InventoryMovement";
    UPDATE "InventoryItem" SET "stock" = 0, "avgCost" = 0;
  END IF;
END $$;

COMMIT;

-- Check: every count below should be 0
SELECT 'Guest' AS "table", COUNT(*) FROM "Guest"
UNION ALL SELECT 'Booking', COUNT(*) FROM "Booking"
UNION ALL SELECT 'Bill', COUNT(*) FROM "Bill"
UNION ALL SELECT 'FoodOrder', COUNT(*) FROM "FoodOrder"
UNION ALL SELECT 'LedgerEntry', COUNT(*) FROM "LedgerEntry"
UNION ALL SELECT 'BanquetBooking', COUNT(*) FROM "BanquetBooking"
UNION ALL SELECT 'AuditLog', COUNT(*) FROM "AuditLog";
