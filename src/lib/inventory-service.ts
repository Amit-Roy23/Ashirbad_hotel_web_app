import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

/**
 * Inventory: items with a running stock that only changes through movements.
 *
 *  OPENING    stock already on the shelf when the item is added (no expense)
 *  PURCHASE   stock in; updates the weighted average cost; can be written to Expenses
 *  ISSUE      stock used / given out (housekeeping, kitchen, a room ...), valued at average cost
 *  WASTAGE    damaged / expired / lost, valued at average cost
 *  ADJUSTMENT physical count correction (Admin PIN, checked by the API route)
 *
 * Stock never goes below zero. Only the latest movement of an item can be deleted, which
 * reverses it exactly, so every running balance in the history stays correct.
 */

export class InventoryError extends Error {}

export const MOVEMENT_TYPES = ['OPENING', 'PURCHASE', 'ISSUE', 'WASTAGE', 'ADJUSTMENT'] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

/** Expense category used for inventory purchases written to the ledger */
export const INVENTORY_EXPENSE_CATEGORY = 'INVENTORY'

const q3 = (n: number) => Math.round(n * 1000) / 1000
const r2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : NaN
}
const text = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v).trim()
  return s || null
}

export type ItemStatus = 'OK' | 'LOW' | 'OUT'

export function itemStatus(item: { stock: number; reorderLevel: number }): ItemStatus {
  if (item.stock <= 0) return 'OUT'
  if (item.reorderLevel > 0 && item.stock <= item.reorderLevel) return 'LOW'
  return 'OK'
}

function withStatus<T extends { stock: number; reorderLevel: number; avgCost: number }>(item: T) {
  return { ...item, status: itemStatus(item), value: r2(item.stock * item.avgCost) }
}

// ============ Items ============

export async function listItems(includeArchived = false) {
  const items = await prisma.inventoryItem.findMany({
    where: includeArchived ? undefined : { active: true },
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  })
  const startMonth = new Date()
  startMonth.setDate(1)
  startMonth.setHours(0, 0, 0, 0)
  const monthPurchases = await prisma.inventoryMovement.aggregate({
    where: { type: 'PURCHASE', date: { gte: startMonth } },
    _sum: { totalCost: true },
  })
  const rows = items.map(withStatus)
  const live = rows.filter((i) => i.active)
  return {
    items: rows,
    summary: {
      totalItems: live.length,
      stockValue: r2(live.reduce((s, i) => s + i.value, 0)),
      lowCount: live.filter((i) => i.status === 'LOW').length,
      outCount: live.filter((i) => i.status === 'OUT').length,
      monthPurchase: r2(monthPurchases._sum.totalCost || 0),
    },
  }
}

/** Items at or below their reorder level (or out of stock), for alerts */
export async function lowStockCount() {
  const items = await prisma.inventoryItem.findMany({
    where: { active: true },
    select: { stock: true, reorderLevel: true },
  })
  return items.filter((i) => itemStatus(i) !== 'OK').length
}

export async function createItem(data: Record<string, unknown>, userName?: string | null) {
  const name = text(data.name)
  if (!name) throw new InventoryError('Item name is required')
  const unit = text(data.unit) || 'pcs'
  const category = text(data.category) || 'Other'
  const reorderLevel = data.reorderLevel === undefined || data.reorderLevel === '' ? 0 : num(data.reorderLevel)
  if (!Number.isFinite(reorderLevel) || reorderLevel < 0) throw new InventoryError('Reorder level must be 0 or more')
  const opening = data.openingStock === undefined || data.openingStock === '' ? 0 : num(data.openingStock)
  if (!Number.isFinite(opening) || opening < 0) throw new InventoryError('Opening stock must be 0 or more')
  const openingCost = data.openingCost === undefined || data.openingCost === '' ? 0 : num(data.openingCost)
  if (!Number.isFinite(openingCost) || openingCost < 0) throw new InventoryError('Cost per unit must be 0 or more')

  const existing = await prisma.inventoryItem.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } })
  if (existing) {
    throw new InventoryError(
      existing.active ? `"${existing.name}" already exists` : `"${existing.name}" exists in the archive. Restore it instead.`
    )
  }

  return prisma.$transaction(async (tx) => {
    const item = await tx.inventoryItem.create({
      data: {
        name,
        unit,
        category,
        reorderLevel: q3(reorderLevel),
        location: text(data.location),
        notes: text(data.notes),
        stock: q3(opening),
        avgCost: opening > 0 ? r2(openingCost) : 0,
      },
    })
    if (opening > 0) {
      await tx.inventoryMovement.create({
        data: {
          itemId: item.id,
          type: 'OPENING',
          quantity: q3(opening),
          balanceAfter: q3(opening),
          unitCost: r2(openingCost),
          totalCost: r2(opening * openingCost),
          note: 'Opening stock',
          createdBy: userName || null,
        },
      })
    }
    return withStatus(item)
  })
}

