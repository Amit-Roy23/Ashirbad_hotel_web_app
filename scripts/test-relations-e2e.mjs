// Cross-module relation checks (rooms <-> bookings <-> bills <-> food <-> ledger <-> staff <-> banquet).
// Run against an EMPTY test database with the app running:
//   npm run dev   then   BASE=http://localhost:3000 node scripts/test-relations-e2e.mjs
const BASE = process.env.BASE || 'http://localhost:3000'
const H = { 'Content-Type': 'application/json', 'X-User-Name': 'Tester', 'X-User-Role': 'ADMIN' }
let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ok  ', name) } else { fail++; console.log('  FAIL', name, extra) }
}
async function call(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}
const istDate = (d) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10)
const today = istDate(new Date())
const plus = (n) => istDate(new Date(Date.now() + n * 864e5))
const rooms = async () => (await call('GET', '/api/rooms')).data
const room = async (num) => (await rooms()).find((r) => r.number === num)
const ledger = async () => (await call('GET', '/api/ledger')).data.entries

console.log('— setup')
for (const n of ['101', '102', '103', '104']) await call('POST', '/api/rooms', { number: n, type: 'AC', rate: 1000, capacity: 2 })
await call('PATCH', '/api/settings', { gstPercent: '5' })
const r101 = await room('101'), r102 = await room('102'), r103 = await room('103'), r104 = await room('104')

console.log('— walk-in check-in time is the real instant (no 5.5h shift)')
const before = Date.now()
let res = await call('POST', '/api/bookings', { roomId: r101.id, phone: '9876500001', name: 'Asha', checkIn: new Date().toISOString(), checkOut: plus(2), bookingType: 'CHECKIN', advance: 500, advanceMethod: 'UPI' })
const bA = res.data
check('walk-in created', res.status === 200, JSON.stringify(res.data))
check('checkIn ≈ now', Math.abs(new Date(bA.checkIn).getTime() - before) < 120e3, bA.checkIn)
check('room 101 OCCUPIED', (await room('101')).status === 'OCCUPIED')

console.log('— advance booking for today on an occupied room keeps it OCCUPIED')
res = await call('POST', '/api/bookings', { roomId: r102.id, phone: '9876500002', name: 'Bala', checkIn: new Date().toISOString(), checkOut: today, bookingType: 'CHECKIN' })
const bB = res.data
check('walk-in 102 (out today)', res.status === 200, JSON.stringify(res.data))
res = await call('POST', '/api/bookings', { roomId: r102.id, phone: '9876500003', name: 'Chitra', checkIn: today, checkOut: plus(1), bookingType: 'BOOKING' })
const bC = res.data
check('advance booking 102 today', res.status === 200, JSON.stringify(res.data))
check('room 102 still OCCUPIED (was flipped to BOOKED)', (await room('102')).status === 'OCCUPIED', (await room('102')).status)

console.log('— cancelling a future reservation does not free an occupied room')
res = await call('POST', '/api/bookings', { roomId: r101.id, phone: '9876500004', name: 'Dev', checkIn: plus(4), checkOut: plus(6), bookingType: 'BOOKING' })
const bD = res.data
check('future booking 101', res.status === 200, JSON.stringify(res.data))
res = await call('PATCH', '/api/bookings', { id: bD.id, action: 'cancel' })
check('cancel ok', res.status === 200)
check('room 101 still OCCUPIED (was set VACANT)', (await room('101')).status === 'OCCUPIED', (await room('101')).status)
res = await call('PATCH', '/api/bookings', { id: bD.id, action: 'cancel' })
check('cannot cancel twice', res.status === 400)

console.log('— room status guards')
res = await call('PATCH', '/api/rooms', { id: r101.id, status: 'MAINTENANCE' })
check('cannot put occupied room in maintenance', res.status === 400)
res = await call('PATCH', '/api/rooms', { id: r101.id, status: 'BOOKED' })
check('cannot hand-set BOOKED', res.status === 400)

console.log('— change room respects future reservations on the target')
await call('POST', '/api/bookings', { roomId: r103.id, phone: '9876500005', name: 'Esha', checkIn: plus(1), checkOut: plus(3), bookingType: 'BOOKING' })
res = await call('PATCH', '/api/bookings', { id: bA.id, action: 'change-room', newRoomId: r103.id })
check('move into room reserved tomorrow blocked', res.status === 400, JSON.stringify(res.data))
res = await call('PATCH', '/api/bookings', { id: bA.id, action: 'change-room', newRoomId: r104.id })
check('move into free room ok', res.status === 200, JSON.stringify(res.data))
check('104 OCCUPIED, 101 VACANT+DIRTY', (await room('104')).status === 'OCCUPIED' && (await room('101')).status === 'VACANT' && (await room('101')).housekeeping === 'DIRTY')

