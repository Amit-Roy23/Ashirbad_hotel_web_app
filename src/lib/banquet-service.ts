import { prisma } from '@/lib/prisma'
import { istDateStr } from '@/lib/stay'
import { computeGst, isValidHalfRate } from '@/lib/gst'
import { BanquetBooking, BanquetBill, BanquetHall, BanquetStats } from '@/types/banquet'
import { MAX_BANQUET_DAYS, addDaysStr, isValidTime, slotLabel, slotTimes, toMinutes, windowsOverlap } from '@/lib/banquet-time'
import crypto from 'crypto'

function genId(): string {
  return 'bnq_' + crypto.randomBytes(12).toString('hex')
}

/** Error whose message is safe to show to the user (returned as HTTP 400) */
export class BanquetError extends Error {}

/**
 * Next sequence number for a `PREFIX-0001` style number. Uses the highest existing number,
 * not the row count, so deleting a record never makes the next number collide.
 */
async function nextNumber(table: 'BanquetBooking' | 'BanquetBill', column: 'bookingNumber' | 'billNumber', prefix: string, start: number) {
  const rows = await prisma.$queryRawUnsafe<{ n: number | null }[]>(
    `SELECT MAX(CAST(SUBSTRING("${column}" FROM '([0-9]+)$') AS INTEGER))::int AS n FROM "${table}" WHERE "${column}" LIKE $1`,
    `${prefix}%`
  )
  const max = rows?.[0]?.n
  return `${prefix}${String(max ? max + 1 : start).padStart(4, '0')}`
}

const HOLDING_STATUSES = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED']

/** Validated days, slot and daily times of a booking */
function normalizeSchedule(input: { days?: unknown; slot?: unknown; startTime?: unknown; endTime?: unknown }) {
  const days = Math.floor(Number(input.days) || 1)
  if (days < 1 || days > MAX_BANQUET_DAYS) throw new BanquetError(`A booking can be for 1 to ${MAX_BANQUET_DAYS} days`)
  const slot = ['MORNING', 'EVENING', 'FULL_DAY', 'CUSTOM'].includes(String(input.slot)) ? String(input.slot) : 'EVENING'
  if (slot === 'CUSTOM') {
    if (!isValidTime(input.startTime) || !isValidTime(input.endTime)) {
      throw new BanquetError('Enter the start and end time for custom hours')
    }
    if (toMinutes(input.endTime) <= toMinutes(input.startTime)) {
      throw new BanquetError('End time must be after the start time (same day)')
    }
  }
  const { start, end } = slotTimes(slot, input.startTime as string, input.endTime as string)
  return { days, slot, startTime: start, endTime: end }
}

/** Event date (IST noon) and the last day of a booking of `days` days */
function eventDates(eventDate: string | Date, days: number) {
  const dayStr = typeof eventDate === 'string' && eventDate.length <= 10 ? eventDate : istDateStr(new Date(eventDate))
  const start = new Date(`${dayStr}T12:00:00+05:30`)
  if (isNaN(start.getTime())) throw new BanquetError('Valid event date is required')
  const end = new Date(`${addDaysStr(dayStr, days - 1)}T12:00:00+05:30`)
  return { dayStr, start, end }
}

/**
 * A hall holds one event at a time: two bookings clash when they share a day and their daily
 * time windows overlap (Morning and Evening on the same day do not clash; Full Day clashes with both).
 */
async function assertHallAvailable(opts: {
  hallId: string
  eventDate: Date
  days: number
  slot: string
  startTime: string
  endTime: string
  status: string
  excludeId?: string
}) {
  const hallRows = await prisma.$queryRawUnsafe<any[]>('SELECT "name", "status" FROM "BanquetHall" WHERE "id" = $1', opts.hallId)
  const hall = hallRows?.[0]
  if (!hall) throw new BanquetError('Selected banquet hall not found')
  if (!HOLDING_STATUSES.includes(opts.status)) return
  if (hall.status === 'MAINTENANCE') throw new BanquetError(`${hall.name} is under maintenance`)

  const firstDay = istDateStr(opts.eventDate)
  const myDays = new Set(Array.from({ length: opts.days }, (_, i) => addDaysStr(firstDay, i)))
  const lastDay = addDaysStr(firstDay, opts.days - 1)
  const others = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "id", "bookingNumber", "customerName", "eventDate", "days", "slot", "startTime", "endTime" FROM "BanquetBooking"
     WHERE "hallId" = $1 AND "status" IN ('CONFIRMED', 'IN_PROGRESS', 'COMPLETED') AND "id" <> $2
       AND "eventDate" <= $3 AND "eventDate" >= $4`,
    opts.hallId,
    opts.excludeId || '',
    new Date(`${lastDay}T23:59:59+05:30`),
    new Date(new Date(`${firstDay}T00:00:00+05:30`).getTime() - MAX_BANQUET_DAYS * 24 * 60 * 60 * 1000)
  )
  const mine = { start: opts.startTime, end: opts.endTime }
  for (const o of others) {
    const oFirst = istDateStr(new Date(o.eventDate))
    const oDays = Math.max(1, Number(o.days) || 1)
    const shared = Array.from({ length: oDays }, (_, i) => addDaysStr(oFirst, i)).find((d) => myDays.has(d))
    if (!shared) continue
    if (windowsOverlap(mine, slotTimes(o.slot, o.startTime, o.endTime))) {
      throw new BanquetError(
        `${hall.name} is already booked on ${shared} (${slotLabel(o.slot, o.startTime, o.endTime)}) for ${o.customerName} — ${o.bookingNumber}`
      )
    }
  }
}

function advancePaymentStatus(advance: number, total: number) {
  return advance >= total && total > 0 ? 'PAID' : advance > 0 ? 'PARTIAL' : 'UNPAID'
}

/** Applies a change in recorded advance (e.g. an edited/deleted ledger row) back onto the banquet booking */
export async function adjustBanquetAdvance(bookingId: string, delta: number) {
  const rows = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM "BanquetBooking" WHERE "id" = $1', bookingId)
  const b = rows?.[0]
  if (!b) return
  const advancePaid = Math.max(0, Math.round((Number(b.advancePaid) + delta) * 100) / 100)
  const billRows = await prisma.$queryRawUnsafe<any[]>('SELECT "id" FROM "BanquetBill" WHERE "banquetBookingId" = $1', bookingId)
  // Once invoiced, payment status follows the invoice; before that, the advance vs estimate
  const paymentStatus = billRows.length > 0 ? b.paymentStatus : advancePaymentStatus(advancePaid, Number(b.totalEstimated))
  await prisma.$executeRawUnsafe(
    'UPDATE "BanquetBooking" SET "advancePaid" = $2, "paymentStatus" = $3, "updatedAt" = $4 WHERE "id" = $1',
    bookingId,
    advancePaid,
    paymentStatus,
    new Date()
  )
}

export const DEFAULT_BANQUET_HALLS = [
  {
    name: 'Grand Ballroom',
    capacity: 350,
    baseRate: 35000,
    rateType: 'PER_EVENT',
    status: 'AVAILABLE',
    amenities: 'Central AC, Grand Stage, DJ Sound & Lighting, Projector & LED Wall, Bridal Suite, Buffet Dining Area',
    description: 'Our flagship pillarless ballroom designed for lavish weddings, grand receptions, and large conferences.',
  },
  {
    name: 'Royal Banquet Hall',
    capacity: 150,
    baseRate: 20000,
    rateType: 'PER_EVENT',
    status: 'AVAILABLE',
    amenities: 'Central AC, Elevated Stage, JBL Sound System, Decorative Ambient Lighting, Buffet Counter',
    description: 'Perfect for birthday celebrations, corporate seminars, engagement ceremonies, and private parties.',
  },
  {
    name: 'Sapphire Conference Hall',
    capacity: 75,
    baseRate: 12000,
    rateType: 'PER_EVENT',
    status: 'AVAILABLE',
    amenities: 'AC, HD Projector, Wireless Microphones, Podium, Conference Audio, High-Speed WiFi',
    description: 'State-of-the-art corporate meeting venue equipped with modern audio-visual infrastructure.',
  },
  {
    name: 'Crystal Lawn / Open Terrace',
    capacity: 250,
    baseRate: 25000,
    rateType: 'PER_EVENT',
    status: 'AVAILABLE',
    amenities: 'Open Air Canopy, Lawn Lighting, Stage Setup Space, Live Cooking Stations, Music System',
    description: 'A picturesque open-air venue ideal for evening celebrations, cocktail parties, and musical nights.',
  },
]

export async function ensureDefaultHalls() {
  try {
    const existing = await prisma.$queryRawUnsafe<any[]>('SELECT count(*)::int as count FROM "BanquetHall"')
    const count = existing?.[0]?.count || 0
    if (count === 0) {
      for (const h of DEFAULT_BANQUET_HALLS) {
        const id = genId()
        const now = new Date()
        await prisma.$executeRawUnsafe(
          `INSERT INTO "BanquetHall" ("id", "name", "capacity", "baseRate", "rateType", "status", "amenities", "description", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          id,
          h.name,
          h.capacity,
          h.baseRate,
          h.rateType,
          h.status,
          h.amenities,
          h.description,
          now,
          now
        )
      }
    }
  } catch (e) {
    console.error('Error ensuring default banquet halls:', e)
  }
}

