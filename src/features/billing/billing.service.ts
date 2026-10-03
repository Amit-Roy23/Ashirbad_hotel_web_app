import { prisma } from '@/lib/prisma'
import { logAudit, RequestUser } from '@/services/audit-logger'
import { BookingService } from '@/features/bookings/booking.service'

export class BillingService {
  static async listBills(params: {
    bookingId?: string
    from?: string
    to?: string
    q?: string
  }) {
    const { bookingId, from, to, q } = params
    return prisma.bill.findMany({
      where: {
        ...(bookingId ? { bookingId } : {}),
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: new Date(from + 'T00:00:00') } : {}),
                ...(to ? { lte: new Date(to + 'T23:59:59.999') } : {}),
              },
            }
          : {}),
        ...(q
          ? {
              OR: [
                { billNumber: { contains: q, mode: 'insensitive' } },
                { booking: { guest: { name: { contains: q, mode: 'insensitive' } } } },
                { booking: { guest: { phone: { contains: q } } } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        booking: {
          include: {
            room: true,
            guest: true,
            foodOrders: { include: { items: true } },
          },
        },
      },
    })
  }

  static async deleteBill(id: string, user: RequestUser) {
    const bill = await prisma.bill.findUnique({
      where: { id },
      include: { booking: true },
    })

    if (!bill) {
      throw new Error('Bill not found')
    }

    await prisma.bill.delete({ where: { id } })
    await BookingService.refreshBookingPaymentStatus(bill.bookingId)
    await logAudit('DELETE_BILL', 'Bill', id, `Deleted bill ${bill.billNumber}`, user)
    return { success: true }
  }
}
