'use client'

import { useEffect, useState } from 'react'
import { api, formatDate, formatDateTime, formatGovIdDisplay, formatINR } from '@/lib/hotel-utils'
import { calcNights } from '@/lib/stay'

export interface StayBooking {
  id: string
  checkIn: string | Date
  checkOut?: string | Date | null
  days?: number
  guestCount?: number
  ratePerDay?: number
  advance?: number
  isCorporate?: boolean
  notes?: string | null
  guest?: {
    name?: string
    phone?: string
    address?: string | null
    idProof?: string | null
    company?: string | null
    gst?: string | null
  } | null
  foodOrders?: { total: number; status?: string }[]
}

interface StayPayment {
  id: string
  date: string
  amount: number
  method: string
  description: string
}

/**
 * Guest and payment details of an in-house stay: who is staying, the charges so far,
 * every advance / part payment with its date and mode, and the estimated balance.
 */
export function StayDetails({ booking }: { booking: StayBooking }) {
  const [payments, setPayments] = useState<StayPayment[] | null>(null)

  useEffect(() => {
    let alive = true
    api<StayPayment[]>(`/api/bookings?paymentsFor=${encodeURIComponent(booking.id)}`)
      .then((rows) => alive && setPayments(Array.isArray(rows) ? rows : []))
      .catch(() => alive && setPayments([]))
    return () => {
      alive = false
    }
  }, [booking.id, booking.advance])

  const g = booking.guest || {}
  const checkInDay = new Date(booking.checkIn).toISOString().slice(0, 10)
  const today = new Date().toISOString().slice(0, 10)
  const nightsSoFar = Math.max(1, calcNights(checkInDay, today))
  const plannedNights = Math.max(1, booking.days || 1)
  const rate = booking.ratePerDay || 0
  const pendingFood = (booking.foodOrders || []).filter((o) => !o.status || o.status === 'PENDING').reduce((s, o) => s + (o.total || 0), 0)
  const roomSoFar = rate * nightsSoFar
  const paid = booking.advance || 0
  const balanceNow = Math.max(0, roomSoFar + pendingFood - paid)

  const row = (label: string, value: React.ReactNode) =>
    value === null || value === undefined || value === '' ? null : (
      <div className="flex justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-right font-semibold">{value}</span>
      </div>
    )

  return (
    <div className="space-y-2 text-sm">
      <div className="space-y-1 rounded-lg bg-muted p-3">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Guest</p>
        {row('Name', g.name || 'Guest')}
        {row('Phone', g.phone)}
        {row('Address', g.address)}
        {row('ID Proof', g.idProof ? formatGovIdDisplay(g.idProof) : 'Not recorded')}
        {row('Company', g.company)}
        {row('GSTIN', g.gst)}
        {row('Guests in room', booking.guestCount || 1)}
        {booking.notes && row('Notes', booking.notes)}
      </div>

      <div className="space-y-1 rounded-lg bg-muted p-3">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Stay</p>
        {row('Check-in', formatDateTime(booking.checkIn))}
        {row('Expected check-out', booking.checkOut ? formatDateTime(booking.checkOut) : '—')}
        {row('Nights', `${nightsSoFar} so far · ${plannedNights} booked`)}
        {row('Rate', `${formatINR(rate)} / night`)}
        {row('Room charges so far', formatINR(roomSoFar))}
        {pendingFood > 0 && row('Food not yet billed', formatINR(pendingFood))}
      </div>

      <div className="space-y-1.5 rounded-lg bg-muted p-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Payments</p>
        {payments === null ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : payments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No advance or part payment yet.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {payments.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <span className="text-muted-foreground">
                  {formatDate(p.date)} · {/^Part payment/i.test(p.description) ? 'Part payment' : 'Advance'} · {p.method}
                </span>
                <span className="font-semibold">{formatINR(p.amount)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-between border-t pt-1.5 font-semibold text-emerald-700 dark:text-emerald-400">
          <span>Total paid</span>
          <span>{formatINR(paid)}</span>
        </div>
        <div className={`flex justify-between font-bold ${balanceNow > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
          <span>Balance till today (before GST)</span>
          <span>{formatINR(balanceNow)}</span>
        </div>
        <p className="text-[10px] text-muted-foreground">Final amount, GST and any discount are worked out on the checkout bill.</p>
      </div>
    </div>
  )
}
