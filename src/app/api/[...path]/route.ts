import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  calcNights,
  makeIST,
  istDateStr,
  computeOverstay,
  nextAutoExtensionAt,
  maxGuestsFor,
} from '@/lib/stay'
import {
  getBanquetHalls,
  createBanquetHall,
  updateBanquetHall,
  deleteBanquetHall,
  getBanquetBookings,
  createBanquetBooking,
  updateBanquetBooking,
  cancelBanquetBooking,
  deleteBanquetBooking,
  getBanquetBills,
  createBanquetBill,
  addBanquetBillPayment,
  deleteBanquetBill,
  getBanquetStats,
  adjustBanquetAdvance,
  BanquetError,
} from '@/lib/banquet-service'
import {
  listItems as listInventoryItems,
  createItem as createInventoryItem,
  updateItem as updateInventoryItem,
  deleteItem as deleteInventoryItem,
  recordMovement as recordInventoryMovement,
  deleteMovement as deleteInventoryMovement,
  listMovements as listInventoryMovements,
  stockReport as inventoryStockReport,
  lowStockCount as inventoryLowStockCount,
  InventoryError,
} from '@/lib/inventory-service'
import { getDayBook } from '@/lib/daybook'
import {
  listStaff as listStaffMembers,
  createStaff as createStaffMember,
  updateStaff as updateStaffMember,
  recordStaffPayment,
  deleteStaffPayment as removeStaffPayment,
  setWorkDay,
  periodLabel,
  StaffError,
} from '@/lib/staff-service'
import { isValidHalfRate, normalizeHalfRate, computeGst, billBalance, billReceived, splitGst } from '@/lib/gst'
import { bookingPaymentStatus } from '@/lib/hotel-utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'

// ============ HELPERS ============
interface RequestUser {
  id?: string
  name?: string
  role?: string
}

function getRequestUser(req: NextRequest): RequestUser {
  const rawName = req.headers.get('x-user-name')
  let decodedName: string | undefined = undefined
  if (rawName) {
    try {
      decodedName = decodeURIComponent(rawName)
    } catch {
      decodedName = rawName
    }
  }

  return {
    id: req.headers.get('x-user-id') || undefined,
    name: decodedName,
    role: req.headers.get('x-user-role') || undefined,
  }
}

async function logAudit(
  action: string,
  entity: string,
  entityId: string | null | undefined,
  details: string,
  user: RequestUser
) {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        entity,
        entityId: entityId || null,
        details,
        userName: user.name || null,
        userRole: user.role || null,
      },
    })
  } catch (e) {
    console.error('Audit log error:', e)
  }
}

const DEFAULT_SETTINGS: Record<string, string> = {
  hotelName: 'Ashirbad Lodge',
  hotelAddress: 'Station Road, Kolkata',
  hotelPhone: '+91 90000 00000',
  hotelGstin: '',
  restaurantName: 'Ashirbad Restaurant',
  restaurantAddress: 'Station Road, Kolkata',
  restaurantPhone: '+91 90000 00000',
  restaurantGstin: '',
  restaurantFssai: '',
  gstPercent: '5',
  // Lodging bill GST (CGST + SGST, each 0 or 2.5) with an on/off switch
  lodgingGstEnabled: 'true',
  lodgingCgst: '2.5',
  lodgingSgst: '2.5',
  // Restaurant (food) bill GST with an on/off switch
  foodGstEnabled: 'false',
  foodCgst: '2.5',
  foodSgst: '2.5',
  invoicePrefix: 'INV',
  invoiceCounter: '1',
  // Bills without GST are estimates with their own number series
  estimatePrefix: 'EST',
  estimateCounter: '1',
  checkoutTime: '08:00',
  overstayGraceMinutes: '0',
  autoExtendEnabled: 'true',
}

/**
 * Bills made before payments were recorded one by one: rebuild their payment rows once from the
 * audit trail (each later collection is logged with its date and split) and the bill totals.
 */
async function backfillBillPayments() {
  const bills = await prisma.$queryRawUnsafe<{ id: string; createdAt: Date; payCash: number; payUpi: number; payCard: number }[]>(
    `SELECT b."id", b."createdAt", b."payCash", b."payUpi", b."payCard" FROM "Bill" b
     WHERE (b."payCash" + b."payUpi" + b."payCard") > 0
       AND NOT EXISTS (SELECT 1 FROM "BillPayment" p WHERE p."billId" = b."id")`
  )
  if (bills.length === 0) return
  const logs = await prisma.auditLog.findMany({
    where: { action: 'PAYMENT', entity: 'Bill', entityId: { in: bills.map((b) => b.id) } },
    orderBy: { createdAt: 'asc' },
  })
  const money = (n: number) => Math.round(n * 100) / 100
  const pick = (text: string, mode: string) => {
    const m = text.match(new RegExp(`${mode} ₹([0-9]+(?:\\.[0-9]+)?)`))
    return m ? Number(m[1]) : 0
  }
  const rows: Prisma.BillPaymentCreateManyInput[] = []
  for (const b of bills) {
    let cash = b.payCash
    let upi = b.payUpi
    let card = b.payCard
    for (const a of logs.filter((l) => l.entityId === b.id)) {
      const t = a.details || ''
      const c = Math.min(cash, pick(t, 'Cash'))
      const u = Math.min(upi, pick(t, 'UPI'))
      const k = Math.min(card, pick(t, 'Card'))
      if (c + u + k <= 0) continue
      cash -= c
      upi -= u
      card -= k
      rows.push({ billId: b.id, date: a.createdAt, kind: 'DUE', cash: c, upi: u, card: k, amount: money(c + u + k), createdBy: a.userName })
    }
    if (cash + upi + card > 0.001) {
      rows.push({ billId: b.id, date: b.createdAt, kind: 'CHECKOUT', cash: money(cash), upi: money(upi), card: money(card), amount: money(cash + upi + card) })
    }
  }
  if (rows.length) await prisma.billPayment.createMany({ data: rows })
}

/**
 * Columns added after the first deployment. Deploys do not run `prisma db push`, so make sure
 * they exist (idempotent) before any query that uses them.
 */
let schemaReady: Promise<void> | null = null
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    const stmts = [
      `ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "cgstPercent" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "sgstPercent" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "previousDue" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "carriedFrom" TEXT`,
      `ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "carriedForward" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "carriedToBillNumber" TEXT`,
      `ALTER TABLE "FoodOrder" ADD COLUMN IF NOT EXISTS "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "FoodOrder" ADD COLUMN IF NOT EXISTS "cgstPercent" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "FoodOrder" ADD COLUMN IF NOT EXISTS "sgstPercent" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "FoodOrder" ADD COLUMN IF NOT EXISTS "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "BanquetBill" ADD COLUMN IF NOT EXISTS "cgstPercent" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "BanquetBill" ADD COLUMN IF NOT EXISTS "sgstPercent" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "BanquetBooking" ADD COLUMN IF NOT EXISTS "decorEnabled" BOOLEAN NOT NULL DEFAULT true`,
      `ALTER TABLE "BanquetBooking" ADD COLUMN IF NOT EXISTS "days" INTEGER NOT NULL DEFAULT 1`,
      `ALTER TABLE "BanquetBooking" ADD COLUMN IF NOT EXISTS "startTime" TEXT`,
      `ALTER TABLE "BanquetBooking" ADD COLUMN IF NOT EXISTS "endTime" TEXT`,
      `ALTER TABLE "BanquetBooking" ADD COLUMN IF NOT EXISTS "hallRatePerDay" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "BanquetBooking" ADD COLUMN IF NOT EXISTS "idProof" TEXT`,
      // Inventory (same definition as prisma/schema.prisma)
      `CREATE TABLE IF NOT EXISTS "InventoryItem" (
        "id" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "category" TEXT NOT NULL DEFAULT 'Housekeeping & Linen',
        "unit" TEXT NOT NULL DEFAULT 'pcs',
        "stock" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "reorderLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "avgCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "location" TEXT,
        "notes" TEXT,
        "active" BOOLEAN NOT NULL DEFAULT true,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "InventoryItem_name_key" ON "InventoryItem"("name")`,
      `CREATE INDEX IF NOT EXISTS "InventoryItem_category_idx" ON "InventoryItem"("category")`,
      `CREATE INDEX IF NOT EXISTS "InventoryItem_active_idx" ON "InventoryItem"("active")`,
      `CREATE TABLE IF NOT EXISTS "InventoryMovement" (
        "id" TEXT NOT NULL,
        "itemId" TEXT NOT NULL,
        "type" TEXT NOT NULL,
        "quantity" DOUBLE PRECISION NOT NULL,
        "balanceAfter" DOUBLE PRECISION NOT NULL,
        "unitCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "totalCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "vendor" TEXT,
        "reference" TEXT,
        "department" TEXT,
        "roomNumber" TEXT,
        "method" TEXT,
        "expenseRecorded" BOOLEAN NOT NULL DEFAULT false,
        "note" TEXT,
        "createdBy" TEXT,
        "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "InventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS "InventoryMovement_itemId_idx" ON "InventoryMovement"("itemId")`,
      `CREATE INDEX IF NOT EXISTS "InventoryMovement_date_idx" ON "InventoryMovement"("date")`,
      `CREATE INDEX IF NOT EXISTS "InventoryMovement_type_idx" ON "InventoryMovement"("type")`,
      `CREATE TABLE IF NOT EXISTS "BillPayment" (
        "id" TEXT NOT NULL,
        "billId" TEXT NOT NULL,
        "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "kind" TEXT NOT NULL,
        "cash" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "upi" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "card" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "note" TEXT,
        "createdBy" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "BillPayment_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "BillPayment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE INDEX IF NOT EXISTS "BillPayment_billId_idx" ON "BillPayment"("billId")`,
      `CREATE INDEX IF NOT EXISTS "BillPayment_date_idx" ON "BillPayment"("date")`,
      `ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "payType" TEXT NOT NULL DEFAULT 'MONTHLY'`,
      `ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "dailyRate" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "StaffPayment" ADD COLUMN IF NOT EXISTS "gross" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "StaffPayment" ADD COLUMN IF NOT EXISTS "recovered" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "StaffPayment" ADD COLUMN IF NOT EXISTS "deduction" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "StaffPayment" ADD COLUMN IF NOT EXISTS "period" TEXT`,
      `ALTER TABLE "StaffPayment" ADD COLUMN IF NOT EXISTS "days" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `CREATE TABLE IF NOT EXISTS "StaffWorkDay" (
        "id" TEXT NOT NULL,
        "staffId" TEXT NOT NULL,
        "date" TEXT NOT NULL,
        "units" DOUBLE PRECISION NOT NULL DEFAULT 1,
        "paymentId" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "StaffWorkDay_pkey" PRIMARY KEY ("id"),
        CONSTRAINT "StaffWorkDay_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "StaffWorkDay_staffId_date_key" ON "StaffWorkDay"("staffId", "date")`,
      `CREATE INDEX IF NOT EXISTS "StaffWorkDay_staffId_idx" ON "StaffWorkDay"("staffId")`,
      // Bookings without a bill used to be marked PAID even with nothing paid
      `UPDATE "Booking" b SET "paymentStatus" = CASE
          WHEN b."advance" <= 0.01 THEN 'UNPAID'
          WHEN b."advance" >= b."ratePerDay" * GREATEST(b."days", 1) - 0.01 THEN 'PAID'
          ELSE 'PARTIAL' END
        WHERE NOT EXISTS (SELECT 1 FROM "Bill" x WHERE x."bookingId" = b."id")
          AND b."paymentStatus" IS DISTINCT FROM (CASE
          WHEN b."advance" <= 0.01 THEN 'UNPAID'
          WHEN b."advance" >= b."ratePerDay" * GREATEST(b."days", 1) - 0.01 THEN 'PAID'
          ELSE 'PARTIAL' END)`,
    ]
    schemaReady = (async () => {
      for (const sql of stmts) await prisma.$executeRawUnsafe(sql)
      await backfillBillPayments()
    })().catch((e) => {
      schemaReady = null
      throw e
    })
  }
  return schemaReady
}

/** Lodging CGST / SGST defaults from Settings (0/0 when lodging GST is switched off) */
function lodgingGstDefaults(settings: Record<string, string>) {
  if (settings.lodgingGstEnabled === 'false') return { cgst: 0, sgst: 0 }
  return { cgst: normalizeHalfRate(settings.lodgingCgst), sgst: normalizeHalfRate(settings.lodgingSgst) }
}

/** Food bill CGST / SGST from Settings (null when food GST is switched off) */
function foodGstDefaults(settings: Record<string, string>) {
  return { enabled: settings.foodGstEnabled === 'true', cgst: normalizeHalfRate(settings.foodCgst), sgst: normalizeHalfRate(settings.foodSgst) }
}

/**
 * CGST / SGST for a lodging bill from the request: explicit cgstPercent/sgstPercent (each 0 or 2.5),
 * or a legacy combined gstPercent (0 or 5, split in halves), else the Settings default.
 */
function resolveLodgingGst(
  body: Record<string, unknown>,
  settings: Record<string, string>,
  current?: { cgst: number; sgst: number }
): { cgst: number; sgst: number } | { error: string } {
  const { cgstPercent, sgstPercent, gstPercent } = body
  const given = (v: unknown) => v !== undefined && v !== null && v !== ''
  if (given(cgstPercent) || given(sgstPercent)) {
    const c = given(cgstPercent) ? cgstPercent : current?.cgst ?? 0
    const s = given(sgstPercent) ? sgstPercent : current?.sgst ?? 0
    if (!isValidHalfRate(c) || !isValidHalfRate(s)) return { error: 'CGST and SGST can each only be 0% or 2.5%' }
    return { cgst: Number(c), sgst: Number(s) }
  }
  if (given(gstPercent)) {
    const g = Number(gstPercent)
    if (g === 0) return { cgst: 0, sgst: 0 }
    if (g === 5) return { cgst: 2.5, sgst: 2.5 }
    return { error: 'GST on lodging bills is CGST 2.5% + SGST 2.5% (or 0%)' }
  }
  return current || lodgingGstDefaults(settings)
}

/** Unpaid balance across a guest's bills (optionally ignoring one booking's own bills) */
async function guestOutstanding(guestId: string, excludeBookingId?: string) {
  const bills = await prisma.bill.findMany({
    where: { booking: { guestId }, ...(excludeBookingId ? { bookingId: { not: excludeBookingId } } : {}) },
    orderBy: { createdAt: 'asc' },
  })
  const open = bills.filter((b) => billBalance(b) > 0.01)
  return { total: Math.round(open.reduce((s, b) => s + billBalance(b), 0) * 100) / 100, bills: open }
}

/** Gives carried-in dues back to the earlier bills (used when the bill holding them is deleted) */
async function revertCarriedFrom(db: Db, bill: { carriedFrom: string | null }) {
  if (!bill.carriedFrom) return
  let rows: { id: string; amount: number }[] = []
  try {
    rows = JSON.parse(bill.carriedFrom)
  } catch {
    return
  }
  for (const r of rows) {
    const old = await db.bill.findUnique({ where: { id: r.id } })
    if (!old) continue
    const left = Math.max(0, Math.round(((old.carriedForward || 0) - Number(r.amount || 0)) * 100) / 100)
    await db.bill.update({
      where: { id: old.id },
      data: { carriedForward: left, carriedToBillNumber: left > 0.01 ? old.carriedToBillNumber : null },
    })
  }
}

async function verifyAdminPin(pin: unknown) {
  if (!pin) return null
  return prisma.user.findFirst({ where: { pin: String(pin), active: true, role: 'ADMIN' } })
}

async function getSettingsMap(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany()
  const map = { ...DEFAULT_SETTINGS }
  for (const r of rows) map[r.key] = r.value
  return map
}

/**
 * Hotel internal accounting for a room bill: actual tariff + food + extra − discount,
 * plus the GST charged on the invoice. For a custom corporate bill that GST is 5% of the
 * custom amount (e.g. ₹4000 → ₹200), so it is added in full to the internal total.
 * Computed from the bill's fields so older bills show the same rule in Reports.
 */
function billInternal(b: {
  actualRoomTotal: number
  foodTotal: number
  extraCharges: number
  discount: number
  actualGst: number
}): { gst: number; total: number } {
  const taxable = Math.max(0, b.actualRoomTotal + b.foodTotal + b.extraCharges - b.discount)
  return { gst: b.actualGst, total: Math.round((taxable + b.actualGst) * 100) / 100 }
}

function num(v: unknown): number {
  const f = parseFloat(String(v))
  return isNaN(f) ? 0 : f
}

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '-'
  const date = new Date(d)
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function toDateStr(d: string | Date | null | undefined): string {
  return istDateStr(d)
}

function doDateRangesOverlap(
  inA: string | Date | null | undefined,
  outA: string | Date | null | undefined,
  inB: string | Date | null | undefined,
  outB: string | Date | null | undefined
): boolean {
  const startA = toDateStr(inA)
  if (!startA) return false
  const endA = outA ? toDateStr(outA) : startA
  const startB = toDateStr(inB)
  if (!startB) return false
  const endB = outB ? toDateStr(outB) : startB

  // In hotel reservations: checkout on day X and checkin on day X do NOT overlap
  return startA < endB && endA > startB
}

/** ISO timestamps that carry their own zone (e.g. `new Date().toISOString()`) must not be re-read as IST wall-clock time */
function hasExplicitZone(s: string): boolean {
  return /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(s)
}

function parseDateInput(value: unknown, fallbackTime = '08:00'): Date | null {
  if (value === undefined || value === null || value === '') return null
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? new Date() : value
  }
  const s = String(value).trim()
  if (!s) return null
  if (hasExplicitZone(s)) {
    const d = new Date(s)
    if (!isNaN(d.getTime())) return d
  }
  const cleanFallback = String(fallbackTime || '08:00').replace(/^T/i, '').trim() || '08:00'
  if (s.includes('T')) {
    const [d, t] = s.split('T')
    return makeIST(d, t.replace('Z', '').slice(0, 8))
  }
  if (s.includes(' ')) {
    const [d, t] = s.split(' ')
    return makeIST(d, t.slice(0, 8))
  }
  return makeIST(s, cleanFallback)
}

/**
 * Automatically extends ACTIVE bookings that passed their checkout time + grace period.
 * Idempotent with optimistic update and audit logging. Catches up in one step if app was closed for multiple days.
 */
async function applyAutoExtensions(now = new Date()) {
  try {
    const settings = await getSettingsMap()
    if (settings.autoExtendEnabled !== 'true') return

    const graceMinutes = parseInt(settings.overstayGraceMinutes || '0', 10) || 0
    const activeBookings = await prisma.booking.findMany({
      where: {
        status: 'ACTIVE',
        checkOut: { not: null },
      },
      include: { room: true, guest: true },
    })

    for (const booking of activeBookings) {
      const overstay = computeOverstay(booking, now, graceMinutes)
      if (!overstay.overdue || !overstay.newCheckOut || overstay.extraDays <= 0) continue

      const oldCheckOut = booking.checkOut!
      const newCheckOut = overstay.newCheckOut
      const oldDays = booking.days
      const newDays = calcNights(booking.checkIn, newCheckOut)
      const k = overstay.extraDays

      const updateRes = await prisma.booking.updateMany({
        where: {
          id: booking.id,
          checkOut: oldCheckOut,
          status: 'ACTIVE',
        },
        data: {
          checkOut: newCheckOut,
          days: newDays,
          autoExtendedDays: { increment: k },
        },
      })

      if (updateRes.count === 1) {
        await prisma.bookingExtension.create({
          data: {
            bookingId: booking.id,
            type: 'AUTO',
            fromCheckOut: oldCheckOut,
            toCheckOut: newCheckOut,
            fromDays: oldDays,
            toDays: newDays,
            reason: `Auto overstay extension (+${k} day${k > 1 ? 's' : ''})`,
            createdBy: 'SYSTEM',
          },
        })
        await prisma.auditLog.create({
          data: {
            action: 'AUTO_EXTEND',
            entity: 'Booking',
            entityId: booking.id,
            details: `Auto-extended overstay for ${booking.guest.name} (Room ${booking.room.number}): checkout ${oldCheckOut.toISOString()} → ${newCheckOut.toISOString()}, days ${oldDays} → ${newDays} (+${k} day${k > 1 ? 's' : ''})`,
            userName: 'SYSTEM',
            userRole: 'SYSTEM',
          },
        })
      }
    }
  } catch (err) {
    console.error('Error in applyAutoExtensions:', err)
  }
}

/** Recompute UNPAID | PARTIAL | PAID for a booking from its latest bill */
async function refreshBookingPaymentStatus(bookingId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
  if (!booking) return
  const bill = await prisma.bill.findFirst({ where: { bookingId }, orderBy: { createdAt: 'desc' } })
  // Dues carried into a later bill are no longer owed here (balanceDue accounts for it)
  const paymentStatus = bookingPaymentStatus({ ...booking, bills: bill ? [bill] : [] })
  if (paymentStatus !== booking.paymentStatus) {
    await prisma.booking.update({ where: { id: bookingId }, data: { paymentStatus } })
  }
}

type Db = typeof prisma | Prisma.TransactionClient

/**
 * Room.status is derived from the room's bookings so every screen (grid, header counts,
 * dashboard stats, reports) agrees:
 *   ACTIVE booking → OCCUPIED, else manual MAINTENANCE is kept,
 *   else a BOOKED reservation due today (or overdue) → BOOKED, else VACANT.
 */
function deriveRoomStatus(
  currentStatus: string,
  bookings: { status: string; checkIn: Date }[],
  todayIST = istDateStr(new Date())
): string {
  if (bookings.some((b) => b.status === 'ACTIVE')) return 'OCCUPIED'
  if (currentStatus === 'MAINTENANCE') return 'MAINTENANCE'
  if (bookings.some((b) => b.status === 'BOOKED' && istDateStr(b.checkIn) <= todayIST)) return 'BOOKED'
  return 'VACANT'
}

async function syncRoomStatus(db: Db, roomId: string) {
  const room = await db.room.findUnique({
    where: { id: roomId },
    include: {
      bookings: { where: { status: { in: ['ACTIVE', 'BOOKED'] } }, select: { status: true, checkIn: true } },
    },
  })
  if (!room) return
  const status = deriveRoomStatus(room.status, room.bookings)
  if (status !== room.status) {
    await db.room.update({ where: { id: roomId }, data: { status } })
  }
}

/** Re-derives every room's status (a future reservation becomes "due today" without any write happening) */
async function syncAllRoomStatuses() {
  try {
    const rooms = await prisma.room.findMany({
      include: {
        bookings: { where: { status: { in: ['ACTIVE', 'BOOKED'] } }, select: { status: true, checkIn: true } },
      },
    })
    const todayIST = istDateStr(new Date())
    for (const room of rooms) {
      const status = deriveRoomStatus(room.status, room.bookings, todayIST)
      if (status !== room.status) {
        await prisma.room.update({ where: { id: room.id }, data: { status } })
      }
    }
  } catch (err) {
    console.error('Error in syncAllRoomStatuses:', err)
  }
}

async function refreshOperationalState() {
  await applyAutoExtensions()
  await syncAllRoomStatuses()
}

