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
import { Separator } from '@/components/ui/separator'
import { apiAs, formatINR, formatDateTime } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { Loader2, Info, Edit3, ShieldCheck } from 'lucide-react'

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
  booking: {
    id: string
    checkIn: string
    days: number
    ratePerDay: number
    advance: number
    guest: {
      id: string
      name: string
      phone: string
      company?: string | null
      gst?: string | null
    }
    room: {
      id: string
      number: string
      type?: string
    }
  }
}

interface EditBillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bill: any
  onSuccess: (updatedBill: any) => void
}

export function EditBillDialog({
  open,
  onOpenChange,
  bill,
  onSuccess,
}: EditBillDialogProps) {
  const [billedRoomTotal, setBilledRoomTotal] = useState('')
  const [roomNumber, setRoomNumber] = useState('')
  const [roomDescription, setRoomDescription] = useState('')
  const [gstPercent, setGstPercent] = useState('12')
  const [extraCharges, setExtraCharges] = useState('0')
  const [discount, setDiscount] = useState('0')
  const [payCash, setPayCash] = useState('0')
  const [payUpi, setPayUpi] = useState('0')
  const [payCard, setPayCard] = useState('0')
  const [corporateName, setCorporateName] = useState('')
  const [gstNumber, setGstNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [managerPin, setManagerPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isFinalized = bill?.status === 'FINAL' || !bill?.status

  useEffect(() => {
    if (open && bill) {
      setBilledRoomTotal(String(bill.billedRoomTotal))
      setRoomNumber(bill.roomNumber || bill.booking?.room?.number || '')
      setRoomDescription(bill.roomDescription || bill.booking?.room?.type || '')
      setGstPercent(String(bill.gstPercent))
      setExtraCharges(String(bill.extraCharges || 0))
      setDiscount(String(bill.discount || 0))
      setPayCash(String(bill.payCash || 0))
      setPayUpi(String(bill.payUpi || 0))
      setPayCard(String(bill.payCard || 0))
      setCorporateName(bill.corporateName || bill.booking?.guest?.company || '')
      setGstNumber(bill.gstNumber || bill.booking?.guest?.gst || '')
      setNotes(bill.notes || '')
      setManagerPin('')
      setError('')
    }
  }, [open, bill])

  const num = (v: string) => {
    const parsed = parseFloat(v)
    return isNaN(parsed) ? 0 : parsed
  }

  const calc = useMemo(() => {
    if (!bill) return null
    const actualRoomTotal = bill.actualRoomTotal
    const customerAmount = num(billedRoomTotal)
    const gstRate = num(gstPercent)
    const extra = num(extraCharges)
    const disc = num(discount)
    const foodTotal = bill.foodTotal || 0

    const taxable = Math.max(0, customerAmount + foodTotal + extra - disc)
    const gstAmount = Math.round(taxable * gstRate) / 100
    const grandTotal = Math.max(0, Math.round((taxable + gstAmount) * 100) / 100)
    const advanceApplied = Math.min(bill.booking?.advance || 0, grandTotal)
    const payable = Math.max(0, Math.round((grandTotal - advanceApplied) * 100) / 100)

    const internalTaxable = Math.max(0, actualRoomTotal + foodTotal + extra - disc)
    const internalGst = Math.round(internalTaxable * gstRate) / 100
    const internalTotal = Math.round((internalTaxable + internalGst) * 100) / 100

    const paid = num(payCash) + num(payUpi) + num(payCard)
    const balance = Math.max(0, Math.round((payable - paid) * 100) / 100)

    return {
      actualRoomTotal,
      customerAmount,
      gstRate,
      extra,
      disc,
      foodTotal,
      taxable,
      gstAmount,
      advanceApplied,
      grandTotal,
      payable,
      internalTaxable,
      internalGst,
      internalTotal,
      paid,
      balance,
    }
  }, [bill, billedRoomTotal, gstPercent, extraCharges, discount, payCash, payUpi, payCard])

  const isCustom = useMemo(() => {
    if (!bill || !calc) return false
    const realType = bill.booking?.room?.type || ''
    const realNumber = bill.booking?.room?.number || ''
    const amountDiff = Math.abs(calc.customerAmount - bill.actualRoomTotal) > 0.01
    const descDiff = roomDescription.trim() !== '' && roomDescription.trim() !== realType
    const roomNoDiff = roomNumber.trim() !== '' && roomNumber.trim() !== realNumber
    return amountDiff || descDiff || roomNoDiff
  }, [bill, calc, roomDescription, roomNumber])

  const requiresPin = isFinalized || isCustom

  function autoBalance(method: 'CASH' | 'UPI' | 'CARD') {
    if (!calc) return
    setPayCash('0')
    setPayUpi('0')
    setPayCard('0')
    const val = String(calc.payable)
    if (method === 'CASH') setPayCash(val)
    if (method === 'UPI') setPayUpi(val)
    if (method === 'CARD') setPayCard(val)
  }

  async function handleSave() {
    if (!bill || !calc) return

    if (requiresPin && (!managerPin || managerPin.trim().length < 3)) {
      setError(
        isFinalized
          ? 'This bill is finalized & locked. Manager/Admin authorization PIN is required for administrative corrections.'
          : 'Manager/Admin authorization PIN is required for custom billing tariff or room description.'
      )
      return
    }

    const parsedGst = parseFloat(gstPercent)
    if (isNaN(parsedGst) || !isFinite(parsedGst) || parsedGst < 0 || parsedGst > 100) {
      setError('GST percentage must be a valid number between 0 and 100')
      return
    }

    const parsedCustomerAmount = parseFloat(billedRoomTotal)
    if (isNaN(parsedCustomerAmount) || !isFinite(parsedCustomerAmount) || parsedCustomerAmount < 0) {
      setError('Customer-facing amount must be a valid non-negative number')
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
      const updated = await apiAs<Bill>('/api/bills', user, {
        method: 'PATCH',
        body: JSON.stringify({
          id: bill.id,
          billedRoomTotal: parsedCustomerAmount,
          roomNumber: roomNumber.trim() || undefined,
          roomDescription: roomDescription.trim() || undefined,
          gstPercent: parsedGst,
          extraCharges: num(extraCharges),
          discount: num(discount),
          payCash: num(payCash),
          payUpi: num(payUpi),
          payCard: num(payCard),
          corporateName: corporateName || null,
          gstNumber: gstNumber || null,
          notes: notes || null,
          managerPin: managerPin ? managerPin.trim() : undefined,
        }),
      })
      onSuccess(updated)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update bill')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit3 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> Edit Bill — {bill?.billNumber}
          </DialogTitle>
          <DialogDescription>
            Room {bill?.roomNumber || bill?.booking?.room?.number} • {bill?.booking?.guest?.name} • Created {bill ? formatDateTime(bill.createdAt) : ''}
          </DialogDescription>
        </DialogHeader>

        {bill && calc && (
          <div className="space-y-4">
            {requiresPin && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                <div className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
                  <ShieldCheck className="h-4 w-4 text-amber-600" />
                  <span>{isFinalized ? 'Finalized Financial Document — Locked' : 'Manager / Admin Authorization Required'}</span>
                </div>
                <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                  {isFinalized
                    ? 'This bill is finalized. To perform administrative corrections to customer amount, GST, room number, or description, enter Manager or Admin PIN.'
                    : 'Custom billing amount, room number, or modified room description requires Manager or Admin PIN approval.'}
                </p>
                <div className="mt-2.5 space-y-1">
                  <Label className="text-[11px] font-semibold">Manager / Admin PIN *</Label>
                  <Input
                    type="password"
                    placeholder="Enter PIN to authorize correction"
                    value={managerPin}
                    onChange={(e) => setManagerPin(e.target.value)}
                    className="h-8 text-xs border-amber-300 dark:border-amber-800"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Original Room Amount (Internal)</Label>
                <div className="rounded-md bg-muted px-3 py-2 text-sm font-semibold">
                  {formatINR(calc.actualRoomTotal)}{' '}
                  <span className="text-[10px] font-normal text-muted-foreground">({bill.days}n × {formatINR(bill.booking?.ratePerDay)})</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  Customer Amount (Billed) *
                </Label>
                <Input
                  type="number"
                  value={billedRoomTotal}
                  onChange={(e) => setBilledRoomTotal(e.target.value)}
                  placeholder="e.g. 500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Room No. (shown on invoice)</Label>
                <Input
                  value={roomNumber}
                  onChange={(e) => setRoomNumber(e.target.value)}
                  placeholder={bill.booking?.room?.number || 'e.g. 101'}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Room description (shown on invoice)</Label>
                <Input
                  value={roomDescription}
                  onChange={(e) => setRoomDescription(e.target.value)}
                  placeholder={bill.booking?.room?.type || 'e.g. Deluxe AC Room'}
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-2">
              Internal revenue: {formatINR(calc.internalTotal)} (actual tariff + GST)
            </p>

            {calc.customerAmount !== calc.actualRoomTotal && (
              <div className="flex items-start gap-2 rounded-lg bg-violet-50 p-2.5 text-xs text-violet-800 dark:bg-violet-950 dark:text-violet-200">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Bill reflects customer amount <b>{formatINR(calc.customerAmount)}</b> while original internal room tariff remains <b>{formatINR(calc.actualRoomTotal)}</b>.
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-foreground">GST % *</Label>
                  <div className="flex gap-1">
                    {(['0', '12', '18'] as const).map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setGstPercent(pct)}
                        className={`px-1.5 py-0.5 text-[10px] font-semibold rounded border transition-colors ${
                          num(gstPercent) === num(pct)
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-muted text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {pct === '0' ? '0%' : `${pct}%`}
                      </button>
                    ))}
                  </div>
                </div>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={gstPercent}
                  onChange={(e) => setGstPercent(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">Discount (₹)</Label>
                <Input type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} className="h-9 text-xs" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">Extra Charges (₹)</Label>
                <Input type="number" min="0" value={extraCharges} onChange={(e) => setExtraCharges(e.target.value)} className="h-9 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">Food Charges (Read-only)</Label>
                <div className="h-9 rounded-md bg-muted px-3 flex items-center text-xs font-medium">
                  {formatINR(bill.foodTotal)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">Bill To / Company</Label>
                <Input value={corporateName} onChange={(e) => setCorporateName(e.target.value)} placeholder="Company name" className="h-9 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">GSTIN</Label>
                <Input value={gstNumber} onChange={(e) => setGstNumber(e.target.value)} placeholder="GST number" className="h-9 text-xs uppercase" />
              </div>
            </div>

            <Separator />

            {/* Recalculated breakdown preview */}
            <div className="space-y-1.5 rounded-lg bg-muted/50 p-3 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Customer Room Amount</span>
                <span className="font-medium">{formatINR(calc.customerAmount)}</span>
              </div>
              {calc.foodTotal > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Food Charges</span>
                  <span className="font-medium">{formatINR(calc.foodTotal)}</span>
                </div>
              )}
              {calc.extra > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Extra Charges</span>
                  <span className="font-medium">{formatINR(calc.extra)}</span>
                </div>
              )}
              {calc.disc > 0 && (
                <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                  <span>Discount</span>
                  <span className="font-medium">-{formatINR(calc.disc)}</span>
                </div>
              )}
              {calc.gstAmount > 0 ? (
                <div className="flex justify-between font-semibold text-emerald-700 dark:text-emerald-400">
                  <span>GST ({calc.gstRate}%)</span>
                  <span>{formatINR(calc.gstAmount)}</span>
                </div>
              ) : (
                <div className="flex justify-between text-muted-foreground">
                  <span>GST (0%)</span>
                  <span>₹0</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-sm">
                <span>Grand Total</span>
                <span className="text-slate-900 dark:text-white">{formatINR(calc.grandTotal)}</span>
              </div>
              {calc.advanceApplied > 0 && (
                <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                  <span>Less: Advance Received</span>
                  <span className="font-medium">-{formatINR(calc.advanceApplied)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between text-sm font-bold text-emerald-700 dark:text-emerald-400 pt-1 border-t">
                <span>Payable now</span>
                <span>{formatINR(calc.payable)}</span>
              </div>
            </div>

            {/* Payment split adjustment */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground">Payment Received Split</p>
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

            <Button className="w-full h-9 bg-emerald-600 hover:bg-emerald-700 font-semibold text-white text-xs" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save &amp; Recalculate Bill
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