export async function updateItem(data: Record<string, unknown>) {
  const id = text(data.id)
  if (!id) throw new InventoryError('Item id is required')
  const item = await prisma.inventoryItem.findUnique({ where: { id } })
  if (!item) throw new InventoryError('Item not found')

  const update: Prisma.InventoryItemUpdateInput = {}
  if (data.name !== undefined) {
    const name = text(data.name)
    if (!name) throw new InventoryError('Item name is required')
    const clash = await prisma.inventoryItem.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, NOT: { id } },
    })
    if (clash) throw new InventoryError(`"${clash.name}" already exists`)
    update.name = name
  }
  if (data.category !== undefined) update.category = text(data.category) || 'Other'
  if (data.unit !== undefined) update.unit = text(data.unit) || 'pcs'
  if (data.reorderLevel !== undefined) {
    const level = data.reorderLevel === '' ? 0 : num(data.reorderLevel)
    if (!Number.isFinite(level) || level < 0) throw new InventoryError('Reorder level must be 0 or more')
    update.reorderLevel = q3(level)
  }
  if (data.location !== undefined) update.location = text(data.location)
  if (data.notes !== undefined) update.notes = text(data.notes)
  if (data.active !== undefined) update.active = data.active !== false
  // Stock and average cost only change through movements
  return withStatus(await prisma.inventoryItem.update({ where: { id }, data: update }))
}

/** Items with history are archived (kept for reports); items never used are deleted */
export async function deleteItem(id: string) {
  const item = await prisma.inventoryItem.findUnique({ where: { id } })
  if (!item) throw new InventoryError('Item not found')
  const used = await prisma.inventoryMovement.count({ where: { itemId: id } })
  if (used > 0) {
    await prisma.inventoryItem.update({ where: { id }, data: { active: false } })
    return { item, archived: true }
  }
  await prisma.inventoryItem.delete({ where: { id } })
  return { item, archived: false }
}

// ============ Movements ============

export interface MovementInput {
  itemId?: unknown
  type?: unknown
  quantity?: unknown
  unitCost?: unknown
  countedStock?: unknown
  vendor?: unknown
  reference?: unknown
  department?: unknown
  roomNumber?: unknown
  method?: unknown
  recordExpense?: unknown
  note?: unknown
}