/** Keeps the latest bill's advanceApplied in step with booking.advance */
async function syncBillAdvance(bookingId: string): Promise<string | null> {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
  if (!booking) return null
  const bill = await prisma.bill.findFirst({ where: { bookingId }, orderBy: { createdAt: 'desc' } })
  if (!bill) {
    // No bill yet: the advance alone decides UNPAID / PARTIAL / PAID
    await refreshBookingPaymentStatus(bookingId)
    return null
  }
  const advanceApplied = Math.min(booking.advance || 0, bill.grandTotal)
  if (Math.abs(advanceApplied - bill.advanceApplied) > 0.001) {
    await prisma.bill.update({ where: { id: bill.id }, data: { advanceApplied } })
  }
  await refreshBookingPaymentStatus(bookingId)
  return bill.billNumber
}

interface BillLedgerInput {
  billId: string
  billNumber: string
  date: Date
  roomNumber: string
  guestName: string
  days: number
  ratePerDay: number
  actualRoomTotal: number
  foodTotal: number
  extraCharges: number
  discount: number
  gstPercent: number
  cgstPercent?: number
  sgstPercent?: number
  internalGst: number
}

/**
 * Ledger rows for a room bill. They add up to the bill's internalTotal
 * (actual room + food + extra − discount + internal GST) so the ledger, dashboard and reports agree.
 */
function buildBillLedgerEntries(b: BillLedgerInput): Prisma.LedgerEntryCreateManyInput[] {
  let remainingDiscount = Math.max(0, b.discount)
  const roomNet = Math.max(0, b.actualRoomTotal - remainingDiscount)
  remainingDiscount -= b.actualRoomTotal - roomNet
  const foodNet = Math.max(0, b.foodTotal - remainingDiscount)
  remainingDiscount -= b.foodTotal - foodNet
  const extraNet = Math.max(0, b.extraCharges - remainingDiscount)

  const base = { date: b.date, type: 'INCOME', method: 'SPLIT', source: 'AUTO', refId: b.billId }
  const entries: Prisma.LedgerEntryCreateManyInput[] = []
  if (roomNet > 0) {
    entries.push({
      ...base,
      category: 'ROOM_RENT',
      description: `Room ${b.roomNumber} rent (${b.days} day${b.days > 1 ? 's' : ''} @ ₹${b.ratePerDay})${b.discount > 0 ? ` less discount` : ''} - ${b.guestName}`,
      amount: Math.round(roomNet * 100) / 100,
    })
  }
  if (foodNet > 0) {
    entries.push({
      ...base,
      category: 'FOOD',
      description: `Food charges - Room ${b.roomNumber} - ${b.guestName}`,
      amount: Math.round(foodNet * 100) / 100,
    })
  }
  if (extraNet > 0) {
    entries.push({
      ...base,
      category: 'OTHER',
      description: `Extra charges on bill ${b.billNumber} - ${b.guestName}`,
      amount: Math.round(extraNet * 100) / 100,
    })
  }
  if (b.internalGst > 0) {
    entries.push({
      ...base,
      category: 'GST',
      description:
        b.cgstPercent !== undefined && b.sgstPercent !== undefined
          ? `CGST ${b.cgstPercent}% + SGST ${b.sgstPercent}% on bill ${b.billNumber}`
          : `GST ${b.gstPercent}% on bill ${b.billNumber}`,
      amount: b.internalGst,
    })
  }
  return entries
}

/**
 * Next bill number: GST bills use the invoice series (INV-0001…), bills without GST the estimate
 * series (EST-0001…). The counter is bumped in the same transaction, so two bills never share a number.
 */
async function takeBillNumber(tx: Prisma.TransactionClient, withGst: boolean, settings: Record<string, string>) {
  const key = withGst ? 'invoiceCounter' : 'estimateCounter'
  const prefix = (withGst ? settings.invoicePrefix || 'INV' : settings.estimatePrefix || 'EST').trim() || (withGst ? 'INV' : 'EST')
  const start = parseInt(settings[key]) || 1
  await tx.setting.upsert({ where: { key }, update: {}, create: { key, value: String(start) } })
  for (let guard = 0; guard < 1000; guard++) {
    const rows = await tx.$queryRaw<{ value: string }[]>`
      UPDATE "Setting" SET "value" = (COALESCE(NULLIF(regexp_replace("value", '[^0-9]', '', 'g'), '')::int, 1) + 1)::text
      WHERE "key" = ${key} RETURNING "value"`
    const n = (parseInt(rows[0]?.value) || 2) - 1
    const number = `${prefix}-${String(n).padStart(4, '0')}`
    // Skip numbers already used (e.g. after the counter was set back in Settings)
    if (!(await tx.bill.findUnique({ where: { billNumber: number } }))) return number
  }
  throw new Error('Could not allocate a bill number')
}

// ============ ROOMS ============
async function listRooms(req: NextRequest) {
  await refreshOperationalState()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const floor = searchParams.get('floor')
  const type = searchParams.get('type')
  const rooms = await prisma.room.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(type ? { type } : {}),
    },
    orderBy: { number: 'asc' },
    include: {
      bookings: {
        where: { status: { in: ['ACTIVE', 'BOOKED'] } },
        include: {
          guest: true,
          extensions: { orderBy: { createdAt: 'desc' } },
          foodOrders: { where: { status: 'PENDING' }, include: { items: true } },
        },
        orderBy: { checkIn: 'asc' },
      },
    },
  })
  const filtered = floor ? rooms.filter((r) => r.number.startsWith(floor)) : rooms
  return NextResponse.json(filtered)
}

async function createRoom(req: NextRequest, body: Record<string, unknown>, user: RequestUser) {
  const { number, floor, type, capacity, rate, notes } = body
  if (!number) return NextResponse.json({ error: 'Room number required' }, { status: 400 })
  const admin = await verifyAdminAuth(req, body)
  if (!admin.ok) return NextResponse.json({ error: 'Admin PIN is required to add a room' }, { status: 403 })
  const cap = parseInt(String(capacity ?? 2)) || 2
  if (cap < 1 || cap > 10) return NextResponse.json({ error: 'Beds / capacity must be between 1 and 10' }, { status: 400 })
  const cleanNumber = String(number).replace(/\D/g, '').trim()
  if (!cleanNumber) return NextResponse.json({ error: 'Room number must only contain digits' }, { status: 400 })
  const exists = await prisma.room.findUnique({ where: { number: cleanNumber } })
  if (exists) return NextResponse.json({ error: `Room ${cleanNumber} already exists` }, { status: 400 })
  const room = await prisma.room.create({
    data: {
      number: cleanNumber,
      floor: floor ? String(floor) : cleanNumber.charAt(0) || '1',
      type: type ? String(type) : 'Non-AC',
      capacity: cap,
      rate: num(rate) || 800,
      notes: notes ? String(notes) : null,
    },
  })
  await logAudit(
    'ROOM_CREATE',
    'Room',
    room.id,
    `Added Room ${room.number} (${room.type}, ${room.capacity} bed(s), ₹${room.rate}/night, floor ${room.floor})${admin.adminUser ? ` — approved by ${admin.adminUser.name}` : ''}`,
    user
  )
  return NextResponse.json(room)
}

async function updateRoom(req: NextRequest, body: Record<string, unknown>, user: RequestUser) {
  const { id, floor, status, housekeeping, rate, type, capacity, notes } = body
  if (!id) return NextResponse.json({ error: 'Room id required' }, { status: 400 })
  // Changing the room itself (floor, type, beds, rate, notes) is an Admin action; cleaning and
  // maintenance switches stay open to staff. Bookings keep the rate they were made at.
  const editsSetup = [floor, rate, type, capacity, notes].some((v) => v !== undefined)
  let approvedBy: string | null = null
  if (editsSetup) {
    const admin = await verifyAdminAuth(req, body)
    if (!admin.ok) return NextResponse.json({ error: 'Admin PIN is required to change room details' }, { status: 403 })
    approvedBy = admin.adminUser?.name || null
    if (capacity !== undefined) {
      const cap = parseInt(String(capacity))
      if (!(cap >= 1 && cap <= 10)) return NextResponse.json({ error: 'Beds / capacity must be between 1 and 10' }, { status: 400 })
    }
    if (rate !== undefined && !(num(rate) > 0)) return NextResponse.json({ error: 'Rate must be more than 0' }, { status: 400 })
    if (type !== undefined && !String(type).trim()) return NextResponse.json({ error: 'Room type is required' }, { status: 400 })
  }
  const before = await prisma.room.findUnique({ where: { id: String(id) } })
  if (!before) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  if (status !== undefined) {
    // Occupancy/reservation states come from bookings; only MAINTENANCE <-> VACANT is a manual switch
    if (status !== 'MAINTENANCE' && status !== 'VACANT') {
      return NextResponse.json(
        { error: 'Room status can only be set to Maintenance or Vacant manually. Use check-in / booking for other states.' },
        { status: 400 }
      )
    }
    const active = await prisma.booking.findFirst({
      where: { roomId: String(id), status: 'ACTIVE' },
      include: { guest: true },
    })
    if (active) {
      return NextResponse.json(
        { error: `Room is occupied by ${active.guest.name}. Check the guest out or move them before changing room status.` },
        { status: 400 }
      )
    }
  }
  await prisma.room.update({
    where: { id: String(id) },
    data: {
      ...(floor !== undefined && { floor: String(floor) }),
      ...(status !== undefined && { status: String(status) }),
      ...(housekeeping !== undefined && { housekeeping: String(housekeeping) }),
      ...(rate !== undefined && { rate: num(rate) }),
      ...(type !== undefined && { type: String(type) }),
      ...(capacity !== undefined && { capacity: parseInt(String(capacity)) }),
      ...(notes !== undefined && { notes: notes ? String(notes) : null }),
    },
  })
  // "Mark as Vacant" on a room with a reservation due today must show as BOOKED, not VACANT
  await syncRoomStatus(prisma, String(id))
  const room = await prisma.room.findUnique({ where: { id: String(id) } })
  if (editsSetup && room) {
    const changes = (
      [
        ['floor', before.floor, room.floor],
        ['type', before.type, room.type],
        ['beds', before.capacity, room.capacity],
        ['rate', `₹${before.rate}`, `₹${room.rate}`],
        ['notes', before.notes || '—', room.notes || '—'],
      ] as [string, unknown, unknown][]
    )
      .filter(([, a, b]) => String(a) !== String(b))
      .map(([k, a, b]) => `${k} ${a} → ${b}`)
    if (changes.length) {
      await logAudit('ROOM_UPDATE', 'Room', room.id, `Room ${room.number}: ${changes.join(', ')} (applies to new bookings)${approvedBy ? ` — approved by ${approvedBy}` : ''}`, user)
    }
  }
  return NextResponse.json(room)
}

