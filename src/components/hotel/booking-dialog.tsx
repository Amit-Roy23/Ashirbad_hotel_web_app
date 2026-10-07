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
import { api, apiAs, addDays, formatINR, todayStr, sanitizePhone, formatDate, toDateStr, doDateRangesOverlap, getRoomOperationalState } from '@/lib/hotel-utils'
import { calcNights } from '@/lib/stay'
import { getCachedUser } from './user-context'
import { toast } from '@/hooks/use-toast'
import { RoomDatePicker } from './room-date-picker'
import { Loader2, UserSearch, LogIn, CalendarCheck, CalendarDays, AlertCircle, Sparkles, ChevronLeft, ChevronRight, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  status: string
  housekeeping?: string
  bookings?: BookingInfo[]
}

interface BookingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  /** pre-select this room id */
  roomId?: string
  /** pre-fill guest phone (global search handoff) */
  initialPhone?: string
  initialMode?: 'BOOKING' | 'CHECKIN'
  initialCheckInDate?: string
}

export function BookingDialog({
  open,
  onOpenChange,
  onSuccess,
  roomId,
  initialPhone,
  initialMode = 'BOOKING',
  initialCheckInDate,
}: BookingDialogProps) {
  const [bookingMode, setBookingMode] = useState<'BOOKING' | 'CHECKIN'>(initialMode)
  const [rooms, setRooms] = useState<Room[]>([])
  const [selectedRoom, setSelectedRoom] = useState<string>('')
  const [checkInDate, setCheckInDate] = useState(initialCheckInDate || todayStr())
  const [checkOut, setCheckOut] = useState(addDays(1, initialCheckInDate || todayStr()))
  const [checkOutTime, setCheckOutTime] = useState('08:00')
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [gst, setGst] = useState('')
  const [guestCount, setGuestCount] = useState('1')
  const [advance, setAdvance] = useState('')
  const [advanceMethod, setAdvanceMethod] = useState('CASH')
  const [isCorporate, setIsCorporate] = useState(false)
  const [notes, setNotes] = useState('')
  const [autoFilled, setAutoFilled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setBookingMode(initialMode)
    setError('')
    setAutoFilled(false)
    setSaving(false)
    const inD = initialCheckInDate || todayStr()
    setCheckInDate(inD)
    setCheckOut(addDays(1, inD))
    if (roomId) setSelectedRoom(roomId)
    api<Room[]>('/api/rooms').then(setRooms).catch(() => {})
    api<Record<string, string>>('/api/settings')
      .then((s) => {
        if (s?.checkoutTime) setCheckOutTime(s.checkoutTime)
      })
      .catch(() => {})
    if (initialPhone) {
      const clean = sanitizePhone(initialPhone)
      setPhone(clean)
      lookupGuest(clean)
    }
  }, [open, initialPhone, initialMode, initialCheckInDate, roomId])

  const effectiveCheckIn = bookingMode === 'BOOKING' ? checkInDate : todayStr()
  const nights = useMemo(() => {
    return calcNights(effectiveCheckIn, checkOut)
  }, [effectiveCheckIn, checkOut])

  const availableRooms = useMemo(() => {
    return rooms.filter((r) => {
      if (r.status === 'MAINTENANCE') return false
      if (bookingMode === 'CHECKIN') {
        if (r.housekeeping === 'DIRTY') return false
        // A walk-in needs the room now: skip rooms with a guest in-house or an arrival due today
        const st = getRoomOperationalState(r).displayStatus
        if (st === 'OCCUPIED' || st === 'BOOKED') return false
      }
      return true
    })
  }, [rooms, bookingMode])

  useEffect(() => {
    if (open) {
      if (roomId && rooms.some((r) => r.id === roomId)) {
        setSelectedRoom(roomId)
      } else if (!availableRooms.some((r) => r.id === selectedRoom)) {
        setSelectedRoom(availableRooms[0]?.id || '')
      }
    }
  }, [open, roomId, availableRooms, rooms, selectedRoom])

  const room = rooms.find((r) => r.id === selectedRoom)

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

  // AUTO-FILL: when phone matches an old customer, fetch their details
  async function lookupGuest(value: string) {
    const clean = sanitizePhone(value)
    setPhone(clean)
    if (clean.length >= 4) {
      setSearching(true)
      try {
        const guest = await api<{ name: string; company?: string; gst?: string } | null>(
          `/api/guests?phone=${encodeURIComponent(clean)}`
        )
        if (guest) {
          setName(guest.name)
          setCompany(guest.company || '')
          setGst(guest.gst || '')
          if (guest.company) setIsCorporate(true)
          setAutoFilled(true)
        } else {
          setAutoFilled(false)
        }
      } catch {
        // ignore lookup errors
      } finally {
        setSearching(false)
      }
    }
  }

  async function submit() {
    if (!selectedRoom) {
      setError('Please select a room')
      return
    }
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
    if (isCorporate && !company.trim()) {
      setError('Company Name is required for Corporate Guest')
      return
    }
    if (!checkOut || isNaN(new Date(checkOut).getTime())) {
      setError('Expected Check-Out date is required')
      return
    }
    if (maxCheckOutDate && checkOut > maxCheckOutDate && checkInDate < maxCheckOutDate) {
      setError(
        `Check-out cannot exceed ${formatDate(maxCheckOutDate)} because Room ${room?.number} is reserved for ${upcomingBooking?.guest?.name || 'advance guest'}.`
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
          roomId: selectedRoom,
          phone: cleanPhone,
          name: name.trim(),
          company: company.trim() || undefined,
          gst: gst.trim() || undefined,
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
          description: `Room ${room?.number || ''} reserved for ${name.trim()} from ${formatDate(checkInDate)} to ${formatDate(checkOut)}.`,
        })
      } else {
        toast({
          variant: 'success',
          title: 'Check-In Successful',
          description: `Guest ${name.trim()} checked into Room ${room?.number || ''}.`,
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
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {bookingMode === 'BOOKING' ? 'Advance Room Booking' : 'Direct Check-In'}
          </DialogTitle>
          <DialogDescription>
            {bookingMode === 'BOOKING'
              ? 'Reserve a room in advance. The room will be marked as Booked (Yellow).'
              : 'Check-in a guest immediately. The room will be marked as Occupied (Red).'}
          </DialogDescription>
        </DialogHeader>

        {/* Toggle between Advance Booking and Check-In */}
        <div className="grid grid-cols-2 p-1 bg-muted rounded-lg text-xs font-semibold gap-1">
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
        </div>

        <div className="space-y-3.5 pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-foreground">Room *</Label>
            <Select value={selectedRoom} onValueChange={setSelectedRoom}>
              <SelectTrigger className="h-9 text-xs" aria-label="Select room">
                <SelectValue placeholder="Select room" />
              </SelectTrigger>
              <SelectContent>
                {availableRooms.map((r) => {
                  const effInStr = toDateStr(effectiveCheckIn)
                  const nextRes = (r.bookings || [])
                    .filter((b) => b.status === 'BOOKED' && toDateStr(b.checkIn) > effInStr)
                    .sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime())[0]
                  return (
                    <SelectItem key={r.id} value={r.id} className="text-xs">
                      Room {r.number} — {r.type} · {formatINR(r.rate)}/night
                      {nextRes ? ` (Avail until ${formatDate(nextRes.checkIn)})` : ''}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {availableRooms.length === 0 && (
              <p className="text-xs text-destructive">No rooms available for the selected stay dates.</p>
            )}
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

          {upcomingBooking && (
            <div className="rounded-lg border border-amber-300 bg-amber-50/90 p-2.5 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              <div className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200">
                <CalendarCheck className="h-4 w-4 text-amber-600 shrink-0" />
                <span>Upcoming Reservation on Room {room?.number}</span>
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

          {/* Date selection with RoomDatePicker and Checkout Time */}
          {bookingMode === 'BOOKING' ? (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <RoomDatePicker
                  id="bk-in"
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
                  id="bk-out"
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
                <Label htmlFor="bk-checkout-time" className="text-xs font-semibold shrink-0 text-foreground flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" /> Check-Out Time
                </Label>
                <Input
                  id="bk-checkout-time"
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
                    id="bk-out-ci"
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
                <Label htmlFor="bk-checkout-time-ci" className="text-xs font-semibold shrink-0 text-foreground flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" /> Check-Out Time
                </Label>
                <Input
                  id="bk-checkout-time-ci"
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
            <Label htmlFor="bk-phone" className="text-xs font-semibold text-foreground">Phone Number (10 Digits) *</Label>
            <div className="relative">
              <Input
                id="bk-phone"
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit mobile number"
                value={phone}
                onChange={(e) => lookupGuest(e.target.value)}
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
              <p className="text-xs font-medium text-emerald-600">
                ✓ Returning customer found — details auto-filled!
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bk-name" className="text-xs font-semibold text-foreground">Guest Name *</Label>
            <Input
              id="bk-name"
              placeholder="Full name"
              value={name}
              className="h-9 text-xs"
              onChange={(e) => {
                setName(e.target.value)
                setAutoFilled(false)
              }}
            />
          </div>

          {isCorporate && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bk-company" className="text-xs font-semibold text-foreground">Company</Label>
                <Input id="bk-company" placeholder="Company name" value={company} className="h-9 text-xs" onChange={(e) => setCompany(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bk-gst" className="text-xs font-semibold text-foreground">GST Number</Label>
                <Input id="bk-gst" placeholder="GSTIN (optional)" value={gst} className="h-9 text-xs uppercase" onChange={(e) => setGst(e.target.value)} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bk-gcount" className="text-xs font-semibold text-foreground">Guests (Max 4) *</Label>
              <Input
                id="bk-gcount"
                type="number"
                min="1"
                max="4"
                value={guestCount}
                className="h-9 text-xs"
                onChange={(e) => {
                  const val = e.target.value
                  if (val === '') {
                    setGuestCount('')
                  } else {
                    const numVal = parseInt(val)
                    if (!isNaN(numVal)) {
                      if (numVal > 4) setGuestCount('4')
                      else if (numVal < 1) setGuestCount('1')
                      else setGuestCount(String(numVal))
                    } else {
                      setGuestCount(val)
                    }
                  }
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bk-advance" className="text-xs font-semibold text-foreground">Advance (₹)</Label>
              <Input id="bk-advance" type="number" min="0" placeholder="0" value={advance} className="h-9 text-xs" onChange={(e) => setAdvance(e.target.value)} />
            </div>
          </div>

          {parseFloat(advance) > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-foreground">Advance Payment Method</Label>
              <Select value={advanceMethod} onValueChange={setAdvanceMethod}>
                <SelectTrigger className="h-9 text-xs" aria-label="Advance payment method">
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
            <Label htmlFor="bk-notes" className="text-xs font-semibold text-foreground">Notes</Label>
            <Textarea id="bk-notes" placeholder="Any special instruction..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="text-xs" />
          </div>

          {error && <p className="text-xs font-medium text-destructive">{error}</p>}

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