console.log('— checkout requires a bill; food must not be orphaned')
res = await call('PATCH', '/api/bookings', { id: bA.id, action: 'checkout' })
check('checkout without bill blocked', res.status === 400, JSON.stringify(res.data))
res = await call('POST', '/api/orders', { bookingId: bA.id, roomId: r101.id, items: [{ name: 'Tea', price: 50, quantity: 2 }] })
const order1 = res.data
check('order roomId follows booking (104 not stale 101)', order1.roomId === r104.id, order1.roomId)
res = await call('POST', '/api/orders', { bookingId: bD.id, items: [{ name: 'Tea', price: 50, quantity: 1 }] })
check('order on cancelled stay blocked', res.status === 400)
res = await call('POST', '/api/bills', { bookingId: bA.id, days: 2, gstPercent: 5, includeFood: false, payCash: 0 })
check('bill+checkout leaving pending food blocked', res.status === 400, JSON.stringify(res.data))
res = await call('POST', '/api/bills', { bookingId: bA.id, days: 2, gstPercent: 5, includeFood: true, extraCharges: 200, discount: 300, payCash: 1000 })
const bill1 = res.data
check('bill created (fresh DB invoice counter)', res.status === 200, JSON.stringify(res.data))
const billRows = (await ledger()).filter((e) => e.refId === bill1.id)
const ledgerSum = billRows.reduce((s, e) => s + e.amount, 0)
check('ledger rows sum to internalTotal', Math.abs(ledgerSum - bill1.internalTotal) < 0.01, `${ledgerSum} vs ${bill1.internalTotal}`)
check('room 104 VACANT+DIRTY after checkout', (await room('104')).status === 'VACANT' && (await room('104')).housekeeping === 'DIRTY')
res = await call('PATCH', '/api/orders', { id: order1.id, action: 'paid', method: 'CASH' })
check('cannot mark billed order paid again', res.status === 400)
res = await call('DELETE', `/api/orders?id=${order1.id}`)
check('cannot delete order that is on an invoice', res.status === 400)
res = await call('POST', '/api/bills', { bookingId: bA.id, days: 2, includeFood: true })
check('duplicate bill on completed stay blocked', res.status === 400)

console.log('— advance edits keep booking, ledger and invoice in step')
const advRow = (await ledger()).find((e) => e.refId === bA.id && e.category === 'ADVANCE')
check('advance ledger row exists', !!advRow)
res = await call('DELETE', `/api/ledger?id=${advRow.id}`)
check('delete advance row ok', res.status === 200, JSON.stringify(res.data))
let bills = (await call('GET', '/api/bills')).data
check('invoice advanceApplied now 0', bills.find((b) => b.id === bill1.id).advanceApplied === 0)
const bkA = (await call('GET', '/api/bookings')).data.find((b) => b.id === bA.id)
check('booking advance now 0', bkA.advance === 0)
const roomRentRow = (await ledger()).find((e) => e.refId === bill1.id && e.category === 'ROOM_RENT')
res = await call('DELETE', `/api/ledger?id=${roomRentRow.id}`)
check('invoice-generated ledger row is locked', res.status === 400)

console.log('— deleting an invoice returns its food to pending')
res = await call('DELETE', `/api/bills?id=${bill1.id}`)
check('delete bill ok', res.status === 200)
const orders = (await call('GET', '/api/orders')).data
check('food back to PENDING', orders.find((o) => o.id === order1.id).status === 'PENDING')
check('bill ledger rows gone', (await ledger()).filter((e) => e.refId === bill1.id).length === 0)

console.log('— reservation due today, checkout of previous guest, check-in')
res = await call('POST', '/api/bills', { bookingId: bB.id, days: 1, payCash: 0 })
check('bill+checkout 102', res.status === 200, JSON.stringify(res.data))
check('102 now BOOKED for Chitra (was VACANT)', (await room('102')).status === 'BOOKED', (await room('102')).status)
res = await call('PATCH', '/api/bookings', { id: bC.id, action: 'checkin' })
check('check-in Chitra', res.status === 200, JSON.stringify(res.data))
check('102 OCCUPIED', (await room('102')).status === 'OCCUPIED')

console.log('— stats agree with rooms')
const stats = (await call('GET', '/api/stats')).data
const rs = await rooms()
check('stats.occupied matches', stats.occupied === rs.filter((r) => r.status === 'OCCUPIED').length)

console.log('— restaurant payments reach reports')
res = await call('POST', '/api/orders', { bookingId: bC.id, items: [{ name: 'Lunch', price: 300, quantity: 1 }] })
await call('PATCH', '/api/orders', { id: res.data.id, action: 'paid', method: 'UPI' })
const rep = (await call('GET', `/api/reports?from=${plus(-1)}&to=${plus(1)}`)).data
check('room guest paid-at-restaurant order counted', rep.collections.directFood >= 300, String(rep.collections.directFood))

