import { prisma } from '@/lib/prisma'
import { logAudit, RequestUser } from '@/services/audit-logger'

export class BookingService {
  static async listBookings(params: {
    status?: string
    paymentStatus?: string
    roomId?: string
    guestId?: string
    from?: string
    to?: string
  }) {
    const { status, paymentStatus, roomId, guestId, from, to } = params
    return prisma.booking.findMany({
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
        foodOrders: { where: { status: 'PENDING' } },
        bills: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    })
  }

  static async refreshBookingPaymentStatus(bookingId: string) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
    if (!booking) return
    let paymentStatus = 'UNPAID'
    if (booking.status === 'CANCELLED') {
      paymentStatus = 'PAID'
    } else {
      const bill = await prisma.bill.findFirst({
        where: { bookingId },
        orderBy: { createdAt: 'desc' },
      })
      if (bill) {
        const paid = bill.payCash + bill.payUpi + bill.payCard
        if (paid >= bill.grandTotal - 0.01) paymentStatus = 'PAID'
        else if (paid > 0) paymentStatus = 'PARTIAL'
      }
    }
    if (paymentStatus !== booking.paymentStatus) {
      await prisma.booking.update({ where: { id: bookingId }, data: { paymentStatus } })
    }
  }
}
