import { z } from 'zod'

export const StaffSchema = z.object({
  name: z.string().min(1, 'Staff name is required'),
  phone: z.string().nullable().optional(),
  role: z.string().default('Staff'),
  salary: z.number().nonnegative().default(0),
  address: z.string().nullable().optional(),
  aadhaar: z.string().nullable().optional(),
  active: z.boolean().default(true),
})

export const StaffPaymentSchema = z.object({
  staffId: z.string().min(1, 'Staff ID is required'),
  type: z.enum(['SALARY', 'ADVANCE', 'BONUS', 'DEDUCTION']),
  amount: z.number().positive('Amount must be positive'),
  method: z.string().default('CASH'),
  recoveryNotes: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
})

export type StaffInput = z.infer<typeof StaffSchema>
export type StaffPaymentInput = z.infer<typeof StaffPaymentSchema>
