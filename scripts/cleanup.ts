import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
async function main() {
  await prisma.ledgerEntry.deleteMany({})
  await prisma.bill.deleteMany({})
  await prisma.orderItem.deleteMany({})
  await prisma.foodOrder.deleteMany({})
  await prisma.booking.deleteMany({})
  await prisma.room.updateMany({ where: { status: { not: 'VACANT' } }, data: { status: 'VACANT' } })
  console.log('Local cleaned')
}
main().catch(console.error).finally(() => prisma.$disconnect())
