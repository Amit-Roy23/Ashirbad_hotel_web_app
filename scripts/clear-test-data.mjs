/**
 * Clears test data and keeps the setup (same as scripts/clear-test-data.sql).
 *
 * Keeps: users / admin PINs, settings, rooms, banquet halls, menu, staff list, expense categories,
 *        inventory item list.
 * Deletes: guests, bookings, bills, food orders, payments & expenses, salary payments,
 *          banquet bookings & bills, inventory stock entries, audit trail. Resets rooms to
 *          Vacant + Clean, inventory stock to 0 and the invoice number to 1.
 *
 *   DATABASE_URL=... node scripts/clear-test-data.mjs            # preview only, changes nothing
 *   DATABASE_URL=... node scripts/clear-test-data.mjs --confirm  # really delete
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const confirm = process.argv.includes('--confirm')

const CLEAR = [
  'OrderItem',
  'FoodOrder',
  'BookingExtension',
  'Bill',
  'Booking',
  'Guest',
  'LedgerEntry',
  'StaffPayment',
  'BanquetBill',
  'BanquetBooking',
  'AuditLog',
]
const KEEP = ['User', 'Setting', 'Room', 'BanquetHall', 'MenuItem', 'Staff', 'ExpenseCategory']

const count = async (table) => {
  const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${table}"`)
  return rows[0].n
}

const tableExists = async (table) => {
  const rows = await prisma.$queryRawUnsafe(`SELECT to_regclass('"${table}"') IS NOT NULL AS ok`)
  return rows[0].ok
}

async function main() {
  const hasInventory = await tableExists('InventoryMovement')
  if (hasInventory) {
    CLEAR.splice(CLEAR.indexOf('AuditLog'), 0, 'InventoryMovement')
    KEEP.push('InventoryItem')
  }

  const host = (process.env.DATABASE_URL || '').replace(/^.*@/, '').replace(/[/?].*$/, '')
  console.log(`Database: ${host || '(DATABASE_URL not set)'}\n`)

  console.log('Will DELETE:')
  for (const t of CLEAR) console.log(`  ${t.padEnd(18)} ${await count(t)} rows`)
  console.log('\nWill KEEP:')
  for (const t of KEEP) console.log(`  ${t.padEnd(18)} ${await count(t)} rows`)

  if (!confirm) {
    console.log('\nPreview only, nothing was changed. Run again with --confirm to delete.')
    return
  }

  await prisma.$transaction([
    ...CLEAR.map((t) => prisma.$executeRawUnsafe(`DELETE FROM "${t}"`)),
    prisma.$executeRawUnsafe(
      `UPDATE "Room" SET "status" = CASE WHEN "status" = 'MAINTENANCE' THEN 'MAINTENANCE' ELSE 'VACANT' END, "housekeeping" = 'CLEAN'`
    ),
    prisma.$executeRawUnsafe(`UPDATE "BanquetHall" SET "status" = 'AVAILABLE' WHERE "status" <> 'MAINTENANCE'`),
    prisma.$executeRawUnsafe(`UPDATE "Setting" SET "value" = '1' WHERE "key" IN ('invoiceCounter', 'estimateCounter')`),
    ...(hasInventory ? [prisma.$executeRawUnsafe(`UPDATE "InventoryItem" SET "stock" = 0, "avgCost" = 0`)] : []),
  ])
  console.log('\nDone. Test data cleared; rooms are Vacant and Clean; inventory stock is 0; next invoice is number 1.')
}

main()
  .catch((e) => {
    console.error('Failed, nothing was changed:', e.message)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
