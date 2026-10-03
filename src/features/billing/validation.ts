import { z } from 'zod'

export const GstPercentSchema = z
  .number()
  .min(0, 'GST percentage cannot be negative')
  .max(100, 'GST percentage cannot exceed 100%')
  .refine((val) => Number.isFinite(val), 'GST percentage must be a finite number')

export const GenerateBillSchema = z.object({
  bookingId: z.string().min(1, 'Booking ID is required'),
  billedRoomTotal: z.number().nonnegative().optional(),
  gstPercent: GstPercentSchema.optional(),
  extraCharges: z.number().nonnegative().optional(),
  discount: z.number().nonnegative().optional(),
  payCash: z.number().nonnegative().optional(),
  payUpi: z.number().nonnegative().optional(),
  payCard: z.number().nonnegative().optional(),
  isCorporate: z.boolean().optional(),
  corporateName: z.string().nullable().optional(),
  gstNumber: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export const UpdateBillSchema = z.object({
  id: z.string().min(1, 'Bill ID is required'),
  billedRoomTotal: z.number().nonnegative().optional(),
  gstPercent: GstPercentSchema.optional(),
  extraCharges: z.number().nonnegative().optional(),
  discount: z.number().nonnegative().optional(),
  payCash: z.number().nonnegative().optional(),
  payUpi: z.number().nonnegative().optional(),
  payCard: z.number().nonnegative().optional(),
  corporateName: z.string().nullable().optional(),
  gstNumber: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  roomId: z.string().optional(),
})

export type GenerateBillInput = z.infer<typeof GenerateBillSchema>
export type UpdateBillInput = z.infer<typeof UpdateBillSchema>

