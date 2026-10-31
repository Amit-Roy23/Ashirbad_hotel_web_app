import { prisma } from '@/lib/prisma'

/**
 * Day Book: every rupee that came in or went out, on the day it happened, with its mode.
 *
 * Money in : room bill payments (at checkout, dues collected later, corrections), room advances and
 *            part payments, restaurant orders paid at the counter, room food settled at checkout,
 *            banquet advances and invoice payments, other income entered by hand.
 * Money out: expenses, salaries and staff advances, refunds, inventory purchases.
 *
 * The ledger also holds accounting-only rows written when a room bill is made (room rent, extra
 * charges, lodging GST at the bill's full value, paid or not). Those are not money received and are
 * left out, so the Day Book never counts the same rupee twice.
 */

export type DayBookSource =
  | 'ROOM_BILL'
  | 'DUE_COLLECTED'
  | 'BILL_CORRECTION'
  | 'ROOM_ADVANCE'
  | 'PART_PAYMENT'
  | 'ROOM_FOOD'
  | 'RESTAURANT'
  | 'BANQUET_ADVANCE'
  | 'BANQUET_PAYMENT'
  | 'OTHER_INCOME'
  | 'EXPENSE'
  | 'SALARY'
  | 'STAFF_ADVANCE'
  | 'REFUND'
  | 'INVENTORY'

export interface DayBookEntry {
  id: string
  date: string
  direction: 'IN' | 'OUT'
  source: DayBookSource
  description: string
  party: string
  ref: string
  cash: number
  upi: number
  card: number
  bank: number
  other: number
  amount: number
  by?: string | null
}

export interface DayBookDay {
  date: string
  in: number
  out: number
  net: number
  inCash: number
  inUpi: number
  inCard: number
  inBank: number
  inOther: number
  outCash: number
  outOther: number
}

const r2 = (n: number) => Math.round(n * 100) / 100
const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)

