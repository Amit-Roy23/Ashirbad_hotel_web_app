import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
})

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL || '',
  DIRECT_URL: process.env.DIRECT_URL,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NODE_ENV: (process.env.NODE_ENV as 'development' | 'test' | 'production') || 'development',
})

export const DEFAULT_HOTEL_SETTINGS: Record<string, string> = {
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
  checkoutTime: '08:00',
  overstayGraceMinutes: '0',
  autoExtendEnabled: 'true',
}

