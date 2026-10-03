import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const isDryRun = process.argv.includes('--dry-run')
  console.log(`\n=== Ashirbad Hotel Bill Totals Migration (v1) ===`)
  console.log(`Mode: ${isDryRun ? 'DRY-RUN (no changes will be saved to database)' : 'APPLY (changes will be committed)'}\n`)

  const migrationFlag = await prisma.setting.findUnique({
    where: { key: 'billTotalsMigratedV1' },
  })

  if (migrationFlag && migrationFlag.value === 'true' && !isDryRun) {
    console.log('ℹ Migration has already been applied (Setting "billTotalsMigratedV1" is true). Aborting.')
    return
  }

  const bills = await prisma.bill.findMany({
    include: {
      booking: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  if (bills.length === 0) {
    console.log('No bills found to migrate.')
    return
  }

  console.log(`Found ${bills.length} bill(s) to inspect.\n`)

  const tableRows: {
    billNumber: string
    oldGrandTotal: number
    advanceApplied: number
    newGrandTotal: number
    actualRoomTotal: number
    billedRoomTotal: number
    foodTotal: number
    extraCharges: number
    discount: number
    gstPercent: number
    internalGst: number
    internalTotal: number
  }[] = []

  for (const bill of bills) {
    // In the old system, grandTotal stored: Math.max(0, taxable + billedGst - advanceApplied)
    // In the new system: grandTotal = taxable + billedGst (full amount without advance subtraction)
    const newGrandTotal = Math.round((bill.grandTotal + (bill.advanceApplied || 0)) * 100) / 100

    const internalTaxable = Math.max(
      0,
      bill.actualRoomTotal + (bill.foodTotal || 0) + (bill.extraCharges || 0) - (bill.discount || 0)
    )
    const internalGst = Math.round(internalTaxable * bill.gstPercent) / 100
    const internalTotal = Math.round((internalTaxable + internalGst) * 100) / 100

    tableRows.push({
      billNumber: bill.billNumber,
      oldGrandTotal: bill.grandTotal,
      advanceApplied: bill.advanceApplied || 0,
      newGrandTotal,
      actualRoomTotal: bill.actualRoomTotal,
      billedRoomTotal: bill.billedRoomTotal,
      foodTotal: bill.foodTotal || 0,
      extraCharges: bill.extraCharges || 0,
      discount: bill.discount || 0,
      gstPercent: bill.gstPercent,
      internalGst,
      internalTotal,
    })

    if (!isDryRun) {
      // Update Bill record
      await prisma.bill.update({
        where: { id: bill.id },
        data: {
          grandTotal: newGrandTotal,
          internalGst,
          internalTotal,
        },
      })

      // Update GST ledger rows for this bill
      if (internalGst > 0) {
        await prisma.ledgerEntry.updateMany({
          where: {
            refId: bill.id,
            category: 'GST',
          },
          data: {
            amount: internalGst,
            description: `GST ${bill.gstPercent}% on bill ${bill.billNumber}`,
          },
        })
      } else {
        await prisma.ledgerEntry.updateMany({
          where: {
            refId: bill.id,
            category: 'GST',
          },
          data: {
            amount: 0,
            description: `GST 0% on bill ${bill.billNumber}`,
          },
        })
      }
    }
  }

  console.table(tableRows)

  if (!isDryRun) {
    await prisma.setting.upsert({
      where: { key: 'billTotalsMigratedV1' },
      update: { value: 'true' },
      create: { key: 'billTotalsMigratedV1', value: 'true' },
    })
    console.log('\n✓ Migration applied successfully! Setting "billTotalsMigratedV1" set to "true".')
  } else {
    console.log('\n✓ Dry run complete. No database changes were made.')
  }
}

main()
  .catch((e) => {
    console.error('Migration failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