/** Ledger rows written with a room bill for accounting only (see above) */
const ACCRUAL_RE = /^(Room .+ rent \(|Food charges - Room|Extra charges on bill|CGST .+ on bill |GST .+ on bill )/

function byMethod(method: string | null | undefined, amount: number) {
  const m = (method || '').toUpperCase()
  return {
    cash: m === 'CASH' ? amount : 0,
    upi: m === 'UPI' ? amount : 0,
    card: m === 'CARD' ? amount : 0,
    bank: m === 'BANK' ? amount : 0,
    other: ['CASH', 'UPI', 'CARD', 'BANK'].includes(m) ? 0 : amount,
  }
}

export async function getDayBook(from: Date, to: Date) {
  const [payments, ledger] = await Promise.all([
    prisma.billPayment.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'asc' },
      include: { bill: { select: { billNumber: true, booking: { select: { guest: { select: { name: true, phone: true } }, room: { select: { number: true } } } } } } },
    }),
    prisma.ledgerEntry.findMany({ where: { date: { gte: from, lte: to } }, orderBy: { date: 'asc' } }),
  ])

  const entries: DayBookEntry[] = []

  for (const p of payments) {
    if (Math.abs(p.amount) < 0.005) continue
    const guest = p.bill.booking?.guest
    entries.push({
      id: `bp-${p.id}`,
      date: p.date.toISOString(),
      direction: 'IN',
      source: p.kind === 'CHECKOUT' ? 'ROOM_BILL' : p.kind === 'DUE' ? 'DUE_COLLECTED' : 'BILL_CORRECTION',
      description:
        p.kind === 'CHECKOUT'
          ? `Room bill paid at checkout — Room ${p.bill.booking?.room?.number || ''}`
          : p.kind === 'DUE'
            ? `Due collected on bill ${p.bill.billNumber}`
            : `Payment corrected on bill ${p.bill.billNumber}`,
      party: guest ? `${guest.name}${guest.phone ? ` (${guest.phone})` : ''}` : '',
      ref: p.bill.billNumber,
      cash: p.cash,
      upi: p.upi,
      card: p.card,
      bank: 0,
      other: 0,
      amount: r2(p.amount),
      by: p.createdBy,
    })
  }

  // Restaurant / room food rows come as FOOD + GST pairs: show each payment once
  const foodGroups = new Map<string, DayBookEntry>()
  for (const e of ledger) {
    if (e.type === 'INCOME') {
      if (e.category === 'ROOM_RENT') continue
      if (e.source === 'AUTO' && ACCRUAL_RE.test(e.description)) continue
      if (e.category === 'OTHER' && e.source === 'AUTO') continue

      if (e.category === 'FOOD' || e.category === 'GST') {
        const roomFood = /fooding bill|Room Dining/i.test(e.description)
        const key = `${e.refId || e.id}|${e.method}|${istDay(e.date)}`
        const g = foodGroups.get(key)
        const split = byMethod(e.method, e.amount)
        if (g) {
          g.cash = r2(g.cash + split.cash)
          g.upi = r2(g.upi + split.upi)
          g.card = r2(g.card + split.card)
          g.bank = r2(g.bank + split.bank)
          g.other = r2(g.other + split.other)
          g.amount = r2(g.amount + e.amount)
          if (e.category === 'FOOD') g.description = e.description
        } else {
          const row: DayBookEntry = {
            id: `led-${e.id}`,
            date: e.date.toISOString(),
            direction: 'IN',
            source: roomFood ? 'ROOM_FOOD' : 'RESTAURANT',
            description: e.description,
            party: '',
            ref: roomFood ? 'Room food' : 'Restaurant',
            ...split,
            amount: r2(e.amount),
          }
          foodGroups.set(key, row)
          entries.push(row)
        }
        continue
      }

      const banquet = /banquet/i.test(e.description) || e.category === 'BANQUET'
      const source: DayBookSource =
        e.category === 'ADVANCE'
          ? banquet
            ? 'BANQUET_ADVANCE'
            : /^Part payment/i.test(e.description)
              ? 'PART_PAYMENT'
              : 'ROOM_ADVANCE'
          : e.category === 'BANQUET'
            ? 'BANQUET_PAYMENT'
            : 'OTHER_INCOME'
      entries.push({
        id: `led-${e.id}`,
        date: e.date.toISOString(),
        direction: 'IN',
        source,
        description: e.description,
        party: e.vendor || '',
        ref: e.category,
        ...byMethod(e.method, e.amount),
        amount: r2(e.amount),
      })
    } else {
      const source: DayBookSource =
        e.category === 'SALARY' || e.category === 'STAFF'
          ? 'SALARY'
          : e.category === 'STAFF_ADVANCE'
            ? 'STAFF_ADVANCE'
            : e.category === 'REFUND'
              ? 'REFUND'
              : e.category === 'INVENTORY'
                ? 'INVENTORY'
                : 'EXPENSE'
      entries.push({
        id: `led-${e.id}`,
        date: e.date.toISOString(),
        direction: 'OUT',
        source,
        description: e.description,
        party: e.vendor || '',
        ref: e.category,
        ...byMethod(e.method, e.amount),
        amount: r2(e.amount),
      })
    }
  }

  entries.sort((a, b) => a.date.localeCompare(b.date))

  const days = new Map<string, DayBookDay>()
  for (const e of entries) {
    const key = istDay(new Date(e.date))
    let d = days.get(key)
    if (!d) {
      d = { date: key, in: 0, out: 0, net: 0, inCash: 0, inUpi: 0, inCard: 0, inBank: 0, inOther: 0, outCash: 0, outOther: 0 }
      days.set(key, d)
    }
    if (e.direction === 'IN') {
      d.in = r2(d.in + e.amount)
      d.inCash = r2(d.inCash + e.cash)
      d.inUpi = r2(d.inUpi + e.upi)
      d.inCard = r2(d.inCard + e.card)
      d.inBank = r2(d.inBank + e.bank)
      d.inOther = r2(d.inOther + e.other)
    } else {
      d.out = r2(d.out + e.amount)
      d.outCash = r2(d.outCash + e.cash)
      d.outOther = r2(d.outOther + e.amount - e.cash)
    }
    d.net = r2(d.in - d.out)
  }
  const dayRows = [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
  const totals = dayRows.reduce(
    (t, d) => ({
      in: r2(t.in + d.in),
      out: r2(t.out + d.out),
      net: r2(t.net + d.net),
      inCash: r2(t.inCash + d.inCash),
      inUpi: r2(t.inUpi + d.inUpi),
      inCard: r2(t.inCard + d.inCard),
      inBank: r2(t.inBank + d.inBank),
      inOther: r2(t.inOther + d.inOther),
      outCash: r2(t.outCash + d.outCash),
    }),
    { in: 0, out: 0, net: 0, inCash: 0, inUpi: 0, inCard: 0, inBank: 0, inOther: 0, outCash: 0 }
  )
  return { entries, days: dayRows, totals }
}
