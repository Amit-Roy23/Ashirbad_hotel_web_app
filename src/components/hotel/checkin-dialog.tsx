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
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api, apiAs, addDays, formatINR, sanitizePhone, todayStr, formatDate, formatDateTime, toDateStr, doDateRangesOverlap, GovIdType, GOV_ID_TYPES, validateGovId, parseGovId } from '@/lib/hotel-utils'
import { calcNights } from '@/lib/stay'
import { getCachedUser } from './user-context'
import { toast } from '@/hooks/use-toast'
import { RoomDatePicker } from './room-date-picker'
import { Loader2, UserSearch, LogIn, CalendarCheck, CalendarDays, AlertCircle, AlertTriangle, ChevronLeft, ChevronRight, Clock, ShieldCheck, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface DueItem {
  billId: string
  billNumber: string
  bookingId: string
  roomNumber: string
  checkIn: string
  checkOut: string | null
  actualCheckOut: string | null
  checkoutDate: string
  days: number
  grandTotal: number
  paidTotal: number
  balanceDue: number
  paymentStatus: string
  status: string
  createdAt: string
}

interface GuestLookupResult {
  id: string
  name: string
  phone: string
  company?: string | null
  gst?: string | null
  address?: string | null
  idProof?: string | null
  totalDue?: number
  dueHistory?: DueItem[]
}

interface BookingInfo {
  id: string
  checkIn: string
  checkOut?: string | null
  guest?: { name: string; phone?: string; company?: string | null } | null
  status?: string
}

interface Room {
  id: string
  number: string
  type: string
  rate: number
  capacity: number
  status?: string
  housekeeping?: string
  bookings?: BookingInfo[]
}

interface CheckinDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  room: Room | null
  onSuccess: () => void
  initialMode?: 'CHECKIN' | 'BOOKING'
}

