import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

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
  gstPercent: '12',
  invoicePrefix: 'INV',
  invoiceCounter: '1',
}

async function getSettingsMap(): Promise<Record<string, string>> {
  const rows = await prisma.setting.findMany()
  const map = { ...DEFAULT_SETTINGS }
  for (const r of rows) map[r.key] = r.value
  return map
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

function parseDateInput(value: unknown, fallbackTime = 'T12:00:00'): Date | null {
  if (value === undefined || value === null || value === '') return null
  const s = String(value).trim()
  if (!s) return null
  const d = /\d{2}:\d{2}/.test(s) ? new Date(s.replace(' ', 'T')) : new Date(s + fallbackTime)
  return isNaN(d.getTime()) ? null : d
}

/** Recompute PARTIAL | PAID for a booking from its latest bill */
async function refreshBookingPaymentStatus(bookingId: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } })
  if (!booking) return
  let paymentStatus = 'PAID'
  if (booking.status === 'CANCELLED' || booking.status === 'BOOKED') {
    paymentStatus = 'PAID'
  } else {
    const bill = await prisma.bill.findFirst({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
    })
    if (bill) {
      const paid = (bill.advanceApplied || 0) + bill.payCash + bill.payUpi + bill.payCard
      if (paid >= bill.grandTotal - 0.01) paymentStatus = 'PAID'
      else paymentStatus = 'PARTIAL'
    } else {
      paymentStatus = 'PAID'
    }
  }
  if (paymentStatus !== booking.paymentStatus) {
    await prisma.booking.update({ where: { id: bookingId }, data: { paymentStatus } })
  }
}

// ============ ROOMS ============
async function listRooms(req: NextRequest) {
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
        include: { guest: true },
        orderBy: { checkIn: 'asc' },
      },
    },
  })
  const filtered = floor ? rooms.filter((r) => r.number.startsWith(floor)) : rooms
  return NextResponse.json(filtered)
}

async function createRoom(body: Record<string, unknown>) {
  const { number, floor, type, capacity, rate, notes } = body
  if (!number) return NextResponse.json({ error: 'Room number required' }, { status: 400 })
  const cleanNumber = String(number).replace(/\D/g, '').trim()
  if (!cleanNumber) return NextResponse.json({ error: 'Room number must only contain digits' }, { status: 400 })
  const exists = await prisma.room.findUnique({ where: { number: cleanNumber } })
  if (exists) return NextResponse.json({ error: `Room ${cleanNumber} already exists` }, { status: 400 })
  const room = await prisma.room.create({
    data: {
      number: cleanNumber,
      floor: floor ? String(floor) : cleanNumber.charAt(0) || '1',
      type: type ? String(type) : 'Non-AC',
      capacity: parseInt(String(capacity)) || 2,
      rate: num(rate) || 800,
      notes: notes ? String(notes) : null,
    },
  })
  return NextResponse.json(room)
}

async function updateRoom(body: Record<string, unknown>) {
  const { id, floor, status, housekeeping, rate, type, capacity, notes } = body
  if (!id) return NextResponse.json({ error: 'Room id required' }, { status: 400 })
  const room = await prisma.room.update({
    where: { id: String(id) },
    data: {
      ...(floor !== undefined && { floor: String(floor) }),
      ...(status !== undefined && { status: String(status) }),
      ...(housekeeping !== undefined && { housekeeping: String(housekeeping) }),
      ...(rate !== undefined && { rate: num(rate) }),
      ...(type !== undefined && { type: String(type) }),
      ...(capacity !== undefined && { capacity: parseInt(String(capacity)) }),
      ...(notes !== undefined && { notes: String(notes) }),
    },
  })
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

  await prisma.room.delete({ where: { id } })
  await logAudit('DELETE_ROOM', 'Room', id, `Deleted room ${room.number}`, user)
  return NextResponse.json({ success: true, message: `Room ${room.number} deleted successfully` })
}

// ============ GUESTS ============
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
          bills: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      },
    },
  })
  return NextResponse.json(guests)
}

