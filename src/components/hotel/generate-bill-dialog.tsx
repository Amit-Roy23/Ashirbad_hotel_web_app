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
import { apiAs, formatINR, formatDate } from '@/lib/hotel-utils'
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
  defaultGstPercent = '12',
  onSuccess,
}: GenerateBillDialogProps) {
  const [days, setDays] = useState('1')
  const [customMode, setCustomMode] = useState(false)
  const [customTotal, setCustomTotal] = useState('')
  const [roomNumber, setRoomNumber] = useState('')
  const [roomDescription, setRoomDescription] = useState('')
  const [gstPercent, setGstPercent] = useState(defaultGstPercent)
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
      setDays(String(booking.days || 1))
      setCustomMode(false)
      setCustomTotal('')
      setRoomNumber(booking.room?.number || '')
      setRoomDescription(booking.room?.type || 'Non-AC')
      setGstPercent(defaultGstPercent)
      setExtraCharges('0')
      setDiscount('0')
      setIncludeFood(false)
      setPayCash('0')
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
          managerPin: customMode ? managerPin : undefined,
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
          <DialogTitle>Generate Bill — Room {booking?.room?.number}</DialogTitle>
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
                <Label>Room Charge (Actual)</Label>
                <div className="rounded-md bg-muted px-3 py-2 text-sm font-semibold">
                  {formatINR(calc.actualRoomTotal)}{' '}
                  <span className="text-xs font-normal text-muted-foreground">({num(days)}n × {formatINR(booking.ratePerDay)})</span>
                </div>
              </div>
              {customMode ? (
                <div className="space-y-1.5">
                  <Label className="text-violet-700 dark:text-violet-300">Billed Amount (Custom) *</Label>
                  <Input type="number" value={customTotal} onChange={(e) => setCustomTotal(e.target.value)} placeholder="e.g. 1500" />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>Billed Amount</Label>
                  <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold dark:bg-emerald-950">
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
                      className="bg-white dark:bg-slate-900"
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
                      className="bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Internal revenue: <b>{formatINR(calc.internalTotal)}</b> (actual tariff + GST)
                </p>

                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-violet-700 dark:text-violet-300" />
                    <Label htmlFor="mgr-pin" className="text-xs font-medium text-violet-800 dark:text-violet-200">
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
                    className="bg-white dark:bg-slate-900"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Login name: {getCachedUser()?.name || 'not signed in'} — must be ADMIN or MANAGER role.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Food {calc.foodTotal > 0 && `(${formatINR(calc.foodTotal)})`}</Label>
                <div className="flex items-center justify-between rounded-md border px-2.5 py-2">
                  <span className="text-xs">Add to bill</span>
                  <Switch checked={includeFood} onCheckedChange={setIncludeFood} className="scale-75" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Discount (₹)</Label>
                <Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>GST % *</Label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setGstPercent('0')}
                      className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border transition-colors ${
                        num(gstPercent) === 0 ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      Non-GST (0%)
                    </button>
                    <button
                      type="button"
                      onClick={() => setGstPercent('12')}
                      className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border transition-colors ${
                        num(gstPercent) === 12 ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      12%
                    </button>
                    <button
                      type="button"
                      onClick={() => setGstPercent('18')}
                      className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border transition-colors ${
                        num(gstPercent) === 18 ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      18%
                    </button>
                  </div>
                </div>
                <Input type="number" value={gstPercent} onChange={(e) => setGstPercent(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Billable Days *</Label>
                <Input type="number" min="1" value={days} onChange={(e) => setDays(e.target.value)} />
              </div>
            </div>

            {(corporateName || gstNumber || num(gstPercent) > 0 || booking.isCorporate) && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>
                    Bill To (Company) {booking.isCorporate ? <span className="text-red-500">*</span> : ''}
                  </Label>
                  <Input value={corporateName} onChange={(e) => setCorporateName(e.target.value)} placeholder="Company name" />
                </div>
                <div className="space-y-1.5">
                  <Label>GSTIN</Label>
                  <Input value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} placeholder="GST number" />
                </div>
              </div>
            )}

            <Separator />

            {/* Breakdown summary */}
            <div className="space-y-1.5 rounded-lg bg-muted p-3 text-sm">
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
              <div className="flex justify-between font-bold">
                <span>Grand Total</span>
                <span className="text-slate-900 dark:text-white">{formatINR(calc.grandTotal)}</span>
              </div>
              {calc.advanceApplied > 0 && (
                <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                  <span>Less: Advance received</span>
                  <span className="font-medium">-{formatINR(calc.advanceApplied)}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-bold text-emerald-700 dark:text-emerald-400 pt-1 border-t">
                <span>Payable now</span>
                <span>{formatINR(calc.payable)}</span>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold">Payment Split</p>
                <span className="text-[11px] text-muted-foreground">Pay less than payable to leave an outstanding balance</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Cash</Label>
                  <Input type="number" value={payCash} onChange={(e) => setPayCash(e.target.value)} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">UPI</Label>
                  <Input type="number" value={payUpi} onChange={(e) => setPayUpi(e.target.value)} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[11px]">Card</Label>
                  <Input type="number" value={payCard} onChange={(e) => setPayCard(e.target.value)} className="h-9" />
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex gap-1.5">
                  <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => autoBalance('CASH')}>
                    All Cash
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => autoBalance('UPI')}>
                    All UPI
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]" onClick={() => autoBalance('CARD')}>
                    All Card
                  </Button>
                </div>
                <span className={calc.balance > 0.01 ? 'font-bold text-amber-600' : 'font-bold text-emerald-700 dark:text-emerald-400'}>
                  {calc.balance > 0.01 ? `Outstanding: ${formatINR(calc.balance)}` : '✓ Fully paid'}
                </span>
              </div>
            </div>

            {error && <p className="text-sm font-medium text-destructive">{error}</p>}

            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={generateBill} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Generate Bill &amp; Check Out
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