// ---------------- HALLS ----------------
export async function getBanquetHalls(): Promise<BanquetHall[]> {
  await ensureDefaultHalls()
  const halls = await prisma.$queryRawUnsafe<any[]>(`
    SELECT h.*, 
      (SELECT count(*)::int FROM "BanquetBooking" b WHERE b."hallId" = h."id") as "bookingCount"
    FROM "BanquetHall" h
    ORDER BY h."baseRate" DESC
  `)

  return halls.map((h) => ({
    id: h.id,
    name: h.name,
    capacity: Number(h.capacity),
    baseRate: Number(h.baseRate),
    rateType: h.rateType,
    status: h.status,
    amenities: h.amenities,
    description: h.description,
    createdAt: h.createdAt?.toISOString?.() || h.createdAt,
    updatedAt: h.updatedAt?.toISOString?.() || h.updatedAt,
    _count: {
      bookings: Number(h.bookingCount || 0),
    },
  }))
}

export async function createBanquetHall(data: {
  name: string
  capacity?: number
  baseRate?: number
  rateType?: string
  status?: string
  amenities?: string
  description?: string
}) {
  const id = genId()
  const now = new Date()
  const name = data.name.trim()
  const capacity = Number(data.capacity) || 100
  const baseRate = Number(data.baseRate) || 0
  const rateType = data.rateType || 'PER_EVENT'
  const status = data.status || 'AVAILABLE'
  const amenities = data.amenities || null
  const description = data.description || null

  await prisma.$executeRawUnsafe(
    `INSERT INTO "BanquetHall" ("id", "name", "capacity", "baseRate", "rateType", "status", "amenities", "description", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    id,
    name,
    capacity,
    baseRate,
    rateType,
    status,
    amenities,
    description,
    now,
    now
  )

  return { id, name, capacity, baseRate, rateType, status, amenities, description }
}

export async function updateBanquetHall(id: string, data: Partial<BanquetHall>) {
  const now = new Date()
  const updates: string[] = ['"updatedAt" = $2']
  const params: any[] = [id, now]
  let pIdx = 3

  if (data.name !== undefined) {
    updates.push(`"name" = $${pIdx++}`)
    params.push(data.name.trim())
  }
  if (data.capacity !== undefined) {
    updates.push(`"capacity" = $${pIdx++}`)
    params.push(Number(data.capacity))
  }
  if (data.baseRate !== undefined) {
    updates.push(`"baseRate" = $${pIdx++}`)
    params.push(Number(data.baseRate))
  }
  if (data.rateType !== undefined) {
    updates.push(`"rateType" = $${pIdx++}`)
    params.push(data.rateType)
  }
  if (data.status !== undefined) {
    updates.push(`"status" = $${pIdx++}`)
    params.push(data.status)
  }
  if (data.amenities !== undefined) {
    updates.push(`"amenities" = $${pIdx++}`)
    params.push(data.amenities)
  }
  if (data.description !== undefined) {
    updates.push(`"description" = $${pIdx++}`)
    params.push(data.description)
  }

  await prisma.$executeRawUnsafe(
    `UPDATE "BanquetHall" SET ${updates.join(', ')} WHERE "id" = $1`,
    ...params
  )

  const rows = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM "BanquetHall" WHERE "id" = $1', id)
  return rows[0]
}

export async function deleteBanquetHall(id: string) {
  const rows = await prisma.$queryRawUnsafe<{ count: number }[]>(
    'SELECT count(*)::int as count FROM "BanquetBooking" WHERE "hallId" = $1',
    id
  )
  const count = rows?.[0]?.count || 0
  if (count > 0) {
    throw new BanquetError(`Cannot delete this hall: it has ${count} booking(s). Set it to MAINTENANCE instead.`)
  }
  return await prisma.$executeRawUnsafe('DELETE FROM "BanquetHall" WHERE "id" = $1', id)
}

// ---------------- BOOKINGS ----------------
export async function getBanquetBookings(query?: {
  from?: string
  to?: string
  status?: string
  search?: string
  hallId?: string
}): Promise<BanquetBooking[]> {
  const clauses: string[] = ['1=1']
  const params: any[] = []
  let pIdx = 1

  if (query?.hallId && query.hallId !== 'ALL') {
    clauses.push(`b."hallId" = $${pIdx++}`)
    params.push(query.hallId)
  }

  if (query?.status && query.status !== 'ALL') {
    clauses.push(`b."status" = $${pIdx++}`)
    params.push(query.status)
  }

  if (query?.from) {
    const fromD = new Date(query.from + 'T00:00:00')
    clauses.push(`b."eventDate" >= $${pIdx++}`)
    params.push(isNaN(fromD.getTime()) ? new Date(query.from) : fromD)
  }

  if (query?.to) {
    const toD = new Date(query.to + 'T23:59:59.999')
    clauses.push(`b."eventDate" <= $${pIdx++}`)
    params.push(isNaN(toD.getTime()) ? new Date(query.to) : toD)
  }

  if (query?.search) {
    const s = `%${query.search.trim()}%`
    clauses.push(
      `(b."customerName" ILIKE $${pIdx} OR b."customerPhone" ILIKE $${pIdx} OR b."eventName" ILIKE $${pIdx} OR b."bookingNumber" ILIKE $${pIdx})`
    )
    params.push(s)
    pIdx++
  }

  const sql = `
    SELECT 
      b.*,
      h."name" as "hall_name",
      h."capacity" as "hall_capacity",
      h."baseRate" as "hall_baseRate"
    FROM "BanquetBooking" b
    LEFT JOIN "BanquetHall" h ON b."hallId" = h."id"
    WHERE ${clauses.join(' AND ')}
    ORDER BY b."eventDate" DESC
  `

  const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...params)

  return rows.map((b) => ({
    id: b.id,
    bookingNumber: b.bookingNumber,
    hallId: b.hallId,
    customerName: b.customerName,
    customerPhone: b.customerPhone,
    customerEmail: b.customerEmail,
    customerAddress: b.customerAddress,
    companyName: b.companyName,
    gstNumber: b.gstNumber,
    idProof: b.idProof || null,
    eventName: b.eventName,
    eventDate: b.eventDate?.toISOString?.() || b.eventDate,
    endDate: b.endDate?.toISOString?.() || b.endDate,
    days: Math.max(1, Number(b.days) || 1),
    slot: b.slot,
    startTime: slotTimes(b.slot, b.startTime, b.endTime).start,
    endTime: slotTimes(b.slot, b.startTime, b.endTime).end,
    guestCount: Number(b.guestCount || 0),
    // Older bookings have no per-day rate: their whole rent was for one day
    hallRatePerDay: Number(b.hallRatePerDay) > 0 ? Number(b.hallRatePerDay) : Number(b.hallRent || 0) / Math.max(1, Number(b.days) || 1),
    hallRent: Number(b.hallRent || 0),
    foodRatePerPlate: Number(b.foodRatePerPlate || 0),
    foodPackageName: b.foodPackageName,
    foodTotal: Number(b.foodTotal || 0),
    decorCharges: Number(b.decorCharges || 0),
    decorEnabled: b.decorEnabled !== false,
    extraCharges: Number(b.extraCharges || 0),
    discount: Number(b.discount || 0),
    totalEstimated: Number(b.totalEstimated || 0),
    advancePaid: Number(b.advancePaid || 0),
    status: b.status,
    paymentStatus: b.paymentStatus,
    notes: b.notes,
    createdBy: b.createdBy,
    hall: b.hall_name
      ? {
          id: b.hallId,
          name: b.hall_name,
          capacity: Number(b.hall_capacity),
          baseRate: Number(b.hall_baseRate),
          rateType: 'PER_EVENT',
          status: 'AVAILABLE',
        }
      : undefined,
    createdAt: b.createdAt?.toISOString?.() || b.createdAt,
    updatedAt: b.updatedAt?.toISOString?.() || b.updatedAt,
  }))
}

export async function createBanquetBooking(
  data: {
    hallId: string
    customerName: string
    customerPhone: string
    customerEmail?: string
    customerAddress?: string
    companyName?: string
    gstNumber?: string
    idProof?: string
    eventName: string
    eventDate: string
    endDate?: string
    days?: number
    slot?: string
    startTime?: string
    endTime?: string
    guestCount?: number
    hallRatePerDay?: number
    hallRent?: number
    foodRatePerPlate?: number
    foodPackageName?: string
    foodTotal?: number
    decorCharges?: number
    decorEnabled?: boolean
    extraCharges?: number
    discount?: number
    advancePaid?: number
    advanceMethod?: string
    status?: string
    notes?: string
  },
  userName?: string
) {
  const year = new Date().getFullYear()
  const bookingNumber = await nextNumber('BanquetBooking', 'bookingNumber', `BNQ-BKG-${year}-`, 101)

  const id = genId()
  const now = new Date()

  const phoneDigits = String(data.customerPhone || '').replace(/\D/g, '')
  if (phoneDigits.length !== 10) throw new BanquetError('A valid 10-digit mobile number is required for the host')
  if (!String(data.customerName || '').trim()) throw new BanquetError('Customer / host name is required')
  const schedule = normalizeSchedule(data)
  const { start: eventDateObj, end: endDateObj } = eventDates(data.eventDate, schedule.days)
  const guestCount = Number(data.guestCount) || 100
  // Hall rent is per day; older callers send only the total
  const hallRatePerDay =
    data.hallRatePerDay !== undefined ? Math.max(0, Number(data.hallRatePerDay) || 0) : Math.max(0, Number(data.hallRent) || 0) / schedule.days
  const hallRent = Math.round(hallRatePerDay * schedule.days * 100) / 100
  const foodRatePerPlate = Number(data.foodRatePerPlate) || 0
  // Catering: plates for every guest on every day of the booking
  const foodTotal = foodRatePerPlate > 0 ? Math.round(foodRatePerPlate * guestCount * schedule.days * 100) / 100 : 0
  // The "Decor, AV Services & Discounts" section can be switched off for an event;
  // then decor, sound/AV extras and the discount all carry nothing
  const decorEnabled = data.decorEnabled !== false
  const decorCharges = decorEnabled ? Number(data.decorCharges) || 0 : 0
  const extraCharges = decorEnabled ? Number(data.extraCharges) || 0 : 0
  const discount = decorEnabled ? Number(data.discount) || 0 : 0
  const advancePaid = Number(data.advancePaid) || 0

  const subtotal = Math.max(0, hallRent + foodTotal + decorCharges + extraCharges - discount)
  const totalEstimated = subtotal
  const paymentStatus =
    advancePaid >= totalEstimated && totalEstimated > 0 ? 'PAID' : advancePaid > 0 ? 'PARTIAL' : 'UNPAID'

  // Only an enquiry can be created without holding the hall; anything else is a confirmed booking
  const status = data.status === 'ENQUIRY' ? 'ENQUIRY' : 'CONFIRMED'
  await assertHallAvailable({ hallId: data.hallId, eventDate: eventDateObj, ...schedule, status })

  await prisma.$executeRawUnsafe(
    `INSERT INTO "BanquetBooking" (
      "id", "bookingNumber", "hallId", "customerName", "customerPhone", "customerEmail", "customerAddress",
      "companyName", "gstNumber", "eventName", "eventDate", "endDate", "slot", "guestCount",
      "hallRent", "foodRatePerPlate", "foodPackageName", "foodTotal", "decorCharges", "extraCharges",
      "discount", "totalEstimated", "advancePaid", "status", "paymentStatus", "notes", "createdBy",
      "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
    )`,
    id,
    bookingNumber,
    data.hallId,
    data.customerName.trim(),
    phoneDigits,
    data.customerEmail || null,
    data.customerAddress || null,
    data.companyName || null,
    data.gstNumber || null,
    data.eventName.trim(),
    eventDateObj,
    endDateObj,
    schedule.slot,
    guestCount,
    hallRent,
    foodRatePerPlate,
    data.foodPackageName || null,
    foodTotal,
    decorCharges,
    extraCharges,
    discount,
    totalEstimated,
    advancePaid,
    status,
    paymentStatus,
    data.notes || null,
    userName || null,
    now,
    now
  )

  // Record ledger entry for advance if paid
  if (advancePaid > 0) {
    try {
      await prisma.ledgerEntry.create({
        data: {
          type: 'INCOME',
          category: 'ADVANCE',
          description: `Banquet Advance - ${data.eventName} (${bookingNumber}) for ${data.customerName}`,
          amount: advancePaid,
          method: data.advanceMethod || 'CASH',
          source: 'AUTO',
          refId: id,
        },
      })
    } catch (e) {
      console.error('Failed to log ledger entry for banquet advance:', e)
    }
  }

  await prisma.$executeRawUnsafe(
    'UPDATE "BanquetBooking" SET "decorEnabled" = $2, "days" = $3, "startTime" = $4, "endTime" = $5, "hallRatePerDay" = $6, "idProof" = $7 WHERE "id" = $1',
    id,
    decorEnabled,
    schedule.days,
    schedule.startTime,
    schedule.endTime,
    hallRatePerDay,
    data.idProof ? String(data.idProof).trim() : null
  )

  const created = await getBanquetBookings({ search: bookingNumber })
  return created[0] || { id, bookingNumber, customerName: data.customerName, totalEstimated, advancePaid }
}

export async function updateBanquetBooking(
  id: string,
  data: Partial<BanquetBooking> & { advanceAddition?: number; advanceMethod?: string },
  userName?: string
) {
  const existingRows = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM "BanquetBooking" WHERE "id" = $1', id)
  const existing = existingRows?.[0]
  if (!existing) throw new BanquetError('Banquet booking not found')

  const nextHallId = data.hallId || existing.hallId
  const nextSlot = data.slot || existing.slot
  const schedule = normalizeSchedule({
    days: data.days ?? existing.days,
    slot: nextSlot,
    // A slot change without new times keeps custom hours only when still custom
    startTime: data.startTime ?? existing.startTime,
    endTime: data.endTime ?? existing.endTime,
  })
  const { start: nextEventDate, end: nextEndDate } = eventDates(
    data.eventDate ? String(data.eventDate) : new Date(existing.eventDate),
    schedule.days
  )
  const nextStatus = data.status || existing.status
  await assertHallAvailable({ hallId: nextHallId, eventDate: nextEventDate, ...schedule, status: nextStatus, excludeId: id })

  // An edited advance (absolute advancePaid) is money in/out too: record the difference in the ledger
  let advanceAddition = Number(data.advanceAddition) || 0
  if (data.advancePaid !== undefined && !advanceAddition) {
    advanceAddition = Math.round((Number(data.advancePaid) - Number(existing.advancePaid)) * 100) / 100
  }
  if (Math.abs(advanceAddition) > 0.001) {
    const invoiced = await prisma.$queryRawUnsafe<{ billNumber: string }[]>('SELECT "billNumber" FROM "BanquetBill" WHERE "banquetBookingId" = $1', id)
    if (invoiced.length > 0) {
      throw new BanquetError(`This booking is invoiced (${invoiced[0].billNumber}). Record payments on the invoice instead.`)
    }
  }
  const newAdvance = Math.max(0, Number(existing.advancePaid) + advanceAddition)

  const oldDays = Math.max(1, Number(existing.days) || 1)
  const existingRate = Number(existing.hallRatePerDay) > 0 ? Number(existing.hallRatePerDay) : Number(existing.hallRent) / oldDays
  const hallRatePerDay =
    data.hallRatePerDay !== undefined
      ? Math.max(0, Number(data.hallRatePerDay) || 0)
      : data.hallRent !== undefined
        ? Math.max(0, Number(data.hallRent) || 0) / schedule.days
        : existingRate
  const hallRent = Math.round(hallRatePerDay * schedule.days * 100) / 100
  const guestCount = data.guestCount !== undefined ? Number(data.guestCount) : Number(existing.guestCount)
  const foodRate = data.foodRatePerPlate !== undefined ? Number(data.foodRatePerPlate) || 0 : Number(existing.foodRatePerPlate) || 0
  // Catering follows the rate x guests x days whenever any of them is known; old bookings without a
  // rate keep their stored food total
  const foodTotal =
    foodRate > 0
      ? Math.round(foodRate * guestCount * schedule.days * 100) / 100
      : data.foodRatePerPlate !== undefined
        ? 0
        : data.foodTotal !== undefined
          ? Number(data.foodTotal)
          : Number(existing.foodTotal)
  const decorEnabled =
    (data as { decorEnabled?: boolean }).decorEnabled !== undefined
      ? (data as { decorEnabled?: boolean }).decorEnabled !== false
      : existing.decorEnabled !== false
  const decorCharges = !decorEnabled
    ? 0
    : data.decorCharges !== undefined
      ? Number(data.decorCharges)
      : Number(existing.decorCharges)
  const extraCharges = !decorEnabled
    ? 0
    : data.extraCharges !== undefined
      ? Number(data.extraCharges)
      : Number(existing.extraCharges)
  const discount = !decorEnabled ? 0 : data.discount !== undefined ? Number(data.discount) : Number(existing.discount)

  const totalEstimated = Math.max(0, hallRent + foodTotal + decorCharges + extraCharges - discount)
  const currentAdvance = newAdvance
  const billRows = await prisma.$queryRawUnsafe<any[]>('SELECT "id" FROM "BanquetBill" WHERE "banquetBookingId" = $1', id)
  // Once invoiced, the booking's payment status is driven by the invoice payments
  const paymentStatus = billRows.length > 0 ? existing.paymentStatus : advancePaymentStatus(currentAdvance, totalEstimated)

  const now = new Date()
  const updates: string[] = [
    `"updatedAt" = $2`,
    `"totalEstimated" = $3`,
    `"advancePaid" = $4`,
    `"paymentStatus" = $5`,
  ]
  const params: any[] = [id, now, totalEstimated, currentAdvance, paymentStatus]
  let pIdx = 6

  if (data.customerName) {
    updates.push(`"customerName" = $${pIdx++}`)
    params.push(data.customerName.trim())
  }
  if (data.customerPhone !== undefined) {
    const digits = String(data.customerPhone).replace(/\D/g, '')
    if (digits.length !== 10) throw new BanquetError('A valid 10-digit mobile number is required for the host')
    updates.push(`"customerPhone" = $${pIdx++}`)
    params.push(digits)
  }
  if (data.customerEmail !== undefined) {
    updates.push(`"customerEmail" = $${pIdx++}`)
    params.push(data.customerEmail)
  }
  if (data.customerAddress !== undefined) {
    updates.push(`"customerAddress" = $${pIdx++}`)
    params.push(data.customerAddress)
  }
  if (data.companyName !== undefined) {
    updates.push(`"companyName" = $${pIdx++}`)
    params.push(data.companyName)
  }
  if (data.gstNumber !== undefined) {
    updates.push(`"gstNumber" = $${pIdx++}`)
    params.push(data.gstNumber)
  }
  if (data.eventName) {
    updates.push(`"eventName" = $${pIdx++}`)
    params.push(data.eventName.trim())
  }
  updates.push(`"eventDate" = $${pIdx++}`)
  params.push(nextEventDate)
  updates.push(`"endDate" = $${pIdx++}`)
  params.push(nextEndDate)
  updates.push(`"days" = $${pIdx++}`)
  params.push(schedule.days)
  updates.push(`"slot" = $${pIdx++}`)
  params.push(schedule.slot)
  updates.push(`"startTime" = $${pIdx++}`)
  params.push(schedule.startTime)
  updates.push(`"endTime" = $${pIdx++}`)
  params.push(schedule.endTime)
  updates.push(`"hallRatePerDay" = $${pIdx++}`)
  params.push(hallRatePerDay)
  if ((data as { idProof?: string }).idProof !== undefined) {
    updates.push(`"idProof" = $${pIdx++}`)
    params.push((data as { idProof?: string }).idProof || null)
  }
  if (data.hallId) {
    updates.push(`"hallId" = $${pIdx++}`)
    params.push(data.hallId)
  }
  if (data.guestCount !== undefined) {
    updates.push(`"guestCount" = $${pIdx++}`)
    params.push(guestCount)
  }
  updates.push(`"hallRent" = $${pIdx++}`)
  params.push(hallRent)
  if (data.foodRatePerPlate !== undefined) {
    updates.push(`"foodRatePerPlate" = $${pIdx++}`)
    params.push(foodRate)
  }
  if (data.foodPackageName !== undefined) {
    updates.push(`"foodPackageName" = $${pIdx++}`)
    params.push(data.foodPackageName)
  }
  updates.push(`"foodTotal" = $${pIdx++}`)
  params.push(foodTotal)
  if (data.decorCharges !== undefined || !decorEnabled) {
    updates.push(`"decorCharges" = $${pIdx++}`)
    params.push(decorCharges)
  }
  updates.push(`"decorEnabled" = $${pIdx++}`)
  params.push(decorEnabled)
  if (data.extraCharges !== undefined || !decorEnabled) {
    updates.push(`"extraCharges" = $${pIdx++}`)
    params.push(extraCharges)
  }
  if (data.discount !== undefined || !decorEnabled) {
    updates.push(`"discount" = $${pIdx++}`)
    params.push(discount)
  }
  if (data.status) {
    updates.push(`"status" = $${pIdx++}`)
    params.push(data.status)
  }
  if (data.notes !== undefined) {
    updates.push(`"notes" = $${pIdx++}`)
    params.push(data.notes)
  }

  await prisma.$executeRawUnsafe(
    `UPDATE "BanquetBooking" SET ${updates.join(', ')} WHERE "id" = $1`,
    ...params
  )

  if (advanceAddition > 0) {
    await prisma.ledgerEntry.create({
      data: {
        type: 'INCOME',
        category: 'ADVANCE',
        description: `Additional Banquet Advance - ${existing.eventName} (${existing.bookingNumber})`,
        amount: advanceAddition,
        method: data.advanceMethod || 'CASH',
        source: 'AUTO',
        refId: id,
      },
    })
  } else if (advanceAddition < 0) {
    // Advance reduced (refund / correction): take it back off the most recent advance rows
    let toRemove = -advanceAddition
    const rows = await prisma.ledgerEntry.findMany({
      where: { refId: id, category: 'ADVANCE' },
      orderBy: { date: 'desc' },
    })
    for (const row of rows) {
      if (toRemove <= 0.001) break
      if (row.amount <= toRemove + 0.001) {
        await prisma.ledgerEntry.delete({ where: { id: row.id } })
        toRemove -= row.amount
      } else {
        await prisma.ledgerEntry.update({ where: { id: row.id }, data: { amount: Math.round((row.amount - toRemove) * 100) / 100 } })
        toRemove = 0
      }
    }
  }

  const updatedRows = await getBanquetBookings({ search: existing.bookingNumber })
  return updatedRows[0]
}

export interface CancelBanquetBookingInput {
  id: string
  reason?: string
  refundAmount?: number
  refundMethod?: string
  refundNote?: string
}

export async function cancelBanquetBooking(input: CancelBanquetBookingInput, userName?: string) {
  const { id, reason, refundAmount, refundMethod, refundNote } = input
  const existingRows = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM "BanquetBooking" WHERE "id" = $1', id)
  const existing = existingRows?.[0]
  if (!existing) throw new BanquetError('Banquet booking not found')

  if (existing.status === 'CANCELLED') {
    throw new BanquetError('This banquet booking is already cancelled')
  }

  const billRows = await prisma.$queryRawUnsafe<any[]>('SELECT "id", "billNumber" FROM "BanquetBill" WHERE "banquetBookingId" = $1', id)
  if (billRows.length > 0) {
    throw new BanquetError(`Cannot cancel an invoiced banquet booking (${billRows[0].billNumber}). Delete the invoice first.`)
  }

  const cancelDate = new Date()
  const reasonStr = reason ? reason.trim() : 'Cancelled by customer/staff'
  const cancelTimestamp = cancelDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
  const refundAmt = refundAmount !== undefined && refundAmount !== null ? Number(refundAmount) : 0
  const refundMethodStr = refundMethod || 'CASH'
  const refundNoteStr = refundNote ? refundNote.trim() : ''

  const cancelLog = `[CANCELLED on ${cancelTimestamp} by ${userName || 'Staff'} | Reason: ${reasonStr}${refundAmt > 0 ? ` | Refund: ₹${refundAmt} via ${refundMethodStr}` : ''}${refundNoteStr ? ` | Note: ${refundNoteStr}` : ''}${Number(existing.advancePaid) > 0 ? ` | Orig Advance: ₹${existing.advancePaid}` : ''}]`
  const updatedNotes = existing.notes ? `${existing.notes}\n${cancelLog}` : cancelLog

  const now = new Date()
  await prisma.$executeRawUnsafe(
    'UPDATE "BanquetBooking" SET "status" = $2, "notes" = $3, "updatedAt" = $4 WHERE "id" = $1',
    id,
    'CANCELLED',
    updatedNotes,
    now
  )

  // Record advance refund in financial ledger if money was refunded
  if (refundAmt > 0) {
    await prisma.ledgerEntry.create({
      data: {
        type: 'EXPENSE',
        category: 'REFUND',
        description: `Banquet Advance Refund - ${existing.eventName} (${existing.bookingNumber}) to ${existing.customerName}${refundNoteStr ? ` [${refundNoteStr}]` : ''}`,
        amount: refundAmt,
        method: refundMethodStr,
        source: 'AUTO',
        refId: id,
      },
    })
  }

  const updatedRows = await getBanquetBookings({ search: existing.bookingNumber })
  return updatedRows[0]
}

export async function deleteBanquetBooking(id: string) {
  // Invoices cascade with the booking in the DB; their ledger rows and the advance must go too
  const billRows = await prisma.$queryRawUnsafe<{ id: string }[]>('SELECT "id" FROM "BanquetBill" WHERE "banquetBookingId" = $1', id)
  await prisma.ledgerEntry.deleteMany({ where: { refId: { in: [id, ...billRows.map((b) => b.id)] } } })
  return await prisma.$executeRawUnsafe('DELETE FROM "BanquetBooking" WHERE "id" = $1', id)
}

// ---------------- BILLS & INVOICES ----------------
export async function getBanquetBills(query?: {
  from?: string
  to?: string
  search?: string
}): Promise<BanquetBill[]> {
  const clauses: string[] = ['1=1']
  const params: any[] = []
  let pIdx = 1

  if (query?.from) {
    const fromD = new Date(query.from + 'T00:00:00')
    clauses.push(`b."createdAt" >= $${pIdx++}`)
    params.push(isNaN(fromD.getTime()) ? new Date(query.from) : fromD)
  }

  if (query?.to) {
    const toD = new Date(query.to + 'T23:59:59.999')
    clauses.push(`b."createdAt" <= $${pIdx++}`)
    params.push(isNaN(toD.getTime()) ? new Date(query.to) : toD)
  }

  if (query?.search) {
    const s = `%${query.search.trim()}%`
    clauses.push(
      `(b."billNumber" ILIKE $${pIdx} OR b."customerName" ILIKE $${pIdx} OR b."customerPhone" ILIKE $${pIdx} OR b."eventName" ILIKE $${pIdx} OR b."hallName" ILIKE $${pIdx})`
    )
    params.push(s)
    pIdx++
  }

  const sql = `
    SELECT b.*
    FROM "BanquetBill" b
    WHERE ${clauses.join(' AND ')}
    ORDER BY b."createdAt" DESC
  `

  const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...params)

  return rows.map((b) => ({
    id: b.id,
    billNumber: b.billNumber,
    banquetBookingId: b.banquetBookingId,
    eventDate: b.eventDate?.toISOString?.() || b.eventDate,
    customerName: b.customerName,
    customerPhone: b.customerPhone,
    customerAddress: b.customerAddress,
    companyName: b.companyName,
    gstNumber: b.gstNumber,
    eventName: b.eventName,
    hallName: b.hallName,
    slot: b.slot,
    guestCount: Number(b.guestCount || 0),
    hallRent: Number(b.hallRent || 0),
    foodCharges: Number(b.foodCharges || 0),
    decorCharges: Number(b.decorCharges || 0),
    soundAvCharges: Number(b.soundAvCharges || 0),
    extraCharges: Number(b.extraCharges || 0),
    discount: Number(b.discount || 0),
    taxableAmount: Number(b.taxableAmount || 0),
    gstPercent: Number(b.gstPercent || 0),
    cgstPercent: Number(b.cgstPercent || 0),
    sgstPercent: Number(b.sgstPercent || 0),
    gstAmount: Number(b.gstAmount || 0),
    grandTotal: Number(b.grandTotal || 0),
    advanceApplied: Number(b.advanceApplied || 0),
    payCash: Number(b.payCash || 0),
    payUpi: Number(b.payUpi || 0),
    payCard: Number(b.payCard || 0),
    payBank: Number(b.payBank || 0),
    paymentStatus: b.paymentStatus,
    status: b.status,
    notes: b.notes,
    terms: b.terms,
    createdBy: b.createdBy,
    approvedBy: b.approvedBy,
    createdAt: b.createdAt?.toISOString?.() || b.createdAt,
    updatedAt: b.updatedAt?.toISOString?.() || b.updatedAt,
  }))
}

export async function createBanquetBill(
  data: {
    banquetBookingId: string
    hallRent?: number
    foodCharges?: number
    decorCharges?: number
    soundAvCharges?: number
    extraCharges?: number
    discount?: number
    gstPercent?: number
    cgstPercent?: number
    sgstPercent?: number
    advanceApplied?: number
    payCash?: number
    payUpi?: number
    payCard?: number
    payBank?: number
    notes?: string
    terms?: string
  },
  userName?: string,
  managerName?: string
) {
  const bkgRows = await prisma.$queryRawUnsafe<any[]>(`
    SELECT b.*, h."name" as "hall_name" 
    FROM "BanquetBooking" b 
    LEFT JOIN "BanquetHall" h ON b."hallId" = h."id" 
    WHERE b."id" = $1
  `, data.banquetBookingId)

  const booking = bkgRows?.[0]
  if (!booking) throw new BanquetError('Banquet booking not found')
  if (booking.status === 'CANCELLED') throw new BanquetError('Cannot invoice a cancelled banquet booking')
  const existingBills = await prisma.$queryRawUnsafe<{ billNumber: string }[]>(
    'SELECT "billNumber" FROM "BanquetBill" WHERE "banquetBookingId" = $1',
    booking.id
  )
  if (existingBills.length > 0) {
    throw new BanquetError(`This booking is already invoiced (${existingBills[0].billNumber}). Record payments on that invoice instead.`)
  }

  const year = new Date().getFullYear()

  const id = genId()
  const now = new Date()

  const hallRent = data.hallRent !== undefined ? Number(data.hallRent) : Number(booking.hallRent)
  const foodCharges = data.foodCharges !== undefined ? Number(data.foodCharges) : Number(booking.foodTotal)
  // Decor, AV services and discount switched off on the booking = none of them on the invoice
  const sectionOn = booking.decorEnabled !== false
  const decorCharges = !sectionOn ? 0 : data.decorCharges !== undefined ? Number(data.decorCharges) : Number(booking.decorCharges)
  const soundAvCharges = sectionOn ? Number(data.soundAvCharges) || 0 : 0
  const extraCharges = !sectionOn ? 0 : data.extraCharges !== undefined ? Number(data.extraCharges) : Number(booking.extraCharges)
  const discount = !sectionOn ? 0 : data.discount !== undefined ? Number(data.discount) : Number(booking.discount)

  const taxableAmount = Math.max(0, hallRent + foodCharges + decorCharges + soundAvCharges + extraCharges - discount)
  // GST as CGST + SGST, each 0% or 2.5% (legacy combined gstPercent 0/5 is split in halves)
  let cgstPercent = 2.5
  let sgstPercent = 2.5
  if (data.cgstPercent !== undefined || data.sgstPercent !== undefined) {
    if (!isValidHalfRate(data.cgstPercent ?? 0) || !isValidHalfRate(data.sgstPercent ?? 0)) {
      throw new BanquetError('CGST and SGST can each only be 0% or 2.5%')
    }
    cgstPercent = Number(data.cgstPercent ?? 0)
    sgstPercent = Number(data.sgstPercent ?? 0)
  } else if (data.gstPercent !== undefined) {
    if (Number(data.gstPercent) === 0) cgstPercent = sgstPercent = 0
    else if (Number(data.gstPercent) !== 5) throw new BanquetError('GST is CGST 2.5% + SGST 2.5% (or 0%)')
  }
  const gstPercent = cgstPercent + sgstPercent
  const gstAmount = computeGst(taxableAmount, cgstPercent, sgstPercent).total
  const grandTotal = Math.round((taxableAmount + gstAmount) * 100) / 100

  // GST invoices and estimates (no GST) have separate number series
  const billNumber = await nextNumber('BanquetBill', 'billNumber', gstAmount > 0 ? `BNQ-${year}-` : `BNQ-EST-${year}-`, 1)
  // The whole advance already received counts towards the invoice (never less); any excess is a refund due
  const advanceApplied = Math.min(Number(booking.advancePaid) || 0, grandTotal)
  const payCash = Number(data.payCash) || 0
  const payUpi = Number(data.payUpi) || 0
  const payCard = Number(data.payCard) || 0
  const payBank = Number(data.payBank) || 0

  const totalPaid = advanceApplied + payCash + payUpi + payCard + payBank
  if (totalPaid > grandTotal + 0.01) {
    throw new BanquetError(`Payments (₹${totalPaid}) exceed the invoice total (₹${grandTotal})`)
  }
  const balanceDue = Math.max(0, Math.round((grandTotal - totalPaid) * 100) / 100)
  const paymentStatus = balanceDue <= 0.01 ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID'

  const terms =
    data.terms ||
    '1. 100% payment required upon conclusion of the event.\n2. Incase of any property or sound equipment damage, assessment charges will apply.\n3. Outside catering and liquor permitted only with prior approval.'

  await prisma.$executeRawUnsafe(
    `INSERT INTO "BanquetBill" (
      "id", "billNumber", "banquetBookingId", "eventDate", "customerName", "customerPhone", "customerAddress",
      "companyName", "gstNumber", "eventName", "hallName", "slot", "guestCount", "hallRent", "foodCharges",
      "decorCharges", "soundAvCharges", "extraCharges", "discount", "taxableAmount", "gstPercent", "gstAmount",
      "grandTotal", "advanceApplied", "payCash", "payUpi", "payCard", "payBank", "paymentStatus", "status",
      "notes", "terms", "createdBy", "approvedBy", "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36
    )`,
    id,
    billNumber,
    booking.id,
    booking.eventDate,
    booking.customerName,
    booking.customerPhone,
    booking.customerAddress || null,
    booking.companyName || null,
    booking.gstNumber || null,
    booking.eventName,
    booking.hall_name || 'Banquet Hall',
    // Printed on the invoice, e.g. "2 days · Custom · 10:00 AM – 4:00 PM"
    `${Number(booking.days) > 1 ? `${booking.days} days · ` : ''}${slotLabel(booking.slot, booking.startTime, booking.endTime)}`,
    Number(booking.guestCount || 100),
    hallRent,
    foodCharges,
    decorCharges,
    soundAvCharges,
    extraCharges,
    discount,
    taxableAmount,
    gstPercent,
    gstAmount,
    grandTotal,
    advanceApplied,
    payCash,
    payUpi,
    payCard,
    payBank,
    paymentStatus,
    'FINAL',
    data.notes || booking.notes || null,
    terms,
    userName || null,
    managerName || null,
    now,
    now
  )

  await prisma.$executeRawUnsafe(
    'UPDATE "BanquetBill" SET "cgstPercent" = $2, "sgstPercent" = $3 WHERE "id" = $1',
    id,
    cgstPercent,
    sgstPercent
  )

  // Update booking status to completed
  await prisma.$executeRawUnsafe(
    `UPDATE "BanquetBooking" SET "status" = 'COMPLETED', "paymentStatus" = $2 WHERE "id" = $1`,
    booking.id,
    paymentStatus
  )

  // Log ledger entries for payments made at checkout
  const payments = [
    { method: 'CASH', amount: payCash },
    { method: 'UPI', amount: payUpi },
    { method: 'CARD', amount: payCard },
    { method: 'BANK', amount: payBank },
  ]

  for (const p of payments) {
    if (p.amount > 0) {
      try {
        await prisma.ledgerEntry.create({
          data: {
            type: 'INCOME',
            category: 'BANQUET',
            description: `Banquet Invoice ${billNumber} settlement (${p.method}) - ${booking.customerName}`,
            amount: p.amount,
            method: p.method,
            source: 'AUTO',
            refId: id,
          },
        })
      } catch (e) {
        console.error('Ledger error on banquet bill settlement:', e)
      }
    }
  }

  const createdBills = await getBanquetBills({ search: billNumber })
  return createdBills[0] || { id, billNumber, customerName: booking.customerName, grandTotal, paymentStatus }
}

export async function addBanquetBillPayment(
  billId: string,
  payment: { payCash?: number; payUpi?: number; payCard?: number; payBank?: number },
  userName?: string
) {
  const billRows = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM "BanquetBill" WHERE "id" = $1', billId)
  const bill = billRows?.[0]
  if (!bill) throw new BanquetError('Banquet bill not found')

  const addCash = Number(payment.payCash) || 0
  const addUpi = Number(payment.payUpi) || 0
  const addCard = Number(payment.payCard) || 0
  const addBank = Number(payment.payBank) || 0

  const payCash = Number(bill.payCash) + addCash
  const payUpi = Number(bill.payUpi) + addUpi
  const payCard = Number(bill.payCard) + addCard
  const payBank = Number(bill.payBank) + addBank

  const totalPaid = Number(bill.advanceApplied) + payCash + payUpi + payCard + payBank
  if (addCash + addUpi + addCard + addBank <= 0) throw new BanquetError('Payment amount required')
  if (totalPaid > Number(bill.grandTotal) + 0.01) {
    const outstanding = Number(bill.grandTotal) - (totalPaid - addCash - addUpi - addCard - addBank)
    throw new BanquetError(`Payment exceeds outstanding balance (₹${Math.max(0, outstanding).toFixed(2)})`)
  }
  const balanceDue = Math.max(0, Math.round((Number(bill.grandTotal) - totalPaid) * 100) / 100)
  const paymentStatus = balanceDue <= 0.01 ? 'PAID' : 'PARTIAL'

  const now = new Date()
  await prisma.$executeRawUnsafe(
    `UPDATE "BanquetBill" 
     SET "payCash" = $2, "payUpi" = $3, "payCard" = $4, "payBank" = $5, "paymentStatus" = $6, "updatedAt" = $7 
     WHERE "id" = $1`,
    billId,
    payCash,
    payUpi,
    payCard,
    payBank,
    paymentStatus,
    now
  )

  // Update associated booking
  await prisma.$executeRawUnsafe(
    `UPDATE "BanquetBooking" SET "paymentStatus" = $2 WHERE "id" = $1`,
    bill.banquetBookingId,
    paymentStatus
  )

  const newPayments = [
    { method: 'CASH', amount: addCash },
    { method: 'UPI', amount: addUpi },
    { method: 'CARD', amount: addCard },
    { method: 'BANK', amount: addBank },
  ]
  for (const p of newPayments) {
    if (p.amount > 0) {
      try {
        await prisma.ledgerEntry.create({
          data: {
            type: 'INCOME',
            category: 'BANQUET',
            description: `Banquet Bill Payment (${bill.billNumber}) - ${p.method}`,
            amount: p.amount,
            method: p.method,
            source: 'AUTO',
            refId: billId,
          },
        })
      } catch (e) {
        console.error('Ledger entry error:', e)
      }
    }
  }

  const updatedBills = await getBanquetBills({ search: bill.billNumber })
  return updatedBills[0]
}

export async function deleteBanquetBill(id: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM "BanquetBill" WHERE "id" = $1', id)
  const bill = rows?.[0]
  if (!bill) throw new BanquetError('Banquet bill not found')
  await prisma.ledgerEntry.deleteMany({ where: { refId: id } })
  await prisma.$executeRawUnsafe('DELETE FROM "BanquetBill" WHERE "id" = $1', id)
  // The booking is no longer invoiced: reopen it and fall back to advance-based payment status
  const bRows = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM "BanquetBooking" WHERE "id" = $1', bill.banquetBookingId)
  const booking = bRows?.[0]
  if (booking) {
    await prisma.$executeRawUnsafe(
      `UPDATE "BanquetBooking" SET "status" = CASE WHEN "status" = 'COMPLETED' THEN 'CONFIRMED' ELSE "status" END,
       "paymentStatus" = $2, "updatedAt" = $3 WHERE "id" = $1`,
      booking.id,
      advancePaymentStatus(Number(booking.advancePaid), Number(booking.totalEstimated)),
      new Date()
    )
  }
}

// ---------------- STATS ----------------
export async function getBanquetStats(): Promise<BanquetStats> {
  await ensureDefaultHalls()

  const today = new Date()
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0)
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999)

  const [hallsRows, bkgCountRows, upCountRows, todayBkgRows, allBillsRows, todayBillsRows] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>('SELECT count(*)::int as count FROM "BanquetHall"'),
    prisma.$queryRawUnsafe<any[]>('SELECT count(*)::int as count FROM "BanquetBooking"'),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT count(*)::int as count FROM "BanquetBooking" WHERE "eventDate" >= $1 AND "status" IN ('CONFIRMED', 'IN_PROGRESS')`,
      todayStart
    ),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "BanquetBooking" WHERE "eventDate" >= $1 AND "eventDate" <= $2`,
      todayStart,
      todayEnd
    ),
    prisma.$queryRawUnsafe<any[]>('SELECT * FROM "BanquetBill"'),
    prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "BanquetBill" WHERE "createdAt" >= $1 AND "createdAt" <= $2`,
      todayStart,
      todayEnd
    ),
  ])

  const hallsCount = hallsRows?.[0]?.count || 0
  const totalBookingsCount = bkgCountRows?.[0]?.count || 0
  const upcomingCount = upCountRows?.[0]?.count || 0
  const todayBookings = todayBkgRows || []
  const allBills = allBillsRows || []
  const todayBills = todayBillsRows || []

  const totalBilledRevenue = allBills.reduce((s: number, b: any) => s + (Number(b.grandTotal) || 0), 0)
  const totalCollected = allBills.reduce(
    (s: number, b: any) =>
      s +
      (Number(b.advanceApplied) || 0) +
      (Number(b.payCash) || 0) +
      (Number(b.payUpi) || 0) +
      (Number(b.payCard) || 0) +
      (Number(b.payBank) || 0),
    0
  )
  const invoiceOutstanding = Math.round(
    allBills.reduce((s: number, b: any) => {
      const paid = (Number(b.advanceApplied) || 0) + (Number(b.payCash) || 0) + (Number(b.payUpi) || 0) + (Number(b.payCard) || 0) + (Number(b.payBank) || 0)
      return s + Math.max(0, (Number(b.grandTotal) || 0) - paid)
    }, 0) * 100
  ) / 100
  // Confirmed bookings not invoiced yet: estimate less advance received
  const openRows = await prisma.$queryRawUnsafe<{ due: number | null }[]>(
    `SELECT SUM(GREATEST(b."totalEstimated" - b."advancePaid", 0))::float AS due FROM "BanquetBooking" b
     WHERE b."status" IN ('CONFIRMED', 'IN_PROGRESS') AND NOT EXISTS (SELECT 1 FROM "BanquetBill" x WHERE x."banquetBookingId" = b."id")`
  )
  const bookingsOutstanding = Math.round((Number(openRows?.[0]?.due) || 0) * 100) / 100
  const totalOutstanding = Math.round((invoiceOutstanding + bookingsOutstanding) * 100) / 100

  const todayRevenue = todayBills.reduce((s: number, b: any) => s + (Number(b.grandTotal) || 0), 0)
  const todayCash = todayBills.reduce((s: number, b: any) => s + (Number(b.payCash) || 0), 0)
  const todayUpi = todayBills.reduce((s: number, b: any) => s + (Number(b.payUpi) || 0), 0)
  const todayCard = todayBills.reduce((s: number, b: any) => s + (Number(b.payCard) || 0), 0)
  const todayBank = todayBills.reduce((s: number, b: any) => s + (Number(b.payBank) || 0), 0)

  return {
    totalHalls: hallsCount,
    totalBookings: totalBookingsCount,
    upcomingBookings: upcomingCount,
    todayEvents: todayBookings.length,
    todayRevenue,
    totalBilledRevenue,
    totalCollected,
    totalOutstanding,
    invoiceOutstanding,
    bookingsOutstanding,
    todayCash,
    todayUpi,
    todayCard,
    todayBank,
  }
}

