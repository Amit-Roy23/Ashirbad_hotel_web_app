'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { apiAs, formatINR } from '@/lib/hotel-utils'
import { askAdminPin } from '@/lib/admin-pin'
import { computeGst, splitGst } from '@/lib/gst'
import { GstPicker } from './gst-picker'
import { getCachedUser } from './user-context'
import { toast } from '@/hooks/use-toast'
import { BanquetBooking, BanquetBill } from '@/types/banquet'
import { triggerPrintBanquetInvoice } from '@/lib/print-banquet-invoice'
import { Receipt, Printer, CreditCard, Banknote, Smartphone, Landmark, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'

interface BanquetBillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  booking?: BanquetBooking | null
  existingBill?: BanquetBill | null
  /** with an existing bill: 'pay' records a new payment, 'edit' corrects charges / GST */
  mode?: 'pay' | 'edit'
  onSuccess: () => void
}

const paidOn = (b: BanquetBill) =>
  Math.round(((b.advanceApplied || 0) + (b.payCash || 0) + (b.payUpi || 0) + (b.payCard || 0) + (b.payBank || 0)) * 100) / 100

/**
 * Banquet invoice.
 *  create: from a booking — charges and GST editable; the whole advance received is applied
 *  pay:    record a new payment on an invoice (amounts start at 0; earlier payments are shown, not re-sent)
 *  edit:   correct an invoice's charges or GST (Admin PIN); payments stay as they are
 */
