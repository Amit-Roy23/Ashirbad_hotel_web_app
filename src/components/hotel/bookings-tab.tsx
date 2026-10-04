'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { BookingDialog } from './booking-dialog'
import { PaymentStatusBadge } from './status-badge'
import { TableControls, SortableTh, useSort, usePagination } from './table-controls'
import { api, apiAs, formatINR, formatDate, exportCSV, totalReceived, balanceDue } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { Loader2, UserPlus, LogIn, CalendarClock, XCircle, ArrowLeftRight, Wallet, Pencil, Save, Trash2 } from 'lucide-react'

interface Guest {
  id: string
  name: string
  phone: string
  company?: string | null
}

interface Room {
  id: string
  number: string
  type?: string
  rate?: number
  status?: string
}

interface Bill {
  id: string
  billNumber: string
  grandTotal: number
  advanceApplied: number
  payCash: number
  payUpi: number
  payCard: number
  roomDescription?: string | null
  internalGst?: number
  internalTotal?: number
}

interface Booking {
  id: string
  checkIn: string
  checkOut?: string | null
  days: number
  guestCount: number
  ratePerDay: number
  advance: number
  status: string
  paymentStatus: string
  isCorporate: boolean
  guest: Guest
  room: Room
  bills: Bill[]
  foodOrders: { total: number }[]
}

interface TabProps {
  refreshKey: number
  onDataChanged: () => void
  initialFilter?: string
}

const STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Active (in-house)' },
  { value: 'BOOKED', label: 'Booked (future)' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

export function BookingsTab({ refreshKey, onDataChanged, initialFilter }: TabProps) {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [rooms, setRooms] = useState<Room[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)

  // filters
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('ALL')
  const [paymentStatus, setPaymentStatus] = useState('ALL')
  const [roomFilter, setRoomFilter] = useState('ALL')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [newOpen, setNewOpen] = useState(false)
  const [extendBooking, setExtendBooking] = useState<Booking | null>(null)
  const [newDate, setNewDate] = useState('')
  const [changeBooking, setChangeBooking] = useState<Booking | null>(null)
  const [newRoomId, setNewRoomId] = useState('')

  useEffect(() => {
    if (initialFilter) setSearch(initialFilter)
  }, [initialFilter])

  const load = useCallback(async () => {
    try {
      const [b, r] = await Promise.all([api<Booking[]>('/api/bookings'), api<Room[]>('/api/rooms')])
      setBookings(b)
      setRooms(r)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return bookings.filter((b) => {
      if (q && !(`${b.guest?.name || ''} ${b.guest?.phone || ''} ${b.room?.number || ''}`.toLowerCase().includes(q))) return false
      if (status !== 'ALL' && b.status !== status) return false
      if (paymentStatus !== 'ALL') {
        const hasDue = b.bills?.[0] && balanceDue(b.bills[0]) > 0.01
        const eff = hasDue ? 'PARTIAL' : 'PAID'
        if (paymentStatus === 'PAID' && eff !== 'PAID') return false
        if (paymentStatus === 'PARTIAL' && eff !== 'PARTIAL') return false
      }
      if (roomFilter !== 'ALL' && b.room?.id !== roomFilter) return false
      const created = new Date(b.checkIn).toISOString().slice(0, 10)
      if (from && created < from) return false
      if (to && created > to) return false
      return true
    })
  }, [bookings, search, status, paymentStatus, roomFilter, from, to])

  const { sorted, sort, toggle } = useSort<Record<string, unknown>>(filtered as unknown as Record<string, unknown>[], 'checkIn')
  const { paged, controls } = usePagination(sorted as unknown as Booking[], 10)

  function resetFilters() {
    setSearch('')
    setStatus('ALL')
    setPaymentStatus('ALL')
    setRoomFilter('ALL')
    setFrom('')
    setTo('')
  }

  function doExport() {
    exportCSV(
      'bookings.csv',
      ['Guest', 'Phone', 'Room', 'Check-in', 'Check-out', 'Nights', 'Rate/Night', 'Advance', 'Status', 'Payment', 'Corporate'],
      (filtered as unknown as Booking[]).map((b) => {
        const hasDue = b.bills?.[0] && balanceDue(b.bills[0]) > 0.01
        const effPayment = hasDue ? 'PARTIAL' : 'PAID'
        return [
          b.guest?.name || '', b.guest?.phone || '', b.room?.number || '', formatDate(b.checkIn), formatDate(b.checkOut),
          b.days, b.ratePerDay, b.advance, b.status, effPayment, b.isCorporate ? 'Yes' : 'No',
        ]
      })
    )
  }

  async function action(booking: Booking, act: string, extra: Record<string, unknown> = {}) {
    setBusyId(booking.id + act)
    try {
      await apiAs('/api/bookings', getCachedUser(), {
        method: 'PATCH',
        body: JSON.stringify({ id: booking.id, action: act, ...extra }),
      })
      await load()
      onDataChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusyId(null)
    }
  }

  const [cancelModalBooking, setCancelModalBooking] = useState<Booking | null>(null)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editRate, setEditRate] = useState('')
  const [editAdvance, setEditAdvance] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  function openCancelModal(b: Booking) {
    setCancelModalBooking(b)
    setEditName(b.guest?.name || '')
    setEditPhone(b.guest?.phone || '')
    setEditRate(String(b.ratePerDay || ''))
    setEditAdvance(String(b.advance || '0'))
  }

  async function handleSaveEdit() {
    if (!cancelModalBooking) return
    setSavingEdit(true)
    try {
      await apiAs('/api/bookings', getCachedUser(), {
        method: 'PATCH',
        body: JSON.stringify({
          id: cancelModalBooking.id,
          action: 'update',
          name: editName,
          phone: editPhone,
          ratePerDay: editRate,
          advance: editAdvance,
        }),
      })
      setCancelModalBooking(null)
      await load()
      onDataChanged()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to update booking')
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleCancelBooking() {
    if (!cancelModalBooking) return
    if (!confirm(`Are you sure you want to CANCEL booking for ${cancelModalBooking.guest?.name}?`)) return
    await action(cancelModalBooking, 'cancel')
    setCancelModalBooking(null)
  }

  async function handleDeleteBooking() {
    if (!cancelModalBooking) return
    if (!confirm(`Are you sure you want to PERMANENTLY DELETE booking for ${cancelModalBooking.guest?.name}? This cannot be undone.`)) return
    setBusyId(cancelModalBooking.id + 'delete')
    try {
      const res = await apiAs<{ success?: boolean; error?: string }>(
        `/api/bookings?id=${cancelModalBooking.id}`,
        getCachedUser(),
        { method: 'DELETE' }
      )
      if (res && res.error) {
        alert(res.error)
      } else {
        setCancelModalBooking(null)
        await load()
        onDataChanged()
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not delete booking')
    } finally {
      setBusyId(null)
    }
  }

  function paidAmount(b: Booking): number {
    const bill = b.bills[0]
    return bill ? totalReceived(bill) : 0
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  const vacantRooms = rooms.filter((r) => r.status !== 'OCCUPIED')

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Bookings</h2>
          <p className="text-xs text-muted-foreground">
            {bookings.filter((b) => b.status === 'ACTIVE').length} in-house ·{' '}
            {bookings.filter((b) => b.status === 'BOOKED').length} upcoming ·{' '}
            {bookings.filter((b) => b.bills?.[0] && balanceDue(b.bills[0]) > 0.01).length} with balance
          </p>
        </div>
        <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700" onClick={() => setNewOpen(true)}>
          <UserPlus className="h-4 w-4" /> New Booking
        </Button>
      </div>

      <TableControls
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Guest name, phone, room…"
        filters={[
          { key: 'status', label: 'Status', options: STATUS_OPTIONS },
          {
            key: 'payment',
            label: 'Payment',
            options: [
              { value: 'PAID', label: 'Paid / Confirmed' },
              { value: 'PARTIAL', label: 'Partial / Balance Due' },
            ],
          },
          {
            key: 'room',
            label: 'Room',
            options: rooms.map((r) => ({ value: r.id, label: `Room ${r.number}` })),
          },
        ]}
        filterValues={{ status, payment: paymentStatus, room: roomFilter }}
        onFilterChange={(k, v) => {
          if (k === 'status') setStatus(v)
          if (k === 'payment') setPaymentStatus(v)
          if (k === 'room') setRoomFilter(v)
        }}
        onReset={resetFilters}
        onExport={doExport}
      >
        <div className="flex items-center gap-1.5">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[145px] text-xs" aria-label="From date" />
          <span className="text-xs text-muted-foreground font-medium">to</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[145px] text-xs" aria-label="To date" />
        </div>
      </TableControls>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableTh label="Guest" sortKey="guest" sort={sort} onToggle={toggle} />
              <TableHead>Room</TableHead>
              <SortableTh label="Check-In" sortKey="checkIn" sort={sort} onToggle={toggle} />
              <TableHead>Nights</TableHead>
              <TableHead>Rate</TableHead>
              <TableHead>Advance</TableHead>
              <SortableTh label="Status" sortKey="status" sort={sort} onToggle={toggle} />
              <TableHead>Payment</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                  No bookings match the filters.
                </TableCell>
              </TableRow>
            )}
            {(paged as unknown as Booking[]).map((b) => {
              const busy = busyId === b.id
              const hasDue = b.bills?.[0] && balanceDue(b.bills[0]) > 0.01
              const effPaymentStatus = hasDue ? 'PARTIAL' : 'PAID'
              return (
                <TableRow key={b.id}>
                  <TableCell>
                    <div className="font-medium">{b.guest?.name || 'Guest'}</div>
                    <div className="text-xs text-muted-foreground">{b.guest?.phone}</div>
                  </TableCell>
                  <TableCell className="font-medium">Room {b.room?.number}</TableCell>
                  <TableCell>
                    <div className="text-sm">{formatDate(b.checkIn)}</div>
                    <div className="text-xs text-muted-foreground">out: {formatDate(b.checkOut)}</div>
                  </TableCell>
                  <TableCell>{b.days}</TableCell>
                  <TableCell>{formatINR(b.ratePerDay)}</TableCell>
                  <TableCell>{b.advance > 0 ? formatINR(b.advance) : '—'}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        b.status === 'ACTIVE'
                          ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
                          : b.status === 'BOOKED'
                            ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : b.status === 'COMPLETED'
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300'
                      }
                    >
                      {b.status === 'ACTIVE' ? 'In-house' : b.status === 'BOOKED' ? 'Booked' : b.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <PaymentStatusBadge status={effPaymentStatus} />
                    {hasDue && (
                      <div className="mt-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                        due {formatINR(balanceDue(b.bills[0]))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {b.status === 'ACTIVE' && (
                      <div className="grid grid-cols-2 gap-1.5 w-full max-w-[220px] mx-auto">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-xs w-full justify-center"
                          disabled={busy}
                          onClick={() => {
                            setChangeBooking(b)
                            setNewRoomId('')
                          }}
                        >
                          <ArrowLeftRight className="h-3 w-3" /> Move
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-xs w-full justify-center"
                          disabled={busy}
                          onClick={() => {
                            setExtendBooking(b)
                            setNewDate(b.checkOut ? new Date(b.checkOut).toISOString().slice(0, 10) : '')
                          }}
                        >
                          <CalendarClock className="h-3 w-3" /> Extend
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-xs w-full justify-center border-emerald-300 bg-emerald-50/60 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                          disabled={busy}
                          onClick={() => {
                            if (confirm(`Check out ${b.guest?.name || 'Guest'} from Room ${b.room?.number}?`)) action(b, 'checkout')
                          }}
                        >
                          <Wallet className="h-3 w-3" /> Checkout
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-xs w-full justify-center text-destructive hover:bg-destructive/10"
                          disabled={busy}
                          onClick={() => openCancelModal(b)}
                        >
                          <XCircle className="h-3 w-3" /> Cancel
                        </Button>
                      </div>
                    )}
                    {b.status === 'BOOKED' && (
                      <div className="grid grid-cols-2 gap-1.5 w-full max-w-[220px] mx-auto">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-xs w-full justify-center border-emerald-300 bg-emerald-50/60 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                          disabled={busy}
                          onClick={() => action(b, 'checkin')}
                        >
                          <LogIn className="h-3 w-3" /> Check-in
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-xs w-full justify-center text-destructive hover:bg-destructive/10"
                          disabled={busy}
                          onClick={() => openCancelModal(b)}
                        >
                          <XCircle className="h-3 w-3" /> Cancel
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
      {controls}

      <BookingDialog open={newOpen} onOpenChange={setNewOpen} onSuccess={() => { load(); onDataChanged() }} />

      {/* Extend stay dialog */}
      <Dialog open={!!extendBooking} onOpenChange={(o) => !o && setExtendBooking(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Extend Stay</DialogTitle>
            <DialogDescription>
              {extendBooking?.guest?.name} · Room {extendBooking?.room?.number} · current out:{' '}
              {formatDate(extendBooking?.checkOut)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ext-date">New Check-Out Date</Label>
              <Input
                id="ext-date"
                type="date"
                value={newDate}
                min={extendBooking ? new Date(extendBooking.checkIn).toISOString().slice(0, 10) : ''}
                onChange={(e) => setNewDate(e.target.value)}
              />
            </div>
            <Button
              className="w-full"
              disabled={!newDate || busyId !== null}
              onClick={() => {
                if (extendBooking) {
                  action(extendBooking, 'extend', { checkOut: newDate })
                  setExtendBooking(null)
                }
              }}
            >
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Change room dialog */}
      <Dialog open={!!changeBooking} onOpenChange={(o) => !o && setChangeBooking(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Change Room</DialogTitle>
            <DialogDescription>
              Move {changeBooking?.guest?.name} out of Room {changeBooking?.room?.number}. Old room is marked for cleaning.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={newRoomId} onValueChange={setNewRoomId}>
              <SelectTrigger aria-label="New room">
                <SelectValue placeholder="Select new room" />
              </SelectTrigger>
              <SelectContent>
                {vacantRooms
                  .filter((r) => r.id !== changeBooking?.room.id)
                  .map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      Room {r.number} — {formatINR(r.rate)}/night
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              className="w-full"
              disabled={!newRoomId || busyId !== null}
              onClick={() => {
                if (changeBooking) {
                  action(changeBooking, 'change-room', { newRoomId })
                  setChangeBooking(null)
                }
              }}
            >
              Move Guest
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage / Cancel & Edit Booking Modal */}
      <Dialog open={!!cancelModalBooking} onOpenChange={(o) => !o && setCancelModalBooking(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between pr-4">
              <span>Booking Options — Room {cancelModalBooking?.room?.number}</span>
              <Badge variant="outline">{cancelModalBooking?.status}</Badge>
            </DialogTitle>
            <DialogDescription>
              {cancelModalBooking?.guest?.name} • {cancelModalBooking?.guest?.phone} • Check-in: {formatDate(cancelModalBooking?.checkIn)}
            </DialogDescription>
          </DialogHeader>

          {cancelModalBooking && (
            <div className="space-y-4">
              {/* Edit section */}
              <div className="space-y-3 rounded-lg border bg-card p-3">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-xs font-semibold">
                    <Pencil className="h-3.5 w-3.5 text-emerald-600" /> Edit Booking Details
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="space-y-1">
                    <Label htmlFor="edit-name" className="text-[11px]">Guest Name</Label>
                    <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-phone" className="text-[11px]">Phone</Label>
                    <Input id="edit-phone" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-rate" className="text-[11px]">Rate / Night (₹)</Label>
                    <Input id="edit-rate" type="number" value={editRate} onChange={(e) => setEditRate(e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-adv" className="text-[11px]">Advance (₹)</Label>
                    <Input id="edit-adv" type="number" value={editAdvance} onChange={(e) => setEditAdvance(e.target.value)} className="h-8 text-xs" />
                  </div>
                </div>
                <Button
                  size="sm"
                  className="h-8 w-full gap-1.5 bg-emerald-600 text-xs hover:bg-emerald-700"
                  disabled={savingEdit}
                  onClick={handleSaveEdit}
                >
                  {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save Edits
                </Button>
              </div>

              <Separator />

              {/* Cancel & Delete Section */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Cancel or Delete Action</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    className="h-9 gap-1.5 border-amber-300 bg-amber-50 text-xs text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
                    disabled={busyId !== null}
                    onClick={handleCancelBooking}
                  >
                    <XCircle className="h-3.5 w-3.5 text-amber-600" /> Cancel Booking
                  </Button>
                  <Button
                    variant="destructive"
                    className="h-9 gap-1.5 text-xs"
                    disabled={busyId !== null}
                    onClick={handleDeleteBooking}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete Booking
                  </Button>
                </div>
                <p className="text-center text-[10px] text-muted-foreground">
                  Cancel frees the room &amp; updates status to Cancelled. Delete permanently removes the record.
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
