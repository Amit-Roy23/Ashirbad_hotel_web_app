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
import { api, apiAs, addDays, formatINR, sanitizePhone, todayStr, formatDate } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { toast } from '@/hooks/use-toast'
import { Loader2, UserSearch, LogIn, CalendarCheck } from 'lucide-react'
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
  const [company, setCompany] = useState('')
  const [gst, setGst] = useState('')
  const [address, setAddress] = useState('')
  const [checkInDate, setCheckInDate] = useState(todayStr())
  const [checkOut, setCheckOut] = useState(addDays(1))
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
    if (open && room) {
      setBookingMode(initialMode)
      setPhone('')
      setName('')
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
      setError('')
    }
  }, [open, room, initialMode])

  const effectiveCheckIn = bookingMode === 'BOOKING' ? checkInDate : todayStr()
  const nights = useMemo(() => {
    const diff = Math.ceil(
      (new Date(checkOut + 'T11:00:00').getTime() - new Date(effectiveCheckIn + 'T12:00:00').getTime()) /
        (1000 * 60 * 60 * 24)
    )
    return Math.max(1, diff)
  }, [effectiveCheckIn, checkOut])

  const upcomingBooking = useMemo(() => {
    if (!room?.bookings) return null
    const effStart = new Date(effectiveCheckIn + 'T00:00:00').getTime()
    return (
      room.bookings
        .filter((b) => b.status === 'BOOKED' && new Date(b.checkIn).getTime() > effStart)
        .sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime())[0] || null
    )
  }, [room, effectiveCheckIn])

  const maxCheckOutDate = useMemo(() => {
    if (!upcomingBooking) return undefined
    return new Date(upcomingBooking.checkIn).toISOString().slice(0, 10)
  }, [upcomingBooking])

  // AUTO-FILL: when phone matches an old customer, fetch their details
  async function lookupGuest(value: string) {
    const clean = sanitizePhone(value)
    setPhone(clean)
    if (clean.length >= 4) {
      setSearching(true)
      try {
        const guest = await api<{ name: string; company?: string; gst?: string; address?: string } | null>(
          `/api/guests?phone=${encodeURIComponent(clean)}`
        )
        if (guest) {
          setName(guest.name)
          setCompany(guest.company || '')
          setGst(guest.gst || '')
          setAddress(guest.address || '')
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
    if (!room) return
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
    if (!checkOut || isNaN(new Date(checkOut + 'T11:00:00').getTime())) {
      setError('Expected Check-Out date is required')
      return
    }
    if (maxCheckOutDate && checkOut > maxCheckOutDate) {
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
          company: company.trim() || undefined,
          gst: gst.trim() || undefined,
          address: address.trim() || undefined,
          checkIn: isAdvance ? checkInDate : new Date().toISOString(),
          checkOut,
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

        {/* Upcoming booking alert if room is booked in future */}
        {upcomingBooking && (
          <div className="rounded-lg border border-amber-300 bg-amber-50/90 p-2.5 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <div className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-200">
              <CalendarCheck className="h-4 w-4 text-amber-600 shrink-0" />
              <span>Upcoming Advance Reservation</span>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed">
              Room is reserved for <b>{upcomingBooking.guest?.name || 'Guest'}</b> starting <b>{formatDate(upcomingBooking.checkIn)}</b>.
              Stay must check out on or before <b>{formatDate(upcomingBooking.checkIn)}</b>.
            </p>
          </div>
        )}

        <div className="space-y-3.5 pt-1">
          {/* Date selection */}
          {bookingMode === 'BOOKING' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ci-in" className="text-xs font-semibold text-foreground">Check-In Date *</Label>
                <Input
                  id="ci-in"
                  type="date"
                  value={checkInDate}
                  min={todayStr()}
                  className="h-9 text-xs"
                  onChange={(e) => {
                    setCheckInDate(e.target.value)
                    if (e.target.value >= checkOut) {
                      setCheckOut(addDays(1, new Date(e.target.value)))
                    }
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ci-out" className="text-xs font-semibold text-foreground">Check-Out Date *</Label>
                <Input
                  id="ci-out"
                  type="date"
                  value={checkOut}
                  min={checkInDate}
                  max={maxCheckOutDate}
                  className="h-9 text-xs"
                  onChange={(e) => setCheckOut(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">Check-In</Label>
                <div className="h-9 px-3 bg-muted/60 rounded-md border text-xs flex items-center font-medium text-emerald-700 dark:text-emerald-400">
                  Today (Now)
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="checkout" className="text-xs font-semibold text-foreground">Expected Check-Out *</Label>
                <Input
                  id="checkout"
                  type="date"
                  value={checkOut}
                  min={todayStr()}
                  max={maxCheckOutDate}
                  className="h-9 text-xs"
                  onChange={(e) => setCheckOut(e.target.value)}
                />
              </div>
            </div>
          )}

          <p className="-mt-1 text-xs text-muted-foreground">
            {nights} night{nights > 1 ? 's' : ''}
            {room ? ` · ${formatINR(room.rate)} × ${nights} = ${formatINR(room.rate * nights)}` : ''}
            {bookingMode === 'BOOKING' ? ' · room reserved with yellow status until arrival' : ''}
          </p>

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
              }}
            />
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