export function BanquetBillDialog({ open, onOpenChange, booking, existingBill, mode = 'pay', onSuccess }: BanquetBillDialogProps) {
  const [busy, setBusy] = useState(false)
  const view: 'create' | 'pay' | 'edit' = existingBill ? mode : 'create'
  const chargesLocked = view === 'pay'

  const [hallRent, setHallRent] = useState('0')
  const [foodCharges, setFoodCharges] = useState('0')
  const [decorCharges, setDecorCharges] = useState('0')
  const [soundAvCharges, setSoundAvCharges] = useState('0')
  const [extraCharges, setExtraCharges] = useState('0')
  const [discount, setDiscount] = useState('0')
  const [cgst, setCgst] = useState(2.5)
  const [sgst, setSgst] = useState(2.5)
  const [decorOn, setDecorOn] = useState(true)
  const [payCash, setPayCash] = useState('0')
  const [payUpi, setPayUpi] = useState('0')
  const [payCard, setPayCard] = useState('0')
  const [payBank, setPayBank] = useState('0')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!open) return
    // New payment amounts always start at 0: what was paid before is shown separately
    setPayCash('0')
    setPayUpi('0')
    setPayCard('0')
    setPayBank('0')
    if (existingBill) {
      setHallRent(String(existingBill.hallRent || 0))
      setFoodCharges(String(existingBill.foodCharges || 0))
      setDecorCharges(String(existingBill.decorCharges || 0))
      setSoundAvCharges(String(existingBill.soundAvCharges || 0))
      setExtraCharges(String(existingBill.extraCharges || 0))
      setDiscount(String(existingBill.discount || 0))
      const split = splitGst({ ...existingBill, actualGst: existingBill.gstAmount })
      setCgst(split.cgstPercent)
      setSgst(split.sgstPercent)
      setDecorOn((existingBill.decorCharges || 0) > 0)
      setNotes(existingBill.notes || '')
    } else if (booking) {
      setHallRent(String(booking.hallRent || 0))
      setFoodCharges(String(booking.foodTotal || 0))
      setDecorCharges(String(booking.decorCharges || 0))
      setSoundAvCharges('0')
      setExtraCharges(String(booking.extraCharges || 0))
      setDiscount(String(booking.discount || 0))
      setCgst(2.5)
      setSgst(2.5)
      setDecorOn(booking.decorEnabled !== false)
      setNotes(booking.notes || '')
    }
  }, [booking, existingBill, open])

  const numHall = Math.max(0, parseFloat(hallRent) || 0)
  const numFood = Math.max(0, parseFloat(foodCharges) || 0)
  // "Decor, AV Services & Discounts" switched off on the booking = none of them on this invoice
  const servicesOff = view === 'create' && booking?.decorEnabled === false
  const numDecor = !servicesOff && decorOn ? Math.max(0, parseFloat(decorCharges) || 0) : 0
  const numSound = servicesOff ? 0 : Math.max(0, parseFloat(soundAvCharges) || 0)
  const numExtra = servicesOff ? 0 : Math.max(0, parseFloat(extraCharges) || 0)
  const numDiscount = servicesOff ? 0 : Math.max(0, parseFloat(discount) || 0)

  const taxableAmount = Math.max(0, numHall + numFood + numDecor + numSound + numExtra - numDiscount)
  const gstSplit = computeGst(taxableAmount, cgst, sgst)
  const grandTotal = view === 'pay' && existingBill ? existingBill.grandTotal : Math.round((taxableAmount + gstSplit.total) * 100) / 100

  // Advance: the whole advance received counts (only up to the invoice total)
  const advanceReceived = view === 'create' ? booking?.advancePaid || 0 : existingBill?.advanceApplied || 0
  const advanceApplied = Math.min(advanceReceived, grandTotal)
  const excessAdvance = view === 'create' ? Math.max(0, Math.round((advanceReceived - grandTotal) * 100) / 100) : 0
  const paidBefore = existingBill ? paidOn(existingBill) : advanceApplied
  const newPay = [payCash, payUpi, payCard, payBank].reduce((t, v) => t + Math.max(0, parseFloat(v) || 0), 0)
  const balanceAfter = Math.max(0, Math.round((grandTotal - paidBefore - (view === 'edit' ? 0 : newPay)) * 100) / 100)
  const overpaid = view !== 'edit' && paidBefore + newPay > grandTotal + 0.01
  const belowPaid = view === 'edit' && existingBill && grandTotal + 0.01 < paidOn(existingBill)

  function fillBalance(mode: 'CASH' | 'UPI' | 'CARD' | 'BANK') {
    const left = String(Math.max(0, Math.round((grandTotal - paidBefore) * 100) / 100))
    setPayCash(mode === 'CASH' ? left : '0')
    setPayUpi(mode === 'UPI' ? left : '0')
    setPayCard(mode === 'CARD' ? left : '0')
    setPayBank(mode === 'BANK' ? left : '0')
  }

  async function handleSubmit(e: React.FormEvent, andPrint = false) {
    e.preventDefault()
    if (overpaid) return toast({ variant: 'destructive', title: 'Too much', description: 'Payment is more than the balance due.' })
    if (belowPaid) return toast({ variant: 'destructive', title: 'Check the total', description: 'The invoice total cannot be less than what is already paid.' })
    const money = {
      payCash: Math.max(0, parseFloat(payCash) || 0),
      payUpi: Math.max(0, parseFloat(payUpi) || 0),
      payCard: Math.max(0, parseFloat(payCard) || 0),
      payBank: Math.max(0, parseFloat(payBank) || 0),
    }
    const charges = {
      hallRent: numHall,
      foodCharges: numFood,
      decorCharges: numDecor,
      soundAvCharges: numSound,
      extraCharges: numExtra,
      discount: numDiscount,
      cgstPercent: cgst,
      sgstPercent: sgst,
      notes,
    }
    let adminPin: string | undefined
    if (view === 'edit') {
      const pin = await askAdminPin(`Editing invoice ${existingBill?.billNumber}: total ${formatINR(existingBill?.grandTotal)} → ${formatINR(grandTotal)}. Enter the Admin PIN.`)
      if (!pin) return
      adminPin = pin
    }
    if (view === 'pay' && newPay <= 0) return toast({ variant: 'destructive', title: 'Enter an amount', description: 'Type the amount received.' })

    setBusy(true)
    try {
      let saved: BanquetBill
      if (view === 'pay' && existingBill) {
        saved = await apiAs<BanquetBill>('/api/banquet-bills', getCachedUser(), {
          method: 'POST',
          body: JSON.stringify({ action: 'payment', id: existingBill.id, ...money }),
        })
        toast({ variant: 'success', title: 'Payment recorded', description: `${formatINR(newPay)} on ${existingBill.billNumber}` })
      } else if (view === 'edit' && existingBill) {
        saved = await apiAs<BanquetBill>('/api/banquet-bills', getCachedUser(), {
          method: 'PATCH',
          adminPin,
          body: JSON.stringify({ id: existingBill.id, ...charges }),
        })
        toast({ variant: 'success', title: 'Invoice updated', description: `${saved.billNumber} · total ${formatINR(saved.grandTotal)}` })
      } else {
        saved = await apiAs<BanquetBill>('/api/banquet-bills', getCachedUser(), {
          method: 'POST',
          body: JSON.stringify({ banquetBookingId: booking!.id, ...charges, gstPercent: cgst + sgst, ...money }),
        })
        toast({ variant: 'success', title: 'Invoice generated', description: `Banquet invoice ${saved.billNumber}` })
      }
      if (andPrint) triggerPrintBanquetInvoice(saved)
      onSuccess()
      onOpenChange(false)
    } catch (err) {
      toast({ variant: 'destructive', title: 'Billing error', description: err instanceof Error ? err.message : 'Could not save' })
    } finally {
      setBusy(false)
    }
  }

  const customer = booking?.customerName || existingBill?.customerName || 'Customer'
  const event = booking?.eventName || existingBill?.eventName || 'Event'
  const hall = booking?.hall?.name || existingBill?.hallName || 'Banquet Hall'
  const field = (label: string, value: string, set: (v: string) => void, extraDisabled = false, cls = '') => (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" min="0" value={value} onChange={(e) => set(e.target.value)} disabled={chargesLocked || extraDisabled} className={`h-9 text-xs ${cls}`} />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Receipt className="h-5 w-5 text-emerald-600" />
            {view === 'pay' ? `Record Payment — ${existingBill?.billNumber}` : view === 'edit' ? `Edit Invoice — ${existingBill?.billNumber}` : 'Generate Banquet Invoice'}
          </DialogTitle>
          <DialogDescription>
            {event} · {customer} · {hall}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-4 pt-1">
          <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
            <h4 className="text-xs font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-400">Charges</h4>
            {servicesOff && <p className="text-[11px] text-muted-foreground">Decor, AV services &amp; discounts are switched off for this booking (₹0).</p>}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {field('Hall Rent (₹)', hallRent, setHallRent)}
              {field('Catering / Food (₹)', foodCharges, setFoodCharges)}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Stage &amp; Decor (₹)</Label>
                  <Switch checked={decorOn && !servicesOff} onCheckedChange={setDecorOn} disabled={chargesLocked || servicesOff} className="scale-75" aria-label="Decor on or off" />
                </div>
                <Input
                  type="number"
                  min="0"
                  value={decorOn && !servicesOff ? decorCharges : '0'}
                  onChange={(e) => setDecorCharges(e.target.value)}
                  disabled={chargesLocked || !decorOn || servicesOff}
                  className="h-9 text-xs"
                />
              </div>
              {field('DJ & Sound / AV (₹)', servicesOff ? '0' : soundAvCharges, setSoundAvCharges, servicesOff)}
              {field('Extra Services (₹)', servicesOff ? '0' : extraCharges, setExtraCharges, servicesOff)}
              {field('Discount (₹)', servicesOff ? '0' : discount, setDiscount, servicesOff, 'font-semibold text-emerald-600')}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-2 text-xs">
              <div className="w-full space-y-1.5 sm:w-64">
                <GstPicker
                  cgst={cgst}
                  sgst={sgst}
                  disabled={chargesLocked}
                  onChange={(n) => {
                    setCgst(n.cgst)
                    setSgst(n.sgst)
                  }}
                />
                <p className="text-muted-foreground">
                  {cgst + sgst > 0 ? `CGST ${formatINR(gstSplit.cgst)} · SGST ${formatINR(gstSplit.sgst)} — GST invoice` : 'No GST — this will be an ESTIMATE (own number series)'}
                </p>
              </div>
              <div className="text-right">
                {view !== 'pay' && <span className="mr-2 text-muted-foreground">Taxable: <b>{formatINR(taxableAmount)}</b></span>}
                <span className="text-sm font-bold">
                  Total: <b className="text-emerald-700 dark:text-emerald-400">{formatINR(grandTotal)}</b>
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-2.5 rounded-lg border border-emerald-300 bg-emerald-50/20 p-3 dark:border-emerald-800 dark:bg-emerald-950/20">
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Advance received {view === 'create' ? '(applied in full)' : ''}</span>
                <b>{formatINR(advanceApplied)}</b>
              </div>
              {existingBill && paidOn(existingBill) - (existingBill.advanceApplied || 0) > 0.001 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Paid on this invoice before</span>
                  <b>{formatINR(paidOn(existingBill) - (existingBill.advanceApplied || 0))}</b>
                </div>
              )}
              {excessAdvance > 0 && (
                <p className="flex items-center gap-1.5 rounded bg-amber-100 p-1.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  <AlertTriangle className="h-3.5 w-3.5" /> Advance is {formatINR(excessAdvance)} more than this invoice — refund it to the customer.
                </p>
              )}
            </div>

            {view !== 'edit' && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-emerald-800 dark:text-emerald-400">
                    {view === 'pay' ? 'New payment' : 'Received now'}
                  </h4>
                  <div className="flex gap-1">
                    {(['UPI', 'CASH', 'CARD', 'BANK'] as const).map((m) => (
                      <Button key={m} type="button" size="sm" variant="outline" className="h-6 px-1.5 text-[10px]" onClick={() => fillBalance(m)}>
                        All {m === 'BANK' ? 'Bank' : m[0] + m.slice(1).toLowerCase()}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {(
                    [
                      ['UPI', payUpi, setPayUpi, <Smartphone key="u" className="h-3 w-3 text-violet-600" />],
                      ['Cash', payCash, setPayCash, <Banknote key="c" className="h-3 w-3 text-emerald-600" />],
                      ['Card', payCard, setPayCard, <CreditCard key="k" className="h-3 w-3 text-orange-600" />],
                      ['Bank/NEFT', payBank, setPayBank, <Landmark key="b" className="h-3 w-3 text-blue-600" />],
                    ] as [string, string, (v: string) => void, React.ReactNode][]
                  ).map(([label, value, set, icon]) => (
                    <div key={label} className="space-y-1">
                      <Label className="flex items-center gap-1 text-xs">
                        {icon} {label} (₹)
                      </Label>
                      <Input type="number" min="0" value={value} onChange={(e) => set(e.target.value)} className="h-9 text-xs" />
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="flex items-center justify-between rounded-md bg-muted p-2.5 text-xs">
              <span>
                <span className="text-muted-foreground">Paid {view === 'edit' ? 'so far' : 'after this'}: </span>
                <b>{formatINR(paidBefore + (view === 'edit' ? 0 : newPay))}</b>
              </span>
              <span>
                <span className="text-muted-foreground">Balance due: </span>
                <b className={`text-sm ${balanceAfter > 0.01 ? 'text-red-600' : 'text-emerald-600'}`}>{balanceAfter <= 0.01 ? 'PAID IN FULL' : formatINR(balanceAfter)}</b>
              </span>
            </div>
            {overpaid && <p className="text-xs text-red-600">Payment is more than the balance due.</p>}
            {belowPaid && <p className="text-xs text-red-600">The total cannot be less than what is already paid ({formatINR(paidOn(existingBill!))}).</p>}
          </div>

          {view !== 'pay' && (
            <div className="space-y-1">
              <Label className="text-xs">Invoice notes</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="resize-none text-xs" />
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="gap-1.5" disabled={busy || overpaid || !!belowPaid} onClick={(e) => handleSubmit(e, true)}>
                <Printer className="h-4 w-4" /> Save &amp; Print
              </Button>
              <Button type="submit" className="bg-emerald-600 font-semibold text-white hover:bg-emerald-700" disabled={busy || overpaid || !!belowPaid}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                {view === 'pay' ? 'Record Payment' : view === 'edit' ? 'Save Invoice' : 'Generate Bill'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