// ---------------- PART PAYMENTS, PAYMENT HISTORY, INVOICE EDIT ----------------

/**
 * Money received for a banquet booking at any time. Before the invoice it is added to the advance
 * (cannot exceed the estimate); after the invoice it is a payment on that invoice (cannot exceed its balance).
 */
export async function recordBanquetPayment(
  bookingId: string,
  payment: { amount?: number; method?: string; note?: string },
  userName?: string
) {
  const amount = Math.round((Number(payment.amount) || 0) * 100) / 100
  if (amount <= 0) throw new BanquetError('Enter the amount received')
  const method = ['CASH', 'UPI', 'CARD', 'BANK'].includes(String(payment.method)) ? String(payment.method) : 'CASH'
  const rows = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM "BanquetBooking" WHERE "id" = $1', bookingId)
  const booking = rows?.[0]
  if (!booking) throw new BanquetError('Banquet booking not found')
  if (booking.status === 'CANCELLED') throw new BanquetError('This booking is cancelled')

  const bills = await prisma.$queryRawUnsafe<{ id: string }[]>('SELECT "id" FROM "BanquetBill" WHERE "banquetBookingId" = $1', bookingId)
  if (bills.length > 0) {
    const key = method === 'CASH' ? 'payCash' : method === 'UPI' ? 'payUpi' : method === 'CARD' ? 'payCard' : 'payBank'
    const bill = await addBanquetBillPayment(bills[0].id, { [key]: amount }, userName)
    return { stage: 'INVOICE' as const, bill, booking }
  }

  const balance = Math.round((Number(booking.totalEstimated) - Number(booking.advancePaid)) * 100) / 100
  if (amount > balance + 0.01) {
    throw new BanquetError(`Only ₹${Math.max(0, balance)} is left to pay on the estimate. Update the booking first if the charges changed.`)
  }
  const advancePaid = Math.round((Number(booking.advancePaid) + amount) * 100) / 100
  await prisma.$executeRawUnsafe(
    'UPDATE "BanquetBooking" SET "advancePaid" = $2, "paymentStatus" = $3, "updatedAt" = $4 WHERE "id" = $1',
    bookingId,
    advancePaid,
    advancePaymentStatus(advancePaid, Number(booking.totalEstimated)),
    new Date()
  )
  await prisma.ledgerEntry.create({
    data: {
      type: 'INCOME',
      category: 'ADVANCE',
      description: `Banquet part payment - ${booking.eventName} (${booking.bookingNumber}) from ${booking.customerName}${payment.note ? ` [${payment.note}]` : ''}`,
      amount,
      method,
      source: 'AUTO',
      refId: bookingId,
    },
  })
  return { stage: 'ADVANCE' as const, booking: { ...booking, advancePaid } }
}

