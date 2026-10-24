'use client'

import { useEffect, useState } from 'react'
import { api, formatINR, formatDate, formatDateTime } from '@/lib/hotel-utils'
import { splitGst } from '@/lib/gst'
import { Building2, Phone, MapPin, Receipt } from 'lucide-react'
import { Separator } from '@/components/ui/separator'

export interface PrintableInvoiceProps {
  bill: {
    id: string
    billNumber: string
    days: number
    actualRoomTotal: number
    billedRoomTotal: number
    roomNumber?: string | null
    roomDescription?: string | null
    gstPercent: number
    cgstPercent?: number
    sgstPercent?: number
    previousDue?: number
    carriedForward?: number
    actualGst: number
    internalGst?: number
    internalTotal?: number
    foodTotal: number
    extraCharges: number
    discount: number
    grandTotal: number
    payCash: number
    payUpi: number
    payCard: number
    advanceApplied: number
    isCorporate: boolean
    corporateName?: string | null
    gstNumber?: string | null
    createdAt: string
    booking: {
      checkIn: string
      checkOut?: string | null
      actualCheckOut?: string | null
      days: number
      ratePerDay: number
      advance: number
      guest: {
        name: string
        phone: string
        company?: string | null
        gst?: string | null
        address?: string | null
      }
      room: {
        number: string
        type?: string
      }
    }
  }
  settings?: Record<string, string>
}

export function PrintableInvoice({ bill, settings = {} }: PrintableInvoiceProps) {
  if (!bill) return null

  const hotelName = settings.hotelName || 'Ashirbad Lodge'
  const hotelAddress = settings.hotelAddress || 'Station Road, Kolkata'
  const hotelPhone = settings.hotelPhone || '+91 90000 00000'
  const hotelGstin = settings.hotelGstin || ''

  const guest = bill.booking?.guest
  const room = bill.booking?.room
  const roomNo = bill.roomNumber || room?.number || 'N/A'
  const roomDesc = bill.roomDescription || room?.type || ''
  const corporateName = bill.corporateName || guest?.company
  const gstNumber = bill.gstNumber || guest?.gst

  const subtotal = Math.max(0, bill.billedRoomTotal + (bill.foodTotal || 0) + (bill.extraCharges || 0) - (bill.discount || 0))
  // Customer invoice: charges and CGST/SGST only (amounts paid are not printed)
  const gst = splitGst(bill)
  const previousDue = Number(bill.previousDue || 0)
  const roomRatePerNight = bill.days > 0 ? Math.round((bill.billedRoomTotal / bill.days) * 100) / 100 : bill.billedRoomTotal

  return (
    <div className="print-area w-full rounded-lg border border-slate-300 bg-white p-5 text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
      {/* Header */}
      <div className="mb-4 text-center">
        <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">{hotelName}</h2>
        {hotelAddress && <p className="text-xs text-slate-600 dark:text-slate-400">{hotelAddress}</p>}
        {hotelPhone && <p className="text-xs text-slate-600 dark:text-slate-400">Ph: {hotelPhone}</p>}
        {hotelGstin && <p className="text-xs font-medium text-slate-700 dark:text-slate-300">GSTIN: {hotelGstin}</p>}

        <div className="mt-2 inline-block rounded-full bg-slate-100 px-3 py-0.5 text-xs font-bold uppercase tracking-wider text-slate-800 dark:bg-slate-800 dark:text-slate-200">
          {bill.actualGst > 0 ? (
            <span className="text-emerald-700 dark:text-emerald-400">GST TAX INVOICE</span>
          ) : (
            <span>NON-GST INVOICE / CASH MEMO</span>
          )}
        </div>
      </div>

      <Separator className="my-3" />

      {/* Meta Grid */}
      <div className="mb-4 grid grid-cols-2 gap-4 text-xs">
        <div className="space-y-1">
          <p className="font-semibold text-slate-900 dark:text-white">Invoice No: {bill.billNumber}</p>
          <p className="text-slate-600 dark:text-slate-400">Date: {formatDateTime(bill.createdAt)}</p>
          <p className="text-slate-600 dark:text-slate-400">
            Billing Room No: <span className="font-semibold text-slate-900 dark:text-white">{roomNo}</span> {roomDesc ? `(${roomDesc})` : ''}
          </p>
          <p className="text-slate-600 dark:text-slate-400">
            Check-In: <span className="font-semibold text-slate-900 dark:text-white">{formatDateTime(bill.booking?.checkIn)}</span>
          </p>
          <p className="text-slate-600 dark:text-slate-400">
            Check-Out: <span className="font-semibold text-slate-900 dark:text-white">{formatDateTime(bill.booking?.actualCheckOut || bill.booking?.checkOut)}</span>
          </p>
          <p className="text-slate-600 dark:text-slate-400">
            Nights Billed: <span className="font-semibold text-slate-900 dark:text-white">{bill.days} night(s)</span>
          </p>
        </div>

        <div className="space-y-1 text-right">
          <p className="font-semibold text-slate-900 dark:text-white">Guest: {guest?.name || 'Guest'}</p>
          <p className="text-slate-600 dark:text-slate-400">Phone: {guest?.phone || 'N/A'}</p>
          {guest?.address && <p className="text-slate-600 dark:text-slate-400">Address: {guest.address}</p>}
          {corporateName && (
            <p className="font-medium text-slate-800 dark:text-slate-200">
              Company: {corporateName}
            </p>
          )}
          {gstNumber && (
            <p className="font-medium text-slate-800 dark:text-slate-200">
              Company GSTIN: {gstNumber}
            </p>
          )}
        </div>
      </div>

      <Separator className="my-3" />

      {/* Itemized charges table */}
      <div className="space-y-2 text-xs">
        <div className="flex justify-between py-1">
          <span className="text-slate-700 dark:text-slate-300">
            Room Rent — Room {roomNo}{roomDesc ? ` (${roomDesc})` : ''}, {bill.days} night{bill.days > 1 ? 's' : ''} @ {formatINR(roomRatePerNight)}
          </span>
          <span className="font-semibold">{formatINR(bill.billedRoomTotal)}</span>
        </div>

        {bill.foodTotal > 0 && (
          <div className="flex justify-between py-1">
            <span className="text-slate-700 dark:text-slate-300">Food / Restaurant Charges</span>
            <span className="font-semibold">{formatINR(bill.foodTotal)}</span>
          </div>
        )}

        {bill.extraCharges > 0 && (
          <div className="flex justify-between py-1">
            <span className="text-slate-700 dark:text-slate-300">Extra Charges</span>
            <span className="font-semibold">{formatINR(bill.extraCharges)}</span>
          </div>
        )}

        {bill.discount > 0 && (
          <div className="flex justify-between py-1 text-emerald-700 dark:text-emerald-400">
            <span>Discount</span>
            <span className="font-semibold">-{formatINR(bill.discount)}</span>
          </div>
        )}

        <div className="flex justify-between py-1 font-medium text-slate-800 dark:text-slate-200">
          <span>Subtotal</span>
          <span className="font-semibold">{formatINR(subtotal)}</span>
        </div>

        <div className="flex justify-between py-1 font-medium text-slate-800 dark:text-slate-200">
          <span>CGST ({gst.cgstPercent}%)</span>
          <span className="font-semibold">{formatINR(gst.cgst)}</span>
        </div>
        <div className="flex justify-between py-1 font-medium text-slate-800 dark:text-slate-200">
          <span>SGST ({gst.sgstPercent}%)</span>
          <span className="font-semibold">{formatINR(gst.sgst)}</span>
        </div>

        {previousDue > 0 && (
          <div className="flex justify-between py-1 text-red-700 dark:text-red-400">
            <span>Previous Outstanding</span>
            <span className="font-semibold">{formatINR(previousDue)}</span>
          </div>
        )}

        <Separator className="my-1" />

        <div className="flex justify-between py-1 text-sm font-bold text-slate-900 dark:text-white">
          <span>Grand Total</span>
          <span className="text-emerald-700 dark:text-emerald-400">{formatINR(bill.grandTotal)}</span>
        </div>
      </div>

      {bill.id && <PaymentHistorySection billId={bill.id} />}

      <p className="mt-5 text-center text-[11px] font-medium text-slate-500 dark:text-slate-400">
        Thank you for staying with us! Please visit again.
      </p>
    </div>
  )
}

