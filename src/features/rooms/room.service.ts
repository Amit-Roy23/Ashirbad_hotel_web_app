import { prisma } from '@/lib/prisma'
import { logAudit, RequestUser } from '@/services/audit-logger'
import { CreateRoomInput, UpdateRoomInput } from './validation'

export class RoomService {
  static async getAllRooms() {
    return prisma.room.findMany({
      orderBy: { number: 'asc' },
      include: {
        bookings: {
          where: { status: 'ACTIVE' },
          include: { guest: true },
        },
        foodOrders: {
          where: { status: 'PENDING' },
          include: { items: true },
        },
      },
    })
  }

  static async createRoom(data: CreateRoomInput, user: RequestUser) {
    const existing = await prisma.room.findUnique({ where: { number: data.number } })
    if (existing) {
      throw new Error(`Room ${data.number} already exists`)
    }

    const room = await prisma.room.create({
      data: {
        number: data.number,
        floor: data.floor || data.number.charAt(0) || '1',
        type: data.type || 'Non-AC',
        capacity: Number(data.capacity) || 2,
        rate: Number(data.rate) || 1000,
        status: data.status || 'VACANT',
        housekeeping: data.housekeeping || 'CLEAN',
        notes: data.notes || null,
      },
    })

    await logAudit('ROOM_CREATE', 'Room', room.id, `Created room ${room.number} (${room.type}, ₹${room.rate})`, user)
    return room
  }

  static async updateRoom(id: string, data: UpdateRoomInput, user: RequestUser) {
    const existing = await prisma.room.findUnique({ where: { id } })
    if (!existing) {
      throw new Error('Room not found')
    }

    const room = await prisma.room.update({
      where: { id },
      data: {
        ...(data.number !== undefined && { number: data.number }),
        ...(data.floor !== undefined && { floor: data.floor }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.capacity !== undefined && { capacity: Number(data.capacity) }),
        ...(data.rate !== undefined && { rate: Number(data.rate) }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.housekeeping !== undefined && { housekeeping: data.housekeeping }),
        ...(data.notes !== undefined && { notes: data.notes }),
      },
    })

    await logAudit('ROOM_UPDATE', 'Room', room.id, `Updated room ${room.number}`, user)
    return room
  }

  static async deleteRoom(id: string, user: RequestUser) {
    const room = await prisma.room.findUnique({
      where: { id },
      include: { bookings: { where: { status: { in: ['ACTIVE', 'BOOKED'] } } } },
    })

    if (!room) {
      throw new Error('Room not found')
    }

    if (room.status === 'OCCUPIED' || room.bookings.length > 0) {
      throw new Error(`Cannot delete room ${room.number}: it is currently occupied or has active bookings`)
    }

    await prisma.room.delete({ where: { id } })
    await logAudit('ROOM_DELETE', 'Room', id, `Deleted room ${room.number}`, user)
    return { success: true }
  }
}
