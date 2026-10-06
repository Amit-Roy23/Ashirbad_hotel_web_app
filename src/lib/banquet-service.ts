import { prisma } from '@/lib/prisma'
import { BanquetBooking, BanquetBill, BanquetHall, BanquetStats } from '@/types/banquet'
import crypto from 'crypto'

function genId(): string {
  return 'bnq_' + crypto.randomBytes(12).toString('hex')
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
    eventName: b.eventName,
    eventDate: b.eventDate?.toISOString?.() || b.eventDate,
    endDate: b.endDate?.toISOString?.() || b.endDate,
    slot: b.slot,
    guestCount: Number(b.guestCount || 0),
    hallRent: Number(b.hallRent || 0),
    foodRatePerPlate: Number(b.foodRatePerPlate || 0),
    foodPackageName: b.foodPackageName,
    foodTotal: Number(b.foodTotal || 0),
    decorCharges: Number(b.decorCharges || 0),
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
    eventName: string
    eventDate: string
    endDate?: string
    slot?: string
    guestCount?: number
    hallRent?: number
    foodRatePerPlate?: number
    foodPackageName?: string
    foodTotal?: number
    decorCharges?: number
    extraCharges?: number
    discount?: number
    advancePaid?: number
    advanceMethod?: string
    notes?: string
  },
  userName?: string
) {
  const countRows = await prisma.$queryRawUnsafe<any[]>('SELECT count(*)::int as count FROM "BanquetBooking"')
  const count = countRows?.[0]?.count || 0
  const year = new Date().getFullYear()
  const bookingNumber = `BNQ-BKG-${year}-${String(count + 101).padStart(4, '0')}`

  const id = genId()
  const now = new Date()

  const guestCount = Number(data.guestCount) || 100
  const hallRent = Number(data.hallRent) || 0
  const foodRatePerPlate = Number(data.foodRatePerPlate) || 0
  const foodTotal = data.foodTotal !== undefined ? Number(data.foodTotal) : foodRatePerPlate * guestCount
  const decorCharges = Number(data.decorCharges) || 0
  const extraCharges = Number(data.extraCharges) || 0
  const discount = Number(data.discount) || 0
  const advancePaid = Number(data.advancePaid) || 0

  const subtotal = Math.max(0, hallRent + foodTotal + decorCharges + extraCharges - discount)
  const totalEstimated = subtotal
  const paymentStatus =
    advancePaid >= totalEstimated && totalEstimated > 0 ? 'PAID' : advancePaid > 0 ? 'PARTIAL' : 'UNPAID'

  const eventDateObj = new Date(data.eventDate.length <= 10 ? data.eventDate + 'T12:00:00' : data.eventDate)
  const endDateObj = data.endDate ? new Date(data.endDate) : null

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
    data.customerPhone.trim(),
    data.customerEmail || null,
    data.customerAddress || null,
    data.companyName || null,
    data.gstNumber || null,
    data.eventName.trim(),
    eventDateObj,
    endDateObj,
    data.slot || 'EVENING',
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
    'CONFIRMED',
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
  if (!existing) throw new Error('Banquet booking not found')

  const advanceAddition = Number(data.advanceAddition) || 0
  const newAdvance = Number(existing.advancePaid) + advanceAddition

  const hallRent = data.hallRent !== undefined ? Number(data.hallRent) : Number(existing.hallRent)
  const guestCount = data.guestCount !== undefined ? Number(data.guestCount) : Number(existing.guestCount)
  const foodTotal = data.foodTotal !== undefined ? Number(data.foodTotal) : Number(existing.foodTotal)
  const decorCharges = data.decorCharges !== undefined ? Number(data.decorCharges) : Number(existing.decorCharges)
  const extraCharges = data.extraCharges !== undefined ? Number(data.extraCharges) : Number(existing.extraCharges)
  const discount = data.discount !== undefined ? Number(data.discount) : Number(existing.discount)

  const totalEstimated = Math.max(0, hallRent + foodTotal + decorCharges + extraCharges - discount)
  const currentAdvance = data.advancePaid !== undefined ? Number(data.advancePaid) : newAdvance
  const paymentStatus =
    currentAdvance >= totalEstimated && totalEstimated > 0 ? 'PAID' : currentAdvance > 0 ? 'PARTIAL' : 'UNPAID'

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
  if (data.customerPhone) {
    updates.push(`"customerPhone" = $${pIdx++}`)
    params.push(data.customerPhone.trim())
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
  if (data.eventDate) {
    updates.push(`"eventDate" = $${pIdx++}`)
    params.push(new Date(String(data.eventDate).length <= 10 ? String(data.eventDate) + 'T12:00:00' : String(data.eventDate)))
  }
  if (data.endDate !== undefined) {
    updates.push(`"endDate" = $${pIdx++}`)
    params.push(data.endDate ? new Date(String(data.endDate)) : null)
  }
  if (data.slot) {
    updates.push(`"slot" = $${pIdx++}`)
    params.push(data.slot)
  }
  if (data.hallId) {
    updates.push(`"hallId" = $${pIdx++}`)
    params.push(data.hallId)
  }
  if (data.guestCount !== undefined) {
    updates.push(`"guestCount" = $${pIdx++}`)
    params.push(guestCount)
  }
  if (data.hallRent !== undefined) {
    updates.push(`"hallRent" = $${pIdx++}`)
    params.push(hallRent)
  }
  if (data.foodRatePerPlate !== undefined) {
    updates.push(`"foodRatePerPlate" = $${pIdx++}`)
    params.push(Number(data.foodRatePerPlate))
  }
  if (data.foodPackageName !== undefined) {
    updates.push(`"foodPackageName" = $${pIdx++}`)
    params.push(data.foodPackageName)
  }
  if (data.foodTotal !== undefined) {
    updates.push(`"foodTotal" = $${pIdx++}`)
    params.push(foodTotal)
  }
  if (data.decorCharges !== undefined) {
    updates.push(`"decorCharges" = $${pIdx++}`)
    params.push(decorCharges)
  }
  if (data.extraCharges !== undefined) {
    updates.push(`"extraCharges" = $${pIdx++}`)
    params.push(extraCharges)
  }
  if (data.discount !== undefined) {
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
    try {
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
    } catch (e) {
      console.error('Failed to log ledger entry for additional banquet advance:', e)
    }
  }

  const updatedRows = await getBanquetBookings({ search: existing.bookingNumber })
  return updatedRows[0]
}

export async function deleteBanquetBooking(id: string) {
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
  if (!booking) throw new Error('Banquet booking not found')

  const countRows = await prisma.$queryRawUnsafe<any[]>('SELECT count(*)::int as count FROM "BanquetBill"')
  const count = countRows?.[0]?.count || 0
  const year = new Date().getFullYear()
  const billNumber = `BNQ-${year}-${String(count + 1).padStart(4, '0')}`

  const id = genId()
  const now = new Date()

  const hallRent = data.hallRent !== undefined ? Number(data.hallRent) : Number(booking.hallRent)
  const foodCharges = data.foodCharges !== undefined ? Number(data.foodCharges) : Number(booking.foodTotal)
  const decorCharges = data.decorCharges !== undefined ? Number(data.decorCharges) : Number(booking.decorCharges)
  const soundAvCharges = Number(data.soundAvCharges) || 0
  const extraCharges = data.extraCharges !== undefined ? Number(data.extraCharges) : Number(booking.extraCharges)
  const discount = data.discount !== undefined ? Number(data.discount) : Number(booking.discount)

  const taxableAmount = Math.max(0, hallRent + foodCharges + decorCharges + soundAvCharges + extraCharges - discount)
  const gstPercent = data.gstPercent !== undefined ? Number(data.gstPercent) : 18
  const gstAmount = Math.round(((taxableAmount * gstPercent) / 100) * 100) / 100
  const grandTotal = Math.round((taxableAmount + gstAmount) * 100) / 100

  const advanceApplied = Math.min(Number(data.advanceApplied ?? booking.advancePaid), grandTotal)
  const payCash = Number(data.payCash) || 0
  const payUpi = Number(data.payUpi) || 0
  const payCard = Number(data.payCard) || 0
  const payBank = Number(data.payBank) || 0

  const totalPaid = advanceApplied + payCash + payUpi + payCard + payBank
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
    booking.slot,
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
            category: 'ROOM_RENT',
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
  if (!bill) throw new Error('Banquet bill not found')

  const addCash = Number(payment.payCash) || 0
  const addUpi = Number(payment.payUpi) || 0
  const addCard = Number(payment.payCard) || 0
  const addBank = Number(payment.payBank) || 0

  const payCash = Number(bill.payCash) + addCash
  const payUpi = Number(bill.payUpi) + addUpi
  const payCard = Number(bill.payCard) + addCard
  const payBank = Number(bill.payBank) + addBank

  const totalPaid = Number(bill.advanceApplied) + payCash + payUpi + payCard + payBank
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
            category: 'ROOM_RENT',
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
  return await prisma.$executeRawUnsafe('DELETE FROM "BanquetBill" WHERE "id" = $1', id)
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
  const totalOutstanding = Math.max(0, Math.round((totalBilledRevenue - totalCollected) * 100) / 100)

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
    todayCash,
    todayUpi,
    todayCard,
    todayBank,
  }
}