async function deleteRoom(req: NextRequest, user: RequestUser) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Room id is required' }, { status: 400 })

  const room = await prisma.room.findUnique({
    where: { id },
    include: { bookings: { where: { status: { in: ['ACTIVE', 'BOOKED'] } } } },
  })

  if (!room) {
    return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  }

  if (room.status === 'OCCUPIED' || room.bookings.length > 0) {
    return NextResponse.json(
      { error: `Cannot delete Room ${room.number}: it is currently occupied or has active bookings/reservations` },
      { status: 400 }
    )
  }

  // Deleting a room cascades to its bookings and their invoices; keep billing history intact instead
  const historyCount = await prisma.booking.count({ where: { roomId: id } })
  if (historyCount > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete Room ${room.number}: it has ${historyCount} past booking record(s) with bills. Mark it Under Maintenance instead to take it out of service.`,
      },
      { status: 400 }
    )
  }

  await prisma.room.delete({ where: { id } })
  await logAudit('DELETE_ROOM', 'Room', id, `Deleted room ${room.number}`, user)
  return NextResponse.json({ success: true, message: `Room ${room.number} deleted successfully` })
}

// ============ GUESTS ============
function attachGuestDueInfo(guest: any) {
  if (!guest) return null
  const dueHistory: Array<{
    billId: string
    billNumber: string
    bookingId: string
    roomNumber: string
    checkIn: string
    checkOut: string | null
    actualCheckOut: string | null
    checkoutDate: string
    days: number
    grandTotal: number
    paidTotal: number
    balanceDue: number
    paymentStatus: string
    status: string
    createdAt: string
  }> = []

  for (const b of guest.bookings || []) {
    for (const bill of b.bills || []) {
      const totalPaid = billReceived(bill)
      // Dues moved into a later bill (carriedForward) are owed on that bill, not here
      const balanceDue = billBalance(bill)
      if (balanceDue > 0.01) {
        dueHistory.push({
          billId: bill.id,
          billNumber: bill.billNumber,
          bookingId: b.id,
          roomNumber: bill.roomNumber || b.room?.number || '—',
          checkIn: b.checkIn ? new Date(b.checkIn).toISOString() : '',
          checkOut: b.checkOut ? new Date(b.checkOut).toISOString() : null,
          actualCheckOut: b.actualCheckOut ? new Date(b.actualCheckOut).toISOString() : null,
          checkoutDate: b.actualCheckOut
            ? new Date(b.actualCheckOut).toISOString()
            : bill.createdAt
              ? new Date(bill.createdAt).toISOString()
              : b.checkOut
                ? new Date(b.checkOut).toISOString()
                : new Date().toISOString(),
          days: bill.days || b.days || 1,
          grandTotal: bill.grandTotal,
          paidTotal: totalPaid,
          balanceDue,
          paymentStatus: b.paymentStatus || (totalPaid > 0 ? 'PARTIAL' : 'UNPAID'),
          status: b.status,
          createdAt: bill.createdAt ? new Date(bill.createdAt).toISOString() : new Date().toISOString(),
        })
      }
    }
  }

  const totalDue = dueHistory.reduce((sum, d) => sum + d.balanceDue, 0)
  return {
    ...guest,
    totalDue: Math.round(totalDue * 100) / 100,
    dueHistory,
    // used by the check-in dialogs and the lodging bill (dues are added to the next bill)
    outstanding: Math.round(totalDue * 100) / 100,
    outstandingBills: dueHistory.map((d) => ({ billNumber: d.billNumber, balance: d.balanceDue })),
  }
}

async function listGuests(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')
  const guests = await prisma.guest.findMany({
    where: q
      ? {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { company: { contains: q, mode: 'insensitive' } },
          { idProof: { contains: q, mode: 'insensitive' } },
        ],
      }
      : undefined,
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: {
      bookings: {
        orderBy: { createdAt: 'desc' },
        include: {
          room: true,
          bills: { orderBy: { createdAt: 'desc' } },
        },
      },
    },
  })
  return NextResponse.json(guests.map(attachGuestDueInfo))
}

async function lookupGuest(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const rawPhone = searchParams.get('phone') || ''
  const phone = rawPhone.replace(/\D/g, '')
  const idProof = (searchParams.get('idProof') || '').trim()
  const name = (searchParams.get('name') || '').trim()

  let where: any = undefined

  // Autofill: a full number finds that guest; 5–9 digits only match from the start of a number
  if (phone && phone.length >= 10) {
    where = { phone: phone.slice(-10) }
  } else if (phone && phone.length >= 5) {
    where = { phone: { startsWith: phone } }
  } else if (idProof && idProof.length >= 4) {
    where = { idProof: { contains: idProof, mode: 'insensitive' } }
  } else if (name && name.length >= 2) {
    where = { name: { contains: name, mode: 'insensitive' } }
  }

  if (!where) {
    return NextResponse.json(null)
  }

  const guest = await prisma.guest.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      bookings: {
        orderBy: { createdAt: 'desc' },
        include: {
          room: true,
          bills: { orderBy: { createdAt: 'desc' } },
        },
      },
    },
  })
  return NextResponse.json(guest ? attachGuestDueInfo(guest) : null)
}

async function upsertGuest(body: Record<string, unknown>) {
  const { phone, name, company, gst, address, idProof } = body
  if (!phone || !name) {
    return NextResponse.json({ error: 'Phone and name are required' }, { status: 400 })
  }
  const cleanPhone = String(phone).replace(/\D/g, '')
  if (cleanPhone.length !== 10) {
    return NextResponse.json(
      { error: 'Invalid phone number. A valid 10-digit mobile number is required.' },
      { status: 400 }
    )
  }
  const guest = await prisma.guest.upsert({
    where: { phone: cleanPhone },
    update: {
      name: String(name),
      ...(company !== undefined && { company: String(company) }),
      ...(gst !== undefined && { gst: String(gst) }),
      ...(address !== undefined && { address: String(address) }),
      ...(idProof !== undefined && { idProof: String(idProof) }),
    },
    create: {
      phone: cleanPhone,
      name: String(name),
      ...(company ? { company: String(company) } : {}),
      ...(gst ? { gst: String(gst) } : {}),
      ...(address ? { address: String(address) } : {}),
      ...(idProof ? { idProof: String(idProof) } : {}),
    },
  })
  return NextResponse.json(guest)
}

async function deleteGuest(req: NextRequest, user: RequestUser) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Guest id is required' }, { status: 400 })

  const guest = await prisma.guest.findUnique({
    where: { id },
    include: { bookings: { where: { status: 'ACTIVE' } } },
  })

  if (!guest) return NextResponse.json({ error: 'Guest not found' }, { status: 404 })

  if (guest.bookings.length > 0) {
    return NextResponse.json({ error: `Cannot delete guest ${guest.name}: guest currently has an active stay/booking` }, { status: 400 })
  }

  const totalBookings = await prisma.booking.count({ where: { guestId: id } })
  if (totalBookings > 0) {
    return NextResponse.json({ error: `Cannot delete guest ${guest.name}: guest has ${totalBookings} past booking record(s)` }, { status: 400 })
  }

  await prisma.guest.delete({ where: { id } })
  await logAudit('DELETE_GUEST', 'Guest', id, `Deleted guest profile ${guest.name} (${guest.phone})`, user)
  return NextResponse.json({ success: true, message: `Guest ${guest.name} deleted successfully` })
}

/**
 * Companies seen before (guest profiles + issued bills) with their latest GSTIN,
 * so a returning company's GSTIN autofills.
 */
async function listCompanies(req: NextRequest) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim()
  const [guests, bills] = await Promise.all([
    prisma.guest.findMany({
      where: { company: q ? { contains: q, mode: 'insensitive' } : { not: null } },
      select: { company: true, gst: true, address: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    }),
    prisma.bill.findMany({
      where: { corporateName: q ? { contains: q, mode: 'insensitive' } : { not: null } },
      select: { corporateName: true, gstNumber: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
  ])
  const byName = new Map<string, { company: string; gst: string | null; address: string | null; at: number }>()
  const add = (company: string | null, gst: string | null, address: string | null, at: Date) => {
    const name = (company || '').trim()
    if (!name) return
    const key = name.toLowerCase()
    const cur = byName.get(key)
    if (!cur) {
      byName.set(key, { company: name, gst: gst || null, address: address || null, at: at.getTime() })
    } else {
      // keep the most recent non-empty GSTIN / address
      if (gst && (!cur.gst || at.getTime() > cur.at)) cur.gst = gst
      if (address && !cur.address) cur.address = address
      cur.at = Math.max(cur.at, at.getTime())
    }
  }
  for (const g of guests) add(g.company, g.gst, g.address, g.updatedAt)
  for (const b of bills) add(b.corporateName, b.gstNumber, null, b.createdAt)
  const list = [...byName.values()].sort((a, b) => b.at - a.at).slice(0, 50).map(({ at: _at, ...rest }) => rest)
  return NextResponse.json(list)
}

// ============ BOOKINGS ============
async function listBookings(req: NextRequest) {
  await refreshOperationalState()
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const paymentStatus = searchParams.get('paymentStatus')
  const roomId = searchParams.get('roomId')
  const guestId = searchParams.get('guestId')
  const from = searchParams.get('from')
  const to = searchParams.get('to')


  const bookings = await prisma.booking.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(roomId ? { roomId } : {}),
      ...(guestId ? { guestId } : {}),
      ...(from || to
        ? {
          createdAt: {
            ...(from ? { gte: new Date(from + 'T00:00:00') } : {}),
            ...(to ? { lte: new Date(to + 'T23:59:59.999') } : {}),
          },
        }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: {
      room: true,
      guest: true,
      foodOrders: { where: { status: 'PENDING' }, include: { items: true } },
      bills: { orderBy: { createdAt: 'desc' }, take: 1 },
      extensions: { orderBy: { createdAt: 'desc' } },
    },
  })
  return NextResponse.json(bookings)
}

async function createBooking(body: Record<string, unknown>, user: RequestUser) {
  const {
    roomId, phone, name, company, gst, address, idProof, checkIn, checkOut, checkOutTime,
    guestCount, advance, advanceMethod, isCorporate, notes, bookingType, status: reqStatus,
  } = body
  if (!roomId || !phone || !name) {
    return NextResponse.json({ error: 'Room, phone and name are required' }, { status: 400 })
  }
  const cleanPhone = String(phone).replace(/\D/g, '')
  if (cleanPhone.length !== 10) {
    return NextResponse.json(
      { error: 'Invalid phone number. A valid 10-digit mobile number is required.' },
      { status: 400 }
    )
  }
  const parsedGuestCount = parseInt(String(guestCount)) || 1
  const room = await prisma.room.findUnique({ where: { id: String(roomId) } })
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })
  const maxGuests = maxGuestsFor(room.capacity)
  if (parsedGuestCount < 1 || parsedGuestCount > maxGuests) {
    return NextResponse.json(
      { error: `Maximum ${maxGuests} guests allowed in Room ${room.number} (must be between 1 and ${maxGuests})` },
      { status: 400 }
    )
  }

  const settings = await getSettingsMap()
  const defCheckoutTime = settings.checkoutTime || '08:00'

  let checkInDate: Date | null = null
  if (checkIn) {
    const s = String(checkIn).trim()
    if (hasExplicitZone(s)) {
      // Walk-in check-ins send the exact instant (toISOString); reading its UTC clock as IST shifted it by 5.5h
      checkInDate = new Date(s)
    } else if (s.includes('T')) {
      const [d, t] = s.split('T')
      checkInDate = makeIST(d, t.replace('Z', '').slice(0, 8))
    } else {
      checkInDate = makeIST(s, '12:00')
    }
  } else {
    checkInDate = makeIST(istDateStr(new Date()), '12:00')
  }

  if (!checkInDate || isNaN(checkInDate.getTime())) {
    return NextResponse.json(
      { error: 'Invalid check-in date. Please pick the date again and retry.' },
      { status: 400 }
    )
  }

  const todayStrIST = istDateStr(new Date())
  const checkInDateStrIST = istDateStr(checkInDate)
  const isFuture = checkInDateStrIST > todayStrIST
  const isAdvanceBooking = bookingType === 'BOOKING' || reqStatus === 'BOOKED' || isFuture

  let outstandingApprovedBy: string | null = null
  let outstandingAmount = 0
  if (!isAdvanceBooking) {
    const existingGuest = await prisma.guest.findUnique({ where: { phone: cleanPhone } })
    if (existingGuest) {
      const due = await guestOutstanding(existingGuest.id)
      if (due.total > 0.01) {
        const admin = await verifyAdminPin(body.adminPin)
        if (!admin) {
          return NextResponse.json(
            {
              error: `${existingGuest.name} has ₹${due.total.toFixed(2)} outstanding from earlier stay(s). Admin PIN is required to check in.`,
              code: body.adminPin ? 'INVALID_ADMIN_PIN' : 'OUTSTANDING_PIN_REQUIRED',
              outstanding: due.total,
            },
            { status: 403 }
          )
        }
        outstandingApprovedBy = admin.name
        outstandingAmount = due.total
      }
    }
  }

  if (!isAdvanceBooking) {
    const inHouse = await prisma.booking.findFirst({
      where: { roomId: room.id, status: 'ACTIVE' },
      include: { guest: true },
    })
    if (inHouse || room.status === 'OCCUPIED') {
      return NextResponse.json(
        { error: `Room ${room.number} is currently occupied${inHouse ? ` by ${inHouse.guest.name}` : ''}` },
        { status: 400 }
      )
    }
  }
  if (room.status === 'MAINTENANCE') {
    return NextResponse.json({ error: `Room ${room.number} is under maintenance` }, { status: 400 })
  }

  let checkOutDate: Date | null = null
  if (checkOut) {
    const s = String(checkOut).trim()
    const targetTime = checkOutTime ? String(checkOutTime) : defCheckoutTime
    if (s.includes('T')) {
      const [d, t] = s.split('T')
      checkOutDate = makeIST(d, checkOutTime ? targetTime : t.replace('Z', '').slice(0, 8))
    } else {
      checkOutDate = makeIST(s, targetTime)
    }
  }

  if (checkOut && (!checkOutDate || isNaN(checkOutDate.getTime()))) {
    return NextResponse.json(
      { error: 'Invalid check-out date. Please pick the date again and retry.' },
      { status: 400 }
    )
  }

  let days = 1
  if (checkOutDate) {
    days = calcNights(checkInDate, checkOutDate)
  }

  // Double-booking prevention using date-only boundary logic for all bookings
  const existingBookings = await prisma.booking.findMany({
    where: {
      roomId: String(roomId),
      status: { in: ['ACTIVE', 'BOOKED'] },
    },
    include: { guest: true },
  })
  const overlapping = existingBookings.find((b) =>
    doDateRangesOverlap(checkInDate, checkOutDate, b.checkIn, b.checkOut)
  )
  if (overlapping) {
    const fromStr = formatDate(overlapping.checkIn)
    const toStr = overlapping.checkOut ? formatDate(overlapping.checkOut) : 'open'
    return NextResponse.json(
      {
        error: `Room ${room.number} is already reserved for ${overlapping.guest.name} from ${fromStr} to ${toStr}. Room is available before ${fromStr} or after ${toStr}.`,
      },
      { status: 400 }
    )
  }

  const adv = num(advance)
  const method = advanceMethod ? String(advanceMethod) : 'CASH'

  const booking = await prisma.$transaction(async (tx) => {
    const guest = await tx.guest.upsert({
      where: { phone: cleanPhone },
      update: {
        name: String(name),
        ...(company !== undefined && { company: String(company) }),
        ...(gst !== undefined && { gst: String(gst) }),
        ...(address !== undefined && { address: String(address) }),
        ...(idProof !== undefined && { idProof: String(idProof) }),
      },
      create: {
        phone: cleanPhone,
        name: String(name),
        ...(company ? { company: String(company) } : {}),
        ...(gst ? { gst: String(gst) } : {}),
        ...(address ? { address: String(address) } : {}),
        ...(idProof ? { idProof: String(idProof) } : {}),
      },
    })

    const newBooking = await tx.booking.create({
      data: {
        roomId: String(roomId),
        guestId: guest.id,
        checkIn: checkInDate!,
        checkOut: checkOutDate,
        originalCheckOut: checkOutDate,
        autoExtendedDays: 0,
        days,
        guestCount: parsedGuestCount,
        ratePerDay: room.rate,
        status: isAdvanceBooking ? 'BOOKED' : 'ACTIVE',
        // Nothing paid = UNPAID; an advance = PARTIAL; advance covering the stay = PAID
        paymentStatus: bookingPaymentStatus({ advance: adv, ratePerDay: room.rate, days }),
        advance: adv,
        isCorporate: !!isCorporate,
        notes: notes ? String(notes) : null,
      },
      include: { room: true, guest: true },
    })

    // Derive OCCUPIED / BOOKED / VACANT from bookings (an advance booking for today on an
    // occupied room must not flip it to BOOKED while the current guest is still in-house)
    await syncRoomStatus(tx, String(roomId))

    if (adv > 0) {
      await tx.ledgerEntry.create({
        data: {
          date: new Date(),
          type: 'INCOME',
          category: 'ADVANCE',
          description: `Advance from ${name} (Room ${room.number})`,
          amount: adv,
          method,
          source: 'AUTO',
          refId: newBooking.id,
        },
      })
    }

    return newBooking
  })

  if (outstandingApprovedBy) {
    await logAudit(
      'OUTSTANDING_CHECKIN_APPROVED',
      'Booking',
      booking.id,
      `${name} checked in with ₹${outstandingAmount.toFixed(2)} outstanding (Room ${room.number}). Approved by Admin ${outstandingApprovedBy}. Dues will be added to the next bill.`,
      { name: outstandingApprovedBy, role: 'ADMIN' }
    )
  }
  await logAudit(
    'BOOKING_CREATE',
    'Booking',
    booking.id,
    `${isAdvanceBooking ? 'Advance booking' : 'Check-in'}: ${name} → Room ${room.number}, ${days} night(s) @ ₹${room.rate}${adv > 0 ? `, advance ₹${adv}` : ''}`,
    user
  )
  return NextResponse.json(booking)
}

async function updateBooking(body: Record<string, unknown>, user: RequestUser) {
  await applyAutoExtensions()
  const { id, action, checkOut, newRoomId } = body
  const booking = await prisma.booking.findUnique({ where: { id: String(id) }, include: { room: true, guest: true } })
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  if (action === 'checkin') {
    if (booking.status !== 'BOOKED') {
      return NextResponse.json({ error: 'Only booked reservations can be checked in' }, { status: 400 })
    }
    const due = await guestOutstanding(booking.guestId)
    if (due.total > 0.01) {
      const admin = await verifyAdminPin(body.adminPin)
      if (!admin) {
        return NextResponse.json(
          {
            error: `${booking.guest.name} has ₹${due.total.toFixed(2)} outstanding from earlier stay(s). Admin PIN is required to check in.`,
            code: body.adminPin ? 'INVALID_ADMIN_PIN' : 'OUTSTANDING_PIN_REQUIRED',
            outstanding: due.total,
          },
          { status: 403 }
        )
      }
      await logAudit(
        'OUTSTANDING_CHECKIN_APPROVED',
        'Booking',
        booking.id,
        `${booking.guest.name} checked in with ₹${due.total.toFixed(2)} outstanding (Room ${booking.room.number}). Approved by Admin ${admin.name}. Dues will be added to the next bill.`,
        { name: admin.name, role: 'ADMIN' }
      )
    }
    if (booking.room.status === 'MAINTENANCE') {
      return NextResponse.json({ error: `Room ${booking.room.number} is under maintenance` }, { status: 400 })
    }
    const inHouse = await prisma.booking.findFirst({
      where: { roomId: booking.roomId, status: 'ACTIVE', id: { not: booking.id } },
      include: { guest: true },
    })
    if (inHouse) {
      return NextResponse.json(
        { error: `Room ${booking.room.number} is still occupied by ${inHouse.guest.name}. Check them out first.` },
        { status: 400 }
      )
    }

    // Early arrival: the stay (and the nights billed) starts now, not on the reserved date
    const now = new Date()
    const isEarly = istDateStr(booking.checkIn) > istDateStr(now)
    const stayData: { checkIn?: Date; days?: number } = {}
    if (isEarly) {
      const others = await prisma.booking.findMany({
        where: { roomId: booking.roomId, status: 'BOOKED', id: { not: booking.id } },
        include: { guest: true },
      })
      const clash = others.find((b) => doDateRangesOverlap(now, booking.checkOut, b.checkIn, b.checkOut))
      if (clash) {
        return NextResponse.json(
          { error: `Early check-in not possible: Room ${booking.room.number} is reserved for ${clash.guest.name} from ${formatDate(clash.checkIn)}.` },
          { status: 400 }
        )
      }
      stayData.checkIn = now
      if (booking.checkOut) stayData.days = calcNights(now, booking.checkOut)
    }

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id: String(id) },
        data: { status: 'ACTIVE', ...stayData },
      })
      await syncRoomStatus(tx, booking.roomId)
      return b
    })
    await logAudit('CHECKIN', 'Booking', booking.id, `Checked in: ${booking.guest.name} → Room ${booking.room.number}`, user)
    return NextResponse.json(updated)
  }

  if (action === 'checkout') {
    if (booking.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Only in-house (active) stays can be checked out' }, { status: 400 })
    }
    const pendingFood = await prisma.foodOrder.aggregate({
      where: { bookingId: String(id), status: 'PENDING' },
      _sum: { total: true },
    })
    if ((pendingFood._sum.total || 0) > 0) {
      return NextResponse.json(
        { error: 'Pending food orders exist. Add them to bill or mark paid first.' },
        { status: 400 }
      )
    }
    // Without a bill the stay's room rent never reaches the ledger, payments or reports
    const billCount = await prisma.bill.count({ where: { bookingId: booking.id } })
    if (billCount === 0) {
      return NextResponse.json(
        { error: 'Generate the lodging bill first (Lodging Checkout) — checking out without a bill would lose the room revenue.' },
        { status: 400 }
      )
    }
    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id: String(id) },
        data: { status: 'COMPLETED', actualCheckOut: new Date() },
      })
      await tx.room.update({ where: { id: booking.roomId }, data: { housekeeping: 'DIRTY' } })
      await syncRoomStatus(tx, booking.roomId)
      return b
    })
    await refreshBookingPaymentStatus(booking.id)
    await logAudit('CHECKOUT', 'Booking', booking.id, `Checked out: ${booking.guest.name} from Room ${booking.room.number}`, user)
    return NextResponse.json(updated)
  }

  if (action === 'extend') {
    const { adminPin, reason, checkOut: newCheckOutDateStr, checkOutTime, days: customDays } = body
    if (!adminPin) {
      return NextResponse.json({ error: 'Admin PIN is required to extend stay' }, { status: 403 })
    }
    if (!reason || !String(reason).trim()) {
      return NextResponse.json({ error: 'Reason for extension is required' }, { status: 400 })
    }
    const adminUser = await prisma.user.findFirst({
      where: {
        pin: String(adminPin),
        active: true,
        role: 'ADMIN',
      },
    })
    if (!adminUser) {
      return NextResponse.json({ error: 'Extension blocked: Invalid Admin PIN (ADMIN role required)' }, { status: 403 })
    }

    if (booking.status !== 'ACTIVE' && booking.status !== 'BOOKED') {
      return NextResponse.json({ error: 'Only ACTIVE or BOOKED stays can be extended' }, { status: 400 })
    }

    if (!newCheckOutDateStr) {
      return NextResponse.json({ error: 'Valid new checkout date required' }, { status: 400 })
    }

    const settings = await getSettingsMap()
    const targetTime = checkOutTime ? String(checkOutTime) : (settings.checkoutTime || '08:00')
    const newCheckOut = makeIST(String(newCheckOutDateStr), targetTime)
    if (isNaN(newCheckOut.getTime())) {
      return NextResponse.json({ error: 'Invalid check-out date or time' }, { status: 400 })
    }

    if (booking.checkOut && newCheckOut.getTime() <= new Date(booking.checkOut).getTime()) {
      return NextResponse.json({ error: 'New check-out date and time must be later than the current check-out' }, { status: 400 })
    }

    // Double-booking check when extending stay
    const existingBookings = await prisma.booking.findMany({
      where: {
        roomId: booking.roomId,
        id: { not: booking.id },
        status: { in: ['ACTIVE', 'BOOKED'] },
      },
      include: { guest: true },
    })

    const currCheckOut = booking.checkOut ? new Date(booking.checkOut) : new Date(booking.checkIn)
    const conflict = existingBookings.find((b) => {
      const otherCheckIn = new Date(b.checkIn)
      const otherCheckOut = b.checkOut ? new Date(b.checkOut) : null
      return otherCheckIn < newCheckOut && (!otherCheckOut || otherCheckOut > currCheckOut)
    })

    if (conflict) {
      return NextResponse.json(
        {
          error: `Room conflict: Room ${booking.room.number} is already reserved for ${conflict.guest.name} (${formatDate(conflict.checkIn)} to ${formatDate(conflict.checkOut)}).`,
        },
        { status: 409 }
      )
    }

    const oldCheckOut = booking.checkOut || booking.checkIn
    const oldDays = booking.days
    const targetDays = customDays !== undefined && Number(customDays) >= 1 ? Number(customDays) : calcNights(booking.checkIn, newCheckOut)

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id: String(id) },
        data: { checkOut: newCheckOut, days: targetDays },
        include: { room: true, guest: true },
      })
      await tx.bookingExtension.create({
        data: {
          bookingId: b.id,
          type: 'MANUAL',
          fromCheckOut: oldCheckOut,
          toCheckOut: newCheckOut,
          fromDays: oldDays,
          toDays: targetDays,
          reason: String(reason).trim(),
          createdBy: user.name || 'Staff',
          approvedBy: adminUser.name,
        },
      })
      return b
    })

    await logAudit(
      'EXTEND',
      'Booking',
      booking.id,
      `Stay manually extended for ${booking.guest.name} (Room ${booking.room.number}): checkout ${new Date(oldCheckOut).toISOString()} → ${newCheckOut.toISOString()}, days ${oldDays} → ${targetDays}. Reason: ${String(reason).trim()}`,
      { id: adminUser.id, name: adminUser.name, role: 'ADMIN' }
    )
    return NextResponse.json(updated)
  }

  if (action === 'change-room') {
    if (!newRoomId) return NextResponse.json({ error: 'New room required' }, { status: 400 })
    if (booking.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Only active bookings can change room' }, { status: 400 })
    }
    const newRoom = await prisma.room.findUnique({ where: { id: String(newRoomId) } })
    if (!newRoom) return NextResponse.json({ error: 'New room not found' }, { status: 404 })
    if (newRoom.id === booking.roomId) {
      return NextResponse.json({ error: 'Guest is already in this room' }, { status: 400 })
    }
    if (newRoom.status === 'MAINTENANCE') {
      return NextResponse.json({ error: `Room ${newRoom.number} is under maintenance` }, { status: 400 })
    }
    // The target room must be free for the rest of this stay, including reservations due later
    const targetBookings = await prisma.booking.findMany({
      where: { roomId: newRoom.id, status: { in: ['ACTIVE', 'BOOKED'] } },
      include: { guest: true },
    })
    const now = new Date()
    const clash = targetBookings.find(
      (b) => b.status === 'ACTIVE' || doDateRangesOverlap(now, booking.checkOut, b.checkIn, b.checkOut)
    )
    if (clash) {
      return NextResponse.json(
        {
          error:
            clash.status === 'ACTIVE'
              ? `Room ${newRoom.number} is occupied by ${clash.guest.name}`
              : `Room ${newRoom.number} is reserved for ${clash.guest.name} from ${formatDate(clash.checkIn)} to ${formatDate(clash.checkOut)}`,
        },
        { status: 400 }
      )
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.booking.update({ where: { id: booking.id }, data: { roomId: newRoom.id } })
      await tx.foodOrder.updateMany({
        where: { bookingId: booking.id, status: 'PENDING' },
        data: { roomId: newRoom.id },
      })
      await tx.room.update({ where: { id: booking.roomId }, data: { housekeeping: 'DIRTY' } })
      await syncRoomStatus(tx, booking.roomId)
      await syncRoomStatus(tx, newRoom.id)
      return tx.booking.findUnique({
        where: { id: String(id) },
        include: { room: true, guest: true },
      })
    })
    await logAudit('CHANGE_ROOM', 'Booking', booking.id, `Room change: ${booking.guest.name} moved ${booking.room.number} → ${newRoom.number}`, user)
    return NextResponse.json(updated)
  }

  if (action === 'cancel') {
    if (booking.status !== 'ACTIVE' && booking.status !== 'BOOKED') {
      return NextResponse.json({ error: `A ${booking.status.toLowerCase()} booking cannot be cancelled` }, { status: 400 })
    }
    if (booking.status === 'ACTIVE') {
      const pendingFood = await prisma.foodOrder.count({ where: { bookingId: booking.id, status: 'PENDING' } })
      if (pendingFood > 0) {
        return NextResponse.json(
          { error: 'Pending room-service orders exist for this stay. Settle them in Restaurant before cancelling.' },
          { status: 400 }
        )
      }
    }
    const cancelDate = new Date()
    const reasonStr = body.reason ? String(body.reason).trim() : 'Cancelled by staff'
    const refundNoteStr = body.refundNote ? String(body.refundNote).trim() : ''
    const refundAmt = body.refundAmount !== undefined && body.refundAmount !== '' ? Number(body.refundAmount) : null

    // Compose comprehensive cancellation record to store in notes
    const cancelTimestamp = cancelDate.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
    const cancelLog = `[CANCELLED on ${cancelTimestamp} by ${user.name || 'Staff'}${user.role ? ` (${user.role})` : ''} | Reason: ${reasonStr}${refundNoteStr ? ` | Refund/Advance: ${refundNoteStr}` : ''}${refundAmt !== null ? ` | Refund Amount: ₹${refundAmt}` : ''}${booking.advance > 0 ? ` | Advance Paid: ₹${booking.advance}` : ''}]`
    const updatedNotes = booking.notes ? `${booking.notes}\n${cancelLog}` : cancelLog

    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id: String(id) },
        data: {
          status: 'CANCELLED',
          actualCheckOut: cancelDate,
          notes: updatedNotes,
        },
        include: { room: true, guest: true, bills: true },
      })
      if (booking.status === 'ACTIVE') {
        await tx.room.update({ where: { id: booking.roomId }, data: { housekeeping: 'DIRTY' } })
      }
      // Cancelling a future reservation must not free a room another guest is staying in
      await syncRoomStatus(tx, booking.roomId)
      return b
    })
    await refreshBookingPaymentStatus(booking.id)
    await logAudit(
      'BOOKING_CANCEL',
      'Booking',
      booking.id,
      `Cancelled booking for ${booking.guest.name} (${booking.guest.phone}) in Room ${booking.room.number}. Advance: ₹${booking.advance}, Reserved: ${formatDate(booking.checkIn)} to ${formatDate(booking.checkOut)}. Reason: ${reasonStr}`,
      user
    )
    return NextResponse.json(updated)
  }

  if (action === 'add-payment') {
    // Part payment while the guest is staying: counts towards the final bill like an advance
    if (booking.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Part payments can only be taken while the guest is in-house' }, { status: 400 })
    }
    const amount = Math.round(num(body.amount) * 100) / 100
    if (amount <= 0) return NextResponse.json({ error: 'Enter a payment amount' }, { status: 400 })
    const payMethod = ['CASH', 'UPI', 'CARD'].includes(String(body.method)) ? String(body.method) : 'CASH'
    const updated = await prisma.$transaction(async (tx) => {
      await tx.ledgerEntry.create({
        data: {
          date: new Date(),
          type: 'INCOME',
          category: 'ADVANCE',
          description: `Part payment from ${booking.guest.name} (Room ${booking.room.number})`,
          amount,
          method: payMethod,
          source: 'AUTO',
          refId: booking.id,
        },
      })
      return tx.booking.update({
        where: { id: booking.id },
        data: { advance: { increment: amount } },
        include: { room: true, guest: true },
      })
    })
    await syncBillAdvance(booking.id)
    await logAudit(
      'PART_PAYMENT',
      'Booking',
      booking.id,
      `Part payment ₹${amount} via ${payMethod} from ${booking.guest.name} (Room ${booking.room.number}). Total paid during stay: ₹${updated.advance}`,
      user
    )
    return NextResponse.json(updated)
  }

  if (action === 'update') {
    const {
      name,
      phone,
      company,
      gst,
      address,
      idProof,
      ratePerDay,
      advance,
      advanceMethod,
      guestCount,
      notes,
      checkIn,
      checkOut,
      days,
      isCorporate,
    } = body

    // Guest profile changes are validated here but written only after every booking check passes
    const guestData: Record<string, string> = {}
    if (name) guestData.name = String(name).trim()
    if (phone) {
      const clean = String(phone).replace(/\D/g, '')
      if (clean && clean !== booking.guest.phone) {
        if (clean.length !== 10) {
          return NextResponse.json({ error: 'Invalid phone number. A valid 10-digit mobile number is required.' }, { status: 400 })
        }
        const owner = await prisma.guest.findUnique({ where: { phone: clean } })
        if (owner && owner.id !== booking.guestId) {
          return NextResponse.json(
            { error: `Phone ${clean} already belongs to guest ${owner.name}. Use that guest's profile instead.` },
            { status: 400 }
          )
        }
        guestData.phone = clean
      }
    }
    if (company !== undefined) guestData.company = String(company)
    if (gst !== undefined) guestData.gst = String(gst)
    if (address !== undefined) guestData.address = String(address)
    if (idProof !== undefined) guestData.idProof = String(idProof)

    if (advance !== undefined) {
      // A billed stay's advance is part of the invoice; it must not push received money past the bill total
      const latestBill = await prisma.bill.findFirst({ where: { bookingId: booking.id }, orderBy: { createdAt: 'desc' } })
      if (latestBill) {
        const nextApplied = Math.min(num(advance), latestBill.grandTotal)
        const received = nextApplied + latestBill.payCash + latestBill.payUpi + latestBill.payCard + (latestBill.carriedForward || 0)
        if (received > latestBill.grandTotal + 0.01) {
          return NextResponse.json(
            { error: `Advance too high: invoice ${latestBill.billNumber} would be overpaid (₹${received.toFixed(2)} received vs ₹${latestBill.grandTotal} total).` },
            { status: 400 }
          )
        }
      }
    }

    const updateData: Record<string, unknown> = {}
    if (ratePerDay !== undefined) updateData.ratePerDay = num(ratePerDay)
    if (advance !== undefined) updateData.advance = num(advance)
    if (guestCount !== undefined) {
      const parsedGuestCount = parseInt(String(guestCount)) || 1
      const maxGuests = maxGuestsFor(booking.room.capacity)
      if (parsedGuestCount < 1 || parsedGuestCount > maxGuests) {
        return NextResponse.json(
          { error: `Maximum ${maxGuests} guests allowed in Room ${booking.room.number} (must be between 1 and ${maxGuests})` },
          { status: 400 }
        )
      }
      updateData.guestCount = parsedGuestCount
    }
    if (notes !== undefined) updateData.notes = String(notes)
    if (isCorporate !== undefined) updateData.isCorporate = !!isCorporate

    if (checkIn !== undefined) {
      const parsedCheckIn = parseDateInput(checkIn, '12:00')
      if (parsedCheckIn) updateData.checkIn = parsedCheckIn
    }
    if (checkOut !== undefined) {
      const settings = await getSettingsMap()
      const parsedCheckOut = parseDateInput(checkOut, settings.checkoutTime || '08:00')
      if (parsedCheckOut) updateData.checkOut = parsedCheckOut
    }
    if (days !== undefined) {
      updateData.days = Math.max(1, parseInt(String(days)) || 1)
    } else if (updateData.checkIn || updateData.checkOut) {
      const finalIn = (updateData.checkIn as Date) || booking.checkIn
      const finalOut = (updateData.checkOut as Date) || booking.checkOut
      if (finalIn && finalOut) {
        updateData.days = calcNights(finalIn, finalOut)
      }
    }

    if (updateData.checkIn || updateData.checkOut) {
      const finalIn = (updateData.checkIn as Date) || booking.checkIn
      const finalOut = (updateData.checkOut as Date) || booking.checkOut
      const otherBookings = await prisma.booking.findMany({
        where: {
          roomId: booking.roomId,
          id: { not: booking.id },
          status: { in: ['ACTIVE', 'BOOKED'] },
        },
        include: { guest: true },
      })
      const conflict = otherBookings.find((b) =>
        doDateRangesOverlap(finalIn, finalOut, b.checkIn, b.checkOut)
      )
      if (conflict) {
        return NextResponse.json(
          {
            error: `Date conflict: Room is already reserved for ${conflict.guest.name} from ${formatDate(conflict.checkIn)} to ${formatDate(conflict.checkOut)}.`,
          },
          { status: 400 }
        )
      }
    }

    if (Object.keys(guestData).length > 0) {
      await prisma.guest.update({ where: { id: booking.guestId }, data: guestData })
    }

    const updated = await prisma.booking.update({
      where: { id: String(id) },
      data: updateData,
      include: { room: true, guest: true },
    })

    if (updateData.checkIn || updateData.checkOut) {
      // Moving a reservation onto/off today changes whether the room shows as BOOKED
      await syncRoomStatus(prisma, booking.roomId)
    }

    if (advance !== undefined) {
      // booking.advance = advance + part payments; it may be spread over several ledger rows.
      // Record only the difference so earlier payment rows (and their dates/methods) stay intact.
      const delta = Math.round((num(advance) - (booking.advance || 0)) * 100) / 100
      if (delta > 0.001) {
        await prisma.ledgerEntry.create({
          data: {
            date: new Date(),
            type: 'INCOME',
            category: 'ADVANCE',
            description: `Advance from ${name || booking.guest.name} (Room ${booking.room.number})`,
            amount: delta,
            method: advanceMethod ? String(advanceMethod) : 'CASH',
            source: 'AUTO',
            refId: booking.id,
          },
        })
      } else if (delta < -0.001) {
        let toRemove = -delta
        const rows = await prisma.ledgerEntry.findMany({
          where: { refId: booking.id, category: 'ADVANCE' },
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
      } else if (advanceMethod) {
        const latest = await prisma.ledgerEntry.findFirst({ where: { refId: booking.id, category: 'ADVANCE' }, orderBy: { date: 'desc' } })
        if (latest && latest.method !== String(advanceMethod)) {
          await prisma.ledgerEntry.update({ where: { id: latest.id }, data: { method: String(advanceMethod) } })
        }
      }
      await syncBillAdvance(booking.id)
    }

    await logAudit(
      'BOOKING_UPDATE',
      'Booking',
      booking.id,
      `Updated booking details/advance for Room ${booking.room.number} (${booking.guest.name})`,
      user
    )
    return NextResponse.json(updated)
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// ============ BILLS ============
async function listBills(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  let where: Record<string, unknown> = {}
  if (date) {
    const start = new Date(date + 'T00:00:00')
    const end = new Date(date + 'T23:59:59.999')
    where = { createdAt: { gte: start, lte: end } }
  } else if (from || to) {
    where = {
      createdAt: {
        ...(from ? { gte: new Date(from + 'T00:00:00') } : {}),
        ...(to ? { lte: new Date(to + 'T23:59:59.999') } : {}),
      },
    }
  }
  const bills = await prisma.bill.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: { booking: { include: { room: true, guest: true } } },
  })
  return NextResponse.json(bills)
}

