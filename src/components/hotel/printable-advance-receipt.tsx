'use client'

import { formatINR, formatDate, formatDateTime } from '@/lib/hotel-utils'
import { CalendarCheck, Phone, MapPin, Building2, Receipt } from 'lucide-react'
import { Separator } from '@/components/ui/separator'

export interface PrintableAdvanceReceiptProps {
  booking: {
    id: string
    status?: string
    checkIn: string
    checkOut?: string | null
    actualCheckOut?: string | null
    days: number
    ratePerDay: number
    advance: number
    notes?: string | null
    createdAt?: string
    updatedAt?: string
    guest: {
      name: string
      phone: string
      company?: string | null
      gst?: string | null
    }
    room?: {
      number: string
      type?: string
    }
  }
  settings?: Record<string, string>
}

export function PrintableAdvanceReceipt({ booking, settings = {} }: PrintableAdvanceReceiptProps) {
  if (!booking) return null

  const hotelName = settings.hotelName || 'Ashirbad Lodge'
  const hotelAddress = settings.hotelAddress || 'Station Road, Kolkata'
  const hotelPhone = settings.hotelPhone || '+91 90000 00000'
  const hotelGstin = settings.hotelGstin || ''

  const isCancelled = booking.status === 'CANCELLED'
  const guest = booking.guest
  const room = booking.room
  const receiptNo = `ADV-${booking.id?.slice(-6).toUpperCase() || '1001'}`
  const stayTotal = (booking.ratePerDay || 0) * (booking.days || 1)
  const advance = booking.advance || 0
  const estBalance = Math.max(0, stayTotal - advance)

  return (
    <div className={`print-area w-full rounded-lg border bg-white p-5 text-slate-900 shadow-sm dark:bg-slate-950 dark:text-slate-100 ${
      isCancelled ? 'border-red-300 dark:border-red-800' : 'border-amber-300 dark:border-amber-700'
    }`}>
      {/* Header */}
      <div className="mb-4 text-center">
        <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{hotelName}</h2>
        {hotelAddress && <p className="text-xs text-slate-600 dark:text-slate-400">{hotelAddress}</p>}
        {hotelPhone && <p className="text-xs text-slate-600 dark:text-slate-400">Ph: {hotelPhone}</p>}
        {hotelGstin && <p className="text-xs font-medium text-slate-700 dark:text-slate-300">GSTIN: {hotelGstin}</p>}

        <div className="mt-2 flex items-center justify-center gap-2">
          <div className="inline-block rounded-full bg-amber-100 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-900 dark:bg-amber-900/60 dark:text-amber-200">
            ADVANCE BOOKING RECEIPT
          </div>
          {isCancelled && (
            <div className="inline-block rounded-full bg-red-100 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-red-800 dark:bg-red-950 dark:text-red-300">
              BOOKING CANCELLED
            </div>
          )}
        </div>
        {isCancelled && (
          <p className="mt-1 text-xs font-semibold text-red-600 dark:text-red-400">
            Cancelled on: {formatDateTime(booking.actualCheckOut || booking.updatedAt || new Date().toISOString())}
          </p>
        )}
      </div>

      <Separator className="my-3" />

      {/* Meta Grid */}
      <div className="mb-4 grid grid-cols-2 gap-4 text-xs">
        <div className="space-y-1">
          <p className="font-semibold text-slate-900 dark:text-white">Receipt No: {receiptNo}</p>
          <p className="text-slate-600 dark:text-slate-400">
            Date: {booking.createdAt ? formatDateTime(booking.createdAt) : formatDateTime(new Date())}
          </p>
          <p className="text-slate-600 dark:text-slate-400">
            Room: <span className="font-semibold text-slate-900 dark:text-white">Room {room?.number || '—'}</span>{' '}
            {room?.type ? `(${room.type})` : ''}
          </p>
          <p className="text-slate-600 dark:text-slate-400">
            Reserved Stay: {booking.days} night(s) • {formatDate(booking.checkIn)} → {formatDate(booking.checkOut)}
          </p>
        </div>

        <div className="space-y-1 text-right">
          <p className="font-semibold text-slate-900 dark:text-white">Guest: {guest?.name || 'Guest'}</p>
          <p className="text-slate-600 dark:text-slate-400">Phone: {guest?.phone || 'N/A'}</p>
          {guest?.company && (
            <p className="font-medium text-slate-800 dark:text-slate-200">Company: {guest.company}</p>
          )}
          {guest?.gst && (
            <p className="font-medium text-slate-800 dark:text-slate-200">GSTIN: {guest.gst}</p>
          )}
        </div>
      </div>

      <Separator className="my-3" />

      {/* Tariff breakdown */}
      <div className="space-y-2 text-xs">
        <div className="flex justify-between py-1">
          <span className="text-slate-700 dark:text-slate-300">
            Estimated Room Tariff ({booking.days || 1} night{booking.days > 1 ? 's' : ''} @ {formatINR(booking.ratePerDay)}/night)
          </span>
          <span className="font-semibold">{formatINR(stayTotal)}</span>
        </div>

        <Separator className="my-1" />

        {/* Advance Received */}
        <div className="flex justify-between py-2 text-base font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-3 rounded-md">
          <span>Advance Amount Received</span>
          <span>{formatINR(advance)}</span>
        </div>

        <div className="flex justify-between py-1 text-xs text-muted-foreground pt-1">
          <span>Estimated Balance on Checkout</span>
          <span className="font-semibold text-foreground">{formatINR(estBalance)}</span>
        </div>

        <div className="mt-3 rounded bg-amber-50 p-3 text-[11px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50">
          <p className="font-semibold mb-1">Booking Confirmation Note:</p>
          <p>
            This receipt confirms your advance reservation and payment. The remaining stay balance along with any food or incidentals will be settled during checkout.
          </p>
        </div>
      </div>

      <p className="mt-5 text-center text-[11px] font-medium text-slate-500 dark:text-slate-400">
        Thank you for choosing {hotelName}! We look forward to hosting you.
      </p>
    </div>
  )
}
