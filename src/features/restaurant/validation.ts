import { z } from 'zod'

export const MenuItemSchema = z.object({
  name: z.string().min(1, 'Item name is required'),
  category: z.string().default('Main Course'),
  price: z.number().nonnegative(),
  available: z.boolean().default(true),
})

export const FoodOrderSchema = z.object({
  bookingId: z.string().nullable().optional(),
  roomId: z.string().nullable().optional(),
  tableNo: z.string().nullable().optional(),
  items: z.array(
    z.object({
      menuItemId: z.string().nullable().optional(),
      name: z.string(),
      price: z.number().nonnegative(),
      quantity: z.number().int().positive(),
    })
  ).min(1, 'Order must contain at least one item'),
  notes: z.string().nullable().optional(),
})

export type MenuItemInput = z.infer<typeof MenuItemSchema>
export type FoodOrderInput = z.infer<typeof FoodOrderSchema>
