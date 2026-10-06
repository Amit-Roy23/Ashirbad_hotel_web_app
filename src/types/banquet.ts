export interface BanquetHall {
  id: string
  name: string
  capacity: number
  baseRate: number
  rateType: string // PER_EVENT | PER_DAY | PER_HOUR
  status: string // AVAILABLE | OCCUPIED | MAINTENANCE
  amenities?: string | null
  description?: string | null
  createdAt?: string
  updatedAt?: string
  _count?: {
    bookings: number
  }
}

export type BanquetSlot = 'MORNING' | 'EVENING' | 'FULL_DAY' | 'CUSTOM'

export type BanquetBookingStatus = 'ENQUIRY' | 'CONFIRMED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'

export type BanquetPaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID'

export interface BanquetBooking {
  id: string
  bookingNumber: string
  hallId: string
  customerName: string
  customerPhone: string
  customerEmail?: string | null
  customerAddress?: string | null
  companyName?: string | null
  gstNumber?: string | null
  eventName: string
  eventDate: string
  endDate?: string | null
  slot: BanquetSlot | string
  guestCount: number
  hallRent: number
  foodRatePerPlate: number
  foodPackageName?: string | null
  foodTotal: number
  decorCharges: number
  extraCharges: number
  discount: number
  totalEstimated: number
  advancePaid: number
  status: BanquetBookingStatus | string
  paymentStatus: BanquetPaymentStatus | string
  notes?: string | null
  createdBy?: string | null
  hall?: BanquetHall
  bills?: BanquetBill[]
  createdAt: string
  updatedAt: string
}

export interface BanquetBill {
  id: string
  billNumber: string
  banquetBookingId: string
  eventDate: string
  customerName: string
  customerPhone: string
  customerAddress?: string | null
  companyName?: string | null
  gstNumber?: string | null
  eventName: string
  hallName: string
  slot: string
  guestCount: number
  hallRent: number
  foodCharges: number
  decorCharges: number
  soundAvCharges: number
  extraCharges: number
  discount: number
  taxableAmount: number
  gstPercent: number
  gstAmount: number
  grandTotal: number
  advanceApplied: number
  payCash: number
  payUpi: number
  payCard: number
  payBank: number
  paymentStatus: BanquetPaymentStatus | string
  status: string
  notes?: string | null
  terms?: string | null
  createdBy?: string | null
  approvedBy?: string | null
  booking?: BanquetBooking
  createdAt: string
  updatedAt: string
}

export interface BanquetStats {
  totalHalls: number
  totalBookings: number
  upcomingBookings: number
  todayEvents: number
  todayRevenue: number
  totalBilledRevenue: number
  totalCollected: number
  totalOutstanding: number
  todayCash: number
  todayUpi: number
  todayCard: number
  todayBank: number
}
