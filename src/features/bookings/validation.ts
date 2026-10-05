import { z } from 'zod'

export const CheckInSchema = z.object({
  roomId: z.string().min(1, 'Room ID is required'),
  phone: z.string().min(1, 'Phone is required'),
  name: z.string().min(1, 'Guest name is required'),
  email: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  gst: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  idProof: z.string().nullable().optional(),
  ratePerDay: z.number().nonnegative(),
  days: z.number().int().positive().default(1),
  guestCount: z.number().int().min(1, 'At least 1 guest required').max(4, 'Maximum 4 guests allowed per room').default(1),
  advance: z.number().nonnegative().default(0),
  isCorporate: z.boolean().default(false),
  notes: z.string().nullable().optional(),
  checkInDate: z.string().nullable().optional(),
})

export const UpdateBookingSchema = z.object({
  roomId: z.string().optional(),
  ratePerDay: z.number().nonnegative().optional(),
  days: z.number().int().positive().optional(),
  guestCount: z.number().int().min(1, 'At least 1 guest required').max(4, 'Maximum 4 guests allowed per room').optional(),
  notes: z.string().nullable().optional(),
  status: z.enum(['ACTIVE', 'BOOKED', 'COMPLETED', 'CANCELLED']).optional(),
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
})

export type CheckInInput = z.infer<typeof CheckInSchema>
export type UpdateBookingInput = z.infer<typeof UpdateBookingSchema>
