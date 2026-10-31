'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, apiAs, formatDateTime, formatINR } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { toast } from '@/hooks/use-toast'
import { BanquetBooking } from '@/types/banquet'
import { Loader2 } from 'lucide-react'

interface History {
  payments: { id: string; date: string; kind: 'ADVANCE' | 'PART_PAYMENT' | 'INVOICE_PAYMENT' | 'REFUND'; method: string; amount: number; description: string }[]
  received: number
  refunded: number
  stage: 'ESTIMATE' | 'INVOICE'
  billNumber: string | null
  total: number
  paid: number
  balance: number
  excessAdvance: number
}

const KIND: Record<History['payments'][number]['kind'], string> = {
  ADVANCE: 'Advance',
  PART_PAYMENT: 'Part payment',
  INVOICE_PAYMENT: 'Invoice payment',
  REFUND: 'Refund',
}

/** Every payment and refund of a banquet booking, with the totals against the estimate or invoice */
export function BanquetPaymentHistory({ bookingId, refreshKey = 0 }: { bookingId: string; refreshKey?: number }) {
  const [h, setH] = useState<History | null>(null)

  useEffect(() => {
    let alive = true
    api<History>(`/api/banquet-bookings?paymentsFor=${encodeURIComponent(bookingId)}`)
      .then((d) => alive && setH(d))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [bookingId, refreshKey])

  if (!h) return <p className="text-xs text-muted-foreground">Loading payments…</p>
  return (
    <div className="rounded-lg border p-3 text-xs">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Payment history</p>
      {h.payments.length === 0 ? (
        <p className="text-muted-foreground">No payment received yet.</p>
      ) : (
        <ul className="space-y-1">
          {h.payments.map((p) => (
            <li key={p.id} className="flex justify-between gap-3">
              <span className="text-muted-foreground">
                {formatDateTime(p.date)} · {KIND[p.kind]} · {p.method}
              </span>
              <span className={`font-semibold ${p.amount < 0 ? 'text-red-600' : ''}`}>
                {p.amount < 0 ? '−' : ''}
                {formatINR(Math.abs(p.amount))}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 space-y-0.5 border-t pt-1.5">
        <div className="flex justify-between">
          <span>{h.stage === 'INVOICE' ? `Invoice ${h.billNumber} total` : 'Estimate (before GST)'}</span>
          <b>{formatINR(h.total)}</b>
        </div>
        <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
          <span>Paid towards it</span>
          <b>{formatINR(h.paid)}</b>
        </div>
        <div className={`flex justify-between ${h.balance > 0.01 ? 'text-red-600' : 'text-emerald-700'}`}>
          <span>Balance</span>
          <b>{formatINR(h.balance)}</b>
        </div>
        {h.refunded > 0 && (
          <div className="flex justify-between text-muted-foreground">
            <span>Refunded</span>
            <span>{formatINR(h.refunded)}</span>
          </div>
        )}
        {h.excessAdvance > 0 && <p className="text-amber-700 dark:text-amber-400">Advance {formatINR(h.excessAdvance)} more than the invoice — refund due.</p>}
      </div>
    </div>
  )
}

/** Record money received for a booking: a part payment before the invoice, or a payment on the invoice */
export function BanquetPaymentDialog({
  booking,
  balance,
  invoiceNumber,
  onClose,
  onSaved,
}: {
  booking: BanquetBooking
  balance: number
  invoiceNumber?: string
  onClose: () => void
  onSaved: () => void
}) {
  const [amount, setAmount] = useState(String(balance))
  const [method, setMethod] = useState('UPI')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const amt = parseFloat(amount) || 0

  async function save() {
    if (amt <= 0) return setError('Enter the amount received')
    if (amt > balance + 0.01) return setError(`Only ${formatINR(balance)} is due`)
    setSaving(true)
    setError('')
    try {
      await apiAs('/api/banquet-bookings', getCachedUser(), {
        method: 'POST',
        body: JSON.stringify({ action: 'payment', id: booking.id, amount: amt, method, note: note.trim() }),
      })
      toast({ variant: 'success', title: 'Payment recorded', description: `${formatINR(amt)} from ${booking.customerName}` })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
          <DialogDescription>
            {booking.bookingNumber} · {booking.customerName} · balance {formatINR(balance)}
            {invoiceNumber ? ` on invoice ${invoiceNumber}` : ' on the estimate'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="bp-amt">Amount (₹)</Label>
            <Input id="bp-amt" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Mode</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-full" aria-label="Payment mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">Cash</SelectItem>
                <SelectItem value="UPI">UPI</SelectItem>
                <SelectItem value="CARD">Card</SelectItem>
                <SelectItem value="BANK">Bank</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bp-note">Note</Label>
          <Input id="bp-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
        </div>
        <p className="rounded bg-muted/50 p-2 text-xs text-muted-foreground">
          Balance after this: <b>{formatINR(Math.max(0, balance - amt))}</b>
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-700" disabled={saving} onClick={save}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save Payment
        </Button>
      </DialogContent>
    </Dialog>
  )
}
