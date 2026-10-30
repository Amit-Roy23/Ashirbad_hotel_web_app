'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { apiAs, formatINR } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { toast } from '@/hooks/use-toast'
import { Loader2 } from 'lucide-react'

export interface EditableRoom {
  id: string
  number: string
  floor?: string | null
  type: string
  capacity: number
  rate: number
  notes?: string | null
}

/**
 * Change a room's set-up (floor, type, beds, rate, notes) for future bookings. Needs the Admin PIN;
 * guests already booked or staying keep the rate their booking was made at.
 */
export function EditRoomDialog({
  open,
  room,
  rooms,
  types,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  /** room to edit; without it the dialog starts with a room picker */
  room: EditableRoom | null
  rooms: EditableRoom[]
  types: string[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [pickedId, setPickedId] = useState('')
  const selected = room || rooms.find((r) => r.id === pickedId) || null
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPickedId('')
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        {!room && (
          <div className="space-y-1.5">
            {!selected && (
              <DialogHeader>
                <DialogTitle>Edit Room</DialogTitle>
                <DialogDescription>Choose the room to change. Changes apply to new bookings.</DialogDescription>
              </DialogHeader>
            )}
            <Label>Room</Label>
            <Select value={pickedId} onValueChange={setPickedId}>
              <SelectTrigger className="w-full" aria-label="Room to edit">
                <SelectValue placeholder="Select a room" />
              </SelectTrigger>
              <SelectContent>
                {rooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    Room {r.number} — {r.type}, {r.capacity} bed{r.capacity === 1 ? '' : 's'}, {formatINR(r.rate)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {selected && (
          <EditRoomForm
            key={selected.id}
            room={selected}
            types={types}
            onDone={() => {
              setPickedId('')
              onOpenChange(false)
            }}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditRoomForm({
  room,
  types,
  onDone,
  onSaved,
}: {
  room: EditableRoom
  types: string[]
  onDone: () => void
  onSaved: () => void
}) {
  const [floor, setFloor] = useState(room.floor || '')
  const [type, setType] = useState(room.type)
  const [capacity, setCapacity] = useState(String(room.capacity))
  const [rate, setRate] = useState(String(room.rate))
  const [notes, setNotes] = useState(room.notes || '')
  const [pin, setPin] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const cap = parseInt(capacity)
  const rateN = parseFloat(rate)
  const changes: string[] = []
  if (floor.trim() !== (room.floor || '')) changes.push(`floor ${room.floor || '—'} → ${floor.trim() || '—'}`)
  if (type.trim() !== room.type) changes.push(`type → ${type.trim()}`)
  if (cap !== room.capacity) changes.push(`beds ${room.capacity} → ${capacity}`)
  if (rateN !== room.rate) changes.push(`rate ${formatINR(room.rate)} → ${formatINR(rateN || 0)}`)
  if (notes.trim() !== (room.notes || '')) changes.push('notes')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!type.trim()) return setError('Room type is required')
    if (!(cap >= 1 && cap <= 10)) return setError('Beds / capacity must be between 1 and 10')
    if (!(rateN > 0)) return setError('Rate must be more than 0')
    if (changes.length === 0) return setError('Nothing has changed')
    if (!pin.trim()) return setError('Enter the Admin PIN')
    setSaving(true)
    setError('')
    try {
      await apiAs('/api/rooms', getCachedUser(), {
        method: 'PATCH',
        adminPin: pin.trim(),
        body: JSON.stringify({
          id: room.id,
          floor: floor.trim() || room.number.charAt(0),
          type: type.trim(),
          capacity: cap,
          rate: rateN,
          notes: notes.trim(),
        }),
      })
      toast({ variant: 'success', title: `Room ${room.number} updated`, description: changes.join(', ') })
      onSaved()
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the room')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <DialogHeader>
        <DialogTitle>Edit Room {room.number}</DialogTitle>
        <DialogDescription>
          Changes apply to new bookings. Guests already booked or staying keep the rate their booking was made at.
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="er-type">Room Type</Label>
          <Input id="er-type" list="er-types" value={type} onChange={(e) => setType(e.target.value)} />
          <datalist id="er-types">
            {types.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="er-floor">Floor</Label>
          <Input id="er-floor" value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="Ground, 1, 2…" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="er-beds">Beds / Guests</Label>
          <Input id="er-beds" type="number" min="1" max="10" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="er-rate">Rate (₹ / night)</Label>
          <Input id="er-rate" type="number" min="1" value={rate} onChange={(e) => setRate(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="er-notes">Notes</Label>
        <Input id="er-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Extra bed added" />
      </div>
      {changes.length > 0 && (
        <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">Changing: {changes.join(', ')}</p>
      )}
      <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-50/60 p-2.5 dark:border-amber-800 dark:bg-amber-950/30">
        <Label htmlFor="er-pin">Admin PIN *</Label>
        <Input
          id="er-pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value)
            setError('')
          }}
          placeholder="Needed to change room details"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !pin.trim() || changes.length === 0} className="bg-emerald-600 text-white hover:bg-emerald-700">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save Changes
        </Button>
      </div>
    </form>
  )
}
