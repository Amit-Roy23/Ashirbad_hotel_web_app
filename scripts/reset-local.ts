/**
 * Reset local dev DB to clean state (30 vacant rooms) for repeatable E2E runs.
 * Run: bun scripts/reset-local.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  await prisma.auditLog.deleteMany()
  await prisma.ledgerEntry.deleteMany()
  await prisma.staffPayment.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.foodOrder.deleteMany()
  await prisma.bill.deleteMany()
  await prisma.booking.deleteMany()
  await prisma.room.updateMany({ data: { status: 'VACANT', housekeeping: 'CLEAN' } })
  await prisma.setting.update({ where: { key: 'invoiceCounter' }, data: { value: '1' } })
  console.log('Local DB reset: no bookings/bills/ledger, rooms vacant, invoice counter = 1')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