async function createBill(body: Record<string, unknown>, user: RequestUser) {
  await applyAutoExtensions()
  const {
    bookingId, days, billedRoomTotal, roomDescription, roomNumber, extraCharges, discount,
    payCash, payUpi, payCard, includeFood, foodOrderIds, corporateName, gstNumber, notes, checkout,
    managerPin,
  } = body

  const booking = await prisma.booking.findUnique({
    where: { id: String(bookingId) },
    include: { room: true, guest: true },
  })
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  if (booking.status === 'CANCELLED') {
    return NextResponse.json({ error: 'Cannot bill a cancelled booking' }, { status: 400 })
  }
  if (booking.status === 'BOOKED') {
    return NextResponse.json({ error: 'Guest has not checked in yet. Check in first, then bill at checkout.' }, { status: 400 })
  }
  if (booking.status === 'COMPLETED') {
    const existing = await prisma.bill.findFirst({ where: { bookingId: booking.id }, orderBy: { createdAt: 'desc' } })
    if (existing) {
      return NextResponse.json(
        { error: `This stay is already billed (${existing.billNumber}). Edit that invoice instead of creating a duplicate.` },
        { status: 400 }
      )
    }
  }
  // With the fooding bill switched off, pending room-service orders would be left behind on a closed stay
  if (checkout !== false && includeFood === false) {
    const pendingCount = await prisma.foodOrder.count({ where: { bookingId: booking.id, status: 'PENDING' } })
    if (pendingCount > 0) {
      return NextResponse.json(
        { error: `${pendingCount} pending room-service order(s) exist. Turn on the Fooding Bill to settle them at checkout, or settle them in Restaurant first.` },
        { status: 400 }
      )
    }
  }

  const settings = await getSettingsMap()
  const billDays = parseInt(String(days)) || booking.days
  const actualRoomTotal = booking.ratePerDay * billDays
  const customRoom = parseFloat(String(billedRoomTotal))
  const billedRoom = !isNaN(customRoom) && customRoom > 0 ? customRoom : actualRoomTotal

  const realRoomType = booking.room.type || 'Non-AC'
  const cleanRoomDesc = roomDescription !== undefined && roomDescription !== null ? String(roomDescription).trim() : null
  const cleanRoomNumber = roomNumber !== undefined && roomNumber !== null && String(roomNumber).trim() !== '' ? String(roomNumber).trim() : null

  // Check if auto-extended overstay days are being reduced/waived
  const isWaivingOverstay = (booking.autoExtendedDays || 0) > 0 && billDays < booking.days

  // Permission control for custom corporate billing
  const isCustomRoomAmount = Math.abs(billedRoom - actualRoomTotal) > 0.01 || (billedRoomTotal !== undefined && parseFloat(String(billedRoomTotal)) > 0 && Math.abs(parseFloat(String(billedRoomTotal)) - actualRoomTotal) > 0.01)
  const isCustomDescription = cleanRoomDesc !== null && cleanRoomDesc !== '' && cleanRoomDesc !== realRoomType
  const isCustomRoomNumber = cleanRoomNumber !== null && cleanRoomNumber !== booking.room.number
  const isCustom = isCustomRoomAmount || isCustomDescription || isCustomRoomNumber

  let approverUser: RequestUser | null = null
  if (isCustom || isWaivingOverstay) {
    if (!managerPin) {
      return NextResponse.json(
        { error: isWaivingOverstay ? 'Waiving auto-extended overstay days requires Manager or Admin PIN approval' : 'Custom corporate billing requires Manager or Admin PIN approval' },
        { status: 403 }
      )
    }
    const approver = await prisma.user.findFirst({
      where: {
        pin: String(managerPin),
        active: true,
        role: { in: ['ADMIN', 'MANAGER'] },
      },
    })
    if (!approver) {
      return NextResponse.json(
        { error: isWaivingOverstay ? 'Overstay waiver blocked: Invalid Manager or Admin PIN' : 'Custom billing blocked: Invalid Manager or Admin PIN' },
        { status: 403 }
      )
    }
    approverUser = { id: approver.id, name: approver.name, role: approver.role }
    user = approverUser
  }

  const extra = num(extraCharges)
  const disc = num(discount)

  const gstRates = resolveLodgingGst(body, settings)
  if ('error' in gstRates) return NextResponse.json({ error: gstRates.error }, { status: 400 })
  const gstPct = gstRates.cgst + gstRates.sgst

  // Unpaid balance of the guest's earlier bills is added to this bill (no GST on it — it was taxed already)
  const outstanding = await guestOutstanding(booking.guestId, booking.id)
  const previousDue = outstanding.total
  const carriedFrom = outstanding.bills.map((b) => ({ id: b.id, billNumber: b.billNumber, amount: billBalance(b) }))

  // Determine food orders to include in bill
  let foodTotal = 0
  let foodTax = 0
  let foodOrderIdsToUpdate: string[] = []

  if (includeFood !== false) {
    const orders = await prisma.foodOrder.findMany({
      where: {
        OR: [
          { bookingId: booking.id },
          ...(Array.isArray(foodOrderIds) && foodOrderIds.length > 0
            ? [{ id: { in: foodOrderIds.map((id: any) => String(id)) } }]
            : []),
        ],
        status: { notIn: ['PAID', 'ADDED_TO_BILL', 'CANCELLED'] },
      },
    })
    const uniqueOrders = Array.from(new Map(orders.map((o) => [o.id, o])).values())
    foodOrderIdsToUpdate = uniqueOrders.map((o) => o.id)
    foodTotal = Math.round(uniqueOrders.reduce((sum, o) => sum + o.total, 0) * 100) / 100
    foodTax = Math.round(uniqueOrders.reduce((sum, o) => sum + (o.taxAmount || 0), 0) * 100) / 100
  }

  // Full lodging stay calculation (Room + Extra - Disc, with CGST and SGST computed separately)
  // Food is settled as separate restaurant dining revenue (with its own food GST) and not added to the lodging invoice
  const taxable = Math.max(0, billedRoom + extra - disc)
  const gstSplit = computeGst(taxable, gstRates.cgst, gstRates.sgst)
  const billedGst = gstSplit.total
  // Unpaid balance of earlier bills is added on top (already taxed, so no GST on it)
  const grandTotal = Math.max(0, Math.round((taxable + billedGst + previousDue) * 100) / 100)
  const advanceApplied = Math.min(booking.advance || 0, grandTotal)
  const lodgingPayable = Math.max(0, Math.round((grandTotal - advanceApplied) * 100) / 100)
  const totalPayableNow = Math.max(0, Math.round((lodgingPayable + foodTotal) * 100) / 100)

  // Hotel internal accounting calculation (lodging only)
  const internalTaxable = Math.max(0, actualRoomTotal + extra - disc)
  const internalGst = billedGst
  const internalTotal = Math.max(0, Math.round((internalTaxable + internalGst) * 100) / 100)

  const cash = num(payCash)
  const upi = num(payUpi)
  const card = num(payCard)
  const paidTotal = cash + upi + card
  if (paidTotal > totalPayableNow + 0.01) {
    return NextResponse.json(
      { error: `Payment split (₹${paidTotal}) cannot exceed payable amount (₹${totalPayableNow})` },
      { status: 400 }
    )
  }
  // Food orders are marked paid at checkout, so the food bill must be fully collected; lodging may stay due
  if (foodTotal > 0 && paidTotal < foodTotal - 0.01) {
    return NextResponse.json(
      { error: `Collect at least the food bill (₹${foodTotal.toFixed(2)}) at checkout. The lodging amount may be left as due.` },
      { status: 400 }
    )
  }

  // Distribute collected checkout payment between Food dining orders and Lodging bill
  const foodCollected = Math.min(foodTotal, paidTotal)
  let remFood = foodCollected
  const foodCash = Math.min(cash, remFood)
  remFood -= foodCash
  const foodUpi = Math.min(upi, remFood)
  remFood -= foodUpi
  const foodCard = Math.min(card, remFood)
  remFood -= foodCard

  const lodgingCash = Math.max(0, Math.round((cash - foodCash) * 100) / 100)
  const lodgingUpi = Math.max(0, Math.round((upi - foodUpi) * 100) / 100)
  const lodgingCard = Math.max(0, Math.round((card - foodCard) * 100) / 100)

  const bill = await prisma.$transaction(async (tx) => {
    // GST bills (tax invoices) and bills without GST (estimates) have separate number series
    const billNumber = await takeBillNumber(tx, billedGst > 0, settings)

    const createdBill = await tx.bill.create({
      data: {
        billNumber,
        bookingId: booking.id,
        days: billDays,
        actualRoomTotal,
        billedRoomTotal: billedRoom,
        roomNumber: cleanRoomNumber || null,
        roomDescription: cleanRoomDesc || null,
        gstPercent: gstPct,
        cgstPercent: gstRates.cgst,
        sgstPercent: gstRates.sgst,
        actualGst: billedGst,
        internalGst,
        internalTotal,
        foodTotal: 0, // Food is settled separately; not added to the lodging invoice total
        extraCharges: extra,
        discount: disc,
        grandTotal,
        payCash: lodgingCash,
        payUpi: lodgingUpi,
        payCard: lodgingCard,
        advanceApplied,
        previousDue,
        carriedFrom: carriedFrom.length ? JSON.stringify(carriedFrom) : null,
        isCorporate: isCustom || !!booking.isCorporate,
        corporateName: corporateName ? String(corporateName) : booking.guest.company || null,
        gstNumber: gstNumber ? String(gstNumber) : booking.guest.gst || null,
        createdBy: user.name || null,
        approvedBy: (isCustom || isWaivingOverstay) ? user.name || null : null,
        status: body.status === 'DRAFT' ? 'DRAFT' : 'FINAL',
        notes: notes ? String(notes) : null,
      },
    })
    // The lodging payment taken at checkout, dated today
    if (lodgingCash + lodgingUpi + lodgingCard > 0) {
      await tx.billPayment.create({
        data: {
          billId: createdBill.id,
          kind: 'CHECKOUT',
          cash: lodgingCash,
          upi: lodgingUpi,
          card: lodgingCard,
          amount: Math.round((lodgingCash + lodgingUpi + lodgingCard) * 100) / 100,
          createdBy: user.name || null,
        },
      })
    }

    if (foodTotal > 0 && foodOrderIdsToUpdate.length > 0) {
      await tx.foodOrder.updateMany({
        where: { id: { in: foodOrderIdsToUpdate } },
        data: { status: 'PAID' },
      })

      if (foodCollected > 0) {
        const foodMethod =
          foodCash > 0 && foodUpi === 0 && foodCard === 0
            ? 'CASH'
            : foodUpi > 0 && foodCash === 0 && foodCard === 0
              ? 'UPI'
              : foodCard > 0 && foodCash === 0 && foodUpi === 0
                ? 'CARD'
                : 'SPLIT'

        // Food GST (CGST + SGST on the food orders) is booked as GST, the rest as FOOD revenue
        const foodGstCollected = foodTotal > 0 ? Math.round(((foodTax * foodCollected) / foodTotal) * 100) / 100 : 0
        await tx.ledgerEntry.create({
          data: {
            date: new Date(),
            type: 'INCOME',
            category: 'FOOD',
            description: `Room Dining / Fooding bill settled at checkout - Room ${booking.room.number} - ${booking.guest.name}`,
            amount: Math.round((foodCollected - foodGstCollected) * 100) / 100,
            method: foodMethod,
            source: 'AUTO',
            refId: createdBill.id,
          },
        })
        if (foodGstCollected > 0) {
          await tx.ledgerEntry.create({
            data: {
              date: new Date(),
              type: 'INCOME',
              category: 'GST',
              description: `CGST + SGST on fooding bill - Room ${booking.room.number} - ${booking.guest.name}`,
              amount: foodGstCollected,
              method: foodMethod,
              source: 'AUTO',
              refId: createdBill.id,
            },
          })
        }
      }
    }

    await tx.auditLog.create({
      data: {
        action: body.status === 'DRAFT' ? 'BILL_DRAFT_CREATED' : 'BILL_FINALIZED',
        entity: 'Bill',
        entityId: createdBill.id,
        details: `Bill ${billNumber} (${body.status === 'DRAFT' ? 'Draft' : 'Final'}) created by ${user.name || 'Staff'}. Real Tariff: ₹${actualRoomTotal}, Billed Room: ₹${billedRoom}, Food Settled: ₹${foodCollected}, CGST: ${gstRates.cgst}% (₹${gstSplit.cgst}), SGST: ${gstRates.sgst}% (₹${gstSplit.sgst}),${previousDue > 0 ? ` Previous due: ₹${previousDue},` : ''} Lodging Total: ₹${grandTotal}, Room: ${cleanRoomNumber || booking.room.number}`,
        userName: user.name || 'Staff',
        userRole: user.role || 'RECEPTION',
      },
    })

    // Earlier bills' balances now live on this bill
    for (const c of carriedFrom) {
      await tx.bill.update({
        where: { id: c.id },
        data: { carriedForward: { increment: c.amount }, carriedToBillNumber: billNumber },
      })
    }
    // Remember the company / GSTIN on the guest profile so they autofill next time
    const companyName = corporateName ? String(corporateName).trim() : ''
    const gstin = gstNumber ? String(gstNumber).trim().toUpperCase() : ''
    if ((companyName && companyName !== booking.guest.company) || (gstin && gstin !== booking.guest.gst)) {
      await tx.guest.update({
        where: { id: booking.guestId },
        data: { ...(companyName ? { company: companyName } : {}), ...(gstin ? { gst: gstin } : {}) },
      })
    }

    if (isWaivingOverstay) {
      await tx.auditLog.create({
        data: {
          action: 'OVERSTAY_WAIVED',
          entity: 'Booking',
          entityId: booking.id,
          details: `Waived ${booking.days - billDays} auto-extended overstay day(s) for ${booking.guest.name} (Room ${booking.room.number}). Billed ${billDays} of ${booking.days} days. Approved by ${user.name || 'Manager'}.`,
          userName: user.name || 'Manager',
          userRole: user.role || 'MANAGER',
        },
      })
    }

    const ledgerEntries = buildBillLedgerEntries({
      billId: createdBill.id,
      billNumber,
      date: new Date(),
      roomNumber: booking.room.number,
      guestName: booking.guest.name,
      days: billDays,
      ratePerDay: booking.ratePerDay,
      actualRoomTotal,
      foodTotal: 0,
      extraCharges: extra,
      discount: disc,
      gstPercent: gstPct,
      cgstPercent: gstRates.cgst,
      sgstPercent: gstRates.sgst,
      internalGst,
    })
    if (ledgerEntries.length > 0) {
      await tx.ledgerEntry.createMany({ data: ledgerEntries })
    }

    if (checkout !== false) {
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: 'COMPLETED', actualCheckOut: new Date() },
      })
      await tx.room.update({ where: { id: booking.roomId }, data: { housekeeping: 'DIRTY' } })
      // A reservation due today on this room must show as BOOKED after checkout
      await syncRoomStatus(tx, booking.roomId)
    }

    return createdBill
  })

  await refreshBookingPaymentStatus(booking.id)
  const billNumber = bill.billNumber

  if (isCustom) {
    await logAudit(
      'CUSTOM_BILL',
      'Bill',
      bill.id,
      `Invoice ${billNumber}: customer billed ₹${billedRoom} vs actual tariff ₹${actualRoomTotal} (Room ${cleanRoomNumber || booking.room.number}${cleanRoomNumber && cleanRoomNumber !== booking.room.number ? ` [real: ${booking.room.number}]` : ''} [${realRoomType}${cleanRoomDesc && cleanRoomDesc !== realRoomType ? ` -> "${cleanRoomDesc}"` : ''}], ${booking.guest.name}). Internal ledger kept actual tariff.`,
      user
    )
  } else {
    await logAudit(
      'BILL_CREATE',
      'Bill',
      bill.id,
      `Invoice ${billNumber} generated for Room ${booking.room.number} (${booking.guest.name}) — total ₹${grandTotal}`,
      user
    )
  }

  return NextResponse.json({ ...bill, booking })
}

async function addBillPayment(body: Record<string, unknown>, user: RequestUser) {
  await applyAutoExtensions()
  const { id, payCash, payUpi, payCard } = body
  const bill = await prisma.bill.findUnique({
    where: { id: String(id) },
    include: { booking: { include: { guest: true, room: true } } },
  })
  if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })

  const cash = num(payCash)
  const upi = num(payUpi)
  const card = num(payCard)
  const adding = cash + upi + card
  if (adding <= 0) return NextResponse.json({ error: 'Payment amount required' }, { status: 400 })

  const outstanding = billBalance(bill)
  if (outstanding <= 0.01 && (bill.carriedForward || 0) > 0) {
    return NextResponse.json(
      { error: `This balance was moved to bill ${bill.carriedToBillNumber}. Collect the payment on that bill.` },
      { status: 400 }
    )
  }

  if (adding > outstanding + 0.01) {
    return NextResponse.json(
      { error: `Payment exceeds outstanding balance (₹${outstanding.toFixed(2)})` },
      { status: 400 }
    )
  }

  const updated = await prisma.$transaction(async (tx) => {
    const b = await tx.bill.update({
      where: { id: bill.id },
      data: {
        payCash: bill.payCash + cash,
        payUpi: bill.payUpi + upi,
        payCard: bill.payCard + card,
      },
    })
    // Recorded on the day it is received, so that day's collection and accounts include it
    await tx.billPayment.create({
      data: { billId: bill.id, kind: 'DUE', cash, upi, card, amount: Math.round(adding * 100) / 100, createdBy: user.name || null },
    })
    return b
  })
  await refreshBookingPaymentStatus(bill.bookingId)
  await logAudit(
    'PAYMENT',
    'Bill',
    bill.id,
    `Payment received on ${bill.billNumber}: ₹${adding} (${[cash > 0 ? `Cash ₹${cash}` : '', upi > 0 ? `UPI ₹${upi}` : '', card > 0 ? `Card ₹${card}` : ''].filter(Boolean).join(' + ')}) — ${bill.booking.guest.name}`,
    user
  )
  return NextResponse.json(updated)
}

type PaymentHistoryRow = {
  date: Date
  kind: 'ADVANCE' | 'PART_PAYMENT' | 'CHECKOUT' | 'DUE_COLLECTION'
  label: string
  cash: number
  upi: number
  card: number
  amount: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Every payment made against a lodging bill, oldest first:
 * advance and part payments during the stay (ledger), the payment taken at checkout
 * (bill totals less later collections) and dues collected later (audit trail of each payment).
 */
async function billPaymentHistory(billId: string) {
  const bill = await prisma.bill.findUnique({ where: { id: billId } })
  if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })

  const rows: PaymentHistoryRow[] = []
  const split = (method: string, amount: number) => ({
    cash: method === 'CASH' ? amount : 0,
    upi: method === 'UPI' ? amount : 0,
    card: method === 'CARD' ? amount : 0,
  })

  const stayPayments = await prisma.ledgerEntry.findMany({
    where: { refId: bill.bookingId, type: 'INCOME', category: 'ADVANCE' },
    orderBy: { date: 'asc' },
  })
  for (const e of stayPayments) {
    if (e.amount <= 0) continue
    const part = /^Part payment/i.test(e.description)
    rows.push({
      date: e.date,
      kind: part ? 'PART_PAYMENT' : 'ADVANCE',
      label: part ? 'Part payment (during stay)' : 'Advance',
      ...split(e.method, e.amount),
      amount: r2(e.amount),
    })
  }

  // Payments on the bill itself, each on the day it was received
  const paid = await prisma.billPayment.findMany({ where: { billId: bill.id }, orderBy: { date: 'asc' } })
  for (const p of paid) {
    if (Math.abs(p.amount) < 0.005) continue
    rows.push({
      date: p.date,
      kind: p.kind === 'CHECKOUT' ? 'CHECKOUT' : 'DUE_COLLECTION',
      label: p.kind === 'CHECKOUT' ? 'Paid at checkout' : p.kind === 'DUE' ? 'Due collected' : 'Payment corrected (bill edited)',
      cash: p.cash,
      upi: p.upi,
      card: p.card,
      amount: r2(p.amount),
    })
  }
  rows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const totalPaid = r2(rows.reduce((sum, row) => sum + row.amount, 0))
  return NextResponse.json({
    billId: bill.id,
    billNumber: bill.billNumber,
    payments: rows,
    totalPaid,
    received: r2(billReceived(bill)),
    balance: r2(billBalance(bill)),
  })
}