export async function recordMovement(data: MovementInput, userName?: string | null) {
  const itemId = text(data.itemId)
  if (!itemId) throw new InventoryError('Select an item')
  const type = String(data.type || '').toUpperCase() as MovementType
  if (!['PURCHASE', 'ISSUE', 'WASTAGE', 'ADJUSTMENT'].includes(type)) throw new InventoryError('Invalid stock entry type')

  return prisma.$transaction(async (tx) => {
    // Lock the item row so two entries at the same time cannot both use the same stock
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "InventoryItem" WHERE "id" = ${itemId} FOR UPDATE`
    if (locked.length === 0) throw new InventoryError('Item not found')
    const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })
    if (!item.active) throw new InventoryError(`${item.name} is archived. Restore it first.`)

    let change = 0
    let unitCost = item.avgCost
    let avgCost = item.avgCost
    const note = text(data.note)

    if (type === 'ADJUSTMENT') {
      const counted = num(data.countedStock)
      if (!Number.isFinite(counted) || counted < 0) throw new InventoryError('Enter the counted stock (0 or more)')
      change = q3(counted - item.stock)
      if (Math.abs(change) < 0.0005) throw new InventoryError(`Counted stock matches the system stock (${item.stock} ${item.unit})`)
      if (!note) throw new InventoryError('Give a reason for the stock correction')
    } else {
      const qty = num(data.quantity)
      if (!Number.isFinite(qty) || qty <= 0) throw new InventoryError('Quantity must be more than 0')
      if (type === 'PURCHASE') {
        const cost = data.unitCost === undefined || data.unitCost === '' ? 0 : num(data.unitCost)
        if (!Number.isFinite(cost) || cost < 0) throw new InventoryError('Cost per unit must be 0 or more')
        change = q3(qty)
        unitCost = r2(cost)
        const newStock = item.stock + qty
        // Weighted average cost of what is on the shelf after this purchase
        avgCost = item.stock > 0 ? r2((item.stock * item.avgCost + qty * cost) / newStock) : r2(cost)
      } else {
        if (qty > item.stock + 0.0005) {
          throw new InventoryError(`Only ${item.stock} ${item.unit} of ${item.name} in stock`)
        }
        change = -q3(qty)
        if (type === 'WASTAGE' && !note) throw new InventoryError('Give a reason for the wastage')
      }
    }

    const balanceAfter = q3(item.stock + change)
    const totalCost = r2(Math.abs(change) * unitCost)
    const isPurchase = type === 'PURCHASE'
    const recordExpense = isPurchase && data.recordExpense !== false && totalCost > 0
    const method = isPurchase ? (['CASH', 'UPI', 'CARD', 'BANK'].includes(String(data.method)) ? String(data.method) : 'CASH') : null
    const department = type === 'ISSUE' ? text(data.department) || 'Other' : null

    const movement = await tx.inventoryMovement.create({
      data: {
        itemId,
        type,
        quantity: change,
        balanceAfter,
        unitCost,
        totalCost,
        vendor: isPurchase ? text(data.vendor) : null,
        reference: isPurchase ? text(data.reference) : null,
        department,
        roomNumber: type === 'ISSUE' ? text(data.roomNumber) : null,
        method,
        expenseRecorded: recordExpense,
        note,
        createdBy: userName || null,
      },
    })
    const updated = await tx.inventoryItem.update({
      where: { id: itemId },
      data: { stock: balanceAfter, avgCost },
    })

    if (recordExpense) {
      await tx.expenseCategory.upsert({
        where: { name: INVENTORY_EXPENSE_CATEGORY },
        update: {},
        create: { name: INVENTORY_EXPENSE_CATEGORY },
      })
      await tx.ledgerEntry.create({
        data: {
          type: 'EXPENSE',
          category: INVENTORY_EXPENSE_CATEGORY,
          description: `Inventory purchase: ${change} ${item.unit} ${item.name}${movement.reference ? ` (Bill ${movement.reference})` : ''}`,
          amount: totalCost,
          method: method || 'CASH',
          vendor: movement.vendor,
          source: 'AUTO',
          refId: movement.id,
        },
      })
    }
    return { movement, item: withStatus(updated) }
  })
}

/** Deletes an item's latest entry and undoes its effect on stock, average cost and Expenses */
export async function deleteMovement(id: string) {
  return prisma.$transaction(async (tx) => {
    const movement = await tx.inventoryMovement.findUnique({ where: { id }, include: { item: true } })
    if (!movement) throw new InventoryError('Stock entry not found')
    await tx.$queryRaw`SELECT "id" FROM "InventoryItem" WHERE "id" = ${movement.itemId} FOR UPDATE`
    const latest = await tx.inventoryMovement.findFirst({
      where: { itemId: movement.itemId },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    })
    if (latest?.id !== movement.id) {
      throw new InventoryError(
        `Only the latest entry of ${movement.item.name} can be deleted. Use a stock count correction to fix older entries.`
      )
    }
    const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: movement.itemId } })
    const stock = q3(item.stock - movement.quantity)
    if (stock < -0.0005) throw new InventoryError(`Cannot undo: ${item.name} would go below zero`)

    let avgCost = item.avgCost
    if ((movement.type === 'PURCHASE' || movement.type === 'OPENING') && movement.quantity > 0) {
      // Take this purchase back out of the weighted average
      avgCost = stock > 0 ? r2(Math.max(0, (item.stock * item.avgCost - movement.quantity * movement.unitCost) / stock)) : 0
    }
    await tx.inventoryItem.update({ where: { id: item.id }, data: { stock: Math.max(0, stock), avgCost } })
    await tx.ledgerEntry.deleteMany({ where: { refId: movement.id, source: 'AUTO', category: INVENTORY_EXPENSE_CATEGORY } })
    await tx.inventoryMovement.delete({ where: { id } })
    return { movement, item }
  })
}

export async function listMovements(filter: { itemId?: string | null; type?: string | null; from?: string | null; to?: string | null }) {
  const where: Prisma.InventoryMovementWhereInput = {}
  if (filter.itemId) where.itemId = filter.itemId
  if (filter.type && filter.type !== 'ALL') where.type = filter.type
  const range = dateRange(filter.from, filter.to)
  if (range) where.date = range
  const rows = await prisma.inventoryMovement.findMany({
    where,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    take: 2000,
    include: { item: { select: { name: true, unit: true, category: true } } },
  })
  // Mark which entry is the latest of its item (only that one can be deleted)
  const latestIds = new Set<string>()
  const itemIds = [...new Set(rows.map((r) => r.itemId))]
  if (itemIds.length > 0) {
    const latest = await prisma.inventoryMovement.findMany({
      where: { itemId: { in: itemIds } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      distinct: ['itemId'],
      select: { id: true },
    })
    for (const l of latest) latestIds.add(l.id)
  }
  return rows.map((r) => ({ ...r, isLatest: latestIds.has(r.id) }))
}

/** IST day boundaries for yyyy-mm-dd inputs */
function dateRange(from?: string | null, to?: string | null) {
  const range: { gte?: Date; lte?: Date } = {}
  if (from) range.gte = new Date(`${from}T00:00:00+05:30`)
  if (to) range.lte = new Date(`${to}T23:59:59.999+05:30`)
  return range.gte || range.lte ? range : null
}

/**
 * Stock report for a period, per item: opening and closing stock (from the running balances),
 * quantity and value purchased, used, wasted and corrected.
 */
export async function stockReport(from?: string | null, to?: string | null) {
  const range = dateRange(from, to)
  const items = await prisma.inventoryItem.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] })
  const movements = await prisma.inventoryMovement.findMany({
    where: range?.lte ? { date: { lte: range.lte } } : undefined,
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  })

  const rows = items.map((item) => ({
    itemId: item.id,
    name: item.name,
    category: item.category,
    unit: item.unit,
    active: item.active,
    opening: 0,
    purchasedQty: 0,
    purchasedCost: 0,
    usedQty: 0,
    usedCost: 0,
    wastedQty: 0,
    wastedCost: 0,
    adjustedQty: 0,
    closing: 0,
    closingValue: 0,
    avgCost: item.avgCost,
    hasActivity: false,
  }))
  const byId = new Map(rows.map((r) => [r.itemId, r]))
  const start = range?.gte?.getTime() ?? -Infinity

  for (const m of movements) {
    const row = byId.get(m.itemId)
    if (!row) continue
    const t = new Date(m.date).getTime()
    if (t < start) {
      row.opening = m.balanceAfter
      row.closing = m.balanceAfter
      continue
    }
    row.hasActivity = true
    row.closing = m.balanceAfter
    if (m.type === 'PURCHASE' || m.type === 'OPENING') {
      row.purchasedQty += m.quantity
      row.purchasedCost += m.totalCost
    } else if (m.type === 'ISSUE') {
      row.usedQty += -m.quantity
      row.usedCost += m.totalCost
    } else if (m.type === 'WASTAGE') {
      row.wastedQty += -m.quantity
      row.wastedCost += m.totalCost
    } else if (m.type === 'ADJUSTMENT') {
      row.adjustedQty += m.quantity
    }
  }

  const out = rows
    .map((r) => ({
      ...r,
      opening: q3(r.opening),
      purchasedQty: q3(r.purchasedQty),
      purchasedCost: r2(r.purchasedCost),
      usedQty: q3(r.usedQty),
      usedCost: r2(r.usedCost),
      wastedQty: q3(r.wastedQty),
      wastedCost: r2(r.wastedCost),
      adjustedQty: q3(r.adjustedQty),
      closing: q3(r.closing),
      closingValue: r2(r.closing * r.avgCost),
    }))
    // Archived items only appear when they had stock or activity in the period
    .filter((r) => r.active || r.hasActivity || r.opening > 0)

  return {
    rows: out,
    totals: {
      purchasedCost: r2(out.reduce((s, r) => s + r.purchasedCost, 0)),
      usedCost: r2(out.reduce((s, r) => s + r.usedCost, 0)),
      wastedCost: r2(out.reduce((s, r) => s + r.wastedCost, 0)),
      closingValue: r2(out.reduce((s, r) => s + r.closingValue, 0)),
    },
  }
}