console.log('— staff payments')
const staff = (await call('POST', '/api/staff', { name: 'Ravi', salary: 10000 })).data
const sp = (await call('POST', '/api/staff-payments', { staffId: staff.id, type: 'SALARY', amount: 5000 })).data
check('salary expense row', (await ledger()).some((e) => e.refId === sp.id))
await call('DELETE', `/api/staff-payments?id=${sp.id}`)
check('deleting payment removes expense', !(await ledger()).some((e) => e.refId === sp.id))
const ded = (await call('POST', '/api/staff-payments', { staffId: staff.id, type: 'DEDUCTION', amount: 700 })).data
check('deduction is not an expense', !(await ledger()).some((e) => e.refId === ded.id))
const sp2 = (await call('POST', '/api/staff-payments', { staffId: staff.id, type: 'SALARY', amount: 4000 })).data
const spRow = (await ledger()).find((e) => e.refId === sp2.id)
await call('PATCH', '/api/ledger', { id: spRow.id, amount: 4500 })
const staffNow = (await call('GET', '/api/staff')).data.find((s) => s.id === staff.id)
check('editing expense updates staff payment', staffNow.payments.find((p) => p.id === sp2.id).amount === 4500)

console.log('— room delete keeps billing history')
res = await call('DELETE', `/api/rooms?id=${r101.id}`)
check('room with past bookings not deletable', res.status === 400, JSON.stringify(res.data))

console.log('— banquet')
const halls = (await call('GET', '/api/banquet-halls')).data
const hall = halls[0]
const D = plus(10)
res = await call('POST', '/api/banquet-bookings', { hallId: hall.id, customerName: 'K', customerPhone: '9000000001', eventName: 'Wedding', eventDate: D, slot: 'EVENING', hallRent: 10000, advancePaid: 1000 })
const bq1 = res.data
check('banquet booking 1', res.status === 200, JSON.stringify(res.data))
res = await call('POST', '/api/banquet-bookings', { hallId: hall.id, customerName: 'L', customerPhone: '9000000002', eventName: 'Party', eventDate: D, slot: 'EVENING', hallRent: 5000 })
check('same hall/date/slot blocked', res.status === 400, JSON.stringify(res.data))
res = await call('POST', '/api/banquet-bookings', { hallId: hall.id, customerName: 'L', customerPhone: '9000000002', eventName: 'Party', eventDate: D, slot: 'FULL_DAY', hallRent: 5000 })
check('FULL_DAY over existing slot blocked', res.status === 400)
res = await call('POST', '/api/banquet-bookings', { hallId: hall.id, customerName: 'M', customerPhone: '9000000003', eventName: 'Seminar', eventDate: D, slot: 'MORNING', hallRent: 5000, status: 'ENQUIRY' })
const bq2 = res.data
check('morning enquiry ok, status kept', res.status === 200 && bq2.status === 'ENQUIRY', JSON.stringify(res.data))
res = await call('PATCH', '/api/banquet-bookings', { id: bq1.id, advancePaid: 3000, advanceMethod: 'UPI' })
let adv = (await ledger()).filter((e) => e.refId === bq1.id && e.category === 'ADVANCE').reduce((s, e) => s + e.amount, 0)
check('edited banquet advance reaches ledger (3000)', adv === 3000, String(adv))
res = await call('PATCH', '/api/banquet-bookings', { id: bq1.id, advancePaid: 2500 })
adv = (await ledger()).filter((e) => e.refId === bq1.id && e.category === 'ADVANCE').reduce((s, e) => s + e.amount, 0)
check('reduced banquet advance reflected (2500)', adv === 2500, String(adv))
res = await call('POST', '/api/banquet-bills', { banquetBookingId: bq1.id, gstPercent: 18, payCash: 1000 })
const bqBill = res.data
check('banquet bill', res.status === 200, JSON.stringify(res.data))
check('banquet income not booked as ROOM_RENT', (await ledger()).filter((e) => e.refId === bqBill.id).every((e) => e.category === 'BANQUET'))
res = await call('POST', '/api/banquet-bills', { banquetBookingId: bq1.id })
check('duplicate banquet bill blocked', res.status === 400)
res = await call('DELETE', `/api/banquet-bills?id=${bqBill.id}`)
const bqAfter = (await call('GET', '/api/banquet-bookings')).data.find((b) => b.id === bq1.id)
check('deleting invoice reopens booking', bqAfter.status === 'CONFIRMED', bqAfter.status)
check('banquet bill ledger gone', !(await ledger()).some((e) => e.refId === bqBill.id))
await call('DELETE', `/api/banquet-bookings?id=${bq2.id}`)
res = await call('POST', '/api/banquet-bookings', { hallId: hall.id, customerName: 'N', customerPhone: '9000000004', eventName: 'Meet', eventDate: plus(20), slot: 'MORNING', hallRent: 1000 })
check('booking number does not collide after a delete', res.status === 200, JSON.stringify(res.data))
await call('DELETE', `/api/banquet-bookings?id=${bq1.id}`)
check('deleting banquet booking clears its advance', !(await ledger()).some((e) => e.refId === bq1.id))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
