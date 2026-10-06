'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { apiAs, formatINR } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { toast } from '@/hooks/use-toast'
import { BanquetBooking, BanquetBill } from '@/types/banquet'
import { triggerPrintBanquetInvoice } from '@/lib/print-banquet-invoice'
import {
  Receipt,
  Printer,
  CreditCard,
  Banknote,
  Smartphone,
  Landmark,
  Loader2,
  CheckCircle2,
  Percent,
} from 'lucide-react'

interface BanquetBillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  booking?: BanquetBooking | null
  existingBill?: BanquetBill | null
  onSuccess: () => void
}

export function BanquetBillDialog({
  open,
  onOpenChange,
  booking,
  existingBill,
  onSuccess,
}: BanquetBillDialogProps) {
  const [busy, setBusy] = useState(false)
  const isEditing = !!existingBill

  // Charge fields
  const [hallRent, setHallRent] = useState('0')
  const [foodCharges, setFoodCharges] = useState('0')
  const [decorCharges, setDecorCharges] = useState('0')
  const [soundAvCharges, setSoundAvCharges] = useState('0')
  const [extraCharges, setExtraCharges] = useState('0')
  const [discount, setDiscount] = useState('0')
  const [gstPercent, setGstPercent] = useState('18')

  // Payment Settlement fields
  const [advanceApplied, setAdvanceApplied] = useState('0')
  const [payCash, setPayCash] = useState('0')
  const [payUpi, setPayUpi] = useState('0')
  const [payCard, setPayCard] = useState('0')
  const [payBank, setPayBank] = useState('0')

  const [notes, setNotes] = useState('')
  const [managerPin, setManagerPin] = useState('')

  // Initialize values
  useEffect(() => {
    if (existingBill) {
      setHallRent(String(existingBill.hallRent || 0))
      setFoodCharges(String(existingBill.foodCharges || 0))
      setDecorCharges(String(existingBill.decorCharges || 0))
      setSoundAvCharges(String(existingBill.soundAvCharges || 0))
      setExtraCharges(String(existingBill.extraCharges || 0))
      setDiscount(String(existingBill.discount || 0))
      setGstPercent(String(existingBill.gstPercent || 18))
      setAdvanceApplied(String(existingBill.advanceApplied || 0))
      setPayCash(String(existingBill.payCash || 0))
      setPayUpi(String(existingBill.payUpi || 0))
      setPayCard(String(existingBill.payCard || 0))
      setPayBank(String(existingBill.payBank || 0))
      setNotes(existingBill.notes || '')
    } else if (booking) {
      setHallRent(String(booking.hallRent || 0))
      setFoodCharges(String(booking.foodTotal || 0))
      setDecorCharges(String(booking.decorCharges || 0))
      setSoundAvCharges('0')
      setExtraCharges(String(booking.extraCharges || 0))
      setDiscount(String(booking.discount || 0))
      setGstPercent('18')
      setAdvanceApplied(String(booking.advancePaid || 0))

      // Pre-fill remaining amount into UPI/Cash for convenience
      const taxable = Math.max(
        0,
        (booking.hallRent || 0) +
          (booking.foodTotal || 0) +
          (booking.decorCharges || 0) +
          (booking.extraCharges || 0) -
          (booking.discount || 0)
      )
      const gst = Math.round(((taxable * 18) / 100) * 100) / 100
      const grand = taxable + gst
      const balance = Math.max(0, grand - (booking.advancePaid || 0))
      setPayUpi(String(Math.round(balance)))
      setPayCash('0')
      setPayCard('0')
      setPayBank('0')
      setNotes(booking.notes || '')
    }
  }, [booking, existingBill, open])

  // Calculations
  const numHall = Math.max(0, parseFloat(hallRent) || 0)
  const numFood = Math.max(0, parseFloat(foodCharges) || 0)
  const numDecor = Math.max(0, parseFloat(decorCharges) || 0)
  const numSound = Math.max(0, parseFloat(soundAvCharges) || 0)
  const numExtra = Math.max(0, parseFloat(extraCharges) || 0)
  const numDiscount = Math.max(0, parseFloat(discount) || 0)
  const numGstPct = Math.max(0, parseFloat(gstPercent) || 0)

  const taxableAmount = Math.max(0, numHall + numFood + numDecor + numSound + numExtra - numDiscount)
  const gstAmount = Math.round(((taxableAmount * numGstPct) / 100) * 100) / 100
  const grandTotal = Math.round((taxableAmount + gstAmount) * 100) / 100

  const numAdvance = Math.max(0, parseFloat(advanceApplied) || 0)
  const numCash = Math.max(0, parseFloat(payCash) || 0)
  const numUpi = Math.max(0, parseFloat(payUpi) || 0)
  const numCard = Math.max(0, parseFloat(payCard) || 0)
  const numBank = Math.max(0, parseFloat(payBank) || 0)

  const totalPaid = numAdvance + numCash + numUpi + numCard + numBank
  const balanceDue = Math.max(0, Math.round((grandTotal - totalPaid) * 100) / 100)

  function autoFillBalance(mode: 'CASH' | 'UPI' | 'CARD' | 'BANK') {
    const unadjusted = Math.max(0, grandTotal - numAdvance)
    setPayCash(mode === 'CASH' ? String(unadjusted) : '0')
    setPayUpi(mode === 'UPI' ? String(unadjusted) : '0')
    setPayCard(mode === 'CARD' ? String(unadjusted) : '0')
    setPayBank(mode === 'BANK' ? String(unadjusted) : '0')
  }

  async function handleSubmit(e: React.FormEvent, andPrint = false) {
    e.preventDefault()
    if (!booking && !existingBill) return

    setBusy(true)
    try {
      if (isEditing && existingBill) {
        // Payment settlement update
        const updated = await apiAs<BanquetBill>('/api/banquet-bills', getCachedUser(), {
          method: 'POST',
          body: JSON.stringify({
            action: 'payment',
            id: existingBill.id,
            payCash: numCash,
            payUpi: numUpi,
            payCard: numCard,
            payBank: numBank,
          }),
        })
        toast({ variant: 'success', title: 'Payment Recorded', description: `Invoice ${existingBill.billNumber} payment updated.` })
        if (andPrint) triggerPrintBanquetInvoice(updated)
      } else if (booking) {
        const bill = await apiAs<BanquetBill>('/api/banquet-bills', getCachedUser(), {
          method: 'POST',
          body: JSON.stringify({
            banquetBookingId: booking.id,
            hallRent: numHall,
            foodCharges: numFood,
            decorCharges: numDecor,
            soundAvCharges: numSound,
            extraCharges: numExtra,
            discount: numDiscount,
            gstPercent: numGstPct,
            advanceApplied: numAdvance,
            payCash: numCash,
            payUpi: numUpi,
            payCard: numCard,
            payBank: numBank,
            notes,
          }),
        })
        toast({ variant: 'success', title: 'Invoice Generated', description: `Banquet Invoice ${bill.billNumber} generated successfully.` })
        if (andPrint) triggerPrintBanquetInvoice(bill)
      }
      onSuccess()
      onOpenChange(false)
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Billing Error',
        description: err instanceof Error ? err.message : 'Failed to generate banquet invoice',
      })
    } finally {
      setBusy(false)
    }
  }

  const activeCustomer = booking?.customerName || existingBill?.customerName || 'Customer'
  const activeEvent = booking?.eventName || existingBill?.eventName || 'Event'
  const activeHall = booking?.hall?.name || existingBill?.hallName || 'Banquet Hall'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Receipt className="h-5 w-5 text-emerald-600" />
            {isEditing ? `Banquet Invoice Settlement (${existingBill?.billNumber})` : 'Generate Banquet Tax Invoice'}
          </DialogTitle>
          <DialogDescription>
            {activeEvent} · {activeCustomer} · {activeHall}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => handleSubmit(e, false)} className="space-y-4 pt-2">
          {/* Bill Line Items */}
          <div className="rounded-lg border p-3 bg-muted/30 space-y-2.5">
            <h4 className="text-xs font-bold text-emerald-800 dark:text-emerald-400 uppercase tracking-wide">
              Invoice Line Items &amp; Charges
            </h4>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">Hall Rent (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  value={hallRent}
                  onChange={(e) => setHallRent(e.target.value)}
                  disabled={isEditing}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Catering / Food (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  value={foodCharges}
                  onChange={(e) => setFoodCharges(e.target.value)}
                  disabled={isEditing}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Stage &amp; Decor (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  value={decorCharges}
                  onChange={(e) => setDecorCharges(e.target.value)}
                  disabled={isEditing}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">DJ &amp; Sound / AV (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  value={soundAvCharges}
                  onChange={(e) => setSoundAvCharges(e.target.value)}
                  disabled={isEditing}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Extra Services (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  value={extraCharges}
                  onChange={(e) => setExtraCharges(e.target.value)}
                  disabled={isEditing}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Discount (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  disabled={isEditing}
                  className="h-9 text-xs text-emerald-600 font-semibold"
                />
              </div>
            </div>

            {/* GST & Totals Summary */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t text-xs">
              <div className="flex items-center gap-2">
                <Label className="text-xs">GST Rate:</Label>
                <Select value={gstPercent} onValueChange={setGstPercent} disabled={isEditing}>
                  <SelectTrigger className="h-8 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="18">18% GST</SelectItem>
                    <SelectItem value="12">12% GST</SelectItem>
                    <SelectItem value="5">5% GST</SelectItem>
                    <SelectItem value="0">0% (Exempt)</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-muted-foreground">({formatINR(gstAmount)})</span>
              </div>

              <div className="text-right">
                <span className="text-muted-foreground mr-2">Taxable: <b>{formatINR(taxableAmount)}</b></span>
                <span className="text-sm font-bold text-foreground">Grand Total: <b className="text-emerald-700 dark:text-emerald-400">{formatINR(grandTotal)}</b></span>
              </div>
            </div>
          </div>

          {/* Payment Settlement */}
          <div className="rounded-lg border p-3 space-y-2.5 bg-emerald-50/20 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-emerald-800 dark:text-emerald-400 uppercase tracking-wide">
                Payment Collection &amp; Settlement
              </h4>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="outline" className="h-6 text-[10px] px-1.5" onClick={() => autoFillBalance('UPI')}>
                  All UPI
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-6 text-[10px] px-1.5" onClick={() => autoFillBalance('CASH')}>
                  All Cash
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-6 text-[10px] px-1.5" onClick={() => autoFillBalance('CARD')}>
                  All Card
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-6 text-[10px] px-1.5" onClick={() => autoFillBalance('BANK')}>
                  All Bank
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
              <div className="space-y-1">
                <Label className="text-xs">Advance (₹)</Label>
                <Input
                  type="number"
                  min="0"
                  value={advanceApplied}
                  onChange={(e) => setAdvanceApplied(e.target.value)}
                  disabled={isEditing}
                  className="h-9 text-xs text-muted-foreground bg-muted"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  <Smartphone className="h-3 w-3 text-violet-600" /> UPI (₹)
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={payUpi}
                  onChange={(e) => setPayUpi(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  <Banknote className="h-3 w-3 text-emerald-600" /> Cash (₹)
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={payCash}
                  onChange={(e) => setPayCash(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  <CreditCard className="h-3 w-3 text-orange-600" /> Card (₹)
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={payCard}
                  onChange={(e) => setPayCard(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1">
                  <Landmark className="h-3 w-3 text-blue-600" /> Bank/NEFT (₹)
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={payBank}
                  onChange={(e) => setPayBank(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            {/* Total Paid & Balance Summary */}
            <div className="flex items-center justify-between rounded-md bg-muted p-2.5 text-xs">
              <div>
                <span className="text-muted-foreground">Total Settled: </span>
                <span className="font-bold text-foreground">{formatINR(totalPaid)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Balance Due: </span>
                <span className={`font-bold text-sm ${balanceDue > 0.01 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {balanceDue <= 0.01 ? 'PAID IN FULL (₹0)' : formatINR(balanceDue)}
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Invoice Notes / Special Remarks</Label>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Stage lights and sound included in contract..."
              className="text-xs resize-none"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                className="gap-1.5"
                disabled={busy}
                onClick={(e) => handleSubmit(e, true)}
              >
                <Printer className="h-4 w-4" /> Save &amp; Print
              </Button>
              <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold" disabled={busy}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                {isEditing ? 'Update Payment' : 'Generate Bill'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
