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
  console.log('Testing custom room number in bill generation and editing...')
  const users = (await req('GET', '/api/users')).data as { id: string; name: string; role: string }[]
  const admin = users.find((u) => u.role === 'ADMIN')!
  const H = { 'X-User-Id': admin.id, 'X-User-Name': 'Admin', 'X-User-Role': 'ADMIN' }

  const rooms = (await req('GET', '/api/rooms')).data as { id: string; number: string; rate: number; status: string }[]
  const vacantRoom = rooms.find((r) => r.status === 'VACANT')!

  // Check in
  const checkin = await req(
    'POST',
    '/api/bookings',
    {
      roomId: vacantRoom.id,
      phone: '9998887776',
      name: 'Custom Room Guest',
      checkIn: new Date().toISOString(),
      checkOut: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      advance: '0',
      guestCount: 1,
    },
    H
  )
  const bookingId = (checkin.data as { id: string }).id

  // Create bill with custom roomNumber "Suite-305"
  const billRes = await req(
    'POST',
    '/api/bills',
    {
      bookingId,
      days: 1,
      roomNumber: 'Suite-305',
      roomDescription: 'Executive Suite',
      billedRoomTotal: 1500,
      gstPercent: 12,
      payCash: 1680,
      managerPin: '1111',
      checkout: true,
    },
    H
  )

  console.log('Create bill status:', billRes.status)
  const bill = billRes.data as any
  console.log('Created bill roomNumber:', bill.roomNumber)
  if (bill.roomNumber !== 'Suite-305') {
    throw new Error(`Expected roomNumber 'Suite-305', got '${bill.roomNumber}'`)
  }

  // Edit bill to change roomNumber to "Suite-306"
  const editRes = await req(
    'PATCH',
    '/api/bills',
    {
      id: bill.id,
      roomNumber: 'Suite-306',
      managerPin: '1111',
    },
    H
  )
  console.log('Edit bill status:', editRes.status)
  const updatedBill = editRes.data as any
  console.log('Updated bill roomNumber:', updatedBill.roomNumber)
  if (updatedBill.roomNumber !== 'Suite-306') {
    throw new Error(`Expected roomNumber 'Suite-306', got '${updatedBill.roomNumber}'`)
  }

  // Check reports invoice row
  const reportsRes = await req('GET', '/api/reports?range=today', undefined, H)
  const invoices = reportsRes.data.invoices.rows as any[]
  const matched = invoices.find((inv) => inv.id === bill.id)
  console.log('Report row roomNumber:', matched?.roomNumber)
  if (matched?.roomNumber !== 'Suite-306') {
    throw new Error(`Expected report row roomNumber 'Suite-306', got '${matched?.roomNumber}'`)
  }

  console.log('✅ Custom room number test passed successfully!')
}

run().catch((e) => {
  console.error('Test failed:', e)
  process.exit(1)
})