/** Every rupee received (and refunded) for a banquet booking, oldest first, with the running totals */
export async function banquetPaymentHistory(bookingId: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM "BanquetBooking" WHERE "id" = $1', bookingId)
  const booking = rows?.[0]
  if (!booking) throw new BanquetError('Banquet booking not found')
  const bills = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM "BanquetBill" WHERE "banquetBookingId" = $1', bookingId)
  const ledger = await prisma.ledgerEntry.findMany({
    where: { refId: { in: [bookingId, ...bills.map((b) => b.id)] } },
    orderBy: { date: 'asc' },
  })
  const payments = ledger
    .filter((e) => (e.type === 'INCOME' && (e.category === 'ADVANCE' || e.category === 'BANQUET')) || (e.type === 'EXPENSE' && e.category === 'REFUND'))
    .map((e) => ({
      id: e.id,
      date: e.date,
      kind:
        e.type === 'EXPENSE'
          ? 'REFUND'
          : e.category === 'BANQUET'
            ? 'INVOICE_PAYMENT'
            : /part payment/i.test(e.description)
              ? 'PART_PAYMENT'
              : 'ADVANCE',
      method: e.method,
      amount: e.type === 'EXPENSE' ? -e.amount : e.amount,
      description: e.description,
    }))
  const received = Math.round(payments.filter((p) => p.amount > 0).reduce((t, p) => t + p.amount, 0) * 100) / 100
  const refunded = Math.round(payments.filter((p) => p.amount < 0).reduce((t, p) => t - p.amount, 0) * 100) / 100
  const bill = bills[0]
  const total = bill ? Number(bill.grandTotal) : Number(booking.totalEstimated)
  const paidOnBooking = bill
    ? Number(bill.advanceApplied) + Number(bill.payCash) + Number(bill.payUpi) + Number(bill.payCard) + Number(bill.payBank)
    : Number(booking.advancePaid)
  return {
    payments,
    received,
    refunded,
    stage: bill ? 'INVOICE' : 'ESTIMATE',
    billNumber: bill?.billNumber || null,
    total,
    paid: Math.round(paidOnBooking * 100) / 100,
    balance: Math.max(0, Math.round((total - paidOnBooking) * 100) / 100),
    // advance received beyond the invoice total: to be refunded
    excessAdvance: bill ? Math.max(0, Math.round((Number(booking.advancePaid) - Number(bill.advanceApplied)) * 100) / 100) : 0,
  }
}

