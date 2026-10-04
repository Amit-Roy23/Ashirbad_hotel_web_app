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
import { api, apiAs, addDays, formatINR, todayStr, sanitizePhone, formatDate } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { toast } from '@/hooks/use-toast'
import { Loader2, UserSearch, LogIn, CalendarCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Room {
  id: string
  number: string
  type: string
  rate: number
  capacity: number
  status: string
  housekeeping?: string
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
}

export function BookingDialog({ open, onOpenChange, onSuccess, roomId, initialPhone, initialMode = 'BOOKING' }: BookingDialogProps) {
  const [bookingMode, setBookingMode] = useState<'BOOKING' | 'CHECKIN'>(initialMode)
  const [rooms, setRooms] = useState<Room[]>([])
  const [selectedRoom, setSelectedRoom] = useState<string>('')
  const [checkInDate, setCheckInDate] = useState(todayStr())
  const [checkOut, setCheckOut] = useState(addDays(1))
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
    setCheckInDate(todayStr())
    setCheckOut(addDays(1))
    api<Room[]>('/api/rooms').then(setRooms).catch(() => {})
    if (initialPhone) {
      const clean = sanitizePhone(initialPhone)
      setPhone(clean)
      lookupGuest(clean)
    }
  }, [open, initialPhone, initialMode])

  const availableRooms = useMemo(() => {
    return rooms.filter((r) => r.status === 'VACANT' && r.housekeeping !== 'DIRTY')
  }, [rooms])

  useEffect(() => {
    if (open) setSelectedRoom(roomId || availableRooms[0]?.id || '')
  }, [open, roomId, availableRooms])

  const room = rooms.find((r) => r.id === selectedRoom)
  const effectiveCheckIn = bookingMode === 'BOOKING' ? checkInDate : todayStr()
  const nights = useMemo(() => {
    const diff = Math.ceil(
      (new Date(checkOut + 'T11:00:00').getTime() - new Date(effectiveCheckIn + 'T12:00:00').getTime()) /
        (1000 * 60 * 60 * 24)
    )
    return Math.max(1, diff)
  }, [effectiveCheckIn, checkOut])

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
    if (!guestCount || parseInt(guestCount) < 1) {
      setError('Number of guests must be at least 1')
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
                {availableRooms.map((r) => (
                  <SelectItem key={r.id} value={r.id} className="text-xs">
                    Room {r.number} — {r.type} · {formatINR(r.rate)}/night
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableRooms.length === 0 && (
              <p className="text-xs text-destructive">No clean vacant rooms available right now.</p>
            )}
          </div>

          {/* Date selection */}
          {bookingMode === 'BOOKING' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bk-in" className="text-xs font-semibold text-foreground">Check-In Date *</Label>
                <Input
                  id="bk-in"
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
                <Label htmlFor="bk-out" className="text-xs font-semibold text-foreground">Check-Out Date *</Label>
                <Input
                  id="bk-out"
                  type="date"
                  value={checkOut}
                  min={checkInDate}
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
                <Label htmlFor="bk-out-ci" className="text-xs font-semibold text-foreground">Expected Check-Out *</Label>
                <Input
                  id="bk-out-ci"
                  type="date"
                  value={checkOut}
                  min={todayStr()}
                  className="h-9 text-xs"
                  onChange={(e) => setCheckOut(e.target.value)}
                />
              </div>
            </div>
          )}

          <p className="-mt-1 text-xs text-muted-foreground">
            {nights} night{nights > 1 ? 's' : ''}
            {room ? ` · ${formatINR(room.rate)} × ${nights} = ${formatINR(room.rate * nights)}` : ''}
            {bookingMode === 'BOOKING' ? ' · room will be marked as Booked (Yellow)' : ''}
          </p>

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
              <Label htmlFor="bk-gcount" className="text-xs font-semibold text-foreground">Guests</Label>
              <Input id="bk-gcount" type="number" min="1" value={guestCount} className="h-9 text-xs" onChange={(e) => setGuestCount(e.target.value)} />
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