async function updateBill(body: Record<string, unknown>, user: RequestUser) {
  const {
    id, billedRoomTotal, roomDescription, roomNumber, gstPercent, cgstPercent, sgstPercent, extraCharges, discount,
    payCash, payUpi, payCard, corporateName, gstNumber, notes, roomId, managerPin,
  } = body

  if (!id) return NextResponse.json({ error: 'Bill ID is required' }, { status: 400 })

  const bill = await prisma.bill.findUnique({
    where: { id: String(id) },
    include: { booking: { include: { room: true, guest: true } } },
  })
  if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })

  // CGST / SGST (each 0 or 2.5); bills saved before the split keep their combined rate as two halves
  const currentHalf =
    Math.abs((bill.cgstPercent || 0) + (bill.sgstPercent || 0) - bill.gstPercent) < 0.001
      ? { cgst: bill.cgstPercent || 0, sgst: bill.sgstPercent || 0 }
      : { cgst: bill.gstPercent / 2, sgst: bill.gstPercent / 2 }
  const settingsForGst = await getSettingsMap()
  const gstRates = resolveLodgingGst(body, settingsForGst, currentHalf)
  if ('error' in gstRates) return NextResponse.json({ error: gstRates.error }, { status: 400 })
  const newGstPercent = gstRates.cgst + gstRates.sgst

  // Validate numeric fields
  let newBilledRoom = bill.billedRoomTotal
  if (billedRoomTotal !== undefined && billedRoomTotal !== null && billedRoomTotal !== '') {
    const parsedBilled = parseFloat(String(billedRoomTotal))
    if (isNaN(parsedBilled) || !isFinite(parsedBilled) || parsedBilled < 0) {
      return NextResponse.json({ error: 'Customer-facing billed room total must be a non-negative number' }, { status: 400 })
    }
    newBilledRoom = parsedBilled
  }

  const newRoomDescription = roomDescription !== undefined ? (roomDescription ? String(roomDescription).trim() : null) : bill.roomDescription
  const newRoomNumber = roomNumber !== undefined ? (roomNumber ? String(roomNumber).trim() : null) : bill.roomNumber

  const extra = extraCharges !== undefined ? Math.max(0, num(extraCharges)) : bill.extraCharges
  const disc = discount !== undefined ? Math.max(0, num(discount)) : bill.discount

  // Preserved original/internal room amount
  const actualRoomTotal = bill.actualRoomTotal
  const realRoomType = bill.booking.room.type || 'Non-AC'

  // Bill finalization status locking rule
  const isFinalized = bill.status === 'FINAL'
  const targetStatus = body.status === 'FINAL' || body.status === 'DRAFT' ? String(body.status) : bill.status
  const isFinancialChange =
    (billedRoomTotal !== undefined && num(billedRoomTotal) !== bill.billedRoomTotal) ||
    (roomDescription !== undefined && String(roomDescription).trim() !== (bill.roomDescription || '')) ||
    (roomNumber !== undefined && String(roomNumber).trim() !== (bill.roomNumber || bill.booking.room.number)) ||
    Math.abs(newGstPercent - bill.gstPercent) > 0.001 ||
    gstRates.cgst !== currentHalf.cgst ||
    (extraCharges !== undefined && num(extraCharges) !== bill.extraCharges) ||
    (discount !== undefined && num(discount) !== bill.discount) ||
    (payCash !== undefined && num(payCash) !== bill.payCash) ||
    (payUpi !== undefined && num(payUpi) !== bill.payUpi) ||
    (payCard !== undefined && num(payCard) !== bill.payCard) ||
    (roomId !== undefined && String(roomId) !== bill.booking.roomId)

  // Custom bill check
  const isCustomRoomAmount = Math.abs(newBilledRoom - actualRoomTotal) > 0.01
  const isCustomDescription = newRoomDescription !== null && newRoomDescription !== '' && newRoomDescription !== realRoomType
  const isCustomRoomNumber = newRoomNumber !== null && newRoomNumber !== '' && newRoomNumber !== bill.booking.room.number
  const isCustom = isCustomRoomAmount || isCustomDescription || isCustomRoomNumber

  if (isCustom) {
    if (!managerPin) {
      return NextResponse.json(
        { error: 'Custom corporate billing requires Manager or Admin PIN approval' },
        { status: 403 }
      )
    }
    const approver = await prisma.user.findFirst({
      where: { pin: String(managerPin), active: true, role: { in: ['ADMIN', 'MANAGER'] } },
    })
    if (!approver) {
      return NextResponse.json(
        { error: 'Modification blocked: Invalid Manager or Admin PIN' },
        { status: 403 }
      )
    }
    user = { id: approver.id, name: approver.name, role: approver.role }
  } else if (isFinalized && isFinancialChange) {
    if (!managerPin) {
      return NextResponse.json(
        { error: 'This bill is finalized and locked. Financial edits require Manager/Admin authorization PIN.' },
        { status: 403 }
      )
    }
    const approver = await prisma.user.findFirst({
      where: { pin: String(managerPin), active: true, role: { in: ['ADMIN', 'MANAGER'] } },
    })
    if (!approver) {
      return NextResponse.json(
        { error: 'Modification blocked: Invalid Manager/Admin authorization PIN' },
        { status: 403 }
      )
    }
    user = { id: approver.id, name: approver.name, role: approver.role }
  }

  // Taxable and CGST/SGST calculation based on the customer-facing amount; food (settled separately) is not taxed here
  const foodTotal = bill.foodTotal || 0
  const taxable = Math.max(0, newBilledRoom + extra - disc)
  const newGstSplit = computeGst(taxable, gstRates.cgst, gstRates.sgst)
  const newBilledGst = newGstSplit.total
  // previousDue (earlier bills' balance) stays part of the total; it is not taxed
  const newGrandTotal = Math.max(0, Math.round((taxable + newBilledGst + foodTotal + (bill.previousDue || 0)) * 100) / 100)
  const advanceApplied = Math.min(bill.booking.advance || 0, newGrandTotal)
  const payableNow = Math.max(0, Math.round((newGrandTotal - advanceApplied - (bill.carriedForward || 0)) * 100) / 100)

  // Internal accounting calculation
  const internalTaxable = Math.max(0, actualRoomTotal + extra - disc)
  // Internal total = actual tariff + the GST actually charged on the invoice + food bill
  const internalGst = newBilledGst
  const internalTotal = Math.max(0, Math.round((internalTaxable + internalGst + foodTotal) * 100) / 100)

  const cash = payCash !== undefined ? num(payCash) : bill.payCash
  const upi = payUpi !== undefined ? num(payUpi) : bill.payUpi
  const card = payCard !== undefined ? num(payCard) : bill.payCard
  const paidTotal = cash + upi + card

  if (paidTotal > payableNow + 0.01) {
    return NextResponse.json(
      { error: `Payment split (₹${paidTotal}) cannot exceed updated payable amount (₹${payableNow})` },
      { status: 400 }
    )
  }
  // Edited bills can have payment adjusted with or without an outstanding balance due

  // Switching GST on / off moves the bill to the other number series (tax invoice ↔ estimate)
  const seriesChanged = (bill.actualGst > 0) !== (newBilledGst > 0)
  const numberSettings = seriesChanged ? await getSettingsMap() : {}
  let renumberedTo: string | null = null

  const updatedBill = await prisma.$transaction(async (tx) => {
    if (seriesChanged) {
      renumberedTo = await takeBillNumber(tx, newBilledGst > 0, numberSettings)
      await tx.bill.updateMany({ where: { carriedToBillNumber: bill.billNumber }, data: { carriedToBillNumber: renumberedTo } })
    }
    // Optional room change for booking if requested
    if (roomId && String(roomId) !== bill.booking.roomId && (!isFinalized || managerPin)) {
      const targetRoom = await tx.room.findUnique({ where: { id: String(roomId) } })
      if (targetRoom) {
        await tx.booking.update({
          where: { id: bill.bookingId },
          data: { roomId: targetRoom.id },
        })
        await syncRoomStatus(tx, bill.booking.roomId)
        await syncRoomStatus(tx, targetRoom.id)
      }
    }

    const updated = await tx.bill.update({
      where: { id: bill.id },
      data: {
        billedRoomTotal: newBilledRoom,
        roomNumber: newRoomNumber,
        roomDescription: newRoomDescription,
        gstPercent: newGstPercent,
        cgstPercent: gstRates.cgst,
        sgstPercent: gstRates.sgst,
        actualGst: newBilledGst,
        internalGst,
        internalTotal,
        extraCharges: extra,
        discount: disc,
        grandTotal: newGrandTotal,
        ...(renumberedTo ? { billNumber: renumberedTo } : {}),
        payCash: cash,
        payUpi: upi,
        payCard: card,
        advanceApplied,
        isCorporate: isCustom || bill.isCorporate,
        corporateName: corporateName !== undefined ? (corporateName ? String(corporateName) : null) : bill.corporateName,
        gstNumber: gstNumber !== undefined ? (gstNumber ? String(gstNumber) : null) : bill.gstNumber,
        status: targetStatus,
        approvedBy: isCustom ? (user.name || bill.approvedBy || null) : bill.approvedBy,
        notes: notes !== undefined ? (notes ? String(notes) : null) : bill.notes,
      },
    })
    // A changed payment split is recorded as a dated correction so the payment rows keep adding up
    const dCash = Math.round((cash - bill.payCash) * 100) / 100
    const dUpi = Math.round((upi - bill.payUpi) * 100) / 100
    const dCard = Math.round((card - bill.payCard) * 100) / 100
    if (dCash || dUpi || dCard) {
      await tx.billPayment.create({
        data: {
          billId: bill.id,
          kind: 'ADJUST',
          cash: dCash,
          upi: dUpi,
          card: dCard,
          amount: Math.round((dCash + dUpi + dCard) * 100) / 100,
          note: 'Bill edited',
          createdBy: user.name || null,
        },
      })
    }

    if (isFinalized && isFinancialChange) {
      await tx.auditLog.create({
        data: {
          action: 'ADMIN_BILL_CORRECTION',
          entity: 'Bill',
          entityId: bill.id,
          details: `Finalized bill ${bill.billNumber} modified by ${user.name || 'Admin'}. Old Total: ₹${bill.grandTotal}, New Total: ₹${newGrandTotal}, Billed Room: ₹${newBilledRoom}, CGST ${gstRates.cgst}% (₹${newGstSplit.cgst}) + SGST ${gstRates.sgst}% (₹${newGstSplit.sgst}), Room: ${newRoomNumber || bill.booking.room.number}`,
          userName: user.name || 'Admin',
          userRole: user.role || 'MANAGER',
        },
      })
    } else if (!isFinalized && targetStatus === 'FINAL') {
      await tx.auditLog.create({
        data: {
          action: 'BILL_FINALIZED',
          entity: 'Bill',
          entityId: bill.id,
          details: `Bill ${bill.billNumber} finalized by ${user.name || 'Staff'}. Total: ₹${newGrandTotal}, Billed Room: ₹${newBilledRoom}, CGST ${gstRates.cgst}% (₹${newGstSplit.cgst}) + SGST ${gstRates.sgst}% (₹${newGstSplit.sgst}), Room: ${newRoomNumber || bill.booking.room.number}`,
          userName: user.name || 'Staff',
          userRole: user.role || 'RECEPTION',
        },
      })
    }

    // Sync corresponding ledger entries
    await tx.ledgerEntry.deleteMany({
      where: { refId: bill.id },
    })

    const ledgerEntries = buildBillLedgerEntries({
      billId: bill.id,
      billNumber: bill.billNumber,
      date: bill.createdAt,
      roomNumber: bill.booking.room.number,
      guestName: bill.booking.guest.name,
      days: bill.days,
      ratePerDay: bill.booking.ratePerDay,
      actualRoomTotal,
      foodTotal: bill.foodTotal,
      extraCharges: extra,
      discount: disc,
      gstPercent: newGstPercent,
      cgstPercent: gstRates.cgst,
      sgstPercent: gstRates.sgst,
      internalGst,
    })
    if (ledgerEntries.length > 0) {
      await tx.ledgerEntry.createMany({ data: ledgerEntries })
    }

    return updated
  })

  await refreshBookingPaymentStatus(bill.bookingId)

  await logAudit(
    'BILL_UPDATE',
    'Bill',
    bill.id,
    `Updated bill ${bill.billNumber}: customer amount ₹${newBilledRoom} (actual ₹${actualRoomTotal}), CGST ${gstRates.cgst}% (₹${newGstSplit.cgst}) + SGST ${gstRates.sgst}% (₹${newGstSplit.sgst}), grand total ₹${newGrandTotal}`,
    user
  )

  const reloadedBill = await prisma.bill.findUnique({
    where: { id: bill.id },
    include: { booking: { include: { room: true, guest: true } } },
  })

  if (renumberedTo) {
    await logAudit(
      'BILL_RENUMBERED',
      'Bill',
      bill.id,
      `Bill ${bill.billNumber} is now ${renumberedTo}: GST ${newBilledGst > 0 ? 'added (tax invoice series)' : 'removed (estimate series)'}`,
      user
    )
  }
  return NextResponse.json(reloadedBill)
}

// ============ MENU ============
async function listMenu() {
  const items = await prisma.menuItem.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] })
  return NextResponse.json(items)
}

async function createMenuItem(body: Record<string, unknown>) {
  const { name, category, price } = body
  if (!name || !price) {
    return NextResponse.json({ error: 'Name and price required' }, { status: 400 })
  }
  const item = await prisma.menuItem.create({
    data: {
      name: String(name),
      category: category ? String(category) : 'Main Course',
      price: num(price),
    },
  })
  return NextResponse.json(item)
}

async function updateMenuItem(body: Record<string, unknown>) {
  const { id, name, category, price, available } = body
  if (!id) return NextResponse.json({ error: 'Item id required' }, { status: 400 })
  const item = await prisma.menuItem.update({
    where: { id: String(id) },
    data: {
      ...(name !== undefined && { name: String(name) }),
      ...(category !== undefined && { category: String(category) }),
      ...(price !== undefined && { price: num(price) }),
      ...(available !== undefined && { available: !!available }),
    },
  })
  return NextResponse.json(item)
}

async function deleteMenuItem(req: NextRequest, user: RequestUser) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const item = await prisma.menuItem.findUnique({ where: { id } })
  if (!item) return NextResponse.json({ error: 'Menu item not found' }, { status: 404 })
  await prisma.menuItem.delete({ where: { id } })
  await logAudit('DELETE_MENU_ITEM', 'MenuItem', id, `Deleted menu item ${item.name}`, user)
  return NextResponse.json({ success: true, message: `Menu item ${item.name} deleted` })
}

// ============ FOOD ORDERS ============
async function listOrders(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const orders = await prisma.foodOrder.findMany({
    where: {
      ...(status ? { status } : {}),
      ...(from || to
        ? {
          createdAt: {
            ...(from ? { gte: new Date(from + 'T00:00:00') } : {}),
            ...(to ? { lte: new Date(to + 'T23:59:59.999') } : {}),
          },
        }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 300,
    include: { items: true, room: true, booking: { include: { guest: true } } },
  })
  return NextResponse.json(orders)
}

async function createOrder(body: Record<string, unknown>, user: RequestUser) {
  const { bookingId, roomId, tableNo, items, notes } = body
  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'At least one item required' }, { status: 400 })
  }
  const subtotal = Math.round(
    items.reduce((s: number, it: { price: number; quantity: number }) => s + (it.price || 0) * (it.quantity || 1), 0) * 100
  ) / 100
  // Food bill GST (CGST + SGST) from Settings, with a per-order on/off. Applies to walk-in and
  // room-service orders alike: room food is settled as a separate fooding bill, not taxed on the room bill.
  const foodGst = foodGstDefaults(await getSettingsMap())
  const applyGst = body.gstEnabled !== undefined ? body.gstEnabled === true : foodGst.enabled
  const tax = applyGst ? computeGst(subtotal, foodGst.cgst, foodGst.sgst) : { cgst: 0, sgst: 0, total: 0 }
  const total = Math.round((subtotal + tax.total) * 100) / 100
  // Room-service orders hang off the in-house stay; the room is always the booking's current room
  let orderRoomId: string | null = roomId ? String(roomId) : null
  if (bookingId) {
    const stay = await prisma.booking.findUnique({ where: { id: String(bookingId) }, include: { room: true } })
    if (!stay) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    if (stay.status !== 'ACTIVE') {
      return NextResponse.json(
        { error: `Room ${stay.room.number} guest is not in-house (${stay.status.toLowerCase()}). Post this as a direct restaurant order.` },
        { status: 400 }
      )
    }
    orderRoomId = stay.roomId
  }
  const order = await prisma.foodOrder.create({
    data: {
      bookingId: bookingId ? String(bookingId) : null,
      roomId: orderRoomId,
      tableNo: tableNo ? String(tableNo) : null,
      subtotal,
      cgstPercent: applyGst ? foodGst.cgst : 0,
      sgstPercent: applyGst ? foodGst.sgst : 0,
      taxAmount: tax.total,
      total,
      createdBy: user.name || null,
      notes: notes ? String(notes) : null,
      items: {
        create: items.map((it: { menuItemId?: string; name: string; price: number; quantity: number }) => ({
          menuItemId: it.menuItemId || null,
          name: String(it.name),
          price: num(it.price),
          quantity: parseInt(String(it.quantity)) || 1,
        })),
      },
    },
    include: { items: true, room: true, booking: { include: { guest: true } } },
  })
  await logAudit(
    'ORDER',
    'FoodOrder',
    order.id,
    `Food order ${order.total > 0 ? `₹${total}` : ''} ${order.room ? `for Room ${order.room.number}` : order.tableNo ? `at Table ${order.tableNo}` : ''} (${items.length} item(s))`,
    user
  )
  return NextResponse.json(order)
}

async function updateOrder(body: Record<string, unknown>, user: RequestUser) {
  const { id, action, method } = body
  const order = await prisma.foodOrder.findUnique({ where: { id: String(id) }, include: { items: true, room: true } })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  if (action === 'paid') {
    if (order.status !== 'PENDING') {
      return NextResponse.json(
        { error: order.status === 'ADDED_TO_BILL' ? 'This order is already on the room bill' : `Order is already ${order.status.toLowerCase()}` },
        { status: 400 }
      )
    }
    const payMethod = method ? String(method) : 'CASH'
    // Food GST was fixed when the order was taken
    const subtotal = order.subtotal > 0 ? order.subtotal : order.total
    const taxAmount = order.taxAmount || 0
    const payable = order.total
    const updated = await prisma.$transaction(async (tx) => {
      const ord = await tx.foodOrder.update({
        where: { id: String(id) },
        data: { status: 'PAID', subtotal },
      })
      const desc = `Restaurant order${order.tableNo ? ` (Table ${order.tableNo})` : ''}${order.room ? ` - Room ${order.room.number}` : ''}`
      await tx.ledgerEntry.create({
        data: { date: new Date(), type: 'INCOME', category: 'FOOD', description: desc, amount: Math.round((payable - taxAmount) * 100) / 100, method: payMethod, source: 'AUTO', refId: order.id },
      })
      if (taxAmount > 0) {
        await tx.ledgerEntry.create({
          data: { date: new Date(), type: 'INCOME', category: 'GST', description: `CGST + SGST on food bill - ${desc}`, amount: taxAmount, method: payMethod, source: 'AUTO', refId: order.id },
        })
      }
      return ord
    })
    await logAudit('ORDER_PAID', 'FoodOrder', order.id, `Direct restaurant payment ₹${payable}${taxAmount > 0 ? ` (incl. CGST+SGST ₹${taxAmount})` : ''} via ${payMethod}`, user)
    return NextResponse.json(updated)
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// ============ STAFF ============
async function listStaff(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  return NextResponse.json(await listStaffMembers({ q: searchParams.get('q'), role: searchParams.get('role') }))
}

async function createStaff(body: Record<string, unknown>, user: RequestUser) {
  const staff = await createStaffMember(body)
  await logAudit(
    'STAFF_CREATE',
    'Staff',
    staff.id,
    `Added staff ${staff.name} (${staff.role}, ${staff.payType === 'DAILY' ? `₹${staff.dailyRate}/day` : `₹${staff.salary}/month`})`,
    user
  )
  return NextResponse.json(staff)
}

async function updateStaff(body: Record<string, unknown>, user: RequestUser) {
  const { staff, changes } = await updateStaffMember(body)
  if (changes.length) await logAudit('STAFF_UPDATE', 'Staff', staff.id, `Updated ${staff.name}: ${changes.join(', ')}`, user)
  return NextResponse.json(staff)
}

async function deleteStaff(req: NextRequest, user: RequestUser) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Staff id required' }, { status: 400 })

  const staffMember = await prisma.staff.findUnique({ where: { id } })
  if (!staffMember) return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })

  await prisma.staff.delete({ where: { id } })
  await logAudit('DELETE_STAFF', 'Staff', id, `Deleted staff member ${staffMember.name} (${staffMember.role})`, user)
  return NextResponse.json({ success: true, message: `Staff member ${staffMember.name} deleted successfully` })
}

async function deleteBooking(req: NextRequest, user: RequestUser) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Booking id required' }, { status: 400 })

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { room: true, guest: true },
  })

  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  if (booking.status === 'ACTIVE') {
    return NextResponse.json({ error: `Cannot delete active booking for Room ${booking.room.number}. Please checkout or cancel first.` }, { status: 400 })
  }
  const carried = await prisma.bill.findFirst({ where: { bookingId: id, carriedForward: { gt: 0.01 } } })
  if (carried) {
    return NextResponse.json(
      { error: `Bill ${carried.billNumber} of this booking was carried into bill ${carried.carriedToBillNumber}. Delete that bill first.` },
      { status: 400 }
    )
  }

  await prisma.$transaction(async (tx) => {
    // Remove the money trail of this booking too: advance, invoice rows and paid room-service orders
    const [bills, orders] = await Promise.all([
      tx.bill.findMany({ where: { bookingId: id }, select: { id: true, carriedFrom: true } }),
      tx.foodOrder.findMany({ where: { bookingId: id }, select: { id: true } }),
    ])
    for (const b of bills) await revertCarriedFrom(tx, b)
    const refIds = [id, ...bills.map((b) => b.id), ...orders.map((o) => o.id)]
    await tx.ledgerEntry.deleteMany({ where: { refId: { in: refIds } } })
    await tx.foodOrder.deleteMany({ where: { bookingId: id } })
    await tx.bill.deleteMany({ where: { bookingId: id } })
    await tx.booking.delete({ where: { id } })
    // A deleted reservation due today must release the room
    await syncRoomStatus(tx, booking.roomId)
  })

  await logAudit('DELETE_BOOKING', 'Booking', id, `Deleted booking record for Room ${booking.room.number} (${booking.guest.name})`, user)
  return NextResponse.json({ success: true, message: 'Booking deleted successfully' })
}

