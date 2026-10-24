-- Replace the demo rooms with the hotel's real rooms (31 rooms, client list).
--
-- Ground floor: 101-103   1st floor: 201-212   2nd floor: 301-316
-- Room 315 is Blocked: kept in Maintenance so it cannot be booked.
--
-- Run it in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Run scripts/clear-test-data.sql first. This file stops without changing anything
-- if any booking or food order still exists, so no real stay can be lost.
-- Users, settings, menu, staff and banquet halls are not touched.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Booking") OR EXISTS (SELECT 1 FROM "FoodOrder" WHERE "roomId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Bookings or room food orders still exist. Run scripts/clear-test-data.sql first, then run this again.';
  END IF;
END $$;

DELETE FROM "Room";

INSERT INTO "Room" ("id", "number", "floor", "type", "capacity", "rate", "status", "housekeeping", "notes", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::text, '101', 'Ground', 'Double Bed', 2, 700, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '102', 'Ground', 'Double Bed', 2, 800, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '103', 'Ground', 'Triple Bed (AC)', 3, 1200, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '201', '1', 'Double Bed (AC)', 2, 1000, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '202', '1', 'Single Bed', 1, 500, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '203', '1', 'Single Bed (AC)', 1, 800, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '204', '1', 'Single Bed (AC)', 1, 800, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '205', '1', 'Single Bed', 1, 500, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '206', '1', 'Single Bed', 1, 500, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '207', '1', 'Single Bed', 1, 500, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '208', '1', 'Triple Bed (AC)', 3, 1200, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '209', '1', 'Double Bed (AC)', 2, 1000, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '210', '1', 'Double Bed (AC)', 2, 1000, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '211', '1', 'Single Bed (AC)', 1, 800, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '212', '1', 'Single Bed (Non-Attached)', 1, 300, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '301', '2', 'Single Bed (AC)', 1, 800, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '302', '2', 'Single Bed (AC)', 1, 800, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '303', '2', 'Single Bed (AC)', 1, 800, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '304', '2', 'Single Bed (AC)', 1, 800, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '305', '2', 'Single Bed (AC)', 1, 800, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '306', '2', 'Six Bed', 6, 1500, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '307', '2', 'Double Bed (AC)', 2, 1000, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '308', '2', 'Single Bed (AC)', 1, 800, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '309', '2', 'Triple Bed (AC)', 3, 1500, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '310', '2', 'Triple Bed (AC)', 3, 1500, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '311', '2', 'Single Bed (AC)', 1, 900, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '312', '2', 'Double Bed (AC)', 2, 1000, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '313', '2', 'Single Bed (Non-Attached)', 1, 300, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '314', '2', 'Double Bed (Non-Attached)', 2, 500, 'VACANT', 'CLEAN', NULL, NOW(), NOW()),
  (gen_random_uuid()::text, '315', '2', 'Blocked', 1, 0, 'MAINTENANCE', 'CLEAN', 'Blocked - not available for guests', NOW(), NOW()),
  (gen_random_uuid()::text, '316', '2', 'Double Bed (Non-Attached)', 2, 500, 'VACANT', 'CLEAN', NULL, NOW(), NOW());

COMMIT;

-- Check: should list 31 rooms
SELECT "floor", "number", "type", "capacity", "rate", "status" FROM "Room" ORDER BY "number";