interface PaymentHistory {
  billId: string
  payments: { date: string; label: string; cash: number; upi: number; card: number; amount: number }[]
  totalPaid: number
  balance: number
}

function modeText(p: { cash: number; upi: number; card: number }) {
  const parts = [
    p.cash > 0 ? `Cash ${formatINR(p.cash)}` : '',
    p.upi > 0 ? `UPI ${formatINR(p.upi)}` : '',
    p.card > 0 ? `Card ${formatINR(p.card)}` : '',
  ].filter(Boolean)
  return parts.length === 1 ? parts[0].split(' ')[0] : parts.join(' + ')
}

/** Date-wise payments on the bill, same as the printed invoice */
function PaymentHistorySection({ billId }: { billId: string }) {
  const [history, setHistory] = useState<PaymentHistory | null>(null)

  useEffect(() => {
    let alive = true
    api<PaymentHistory>(`/api/bills?paymentsFor=${encodeURIComponent(billId)}`)
      .then((h) => alive && setHistory(h))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [billId])

  if (!history || history.billId !== billId) return null
  return (
    <div className="mt-4 text-xs">
      <p className="mb-1.5 font-bold text-slate-900 dark:text-white">Payment History</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b bg-slate-50 text-left dark:bg-slate-900">
              <th className="px-1.5 py-1 font-semibold">Date</th>
              <th className="px-1.5 py-1 font-semibold">Payment</th>
              <th className="px-1.5 py-1 font-semibold">Mode</th>
              <th className="px-1.5 py-1 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {history.payments.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-1.5 py-2 text-center text-slate-500">
                  No payments recorded yet
                </td>
              </tr>
            ) : (
              history.payments.map((p, i) => (
                <tr key={i} className="border-b">
                  <td className="whitespace-nowrap px-1.5 py-1">{formatDateTime(p.date)}</td>
                  <td className="px-1.5 py-1">{p.label}</td>
                  <td className="px-1.5 py-1">{modeText(p)}</td>
                  <td className="whitespace-nowrap px-1.5 py-1 text-right font-semibold">{formatINR(p.amount)}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="px-1.5 pt-1.5 font-bold">Total Paid</td>
              <td className="px-1.5 pt-1.5 text-right font-bold text-emerald-700 dark:text-emerald-400">{formatINR(history.totalPaid)}</td>
            </tr>
            <tr>
              <td colSpan={3} className="px-1.5 py-0.5 font-bold">{history.balance > 0.01 ? 'Balance Due' : 'Status'}</td>
              <td className={`px-1.5 py-0.5 text-right font-bold ${history.balance > 0.01 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}`}>
                {history.balance > 0.01 ? formatINR(history.balance) : 'Fully Paid'}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