async function deleteBill(req: NextRequest, user: RequestUser) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Bill id required' }, { status: 400 })

  const bill = await prisma.bill.findUnique({
    where: { id },
    include: { booking: { include: { guest: true, room: true } } },
  })

  if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })
  if ((bill.carriedForward || 0) > 0.01) {
    return NextResponse.json(
      { error: `This bill's balance was moved into bill ${bill.carriedToBillNumber}. Delete that bill first.` },
      { status: 400 }
    )
  }

  await prisma.$transaction(async (tx) => {
    await revertCarriedFrom(tx, bill)
    // Room-service food settled together with this checkout bill (marked PAID, revenue booked on the
    // bill) goes back to pending, since its revenue row is deleted with the bill. Orders paid at the
    // restaurant counter have their own ledger row and stay paid.
    const settledFood = await tx.ledgerEntry.count({ where: { refId: bill.id, category: 'FOOD' } })
    await tx.ledgerEntry.deleteMany({ where: { refId: bill.id } })
    await tx.bill.delete({ where: { id: bill.id } })
    if (settledFood > 0) {
      const paidOrders = await tx.foodOrder.findMany({ where: { bookingId: bill.bookingId, status: 'PAID' }, select: { id: true } })
      const counterPaid = await tx.ledgerEntry.findMany({
        where: { refId: { in: paidOrders.map((o) => o.id) } },
        select: { refId: true },
      })
      const counterIds = new Set(counterPaid.map((r) => r.refId))
      const settledIds = paidOrders.map((o) => o.id).filter((oid) => !counterIds.has(oid))
      if (settledIds.length > 0) {
        await tx.foodOrder.updateMany({ where: { id: { in: settledIds } }, data: { status: 'PENDING' } })
      }
    }
    // Food merged into this invoice goes back to pending so it can be billed again.
    // Orders carry no bill id, so this is only safe when no other invoice of the stay holds food.
    if (bill.foodTotal > 0) {
      const otherFoodBills = await tx.bill.count({ where: { bookingId: bill.bookingId, foodTotal: { gt: 0 } } })
      if (otherFoodBills === 0) {
        await tx.foodOrder.updateMany({
          where: { bookingId: bill.bookingId, status: 'ADDED_TO_BILL' },
          data: { status: 'PENDING' },
        })
      }
    }
  })

  if (bill.bookingId) {
    await refreshBookingPaymentStatus(bill.bookingId)
  }

  await logAudit('DELETE_BILL', 'Bill', id, `Deleted bill ${bill.billNumber} for Room ${bill.booking?.room?.number || ''} (${bill.booking?.guest?.name || ''})`, user)
  return NextResponse.json({ success: true, message: `Bill ${bill.billNumber} deleted successfully` })
}

async function deleteFoodOrder(req: NextRequest, user: RequestUser) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Order id required' }, { status: 400 })

  const order = await prisma.foodOrder.findUnique({ where: { id } })
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (order.status === 'ADDED_TO_BILL') {
    return NextResponse.json(
      { error: 'This order is part of a room invoice. Edit or delete the invoice instead.' },
      { status: 400 }
    )
  }

  await prisma.$transaction(async (tx) => {
    // A paid order's income row must go with it
    await tx.ledgerEntry.deleteMany({ where: { refId: id } })
    await tx.foodOrder.delete({ where: { id } })
  })
  await logAudit('DELETE_ORDER', 'FoodOrder', id, `Deleted food order ₹${order.total}`, user)
  return NextResponse.json({ success: true, message: 'Food order deleted successfully' })
}

async function deleteStaffPayment(req: NextRequest, user: RequestUser) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Payment id required' }, { status: 400 })
  const payment = await removeStaffPayment(id)
  await logAudit('DELETE_STAFF_PAYMENT', 'StaffPayment', id, `Deleted staff payment ${payment.type} ₹${payment.amount} for ${payment.staff.name}`, user)
  return NextResponse.json({ success: true, message: 'Staff payment deleted successfully' })
}

// ============ STAFF PAYMENTS ============
async function listStaffPayments(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const staffId = searchParams.get('staffId')
  const type = searchParams.get('type')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const payments = await prisma.staffPayment.findMany({
    where: {
      ...(staffId ? { staffId } : {}),
      ...(type ? { type } : {}),
      ...(from || to
        ? {
          date: {
            ...(from ? { gte: new Date(from + 'T00:00:00') } : {}),
            ...(to ? { lte: new Date(to + 'T23:59:59.999') } : {}),
          },
        }
        : {}),
    },
    orderBy: { date: 'desc' },
    take: 500,
    include: { staff: true },
  })
  return NextResponse.json(payments)
}

async function createStaffPayment(body: Record<string, unknown>, user: RequestUser) {
  const { payment, staff, summaryBefore } = await recordStaffPayment(body)
  const rs = (n: number) => `₹${Math.round(n * 100) / 100}`
  const detail =
    payment.type === 'SALARY'
      ? `Salary ${staff.payType === 'DAILY' ? payment.period : periodLabel(payment.period)} to ${staff.name}: earned ${rs(payment.gross)}${payment.recovered > 0 ? ` − advance ${rs(payment.recovered)}` : ''}${payment.deduction > 0 ? ` − deduction ${rs(payment.deduction)}` : ''} = paid ${rs(payment.amount)} via ${payment.method}. Advance left ${rs(Math.max(0, summaryBefore.advanceOutstanding - payment.recovered))}`
      : payment.type === 'ADVANCE'
        ? `Advance ${rs(payment.amount)} to ${staff.name} via ${payment.method}. Advance outstanding now ${rs(summaryBefore.advanceOutstanding + payment.amount)}`
        : payment.type === 'ADVANCE_RETURN'
          ? `${staff.name} returned ${rs(payment.amount)} advance via ${payment.method}. Advance left ${rs(Math.max(0, summaryBefore.advanceOutstanding - payment.amount))}`
          : `${payment.type} ${rs(payment.amount)} for ${staff.name}`
  await logAudit('STAFF_PAYMENT', 'StaffPayment', payment.id, detail, user)
  return NextResponse.json(payment)
}

// ============ LEDGER ============
async function listLedger(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const type = searchParams.get('type')
  const category = searchParams.get('category')
  const q = searchParams.get('q')

  let where: Record<string, unknown> = {}
  if (date) {
    const start = new Date(date + 'T00:00:00')
    const end = new Date(date + 'T23:59:59.999')
    where = { date: { gte: start, lte: end } }
  } else if (from || to) {
    where = {
      date: {
        ...(from && { gte: new Date(from + 'T00:00:00') }),
        ...(to && { lte: new Date(to + 'T23:59:59.999') }),
      },
    }
  }
  if (type) where = { ...where, type }
  if (category) where = { ...where, category }
  if (q) {
    where = {
      ...where,
      OR: [
        { description: { contains: q, mode: 'insensitive' } },
        { vendor: { contains: q, mode: 'insensitive' } },
      ],
    }
  }

  const entries = await prisma.ledgerEntry.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 1000,
  })
  const billsWithBookings = await prisma.bill.findMany({ select: { bookingId: true } })
  const billedBookingIds = new Set(billsWithBookings.map((b) => b.bookingId))

  const totalIncome = entries
    .filter((e) => e.type === 'INCOME' && !(e.category === 'ADVANCE' && e.refId && billedBookingIds.has(e.refId)))
    .reduce((s, e) => s + e.amount, 0)
  const totalExpense = entries.filter((e) => e.type === 'EXPENSE').reduce((s, e) => s + e.amount, 0)
  return NextResponse.json({
    entries,
    totalIncome,
    totalExpense,
    net: totalIncome - totalExpense,
  })
}

async function createLedgerEntry(body: Record<string, unknown>, user: RequestUser) {
  const { type, category, description, amount, method, date, vendor } = body
  if (!type || !amount || !description) {
    return NextResponse.json({ error: 'Type, description and amount required' }, { status: 400 })
  }
  const entry = await prisma.ledgerEntry.create({
    data: {
      type: type === 'INCOME' ? 'INCOME' : 'EXPENSE',
      category: category ? String(category) : 'OTHER',
      description: String(description),
      amount: num(amount),
      method: method ? String(method) : 'CASH',
      vendor: vendor ? String(vendor) : null,
      source: 'MANUAL',
      date: (parseDateInput(date, '12:00') as Date) || new Date(),
    },
  })
  await logAudit(type === 'INCOME' ? 'LEDGER_INCOME' : 'EXPENSE', 'LedgerEntry', entry.id, `${type} ₹${amount} — ${description}`, user)
  return NextResponse.json(entry)
}

// AUTO ledger rows are copies of a source record. Editing them alone would make the
// ledger disagree with the bill / booking / staff screen, so changes go through the source.
type LedgerLink =
  | { kind: 'NONE' }
  | { kind: 'STAFF_PAYMENT'; id: string }
  | { kind: 'ROOM_ADVANCE'; bookingId: string }
  | { kind: 'BANQUET_ADVANCE'; bookingId: string }
  | { kind: 'LOCKED'; reason: string }

async function resolveLedgerLink(entry: { source: string; refId: string | null; category: string }): Promise<LedgerLink> {
  if (entry.source !== 'AUTO' || !entry.refId) return { kind: 'NONE' }
  const refId = entry.refId
  const staffPayment = await prisma.staffPayment.findUnique({ where: { id: refId }, include: { staff: true } })
  // Salary rows carry the advance recovery and paid work days; change them where that is kept
  if (staffPayment) {
    return { kind: 'LOCKED', reason: `This is a staff payment of ${staffPayment.staff.name}. Change or delete it from the Staff tab (payment history).` }
  }
  if (entry.category === 'ADVANCE') {
    const booking = await prisma.booking.findUnique({ where: { id: refId } })
    if (booking) return { kind: 'ROOM_ADVANCE', bookingId: refId }
    const banquet = await prisma.$queryRawUnsafe<{ id: string }[]>('SELECT "id" FROM "BanquetBooking" WHERE "id" = $1', refId)
    if (banquet.length > 0) return { kind: 'BANQUET_ADVANCE', bookingId: refId }
    return { kind: 'NONE' }
  }
  const stockEntry = await prisma.inventoryMovement.findUnique({ where: { id: refId }, include: { item: true } })
  if (stockEntry) {
    return { kind: 'LOCKED', reason: `This expense is the inventory purchase of ${stockEntry.item.name}. Change or delete it from the Inventory tab.` }
  }
  const bill = await prisma.bill.findUnique({ where: { id: refId } })
  if (bill) return { kind: 'LOCKED', reason: `This entry is generated from invoice ${bill.billNumber}. Edit or delete the invoice in Billing instead.` }
  const order = await prisma.foodOrder.findUnique({ where: { id: refId } })
  if (order) return { kind: 'LOCKED', reason: 'This entry is generated from a paid restaurant order. Delete the order instead.' }
  const banquetBill = await prisma.$queryRawUnsafe<{ billNumber: string }[]>('SELECT "billNumber" FROM "BanquetBill" WHERE "id" = $1', refId)
  if (banquetBill.length > 0) {
    return { kind: 'LOCKED', reason: `This entry is a payment on banquet invoice ${banquetBill[0].billNumber}. Manage it from the Banquet tab.` }
  }
  return { kind: 'NONE' }
}

/** Applies a change of `delta` rupees in a recorded advance back onto its booking */
async function applyAdvanceDelta(link: LedgerLink, delta: number) {
  if (link.kind === 'ROOM_ADVANCE') {
    const booking = await prisma.booking.findUnique({ where: { id: link.bookingId } })
    if (!booking) return
    await prisma.booking.update({
      where: { id: booking.id },
      data: { advance: Math.max(0, Math.round(((booking.advance || 0) + delta) * 100) / 100) },
    })
    await syncBillAdvance(booking.id)
  } else if (link.kind === 'BANQUET_ADVANCE') {
    await adjustBanquetAdvance(link.bookingId, delta)
  }
}

async function updateLedgerEntry(body: Record<string, unknown>, user: RequestUser) {
  const { id, category, description, amount, method, date, vendor } = body
  if (!id) return NextResponse.json({ error: 'Entry id required' }, { status: 400 })

  const existing = await prisma.ledgerEntry.findUnique({ where: { id: String(id) } })
  if (!existing) return NextResponse.json({ error: 'Ledger entry not found' }, { status: 404 })

  const link = await resolveLedgerLink(existing)
  if (link.kind === 'LOCKED') return NextResponse.json({ error: link.reason }, { status: 400 })
  if (link.kind === 'ROOM_ADVANCE' && amount !== undefined) {
    const bill = await prisma.bill.findFirst({ where: { bookingId: link.bookingId }, orderBy: { createdAt: 'desc' } })
    const booking = await prisma.booking.findUnique({ where: { id: link.bookingId } })
    if (bill && booking) {
      const nextAdvance = Math.max(0, (booking.advance || 0) + num(amount) - existing.amount)
      const received = Math.min(nextAdvance, bill.grandTotal) + bill.payCash + bill.payUpi + bill.payCard + (bill.carriedForward || 0)
      if (received > bill.grandTotal + 0.01) {
        return NextResponse.json({ error: `Advance too high: invoice ${bill.billNumber} would be overpaid.` }, { status: 400 })
      }
    }
  }

  const updated = await prisma.ledgerEntry.update({
    where: { id: String(id) },
    data: {
      ...(category !== undefined && { category: String(category) }),
      ...(description !== undefined && { description: String(description) }),
      ...(amount !== undefined && { amount: num(amount) }),
      ...(method !== undefined && { method: String(method) }),
      ...(vendor !== undefined && { vendor: vendor ? String(vendor) : null }),
      ...(date !== undefined && { date: (parseDateInput(date, '12:00') as Date) || existing.date }),
    },
  })
  if (link.kind === 'STAFF_PAYMENT') {
    await prisma.staffPayment.update({
      where: { id: link.id },
      data: { amount: updated.amount, method: updated.method, date: updated.date },
    })
  } else if (amount !== undefined) {
    await applyAdvanceDelta(link, updated.amount - existing.amount)
  }
  await logAudit('EXPENSE_UPDATE', 'LedgerEntry', updated.id, `Updated expense entry ₹${updated.amount} — ${updated.description}`, user)
  return NextResponse.json(updated)
}

async function deleteLedgerEntry(req: NextRequest, user: RequestUser) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Entry id required' }, { status: 400 })

  const existing = await prisma.ledgerEntry.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Ledger entry not found' }, { status: 404 })

  const link = await resolveLedgerLink(existing)
  if (link.kind === 'LOCKED') return NextResponse.json({ error: link.reason }, { status: 400 })

  await prisma.ledgerEntry.delete({ where: { id } })
  if (link.kind === 'STAFF_PAYMENT') {
    await prisma.staffPayment.delete({ where: { id: link.id } }).catch(() => {})
  } else {
    // Deleting a recorded advance must also take it off the booking and its invoice
    await applyAdvanceDelta(link, -existing.amount)
  }
  await logAudit('DELETE_EXPENSE', 'LedgerEntry', id, `Deleted expense entry ₹${existing.amount} — ${existing.description}`, user)
  return NextResponse.json({ success: true, message: 'Expense entry deleted successfully' })
}

// ============ STATS ============
async function getStats() {
  await refreshOperationalState()
  const settings = await getSettingsMap()
  const graceMinutes = parseInt(settings.overstayGraceMinutes || '0', 10) || 0
  const now = new Date()
  const startToday = makeIST(istDateStr(now), '00:00')
  const endToday = makeIST(istDateStr(now), '23:59:59')

  const [rooms, activeBookings, bookedFuture, todayBills, todayPaidOrders, todayLedger, pendingFood, allBills] = await Promise.all([
    prisma.room.findMany({ select: { status: true, housekeeping: true, rate: true } }),
    prisma.booking.findMany({
      where: { status: { in: ['ACTIVE', 'BOOKED'] } },
      include: { guest: true, room: true },
      orderBy: { checkIn: 'asc' },
    }),
    prisma.booking.count({ where: { status: 'BOOKED' } }),
    prisma.bill.findMany({
      where: { createdAt: { gte: startToday, lte: endToday } },
      select: {
        bookingId: true,
        grandTotal: true,
        internalTotal: true,
        actualGst: true,
        actualRoomTotal: true,
        foodTotal: true,
        extraCharges: true,
        discount: true,
        advanceApplied: true,
        payCash: true,
        payUpi: true,
        payCard: true,
        carriedForward: true,
      },
    }),
    prisma.foodOrder.findMany({
      where: { createdAt: { gte: startToday, lte: endToday }, status: 'PAID' },
      select: { total: true },
    }),
    prisma.ledgerEntry.findMany({
      where: { date: { gte: startToday, lte: endToday } },
      select: { type: true, category: true, amount: true, method: true, refId: true },
    }),
    prisma.foodOrder.aggregate({ where: { status: 'PENDING' }, _sum: { total: true } }),
    prisma.bill.findMany({
      select: {
        bookingId: true,
        grandTotal: true,
        advanceApplied: true,
        payCash: true,
        payUpi: true,
        payCard: true,
        carriedForward: true,
      },
    }),
  ])

  const vacant = rooms.filter((r) => r.status === 'VACANT').length
  const occupied = rooms.filter((r) => r.status === 'OCCUPIED').length
  const booked = rooms.filter((r) => r.status === 'BOOKED').length
  const maintenance = rooms.filter((r) => r.status === 'MAINTENANCE').length
  const dirtyRooms = rooms.filter((r) => r.housekeeping === 'DIRTY').length
  const todayDirectFoodRevenue = todayPaidOrders.reduce((s, o) => s + (o.total || 0), 0)
  const todayRevenue = Math.round((todayBills.reduce((s, b) => s + billInternal(b).total, 0) + todayDirectFoodRevenue) * 100) / 100

  const billedBookingIds = new Set(allBills.map((b) => b.bookingId))
  const income = todayLedger
    .filter((e) => e.type === 'INCOME' && !(e.category === 'ADVANCE' && e.refId && billedBookingIds.has(e.refId)))
    .reduce((s, e) => s + e.amount, 0)
  const expense = todayLedger.filter((e) => e.type === 'EXPENSE').reduce((s, e) => s + e.amount, 0)
  const potentialRevenue = rooms.filter((r) => r.status === 'OCCUPIED').reduce((s, r) => s + r.rate, 0)

  const arrivals = activeBookings.filter((b) => {
    const ci = new Date(b.checkIn)
    return ci >= startToday && ci <= endToday
  })
  const departures = activeBookings.filter((b) => {
    if (!b.checkOut) return false
    const co = new Date(b.checkOut)
    return co >= startToday && co <= endToday
  })

  const bookedReservations = activeBookings.filter((b) => b.status === 'BOOKED')
  const overstays = activeBookings
    .filter((b) => b.status === 'ACTIVE' && (b.autoExtendedDays || 0) > 0)
    .map((b) => {
      const conflict = bookedReservations.find(
        (r) => r.roomId === b.roomId && b.checkOut && new Date(r.checkIn) < new Date(b.checkOut)
      )
      return {
        id: b.id,
        guestName: b.guest.name,
        roomNumber: b.room.number,
        originalCheckOut: b.originalCheckOut || b.checkOut,
        checkOut: b.checkOut,
        autoExtendedDays: b.autoExtendedDays,
        nextAutoExtensionAt: nextAutoExtensionAt(b, graceMinutes),
        conflictWith: conflict ? `${conflict.guest.name} (${formatDate(conflict.checkIn)})` : null,
      }
    })

  const outstanding = allBills.reduce((s, b) => s + billBalance(b), 0)
  const lowStockItems = await inventoryLowStockCount()
  const todayBook = await getDayBook(startToday, endToday)

  return NextResponse.json({
    lowStockItems,
    totalRooms: rooms.length,
    vacant,
    occupied,
    booked,
    maintenance,
    dirtyRooms,
    occupancyPercent: rooms.length ? Math.round((occupied / rooms.length) * 100) : 0,
    activeGuests: activeBookings.filter((b) => b.status === 'ACTIVE').length,
    bookedFuture,
    overstays,
    activeBookings: activeBookings.map((b) => ({
      id: b.id,
      guestName: b.guest.name,
      guestPhone: b.guest.phone,
      roomNumber: b.room.number,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
      originalCheckOut: b.originalCheckOut,
      autoExtendedDays: b.autoExtendedDays,
      days: b.days,
      ratePerDay: b.ratePerDay,
      paymentStatus: b.paymentStatus,
    })),
    arrivals: arrivals.map((b) => ({
      id: b.id,
      guestName: b.guest.name,
      roomNumber: b.room.number,
      checkIn: b.checkIn,
      days: b.days,
    })),
    departures: departures.map((b) => ({
      id: b.id,
      guestName: b.guest.name,
      roomNumber: b.room.number,
      checkOut: b.checkOut,
      billOutstanding:
        todayBills
          .filter((bill) => bill.bookingId === b.id)
          .reduce((s, bill) => s + billBalance(bill), 0) || 0,
    })),
    todayRevenue,
    // Everything received today, on the day it was received (dues collected today included)
    todayCash: todayBook.totals.inCash + todayBook.totals.inOther,
    todayUpi: todayBook.totals.inUpi,
    todayCard: todayBook.totals.inCard + todayBook.totals.inBank,
    todayCollected: todayBook.totals.in,
    todayIncome: income,
    todayExpense: expense,
    todayNet: income - expense,
    outstanding,
    pendingFoodAmount: pendingFood._sum.total || 0,
    potentialRevenue,
  })
}

// ============ SETTINGS ============
async function getSettings() {
  const map = await getSettingsMap()
  return NextResponse.json(map)
}

async function updateSettings(body: Record<string, unknown>, user: RequestUser) {
  const updates = (body || {}) as Record<string, unknown>
  for (const k of ['lodgingCgst', 'lodgingSgst', 'foodCgst', 'foodSgst']) {
    if (updates[k] !== undefined && !isValidHalfRate(updates[k])) {
      return NextResponse.json({ error: 'CGST and SGST can each only be 0% or 2.5%' }, { status: 400 })
    }
  }
  for (const k of ['lodgingGstEnabled', 'foodGstEnabled']) {
    if (updates[k] !== undefined) updates[k] = String(updates[k]) === 'true' ? 'true' : 'false'
  }
  // Keep the legacy combined rate in step with the lodging CGST + SGST section
  if (updates.lodgingCgst !== undefined || updates.lodgingSgst !== undefined || updates.lodgingGstEnabled !== undefined) {
    const cur = await getSettingsMap()
    const merged = { ...cur, ...Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, String(v)])) }
    const d = lodgingGstDefaults(merged)
    updates.gstPercent = String(d.cgst + d.sgst)
  } else if (updates.gstPercent !== undefined && ![0, 2.5, 5].includes(Number(updates.gstPercent))) {
    return NextResponse.json({ error: 'GST is CGST + SGST: 0%, 2.5% or 5% in total' }, { status: 400 })
  }
  const updatedKeys: string[] = []
  for (const [key, value] of Object.entries(updates)) {
    if (typeof key === 'string' && key.trim() !== '' && value !== undefined && value !== null) {
      const cleanKey = key.trim()
      await prisma.setting.upsert({
        where: { key: cleanKey },
        update: { value: String(value) },
        create: { key: cleanKey, value: String(value) },
      })
      updatedKeys.push(cleanKey)
    }
  }
  await logAudit('SETTINGS', 'Setting', null, `Settings updated: ${updatedKeys.join(', ')}`, user)
  return NextResponse.json(await getSettingsMap())
}

