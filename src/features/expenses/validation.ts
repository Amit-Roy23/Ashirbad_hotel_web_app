import { z } from 'zod'

export const ExpenseSchema = z.object({
  category: z.string().min(1, 'Category is required'),
  description: z.string().min(1, 'Description is required'),
  amount: z.number().positive('Amount must be greater than 0'),
  method: z.string().default('CASH'),
  vendor: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
})

export type ExpenseInput = z.infer<typeof ExpenseSchema>
