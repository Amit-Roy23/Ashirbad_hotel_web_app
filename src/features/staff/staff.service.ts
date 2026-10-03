import { prisma } from '@/lib/prisma'
import { logAudit, RequestUser } from '@/services/audit-logger'
import { StaffInput, StaffPaymentInput } from './validation'

export class StaffService {
  static async listStaff() {
    return prisma.staff.findMany({
      orderBy: { name: 'asc' },
      include: {
        payments: {
          orderBy: { date: 'desc' },
          take: 50,
        },
      },
    })
  }

  static async createStaff(data: StaffInput, user: RequestUser) {
    const staff = await prisma.staff.create({
      data: {
        name: data.name,
        phone: data.phone || null,
        role: data.role || 'Staff',
        salary: Number(data.salary) || 0,
        address: data.address || null,
        aadhaar: data.aadhaar || null,
        active: data.active !== false,
      },
    })
    await logAudit('STAFF_CREATE', 'Staff', staff.id, `Added staff member ${staff.name} (${staff.role})`, user)
    return staff
  }

  static async updateStaff(id: string, data: Partial<StaffInput>, user: RequestUser) {
    const staff = await prisma.staff.update({
      where: { id },
      data: {
        ...(data.name && { name: data.name }),
        ...(data.phone !== undefined && { phone: data.phone || null }),
        ...(data.role && { role: data.role }),
        ...(data.salary !== undefined && { salary: Number(data.salary) }),
        ...(data.address !== undefined && { address: data.address || null }),
        ...(data.aadhaar !== undefined && { aadhaar: data.aadhaar || null }),
        ...(data.active !== undefined && { active: data.active }),
      },
    })
    await logAudit('STAFF_UPDATE', 'Staff', id, `Updated staff profile ${staff.name}`, user)
    return staff
  }

  static async recordPayment(data: StaffPaymentInput, user: RequestUser) {
    const staff = await prisma.staff.findUnique({ where: { id: data.staffId } })
    if (!staff) throw new Error('Staff member not found')

    const payment = await prisma.staffPayment.create({
      data: {
        staffId: data.staffId,
        type: data.type,
        amount: Number(data.amount),
        method: data.method || 'CASH',
        recoveryNotes: data.recoveryNotes || null,
        notes: data.notes || null,
      },
    })

    // Auto-create Ledger expense entry for staff payouts
    await prisma.ledgerEntry.create({
      data: {
        type: 'EXPENSE',
        category: data.type === 'ADVANCE' ? 'STAFF_ADVANCE' : 'SALARY',
        description: `Staff payout (${data.type}) to ${staff.name}`,
        amount: Number(data.amount),
        method: data.method || 'CASH',
        source: 'AUTO',
        vendor: staff.name,
        refId: payment.id,
      },
    })

    await logAudit('STAFF_PAYMENT', 'StaffPayment', payment.id, `Recorded ${data.type} of ₹${data.amount} to ${staff.name}`, user)
    return payment
  }
}
