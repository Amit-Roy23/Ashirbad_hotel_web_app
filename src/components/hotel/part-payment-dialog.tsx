'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiAs, formatINR } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { toast } from '@/hooks/use-toast'
import { Loader2, Wallet } from 'lucide-react'

export interface PartPaymentBooking {
  id: string
  advance?: number
  ratePerDay?: number
  days?: number
  guest?: { name?: string } | null
  room?: { number?: string } | null
}

/**
 * Take a payment while the guest is staying. It is added to the stay's paid amount and
 * deducted from the final checkout bill, like an advance.
 */
export function PartPaymentDialog({
  open,
  onOpenChange,
  booking,
  roomNumber,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  booking: PartPaymentBooking | null
  roomNumber?: string
  onSuccess: () => void
}) {
  return (
    <Dialog open={open && !!booking} onOpenChange={onOpenChange}>
      {/* The form mounts fresh each time the dialog opens, so fields start empty */}
      {open && booking && (
        <PartPaymentForm booking={booking} roomNumber={roomNumber} onDone={() => onOpenChange(false)} onSuccess={onSuccess} />
      )}
    </Dialog>
  )
}

function PartPaymentForm({
  booking,
  roomNumber,
  onDone,
  onSuccess,
}: {
  booking: PartPaymentBooking
  roomNumber?: string
  onDone: () => void
  onSuccess: () => void
}) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'CASH' | 'UPI' | 'CARD'>('CASH')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const paidSoFar = booking.advance || 0
  const estStay = (booking.ratePerDay || 0) * (booking.days || 0)

  async function submit() {
    if (!booking) return
    const value = parseFloat(amount)
    if (!value || value <= 0) {
      setError('Enter a payment amount')
      return
    }
    setSaving(true)
    setError('')
    try {
      await apiAs('/api/bookings', getCachedUser(), {
        method: 'PATCH',
        body: JSON.stringify({ id: booking.id, action: 'add-payment', amount: value, method }),
      })
      toast({
        variant: 'success',
        title: 'Payment received',
        description: `${formatINR(value)} via ${method} from ${booking.guest?.name || 'guest'}. It will be deducted from the checkout bill.`,
      })
      onDone()
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed')
    } finally {
      setSaving(false)
    }
  }

  return (
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-emerald-600" /> Receive Part Payment
          </DialogTitle>
          <DialogDescription>
            {booking.guest?.name || 'Guest'} · Room {roomNumber || booking.room?.number || '-'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1 rounded-lg bg-muted p-3 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Paid so far (advance + part payments)</span>
              <span className="font-semibold">{formatINR(paidSoFar)}</span>
            </div>
            {estStay > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Room tariff so far (before GST)</span>
                <span className="font-semibold">{formatINR(estStay)}</span>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pp-amount" className="text-xs font-semibold">Amount (₹)</Label>
            <Input id="pp-amount" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 1000" />
          </div>
          <div className="grid grid-cols-3 gap-1">
            {(['CASH', 'UPI', 'CARD'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`h-9 rounded border text-xs font-semibold ${
                  method === m ? 'border-emerald-600 bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          {error && <p className="text-xs font-medium text-destructive">{error}</p>}
          <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-700" disabled={saving} onClick={submit}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Receive Payment
          </Button>
        </div>
      </DialogContent>
  )
}
