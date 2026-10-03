import { prisma } from '@/lib/prisma'
import { logAudit, RequestUser } from '@/services/audit-logger'
import { ExpenseInput } from './validation'

export class ExpenseService {
  static async listExpenses(params: { from?: string; to?: string; category?: string }) {
    const { from, to, category } = params
    return prisma.ledgerEntry.findMany({
      where: {
        type: 'EXPENSE',
        ...(category ? { category } : {}),
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
    })
  }

  static async createExpense(data: ExpenseInput, user: RequestUser) {
    const entry = await prisma.ledgerEntry.create({
      data: {
        type: 'EXPENSE',
        category: data.category,
        description: data.description,
        amount: Number(data.amount),
        method: data.method || 'CASH',
        source: 'MANUAL',
        vendor: data.vendor || null,
        date: data.date ? new Date(data.date + 'T12:00:00') : new Date(),
      },
    })
    await logAudit('EXPENSE_CREATE', 'LedgerEntry', entry.id, `Recorded expense of ₹${entry.amount} under ${entry.category}`, user)
    return entry
  }

  static async listCategories() {
    return prisma.expenseCategory.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    })
  }

  static async createCategory(name: string, user: RequestUser) {
    const cleanName = name.trim()
    if (!cleanName) throw new Error('Category name required')
    const category = await prisma.expenseCategory.upsert({
      where: { name: cleanName },
      update: { active: true },
      create: { name: cleanName, active: true },
    })
    await logAudit('EXPENSE_CAT_CREATE', 'ExpenseCategory', category.id, `Created expense category ${cleanName}`, user)
    return category
  }

  static async deleteCategory(id: string, user: RequestUser) {
    const category = await prisma.expenseCategory.update({
      where: { id },
      data: { active: false },
    })
    await logAudit('EXPENSE_CAT_DELETE', 'ExpenseCategory', id, `Deactivated expense category ${category.name}`, user)
    return { success: true }
  }
}
