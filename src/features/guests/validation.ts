import { z } from 'zod'

export const CreateGuestSchema = z.object({
  phone: z.string().min(10, 'Phone must be at least 10 digits'),
  name: z.string().min(1, 'Guest name is required'),
  email: z.string().email().nullable().optional().or(z.literal('')),
  company: z.string().nullable().optional(),
  gst: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  idProof: z.string().nullable().optional(),
})

export const UpdateGuestSchema = CreateGuestSchema.partial()

export type CreateGuestInput = z.infer<typeof CreateGuestSchema>
export type UpdateGuestInput = z.infer<typeof UpdateGuestSchema>