async function lookupGuest(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const phone = searchParams.get('phone') || ''
  const guest = await prisma.guest.findFirst({
    where: { phone: { contains: phone } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(guest || null)
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

// ============ BOOKINGS ============
async function listBookings(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const paymentStatus = searchParams.get('paymentStatus')
  const roomId = searchParams.get('roomId')
  const guestId = searchParams.get('guestId')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  // Clean any legacy UNPAID records in DB
  await prisma.booking.updateMany({
    where: {
      paymentStatus: 'UNPAID',
      OR: [
        { status: { in: ['BOOKED', 'ACTIVE', 'CANCELLED'] } },
      ],
    },
    data: { paymentStatus: 'PAID' },
  }).catch(() => {})

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
      foodOrders: { where: { status: 'PENDING' } },
      bills: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })
  return NextResponse.json(bookings)
}

async function createBooking(body: Record<string, unknown>, user: RequestUser) {
  const {
    roomId, phone, name, company, gst, address, checkIn, checkOut,
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
  if (parsedGuestCount < 1 || parsedGuestCount > 4) {
    return NextResponse.json(
      { error: 'Maximum 4 guests allowed per room (must be between 1 and 4)' },
      { status: 400 }
    )
  }
  const room = await prisma.room.findUnique({ where: { id: String(roomId) } })
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 })

  const checkInDate = checkIn
    ? parseDateInput(checkIn, 'T12:00:00')
    : new Date(new Date().setHours(12, 0, 0, 0))
  if (!checkInDate) {
    return NextResponse.json(
      { error: 'Invalid check-in date. Please pick the date again and retry.' },
      { status: 400 }
    )
  }
  const today = new Date()
  const isFuture =
    checkInDate.getFullYear() > today.getFullYear() ||
    (checkInDate.getFullYear() === today.getFullYear() && checkInDate.getMonth() === today.getMonth() && checkInDate.getDate() > today.getDate())

  const isAdvanceBooking = bookingType === 'BOOKING' || reqStatus === 'BOOKED' || isFuture

  if (!isAdvanceBooking && room.status === 'OCCUPIED') {
    return NextResponse.json({ error: `Room ${room.number} is currently occupied` }, { status: 400 })
  }
  if (room.status === 'MAINTENANCE') {
    return NextResponse.json({ error: `Room ${room.number} is under maintenance` }, { status: 400 })
  }

  const checkOutDate = checkOut ? parseDateInput(checkOut, 'T11:00:00') : null
  if (checkOut && !checkOutDate) {
    return NextResponse.json(
      { error: 'Invalid check-out date. Please pick the date again and retry.' },
      { status: 400 }
    )
  }
  let days = 1
  if (checkOutDate) {
    const diff = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24))
    days = Math.max(1, diff)
  }

  // Double-booking prevention
  const overlapFrom = checkOutDate || new Date(checkInDate.getTime() + 24 * 3600 * 1000)
  const overlapping = await prisma.booking.findFirst({
    where: {
      roomId: String(roomId),
      status: { in: ['ACTIVE', 'BOOKED'] },
      OR: [
        { checkIn: { lt: overlapFrom }, OR: [{ checkOut: { gt: checkInDate } }, { checkOut: null }] },
      ],
    },
    include: { guest: true },
  })
  if (overlapping) {
    const fromStr = formatDate(overlapping.checkIn)
    const toStr = overlapping.checkOut ? formatDate(overlapping.checkOut) : 'open'
    return NextResponse.json(
      {
        error: `Room ${room.number} is already reserved for ${overlapping.guest.name} from ${fromStr} to ${toStr}. Please choose a stay period before or after this reservation.`,
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
      },
      create: {
        phone: cleanPhone,
        name: String(name),
        ...(company ? { company: String(company) } : {}),
        ...(gst ? { gst: String(gst) } : {}),
        ...(address ? { address: String(address) } : {}),
      },
    })

    const newBooking = await tx.booking.create({
      data: {
        roomId: String(roomId),
        guestId: guest.id,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        days,
        guestCount: parsedGuestCount,
        ratePerDay: room.rate,
        status: isAdvanceBooking ? 'BOOKED' : 'ACTIVE',
        paymentStatus: 'PAID',
        advance: adv,
        isCorporate: !!isCorporate,
        notes: notes ? String(notes) : null,
      },
      include: { room: true, guest: true },
    })

    if (isAdvanceBooking) {
      if (!isFuture) {
        await tx.room.update({ where: { id: String(roomId) }, data: { status: 'BOOKED' } })
      }
    } else {
      await tx.room.update({ where: { id: String(roomId) }, data: { status: 'OCCUPIED' } })
    }

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
  const { id, action, checkOut, newRoomId } = body
  const booking = await prisma.booking.findUnique({ where: { id: String(id) }, include: { room: true, guest: true } })
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  if (action === 'checkin') {
    if (booking.status !== 'BOOKED') {
      return NextResponse.json({ error: 'Only booked reservations can be checked in' }, { status: 400 })
    }
    const room = await prisma.room.findUnique({ where: { id: booking.roomId } })
    if (!room || (room.status !== 'VACANT' && room.status !== 'BOOKED')) {
      return NextResponse.json({ error: `Room ${booking.room.number} is not available` }, { status: 400 })
    }
    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id: String(id) },
        data: { status: 'ACTIVE' },
      })
      await tx.room.update({ where: { id: booking.roomId }, data: { status: 'OCCUPIED' } })
      return b
    })
    await logAudit('CHECKIN', 'Booking', booking.id, `Checked in: ${booking.guest.name} → Room ${booking.room.number}`, user)
    return NextResponse.json(updated)
  }

  if (action === 'checkout') {
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
    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id: String(id) },
        data: { status: 'COMPLETED', actualCheckOut: new Date() },
      })
      await tx.room.update({
        where: { id: booking.roomId },
        data: { status: 'VACANT', housekeeping: 'DIRTY' },
      })
      return b
    })
    await refreshBookingPaymentStatus(booking.id)
    await logAudit('CHECKOUT', 'Booking', booking.id, `Checked out: ${booking.guest.name} from Room ${booking.room.number}`, user)
    return NextResponse.json(updated)
  }

  if (action === 'extend') {
    const newCheckOut = checkOut ? parseDateInput(checkOut, 'T11:00:00') : null
    if (!newCheckOut) return NextResponse.json({ error: 'Valid new checkout date required' }, { status: 400 })

    // Double-booking check when extending stay
    const overlapFuture = await prisma.booking.findFirst({
      where: {
        roomId: booking.roomId,
        id: { not: booking.id },
        status: { in: ['ACTIVE', 'BOOKED'] },
        checkIn: { lt: newCheckOut },
        OR: [{ checkOut: { gt: new Date(booking.checkIn) } }, { checkOut: null }],
      },
      include: { guest: true },
    })
    if (overlapFuture) {
      return NextResponse.json(
        {
          error: `Cannot extend stay: Room ${booking.room.number} is reserved for ${overlapFuture.guest.name} starting ${formatDate(overlapFuture.checkIn)}. Max checkout allowed is ${formatDate(overlapFuture.checkIn)}.`,
        },
        { status: 400 }
      )
    }

    const diff = Math.ceil(
      (newCheckOut.getTime() - new Date(booking.checkIn).getTime()) / (1000 * 60 * 60 * 24)
    )
    const days = Math.max(1, diff)
    const updated = await prisma.booking.update({
      where: { id: String(id) },
      data: { checkOut: newCheckOut, days },
    })
    await logAudit('EXTEND', 'Booking', booking.id, `Stay extended: ${booking.guest.name} (Room ${booking.room.number}) → new checkout ${newCheckOut.toDateString()}`, user)
    return NextResponse.json(updated)
  }

  if (action === 'change-room') {
    if (!newRoomId) return NextResponse.json({ error: 'New room required' }, { status: 400 })
    if (booking.status !== 'ACTIVE') {
      return NextResponse.json({ error: 'Only active bookings can change room' }, { status: 400 })
    }
    const newRoom = await prisma.room.findUnique({ where: { id: String(newRoomId) } })
    if (!newRoom) return NextResponse.json({ error: 'New room not found' }, { status: 404 })
    if (newRoom.status !== 'VACANT') {
      return NextResponse.json({ error: `Room ${newRoom.number} is not vacant` }, { status: 400 })
    }
    const updated = await prisma.$transaction(async (tx) => {
      await tx.room.update({ where: { id: booking.roomId }, data: { status: 'VACANT', housekeeping: 'DIRTY' } })
      await tx.room.update({ where: { id: newRoom.id }, data: { status: 'OCCUPIED' } })
      await tx.booking.update({ where: { id: booking.id }, data: { roomId: newRoom.id } })
      await tx.foodOrder.updateMany({
        where: { bookingId: booking.id, status: 'PENDING' },
        data: { roomId: newRoom.id },
      })
      return tx.booking.findUnique({
        where: { id: String(id) },
        include: { room: true, guest: true },
      })
    })
    await logAudit('CHANGE_ROOM', 'Booking', booking.id, `Room change: ${booking.guest.name} moved ${booking.room.number} → ${newRoom.number}`, user)
    return NextResponse.json(updated)
  }

  if (action === 'cancel') {
    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.booking.update({
        where: { id: String(id) },
        data: { status: 'CANCELLED', actualCheckOut: new Date() },
      })
      if (booking.status === 'ACTIVE') {
        await tx.room.update({
          where: { id: booking.roomId },
          data: { status: 'VACANT', housekeeping: 'DIRTY' },
        })
      } else {
        await tx.room.update({
          where: { id: booking.roomId },
          data: { status: 'VACANT' },
        })
      }
      return b
    })
    await refreshBookingPaymentStatus(booking.id)
    await logAudit('BOOKING_CANCEL', 'Booking', booking.id, `Cancelled: ${booking.guest.name} (Room ${booking.room.number})`, user)
    return NextResponse.json(updated)
  }

  if (action === 'update') {
    const {
      name,
      phone,
      company,
      gst,
      address,
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

    if (name || phone || company !== undefined || gst !== undefined || address !== undefined) {
      const guestData: Record<string, string> = {}
      if (name) guestData.name = String(name).trim()
      if (phone) {
        const clean = String(phone).replace(/\D/g, '')
        if (clean) guestData.phone = clean
      }
      if (company !== undefined) guestData.company = String(company)
      if (gst !== undefined) guestData.gst = String(gst)
      if (address !== undefined) guestData.address = String(address)

      await prisma.guest.update({
        where: { id: booking.guestId },
        data: guestData,
      })
    }

    const updateData: Record<string, unknown> = {}
    if (ratePerDay !== undefined) updateData.ratePerDay = num(ratePerDay)
    if (advance !== undefined) updateData.advance = num(advance)
    if (guestCount !== undefined) {
      const parsedGuestCount = parseInt(String(guestCount)) || 1
      if (parsedGuestCount < 1 || parsedGuestCount > 4) {
        return NextResponse.json(
          { error: 'Maximum 4 guests allowed per room (must be between 1 and 4)' },
          { status: 400 }
        )
      }
      updateData.guestCount = parsedGuestCount
    }
    if (notes !== undefined) updateData.notes = String(notes)
    if (isCorporate !== undefined) updateData.isCorporate = !!isCorporate

    if (checkIn !== undefined) {
      const parsedCheckIn = parseDateInput(checkIn, 'T12:00:00')
      if (parsedCheckIn) updateData.checkIn = parsedCheckIn
    }
    if (checkOut !== undefined) {
      const parsedCheckOut = parseDateInput(checkOut, 'T11:00:00')
      if (parsedCheckOut) updateData.checkOut = parsedCheckOut
    }
    if (days !== undefined) {
      updateData.days = Math.max(1, parseInt(String(days)) || 1)
    } else if (updateData.checkIn && updateData.checkOut) {
      const diff = Math.ceil(
        ((updateData.checkOut as Date).getTime() - (updateData.checkIn as Date).getTime()) /
          (1000 * 60 * 60 * 24)
      )
      updateData.days = Math.max(1, diff)
    }

    const updated = await prisma.booking.update({
      where: { id: String(id) },
      data: updateData,
      include: { room: true, guest: true },
    })

    if (advance !== undefined) {
      const advNum = num(advance)
      const existingLedger = await prisma.ledgerEntry.findFirst({
        where: { refId: booking.id, category: 'ADVANCE' },
      })
      if (existingLedger) {
        if (advNum > 0) {
          await prisma.ledgerEntry.update({
            where: { id: existingLedger.id },
            data: {
              amount: advNum,
              description: `Advance from ${name || booking.guest.name} (Room ${booking.room.number})`,
              ...(advanceMethod ? { method: String(advanceMethod) } : {}),
            },
          })
        } else {
          await prisma.ledgerEntry.delete({ where: { id: existingLedger.id } })
        }
      } else if (advNum > 0) {
        await prisma.ledgerEntry.create({
          data: {
            date: new Date(),
            type: 'INCOME',
            category: 'ADVANCE',
            description: `Advance from ${name || booking.guest.name} (Room ${booking.room.number})`,
            amount: advNum,
            method: advanceMethod ? String(advanceMethod) : 'CASH',
            source: 'AUTO',
            refId: booking.id,
          },
        })
      }
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
  const {
    bookingId, days, billedRoomTotal, roomDescription, roomNumber, gstPercent, extraCharges, discount,
    payCash, payUpi, payCard, includeFood, corporateName, gstNumber, notes, checkout,
    managerPin,
  } = body

  const booking = await prisma.booking.findUnique({
    where: { id: String(bookingId) },
    include: { room: true, guest: true },
  })
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  const settings = await getSettingsMap()
  const billDays = parseInt(String(days)) || booking.days
  const actualRoomTotal = booking.ratePerDay * billDays
  const customRoom = parseFloat(String(billedRoomTotal))
  const billedRoom = !isNaN(customRoom) && customRoom > 0 ? customRoom : actualRoomTotal

  const realRoomType = booking.room.type || 'Non-AC'
  const cleanRoomDesc = roomDescription !== undefined && roomDescription !== null ? String(roomDescription).trim() : null
  const cleanRoomNumber = roomNumber !== undefined && roomNumber !== null && String(roomNumber).trim() !== '' ? String(roomNumber).trim() : null

  // Permission control for custom corporate billing
  const isCustomRoomAmount = Math.abs(billedRoom - actualRoomTotal) > 0.01 || (billedRoomTotal !== undefined && parseFloat(String(billedRoomTotal)) > 0 && Math.abs(parseFloat(String(billedRoomTotal)) - actualRoomTotal) > 0.01)
  const isCustomDescription = cleanRoomDesc !== null && cleanRoomDesc !== '' && cleanRoomDesc !== realRoomType
  const isCustomRoomNumber = cleanRoomNumber !== null && cleanRoomNumber !== booking.room.number
  const isCustom = isCustomRoomAmount || isCustomDescription || isCustomRoomNumber

  if (isCustom) {
    if (!managerPin) {
      return NextResponse.json(
        { error: 'Custom corporate billing requires Manager or Admin PIN approval' },
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
        { error: 'Custom billing blocked: Invalid Manager or Admin PIN' },
        { status: 403 }
      )
    }
    user = { id: approver.id, name: approver.name, role: approver.role }
  }

  let foodTotal = 0
  let pendingOrders: { id: string }[] = []
  if (includeFood === true) {
    pendingOrders = await prisma.foodOrder.findMany({
      where: { bookingId: booking.id, status: 'PENDING' },
      select: { id: true },
    })
    const agg = await prisma.foodOrder.aggregate({
      where: { bookingId: booking.id, status: 'PENDING' },
      _sum: { total: true },
    })
    foodTotal = agg._sum.total || 0
  }

  const extra = num(extraCharges)
  const disc = num(discount)

  if (gstPercent !== undefined && gstPercent !== null && gstPercent !== '') {
    const parsedGst = parseFloat(String(gstPercent))
    if (isNaN(parsedGst) || !isFinite(parsedGst) || parsedGst < 0 || parsedGst > 100) {
      return NextResponse.json(
        { error: 'GST percentage must be a valid number between 0 and 100' },
        { status: 400 }
      )
    }
  }

  const gstPct = gstPercent !== undefined && gstPercent !== '' ? num(gstPercent) : parseFloat(settings.gstPercent) || 0

  // Full customer-facing calculation
  const taxable = Math.max(0, billedRoom + foodTotal + extra - disc)
  const billedGst = Math.round(taxable * gstPct) / 100
  const grandTotal = Math.max(0, Math.round((taxable + billedGst) * 100) / 100)
  const advanceApplied = Math.min(booking.advance || 0, grandTotal)
  const payableNow = Math.max(0, Math.round((grandTotal - advanceApplied) * 100) / 100)

  // Hotel internal accounting calculation
  const internalTaxable = Math.max(0, actualRoomTotal + foodTotal + extra - disc)
  const internalGst = Math.round(internalTaxable * gstPct) / 100
  const internalTotal = Math.max(0, Math.round((internalTaxable + internalGst) * 100) / 100)

  const cash = num(payCash)
  const upi = num(payUpi)
  const card = num(payCard)
  const paidTotal = cash + upi + card
  if (paidTotal > payableNow + 0.01) {
    return NextResponse.json(
      { error: `Payment split (₹${paidTotal}) cannot exceed payable amount (₹${payableNow})` },
      { status: 400 }
    )
  }

  const prefix = settings.invoicePrefix || 'INV'
  const counter = parseInt(settings.invoiceCounter) || 1
  const billNumber = `${prefix}-${String(counter).padStart(4, '0')}`

  const bill = await prisma.$transaction(async (tx) => {
    await tx.setting.update({ where: { key: 'invoiceCounter' }, data: { value: String(counter + 1) } })

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
        actualGst: billedGst,
        internalGst,
        internalTotal,
        foodTotal,
        extraCharges: extra,
        discount: disc,
        grandTotal,
        payCash: cash,
        payUpi: upi,
        payCard: card,
        advanceApplied,
        isCorporate: isCustom || !!booking.isCorporate,
        corporateName: corporateName ? String(corporateName) : booking.guest.company || null,
        gstNumber: gstNumber ? String(gstNumber) : booking.guest.gst || null,
        createdBy: user.name || null,
        approvedBy: isCustom ? user.name || null : null,
        status: body.status === 'DRAFT' ? 'DRAFT' : 'FINAL',
        notes: notes ? String(notes) : null,
      },
    })

    await tx.auditLog.create({
      data: {
        action: body.status === 'DRAFT' ? 'BILL_DRAFT_CREATED' : 'BILL_FINALIZED',
        entity: 'Bill',
        entityId: createdBill.id,
        details: `Bill ${billNumber} (${body.status === 'DRAFT' ? 'Draft' : 'Final'}) created by ${user.name || 'Staff'}. Real Amount: ₹${actualRoomTotal}, Billed Amount: ₹${billedRoom}, GST: ${gstPct}% (₹${billedGst}), Grand Total: ₹${grandTotal}, Room: ${cleanRoomNumber || booking.room.number}`,
        userName: user.name || 'Staff',
        userRole: user.role || 'RECEPTION',
      },
    })

    if (pendingOrders.length > 0) {
      await tx.foodOrder.updateMany({
        where: { id: { in: pendingOrders.map((o) => o.id) } },
        data: { status: 'ADDED_TO_BILL' },
      })
    }

    const ledgerEntries: {
      date: Date
      type: string
      category: string
      description: string
      amount: number
      method: string
      source: string
      refId: string
    }[] = []

    if (actualRoomTotal > 0) {
      ledgerEntries.push({
        date: new Date(),
        type: 'INCOME',
        category: 'ROOM_RENT',
        description: `Room ${booking.room.number} rent (${billDays} day${billDays > 1 ? 's' : ''} @ ₹${booking.ratePerDay}) - ${booking.guest.name}`,
        amount: actualRoomTotal,
        method: 'SPLIT',
        source: 'AUTO',
        refId: createdBill.id,
      })
    }
    if (foodTotal > 0) {
      ledgerEntries.push({
        date: new Date(),
        type: 'INCOME',
        category: 'FOOD',
        description: `Food charges - Room ${booking.room.number} - ${booking.guest.name}`,
        amount: foodTotal,
        method: 'SPLIT',
        source: 'AUTO',
        refId: createdBill.id,
      })
    }
    if (internalGst > 0) {
      ledgerEntries.push({
        date: new Date(),
        type: 'INCOME',
        category: 'GST',
        description: `GST ${gstPct}% on bill ${billNumber}`,
        amount: internalGst,
        method: 'SPLIT',
        source: 'AUTO',
        refId: createdBill.id,
      })
    }
    if (ledgerEntries.length > 0) {
      await tx.ledgerEntry.createMany({ data: ledgerEntries })
    }

    if (checkout !== false) {
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: 'COMPLETED', actualCheckOut: new Date() },
      })
      await tx.room.update({
        where: { id: booking.roomId },
        data: { status: 'VACANT', housekeeping: 'DIRTY' },
      })
    }

    return createdBill
  })

  await refreshBookingPaymentStatus(booking.id)

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

  const alreadyPaid = bill.payCash + bill.payUpi + bill.payCard
  const payableNow = bill.grandTotal - bill.advanceApplied
  const outstanding = Math.max(0, Math.round((payableNow - alreadyPaid) * 100) / 100)

  if (alreadyPaid + adding > payableNow + 0.01) {
    return NextResponse.json(
      { error: `Payment exceeds outstanding balance (₹${outstanding.toFixed(2)})` },
      { status: 400 }
    )
  }

  const updated = await prisma.bill.update({
    where: { id: bill.id },
    data: {
      payCash: bill.payCash + cash,
      payUpi: bill.payUpi + upi,
      payCard: bill.payCard + card,
    },
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

async function updateBill(body: Record<string, unknown>, user: RequestUser) {
  const {
    id, billedRoomTotal, roomDescription, roomNumber, gstPercent, extraCharges, discount,
    payCash, payUpi, payCard, corporateName, gstNumber, notes, roomId, managerPin,
  } = body

  if (!id) return NextResponse.json({ error: 'Bill ID is required' }, { status: 400 })

  const bill = await prisma.bill.findUnique({
    where: { id: String(id) },
    include: { booking: { include: { room: true, guest: true } } },
  })
  if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 })

  // Validate gstPercent if provided
  let newGstPercent = bill.gstPercent
  if (gstPercent !== undefined && gstPercent !== null && gstPercent !== '') {
    const parsedGst = parseFloat(String(gstPercent))
    if (isNaN(parsedGst) || !isFinite(parsedGst) || parsedGst < 0 || parsedGst > 100) {
      return NextResponse.json(
        { error: 'GST percentage must be a valid number between 0 and 100' },
        { status: 400 }
      )
    }
    newGstPercent = parsedGst
  }

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
    (gstPercent !== undefined && num(gstPercent) !== bill.gstPercent) ||
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

  // Taxable and GST calculation based on customer-facing amount
  const taxable = Math.max(0, newBilledRoom + bill.foodTotal + extra - disc)
  const newBilledGst = Math.round(taxable * newGstPercent) / 100
  const newGrandTotal = Math.max(0, Math.round((taxable + newBilledGst) * 100) / 100)
  const advanceApplied = Math.min(bill.booking.advance || 0, newGrandTotal)
  const payableNow = Math.max(0, Math.round((newGrandTotal - advanceApplied) * 100) / 100)

  // Internal accounting calculation
  const internalTaxable = Math.max(0, actualRoomTotal + bill.foodTotal + extra - disc)
  const internalGst = Math.round(internalTaxable * newGstPercent) / 100
  const internalTotal = Math.max(0, Math.round((internalTaxable + internalGst) * 100) / 100)

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

  const updatedBill = await prisma.$transaction(async (tx) => {
    // Optional room change for booking if requested
    if (roomId && String(roomId) !== bill.booking.roomId && (!isFinalized || managerPin)) {
      const targetRoom = await tx.room.findUnique({ where: { id: String(roomId) } })
      if (targetRoom) {
        await tx.booking.update({
          where: { id: bill.bookingId },
          data: { roomId: targetRoom.id },
        })
      }
    }

    const updated = await tx.bill.update({
      where: { id: bill.id },
      data: {
        billedRoomTotal: newBilledRoom,
        roomNumber: newRoomNumber,
        roomDescription: newRoomDescription,
        gstPercent: newGstPercent,
        actualGst: newBilledGst,
        internalGst,
        internalTotal,
        extraCharges: extra,
        discount: disc,
        grandTotal: newGrandTotal,
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

    if (isFinalized && isFinancialChange) {
      await tx.auditLog.create({
        data: {
          action: 'ADMIN_BILL_CORRECTION',
          entity: 'Bill',
          entityId: bill.id,
          details: `Finalized bill ${bill.billNumber} modified by ${user.name || 'Admin'}. Old Total: ₹${bill.grandTotal}, New Total: ₹${newGrandTotal}, Billed Room: ₹${newBilledRoom}, GST: ${newGstPercent}% (₹${newBilledGst}), Room: ${newRoomNumber || bill.booking.room.number}`,
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
          details: `Bill ${bill.billNumber} finalized by ${user.name || 'Staff'}. Total: ₹${newGrandTotal}, Billed Room: ₹${newBilledRoom}, GST: ${newGstPercent}% (₹${newBilledGst}), Room: ${newRoomNumber || bill.booking.room.number}`,
          userName: user.name || 'Staff',
          userRole: user.role || 'RECEPTION',
        },
      })
    }

    // Sync corresponding ledger entries
    await tx.ledgerEntry.deleteMany({
      where: { refId: bill.id },
    })

    const ledgerEntries: {
      date: Date
      type: string
      category: string
      description: string
      amount: number
      method: string
      source: string
      refId: string
    }[] = []

    if (actualRoomTotal > 0) {
      ledgerEntries.push({
        date: bill.createdAt,
        type: 'INCOME',
        category: 'ROOM_RENT',
        description: `Room ${bill.booking.room.number} rent (${bill.days} day${bill.days > 1 ? 's' : ''} @ ₹${bill.booking.ratePerDay}) - ${bill.booking.guest.name}`,
        amount: actualRoomTotal,
        method: 'SPLIT',
        source: 'AUTO',
        refId: bill.id,
      })
    }
    if (bill.foodTotal > 0) {
      ledgerEntries.push({
        date: bill.createdAt,
        type: 'INCOME',
        category: 'FOOD',
        description: `Food charges - Room ${bill.booking.room.number} - ${bill.booking.guest.name}`,
        amount: bill.foodTotal,
        method: 'SPLIT',
        source: 'AUTO',
        refId: bill.id,
      })
    }
    if (internalGst > 0) {
      ledgerEntries.push({
        date: bill.createdAt,
        type: 'INCOME',
        category: 'GST',
        description: `GST ${newGstPercent}% on bill ${bill.billNumber}`,
        amount: internalGst,
        method: 'SPLIT',
        source: 'AUTO',
        refId: bill.id,
      })
    }

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
    `Updated bill ${bill.billNumber}: customer amount ₹${newBilledRoom} (actual ₹${actualRoomTotal}), GST ${newGstPercent}% (₹${newBilledGst}), grand total ₹${newGrandTotal}`,
    user
  )

  const reloadedBill = await prisma.bill.findUnique({
    where: { id: bill.id },
    include: { booking: { include: { room: true, guest: true } } },
  })

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

async function deleteMenuItem(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await prisma.menuItem.delete({ where: { id } })
  return NextResponse.json({ ok: true })
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
  const total = items.reduce(
    (s: number, it: { price: number; quantity: number }) => s + (it.price || 0) * (it.quantity || 1),
    0
  )
  const order = await prisma.foodOrder.create({
    data: {
      bookingId: bookingId ? String(bookingId) : null,
      roomId: roomId ? String(roomId) : null,
      tableNo: tableNo ? String(tableNo) : null,
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
    const payMethod = method ? String(method) : 'CASH'
    const updated = await prisma.$transaction(async (tx) => {
      const ord = await tx.foodOrder.update({ where: { id: String(id) }, data: { status: 'PAID' } })
      await tx.ledgerEntry.create({
        data: {
          date: new Date(),
          type: 'INCOME',
          category: 'FOOD',
          description: `Restaurant order${order.tableNo ? ` (Table ${order.tableNo})` : ''}${order.room ? ` - Room ${order.room.number}` : ''}`,
          amount: order.total,
          method: payMethod,
          source: 'AUTO',
          refId: order.id,
        },
      })
      return ord
    })
    await logAudit('ORDER_PAID', 'FoodOrder', order.id, `Direct restaurant payment ₹${order.total} via ${payMethod}`, user)
    return NextResponse.json(updated)
  }
  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// ============ STAFF ============
async function listStaff(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')
  const role = searchParams.get('role')
  const staff = await prisma.staff.findMany({
    where: {
      ...(role ? { role } : {}),
      ...(q
        ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { role: { contains: q, mode: 'insensitive' } },
          ],
        }
        : {}),
    },
    orderBy: { name: 'asc' },
    include: { payments: { orderBy: { date: 'desc' } } },
  })
  return NextResponse.json(staff)
}

async function createStaff(body: Record<string, unknown>) {
  const { name, phone, role, salary, joinDate, address, aadhaar } = body
  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 })
  let cleanPhone: string | null = null
  if (phone) {
    const digits = String(phone).replace(/\D/g, '')
    if (digits.length !== 10) {
      return NextResponse.json(
        { error: 'Staff phone number must be a valid 10-digit mobile number.' },
        { status: 400 }
      )
    }
    cleanPhone = digits
  }
  const staff = await prisma.staff.create({
    data: {
      name: String(name),
      phone: cleanPhone,
      role: role ? String(role) : 'Staff',
      salary: num(salary),
      joinDate: joinDate ? new Date(String(joinDate)) : new Date(),
      address: address ? String(address) : null,
      aadhaar: aadhaar ? String(aadhaar) : null,
    },
  })
  return NextResponse.json(staff)
}

async function updateStaff(body: Record<string, unknown>) {
  const { id, name, phone, role, salary, address, aadhaar, active } = body
  if (!id) return NextResponse.json({ error: 'Staff id required' }, { status: 400 })
  let cleanPhone: string | null | undefined = undefined
  if (phone !== undefined) {
    if (phone) {
      const digits = String(phone).replace(/\D/g, '')
      if (digits.length !== 10) {
        return NextResponse.json(
          { error: 'Staff phone number must be a valid 10-digit mobile number.' },
          { status: 400 }
        )
      }
      cleanPhone = digits
    } else {
      cleanPhone = null
    }
  }
  const staff = await prisma.staff.update({
    where: { id: String(id) },
    data: {
      ...(name !== undefined && { name: String(name) }),
      ...(cleanPhone !== undefined && { phone: cleanPhone }),
      ...(role !== undefined && { role: String(role) }),
      ...(salary !== undefined && { salary: num(salary) }),
      ...(address !== undefined && { address: String(address) }),
      ...(aadhaar !== undefined && { aadhaar: String(aadhaar) }),
      ...(active !== undefined && { active: !!active }),
    },
  })
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

  await prisma.$transaction(async (tx) => {
    await tx.foodOrder.deleteMany({ where: { bookingId: id } })
    await tx.bill.deleteMany({ where: { bookingId: id } })
    await tx.booking.delete({ where: { id } })
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

  await prisma.$transaction(async (tx) => {
    await tx.ledgerEntry.deleteMany({ where: { refId: bill.id } })
    await tx.bill.delete({ where: { id: bill.id } })
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

  await prisma.foodOrder.delete({ where: { id } })
  await logAudit('DELETE_ORDER', 'FoodOrder', id, `Deleted food order ₹${order.total}`, user)
  return NextResponse.json({ success: true, message: 'Food order deleted successfully' })
}

async function deleteStaffPayment(req: NextRequest, user: RequestUser) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Payment id required' }, { status: 400 })

  const payment = await prisma.staffPayment.findUnique({
    where: { id },
    include: { staff: true },
  })

  if (!payment) return NextResponse.json({ error: 'Payment record not found' }, { status: 404 })

  await prisma.staffPayment.delete({ where: { id } })
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
  const { staffId, type, amount, method, date, notes, recoveryNotes } = body
  if (!staffId || !amount) {
    return NextResponse.json({ error: 'Staff and amount required' }, { status: 400 })
  }
  const staff = await prisma.staff.findUnique({ where: { id: String(staffId) } })
  if (!staff) return NextResponse.json({ error: 'Staff not found' }, { status: 404 })

  const amt = num(amount)
  const payMethod = method ? String(method) : 'CASH'
  const paymentDate = (parseDateInput(date, 'T12:00:00') as Date) || new Date()
  const paymentType = type ? String(type) : 'SALARY'
  const category = paymentType === 'ADVANCE' ? 'STAFF_ADVANCE' : 'SALARY'

  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.staffPayment.create({
      data: {
        staffId: String(staffId),
        type: paymentType,
        amount: amt,
        method: payMethod,
        date: paymentDate,
        recoveryNotes: recoveryNotes ? String(recoveryNotes) : null,
        notes: notes ? String(notes) : null,
      },
      include: { staff: true },
    })

    await tx.ledgerEntry.create({
      data: {
        date: paymentDate,
        type: 'EXPENSE',
        category,
        description: `${paymentType === 'BONUS' ? 'Bonus' : paymentType === 'ADVANCE' ? 'Salary advance' : 'Salary'} - ${staff.name}${recoveryNotes ? ` (recovery: ${recoveryNotes})` : ''}`,
        amount: amt,
        method: payMethod === 'BANK' ? 'BANK' : payMethod,
        source: 'AUTO',
        vendor: staff.name,
        refId: p.id,
      },
    })
    return p
  })

  await logAudit('STAFF_PAYMENT', 'StaffPayment', payment.id, `${payment.type} ₹${amt} to ${staff.name} via ${payMethod}`, user)
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
      date: (parseDateInput(date, 'T12:00:00') as Date) || new Date(),
    },
  })
  await logAudit(type === 'INCOME' ? 'LEDGER_INCOME' : 'EXPENSE', 'LedgerEntry', entry.id, `${type} ₹${amount} — ${description}`, user)
  return NextResponse.json(entry)
}

async function updateLedgerEntry(body: Record<string, unknown>, user: RequestUser) {
  const { id, category, description, amount, method, date, vendor } = body
  if (!id) return NextResponse.json({ error: 'Entry id required' }, { status: 400 })

  const existing = await prisma.ledgerEntry.findUnique({ where: { id: String(id) } })
  if (!existing) return NextResponse.json({ error: 'Ledger entry not found' }, { status: 404 })

  const updated = await prisma.ledgerEntry.update({
    where: { id: String(id) },
    data: {
      ...(category !== undefined && { category: String(category) }),
      ...(description !== undefined && { description: String(description) }),
      ...(amount !== undefined && { amount: num(amount) }),
      ...(method !== undefined && { method: String(method) }),
      ...(vendor !== undefined && { vendor: vendor ? String(vendor) : null }),
      ...(date !== undefined && { date: (parseDateInput(date, 'T12:00:00') as Date) || existing.date }),
    },
  })
  await logAudit('EXPENSE_UPDATE', 'LedgerEntry', updated.id, `Updated expense entry ₹${updated.amount} — ${updated.description}`, user)
  return NextResponse.json(updated)
}

async function deleteLedgerEntry(req: NextRequest, user: RequestUser) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Entry id required' }, { status: 400 })

  const existing = await prisma.ledgerEntry.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Ledger entry not found' }, { status: 404 })

  await prisma.ledgerEntry.delete({ where: { id } })
  await logAudit('DELETE_EXPENSE', 'LedgerEntry', id, `Deleted expense entry ₹${existing.amount} — ${existing.description}`, user)
  return NextResponse.json({ success: true, message: 'Expense entry deleted successfully' })
}

// ============ STATS ============
async function getStats() {
  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59.999)

  const [rooms, activeBookings, bookedFuture, todayBills, todayLedger, pendingFood, allBills] = await Promise.all([
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
        advanceApplied: true,
        payCash: true,
        payUpi: true,
        payCard: true,
      },
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
      },
    }),
  ])

  const vacant = rooms.filter((r) => r.status === 'VACANT').length
  const occupied = rooms.filter((r) => r.status === 'OCCUPIED').length
  const booked = rooms.filter((r) => r.status === 'BOOKED').length
  const maintenance = rooms.filter((r) => r.status === 'MAINTENANCE').length
  const dirtyRooms = rooms.filter((r) => r.housekeeping === 'DIRTY').length
  const todayRevenue = todayBills.reduce((s, b) => s + (b.internalTotal !== undefined && b.internalTotal > 0 ? b.internalTotal : b.grandTotal), 0)

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

  const outstanding = allBills.reduce((s, b) => {
    const totalRec = b.advanceApplied + b.payCash + b.payUpi + b.payCard
    const balance = b.grandTotal - totalRec
    return balance > 0.01 ? s + balance : s
  }, 0)

  return NextResponse.json({
    totalRooms: rooms.length,
    vacant,
    occupied,
    booked,
    maintenance,
    dirtyRooms,
    occupancyPercent: rooms.length ? Math.round((occupied / rooms.length) * 100) : 0,
    activeGuests: activeBookings.length,
    bookedFuture,
    activeBookings: activeBookings.map((b) => ({
      id: b.id,
      guestName: b.guest.name,
      guestPhone: b.guest.phone,
      roomNumber: b.room.number,
      checkIn: b.checkIn,
      checkOut: b.checkOut,
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
          .reduce((s, bill) => {
            const bal = bill.grandTotal - (bill.advanceApplied + bill.payCash + bill.payUpi + bill.payCard)
            return bal > 0.01 ? s + bal : s
          }, 0) || 0,
    })),
    todayRevenue,
    todayCash: todayBills.reduce((s, b) => s + b.payCash, 0),
    todayUpi: todayBills.reduce((s, b) => s + b.payUpi, 0),
    todayCard: todayBills.reduce((s, b) => s + b.payCard, 0),
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
  const updates = body as Record<string, string>
  const allowed = Object.keys(DEFAULT_SETTINGS)
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      await prisma.setting.upsert({
        where: { key },
        update: { value: String(updates[key]) },
        create: { key, value: String(updates[key]) },
      })
    }
  }
  await logAudit('SETTINGS', 'Setting', null, `Settings updated: ${Object.keys(updates).filter((k) => allowed.includes(k)).join(', ')}`, user)
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

