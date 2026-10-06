import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const isDryRun = process.argv.includes('--dry-run')
  console.log(`=== Backfill originalCheckOut for Bookings ${isDryRun ? '(DRY RUN)' : ''} ===`)

  const bookingsToUpdate = await prisma.booking.findMany({
    where: {
      originalCheckOut: null,
      checkOut: { not: null },
    },
    select: {
      id: true,
      checkIn: true,
      checkOut: true,
      days: true,
      status: true,
      room: { select: { number: true } },
      guest: { select: { name: true } },
    },
  })

  console.log(`Found ${bookingsToUpdate.length} booking(s) needing originalCheckOut backfill.`)

  if (bookingsToUpdate.length === 0) {
    console.log('Nothing to backfill. All bookings have originalCheckOut set.')
    return
  }

  for (const b of bookingsToUpdate) {
    console.log(
      `[Booking ${b.id}] Room ${b.room?.number || '?'} - ${b.guest?.name || 'Guest'}: Setting originalCheckOut = ${b.checkOut?.toISOString()}`
    )
    if (!isDryRun && b.checkOut) {
      await prisma.booking.update({
        where: { id: b.id },
        data: { originalCheckOut: b.checkOut },
      })
    }
  }

  if (isDryRun) {
    console.log(`\nDRY RUN complete. ${bookingsToUpdate.length} booking(s) would be updated. Run without --dry-run to apply.`)
  } else {
    console.log(`\nSuccessfully backfilled originalCheckOut for ${bookingsToUpdate.length} booking(s).`)
  }
}

main()
  .catch((e) => {
    console.error('Error during backfill:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
