import { prisma } from '@/lib/prisma'

/**
 * Staff pay.
 *
 * MONTHLY staff earn their fixed salary per month (period "yyyy-mm"); DAILY staff earn their daily rate for
 * every day worked (full day = 1, half day = 0.5), recorded as work days and paid in one go.
 *
 * Advances: money given ahead of salary (an expense the day it is given). The outstanding advance is
 *   advances given − recovered from salaries − returned in cash.
 * Paying salary: net paid = salary earned − advance recovered − other deductions (never below 0). Only the
 * net leaves the cash box, so only the net is written to Expenses; together with the advance already
 * expensed, the staff cost equals the salary earned.
 */

export class StaffError extends Error {}

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}
const text = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v).trim()
  return s || null
}
const MODES = ['CASH', 'UPI', 'CARD', 'BANK']
export const PAY_TYPES = ['SALARY', 'ADVANCE', 'ADVANCE_RETURN', 'BONUS', 'DEDUCTION'] as const

export function currentPeriod(d = new Date()) {
  return new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 7)
}

export function periodLabel(period: string | null | undefined) {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return period || ''
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

type StaffWithMoney = {
  salary: number
  dailyRate: number
  payType: string
  payments: { type: string; amount: number; gross: number; recovered: number; deduction: number; period: string | null }[]
  workDays: { units: number; paymentId: string | null }[]
}

export function staffSummary(s: StaffWithMoney) {
  const sum = (type: string, f: (p: StaffWithMoney['payments'][number]) => number) =>
    r2(s.payments.filter((p) => p.type === type).reduce((t, p) => t + f(p), 0))
  const advanceGiven = sum('ADVANCE', (p) => p.amount)
  const advanceRecovered = sum('SALARY', (p) => p.recovered)
  const advanceReturned = sum('ADVANCE_RETURN', (p) => p.amount)
  const advanceOutstanding = r2(Math.max(0, advanceGiven - advanceRecovered - advanceReturned))
  const salaryNetPaid = sum('SALARY', (p) => p.amount)
  const salaryEarnedPaid = sum('SALARY', (p) => p.gross || p.amount)
  const bonusPaid = sum('BONUS', (p) => p.amount)
  const deductions = r2(sum('SALARY', (p) => p.deduction) + sum('DEDUCTION', (p) => p.amount))
  const unpaidDays = r2(s.workDays.filter((w) => !w.paymentId).reduce((t, w) => t + w.units, 0))
  const period = currentPeriod()
  const thisMonthPaid = r2(
    s.payments.filter((p) => p.type === 'SALARY' && p.period === period).reduce((t, p) => t + (p.gross || p.amount), 0)
  )
  return {
    advanceGiven,
    advanceRecovered,
    advanceReturned,
    advanceOutstanding,
    salaryNetPaid,
    salaryEarnedPaid,
    bonusPaid,
    deductions,
    // money that left the cash box for this person
    totalPaidOut: r2(salaryNetPaid + bonusPaid + advanceGiven - advanceReturned),
    unpaidDays,
    unpaidAmount: s.payType === 'DAILY' ? r2(unpaidDays * s.dailyRate) : 0,
    currentPeriod: period,
    thisMonthPaid,
    thisMonthDue: s.payType === 'MONTHLY' ? r2(Math.max(0, s.salary - thisMonthPaid)) : 0,
  }
}

const staffInclude = {
  payments: { orderBy: [{ date: 'desc' as const }, { createdAt: 'desc' as const }] },
  workDays: { orderBy: { date: 'desc' as const } },
}

export async function listStaff(filter: { q?: string | null; role?: string | null }) {
  const rows = await prisma.staff.findMany({
    where: {
      ...(filter.role ? { role: filter.role } : {}),
      ...(filter.q
        ? {
            OR: [
              { name: { contains: filter.q, mode: 'insensitive' } },
              { phone: { startsWith: filter.q } },
              { role: { contains: filter.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    orderBy: { name: 'asc' },
    include: staffInclude,
  })
  return rows.map((s) => ({ ...s, summary: staffSummary(s) }))
}

function staffFields(data: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {}
  if (!partial || data.name !== undefined) {
    const name = text(data.name)
    if (!name) throw new StaffError('Name is required')
    out.name = name
  }
  if (data.phone !== undefined) {
    const digits = String(data.phone || '').replace(/\D/g, '')
    if (digits && digits.length !== 10) throw new StaffError('Staff phone number must be a valid 10-digit mobile number.')
    out.phone = digits || null
  }
  if (data.role !== undefined) out.role = text(data.role) || 'Staff'
  if (data.payType !== undefined) out.payType = data.payType === 'DAILY' ? 'DAILY' : 'MONTHLY'
  if (data.salary !== undefined) {
    if (num(data.salary) < 0) throw new StaffError('Salary cannot be negative')
    out.salary = r2(num(data.salary))
  }
  if (data.dailyRate !== undefined) {
    if (num(data.dailyRate) < 0) throw new StaffError('Daily rate cannot be negative')
    out.dailyRate = r2(num(data.dailyRate))
  }
  if (data.joinDate !== undefined && data.joinDate) {
    const d = new Date(`${String(data.joinDate).slice(0, 10)}T12:00:00+05:30`)
    if (isNaN(d.getTime())) throw new StaffError('Invalid join date')
    out.joinDate = d
  }
  if (data.address !== undefined) out.address = text(data.address)
  if (data.aadhaar !== undefined) out.aadhaar = text(data.aadhaar)
  if (data.active !== undefined) out.active = data.active !== false
  return out
}

export async function createStaff(data: Record<string, unknown>) {
  const fields = staffFields(data, false)
  if (fields.payType === 'DAILY' && !(Number(fields.dailyRate) > 0)) throw new StaffError('Enter the daily rate for day-basis staff')
  const s = await prisma.staff.create({ data: fields as never, include: staffInclude })
  return { ...s, summary: staffSummary(s) }
}

/** Returns the updated staff member and a readable list of what changed */
export async function updateStaff(data: Record<string, unknown>) {
  const id = text(data.id)
  if (!id) throw new StaffError('Staff id required')
  const before = await prisma.staff.findUnique({ where: { id } })
  if (!before) throw new StaffError('Staff member not found')
  const fields = staffFields(data, true)
  const nextType = (fields.payType as string) || before.payType
  const nextRate = fields.dailyRate !== undefined ? Number(fields.dailyRate) : before.dailyRate
  if (nextType === 'DAILY' && !(nextRate > 0)) throw new StaffError('Enter the daily rate for day-basis staff')
  const s = await prisma.staff.update({ where: { id }, data: fields as never, include: staffInclude })
  const show = (k: string, v: unknown) =>
    v instanceof Date ? v.toISOString().slice(0, 10) : k === 'salary' || k === 'dailyRate' ? `₹${v}` : v === null || v === '' ? '—' : String(v)
  const changes = Object.keys(fields)
    .filter((k) => show(k, (before as Record<string, unknown>)[k]) !== show(k, (s as Record<string, unknown>)[k]))
    .map((k) => `${k} ${show(k, (before as Record<string, unknown>)[k])} → ${show(k, (s as Record<string, unknown>)[k])}`)
  return { staff: { ...s, summary: staffSummary(s) }, changes }
}

/** Mark (or clear with units 0) a day worked by a DAILY staff member; paid days are locked */
export async function setWorkDay(data: Record<string, unknown>) {
  const staffId = text(data.staffId)
  const date = String(data.date || '').slice(0, 10)
  if (!staffId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new StaffError('Staff and date are required')
  const units = num(data.units)
  if (![0, 0.5, 1].includes(units)) throw new StaffError('A day is full (1), half (0.5) or cleared (0)')
  const staff = await prisma.staff.findUnique({ where: { id: staffId } })
  if (!staff) throw new StaffError('Staff member not found')
  const existing = await prisma.staffWorkDay.findUnique({ where: { staffId_date: { staffId, date } } })
  if (existing?.paymentId) throw new StaffError(`${date} is already paid and cannot be changed`)
  if (units === 0) {
    if (existing) await prisma.staffWorkDay.delete({ where: { id: existing.id } })
    return { staff, date, units: 0 }
  }
  await prisma.staffWorkDay.upsert({
    where: { staffId_date: { staffId, date } },
    update: { units },
    create: { staffId, date, units },
  })
  return { staff, date, units }
}

export async function recordStaffPayment(data: Record<string, unknown>) {
  const staffId = text(data.staffId)
  if (!staffId) throw new StaffError('Select a staff member')
  const type = String(data.type || 'SALARY').toUpperCase()
  if (!(PAY_TYPES as readonly string[]).includes(type)) throw new StaffError('Invalid payment type')
  const method = MODES.includes(String(data.method)) ? String(data.method) : 'CASH'
  const date = data.date ? new Date(`${String(data.date).slice(0, 10)}T12:00:00+05:30`) : new Date()
  if (isNaN(date.getTime())) throw new StaffError('Invalid date')
  const notes = text(data.notes)

  return prisma.$transaction(async (tx) => {
    // Lock the staff row so two payments at once cannot both recover the same advance
    await tx.$queryRaw`SELECT "id" FROM "Staff" WHERE "id" = ${staffId} FOR UPDATE`
    const staff = await tx.staff.findUnique({ where: { id: staffId }, include: staffInclude })
    if (!staff) throw new StaffError('Staff member not found')
    const summary = staffSummary(staff)

    let amount = r2(num(data.amount))
    let gross = 0
    let recovered = 0
    let deduction = 0
    let period: string | null = null
    let days = 0
    let dayIds: string[] = []

    if (type === 'SALARY') {
      if (staff.payType === 'DAILY') {
        const unpaid = staff.workDays.filter((w) => !w.paymentId)
        const upTo = data.upTo ? String(data.upTo).slice(0, 10) : null
        const toPay = upTo ? unpaid.filter((w) => w.date <= upTo) : unpaid
        if (toPay.length === 0) throw new StaffError('No unpaid work days to pay. Mark the days worked first.')
        days = r2(toPay.reduce((t, w) => t + w.units, 0))
        gross = r2(days * staff.dailyRate)
        dayIds = toPay.map((w) => w.id)
        const sorted = toPay.map((w) => w.date).sort()
        period = `${days} day${days === 1 ? '' : 's'} (${sorted[0]} to ${sorted[sorted.length - 1]})`
      } else {
        period = /^\d{4}-\d{2}$/.test(String(data.period)) ? String(data.period) : currentPeriod(date)
        const alreadyEarned = staff.payments
          .filter((p) => p.type === 'SALARY' && p.period === period)
          .reduce((t, p) => t + (p.gross || p.amount), 0)
        const remaining = r2(Math.max(0, staff.salary - alreadyEarned))
        gross = data.gross !== undefined && data.gross !== '' ? r2(num(data.gross)) : remaining
        if (gross <= 0) throw new StaffError(`Salary for ${periodLabel(period)} is already fully paid`)
        if (gross > remaining + 0.01) {
          throw new StaffError(`Only ${formatRs(remaining)} of the ${periodLabel(period)} salary is left to pay`)
        }
      }
      recovered = r2(Math.max(0, num(data.recovered)))
      deduction = r2(Math.max(0, num(data.deduction)))
      if (recovered > summary.advanceOutstanding + 0.01) {
        throw new StaffError(`Only ${formatRs(summary.advanceOutstanding)} advance is outstanding`)
      }
      amount = r2(gross - recovered - deduction)
      if (amount < -0.001) throw new StaffError('Recovery and deductions cannot be more than the salary earned')
      amount = Math.max(0, amount)
    } else {
      if (amount <= 0) throw new StaffError('Enter an amount')
      if (type === 'ADVANCE_RETURN' && amount > summary.advanceOutstanding + 0.01) {
        throw new StaffError(`Only ${formatRs(summary.advanceOutstanding)} advance is outstanding`)
      }
    }

    const payment = await tx.staffPayment.create({
      data: { staffId, type, amount, gross, recovered, deduction, period, days, method, date, notes, recoveryNotes: text(data.recoveryNotes) },
    })
    if (dayIds.length) await tx.staffWorkDay.updateMany({ where: { id: { in: dayIds } }, data: { paymentId: payment.id } })

    // Money out of the cash box is an expense; an advance returned in cash is money in.
    // A DEDUCTION (fine) moves no money.
    if (type !== 'DEDUCTION' && amount > 0) {
      const label =
        type === 'SALARY'
          ? `Salary ${staff.payType === 'DAILY' ? period : periodLabel(period)} - ${staff.name}${recovered > 0 ? ` (earned ₹${gross}, advance recovered ₹${recovered}${deduction > 0 ? `, deduction ₹${deduction}` : ''})` : deduction > 0 ? ` (earned ₹${gross}, deduction ₹${deduction})` : ''}`
          : type === 'ADVANCE'
            ? `Salary advance - ${staff.name}`
            : type === 'ADVANCE_RETURN'
              ? `Advance returned by ${staff.name}`
              : `Bonus - ${staff.name}`
      await tx.ledgerEntry.create({
        data: {
          date,
          type: type === 'ADVANCE_RETURN' ? 'INCOME' : 'EXPENSE',
          category: type === 'ADVANCE' || type === 'ADVANCE_RETURN' ? 'STAFF_ADVANCE' : 'SALARY',
          description: label,
          amount,
          method,
          source: 'AUTO',
          vendor: staff.name,
          refId: payment.id,
        },
      })
    }
    return { payment, staff, summaryBefore: summary }
  })
}

export async function deleteStaffPayment(id: string) {
  return prisma.$transaction(async (tx) => {
    const payment = await tx.staffPayment.findUnique({ where: { id }, include: { staff: { include: staffInclude } } })
    if (!payment) throw new StaffError('Payment record not found')
    const summary = staffSummary(payment.staff)
    // Removing an advance that has already been recovered would leave a negative balance
    if (payment.type === 'ADVANCE' && payment.amount > summary.advanceOutstanding + 0.01) {
      throw new StaffError(
        `Part of this advance (${formatRs(payment.amount - summary.advanceOutstanding)}) was already recovered from salary. Delete that salary payment first.`
      )
    }
    await tx.ledgerEntry.deleteMany({ where: { refId: id } })
    await tx.staffWorkDay.updateMany({ where: { paymentId: id }, data: { paymentId: null } })
    await tx.staffPayment.delete({ where: { id } })
    return payment
  })
}

function formatRs(n: number) {
  return `₹${r2(n).toLocaleString('en-IN')}`
}
