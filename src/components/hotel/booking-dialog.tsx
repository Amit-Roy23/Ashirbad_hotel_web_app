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
import { api, apiAs, addDays, formatINR, todayStr, sanitizePhone, isValidPhone } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { Loader2, UserSearch } from 'lucide-react'

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
}

export function BookingDialog({ open, onOpenChange, onSuccess, roomId, initialPhone }: BookingDialogProps) {
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
    setError('')
    setAutoFilled(false)
    setSaving(false)
    api<Room[]>('/api/rooms').then(setRooms).catch(() => {})
    if (initialPhone) {
      const clean = sanitizePhone(initialPhone)
      setPhone(clean)
      lookupGuest(clean)
    }
  }, [open, initialPhone])

  const availableRooms = useMemo(() => {
    return rooms.filter((r) => r.status === 'VACANT' && r.housekeeping !== 'DIRTY')
  }, [rooms])

  useEffect(() => {
    if (open) setSelectedRoom(roomId || availableRooms[0]?.id || '')
  }, [open, roomId, availableRooms])

  const room = rooms.find((r) => r.id === selectedRoom)
  const nights = useMemo(() => {
    const diff = Math.ceil(
      (new Date(checkOut + 'T11:00:00').getTime() - new Date(checkInDate + 'T12:00:00').getTime()) /
        (1000 * 60 * 60 * 24)
    )
    return Math.max(1, diff)
  }, [checkInDate, checkOut])

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
      await apiAs('/api/bookings', getCachedUser(), {
        method: 'POST',
        body: JSON.stringify({
          roomId: selectedRoom,
          phone: cleanPhone,
          name: name.trim(),
          company: company.trim() || undefined,
          gst: gst.trim() || undefined,
          checkIn: checkInDate,
          checkOut,
          guestCount,
          advance: advance || '0',
          advanceMethod,
          isCorporate,
          notes: notes.trim() || undefined,
        }),
      })
      onSuccess()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Booking failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Booking</DialogTitle>
          <DialogDescription>
            Select a room, enter guest details. Phone number auto-fills returning guests.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label>Room *</Label>
            <Select value={selectedRoom} onValueChange={setSelectedRoom}>
              <SelectTrigger aria-label="Select room">
                <SelectValue placeholder="Select room" />
              </SelectTrigger>
              <SelectContent>
                {availableRooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    Room {r.number} — {r.type} · {formatINR(r.rate)}/night
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableRooms.length === 0 && (
              <p className="text-xs text-destructive">No clean vacant rooms available right now.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bk-in">Check-In Date</Label>
              <Input id="bk-in" type="date" value={checkInDate} min={todayStr()} onChange={(e) => setCheckInDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bk-out">Check-Out</Label>
              <Input id="bk-out" type="date" value={checkOut} min={checkInDate} onChange={(e) => setCheckOut(e.target.value)} />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            {nights} night{nights > 1 ? 's' : ''}
            {room ? ` · ${formatINR(room.rate)} × ${nights} = ${formatINR(room.rate * nights)}` : ''}
            {checkInDate > todayStr() ? ' · future booking (room stays available until check-in)' : ''}
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="bk-phone">Phone Number (10 Digits) *</Label>
            <div className="relative">
              <Input
                id="bk-phone"
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="10-digit mobile number"
                value={phone}
                onChange={(e) => lookupGuest(e.target.value)}
                className="pr-10"
              />
              {searching && (
                <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              )}
              {!searching && phone.length >= 4 && (
                <UserSearch className="absolute right-3 top-1/2 h-4 w-4 text-emerald-600" />
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
                ✓ Old customer found — details auto-filled!
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bk-name">Guest Name *</Label>
            <Input
              id="bk-name"
              placeholder="Full name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setAutoFilled(false)
              }}
            />
          </div>

          {isCorporate && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bk-company">Company</Label>
                <Input id="bk-company" placeholder="Company name" value={company} onChange={(e) => setCompany(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bk-gst">GST Number</Label>
                <Input id="bk-gst" placeholder="GSTIN (optional)" value={gst} onChange={(e) => setGst(e.target.value)} />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bk-gcount">Guests</Label>
              <Input id="bk-gcount" type="number" min="1" value={guestCount} onChange={(e) => setGuestCount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bk-advance">Advance (₹)</Label>
              <Input id="bk-advance" type="number" min="0" placeholder="0" value={advance} onChange={(e) => setAdvance(e.target.value)} />
            </div>
          </div>

          {parseFloat(advance) > 0 && (
            <div className="space-y-1.5">
              <Label>Advance Payment Method</Label>
              <Select value={advanceMethod} onValueChange={setAdvanceMethod}>
                <SelectTrigger aria-label="Advance payment method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="UPI">UPI</SelectItem>
                  <SelectItem value="CARD">Card</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Corporate Guest</p>
              <p className="text-xs text-muted-foreground">Company / GST billing</p>
            </div>
            <Switch checked={isCorporate} onCheckedChange={setIsCorporate} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bk-notes">Notes</Label>
            <Textarea id="bk-notes" placeholder="Any special instruction..." value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>

          {error && <p className="text-sm font-medium text-destructive">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={submit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Booking
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
