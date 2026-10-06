export {}

const BASE = 'http://localhost:3000'

async function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

async function run() {
  console.log('--- Testing Banquet API & Dedicated Billing ---')

  // 1. Get users for Admin auth
  const users = (await req('GET', '/api/users')).data as { id: string; name: string; role: string }[]
  const admin = users.find((u) => u.role === 'ADMIN') || { id: 'admin-1', name: 'Admin', role: 'ADMIN' }
  const H = { 'X-User-Id': admin.id, 'X-User-Name': 'Admin', 'X-User-Role': 'ADMIN' }

  // 2. Fetch Banquet Halls
  console.log('1. Fetching Banquet Halls...')
  const hallsRes = await req('GET', '/api/banquet-halls', undefined, H)
  console.log('Halls response status:', hallsRes.status, 'Count:', hallsRes.data.length)
  if (!Array.isArray(hallsRes.data) || hallsRes.data.length === 0) {
    throw new Error('Expected banquet halls to be present/seeded')
  }
  const hall = hallsRes.data[0]
  console.log(`Using hall: ${hall.name} (Cap: ${hall.capacity}, Base: ₹${hall.baseRate})`)

  // 3. Create a Banquet Booking
  console.log('\n2. Creating Banquet Booking...')
  const bookingPayload = {
    hallId: hall.id,
    customerName: 'Amit Roy (Wedding Host)',
    customerPhone: '9876543210',
    customerEmail: 'amit.roy@example.com',
    customerAddress: 'Park Street, Kolkata',
    companyName: 'Roy Family Celebrations',
    gstNumber: '19ABCDE1234F1Z5',
    eventName: 'Wedding Reception',
    eventDate: new Date().toISOString().slice(0, 10),
    slot: 'EVENING',
    guestCount: 200,
    hallRent: 30000,
    foodRatePerPlate: 750,
    foodPackageName: 'Royal Buffet Premium',
    foodTotal: 150000, // 200 x 750
    decorCharges: 25000,
    extraCharges: 5000,
    discount: 10000,
    advancePaid: 50000,
    advanceMethod: 'UPI',
    notes: 'Stage setup with floral theme by 4 PM',
  }

  const createBkgRes = await req('POST', '/api/banquet-bookings', bookingPayload, H)
  console.log('Create booking status:', createBkgRes.status)
  const booking = createBkgRes.data
  console.log(`Created booking: ${booking.bookingNumber}, ID: ${booking.id}, Est. Total: ₹${booking.totalEstimated}, Advance: ₹${booking.advancePaid}`)

  if (!booking.id || !booking.bookingNumber.startsWith('BNQ-BKG-')) {
    throw new Error('Failed to create valid banquet booking')
  }

  // 4. Check Banquet Stats
  console.log('\n3. Checking Banquet Stats...')
  const statsRes = await req('GET', '/api/banquet-stats', undefined, H)
  console.log('Banquet stats:', statsRes.data)

  // 5. Generate Dedicated Banquet Bill
  console.log('\n4. Generating Dedicated Banquet Invoice / Bill...')
  const billPayload = {
    banquetBookingId: booking.id,
    hallRent: 30000,
    foodCharges: 150000,
    decorCharges: 25000,
    soundAvCharges: 5000,
    extraCharges: 5000,
    discount: 10000,
    gstPercent: 18,
    advanceApplied: 50000,
    payCash: 0,
    payUpi: 180000,
    payCard: 6000,
    payBank: 0,
  }

  const createBillRes = await req('POST', '/api/banquet-bills', billPayload, H)
  console.log('Create bill status:', createBillRes.status)
  const bill = createBillRes.data
  console.log(`Generated Banquet Bill: ${bill.billNumber}, Grand Total: ₹${bill.grandTotal}, Status: ${bill.paymentStatus}`)

  if (!bill.id || !bill.billNumber.startsWith('BNQ-')) {
    throw new Error('Failed to create valid banquet invoice')
  }

  // 6. Fetch Banquet Bills
  console.log('\n5. Fetching Banquet Invoices list...')
  const listBillsRes = await req('GET', '/api/banquet-bills', undefined, H)
  console.log('Banquet Bills count:', listBillsRes.data.length)
  const matchedBill = listBillsRes.data.find((b: any) => b.id === bill.id)
  if (!matchedBill) {
    throw new Error('Generated banquet bill not found in bills list')
  }

  console.log('\n🎉 ALL BANQUET TESTS PASSED SUCCESSFULLY! Dedicated billing & management working flawlessly.')
}

run().catch((e) => {
  console.error('Test failed:', e)
  process.exit(1)
})
