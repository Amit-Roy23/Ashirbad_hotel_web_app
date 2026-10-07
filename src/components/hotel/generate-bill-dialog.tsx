'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { apiAs, formatINR, formatDate, LODGING_GST_RATES, normalizeLodgingGst } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { Loader2, Info, ShieldCheck } from 'lucide-react'

interface Guest {
  id: string
  name: string
  phone: string
  company?: string | null
  gst?: string | null
}

interface Room {
  id: string
  number: string
  type?: string
}

interface Booking {
  id: string
  checkIn: string
  days: number
  autoExtendedDays?: number
  originalCheckOut?: string | null
  ratePerDay: number
  advance: number
  isCorporate?: boolean
  guest: Guest
  room: Room
  foodOrders?: { id: string; total: number }[]
}

export interface Bill {
  id: string
  billNumber: string
  days: number
  actualRoomTotal: number
  billedRoomTotal: number
  roomNumber?: string | null
  roomDescription?: string | null
  gstPercent: number
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
  createdBy?: string | null
  approvedBy?: string | null
  notes?: string | null
  createdAt: string
  booking: Booking
}

interface GenerateBillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  booking: Booking | null
  defaultGstPercent?: string
  onSuccess: (bill: Bill) => void
}

export function GenerateBillDialog({
  open,
  onOpenChange,
  booking,
  defaultGstPercent = '5',
  onSuccess,
}: GenerateBillDialogProps) {
  const [days, setDays] = useState('1')
  const [customMode, setCustomMode] = useState(false)
  const [customTotal, setCustomTotal] = useState('')
  const [roomNumber, setRoomNumber] = useState('')
  const [roomDescription, setRoomDescription] = useState('')
  const [gstPercent, setGstPercent] = useState(normalizeLodgingGst(defaultGstPercent))
  const [extraCharges, setExtraCharges] = useState('0')
  const [discount, setDiscount] = useState('0')
  const [includeFood, setIncludeFood] = useState(false)
  const [payCash, setPayCash] = useState('0')
  const [payUpi, setPayUpi] = useState('0')
  const [payCard, setPayCard] = useState('0')
  const [corporateName, setCorporateName] = useState('')
  const [gstNumber, setGstNumber] = useState('')
  const [managerPin, setManagerPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && booking) {
      const initDays = booking.days || 1
      const initRoom = booking.ratePerDay * initDays
      const initFood = (booking.foodOrders || []).reduce((s, o) => s + o.total, 0)
      const initTaxable = initRoom + initFood
      const gst = parseFloat(normalizeLodgingGst(defaultGstPercent)) || 0
      const initGrand = Math.round((initTaxable + (initTaxable * gst) / 100) * 100) / 100
      const initAdv = Math.min(booking.advance || 0, initGrand)
      const initPayable = Math.max(0, Math.round((initGrand - initAdv) * 100) / 100)

      setDays(String(initDays))
      setCustomMode(false)
      setCustomTotal('')
      setRoomNumber(booking.room?.number || '')
      setRoomDescription(booking.room?.type || 'Non-AC')
      setGstPercent(normalizeLodgingGst(defaultGstPercent))
      setExtraCharges('0')
      setDiscount('0')
      // Pending room-service must land on this bill; checkout is refused if it would be left behind
      setIncludeFood((booking.foodOrders || []).some((o) => o.total > 0))
      setPayCash(String(initPayable))
      setPayUpi('0')
      setPayCard('0')
      setCorporateName(booking.guest?.company || '')
      setGstNumber(booking.guest?.gst || '')
      setManagerPin('')
      setError('')
    }
  }, [open, booking, defaultGstPercent])

  const num = (v: string) => parseFloat(v) || 0

  const calc = useMemo(() => {
    if (!booking) return null
    const billDays = num(days) || 1
    const actualRoomTotal = booking.ratePerDay * billDays
    const billedRoom = customMode && num(customTotal) > 0 ? num(customTotal) : actualRoomTotal
    const foodTotal = includeFood && booking.foodOrders ? booking.foodOrders.reduce((s, o) => s + o.total, 0) : 0
    const extra = num(extraCharges)
    const disc = num(discount)

    // Customer-facing full total
    const taxable = Math.max(0, billedRoom + foodTotal + extra - disc)
    const gstAmount = Math.round(taxable * num(gstPercent)) / 100
    const grandTotal = Math.max(0, Math.round((taxable + gstAmount) * 100) / 100)
    const advanceApplied = Math.min(booking.advance || 0, grandTotal)
    const payable = Math.max(0, Math.round((grandTotal - advanceApplied) * 100) / 100)

    // Hotel internal accounting total
    const internalTaxable = Math.max(0, actualRoomTotal + foodTotal + extra - disc)
    const internalGst = Math.round(internalTaxable * num(gstPercent)) / 100
    const internalTotal = Math.max(0, Math.round((internalTaxable + internalGst) * 100) / 100)

    const paid = num(payCash) + num(payUpi) + num(payCard)
    const balance = Math.max(0, Math.round((payable - paid) * 100) / 100)
    const adjustment = billedRoom - actualRoomTotal

    return {
      billDays,
      actualRoomTotal,
      billedRoom,
      foodTotal,
      taxable,
      gstAmount,
      grandTotal,
      advanceApplied,
      payable,
      internalTaxable,
      internalGst,
      internalTotal,
      paid,
      balance,
      adjustment,
    }
  }, [booking, days, customMode, customTotal, includeFood, extraCharges, discount, gstPercent, payCash, payUpi, payCard])

  function autoBalance(method: 'CASH' | 'UPI' | 'CARD') {
    if (!calc) return
    const zero = '0'
    setPayCash(zero)
    setPayUpi(zero)
    setPayCard(zero)
    const v = String(calc.payable)
    if (method === 'CASH') setPayCash(v)
    if (method === 'UPI') setPayUpi(v)
    if (method === 'CARD') setPayCard(v)
  }

  async function generateBill() {
    if (!booking || !calc) return
    if (num(days) < 1) {
      setError('Billable Days must be at least 1')
      return
    }
    const realRoomNo = booking.room?.number || ''
    const realType = booking.room?.type || 'Non-AC'
    const descChanged = roomDescription.trim() !== '' && roomDescription.trim() !== realType
    const roomNoChanged = roomNumber.trim() !== '' && roomNumber.trim() !== realRoomNo
    const autoDays = booking.autoExtendedDays || 0
    const isWaivingOverstay = autoDays > 0 && num(days) < booking.days
    if (isWaivingOverstay && (!managerPin || managerPin.trim().length < 3)) {
      setError('Manager or Admin PIN is required to reduce/waive auto-extended overstay days')
      return
    }
    if (customMode) {
      if (num(customTotal) <= 0 && !descChanged && !roomNoChanged) {
        setError('Billed Amount (Custom), a custom Room No., or a custom Room Description is required for custom billing')
        return
      }
      if (!managerPin || managerPin.trim().length < 3) {
        setError('Manager or Admin PIN (approval) is mandatory for custom billing')
        return
      }
    }
    if (booking.isCorporate && !corporateName.trim()) {
      setError('Company Name is required for Corporate Guest bill')
      return
    }
    if (calc.paid > calc.payable + 0.01) {
      setError(`Payment split (₹${calc.paid}) cannot exceed payable amount (₹${calc.payable})`)
      return
    }
    if (calc.balance > 0.01) {
      setError(`Full payment required before the bill can be generated or printed. Collect the outstanding ${formatINR(calc.balance)}.`)
      return
    }
    setSaving(true)
    setError('')
    try {
      const user = getCachedUser()
      const bill = await apiAs<Bill>('/api/bills', user, {
        method: 'POST',
        body: JSON.stringify({
          bookingId: booking.id,
          days: num(days),
          billedRoomTotal: customMode && num(customTotal) > 0 ? num(customTotal) : undefined,
          roomNumber: customMode && roomNumber.trim() ? roomNumber.trim() : undefined,
          roomDescription: customMode && roomDescription.trim() ? roomDescription.trim() : undefined,
          gstPercent: num(gstPercent),
          extraCharges: num(extraCharges),
          discount: num(discount),
          payCash: num(payCash),
          payUpi: num(payUpi),
          payCard: num(payCard),
          includeFood,
          corporateName: corporateName || undefined,
          gstNumber: gstNumber || undefined,
          managerPin: (customMode || isWaivingOverstay) ? managerPin.trim() : undefined,
          checkout: true,
        }),
      })
      onSuccess(bill)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Billing failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lodging Bill &amp; Checkout — Room {booking?.room?.number}</DialogTitle>
          <DialogDescription>
            {booking?.guest?.name} • {booking?.guest?.phone} • In: {formatDate(booking?.checkIn)}
          </DialogDescription>
        </DialogHeader>

        {booking && calc && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">Corporate Custom Billing</p>
                <p className="text-xs text-muted-foreground">Bill a custom tariff, room number, or description (actual rate credited internally)</p>
              </div>
              <Switch checked={customMode} onCheckedChange={setCustomMode} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">Room Charge (Actual)</Label>
                <div className="h-9 rounded-md bg-muted px-3 flex items-center text-xs font-semibold">
                  {formatINR(calc.actualRoomTotal)}{' '}
                  <span className="text-[11px] font-normal text-muted-foreground ml-1">({num(days)}n × {formatINR(booking.ratePerDay)})</span>
                </div>
              </div>
              {customMode ? (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-violet-700 dark:text-violet-300">Billed Amount (Custom) *</Label>
                  <Input type="number" value={customTotal} onChange={(e) => setCustomTotal(e.target.value)} placeholder="e.g. 1500" className="h-9 text-xs" />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">Billed Amount</Label>
                  <div className="h-9 rounded-md bg-emerald-50 px-3 flex items-center text-xs font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                    {formatINR(calc.billedRoom)}
                  </div>
                </div>
              )}
            </div>

            {customMode && (
              <div className="space-y-3 rounded-lg border border-violet-300 bg-violet-50/50 p-3 dark:border-violet-800 dark:bg-violet-950/30">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-violet-800 dark:text-violet-200">
                      Room No. (shown on invoice)
                    </Label>
                    <Input
                      value={roomNumber}
                      onChange={(e) => setRoomNumber(e.target.value)}
                      placeholder={booking.room?.number || 'e.g. 101'}
                      className="h-9 text-xs bg-white dark:bg-slate-900"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-violet-800 dark:text-violet-200">
                      Room description (shown on invoice)
                    </Label>
                    <Input
                      value={roomDescription}
                      onChange={(e) => setRoomDescription(e.target.value)}
                      placeholder={booking.room?.type || 'e.g. Deluxe AC Room'}
                      className="h-9 text-xs bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Internal revenue: <b>{formatINR(calc.internalTotal)}</b> (actual tariff + GST)
                </p>

                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-violet-700 dark:text-violet-300" />
                    <Label htmlFor="mgr-pin" className="text-xs font-semibold text-violet-800 dark:text-violet-200">
                      Manager / Admin PIN (approval) *
                    </Label>
                  </div>
                  <Input
                    id="mgr-pin"
                    type="password"
                    inputMode="numeric"
                    placeholder="Enter your PIN to approve custom billing"
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value)}
                    autoComplete="off"
                    className="h-9 text-xs bg-white dark:bg-slate-900"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Login name: {getCachedUser()?.name || 'not signed in'} — must be ADMIN or MANAGER role.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-foreground">
                    Fooding Bill {calc.foodTotal > 0 && `(${formatINR(calc.foodTotal)})`}
                  </Label>
                  {calc.foodTotal > 0 && (
                    <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">Room Service</span>
                  )}
                </div>
                <div className="flex h-9 items-center justify-between rounded-md border px-2.5 bg-card">
                  <span className="text-xs text-muted-foreground">
                    {includeFood ? 'Include in Bill' : 'Separate'}
                  </span>
                  <Switch checked={includeFood} onCheckedChange={setIncludeFood} className="scale-75" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">Discount (₹)</Label>
                <Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} className="h-9 text-xs" />
              </div>
            </div>

            {/* Stay breakdown: planned nights + auto-extended days */}
            {(() => {
              const autoDays = booking.autoExtendedDays || 0
              const plannedNights = Math.max(1, booking.days - autoDays)
              return autoDays > 0 ? (
                <div className="rounded-md border border-amber-300 bg-amber-50/80 p-2.5 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  <span className="font-semibold">Stay Breakdown:</span> Planned {plannedNights} night{plannedNights > 1 ? 's' : ''} + {autoDays} auto-extended day{autoDays > 1 ? 's' : ''} = {booking.days} days total.
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  Planned Stay: <b>{booking.days} night{booking.days > 1 ? 's' : ''}</b>
                </div>
              )
            })()}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">GST % *</Label>
                {/* Lodging bills are issued at 0% or 5% GST only */}
                <div className="grid h-9 grid-cols-2 gap-1">
                  {LODGING_GST_RATES.map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setGstPercent(pct)}
                      className={`rounded border text-xs font-semibold transition-colors ${
                        num(gstPercent) === num(pct)
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">Billable Days *</Label>
                <Input type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} className="h-9 text-xs" />
              </div>
            </div>

            {/* Overstay waiver Manager/Admin PIN requirement */}
            {(() => {
              const autoDays = booking.autoExtendedDays || 0
              const isWaiving = autoDays > 0 && num(days) < booking.days
              if (!isWaiving || customMode) return null
              return (
                <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/80 p-3 dark:border-amber-800 dark:bg-amber-950/40">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200">
                    <ShieldCheck className="h-4 w-4 text-amber-700 dark:text-amber-300" />
                    <span>Manager / Admin PIN (Waive Overstay) *</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Reducing billable days from {booking.days} to {num(days)} waives auto-extended stay charges and requires Manager/Admin authorization.
                  </p>
                  <Input
                    type="password"
                    inputMode="numeric"
                    placeholder="Enter Manager/Admin PIN"
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value)}
                    className="h-9 text-xs bg-white dark:bg-slate-900"
                  />
                </div>
              )
            })()}

            {(corporateName || gstNumber || num(gstPercent) > 0 || booking.isCorporate) && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">
                    Bill To (Company) {booking.isCorporate ? <span className="text-red-500">*</span> : ''}
                  </Label>
                  <Input value={corporateName} onChange={(e) => setCorporateName(e.target.value)} placeholder="Company name" className="h-9 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">GSTIN</Label>
                  <Input value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} placeholder="GST number" className="h-9 text-xs uppercase" />
                </div>
              </div>
            )}

            <Separator />

            {/* Breakdown summary */}
            <div className="space-y-1.5 rounded-lg bg-muted/50 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Room ({customMode ? 'custom billed' : 'actual'})</span>
                <span className="font-medium">{formatINR(calc.billedRoom)}</span>
              </div>
              {calc.foodTotal > 0 && includeFood && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Food charges</span>
                  <span className="font-medium">{formatINR(calc.foodTotal)}</span>
                </div>
              )}
              {num(extraCharges) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Extra charges</span>
                  <span className="font-medium">{formatINR(num(extraCharges))}</span>
                </div>
              )}
              {num(discount) > 0 && (
                <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                  <span>Discount</span>
                  <span className="font-medium">-{formatINR(num(discount))}</span>
                </div>
              )}
              {calc.gstAmount > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">GST ({num(gstPercent)}%)</span>
                  <span className="font-medium">{formatINR(calc.gstAmount)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between font-bold text-sm">
                <span>Grand Total</span>
                <span className="text-slate-900 dark:text-white">{formatINR(calc.grandTotal)}</span>
              </div>
              {calc.advanceApplied > 0 && (
                <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                  <span>Less: Advance received</span>
                  <span className="font-medium">-{formatINR(calc.advanceApplied)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-bold text-emerald-700 dark:text-emerald-400 pt-1 border-t">
                <span>Payable now</span>
                <span>{formatINR(calc.payable)}</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground">Payment Split</p>
                <span className="text-[10px] text-muted-foreground">Split across Cash, UPI, Card</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium">Cash</Label>
                  <Input type="number" value={payCash} onChange={(e) => setPayCash(e.target.value)} className="h-9 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium">UPI</Label>
                  <Input type="number" value={payUpi} onChange={(e) => setPayUpi(e.target.value)} className="h-9 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px] font-medium">Card</Label>
                  <Input type="number" value={payCard} onChange={(e) => setPayCard(e.target.value)} className="h-9 text-xs" />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px] font-semibold" onClick={() => autoBalance('CASH')}>
                    All Cash
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px] font-semibold" onClick={() => autoBalance('UPI')}>
                    All UPI
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11px] font-semibold" onClick={() => autoBalance('CARD')}>
                    All Card
                  </Button>
                </div>
                <span className={calc.balance > 0.01 ? 'font-bold text-amber-600 text-xs' : 'font-bold text-emerald-700 dark:text-emerald-400 text-xs'}>
                  {calc.balance > 0.01 ? `Outstanding: ${formatINR(calc.balance)}` : '✓ Fully paid'}
                </span>
              </div>
            </div>

            {error && <p className="text-xs font-medium text-destructive">{error}</p>}

            {calc.balance > 0.01 && (
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                Collect the full amount ({formatINR(calc.balance)} outstanding) to generate and print the bill.
              </p>
            )}
            <Button
              className="w-full h-9 bg-emerald-600 hover:bg-emerald-700 font-semibold text-white text-xs"
              onClick={generateBill}
              disabled={saving || calc.balance > 0.01}
            >
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Generate Bill &amp; Check Out
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