/**
 * Correct an invoice's charges or GST. Payments stay as they are; the new total cannot be less than
 * what has been paid. Switching GST on or off moves the invoice to the other number series.
 */
export async function updateBanquetBill(
  id: string,
  data: {
    hallRent?: number
    foodCharges?: number
    decorCharges?: number
    soundAvCharges?: number
    extraCharges?: number
    discount?: number
    cgstPercent?: number
    sgstPercent?: number
    notes?: string
  }
) {
  const rows = await prisma.$queryRawUnsafe<any[]>('SELECT * FROM "BanquetBill" WHERE "id" = $1', id)
  const bill = rows?.[0]
  if (!bill) throw new BanquetError('Banquet bill not found')
  const v = (k: keyof typeof data, fallback: unknown) => Math.max(0, data[k] !== undefined ? Number(data[k]) || 0 : Number(fallback) || 0)
  const hallRent = v('hallRent', bill.hallRent)
  const foodCharges = v('foodCharges', bill.foodCharges)
  const decorCharges = v('decorCharges', bill.decorCharges)
  const soundAvCharges = v('soundAvCharges', bill.soundAvCharges)
  const extraCharges = v('extraCharges', bill.extraCharges)
  const discount = v('discount', bill.discount)
  const cgstPercent = data.cgstPercent !== undefined ? Number(data.cgstPercent) : Number(bill.cgstPercent)
  const sgstPercent = data.sgstPercent !== undefined ? Number(data.sgstPercent) : Number(bill.sgstPercent)
  if (!isValidHalfRate(cgstPercent) || !isValidHalfRate(sgstPercent)) throw new BanquetError('CGST and SGST can each only be 0% or 2.5%')
  const taxableAmount = Math.max(0, hallRent + foodCharges + decorCharges + soundAvCharges + extraCharges - discount)
  const gstAmount = computeGst(taxableAmount, cgstPercent, sgstPercent).total
  const grandTotal = Math.round((taxableAmount + gstAmount) * 100) / 100

  const booking = (await prisma.$queryRawUnsafe<any[]>('SELECT * FROM "BanquetBooking" WHERE "id" = $1', bill.banquetBookingId))?.[0]
  const advanceApplied = Math.min(Number(booking?.advancePaid ?? bill.advanceApplied) || 0, grandTotal)
  const otherPaid = Number(bill.payCash) + Number(bill.payUpi) + Number(bill.payCard) + Number(bill.payBank)
  if (advanceApplied + otherPaid > grandTotal + 0.01) {
    throw new BanquetError(`₹${Math.round((advanceApplied + otherPaid) * 100) / 100} is already paid; the invoice total cannot be less than that`)
  }
  const balanceDue = Math.max(0, grandTotal - advanceApplied - otherPaid)
  const paymentStatus = balanceDue <= 0.01 ? 'PAID' : advanceApplied + otherPaid > 0 ? 'PARTIAL' : 'UNPAID'

  let billNumber = bill.billNumber
  const wasGst = Number(bill.gstAmount) > 0
  if (wasGst !== gstAmount > 0) {
    const year = new Date(bill.createdAt).getFullYear()
    billNumber = await nextNumber('BanquetBill', 'billNumber', gstAmount > 0 ? `BNQ-${year}-` : `BNQ-EST-${year}-`, 1)
  }

  await prisma.$executeRawUnsafe(
    `UPDATE "BanquetBill" SET "hallRent" = $2, "foodCharges" = $3, "decorCharges" = $4, "soundAvCharges" = $5,
       "extraCharges" = $6, "discount" = $7, "taxableAmount" = $8, "gstPercent" = $9, "cgstPercent" = $10,
       "sgstPercent" = $11, "gstAmount" = $12, "grandTotal" = $13, "advanceApplied" = $14, "paymentStatus" = $15,
       "billNumber" = $16, "notes" = COALESCE($17, "notes"), "updatedAt" = $18 WHERE "id" = $1`,
    id,
    hallRent,
    foodCharges,
    decorCharges,
    soundAvCharges,
    extraCharges,
    discount,
    taxableAmount,
    cgstPercent + sgstPercent,
    cgstPercent,
    sgstPercent,
    gstAmount,
    grandTotal,
    advanceApplied,
    paymentStatus,
    billNumber,
    data.notes !== undefined ? String(data.notes) : null,
    new Date()
  )
  if (booking) {
    await prisma.$executeRawUnsafe('UPDATE "BanquetBooking" SET "paymentStatus" = $2 WHERE "id" = $1', booking.id, paymentStatus)
  }
  const updated = await getBanquetBills({ search: billNumber })
  return { bill: updated[0], before: bill, renumbered: billNumber !== bill.billNumber ? billNumber : null }
}