// ============ USERS & AUTH ============
async function listUsers() {
  const users = await prisma.user.findMany({
    select: { id: true, name: true, role: true, active: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(users)
}

async function createUser(body: Record<string, unknown>, user: RequestUser) {
  const { name, role, pin } = body
  if (!name || !pin) return NextResponse.json({ error: 'Name and PIN required' }, { status: 400 })
  const exists = await prisma.user.findUnique({ where: { name: String(name) } })
  if (exists) return NextResponse.json({ error: 'User name already exists' }, { status: 400 })
  const created = await prisma.user.create({
    data: { name: String(name), role: role ? String(role) : 'RECEPTION', pin: String(pin) },
  })
  await logAudit('USER_CREATE', 'User', created.id, `App user created: ${created.name} (${created.role})`, user)
  return NextResponse.json({ id: created.id, name: created.name, role: created.role, active: created.active })
}

async function updateUser(body: Record<string, unknown>, user: RequestUser) {
  const { id, name, role, pin, active } = body
  if (!id) return NextResponse.json({ error: 'User id required' }, { status: 400 })
  const updated = await prisma.user.update({
    where: { id: String(id) },
    data: {
      ...(name !== undefined && { name: String(name) }),
      ...(role !== undefined && { role: String(role) }),
      ...(pin !== undefined && { pin: String(pin) }),
      ...(active !== undefined && { active: !!active }),
    },
  })
  await logAudit('USER_UPDATE', 'User', updated.id, `App user updated: ${updated.name} (${updated.role})`, user)
  return NextResponse.json({ id: updated.id, name: updated.name, role: updated.role, active: updated.active })
}

async function login(body: Record<string, unknown>) {
  const { userId, pin } = body
  if (!userId || !pin) return NextResponse.json({ error: 'User and PIN required' }, { status: 400 })
  const user = await prisma.user.findUnique({ where: { id: String(userId) } })
  if (!user || !user.active || user.pin !== String(pin)) {
    return NextResponse.json({ error: 'Invalid user or PIN' }, { status: 401 })
  }
  return NextResponse.json({ id: user.id, name: user.name, role: user.role })
}

async function verifyAdminAuth(
  req: NextRequest,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; error?: string; adminUser?: RequestUser }> {
  const pinHeader = req.headers.get('x-admin-pin') || req.headers.get('x-admin-password')
  const url = new URL(req.url)
  const pinParam = url.searchParams.get('adminPin') || url.searchParams.get('adminPassword')
  const pinBody = body?.adminPin ? String(body.adminPin) : (body?.adminPassword ? String(body.adminPassword) : undefined)
  const providedPin = (pinHeader || pinParam || pinBody || '').trim()

  if (!providedPin) {
    return {
      ok: false,
      error: 'Admin PIN / Password is required to perform deletion. Authorization required.',
    }
  }

  // 1. Check active ADMIN user in database
  const adminUser = await prisma.user.findFirst({
    where: {
      pin: providedPin,
      active: true,
      role: 'ADMIN',
    },
  })
  if (adminUser) {
    return { ok: true, adminUser: { id: adminUser.id, name: adminUser.name, role: 'ADMIN' } }
  }

  // 2. Check adminPin in Setting table
  const settingAdminPin = await prisma.setting.findUnique({ where: { key: 'adminPin' } })
  if (settingAdminPin?.value && settingAdminPin.value.trim() === providedPin) {
    return { ok: true, adminUser: { id: 'setting-admin', name: 'Master Admin', role: 'ADMIN' } }
  }

  // 3. Fallback if no active ADMIN user in DB yet and no setting set: allow default '0000'
  const countAdmins = await prisma.user.count({ where: { role: 'ADMIN', active: true } })
  if (countAdmins === 0 && providedPin === '0000') {
    return { ok: true, adminUser: { id: 'default-admin', name: 'Default Admin', role: 'ADMIN' } }
  }

  return {
    ok: false,
    error: 'Access Denied: Invalid Admin PIN or Password. Only administrators can authorize deletions.',
  }
}

async function deleteUser(req: NextRequest, user: RequestUser) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'User id required' }, { status: 400 })
  const target = await prisma.user.findUnique({ where: { id } })
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (target.role === 'ADMIN') {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN', active: true } })
    if (adminCount <= 1) {
      return NextResponse.json({ error: 'Cannot delete the only active Admin account.' }, { status: 400 })
    }
  }

  await prisma.user.delete({ where: { id } })
  await logAudit('USER_DELETE', 'User', id, `Deleted user ${target.name} (${target.role})`, user)
  return NextResponse.json({ success: true, message: `User ${target.name} deleted` })
}

// ============ AUDIT ============
async function listAudit(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  const q = searchParams.get('q')
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const logs = await prisma.auditLog.findMany({
    where: {
      ...(action ? { action } : {}),
      ...(q
        ? {
          OR: [
            { details: { contains: q, mode: 'insensitive' } },
            { userName: { contains: q, mode: 'insensitive' } },
          ],
        }
        : {}),
      ...(from || to
        ? {
          createdAt: {
            ...(from ? { gte: new Date(from + 'T00:00:00') } : {}),
            ...(to ? { lte: new Date(to + 'T23:59:59.999') } : {}),
          },
        }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })
  return NextResponse.json(logs)
}


// ============ EXPENSE CATEGORIES ============
async function listExpenseCategories() {
  const cats = await prisma.expenseCategory.findMany({ orderBy: { name: 'asc' } })
  return NextResponse.json(cats)
}

async function createExpenseCategory(body: Record<string, unknown>) {
  const { name } = body
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  const exists = await prisma.expenseCategory.findUnique({ where: { name: String(name) } })
  if (exists) return NextResponse.json({ error: 'Category already exists' }, { status: 400 })
  const cat = await prisma.expenseCategory.create({ data: { name: String(name) } })
  return NextResponse.json(cat)
}

async function updateExpenseCategory(body: Record<string, unknown>) {
  const { id, name, active } = body
  if (!id) return NextResponse.json({ error: 'Category id required' }, { status: 400 })
  const before = await prisma.expenseCategory.findUnique({ where: { id: String(id) } })
  if (!before) return NextResponse.json({ error: 'Category not found' }, { status: 404 })
  if (name !== undefined && String(name) !== before.name) {
    // Expenses store the category by name; keep them under the renamed category
    await prisma.ledgerEntry.updateMany({
      where: { type: 'EXPENSE', category: before.name },
      data: { category: String(name) },
    })
  }
  const cat = await prisma.expenseCategory.update({
    where: { id: String(id) },
    data: {
      ...(name !== undefined && { name: String(name) }),
      ...(active !== undefined && { active: !!active }),
    },
  })
  return NextResponse.json(cat)
}

async function deleteExpenseCategory(req: NextRequest, user: RequestUser) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const cat = await prisma.expenseCategory.findUnique({ where: { id } })
  if (!cat) return NextResponse.json({ error: 'Category not found' }, { status: 404 })
  try {
    await prisma.expenseCategory.delete({ where: { id } })
    await logAudit('DELETE_EXPENSE_CAT', 'ExpenseCategory', id, `Deleted expense category ${cat.name}`, user)
  } catch {
    return NextResponse.json({ error: 'Cannot delete (category may be in use)' }, { status: 400 })
  }
  return NextResponse.json({ success: true, message: `Category ${cat.name} deleted` })
}

// ============ GLOBAL SEARCH ============
const searchCache = new Map<string, { data: unknown; expires: number }>()

async function globalSearch(req: NextRequest) {
  await refreshOperationalState()
  const { searchParams } = new URL(req.url)
  const isIndex = searchParams.get('index') === '1'

  if (isIndex) {
    const cacheKey = '__INDEX__'
    const cached = searchCache.get(cacheKey)
    if (cached && cached.expires > Date.now()) {
      return NextResponse.json(cached.data)
    }

    const [guests, bookings, bills, rooms] = await Promise.all([
      prisma.guest.findMany({
        take: 100,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          phone: true,
          company: true,
          address: true,
          bookings: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: { id: true, room: { select: { number: true } }, status: true },
          },
        },
      }),
      prisma.booking.findMany({
        take: 100,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          paymentStatus: true,
          guest: { select: { name: true, phone: true } },
          room: { select: { number: true } },
        },
      }),
      prisma.bill.findMany({
        take: 100,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          billNumber: true,
          grandTotal: true,
          createdAt: true,
          booking: {
            select: {
              guest: { select: { name: true, phone: true } },
              room: { select: { number: true } },
            },
          },
        },
      }),
      prisma.room.findMany({
        orderBy: { number: 'asc' },
        select: {
          id: true,
          number: true,
          type: true,
          status: true,
        },
      }),
    ])

    const data = { guests, bookings, bills, rooms }
    searchCache.set(cacheKey, { data, expires: Date.now() + 20_000 })
    return NextResponse.json(data)
  }

  const q = (searchParams.get('q') || '').trim()
  if (!q) {
    return NextResponse.json({ guests: [], bookings: [], bills: [], rooms: [] })
  }

  const cacheKey = `Q:${q.toLowerCase()}`
  // Phone numbers match only from 5 digits typed, and from the start of the number
  const qDigits = q.replace(/\D/g, '')
  const phoneOk = /^[\d\s+-]+$/.test(q) && qDigits.length >= 5
  const phoneQ = qDigits.length > 10 && qDigits.startsWith('91') ? qDigits.slice(2) : qDigits
  const cached = searchCache.get(cacheKey)
  if (cached && cached.expires > Date.now()) {
    return NextResponse.json(cached.data)
  }

  const [guests, bookings, bills, rooms] = await Promise.all([
    prisma.guest.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          ...(phoneOk ? [{ phone: { startsWith: phoneQ } }] : []),
          { company: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 8,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        phone: true,
        company: true,
        bookings: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { id: true, room: { select: { number: true } }, status: true },
        },
      },
    }),
    prisma.booking.findMany({
      where: {
        OR: [
          { id: { startsWith: q, mode: 'insensitive' } },
          { guest: { name: { contains: q, mode: 'insensitive' } } },
          ...(phoneOk ? [{ guest: { phone: { startsWith: phoneQ } } }] : []),
          { room: { number: { contains: q } } },
        ],
      },
      take: 8,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        guest: { select: { name: true, phone: true } },
        room: { select: { number: true } },
      },
    }),
    prisma.bill.findMany({
      where: {
        OR: [
          { billNumber: { contains: q, mode: 'insensitive' } },
          { booking: { guest: { name: { contains: q, mode: 'insensitive' } } } },
          ...(phoneOk ? [{ booking: { guest: { phone: { startsWith: phoneQ } } } }] : []),
          { booking: { room: { number: { contains: q } } } },
        ],
      },
      take: 8,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        billNumber: true,
        grandTotal: true,
        createdAt: true,
        booking: {
          select: {
            guest: { select: { name: true, phone: true } },
            room: { select: { number: true } },
          },
        },
      },
    }),
    prisma.room.findMany({
      where: {
        OR: [
          { number: { contains: q, mode: 'insensitive' } },
          { type: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 8,
      orderBy: { number: 'asc' },
      select: {
        id: true,
        number: true,
        type: true,
        status: true,
      },
    }),
  ])

  const resultData = { guests, bookings, bills, rooms }
  searchCache.set(cacheKey, { data: resultData, expires: Date.now() + 30_000 })
  return NextResponse.json(resultData)
}