async function deleteAudit(req: NextRequest, user: RequestUser) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Audit log ID required' }, { status: 400 })

  const existing = await prisma.auditLog.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Audit log entry not found' }, { status: 404 })

  await prisma.auditLog.delete({ where: { id } })
  await logAudit('AUDIT_DELETE', 'AuditLog', id, `Audit log entry deleted: ${existing.action} - ${existing.details}`, user)
  return NextResponse.json({ success: true })
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
  const cat = await prisma.expenseCategory.update({
    where: { id: String(id) },
    data: {
      ...(name !== undefined && { name: String(name) }),
      ...(active !== undefined && { active: !!active }),
    },
  })
  return NextResponse.json(cat)
}

async function deleteExpenseCategory(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  try {
    await prisma.expenseCategory.delete({ where: { id } })
  } catch {
    return NextResponse.json({ error: 'Cannot delete (may be in use)' }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}

// ============ GLOBAL SEARCH ============
async function globalSearch(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()
  if (!q || q.length < 1) {
    return NextResponse.json({ guests: [], bookings: [], bills: [], rooms: [] })
  }

  const [guests, bills, rooms] = await Promise.all([
    prisma.guest.findMany({
      where: {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
          { company: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 5,
      include: { bookings: { orderBy: { createdAt: 'desc' }, take: 1 } },
    }),
    prisma.bill.findMany({
      where: { billNumber: { contains: q, mode: 'insensitive' } },
      take: 5,
      include: { booking: { include: { room: true, guest: true } } },
    }),
    prisma.room.findMany({
      where: { number: { contains: q, mode: 'insensitive' } },
      take: 5,
      include: { bookings: { where: { status: 'ACTIVE' }, include: { guest: true }, take: 1 } },
    }),
  ])

  const bookings = q.length > 5
    ? await prisma.booking.findMany({
      where: { id: { startsWith: q, mode: 'insensitive' } },
      take: 3,
      include: { room: true, guest: true },
    })
    : []

  return NextResponse.json({ guests, bookings, bills, rooms })
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
      where: { createdAt: { gte: start, lte: end }, status: 'PAID' },
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
      const paid = b.advanceApplied + b.payCash + b.payUpi + b.payCard
      const balance = Math.max(0, Math.round((b.grandTotal - paid) * 100) / 100)
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
      cash: bills.reduce((s, b) => s + b.payCash, 0) + ledger.filter((e) => e.type === 'INCOME' && e.method === 'CASH' && e.category === 'ADVANCE').reduce((s, e) => s + e.amount, 0),
      upi: bills.reduce((s, b) => s + b.payUpi, 0) + ledger.filter((e) => e.type === 'INCOME' && e.method === 'UPI' && e.category === 'ADVANCE').reduce((s, e) => s + e.amount, 0),
      card: bills.reduce((s, b) => s + b.payCard, 0) + ledger.filter((e) => e.type === 'INCOME' && e.method === 'CARD' && e.category === 'ADVANCE').reduce((s, e) => s + e.amount, 0),
      directFood: orders.filter((o) => !o.bookingId).reduce((s, o) => s + o.total, 0),
      advances: ledger.filter((e) => e.type === 'INCOME' && e.category === 'ADVANCE').reduce((s, e) => s + e.amount, 0),
      total: bills.reduce((s, b) => s + b.payCash + b.payUpi + b.payCard, 0) + orders.filter((o) => !o.bookingId).reduce((s, o) => s + o.total, 0) + ledger.filter((e) => e.type === 'INCOME' && e.category === 'ADVANCE').reduce((s, e) => s + e.amount, 0),
    },
    revenue: {
      actualRoomRevenue: bills.reduce((s, b) => s + b.actualRoomTotal, 0),
      billedRoomRevenue: bills.reduce((s, b) => s + b.billedRoomTotal, 0),
      gst: bills.reduce((s, b) => s + (b.internalGst !== undefined && b.internalGst > 0 ? b.internalGst : (Math.abs(b.billedRoomTotal - b.actualRoomTotal) < 0.01 ? b.actualGst : Math.round(Math.max(0, b.actualRoomTotal + b.foodTotal + b.extraCharges - b.discount) * b.gstPercent) / 100)), 0),
      foodRoomPosted: bills.reduce((s, b) => s + b.foodTotal, 0),
      foodDirect: orders.filter((o) => !o.bookingId).reduce((s, o) => s + o.total, 0),
      discounts: bills.reduce((s, b) => s + b.discount, 0),
      grandTotal: bills.reduce((s, b) => s + (b.internalTotal !== undefined && b.internalTotal > 0 ? b.internalTotal : (Math.abs(b.billedRoomTotal - b.actualRoomTotal) < 0.01 ? b.grandTotal : Math.max(0, b.actualRoomTotal + b.foodTotal + b.extraCharges - b.discount) + Math.round(Math.max(0, b.actualRoomTotal + b.foodTotal + b.extraCharges - b.discount) * b.gstPercent) / 100)), 0),
    },
    invoices: {
      count: bills.length,
      customCount: customBills.length,
      rows: bills.map((b) => ({
        id: b.id,
        billNumber: b.billNumber,
        date: b.createdAt,
        guestName: b.booking.guest.name,
        roomNumber: b.roomNumber || b.booking.room.number,
        roomDescription: b.roomDescription || b.booking.room.type || 'Non-AC',
        actualRoomTotal: b.actualRoomTotal,
        billedRoomTotal: b.billedRoomTotal,
        foodTotal: b.foodTotal,
        gst: b.actualGst,
        internalGst: b.internalGst !== undefined && b.internalGst > 0 ? b.internalGst : (Math.abs(b.billedRoomTotal - b.actualRoomTotal) < 0.01 ? b.actualGst : Math.round(Math.max(0, b.actualRoomTotal + b.foodTotal + b.extraCharges - b.discount) * b.gstPercent) / 100),
        grandTotal: b.grandTotal,
        internalTotal: b.internalTotal !== undefined && b.internalTotal > 0 ? b.internalTotal : (Math.abs(b.billedRoomTotal - b.actualRoomTotal) < 0.01 ? b.grandTotal : Math.max(0, b.actualRoomTotal + b.foodTotal + b.extraCharges - b.discount) + Math.round(Math.max(0, b.actualRoomTotal + b.foodTotal + b.extraCharges - b.discount) * b.gstPercent) / 100),
        isCustom: Math.abs(b.billedRoomTotal - b.actualRoomTotal) > 0.01 || (!!b.roomDescription && b.roomDescription !== b.booking.room.type) || (!!b.roomNumber && b.roomNumber !== b.booking.room.number),
        approvedBy: b.approvedBy,
      })),
    },
    food: {
      ordersCount: orders.length,
      roomPostedCount: orders.filter((o) => o.bookingId).length,
      rows: orders.map((o) => ({
        id: o.id,
        time: o.createdAt,
        roomNumber: o.room?.number || null,
        tableNo: o.tableNo,
        items: o.items.map((i) => `${i.name} x${i.quantity}`).join(', '),
        total: o.total,
        createdBy: o.createdBy,
        postedToRoom: !!o.bookingId,
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

  try {
    const res = await dispatch(req, method, url, body)
    res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0')
    res.headers.set('Pragma', 'no-cache')
    res.headers.set('Expires', '0')
    return res
  } catch (e) {
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

  switch (resource) {
    case 'rooms':
      if (method === 'GET') return await listRooms(req)
      if (method === 'POST') return await createRoom(body)
      if (method === 'PATCH') return await updateRoom(body)
      if (method === 'DELETE') return await deleteRoom(req, user)
      break
    case 'guests':
      if (method === 'GET' && url.searchParams.get('phone')) return await lookupGuest(req)
      if (method === 'GET') return await listGuests(req)
      if (method === 'POST') return await upsertGuest(body)
      if (method === 'DELETE') return await deleteGuest(req, user)
      break
    case 'bookings':
      if (method === 'GET') return await listBookings(req)
      if (method === 'POST') return await createBooking(body, user)
      if (method === 'PATCH') return await updateBooking(body, user)
      if (method === 'DELETE') return await deleteBooking(req, user)
      break
    case 'bills':
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
      if (method === 'DELETE') return await deleteMenuItem(req)
      break
    case 'orders':
      if (method === 'GET') return await listOrders(req)
      if (method === 'POST') return await createOrder(body, user)
      if (method === 'PATCH') return await updateOrder(body, user)
      if (method === 'DELETE') return await deleteFoodOrder(req, user)
      break
    case 'staff':
      if (method === 'GET') return await listStaff(req)
      if (method === 'POST') return await createStaff(body)
      if (method === 'PATCH') return await updateStaff(body)
      if (method === 'DELETE') return await deleteStaff(req, user)
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
    case 'settings':
      if (method === 'GET') return await getSettings()
      if (method === 'PATCH') return await updateSettings(body, user)
      break
    case 'users':
      if (method === 'GET') return await listUsers()
      if (method === 'POST') return await createUser(body, user)
      if (method === 'PATCH') return await updateUser(body, user)
      break
    case 'auth':
      if (method === 'POST') return await login(body)
      break
    case 'audit':
      if (method === 'GET') return await listAudit(req)
      if (method === 'DELETE') return await deleteAudit(req, user)
      break
    case 'expense-categories':
      if (method === 'GET') return await listExpenseCategories()
      if (method === 'POST') return await createExpenseCategory(body)
      if (method === 'PATCH') return await updateExpenseCategory(body)
      if (method === 'DELETE') return await deleteExpenseCategory(req)
      break
    case 'search':
      if (method === 'GET') return await globalSearch(req)
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
