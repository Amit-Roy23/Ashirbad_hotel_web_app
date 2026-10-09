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
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { apiAs, formatINR, todayStr, addDays, GovIdType, GOV_ID_TYPES, validateGovId, parseGovId } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { RoomDatePicker } from './room-date-picker'
import { Loader2, Edit3, Banknote, Calendar, User, FileText, CheckCircle2, ShieldCheck } from 'lucide-react'

export interface BookingData {
  id: string
  checkIn: string
  checkOut?: string | null
  days: number
  ratePerDay: number
  advance: number
  guestCount?: number
  isCorporate?: boolean
  notes?: string | null
  status: string
  createdAt?: string
  room: {
    id: string
    number: string
    type: string
  }
  guest: {
    id: string
    name: string
    phone: string
    company?: string | null
    gst?: string | null
    address?: string | null
    idProof?: string | null
  }
}

interface EditAdvanceBookingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  booking: BookingData | null
  onSuccess: () => void
}

export function EditAdvanceBookingDialog({
  open,
  onOpenChange,
  booking,
  onSuccess,
}: EditAdvanceBookingDialogProps) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [idType, setIdType] = useState<GovIdType>('AADHAAR')
  const [idNumber, setIdNumber] = useState('')
  const [company, setCompany] = useState('')
  const [gst, setGst] = useState('')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [days, setDays] = useState('1')
  const [guestCount, setGuestCount] = useState('1')
  const [ratePerDay, setRatePerDay] = useState('0')
  const [advance, setAdvance] = useState('0')
  const [advanceMethod, setAdvanceMethod] = useState<'CASH' | 'UPI' | 'CARD'>('CASH')
  const [isCorporate, setIsCorporate] = useState(false)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && booking) {
      setName(booking.guest?.name || '')
      setPhone(booking.guest?.phone || '')
      if (booking.guest?.idProof) {
        const parsed = parseGovId(booking.guest.idProof)
        setIdType(parsed.idType)
        setIdNumber(parsed.idNumber)
      } else {
        setIdType('AADHAAR')
        setIdNumber('')
      }
      setCompany(booking.guest?.company || '')
      setGst(booking.guest?.gst || '')
      
      const inDate = booking.checkIn ? new Date(booking.checkIn).toISOString().slice(0, 10) : ''
      const outDate = booking.checkOut ? new Date(booking.checkOut).toISOString().slice(0, 10) : ''
      setCheckIn(inDate)
      setCheckOut(outDate)
      setDays(String(booking.days || 1))
      setGuestCount(String(booking.guestCount || 1))
      setRatePerDay(String(booking.ratePerDay || 0))
      setAdvance(String(booking.advance || 0))
      setAdvanceMethod('CASH')
      setIsCorporate(!!booking.isCorporate)
      setNotes(booking.notes || '')
      setError('')
    }
  }, [open, booking])

  // Recalculate days when dates change
  function handleCheckInChange(val: string) {
    setCheckIn(val)
    if (val && checkOut) {
      const d1 = new Date(val).getTime()
      const d2 = new Date(checkOut).getTime()
      const diff = Math.max(1, Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24)))
      setDays(String(diff))
    }
  }

  function handleCheckOutChange(val: string) {
    setCheckOut(val)
    if (checkIn && val) {
      const d1 = new Date(checkIn).getTime()
      const d2 = new Date(val).getTime()
      const diff = Math.max(1, Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24)))
      setDays(String(diff))
    }
  }

  const numDays = parseInt(days) || 1
  const numRate = parseFloat(ratePerDay) || 0
  const numAdvance = parseFloat(advance) || 0
  const stayTotal = numDays * numRate
  const balanceDue = Math.max(0, stayTotal - numAdvance)

  async function handleSave() {
    if (!booking) return
    const cleanPhone = phone.replace(/\D/g, '')
    if (!name.trim()) {
      setError('Guest name is required')
      return
    }
    if (cleanPhone.length !== 10) {
      setError('Valid 10-digit mobile number is required')
      return
    }
    const idCheck = validateGovId(idType, idNumber)
    if (!idCheck.valid) {
      setError(idCheck.error || 'Valid Government ID proof is mandatory (Aadhaar / PAN / Passport)')
      return
    }
    if (!checkIn) {
      setError('Check-in date is required')
      return
    }
    const gCount = parseInt(guestCount)
    if (!guestCount || isNaN(gCount) || gCount < 1) {
      setError('Number of guests must be at least 1')
      return
    }
    if (gCount > 4) {
      setError('Maximum 4 guests allowed per room')
      return
    }

    setSaving(true)
    setError('')
    try {
      const res = await apiAs<{ error?: string }>('/api/bookings', getCachedUser(), {
        method: 'PATCH',
        body: JSON.stringify({
          id: booking.id,
          action: 'update',
          name: name.trim(),
          phone: cleanPhone,
          idProof: idCheck.formatted,
          company: company.trim() || undefined,
          gst: gst.trim().toUpperCase() || undefined,
          checkIn,
          checkOut: checkOut || undefined,
          days: numDays,
          guestCount: parseInt(guestCount) || 1,
          ratePerDay: numRate,
          advance: numAdvance,
          advanceMethod,
          isCorporate,
          notes: notes.trim() || undefined,
        }),
      })

      if (res && res.error) {
        setError(res.error)
        return
      }

      onOpenChange(false)
      onSuccess()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update booking')
    } finally {
      setSaving(false)
    }
  }

  if (!booking) return null

  const receiptNo = `ADV-${booking.id.slice(-6).toUpperCase()}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto max-w-2xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
            <div className="flex items-center gap-2">
              <div className="rounded-full bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                <Edit3 className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg">Edit Booking Bill / Advance Receipt</DialogTitle>
                <DialogDescription className="text-xs">
                  Modify reservation details, advance payment amount, stay dates, and guest information.
                </DialogDescription>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-800 dark:bg-amber-950/40">
                {receiptNo}
              </Badge>
              <Badge variant="secondary" className="font-bold">
                Room {booking.room?.number}
              </Badge>
            </div>
          </div>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
            {error}
          </div>
        )}

        <div className="space-y-4 pt-1">
          {/* Guest Details Section */}
          <div className="rounded-xl border bg-muted/20 p-3.5 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <User className="h-4 w-4 text-amber-600" />
              <span>Guest &amp; Company Information</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs font-semibold text-foreground">Guest Full Name *</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  className="h-9 mt-1 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-foreground">Phone Number (10 Digits) *</Label>
                <Input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                  maxLength={10}
                  className="h-9 mt-1 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-foreground">Company Name (Optional)</Label>
                <Input
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  placeholder="e.g. Tata Consultancy Services"
                  className="h-9 mt-1 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-foreground">GST Number (Optional)</Label>
                <Input
                  value={gst}
                  onChange={(e) => setGst(e.target.value)}
                  placeholder="e.g. 19AAAAA0000A1Z5"
                  className="h-9 mt-1 text-xs uppercase"
                />
              </div>

              {/* Government ID Proof */}
              <div className="sm:col-span-2 rounded-lg border bg-muted/30 p-2.5 space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                    Govt. ID Proof <span className="text-destructive">*</span>
                  </Label>
                  <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                    Mandatory
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="sm:col-span-1">
                    <Select value={idType} onValueChange={(val: GovIdType) => setIdType(val)}>
                      <SelectTrigger className="h-9 text-xs bg-background">
                        <SelectValue placeholder="ID Type" />
                      </SelectTrigger>
                      <SelectContent>
                        {GOV_ID_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value} className="text-xs">
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="sm:col-span-2">
                    <Input
                      placeholder={GOV_ID_TYPES.find((t) => t.value === idType)?.placeholder || 'Enter ID number'}
                      value={idNumber}
                      onChange={(e) => {
                        const raw = e.target.value
                        if (idType === 'AADHAAR') {
                          const digits = raw.replace(/\D/g, '').slice(0, 12)
                          setIdNumber(digits)
                        } else {
                          setIdNumber(raw.toUpperCase())
                        }
                      }}
                      className="h-9 text-xs font-mono font-medium uppercase bg-background"
                      required
                    />
                  </div>
                </div>

                {idNumber.length > 0 && (
                  <div className="pt-0.5">
                    {(() => {
                      const check = validateGovId(idType, idNumber)
                      if (check.valid) {
                        return (
                          <p className="text-[11px] font-medium text-emerald-600">
                            ✓ Valid {GOV_ID_TYPES.find((t) => t.value === idType)?.label} ({check.formatted})
                          </p>
                        )
                      }
                      return (
                        <p className="text-[11px] font-medium text-amber-600">
                          {check.error}
                        </p>
                      )
                    })()}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stay & Reservation Dates */}
          <div className="rounded-xl border bg-muted/20 p-3.5 space-y-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Calendar className="h-4 w-4 text-amber-600" />
              <span>Stay Schedule &amp; Room Details</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <RoomDatePicker
                  id="edit-adv-in"
                  label="Check-In Date *"
                  value={checkIn}
                  mode="checkIn"
                  roomNumber={booking.room?.number}
                  onChange={(val) => handleCheckInChange(val)}
                />
              </div>
              <div>
                <RoomDatePicker
                  id="edit-adv-out"
                  label="Check-Out Date"
                  value={checkOut}
                  mode="checkOut"
                  checkInValue={checkIn}
                  roomNumber={booking.room?.number}
                  onChange={(val) => handleCheckOutChange(val)}
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-foreground">Nights</Label>
                <Input
                  type="number"
                  min={1}
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  className="h-9 mt-1 text-xs"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-foreground">Guests Count (Max 4)</Label>
                <Input
                  type="number"
                  min={1}
                  max={4}
                  value={guestCount}
                  onChange={(e) => setGuestCount(e.target.value)}
                  className="h-9 mt-1 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Financials & Advance Payment */}
          <div className="rounded-xl border bg-gradient-to-br from-amber-50/50 to-transparent p-3.5 space-y-3 dark:from-amber-950/20">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 dark:text-amber-200">
              <Banknote className="h-4 w-4 text-amber-600" />
              <span>Tariff &amp; Advance Payment Settlement</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <Label className="text-xs font-semibold text-foreground">Room Rate / Night (₹)</Label>
                <Input
                  type="number"
                  min={0}
                  step="50"
                  value={ratePerDay}
                  onChange={(e) => setRatePerDay(e.target.value)}
                  className="h-9 mt-1 text-xs font-semibold"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  Advance Amount Paid (₹) *
                </Label>
                <Input
                  type="number"
                  min={0}
                  step="50"
                  value={advance}
                  onChange={(e) => setAdvance(e.target.value)}
                  className="h-9 mt-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 border-emerald-300"
                />
              </div>
              <div>
                <Label className="text-xs font-semibold text-foreground">Payment Mode</Label>
                <div className="mt-1 flex gap-1">
                  {(['CASH', 'UPI', 'CARD'] as const).map((m) => (
                    <Button
                      key={m}
                      type="button"
                      size="sm"
                      variant={advanceMethod === m ? 'default' : 'outline'}
                      className={`h-9 flex-1 text-[11px] font-semibold ${
                        advanceMethod === m
                          ? 'bg-amber-600 hover:bg-amber-700 text-white'
                          : ''
                      }`}
                      onClick={() => setAdvanceMethod(m)}
                    >
                      {m}
                    </Button>
                  ))}
                </div>
              </div>
            </div>

            {/* Live Calculation Preview Banner */}
            <div className="mt-2 grid grid-cols-3 gap-2 rounded-lg bg-background p-2.5 border text-center text-xs">
              <div>
                <p className="text-[10px] text-muted-foreground">Estimated Stay Total</p>
                <p className="font-semibold text-slate-800 dark:text-slate-200">{formatINR(stayTotal)}</p>
              </div>
              <div className="border-x">
                <p className="text-[10px] text-muted-foreground">Advance Received</p>
                <p className="font-bold text-emerald-700 dark:text-emerald-400">{formatINR(numAdvance)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Balance on Checkout</p>
                <p className="font-semibold text-slate-800 dark:text-slate-200">{formatINR(balanceDue)}</p>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label className="text-xs font-semibold text-foreground">Special Notes / Instructions (Optional)</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Early check-in requested, extra towel"
              className="h-9 mt-1 text-xs"
            />
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Saving Changes...
              </>
            ) : (
              <>
                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