export function CheckinDialog({ open, onOpenChange, room, onSuccess, initialMode = 'CHECKIN' }: CheckinDialogProps) {
  const [bookingMode, setBookingMode] = useState<'CHECKIN' | 'BOOKING'>(initialMode)
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [idType, setIdType] = useState<GovIdType>('AADHAAR')
  const [idNumber, setIdNumber] = useState('')
  const [company, setCompany] = useState('')
  const [gst, setGst] = useState('')
  const [address, setAddress] = useState('')
  const [checkInDate, setCheckInDate] = useState(todayStr())
  const [checkOut, setCheckOut] = useState(addDays(1))
  const [checkOutTime, setCheckOutTime] = useState('08:00')
  const [guestCount, setGuestCount] = useState('1')
  const [advance, setAdvance] = useState('')
  const [advanceMethod, setAdvanceMethod] = useState('CASH')
  const [isCorporate, setIsCorporate] = useState(false)
  const [notes, setNotes] = useState('')
  const [autoFilled, setAutoFilled] = useState(false)
  const [guestDueInfo, setGuestDueInfo] = useState<{ totalDue: number; dueHistory: DueItem[] } | null>(null)
  const [saving, setSaving] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !room) return
    setBookingMode(initialMode)
    setPhone('')
    setName('')
    setIdType('AADHAAR')
    setIdNumber('')
    setCompany('')
    setGst('')
    setAddress('')
    setCheckInDate(todayStr())
    setCheckOut(addDays(1))
    setGuestCount('1')
    setAdvance('')
    setAdvanceMethod('CASH')
    setIsCorporate(false)
    setNotes('')
    setAutoFilled(false)
    setGuestDueInfo(null)
    setError('')

    api<Record<string, string>>('/api/settings')
      .then((s) => {
        if (s?.checkoutTime) setCheckOutTime(s.checkoutTime)
      })
      .catch(() => {})
  }, [open, room, initialMode])

  const effectiveCheckIn = bookingMode === 'BOOKING' ? checkInDate : todayStr()
  const nights = useMemo(() => {
    return calcNights(effectiveCheckIn, checkOut)
  }, [effectiveCheckIn, checkOut])

  // Check if current selected date range conflicts with an existing booking
  const overlappingBooking = useMemo(() => {
    if (!room?.bookings) return null
    return (
      room.bookings.find((b) => {
        if (b.status !== 'ACTIVE' && b.status !== 'BOOKED') return false
        return doDateRangesOverlap(effectiveCheckIn, checkOut, b.checkIn, b.checkOut)
      }) || null
    )
  }, [room, effectiveCheckIn, checkOut])

  const upcomingBooking = useMemo(() => {
    if (!room?.bookings) return null
    const effInStr = toDateStr(effectiveCheckIn)
    return (
      room.bookings
        .filter((b) => b.status === 'BOOKED' && toDateStr(b.checkIn) > effInStr)
        .sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime())[0] || null
    )
  }, [room, effectiveCheckIn])

  const priorBooking = useMemo(() => {
    if (!room?.bookings) return null
    const effInStr = toDateStr(effectiveCheckIn)
    return (
      room.bookings
        .filter((b) => (b.status === 'ACTIVE' || b.status === 'BOOKED') && toDateStr(b.checkOut) === effInStr)
        .sort((a, b) => new Date(b.checkOut || '').getTime() - new Date(a.checkOut || '').getTime())[0] || null
    )
  }, [room, effectiveCheckIn])

  const maxCheckOutDate = useMemo(() => {
    if (!upcomingBooking) return undefined
    return toDateStr(upcomingBooking.checkIn)
  }, [upcomingBooking])

  // Dedicated lookup helpers that instantly clear old due alert when data is changed
  async function lookupByPhone(val: string) {
    const clean = sanitizePhone(val)
    setPhone(clean)
    setGuestDueInfo(null) // immediately clear any old due alert when typing a new phone
    if (clean.length < 4) {
      setAutoFilled(false)
      return
    }
    setSearching(true)
    try {
      const guest = await api<GuestLookupResult | null>(`/api/guests?phone=${encodeURIComponent(clean)}`)
      if (guest) {
        if (!name || autoFilled) setName(guest.name)
        if (!company || autoFilled) setCompany(guest.company || '')
        if (!gst || autoFilled) setGst(guest.gst || '')
        if (!address || autoFilled) setAddress(guest.address || '')
        if (guest.idProof && (!idNumber || autoFilled)) {
          const parsed = parseGovId(guest.idProof)
          setIdType(parsed.idType)
          setIdNumber(parsed.idNumber)
        }
        if (guest.company) setIsCorporate(true)
        setAutoFilled(true)

        if (guest.totalDue && guest.totalDue > 0.01 && guest.dueHistory && guest.dueHistory.length > 0) {
          setGuestDueInfo({ totalDue: guest.totalDue, dueHistory: guest.dueHistory })
        } else {
          setGuestDueInfo(null)
        }
      } else {
        setAutoFilled(false)
        setGuestDueInfo(null)
      }
    } catch {
      setGuestDueInfo(null)
    } finally {
      setSearching(false)
    }
  }

  async function lookupByIdProof(rawId: string) {
    const cleanId = rawId.trim()
    if (cleanId.length < 4) {
      if (!phone) setGuestDueInfo(null)
      return
    }
    try {
      const guest = await api<GuestLookupResult | null>(`/api/guests?idProof=${encodeURIComponent(cleanId)}`)
      if (guest) {
        if (!phone) setPhone(guest.phone)
        if (!name || autoFilled) setName(guest.name)
        if (!company || autoFilled) setCompany(guest.company || '')
        if (!gst || autoFilled) setGst(guest.gst || '')
        if (!address || autoFilled) setAddress(guest.address || '')
        if (guest.company) setIsCorporate(true)
        if (guest.totalDue && guest.totalDue > 0.01 && guest.dueHistory && guest.dueHistory.length > 0) {
          setGuestDueInfo({ totalDue: guest.totalDue, dueHistory: guest.dueHistory })
        } else {
          setGuestDueInfo(null)
        }
      } else {
        if (!phone) setGuestDueInfo(null)
      }
    } catch {
      // ignore
    }
  }

  async function lookupByName(rawName: string) {
    const cleanName = rawName.trim()
    if (cleanName.length < 3) {
      if (!phone && !idNumber) setGuestDueInfo(null)
      return
    }
    try {
      const guest = await api<GuestLookupResult | null>(`/api/guests?name=${encodeURIComponent(cleanName)}`)
      if (guest && guest.totalDue && guest.totalDue > 0.01 && guest.dueHistory && guest.dueHistory.length > 0) {
        setGuestDueInfo({ totalDue: guest.totalDue, dueHistory: guest.dueHistory })
      } else {
        if (!phone && !idNumber) setGuestDueInfo(null)
      }
    } catch {
      // ignore
    }
  }

  async function submit() {
    if (!room) return
    if (overlappingBooking) {
      setError(
        `Selected dates overlap with an existing booking for ${overlappingBooking.guest?.name || 'Guest'} (${formatDate(overlappingBooking.checkIn)} to ${formatDate(overlappingBooking.checkOut)}). Please choose non-overlapping dates.`
      )
      return
    }
    const cleanPhone = sanitizePhone(phone)
    if (cleanPhone.length !== 10) {
      setError('Phone number must be a valid 10-digit mobile number (e.g. 9876543210)')
      return
    }
    if (!name.trim()) {
      setError('Guest name is required')
      return
    }
    const idCheck = validateGovId(idType, idNumber)
    if (!idCheck.valid) {
      setError(idCheck.error || 'Valid Government ID proof is mandatory (Aadhaar / PAN / Passport)')
      return
    }
    if (isCorporate && !company.trim()) {
      setError('Company Name is required for Corporate Guest')
      return
    }
    if (!checkOut || isNaN(new Date(checkOut + 'T11:00:00').getTime())) {
      setError('Expected Check-Out date is required')
      return
    }
    if (maxCheckOutDate && checkOut > maxCheckOutDate && checkInDate < maxCheckOutDate) {
      setError(
        `Check-out cannot exceed ${formatDate(maxCheckOutDate)} because Room ${room.number} is reserved for ${upcomingBooking?.guest?.name || 'advance guest'}.`
      )
      return
    }
    const count = parseInt(guestCount)
    if (!guestCount || isNaN(count) || count < 1) {
      setError('Number of guests must be at least 1')
      return
    }
    if (count > 4) {
      setError('Maximum 4 guests allowed per room')
      return
    }
    setSaving(true)
    setError('')
    try {
      const isAdvance = bookingMode === 'BOOKING'
      await apiAs('/api/bookings', getCachedUser(), {
        method: 'POST',
        body: JSON.stringify({
          roomId: room.id,
          phone: cleanPhone,
          name: name.trim(),
          idProof: idCheck.formatted,
          company: company.trim() || undefined,
          gst: gst.trim() || undefined,
          address: address.trim() || undefined,
          checkIn: isAdvance ? checkInDate : new Date().toISOString(),
          checkOut,
          checkOutTime: checkOutTime || '08:00',
          guestCount,
          advance: advance || '0',
          advanceMethod,
          isCorporate,
          notes: notes.trim() || undefined,
          bookingType: isAdvance ? 'BOOKING' : 'CHECKIN',
          status: isAdvance ? 'BOOKED' : 'ACTIVE',
        }),
      })
      onSuccess()
      onOpenChange(false)
      if (isAdvance) {
        toast({
          variant: 'success',
          title: 'Room Booked in Advance',
          description: `Room ${room.number} reserved for ${name.trim()} from ${formatDate(checkInDate)} to ${formatDate(checkOut)}.`,
        })
      } else {
        toast({
          variant: 'success',
          title: 'Check-In Successful',
          description: `Guest ${name.trim()} checked into Room ${room.number}.`,
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {bookingMode === 'CHECKIN' ? 'Check-In' : 'Advance Booking'} — Room {room?.number}
          </DialogTitle>
          <DialogDescription>
            {room?.type} • {formatINR(room?.rate)}/night • Max {room?.capacity} guests
          </DialogDescription>
        </DialogHeader>

        {/* Toggle between Check-In and Advance Booking */}
        <div className="grid grid-cols-2 p-1 bg-muted rounded-lg text-xs font-semibold gap-1">
          <button
            type="button"
            onClick={() => setBookingMode('CHECKIN')}
            className={cn(
              "flex items-center justify-center gap-2 py-2 rounded-md transition-all",
              bookingMode === 'CHECKIN'
                ? "bg-background text-emerald-700 dark:text-emerald-400 shadow-sm font-bold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <LogIn className="h-4 w-4 text-emerald-600" />
            Direct Check-In
          </button>
          <button
            type="button"
            onClick={() => setBookingMode('BOOKING')}
            className={cn(
              "flex items-center justify-center gap-2 py-2 rounded-md transition-all",
              bookingMode === 'BOOKING'
                ? "bg-background text-amber-800 dark:text-amber-300 shadow-sm font-bold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <CalendarCheck className="h-4 w-4 text-amber-600" />
            Advance Booking
          </button>
        </div>

        {priorBooking && (
          <div className="rounded-lg border border-emerald-300 bg-emerald-50/90 p-2 text-xs text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
            <span className="font-semibold text-emerald-900 dark:text-emerald-300">
              ✨ Ready for Check-In on {formatDate(effectiveCheckIn)}
            </span>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Previous guest ({priorBooking.guest?.name || 'Guest'}) checks out on {formatDate(priorBooking.checkOut)}. Room is ready for this booking!
            </p>
          </div>
        )}

        {/* Upcoming booking alert if room is booked in future */}
        {upcomingBooking && (
          <div className="rounded-lg border border-amber-300 bg-amber-50/90 p-2.5 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200">
              <CalendarCheck className="h-4 w-4 text-amber-600 shrink-0" />
              <span>Upcoming Advance Reservation on Room {room?.number}</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed">
              Reserved for <b>{upcomingBooking.guest?.name || 'Guest'}</b> starting <b>{formatDate(upcomingBooking.checkIn)}</b>.
              Maximum stay check-out is <b>{formatDate(upcomingBooking.checkIn)}</b>.
            </p>
          </div>
        )}

        {/* Overlapping Booking Warning Banner */}
        {overlappingBooking && (
          <div className="rounded-lg border border-red-300 bg-red-50/95 p-3 text-xs text-red-950 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200 space-y-1">
            <div className="flex items-center gap-1.5 font-bold text-red-800 dark:text-red-300">
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />
              <span>Date Overlap Conflict</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              Room <b>{room?.number}</b> is already booked for <b>{overlappingBooking.guest?.name || 'Guest'}</b> from <b>{formatDate(overlappingBooking.checkIn)}</b> to <b>{formatDate(overlappingBooking.checkOut)}</b>.
            </p>
            <p className="text-[11px] font-medium text-red-700 dark:text-red-300">
              👉 Please choose check-out on/before <b>{formatDate(overlappingBooking.checkIn)}</b> or check-in from <b>{formatDate(overlappingBooking.checkOut)}</b>.
            </p>
          </div>
        )}

        <div className="space-y-3.5 pt-1">
          {/* Date selection with RoomDatePicker and Checkout Time */}
          {bookingMode === 'BOOKING' ? (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <RoomDatePicker
                  id="ci-in"
                  label="Check-In Date *"
                  value={checkInDate}
                  mode="checkIn"
                  minDate={todayStr()}
                  roomBookings={room?.bookings}
                  roomNumber={room?.number}
                  onChange={(newIn) => {
                    setCheckInDate(newIn)
                    if (newIn >= checkOut) {
                      setCheckOut(addDays(1, newIn))
                    }
                  }}
                />
                <RoomDatePicker
                  id="ci-out"
                  label="Check-Out Date *"
                  value={checkOut}
                  mode="checkOut"
                  checkInValue={checkInDate}
                  roomBookings={room?.bookings}
                  roomNumber={room?.number}
                  onChange={(newOut) => {
                    setCheckOut(newOut)
                  }}
                />
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="checkout-time-booking" className="text-xs font-semibold shrink-0 text-foreground flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" /> Check-Out Time
                </Label>
                <Input
                  id="checkout-time-booking"
                  type="time"
                  value={checkOutTime}
                  onChange={(e) => setCheckOutTime(e.target.value)}
                  className="h-8 text-xs w-32"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold text-foreground">Check-In</Label>
                  <div className="h-9 px-3 bg-muted/60 rounded-md border text-xs flex items-center font-medium text-emerald-700 dark:text-emerald-400">
                    Today ({formatDate(todayStr())})
                  </div>
                </div>
                <div className="space-y-1">
                  <RoomDatePicker
                    id="checkout"
                    label="Expected Check-Out *"
                    value={checkOut}
                    mode="checkOut"
                    checkInValue={todayStr()}
                    roomBookings={room?.bookings}
                    roomNumber={room?.number}
                    onChange={(newOut) => {
                      setCheckOut(newOut)
                    }}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor="checkout-time-checkin" className="text-xs font-semibold shrink-0 text-foreground flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" /> Check-Out Time
                </Label>
                <Input
                  id="checkout-time-checkin"
                  type="time"
                  value={checkOutTime}
                  onChange={(e) => setCheckOutTime(e.target.value)}
                  className="h-8 text-xs w-32"
                />
              </div>
            </div>
          )}

          {/* Live stay & automatic extension rule line */}
          <div className="rounded-md border border-slate-200 bg-slate-50/80 p-2 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
            <span className="font-semibold text-foreground">
              Check-out {formatDate(checkOut)}, {checkOutTime || '08:00'} · {nights} night{nights > 1 ? 's' : ''}
              {room ? ` (${formatINR(room.rate * nights)})` : ''}.
            </span>{' '}
            <span className="text-[11px] text-muted-foreground block mt-0.5">
              If the guest has not checked out by then, 1 extra day is added automatically every 24 hours.
            </span>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-xs font-semibold text-foreground">
              Phone Number (10 Digits) *
            </Label>
            <div className="relative">
              <Input
                id="phone"
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit mobile number"
                value={phone}
                onChange={(e) => lookupByPhone(e.target.value)}
                className="h-9 pr-10 text-xs"
              />
              {searching && (
                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {!searching && phone.length >= 4 && (
                <UserSearch className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-600" />
              )}
            </div>
            {phone.length > 0 && phone.length < 10 && (
              <p className="text-xs font-medium text-amber-600">
                10 digits required ({phone.length}/10 entered)
              </p>
            )}
            {phone.length === 10 && (
              <p className="text-xs font-medium text-emerald-600">
                ✓ Valid 10-digit mobile number
              </p>
            )}
            {autoFilled && (
              <p className="text-xs text-emerald-600 font-medium">
                ✓ Returning customer found — details auto-filled!
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-xs font-semibold text-foreground">Guest Name *</Label>
            <Input
              id="name"
              placeholder="Full name"
              value={name}
              className="h-9 text-xs"
              onChange={(e) => {
                setName(e.target.value)
                setAutoFilled(false)
                if (!phone && !idNumber) setGuestDueInfo(null)
              }}
              onBlur={(e) => {
                if (e.target.value.trim().length >= 3 && !phone && !idNumber) {
                  lookupByName(e.target.value)
                }
              }}
            />
          </div>

          {/* Outstanding Past Due Alert Banner */}
          {guestDueInfo && guestDueInfo.totalDue > 0.01 && (
            <div className="rounded-lg border-2 border-red-500/80 bg-red-50 p-3 dark:border-red-600 dark:bg-red-950/40 text-red-950 dark:text-red-100 space-y-2 animate-in fade-in duration-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-bold text-xs text-red-700 dark:text-red-400">
                  <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                  <span>OUTSTANDING DUE PAYMENT ALERT!</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge variant="destructive" className="font-bold text-[11px] px-2 py-0.5">
                    Total Due: {formatINR(guestDueInfo.totalDue)}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => setGuestDueInfo(null)}
                    className="text-red-500 hover:text-red-700 dark:text-red-400 p-0.5 rounded-full hover:bg-red-100 dark:hover:bg-red-900/50"
                    title="Dismiss Alert"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-red-900 dark:text-red-200">
                This guest has <strong>{guestDueInfo.dueHistory.length} unpaid bill(s)</strong> totaling <strong>{formatINR(guestDueInfo.totalDue)}</strong> from past checkout(s):
              </p>
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {guestDueInfo.dueHistory.map((due) => (
                  <div key={due.billId || due.billNumber} className="rounded border border-red-200 bg-white/90 dark:bg-red-900/30 p-2 text-xs flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-foreground text-xs">
                        Room {due.roomNumber} • Invoice #{due.billNumber}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        Checked out on: <span className="font-medium text-foreground">{formatDateTime(due.checkoutDate)}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-red-600 dark:text-red-400 text-xs">{formatINR(due.balanceDue)}</div>
                      <div className="text-[10px] text-muted-foreground">Billed: {formatINR(due.grandTotal)} | Paid: {formatINR(due.paidTotal)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Government ID Proof (Mandatory) */}
          <div className="space-y-2 rounded-lg border bg-muted/30 p-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                Govt. ID Proof <span className="text-destructive">*</span>
              </Label>
              <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                Mandatory
              </span>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="space-y-1 sm:col-span-1">
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

              <div className="space-y-1 sm:col-span-2">
                <Input
                  placeholder={GOV_ID_TYPES.find((t) => t.value === idType)?.placeholder || 'Enter ID number'}
                  value={idNumber}
                  onChange={(e) => {
                    const raw = e.target.value
                    const digits = idType === 'AADHAAR' ? raw.replace(/\D/g, '').slice(0, 12) : raw.toUpperCase()
                    setIdNumber(digits)
                    if (!phone) {
                      setGuestDueInfo(null)
                      if (digits.length >= 4) lookupByIdProof(digits)
                    }
                  }}
                  className="h-9 text-xs font-mono font-medium uppercase bg-background"
                  required
                />
              </div>
            </div>

            {/* Real-time validation message */}
            {idNumber.length > 0 && (
              <div className="pt-0.5">
                {(() => {
                  const check = validateGovId(idType, idNumber)
                  if (check.valid) {
                    return (
                      <p className="text-[11px] font-medium text-emerald-600 flex items-center gap-1">
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

          {isCorporate && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="company" className="text-xs font-semibold text-foreground">
                  Company Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="company"
                  placeholder="Company name"
                  value={company}
                  className="h-9 text-xs"
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gst" className="text-xs font-semibold text-foreground">GST Number</Label>
                <Input
                  id="gst"
                  placeholder="GSTIN (optional)"
                  value={gst}
                  className="h-9 text-xs uppercase"
                  onChange={(e) => setGst(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="gcount" className="text-xs font-semibold text-foreground">Guests (Max 4) *</Label>
              <Input
                id="gcount"
                type="number"
                min="1"
                max="4"
                value={guestCount}
                className="h-9 text-xs"
                onChange={(e) => setGuestCount(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="advance" className="text-xs font-semibold text-foreground">Advance Payment (₹)</Label>
              <Input
                id="advance"
                type="number"
                min="0"
                placeholder="0"
                value={advance}
                className="h-9 text-xs"
                onChange={(e) => setAdvance(e.target.value)}
              />
            </div>
          </div>

          {parseFloat(advance) > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Advance Payment Method</Label>
              <Select value={advanceMethod} onValueChange={setAdvanceMethod}>
                <SelectTrigger className="h-9 text-xs" aria-label="Advance method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH" className="text-xs">Cash</SelectItem>
                  <SelectItem value="UPI" className="text-xs">UPI</SelectItem>
                  <SelectItem value="CARD" className="text-xs">Card</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/20">
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-foreground">Corporate Guest</p>
              <p className="text-[11px] text-muted-foreground">Company / GST billing</p>
            </div>
            <Switch checked={isCorporate} onCheckedChange={setIsCorporate} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-xs font-semibold text-foreground">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Any special instruction or request..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="text-xs"
            />
          </div>

          {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

          <div className="flex items-center gap-2 pt-2 border-t">
            <Button variant="outline" className="flex-1 h-9 text-xs" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              className={cn(
                "flex-1 h-9 text-xs font-semibold text-white",
                bookingMode === 'BOOKING'
                  ? "bg-amber-600 hover:bg-amber-700"
                  : "bg-emerald-600 hover:bg-emerald-700"
              )}
              onClick={submit}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : bookingMode === 'BOOKING' ? (
                <CalendarCheck className="mr-1.5 h-3.5 w-3.5" />
              ) : (
                <LogIn className="mr-1.5 h-3.5 w-3.5" />
              )}
              {bookingMode === 'BOOKING' ? 'Confirm Advance Booking' : 'Confirm Check-In'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
