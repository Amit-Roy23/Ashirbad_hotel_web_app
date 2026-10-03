'use client'

import { useEffect, useState } from 'react'
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
import { api, apiAs, addDays, formatINR, sanitizePhone } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { Loader2, UserSearch } from 'lucide-react'

interface Room {
  id: string
  number: string
  type: string
  rate: number
  capacity: number
}

interface CheckinDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  room: Room | null
  onSuccess: () => void
}

export function CheckinDialog({ open, onOpenChange, room, onSuccess }: CheckinDialogProps) {
  const [phone, setPhone] = useState('')
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [gst, setGst] = useState('')
  const [address, setAddress] = useState('')
  const [checkOut, setCheckOut] = useState(addDays(1))
  const [guestCount, setGuestCount] = useState('1')
  const [advance, setAdvance] = useState('')
  const [isCorporate, setIsCorporate] = useState(false)
  const [notes, setNotes] = useState('')
  const [autoFilled, setAutoFilled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && room) {
      setPhone('')
      setName('')
      setCompany('')
      setGst('')
      setAddress('')
      setCheckOut(addDays(1))
      setGuestCount('1')
      setAdvance('')
      setIsCorporate(false)
      setNotes('')
      setAutoFilled(false)
      setError('')
    }
  }, [open, room])

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
          roomId: room.id,
          phone: cleanPhone,
          name: name.trim(),
          company: company.trim() || undefined,
          gst: gst.trim() || undefined,
          address: address.trim() || undefined,
          checkIn: new Date().toISOString(),
          checkOut,
          guestCount,
          advance: advance || '0',
          isCorporate,
          notes: notes.trim() || undefined,
        }),
      })
      onSuccess()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check-in failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Check-In — Room {room?.number}</DialogTitle>
          <DialogDescription>
            {room?.type} • {formatINR(room?.rate)}/night • Max {room?.capacity} guests
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3.5">
          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-sm font-medium">
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
                className="pr-10"
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
                ✓ Old customer found — details auto-filled!
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name">Guest Name *</Label>
            <Input
              id="name"
              placeholder="Full name"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setAutoFilled(false)
              }}
            />
          </div>

          {isCorporate && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="company" className="text-sm font-medium">
                  Company Name <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="company"
                  placeholder="Company name (mandatory)"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gst">GST Number</Label>
                <Input
                  id="gst"
                  placeholder="GSTIN (optional)"
                  value={gst}
                  onChange={(e) => setGst(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="checkout">Expected Check-Out *</Label>
              <Input
                id="checkout"
                type="date"
                value={checkOut}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gcount">Guests *</Label>
              <Input
                id="gcount"
                type="number"
                min="1"
                value={guestCount}
                onChange={(e) => setGuestCount(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="advance">Advance Payment (₹) *</Label>
            <Input
              id="advance"
              type="number"
              min="0"
              placeholder="0"
              value={advance}
              onChange={(e) => setAdvance(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Corporate Guest</p>
              <p className="text-xs text-muted-foreground">Company / GST billing</p>
            </div>
            <Switch checked={isCorporate} onCheckedChange={setIsCorporate} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              placeholder="Any special instruction..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {error && <p className="text-sm text-red-600 font-medium">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700" onClick={submit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Check-In
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