// ============ REPORTS ============
async function getReports(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const today = new Date()
  const defFrom = new Date(today.getFullYear(), today.getMonth(), 1)
  const fromStr = searchParams.get('from') || defFrom.toISOString().slice(0, 10)
  const toStr = searchParams.get('to') || today.toISOString().slice(0, 10)
  const startLocal = new Date(fromStr + 'T00:00:00')
  const startUtc = new Date(`${fromStr}T00:00:00.000Z`)
  const start = isNaN(startLocal.getTime()) ? startUtc : (startLocal < startUtc ? startLocal : startUtc)

  const endLocal = new Date(toStr + 'T23:59:59.999')
  const endUtc = new Date(`${toStr}T23:59:59.999Z`)
  const end = isNaN(endLocal.getTime()) ? endUtc : (endLocal > endUtc ? endLocal : endUtc)

  const [bills, orders, ledger, bookings, staffPays, rooms, activeBookings, outstandingBookings] = await Promise.all([
    prisma.bill.findMany({
      where: { createdAt: { gte: start, lte: end } },
      include: { booking: { include: { room: true, guest: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.foodOrder.findMany({
      where: { createdAt: { gte: start, lte: end }, status: { in: ['PAID', 'ADDED_TO_BILL'] } },
      include: { items: true, room: true },
    }),
    prisma.ledgerEntry.findMany({ where: { date: { gte: start, lte: end } } }),
    prisma.booking.findMany({
      where: { createdAt: { gte: start, lte: end } },
      include: { room: true, guest: true },
    }),
    prisma.staffPayment.findMany({
      where: { date: { gte: start, lte: end } },
      include: { staff: true },
    }),
    prisma.room.findMany({ select: { status: true, rate: true } }),
    prisma.booking.findMany({ where: { status: 'ACTIVE' }, include: { guest: true, room: true } }),
    prisma.bill.findMany({
      include: { booking: { include: { room: true, guest: true } } },
    }),
  ])

  const occupiedRooms = rooms.filter((r) => r.status === 'OCCUPIED').length
  const daysDiff = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)))
  const roomNights = bills.reduce((s, b) => s + b.days, 0)

  const outstandingRows = outstandingBookings
    .map((b) => {
      const paid = billReceived(b)
      const balance = billBalance(b)
      return {
        id: b.id,
        billNumber: b.billNumber,
        bookingId: b.bookingId,
        guestName: b.booking.guest.name,
        phone: b.booking.guest.phone,
        roomNumber: b.roomNumber || b.booking.room.number,
        grandTotal: b.grandTotal,
        paid,
        balance,
        createdAt: b.createdAt,
      }
    })
    .filter((r) => r.balance > 0.01)
    .sort((a, b) => b.balance - a.balance)

  // Day-wise collections (IST calendar day) so the Reports page can filter collections by a single day
  type DayCollection = { date: string; cash: number; upi: number; card: number; bills: number; directFood: number; advances: number; total: number }
  const daily = new Map<string, DayCollection>()
  const dayRow = (d: Date) => {
    const key = istDateStr(d)
    let row = daily.get(key)
    if (!row) {
      row = { date: key, cash: 0, upi: 0, card: 0, bills: 0, directFood: 0, advances: 0, total: 0 }
      daily.set(key, row)
    }
    return row
  }
  // Room bill payments on the day they were received (a due collected later counts on that day)
  const billPays = await prisma.billPayment.findMany({ where: { date: { gte: start, lte: end } } })
  for (const p of billPays) {
    const row = dayRow(p.date)
    row.cash += p.cash
    row.upi += p.upi
    row.card += p.card
    row.bills += p.amount
  }
  for (const e of ledger) {
    if (e.type !== 'INCOME' || e.category !== 'ADVANCE') continue
    const row = dayRow(e.date)
    if (e.method === 'CASH') row.cash += e.amount
    else if (e.method === 'UPI') row.upi += e.amount
    else if (e.method === 'CARD') row.card += e.amount
    else row.cash += e.amount
    row.advances += e.amount
  }
  const orderMethod = new Map<string, string>()
  for (const e of ledger) {
    if (e.category === 'FOOD' && e.refId) {
      orderMethod.set(e.refId, e.method)
    }
  }
  for (const o of orders) {
    if (o.status !== 'PAID') continue
    const row = dayRow(o.createdAt)
    row.directFood += o.total
    const m = (orderMethod.get(o.id) || 'CASH').toUpperCase()
    if (m === 'UPI') row.upi += o.total
    else if (m === 'CARD') row.card += o.total
    else row.cash += o.total
  }
  const collectionsDaily = [...daily.values()]
    .filter((r) => r.date >= fromStr && r.date <= toStr)
    .map((r) => {
      const cash = Math.round(r.cash * 100) / 100
      const upi = Math.round(r.upi * 100) / 100
      const card = Math.round(r.card * 100) / 100
      const billsTotal = Math.round(r.bills * 100) / 100
      const directFood = Math.round(r.directFood * 100) / 100
      const advances = Math.round(r.advances * 100) / 100
      const total = Math.round((cash + upi + card) * 100) / 100
      return {
        ...r,
        cash,
        upi,
        card,
        bills: billsTotal,
        directFood,
        advances,
        total,
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))

  const totalCash = Math.round(collectionsDaily.reduce((s, r) => s + r.cash, 0) * 100) / 100
  const totalUpi = Math.round(collectionsDaily.reduce((s, r) => s + r.upi, 0) * 100) / 100
  const totalCard = Math.round(collectionsDaily.reduce((s, r) => s + r.card, 0) * 100) / 100
  const totalBills = Math.round(collectionsDaily.reduce((s, r) => s + r.bills, 0) * 100) / 100
  const totalDirectFood = Math.round(collectionsDaily.reduce((s, r) => s + r.directFood, 0) * 100) / 100
  const totalAdvances = Math.round(collectionsDaily.reduce((s, r) => s + r.advances, 0) * 100) / 100
  const totalCollections = Math.round((totalCash + totalUpi + totalCard) * 100) / 100

  const expenseByCategory: Record<string, number> = {}
  for (const e of ledger.filter((x) => x.type === 'EXPENSE')) {
    expenseByCategory[e.category] = (expenseByCategory[e.category] || 0) + e.amount
  }

  const customBills = bills.filter(
    (b) =>
      Math.abs(b.billedRoomTotal - b.actualRoomTotal) > 0.01 ||
      (!!b.roomDescription && b.roomDescription !== b.booking.room.type) ||
      (!!b.roomNumber && b.roomNumber !== b.booking.room.number)
  )

  const gstBillsList = bills.filter(
    (b) => (b.actualGst !== undefined && b.actualGst > 0) || (b.gstPercent !== undefined && b.gstPercent > 0) || (b.internalGst !== undefined && b.internalGst > 0)
  )

  const gstRows = gstBillsList.map((b) => {
    const isCustom =
      Math.abs(b.billedRoomTotal - b.actualRoomTotal) > 0.01 ||
      (!!b.roomDescription && b.roomDescription !== b.booking.room.type) ||
      (!!b.roomNumber && b.roomNumber !== b.booking.room.number) ||
      b.isCorporate
    const taxableAmount = Math.max(0, b.billedRoomTotal + (b.foodTotal || 0) + b.extraCharges - b.discount)
    const paid = billReceived(b)
    const balance = billBalance(b)
    const gstSplitRow = splitGst(b)
    const effectiveCash = b.payCash || 0

    const internalGst =
      b.internalGst !== undefined && b.internalGst > 0
        ? b.internalGst
        : Math.abs(b.billedRoomTotal - b.actualRoomTotal) < 0.01
        ? b.actualGst
        : Math.round(Math.max(0, b.actualRoomTotal + (b.foodTotal || 0) + b.extraCharges - b.discount) * b.gstPercent) / 100
    const internalTotal =
      b.internalTotal !== undefined && b.internalTotal > 0
        ? b.internalTotal
        : Math.abs(b.billedRoomTotal - b.actualRoomTotal) < 0.01
        ? b.grandTotal
        : Math.max(0, b.actualRoomTotal + (b.foodTotal || 0) + b.extraCharges - b.discount) + internalGst

    return {
      id: b.id,
      billNumber: b.billNumber,
      date: b.createdAt,
      guestName: b.booking.guest.name,
      phone: b.booking.guest.phone,
      email: b.booking.guest.email || null,
      company: b.corporateName || b.booking.guest.company || null,
      guestGst: b.gstNumber || b.booking.guest.gst || null,
      address: b.booking.guest.address || null,
      idProof: b.booking.guest.idProof || null,
      originalRoomNumber: b.booking.room.number,
      roomNumber: b.roomNumber || b.booking.room.number,
      roomDescription: b.roomDescription || b.booking.room.type || 'Non-AC',
      days: b.days,
      actualRoomTotal: b.actualRoomTotal,
      billedRoomTotal: b.billedRoomTotal,
      foodTotal: b.foodTotal,
      extraCharges: b.extraCharges,
      discount: b.discount,
      taxableAmount,
      gstPercent: b.gstPercent,
      actualGst: b.actualGst,
      cgstPercent: gstSplitRow.cgstPercent,
      sgstPercent: gstSplitRow.sgstPercent,
      cgst: gstSplitRow.cgst,
      sgst: gstSplitRow.sgst,
      internalGst,
      grandTotal: b.grandTotal,
      internalTotal,
      isCustom,
      payCash: effectiveCash,
      payUpi: b.payUpi,
      payCard: b.payCard,
      advanceApplied: b.advanceApplied,
      paid,
      balance,
      approvedBy: b.approvedBy || null,
      createdBy: b.createdBy || null,
      status: b.status,
      notes: b.notes || null,
      booking: b.booking,
    }
  })

  const foodDirectTotal = Math.round(orders.filter((o) => o.status === 'PAID').reduce((s, o) => s + o.total, 0) * 100) / 100
  const roomInternalRevenue = Math.round(bills.reduce((s, b) => s + billInternal(b).total, 0) * 100) / 100
  const totalInternalRevenue = Math.round((roomInternalRevenue + foodDirectTotal) * 100) / 100

  return NextResponse.json({
    range: { from: fromStr, to: toStr, days: daysDiff },
    occupancy: {
      totalRooms: rooms.length,
      occupiedNow: occupiedRooms,
      vacantNow: rooms.filter((r) => r.status === 'VACANT').length,
      occupancyPercent: rooms.length ? Math.round((occupiedRooms / rooms.length) * 100) : 0,
      roomNightsSold: roomNights,
      bookingsCount: bookings.length,
      inHouseGuests: activeBookings.length,
    },
    collections: {
      cash: totalCash,
      upi: totalUpi,
      card: totalCard,
      bills: totalBills,
      directFood: totalDirectFood,
      advances: totalAdvances,
      total: totalCollections,
    },
    collectionsDaily,
    revenue: {
      actualRoomRevenue: Math.round(bills.reduce((s, b) => s + b.actualRoomTotal, 0) * 100) / 100,
      billedRoomRevenue: Math.round(bills.reduce((s, b) => s + b.billedRoomTotal, 0) * 100) / 100,
      gst: Math.round(bills.reduce((s, b) => s + billInternal(b).gst, 0) * 100) / 100,
      cgst: Math.round(bills.reduce((s, b) => s + splitGst(b).cgst, 0) * 100) / 100,
      sgst: Math.round(bills.reduce((s, b) => s + splitGst(b).sgst, 0) * 100) / 100,
      foodRoomPosted: Math.round(bills.reduce((s, b) => s + b.foodTotal, 0) * 100) / 100,
      foodDirect: foodDirectTotal,
      discounts: Math.round(bills.reduce((s, b) => s + b.discount, 0) * 100) / 100,
      grandTotal: totalInternalRevenue,
    },
    invoices: {
      count: bills.length,
      customCount: customBills.length,
      rows: bills.map((b) => ({
        id: b.id,
        billNumber: b.billNumber,
        date: b.createdAt,
        guestName: b.booking.guest.name,
        originalRoomNumber: b.booking.room.number,
        roomNumber: b.roomNumber || b.booking.room.number,
        roomDescription: b.roomDescription || b.booking.room.type || 'Non-AC',
        actualRoomTotal: b.actualRoomTotal,
        billedRoomTotal: b.billedRoomTotal,
        foodTotal: b.foodTotal,
        gst: b.actualGst,
        cgst: splitGst(b).cgst,
        sgst: splitGst(b).sgst,
        cgstPercent: splitGst(b).cgstPercent,
        sgstPercent: splitGst(b).sgstPercent,
        internalGst: billInternal(b).gst,
        grandTotal: b.grandTotal,
        internalTotal: billInternal(b).total,
        isCustom: Math.abs(b.billedRoomTotal - b.actualRoomTotal) > 0.01 || (!!b.roomDescription && b.roomDescription !== b.booking.room.type) || (!!b.roomNumber && b.roomNumber !== b.booking.room.number),
        approvedBy: b.approvedBy,
      })),
    },
    food: {
      ordersCount: orders.length,
      roomPostedCount: orders.filter((o) => o.status === 'ADDED_TO_BILL').length,
      rows: orders.map((o) => ({
        id: o.id,
        time: o.createdAt,
        roomNumber: o.room?.number || null,
        tableNo: o.tableNo,
        items: o.items.map((i) => `${i.name} x${i.quantity}`).join(', '),
        total: o.total,
        createdBy: o.createdBy,
        postedToRoom: o.status === 'ADDED_TO_BILL',
      })),
    },
    staff: {
      salaryTotal: staffPays.filter((p) => p.type === 'SALARY').reduce((s, p) => s + p.amount, 0),
      advanceTotal: staffPays.filter((p) => p.type === 'ADVANCE').reduce((s, p) => s + p.amount, 0),
      rows: staffPays.map((p) => ({
        id: p.id,
        staffName: p.staff.name,
        type: p.type,
        amount: p.amount,
        method: p.method,
        date: p.date,
        recoveryNotes: p.recoveryNotes,
      })),
    },
    expenses: {
      total: ledger.filter((e) => e.type === 'EXPENSE').reduce((s, e) => s + e.amount, 0),
      byCategory: expenseByCategory,
      rows: ledger.filter((e) => e.type === 'EXPENSE').map((e) => ({
        id: e.id,
        date: e.date,
        category: e.category,
        description: e.description,
        amount: e.amount,
        method: e.method,
        vendor: e.vendor,
      })),
    },
    outstanding: {
      total: outstandingRows.reduce((s, r) => s + r.balance, 0),
      rows: outstandingRows,
    },
    gstBills: {
      count: gstRows.length,
      normalCount: gstRows.filter((r) => !r.isCustom).length,
      customCount: gstRows.filter((r) => r.isCustom).length,
      totalGstAmount: Math.round(gstRows.reduce((s, r) => s + r.actualGst, 0) * 100) / 100,
      totalTaxableAmount: Math.round(gstRows.reduce((s, r) => s + r.taxableAmount, 0) * 100) / 100,
      totalGrandTotal: Math.round(gstRows.reduce((s, r) => s + r.grandTotal, 0) * 100) / 100,
      totalInternalGst: Math.round(gstRows.reduce((s, r) => s + r.internalGst, 0) * 100) / 100,
      rows: gstRows,
    },
    bookings: {
      rows: bookings.map((b) => ({
        id: b.id,
        guestName: b.guest.name,
        phone: b.guest.phone,
        roomNumber: b.room.number,
        checkIn: b.checkIn,
        checkOut: b.checkOut,
        days: b.days,
        ratePerDay: b.ratePerDay,
        status: b.status,
        paymentStatus: b.paymentStatus,
        isCorporate: b.isCorporate,
      })),
    },
  })
}

// ============ ROUTER ============
async function route(
  req: NextRequest,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
): Promise<NextResponse> {
  const url = new URL(req.url)
  let body: Record<string, unknown> = {}
  if (method === 'POST' || method === 'PATCH') {
    try {
      body = await req.json()
    } catch {
      body = {}
    }
  }

  if (method !== 'GET') searchCache.clear()

  try {
    await ensureSchema()
    const res = await dispatch(req, method, url, body)
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0')
    res.headers.set('Pragma', 'no-cache')
    res.headers.set('Expires', '0')
    return res
  } catch (e) {
    if (e instanceof BanquetError || e instanceof InventoryError || e instanceof StaffError) {
      return NextResponse.json({ error: e.message }, { status: 400, headers: { 'Cache-Control': 'no-store' } })
    }
    console.error(`API Error [${method} ${url.pathname}]:`, e)
    const message = e instanceof Error ? e.message : 'Internal server error'
    const res = NextResponse.json({ error: message }, { status: 500 })
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0')
    return res
  }
}

async function dispatch(
  req: NextRequest,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: URL,
  body: Record<string, unknown>
): Promise<NextResponse> {
  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
  const resource = segments[0] || ''
  const user = getRequestUser(req)

  // Enforce Admin PIN / Password authorization for ANY delete operation across the entire application
  if (method === 'DELETE') {
    const adminAuth = await verifyAdminAuth(req, body)
    if (!adminAuth.ok) {
      return NextResponse.json({ error: adminAuth.error }, { status: 403 })
    }
    if (adminAuth.adminUser) {
      user.id = user.id || adminAuth.adminUser.id
      user.name = user.name || adminAuth.adminUser.name
      user.role = 'ADMIN'
    }
  }

  switch (resource) {
    case 'verify-admin':
      if (method === 'POST') {
        const check = await verifyAdminAuth(req, body)
        if (!check.ok) return NextResponse.json({ error: check.error }, { status: 403 })
        return NextResponse.json({ ok: true, user: check.adminUser })
      }
      break
    case 'rooms':
      if (method === 'GET') return await listRooms(req)
      if (method === 'POST') return await createRoom(req, body, user)
      if (method === 'PATCH') return await updateRoom(req, body, user)
      if (method === 'DELETE') return await deleteRoom(req, user)
      break
    case 'guests':
      if (method === 'GET' && (url.searchParams.get('phone') || url.searchParams.get('idProof') || url.searchParams.get('name') || url.searchParams.get('lookup') === 'true')) return await lookupGuest(req)
      if (method === 'GET') return await listGuests(req)
      if (method === 'POST') return await upsertGuest(body)
      if (method === 'DELETE') return await deleteGuest(req, user)
      break
    case 'bookings':
      if (method === 'GET' && url.searchParams.get('paymentsFor')) {
        // Advance and part payments of one stay, oldest first
        const rows = await prisma.ledgerEntry.findMany({
          where: { refId: String(url.searchParams.get('paymentsFor')), type: 'INCOME', category: 'ADVANCE' },
          orderBy: { date: 'asc' },
          select: { id: true, date: true, amount: true, method: true, description: true },
        })
        return NextResponse.json(rows)
      }
      if (method === 'GET') return await listBookings(req)
      if (method === 'POST') return await createBooking(body, user)
      if (method === 'PATCH') return await updateBooking(body, user)
      if (method === 'DELETE') return await deleteBooking(req, user)
      break
    case 'bills':
      if (method === 'GET' && url.searchParams.get('paymentsFor')) return await billPaymentHistory(String(url.searchParams.get('paymentsFor')))
      if (method === 'GET') return await listBills(req)
      if (method === 'POST' && body.action === 'payment') return await addBillPayment(body, user)
      if (method === 'POST' && body.action === 'update') return await updateBill(body, user)
      if (method === 'POST') return await createBill(body, user)
      if (method === 'PATCH') return await updateBill(body, user)
      if (method === 'DELETE') return await deleteBill(req, user)
      break
    case 'menu':
      if (method === 'GET') return await listMenu()
      if (method === 'POST') return await createMenuItem(body)
      if (method === 'PATCH') return await updateMenuItem(body)
      if (method === 'DELETE') return await deleteMenuItem(req, user)
      break
    case 'orders':
      if (method === 'GET') return await listOrders(req)
      if (method === 'POST') return await createOrder(body, user)
      if (method === 'PATCH') return await updateOrder(body, user)
      if (method === 'DELETE') return await deleteFoodOrder(req, user)
      break
    case 'staff':
      if (method === 'GET' && url.searchParams.get('historyFor')) {
        // Everything recorded about one staff member: profile changes and payments
        const id = String(url.searchParams.get('historyFor'))
        const paymentIds = (await prisma.staffPayment.findMany({ where: { staffId: id }, select: { id: true } })).map((p) => p.id)
        const rows = await prisma.auditLog.findMany({
          where: { OR: [{ entity: 'Staff', entityId: id }, { entity: 'StaffPayment', entityId: { in: paymentIds } }] },
          orderBy: { createdAt: 'desc' },
          take: 500,
        })
        return NextResponse.json(rows)
      }
      if (method === 'GET') return await listStaff(req)
      if (method === 'POST') return await createStaff(body, user)
      if (method === 'PATCH') return await updateStaff(body, user)
      if (method === 'DELETE') return await deleteStaff(req, user)
      break
    case 'staff-workdays':
      if (method === 'POST') {
        const r = await setWorkDay(body)
        await logAudit(
          'STAFF_WORKDAY',
          'Staff',
          r.staff.id,
          r.units === 0 ? `${r.staff.name}: work day ${r.date} cleared` : `${r.staff.name}: ${r.units === 1 ? 'full' : 'half'} day worked on ${r.date}`,
          user
        )
        return NextResponse.json(r)
      }
      break
    case 'staff-payments':
      if (method === 'GET') return await listStaffPayments(req)
      if (method === 'POST') return await createStaffPayment(body, user)
      if (method === 'DELETE') return await deleteStaffPayment(req, user)
      break
    case 'ledger':
      if (method === 'GET') return await listLedger(req)
      if (method === 'POST') return await createLedgerEntry(body, user)
      if (method === 'PATCH') return await updateLedgerEntry(body, user)
      if (method === 'DELETE') return await deleteLedgerEntry(req, user)
      break
    case 'stats':
      if (method === 'GET') return await getStats()
      break
    case 'inventory':
      if (method === 'GET') return NextResponse.json(await listInventoryItems(url.searchParams.get('archived') === 'true'))
      if (method === 'POST') {
        const item = await createInventoryItem(body, user.name)
        await logAudit(
          'INVENTORY_ITEM',
          'InventoryItem',
          item.id,
          `Added inventory item ${item.name} (${item.category})${item.stock > 0 ? `, opening stock ${item.stock} ${item.unit}` : ''}`,
          user
        )
        return NextResponse.json(item)
      }
      if (method === 'PATCH') {
        const item = await updateInventoryItem(body)
        await logAudit(
          'INVENTORY_ITEM',
          'InventoryItem',
          item.id,
          body.active !== undefined && Object.keys(body).length <= 2
            ? `${item.active ? 'Restored' : 'Archived'} inventory item ${item.name}`
            : `Updated inventory item ${item.name}`,
          user
        )
        return NextResponse.json(item)
      }
      if (method === 'DELETE') {
        const id = url.searchParams.get('id')
        if (!id) return NextResponse.json({ error: 'Item id is required' }, { status: 400 })
        const res = await deleteInventoryItem(id)
        await logAudit(
          'INVENTORY_ITEM',
          'InventoryItem',
          id,
          res.archived ? `Archived inventory item ${res.item.name} (has stock history)` : `Deleted inventory item ${res.item.name}`,
          user
        )
        return NextResponse.json({ success: true, archived: res.archived })
      }
      break
    case 'inventory-movements':
      if (method === 'GET') {
        return NextResponse.json(
          await listInventoryMovements({
            itemId: url.searchParams.get('itemId'),
            type: url.searchParams.get('type'),
            from: url.searchParams.get('from'),
            to: url.searchParams.get('to'),
          })
        )
      }
      if (method === 'POST') {
        // A stock count correction changes stock without a purchase or use, so it needs an Admin
        if (String(body.type).toUpperCase() === 'ADJUSTMENT') {
          const admin = await verifyAdminAuth(req, body)
          if (!admin.ok) {
            return NextResponse.json({ error: 'Admin PIN is required for a stock count correction' }, { status: 403 })
          }
        }
        const { movement, item } = await recordInventoryMovement(body, user.name)
        const qty = `${Math.abs(movement.quantity)} ${item.unit}`
        const detail =
          movement.type === 'PURCHASE'
            ? `Stock in: ${qty} ${item.name} @ ₹${movement.unitCost}${movement.vendor ? ` from ${movement.vendor}` : ''} = ₹${movement.totalCost}${movement.expenseRecorded ? ' (added to Expenses)' : ''}`
            : movement.type === 'ISSUE'
              ? `Stock used: ${qty} ${item.name} → ${movement.department}${movement.roomNumber ? ` (Room ${movement.roomNumber})` : ''}`
              : movement.type === 'WASTAGE'
                ? `Wastage: ${qty} ${item.name} — ${movement.note}`
                : `Stock count correction: ${item.name} ${movement.quantity > 0 ? '+' : '-'}${qty} (now ${item.stock} ${item.unit}) — ${movement.note}`
        await logAudit(`INVENTORY_${movement.type}`, 'InventoryMovement', movement.id, `${detail}. Balance ${item.stock} ${item.unit}`, user)
        return NextResponse.json({ movement, item })
      }
      if (method === 'DELETE') {
        const id = url.searchParams.get('id')
        if (!id) return NextResponse.json({ error: 'Entry id is required' }, { status: 400 })
        const { movement, item } = await deleteInventoryMovement(id)
        await logAudit(
          'INVENTORY_DELETE',
          'InventoryMovement',
          id,
          `Deleted ${movement.type.toLowerCase()} entry of ${Math.abs(movement.quantity)} ${item.unit} ${item.name}; stock restored to ${Math.max(0, Math.round((item.stock - movement.quantity) * 1000) / 1000)} ${item.unit}`,
          user
        )
        return NextResponse.json({ success: true })
      }
      break
    case 'daybook': {
      if (method !== 'GET') break
      // Default: today (IST)
      const today = istDateStr(new Date())
      const from = url.searchParams.get('from') || today
      const to = url.searchParams.get('to') || today
      return NextResponse.json(await getDayBook(makeIST(from, '00:00'), makeIST(to, '23:59:59')))
    }
    case 'bill-payments': {
      if (method !== 'GET') break
      const range: { gte?: Date; lte?: Date } = {}
      if (url.searchParams.get('from')) range.gte = makeIST(String(url.searchParams.get('from')), '00:00')
      if (url.searchParams.get('to')) range.lte = makeIST(String(url.searchParams.get('to')), '23:59:59')
      const rows = await prisma.billPayment.findMany({
        where: range.gte || range.lte ? { date: range } : undefined,
        orderBy: { date: 'desc' },
        take: 3000,
        include: {
          bill: {
            select: {
              id: true,
              billNumber: true,
              roomNumber: true,
              booking: { select: { guest: { select: { name: true, phone: true } }, room: { select: { number: true } } } },
            },
          },
        },
      })
      return NextResponse.json(rows)
    }
    case 'inventory-report':
      if (method === 'GET') return NextResponse.json(await inventoryStockReport(url.searchParams.get('from'), url.searchParams.get('to')))
      break
    case 'settings':
      if (method === 'GET') return await getSettings()
      if (method === 'PATCH' || method === 'POST') {
        // Every settings change needs an Admin
        const admin = await verifyAdminAuth(req, body)
        if (!admin.ok) return NextResponse.json({ error: 'Admin PIN is required to change settings' }, { status: 403 })
        delete body.adminPin
        return await updateSettings(body, user)
      }
      break
    case 'users':
      if (method === 'GET') return await listUsers()
      if (method === 'POST' || method === 'PATCH') {
        // Adding users, changing a role or PIN is an Admin action
        const admin = await verifyAdminAuth(req, body)
        if (!admin.ok) return NextResponse.json({ error: 'Admin PIN is required to change app users' }, { status: 403 })
        delete body.adminPin
        return method === 'POST' ? await createUser(body, user) : await updateUser(body, user)
      }
      if (method === 'DELETE') return await deleteUser(req, user)
      break
    case 'auth':
      if (method === 'POST' && body.action === 'verify-admin') {
        // Used before sensitive client actions (e.g. printing a bill with balance due)
        const admin = await verifyAdminPin(body.pin)
        if (!admin) return NextResponse.json({ error: 'Invalid Admin PIN (ADMIN role required)' }, { status: 403 })
        if (body.reason) {
          await logAudit('ADMIN_APPROVAL', 'User', admin.id, `${String(body.reason)} — approved by Admin ${admin.name}`, {
            name: admin.name,
            role: 'ADMIN',
          })
        }
        return NextResponse.json({ ok: true, name: admin.name })
      }
      if (method === 'POST') return await login(body)
      break
    case 'audit':
      if (method === 'GET') return await listAudit(req)
      break
    case 'banquet-halls':
      if (method === 'GET') return NextResponse.json(await getBanquetHalls())
      if (method === 'POST') {
        const h = await createBanquetHall(body as any)
        await logAudit('BANQUET_CREATE', 'BanquetHall', h.id, `Created banquet hall ${h.name}`, user)
        return NextResponse.json(h)
      }
      if (method === 'PATCH') {
        const id = String(body.id || url.searchParams.get('id') || '')
        if (!id) return NextResponse.json({ error: 'Hall ID is required' }, { status: 400 })
        const h = await updateBanquetHall(id, body as any)
        await logAudit('BANQUET_UPDATE', 'BanquetHall', id, `Updated banquet hall ${h.name}`, user)
        return NextResponse.json(h)
      }
      if (method === 'DELETE') {
        const id = url.searchParams.get('id')
        if (!id) return NextResponse.json({ error: 'Hall ID is required' }, { status: 400 })
        await deleteBanquetHall(id)
        await logAudit('BANQUET_UPDATE', 'BanquetHall', id, `Deleted banquet hall`, user)
        return NextResponse.json({ success: true })
      }
      break
    case 'banquet-bookings':
      if (method === 'GET' && url.searchParams.get('advancesFor')) {
        // Advance payments of one banquet booking, oldest first (for its receipt)
        const rows = await prisma.ledgerEntry.findMany({
          where: { refId: String(url.searchParams.get('advancesFor')), type: 'INCOME', category: 'ADVANCE' },
          orderBy: { date: 'asc' },
          select: { date: true, amount: true, method: true, description: true },
        })
        return NextResponse.json(rows)
      }
      if (method === 'GET') {
        return NextResponse.json(
          await getBanquetBookings({
            from: url.searchParams.get('from') || undefined,
            to: url.searchParams.get('to') || undefined,
            status: url.searchParams.get('status') || undefined,
            search: url.searchParams.get('search') || undefined,
            hallId: url.searchParams.get('hallId') || undefined,
          })
        )
      }
      if (method === 'POST') {
        if (body.action === 'cancel') {
          const id = String(body.id || '')
          if (!id) return NextResponse.json({ error: 'Booking ID is required' }, { status: 400 })
          // Cancelling frees the hall and may refund the advance, so an Admin must approve it
          const admin = await verifyAdminAuth(req, body)
          if (!admin.ok) return NextResponse.json({ error: 'Admin PIN is required to cancel a banquet booking' }, { status: 403 })
          if (admin.adminUser) user.name = user.name ? `${user.name} (approved by ${admin.adminUser.name})` : admin.adminUser.name
          const b = await cancelBanquetBooking(body as any, user.name)
          await logAudit('BANQUET_CANCEL', 'BanquetBooking', id, `Cancelled banquet booking ${b.bookingNumber} (${b.customerName}). Reason: ${body.reason || 'Staff action'}`, user)
          return NextResponse.json(b)
        }
        const b = await createBanquetBooking(body as any, user.name)
        await logAudit('BANQUET_CREATE', 'BanquetBooking', b.id, `Created banquet booking ${b.bookingNumber} for ${b.customerName}`, user)
        return NextResponse.json(b)
      }
      if (method === 'PATCH') {
        const id = String(body.id || url.searchParams.get('id') || '')
        if (!id) return NextResponse.json({ error: 'Booking ID is required' }, { status: 400 })
        if (body.action === 'cancel' || body.status === 'CANCELLED') {
          const b = await cancelBanquetBooking({ id, ...body as any }, user.name)
          await logAudit('BANQUET_CANCEL', 'BanquetBooking', id, `Cancelled banquet booking ${b.bookingNumber} (${b.customerName}). Reason: ${body.reason || 'Staff action'}`, user)
          return NextResponse.json(b)
        }
        const b = await updateBanquetBooking(id, body as any, user.name)
        await logAudit('BANQUET_UPDATE', 'BanquetBooking', id, `Updated banquet booking ${b.bookingNumber}`, user)
        return NextResponse.json(b)
      }
      if (method === 'DELETE') {
        const id = url.searchParams.get('id')
        if (!id) return NextResponse.json({ error: 'Booking ID is required' }, { status: 400 })
        await deleteBanquetBooking(id)
        await logAudit('BANQUET_UPDATE', 'BanquetBooking', id, `Deleted banquet booking`, user)
        return NextResponse.json({ success: true })
      }
      break
    case 'banquet-bills':
      if (method === 'GET') {
        return NextResponse.json(
          await getBanquetBills({
            from: url.searchParams.get('from') || undefined,
            to: url.searchParams.get('to') || undefined,
            search: url.searchParams.get('search') || undefined,
          })
        )
      }
      if (method === 'POST') {
        if (body.action === 'payment' || body.paymentOnly) {
          const id = String(body.id || body.billId || '')
          if (!id) return NextResponse.json({ error: 'Bill ID is required' }, { status: 400 })
          const updated = await addBanquetBillPayment(id, body as any, user.name)
          await logAudit('BANQUET_BILL', 'BanquetBill', id, `Recorded payment on banquet bill ${updated.billNumber}`, user)
          return NextResponse.json(updated)
        }
        const b = await createBanquetBill(body as any, user.name, String(body.managerName || user.name))
        await logAudit('BANQUET_BILL', 'BanquetBill', b.id, `Generated banquet invoice ${b.billNumber} for ${b.customerName}`, user)
        return NextResponse.json(b)
      }
      if (method === 'DELETE') {
        const id = url.searchParams.get('id')
        if (!id) return NextResponse.json({ error: 'Bill ID is required' }, { status: 400 })
        await deleteBanquetBill(id)
        await logAudit('BANQUET_BILL', 'BanquetBill', id, `Deleted banquet bill`, user)
        return NextResponse.json({ success: true })
      }
      break
    case 'banquet-stats':
      if (method === 'GET') return NextResponse.json(await getBanquetStats())
      break
    case 'banquet': {
      const sub = segments[1] || ''
      if (sub === 'halls') {
        if (method === 'GET') return NextResponse.json(await getBanquetHalls())
        if (method === 'POST') return NextResponse.json(await createBanquetHall(body as any))
      }
      if (sub === 'bookings') {
        if (method === 'GET') return NextResponse.json(await getBanquetBookings())
        if (method === 'POST') return NextResponse.json(await createBanquetBooking(body as any, user.name))
      }
      if (sub === 'bills') {
        if (method === 'GET') return NextResponse.json(await getBanquetBills())
        if (method === 'POST') return NextResponse.json(await createBanquetBill(body as any, user.name))
      }
      if (sub === 'stats') {
        if (method === 'GET') return NextResponse.json(await getBanquetStats())
      }
      break
    }
    case 'expense-categories':
      if (method === 'GET') return await listExpenseCategories()
      if (method === 'POST') return await createExpenseCategory(body)
      if (method === 'PATCH') return await updateExpenseCategory(body)
      if (method === 'DELETE') return await deleteExpenseCategory(req, user)
      break
    case 'search':
      if (method === 'GET') return await globalSearch(req)
      break
    case 'companies':
      if (method === 'GET') return await listCompanies(req)
      break
    case 'reports':
      if (method === 'GET') return await getReports(req)
      break
  }
  return NextResponse.json({ error: `Not found: ${method} /api/${resource}` }, { status: 404 })
}

export async function GET(req: NextRequest) {
  return route(req, 'GET')
}
export async function POST(req: NextRequest) {
  return route(req, 'POST')
}
export async function PATCH(req: NextRequest) {
  return route(req, 'PATCH')
}
export async function DELETE(req: NextRequest) {
  return route(req, 'DELETE')
}
