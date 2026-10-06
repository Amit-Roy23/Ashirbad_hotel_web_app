import { istDateStr, makeIST, calcNights, computeOverstay, nextAutoExtensionAt } from '../src/lib/stay'

let failures = 0
function assert(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.log(`  ✗ FAIL: ${name} ${detail}`)
  }
}

console.log('=== RUNNING STAY.TS TESTS ===')

// Test 1: check-in 8 Jan 14:00 IST, check-out 10 Jan 08:00 IST -> calcNights = 2
const checkIn = makeIST('2026-01-08', '14:00')
const checkOut = makeIST('2026-01-10', '08:00')
assert('calcNights(8 Jan 14:00 IST, 10 Jan 08:00 IST) == 2', calcNights(checkIn, checkOut) === 2, `got ${calcNights(checkIn, checkOut)}`)

const booking = {
  status: 'ACTIVE',
  checkIn,
  checkOut,
}

// Test 2: now = 10 Jan 07:59 IST -> no extension
const nowBefore = makeIST('2026-01-10', '07:59')
const resBefore = computeOverstay(booking, nowBefore, 0)
assert('10 Jan 07:59 IST -> no extension', !resBefore.overdue && resBefore.extraDays === 0, JSON.stringify(resBefore))

// Test 3: now = 10 Jan 08:01 IST -> k=1, newCheckOut 11 Jan 08:00, days 3
const nowAfter1 = makeIST('2026-01-10', '08:01')
const resAfter1 = computeOverstay(booking, nowAfter1, 0)
assert('10 Jan 08:01 IST -> k=1', resAfter1.overdue && resAfter1.extraDays === 1, JSON.stringify(resAfter1))
assert(
  'newCheckOut is 11 Jan 08:00 IST',
  resAfter1.newCheckOut ? istDateStr(resAfter1.newCheckOut) === '2026-01-11' : false,
  `got ${resAfter1.newCheckOut?.toISOString()}`
)
assert(
  'recomputed days with newCheckOut == 3',
  calcNights(checkIn, resAfter1.newCheckOut!) === 3,
  `got ${calcNights(checkIn, resAfter1.newCheckOut!)}`
)

// Test 4: now = 12 Jan 20:00 IST (nobody opened the app) -> k=3, newCheckOut 13 Jan 08:00, days 5
const nowLate = makeIST('2026-01-12', '20:00')
const resLate = computeOverstay(booking, nowLate, 0)
assert('12 Jan 20:00 IST -> k=3', resLate.overdue && resLate.extraDays === 3, JSON.stringify(resLate))
assert(
  'newCheckOut is 13 Jan 08:00 IST',
  resLate.newCheckOut ? istDateStr(resLate.newCheckOut) === '2026-01-13' : false,
  `got ${resLate.newCheckOut?.toISOString()}`
)
assert(
  'recomputed days with newCheckOut == 5',
  calcNights(checkIn, resLate.newCheckOut!) === 5,
  `got ${calcNights(checkIn, resLate.newCheckOut!)}`
)

// Test 5: Grace period 30 minutes: 10 Jan 08:20 -> no extension, 08:31 -> k=1
const nowGraceInside = makeIST('2026-01-10', '08:20')
const resGraceInside = computeOverstay(booking, nowGraceInside, 30)
assert('Grace 30m: 10 Jan 08:20 -> no extension', !resGraceInside.overdue && resGraceInside.extraDays === 0, JSON.stringify(resGraceInside))

const nowGraceAfter = makeIST('2026-01-10', '08:31')
const resGraceAfter = computeOverstay(booking, nowGraceAfter, 30)
assert('Grace 30m: 10 Jan 08:31 -> k=1', resGraceAfter.overdue && resGraceAfter.extraDays === 1, JSON.stringify(resGraceAfter))

// Test 6: nextAutoExtensionAt
const nextExt0 = nextAutoExtensionAt(booking, 0)
assert('nextAutoExtensionAt (0m grace) == 10 Jan 08:00 IST', nextExt0?.getTime() === checkOut.getTime())
const nextExt30 = nextAutoExtensionAt(booking, 30)
assert('nextAutoExtensionAt (30m grace) == 10 Jan 08:30 IST', nextExt30?.getTime() === checkOut.getTime() + 30 * 60 * 1000)

if (failures > 0) {
  console.error(`\nFAILED ${failures} test(s)`)
  process.exit(1)
} else {
  console.log('\nAll stay.ts unit tests passed!')
}
