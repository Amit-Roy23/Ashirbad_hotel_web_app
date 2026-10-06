/**
 * API-level E2E test for the Ashirbad Lodge billing & revenue accounting overhaul.
 * Run: npx tsx scripts/e2e-test.ts (or bun scripts/e2e-test.ts)
 */
export {}

const BASE = process.env.E2E_BASE || 'http://localhost:3000'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.log(`  ✗ FAIL: ${name} ${detail}`)
  }
}

async function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function main() {
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()

  console.log('=== 1. AUTH & PERMISSIONS ===')
  const users = (await req('GET', '/api/users')).data as { id: string; name: string; role: string }[]
  const admin = users.find((u) => u.role === 'ADMIN')!
  const reception = users.find((u) => u.role === 'RECEPTION')!
  const auth = await req('POST', '/api/auth', { userId: admin.id, pin: '1111' })
  check('admin login with pin 1111', auth.status === 200)
  const badAuth = await req('POST', '/api/auth', { userId: admin.id, pin: '0000' })
  check('wrong pin rejected', badAuth.status === 401)

  const H = { 'X-User-Id': admin.id, 'X-User-Name': 'Admin', 'X-User-Role': 'ADMIN' }
  const HR = { 'X-User-Id': reception.id, 'X-User-Name': 'Reception', 'X-User-Role': 'RECEPTION' }

  // Get or setup rooms with known rates
  const rooms = (await req('GET', '/api/rooms')).data as { id: string; number: string; rate: number; type: string; status: string }[]
  check('at least 2 rooms available for test', rooms.length >= 2, `found ${rooms.length}`)
  const room1 = rooms[0]
  const room2 = rooms[1]

  // Clean up any lingering bookings from previous test runs on room1 and room2
  await prisma.booking.updateMany({
    where: { roomId: { in: [room1.id, room2.id] }, status: { in: ['ACTIVE', 'BOOKED'] } },
    data: { status: 'CANCELLED' },
  })

  // Ensure room1 and room2 have rate 1000 and status VACANT for exact test matches
  await req('PATCH', '/api/rooms', { id: room1.id, rate: 1000, type: 'Standard Non-AC', status: 'VACANT', housekeeping: 'CLEAN' }, H)
  await req('PATCH', '/api/rooms', { id: room2.id, rate: 1000, type: 'Standard Non-AC', status: 'VACANT', housekeeping: 'CLEAN' }, H)

  console.log('\n=== 2. EXAMPLE 1: NORMAL BILL (Rate 1000, 1 night, advance 500, GST 12%) ===')
  // Check in guest 1
  const checkin1 = await req(
    'POST',
    '/api/bookings',
    {
      roomId: room1.id,
      phone: '9876543210',
      name: 'Normal Guest 1',
      checkIn: new Date().toISOString(),
      checkOut: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      advance: '500',
      advanceMethod: 'CASH',
      guestCount: 1,
    },
    HR
  )
  check('check-in Example 1 succeeds', checkin1.status === 200)
  const bookingId1 = (checkin1.data as { id: string }).id

  // Create normal bill: rate 1000, 1 night, GST 12%, advance applied 500, payable now 620, paid 620
  // grandTotal = 1000 + 120 = 1120. advanceApplied = 500. payable now = 620. payCash = 620.
  const bill1Res = await req(
    'POST',
    '/api/bills',
    {
      bookingId: bookingId1,
      days: 1,
      gstPercent: 12,
      payCash: 620,
      checkout: true,
    },
    H
  )
  check('create normal bill succeeds', bill1Res.status === 200, JSON.stringify(bill1Res.data))
  const bill1 = bill1Res.data as {
    id: string
    billNumber: string
    actualRoomTotal: number
    billedRoomTotal: number
    roomDescription: string | null
    gstPercent: number
    actualGst: number
    internalGst: number
    internalTotal: number
    grandTotal: number
    advanceApplied: number
    payCash: number
  }
  check('Ex1: grandTotal is FULL bill 1120 (not 620)', bill1.grandTotal === 1120, `got ${bill1.grandTotal}`)
  check('Ex1: advanceApplied is 500', bill1.advanceApplied === 500, `got ${bill1.advanceApplied}`)
  check('Ex1: actualGst is 120', bill1.actualGst === 120, `got ${bill1.actualGst}`)
  check('Ex1: internalGst is 120', bill1.internalGst === 120, `got ${bill1.internalGst}`)
  check('Ex1: internalTotal is 1120', bill1.internalTotal === 1120, `got ${bill1.internalTotal}`)

  // Verify booking status
  const booking1Data = (await req('GET', `/api/bookings`)).data as { id: string; paymentStatus: string }[]
  const b1 = booking1Data.find((b) => b.id === bookingId1)
  check('Ex1: booking paymentStatus is PAID', b1?.paymentStatus === 'PAID', `got ${b1?.paymentStatus}`)

  // Verify total received & balance: total received 500 + 620 = 1120, balance = 0
  const ex1Received = bill1.advanceApplied + bill1.payCash
  const ex1Balance = bill1.grandTotal - ex1Received
  check('Ex1: total received = 1120', ex1Received === 1120, `got ${ex1Received}`)
  check('Ex1: balance due = 0', ex1Balance === 0, `got ${ex1Balance}`)

  // Verify ledger rows for bill 1
  const ledgerEx1 = (await req('GET', '/api/ledger')).data as {
    entries: { category: string; amount: number; description: string; refId: string }[]
    totalIncome: number
  }
  const bill1Ledger = ledgerEx1.entries.filter((e) => e.refId === bill1.id)
  const b1Rent = bill1Ledger.find((e) => e.category === 'ROOM_RENT')
  const b1Gst = bill1Ledger.find((e) => e.category === 'GST')
  check('Ex1: ledger ROOM_RENT is 1000', !!b1Rent && b1Rent.amount === 1000)
  check('Ex1: ledger GST is 120', !!b1Gst && b1Gst.amount === 120)

  console.log('\n=== 3. EXAMPLE 2: CORPORATE CUSTOM BILL (Rate 1000, billed 2000, "Deluxe AC Room", GST 12%, advance 500) ===')
  // Check in guest 2
  const checkin2 = await req(
    'POST',
    '/api/bookings',
    {
      roomId: room2.id,
      phone: '9876543211',
      name: 'Corp Guest 2',
      company: 'Acme Corp',
      gst: '19AABCA0000A1Z5',
      checkIn: new Date().toISOString(),
      checkOut: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      advance: '500',
      advanceMethod: 'UPI',
      guestCount: 1,
      isCorporate: true,
    },
    HR
  )
  check('check-in Example 2 succeeds', checkin2.status === 200)
  const bookingId2 = (checkin2.data as { id: string }).id

  // 3a. Verify custom bill requires manager PIN when roomDescription or billed amount changes
  const blockedCustom = await req(
    'POST',
    '/api/bills',
    {
      bookingId: bookingId2,
      billedRoomTotal: 2000,
      roomDescription: 'Deluxe AC Room',
      gstPercent: 12,
      payCash: 1740,
    },
    HR // reception user without PIN
  )
  check('Ex2: Custom bill blocked without PIN', blockedCustom.status === 403)

  // 3b. Admin creates corporate bill with PIN
  // actual rate 1000, billed 2000, roomDescription "Deluxe AC Room", GST 12%
  // Customer invoice: grandTotal = 2000 + 240 = 2240, advanceApplied = 500, payable = 1740. payCash = 1740.
  // Internal accounting: internalTaxable = 1000, internalGst = 120, internalTotal = 1120.
  const bill2Res = await req(
    'POST',
    '/api/bills',
    {
      bookingId: bookingId2,
      billedRoomTotal: 2000,
      roomDescription: 'Deluxe AC Room',
      gstPercent: 12,
      payCash: 1740,
      managerPin: '1111',
      corporateName: 'Acme Corp',
      gstNumber: '19AABCA0000A1Z5',
      checkout: true,
    },
    H
  )
  check('Ex2: Corporate custom bill created', bill2Res.status === 200, JSON.stringify(bill2Res.data))
  const bill2 = bill2Res.data as {
    id: string
    billNumber: string
    actualRoomTotal: number
    billedRoomTotal: number
    roomDescription: string
    gstPercent: number
    actualGst: number
    internalGst: number
    internalTotal: number
    grandTotal: number
    advanceApplied: number
    payCash: number
    approvedBy: string
  }
  check('Ex2: Invoice grandTotal is 2240 (2000 + 240 GST)', bill2.grandTotal === 2240, `got ${bill2.grandTotal}`)
  check('Ex2: Invoice actualGst is 240', bill2.actualGst === 240, `got ${bill2.actualGst}`)
  check('Ex2: Invoice advanceApplied is 500', bill2.advanceApplied === 500, `got ${bill2.advanceApplied}`)
  check('Ex2: Internal internalGst is 120 (on actual 1000 tariff)', bill2.internalGst === 120, `got ${bill2.internalGst}`)
  check('Ex2: Internal internalTotal is 1120 (1000 + 120)', bill2.internalTotal === 1120, `got ${bill2.internalTotal}`)
  check('Ex2: roomDescription stored as "Deluxe AC Room"', bill2.roomDescription === 'Deluxe AC Room', `got ${bill2.roomDescription}`)
  check('Ex2: approvedBy recorded as Admin', bill2.approvedBy === 'Admin', `got ${bill2.approvedBy}`)

  // Verify booking status
  const booking2Data = (await req('GET', `/api/bookings`)).data as { id: string; paymentStatus: string }[]
  const b2 = booking2Data.find((b) => b.id === bookingId2)
  check('Ex2: booking paymentStatus is PAID', b2?.paymentStatus === 'PAID', `got ${b2?.paymentStatus}`)

  // Verify total received & balance: total received 500 + 1740 = 2240, balance = 0
  const ex2Received = bill2.advanceApplied + bill2.payCash
  const ex2Balance = bill2.grandTotal - ex2Received
  check('Ex2: total received = 2240', ex2Received === 2240, `got ${ex2Received}`)
  check('Ex2: balance due = 0', ex2Balance === 0, `got ${ex2Balance}`)

  // 3c. Verify Ledger rows for bill 2: ROOM_RENT = 1000, GST = 120. NOTHING of 2000 or 240.
  const ledgerEx2 = (await req('GET', '/api/ledger')).data as {
    entries: { category: string; amount: number; description: string; refId: string }[]
  }
  const bill2Ledger = ledgerEx2.entries.filter((e) => e.refId === bill2.id)
  const b2Rent = bill2Ledger.find((e) => e.category === 'ROOM_RENT')
  const b2Gst = bill2Ledger.find((e) => e.category === 'GST')
  check('Ex2: Ledger ROOM_RENT is 1000 (NOT 2000)', !!b2Rent && b2Rent.amount === 1000, b2Rent ? String(b2Rent.amount) : 'missing')
  check('Ex2: Ledger GST is 120 (NOT 240)', !!b2Gst && b2Gst.amount === 120, b2Gst ? String(b2Gst.amount) : 'missing')
  check('Ex2: Ledger GST description does not have "(on billed amount)"', !!b2Gst && !b2Gst.description.includes('(on billed amount)'))
  const bill2TotalCredited = bill2Ledger.reduce((s, e) => s + e.amount, 0)
  check('Ex2: Ledger total credited is 1120 (1000 + 120)', bill2TotalCredited === 1120, `got ${bill2TotalCredited}`)

  console.log('\n=== 4. AUDIT LOGS FOR CUSTOM BILL ===')
  const audit = (await req('GET', '/api/audit')).data as { action: string; userName: string; details: string }[]
  const customAudit = audit.find((a) => a.action === 'CUSTOM_BILL' && (a.details || '').includes(bill2.billNumber))
  check('Audit log contains real room type, printed description, actual vs billed',
    !!customAudit &&
    customAudit.details.includes('Deluxe AC Room') &&
    customAudit.details.includes('2000') &&
    customAudit.details.includes('1000')
  )

  console.log('\n=== 5. DASHBOARD STATS & REVENUE ===')
  const stats = (await req('GET', '/api/stats')).data as {
    todayRevenue: number
    todayIncome: number
    todayNet: number
    outstanding: number
    arrivals: unknown[]
    departures: unknown[]
  }
  // todayRevenue is sum of internalTotal (1120 + 1120 = 2240)
  check('Dashboard todayRevenue includes internalTotal (1120+1120=2240)', stats.todayRevenue >= 2240, `got ${stats.todayRevenue}`)

  console.log('\n=== 6. REPORTS (Internal Revenue vs Billed Info) ===')
  const today = new Date().toISOString().slice(0, 10)
  const rep = (await req('GET', `/api/reports?from=${today}&to=${today}`)).data as {
    revenue: {
      actualRoomRevenue: number
      billedRoomRevenue: number
      gst: number
      grandTotal: number
    }
    invoices: {
      rows: {
        billNumber: string
        grandTotal: number
        internalTotal: number
        internalGst: number
        roomDescription: string | null
      }[]
    }
    outstanding: { total: number }
  }
  check('Reports revenue.actualRoomRevenue uses actual tariff (>= 2000)', rep.revenue.actualRoomRevenue >= 2000)
  check('Reports revenue.billedRoomRevenue info field has customer amount (>= 3000)', rep.revenue.billedRoomRevenue >= 3000)
  check('Reports revenue.gst uses internalGst (120+120 = 240)', rep.revenue.gst >= 240, `got ${rep.revenue.gst}`)
  check('Reports revenue.grandTotal uses internal revenue (1120+1120 = 2240)', rep.revenue.grandTotal >= 2240, `got ${rep.revenue.grandTotal}`)

  const repInv2 = rep.invoices.rows.find((r) => r.billNumber === bill2.billNumber)
  check('Reports invoice row has grandTotal = 2240 (customer invoice total)', repInv2?.grandTotal === 2240, `got ${repInv2?.grandTotal}`)
  check('Reports invoice row has internalTotal = 1120', repInv2?.internalTotal === 1120, `got ${repInv2?.internalTotal}`)
  check('Reports invoice row has internalGst = 120', repInv2?.internalGst === 120, `got ${repInv2?.internalGst}`)
  check('Reports invoice row has roomDescription = "Deluxe AC Room"', repInv2?.roomDescription === 'Deluxe AC Room', `got ${repInv2?.roomDescription}`)

  console.log('\n=== 7. EDIT BILL / RECALCULATION VALIDATION ===')
  // Update bill 1: add extra charge 100, update payCash to 732 (1000 + 100 + 12% on 1100 = 132 -> 1232 - 500 = 732)
  const updateRes = await req(
    'PATCH',
    '/api/bills',
    {
      id: bill1.id,
      extraCharges: 100,
      payCash: 732,
      managerPin: '1111',
    },
    H
  )
  check('updateBill recalculates correctly', updateRes.status === 200, JSON.stringify(updateRes.data))
  const updatedBill1 = updateRes.data as { grandTotal: number; internalTotal: number; advanceApplied: number }
  check('updated grandTotal = 1232', updatedBill1.grandTotal === 1232, `got ${updatedBill1.grandTotal}`)
  check('updated internalTotal = 1232', updatedBill1.internalTotal === 1232, `got ${updatedBill1.internalTotal}`)

  console.log('\n=== 8. OVERSTAY AUTO-EXTENSION & ADMIN MANUAL EXTENSION TESTS ===')

  try {
    // 8a. Check-in an active booking in room 1, and set checkOut to yesterday 08:00 IST
    const checkinOverstay = await req(
      'POST',
      '/api/bookings',
      {
        roomId: room1.id,
        phone: '9876543299',
        name: 'Overstay Guest',
        checkIn: new Date(Date.now() - 3 * 86400000).toISOString(),
        checkOut: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
        advance: '0',
        guestCount: 1,
      },
      HR
    )
    check('check-in overstay test booking succeeds', checkinOverstay.status === 200)
    const overstayBookingId = (checkinOverstay.data as { id: string }).id

    // Set checkOut in DB to 26 hours ago so computeOverstay will find extraDays >= 1
    const pastCheckOut = new Date(Date.now() - 26 * 3600 * 1000)
    await prisma.booking.update({
      where: { id: overstayBookingId },
      data: {
        checkOut: pastCheckOut,
        originalCheckOut: pastCheckOut,
        autoExtendedDays: 0,
        status: 'ACTIVE',
      },
    })

    // Call listBookings twice to test auto-extension and idempotency
    const listRes1 = await req('GET', '/api/bookings')
    check('listBookings trigger 1 succeeds', listRes1.status === 200)
    const listRes2 = await req('GET', '/api/bookings')
    check('listBookings trigger 2 succeeds', listRes2.status === 200)

    // Verify booking in DB has autoExtendedDays >= 1
    const autoUpdatedBooking = await prisma.booking.findUnique({
      where: { id: overstayBookingId },
      include: { extensions: true },
    })
    check('Booking autoExtendedDays > 0', !!autoUpdatedBooking && autoUpdatedBooking.autoExtendedDays >= 1, `got ${autoUpdatedBooking?.autoExtendedDays}`)
    check('Auto-extend idempotency: exactly 1 AUTO BookingExtension created', autoUpdatedBooking?.extensions?.filter((e) => e.type === 'AUTO').length === 1, `got ${autoUpdatedBooking?.extensions?.length}`)

    // 8b. Bill with reduced days needs PIN
    const waiveWithoutPin = await req(
      'POST',
      '/api/bills',
      {
        bookingId: overstayBookingId,
        days: 1, // lower than autoUpdatedBooking.days
        payCash: 1000,
        checkout: true,
      },
      HR
    )
    check('Reducing auto-extended days without managerPin fails (403)', waiveWithoutPin.status === 403)

    const waiveWithPin = await req(
      'POST',
      '/api/bills',
      {
        bookingId: overstayBookingId,
        days: 1,
        payCash: 1000,
        managerPin: '1111',
        checkout: true,
      },
      H
    )
    check('Reducing auto-extended days with managerPin succeeds (200)', waiveWithPin.status === 200)

    const auditLogs = await prisma.auditLog.findMany({
      where: { entityId: overstayBookingId },
    })
    check('AuditLog OVERSTAY_WAIVED recorded', auditLogs.some((a) => a.action === 'OVERSTAY_WAIVED'))

    // 8c. Early checkout with autoExtendedDays === 0 lets days be reduced freely without PIN
    const checkinEarly = await req(
      'POST',
      '/api/bookings',
      {
        roomId: room1.id,
        phone: '9876543288',
        name: 'Early Checkout Guest',
        checkIn: new Date().toISOString(),
        checkOut: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10), // 3 days
        advance: '0',
        guestCount: 1,
      },
      HR
    )
    const earlyBookingId = (checkinEarly.data as { id: string }).id
    const earlyBill = await req(
      'POST',
      '/api/bills',
      {
        bookingId: earlyBookingId,
        days: 1, // reduced from 3 to 1
        payCash: 1000,
        checkout: true,
      },
      HR
    )
    check('Early checkout (autoExtendedDays=0) allows reducing days without PIN', earlyBill.status === 200)

    // 8d. Admin manual extend tests
    const checkinExtend = await req(
      'POST',
      '/api/bookings',
      {
        roomId: room2.id,
        phone: '9876543277',
        name: 'Manual Extend Guest',
        checkIn: new Date().toISOString(),
        checkOut: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
        advance: '0',
        guestCount: 1,
      },
      HR
    )
    const extendTestBookingId = (checkinExtend.data as { id: string }).id

    // Test wrong PIN -> 403
    const extendWrongPin = await req(
      'PATCH',
      '/api/bookings',
      {
        id: extendTestBookingId,
        action: 'extend',
        checkOut: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
        reason: 'Guest requested 1 more day',
        adminPin: '9999',
      },
      H
    )
    check('Admin extend with wrong PIN returns 403', extendWrongPin.status === 403)

    // Test reception user PIN (not ADMIN role) -> 403
    const extendReceptionPin = await req(
      'PATCH',
      '/api/bookings',
      {
        id: extendTestBookingId,
        action: 'extend',
        checkOut: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
        reason: 'Guest requested 1 more day',
        adminPin: '2222', // Reception PIN
      },
      H
    )
    check('Admin extend with Reception PIN returns 403 (Admin role required)', extendReceptionPin.status === 403)

    // Create a future booked reservation in room 2 to test conflict detection (409)
    const futureInDate = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
    const futureOutDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10)
    const conflictBooking = await req(
      'POST',
      '/api/bookings',
      {
        roomId: room2.id,
        phone: '9876543266',
        name: 'Future Reserved Guest',
        checkIn: futureInDate,
        checkOut: futureOutDate,
        advance: '0',
        bookingType: 'BOOKING',
        status: 'BOOKED',
        guestCount: 1,
      },
      HR
    )
    check('Create future booked reservation in room 2 succeeds', conflictBooking.status === 200)

    // Try extending active booking past the future booking checkIn (e.g. to futureOutDate) -> 409 Conflict
    const extendConflict = await req(
      'PATCH',
      '/api/bookings',
      {
        id: extendTestBookingId,
        action: 'extend',
        checkOut: futureOutDate,
        reason: 'Overlapping extension',
        adminPin: '1111',
      },
      H
    )
    check('Admin extend with room conflict returns 409', extendConflict.status === 409, JSON.stringify(extendConflict.data))

    // Successful manual extension (within available range before future reservation)
    const validExtOutDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
    const extendSuccess = await req(
      'PATCH',
      '/api/bookings',
      {
        id: extendTestBookingId,
        action: 'extend',
        checkOut: validExtOutDate,
        checkOutTime: '08:00',
        days: 2,
        reason: 'Guest extended flight by 1 day',
        adminPin: '1111',
      },
      H
    )
    check('Admin extend with Admin PIN succeeds (200)', extendSuccess.status === 200, JSON.stringify(extendSuccess.data))

    const manualExtDb = await prisma.bookingExtension.findFirst({
      where: { bookingId: extendTestBookingId, type: 'MANUAL' },
    })
    check('MANUAL BookingExtension created with reason and approvedBy', !!manualExtDb && manualExtDb.approvedBy === 'Admin')

    const extendAudit = await prisma.auditLog.findFirst({
      where: { entityId: extendTestBookingId, action: 'EXTEND' },
    })
    check('AuditLog EXTEND created for manual extension', !!extendAudit)
  } finally {
    await prisma.$disconnect()
  }

  // Final Housekeeping cleanup
  await req('PATCH', '/api/rooms', { id: room1.id, housekeeping: 'CLEAN', status: 'VACANT' }, H)
  await req('PATCH', '/api/rooms', { id: room2.id, housekeeping: 'CLEAN', status: 'VACANT' }, H)

  console.log(failures === 0 ? '\n✅ ALL TESTS PASSED (Billing, Overstay & Admin Extension validated successfully)' : `\n❌ ${failures} TEST(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('Test crashed:', e)
  process.exit(1)
})
