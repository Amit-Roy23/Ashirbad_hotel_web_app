import { prisma } from '@/lib/prisma'
import { expenseHead } from '@/lib/restaurant-expense'

/**
 * Restaurant report for a date range:
 *  - sales from the food orders taken (items before GST, GST, bill total), by how they were settled
 *  - money actually collected for food (counter payments and room food settled at checkout), by mode
 *  - restaurant expenses (ledger EXPENSE rows in the RESTAURANT category), by head
 *  - profit = food sales before GST − restaurant expenses (GST is collected for the government)
 */

const r2 = (n: number) => Math.round(n * 100) / 100
const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10)

export async function getRestaurantReport(from: Date, to: Date) {
  const [orders, income, expenses] = await Promise.all([
    prisma.foodOrder.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: { items: true, room: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.ledgerEntry.findMany({
      where: { date: { gte: from, lte: to }, type: 'INCOME', OR: [{ category: 'FOOD' }, { category: 'GST', description: { contains: 'food', mode: 'insensitive' } }] },
    }),
    prisma.ledgerEntry.findMany({
      where: { date: { gte: from, lte: to }, type: 'EXPENSE', category: 'RESTAURANT' },
      orderBy: { date: 'desc' },
    }),
  ])

  const live = orders.filter((o) => o.status !== 'CANCELLED')
  const sub = (o: (typeof orders)[number]) => (o.subtotal > 0 ? o.subtotal : r2(o.total - (o.taxAmount || 0)))
  const sum = (list: typeof orders, f: (o: (typeof orders)[number]) => number) => r2(list.reduce((s, o) => s + f(o), 0))
  const group = (pred: (o: (typeof orders)[number]) => boolean) => {
    const list = live.filter(pred)
    return { count: list.length, total: sum(list, (o) => o.total) }
  }

  const sales = {
    orders: live.length,
    cancelled: orders.length - live.length,
    itemsValue: sum(live, sub),
    gst: sum(live, (o) => o.taxAmount || 0),
    total: sum(live, (o) => o.total),
    gstOrders: live.filter((o) => (o.taxAmount || 0) > 0).length,
    paidCounter: group((o) => o.status === 'PAID' && !o.bookingId),
    roomFood: group((o) => !!o.bookingId),
    pending: group((o) => o.status === 'PENDING'),
  }

  const collected = { cash: 0, upi: 0, card: 0, other: 0, total: 0, gst: 0 }
  for (const e of income) {
    const m = e.method === 'CASH' ? 'cash' : e.method === 'UPI' ? 'upi' : e.method === 'CARD' ? 'card' : 'other'
    collected[m] = r2(collected[m] + e.amount)
    collected.total = r2(collected.total + e.amount)
    if (e.category === 'GST') collected.gst = r2(collected.gst + e.amount)
  }

  const itemMap = new Map<string, { name: string; qty: number; amount: number }>()
  for (const o of live) {
    for (const it of o.items) {
      const key = it.name.trim().toLowerCase()
      const row = itemMap.get(key) || { name: it.name, qty: 0, amount: 0 }
      row.qty += it.quantity
      row.amount = r2(row.amount + it.price * it.quantity)
      itemMap.set(key, row)
    }
  }
  const topItems = [...itemMap.values()].sort((a, b) => b.amount - a.amount)

  const heads = new Map<string, number>()
  for (const e of expenses) heads.set(expenseHead(e.description), r2((heads.get(expenseHead(e.description)) || 0) + e.amount))
  const expenseTotal = r2(expenses.reduce((s, e) => s + e.amount, 0))

  const days = new Map<string, { date: string; orders: number; sales: number; gst: number; expenses: number }>()
  const day = (d: string) => days.get(d) || days.set(d, { date: d, orders: 0, sales: 0, gst: 0, expenses: 0 }).get(d)!
  for (const o of live) {
    const d = day(istDay(o.createdAt))
    d.orders += 1
    d.sales = r2(d.sales + sub(o))
    d.gst = r2(d.gst + (o.taxAmount || 0))
  }
  for (const e of expenses) {
    const d = day(istDay(e.date))
    d.expenses = r2(d.expenses + e.amount)
  }

  return {
    sales,
    collected,
    topItems,
    expenses: expenses.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      head: expenseHead(e.description),
      description: e.description,
      vendor: e.vendor,
      amount: e.amount,
      method: e.method,
    })),
    expenseHeads: [...heads.entries()].map(([head, amount]) => ({ head, amount })).sort((a, b) => b.amount - a.amount),
    expenseTotal,
    profit: r2(sales.itemsValue - expenseTotal),
    daily: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, profit: r2(d.sales - d.expenses) })),
  }
}

export type RestaurantReport = Awaited<ReturnType<typeof getRestaurantReport>>
