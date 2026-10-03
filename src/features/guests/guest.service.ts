import { prisma } from '@/lib/prisma'
import { logAudit, RequestUser } from '@/services/audit-logger'
import { CreateGuestInput, UpdateGuestInput } from './validation'

export class GuestService {
  static async getAllGuests() {
    return prisma.guest.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        bookings: {
          orderBy: { checkIn: 'desc' },
          include: { room: true, bills: true },
        },
      },
    })
  }

  static async getGuestByPhone(phone: string) {
    return prisma.guest.findUnique({
      where: { phone },
      include: {
        bookings: {
          orderBy: { checkIn: 'desc' },
          include: { room: true, bills: true },
        },
      },
    })
  }

  static async createGuest(data: CreateGuestInput, user: RequestUser) {
    const existing = await prisma.guest.findUnique({ where: { phone: data.phone } })
    if (existing) {
      return this.updateGuest(existing.id, data, user)
    }

    const guest = await prisma.guest.create({
      data: {
        phone: data.phone,
        name: data.name,
        email: data.email || null,
        company: data.company || null,
        gst: data.gst || null,
        address: data.address || null,
        idProof: data.idProof || null,
      },
    })

    await logAudit('GUEST_CREATE', 'Guest', guest.id, `Created guest ${guest.name} (${guest.phone})`, user)
    return guest
  }

  static async updateGuest(id: string, data: UpdateGuestInput, user: RequestUser) {
    const guest = await prisma.guest.update({
      where: { id },
      data: {
        ...(data.phone && { phone: data.phone }),
        ...(data.name && { name: data.name }),
        ...(data.email !== undefined && { email: data.email || null }),
        ...(data.company !== undefined && { company: data.company || null }),
        ...(data.gst !== undefined && { gst: data.gst || null }),
        ...(data.address !== undefined && { address: data.address || null }),
        ...(data.idProof !== undefined && { idProof: data.idProof || null }),
      },
    })

    await logAudit('GUEST_UPDATE', 'Guest', guest.id, `Updated guest ${guest.name}`, user)
    return guest
  }

  static async deleteGuest(id: string, user: RequestUser) {
    const guest = await prisma.guest.findUnique({
      where: { id },
      include: { bookings: true },
    })

    if (!guest) {
      throw new Error('Guest not found')
    }

    if (guest.bookings.length > 0) {
      throw new Error(`Cannot delete guest ${guest.name} who has existing booking records`)
    }

    await prisma.guest.delete({ where: { id } })
    await logAudit('GUEST_DELETE', 'Guest', id, `Deleted guest ${guest.name}`, user)
    return { success: true }
  }
}
