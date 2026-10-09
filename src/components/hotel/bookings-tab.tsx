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
import { GenerateBillDialog } from './generate-bill-dialog'
import { toast } from '@/hooks/use-toast'
import { PaymentStatusBadge } from './status-badge'
import { TableControls, SortableTh, useSort, usePagination } from './table-controls'
import { api, apiAs, formatINR, formatDate, formatDateTime, exportCSV, printTableReport, totalReceived, balanceDue, todayStr, addDays, getRoomOperationalState } from '@/lib/hotel-utils'
import { calcNights, nextAutoExtensionAt, istDateStr } from '@/lib/stay'
import { Loader2, UserPlus, LogIn, CalendarClock, XCircle, ArrowLeftRight, Wallet, Pencil, Save, Trash2, AlertTriangle, Clock, ShieldAlert, History, Eye, Phone, Info } from 'lucide-react'
import { AdminDeleteDialog } from './admin-delete-dialog'
import { getCachedUser } from './user-context'

interface Guest {
  id: string
  name: string
  phone: string
  company?: string | null
  gst?: string | null
  email?: string | null
  address?: string | null
}

interface Room {
  id: string
  number: string
  type?: string
  rate?: number
  status?: string
  housekeeping?: string
  bookings?: { id: string; status: string; checkIn: string; checkOut?: string | null }[]
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

export interface BookingExtension {
  id: string
  bookingId: string
  type: string // 'AUTO' | 'MANUAL'
  fromCheckOut: string
  toCheckOut: string
  fromDays: number
  toDays: number
  reason?: string | null
  createdBy?: string | null
  approvedBy?: string | null
  createdAt: string
}

interface Booking {
  id: string
  checkIn: string
  checkOut?: string | null
  originalCheckOut?: string | null
  actualCheckOut?: string | null
  autoExtendedDays?: number
  days: number
  guestCount: number
  ratePerDay: number
  advance: number
  status: string
  paymentStatus: string
  isCorporate: boolean
  notes?: string | null
  createdAt?: string
  updatedAt?: string
  guest: Guest
  room: Room
  bills: Bill[]
  foodOrders: { total: number }[]
  extensions?: BookingExtension[]
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
  const [hotelSettings, setHotelSettings] = useState<Record<string, string>>({})
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
  const [newTime, setNewTime] = useState('08:00')
  const [newDays, setNewDays] = useState<string | number>('')
  const [extendReason, setExtendReason] = useState('')
  const [adminPin, setAdminPin] = useState('')
  const [extendError, setExtendError] = useState('')
  const [extendSaving, setExtendSaving] = useState(false)

  const [changeBooking, setChangeBooking] = useState<Booking | null>(null)
  const [newRoomId, setNewRoomId] = useState('')
  const [billBooking, setBillBooking] = useState<Booking | null>(null)
  const [deleteTargetBooking, setDeleteTargetBooking] = useState<Booking | null>(null)

  useEffect(() => {
    if (initialFilter) setSearch(initialFilter)
  }, [initialFilter])

  const load = useCallback(async () => {
    try {
      const [b, r, s] = await Promise.all([
        api<Booking[]>('/api/bookings'),
        api<Room[]>('/api/rooms'),
        api<Record<string, string>>('/api/settings').catch(() => ({})),
      ])
      setBookings(b)
      setRooms(r)
      if (s) setHotelSettings(s)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  function openExtendModal(b: Booking) {
    setExtendBooking(b)
    const currOutStr = b.checkOut ? istDateStr(new Date(b.checkOut)) : todayStr()
    const nextDay = addDays(1, currOutStr)
    setNewDate(nextDay)
    setNewTime(hotelSettings.checkoutTime || '08:00')
    setNewDays(calcNights(b.checkIn, nextDay))
    setExtendReason('')
    setAdminPin('')
    setExtendError('')
  }

  async function handleExtendSubmit() {
    if (!extendBooking) return
    if (!newDate) {
      setExtendError('New check-out date is required')
      return
    }
    if (!extendReason.trim()) {
      setExtendError('Reason is required for stay extension')
      return
    }
    if (!adminPin.trim()) {
      setExtendError('Admin PIN is required')
      return
    }
    const daysNum = typeof newDays === 'string' ? parseInt(newDays, 10) : newDays
    if (isNaN(daysNum) || daysNum < 1) {
      setExtendError('Billable days must be at least 1')
      return
    }
    setExtendSaving(true)
    setExtendError('')
    try {
      await apiAs('/api/bookings', getCachedUser(), {
        method: 'PATCH',
        body: JSON.stringify({
          id: extendBooking.id,
          action: 'extend',
          checkOut: newDate,
          checkOutTime: newTime || '08:00',
          days: daysNum,
          reason: extendReason.trim(),
          adminPin: adminPin.trim(),
        }),
      })
      setExtendBooking(null)
      await load()
      onDataChanged()
    } catch (e) {
      setExtendError(e instanceof Error ? e.message : 'Extension failed')
    } finally {
      setExtendSaving(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return bookings.filter((b) => {
      if (q && !(`${b.guest?.name || ''} ${b.guest?.phone || ''} ${b.guest?.company || ''} ${b.room?.number || ''} ${b.id || ''}`.toLowerCase().includes(q))) return false
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

  const bookingExportHeaders = ['Guest', 'Phone', 'Room', 'Check-in', 'Check-out', 'Nights', 'Rate/Night', 'Advance', 'Status', 'Payment', 'Corporate']

  function getBookingRowsData() {
    return (filtered as unknown as Booking[]).map((b) => {
      const hasDue = b.bills?.[0] && balanceDue(b.bills[0]) > 0.01
      const effPayment = hasDue ? 'PARTIAL' : 'PAID'
      return [
        b.guest?.name || '', b.guest?.phone || '', b.room?.number || '', formatDate(b.checkIn), formatDate(b.checkOut),
        b.days, formatINR(b.ratePerDay), formatINR(b.advance), b.status, effPayment, b.isCorporate ? 'Yes' : 'No',
      ]
    })
  }

  function doExport() {
    exportCSV('bookings.csv', bookingExportHeaders, getBookingRowsData())
  }

  function doPrint() {
    printTableReport('Bookings & Reservations Report', bookingExportHeaders, getBookingRowsData(), `${filtered.length} bookings listed`)
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

  // Edit booking modal
  const [editModalBooking, setEditModalBooking] = useState<Booking | null>(null)
  const [editName, setEditName] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editRate, setEditRate] = useState('')
  const [editAdvance, setEditAdvance] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // Cancel booking modal (with reason and cancellation date tracking)
  const [cancelModalBooking, setCancelModalBooking] = useState<Booking | null>(null)
  const [cancelReason, setCancelReason] = useState('Customer change of plans')
  const [refundNote, setRefundNote] = useState('')
  const [refundAmount, setRefundAmount] = useState('')
  const [cancellingBooking, setCancellingBooking] = useState(false)

  // View details modal (for cancelled / completed historical bookings)
  const [viewDetailsBooking, setViewDetailsBooking] = useState<Booking | null>(null)

  function openEditModal(b: Booking) {
    setEditModalBooking(b)
    setEditName(b.guest?.name || '')
    setEditPhone(b.guest?.phone || '')
    setEditRate(String(b.ratePerDay || ''))
    setEditAdvance(String(b.advance || '0'))
  }

  function openCancelDialog(b: Booking) {
    setCancelModalBooking(b)
    setCancelReason('Customer change of plans')
    setRefundNote(b.advance > 0 ? 'Full refund' : '')
    setRefundAmount(b.advance > 0 ? String(b.advance) : '')
  }

  async function handleSaveEdit() {
    if (!editModalBooking) return
    setSavingEdit(true)
    try {
      await apiAs('/api/bookings', getCachedUser(), {
        method: 'PATCH',
        body: JSON.stringify({
          id: editModalBooking.id,
          action: 'update',
          name: editName,
          phone: editPhone,
          ratePerDay: editRate,
          advance: editAdvance,
        }),
      })
      toast({ variant: 'success', title: 'Saved', description: 'Booking details updated successfully.' })
      setEditModalBooking(null)
      await load()
      onDataChanged()
    } catch (e) {
      toast({ variant: 'destructive', title: 'Update failed', description: e instanceof Error ? e.message : 'Failed to update booking' })
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleConfirmCancel() {
    if (!cancelModalBooking) return
    setCancellingBooking(true)
    try {
      await apiAs('/api/bookings', getCachedUser(), {
        method: 'PATCH',
        body: JSON.stringify({
          id: cancelModalBooking.id,
          action: 'cancel',
          reason: cancelReason,
          refundNote: refundNote,
          refundAmount: refundAmount,
        }),
      })
      toast({
        variant: 'success',
        title: 'Booking Cancelled',
        description: `Booking for ${cancelModalBooking.guest?.name} in Room ${cancelModalBooking.room?.number} has been cancelled and stored in history with cancellation timestamp.`,
      })
      setCancelModalBooking(null)
      await load()
      onDataChanged()
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Cancellation failed',
        description: e instanceof Error ? e.message : 'Could not cancel booking',
      })
    } finally {
      setCancellingBooking(false)
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

  // Move targets: same derived state as the Rooms grid (no in-house guest, not under maintenance, no arrival due today)
  const vacantRooms = rooms.filter((r) => {
    const st = getRoomOperationalState(r).displayStatus
    return st !== 'OCCUPIED' && st !== 'MAINTENANCE' && st !== 'BOOKED'
  })

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
        onPrint={doPrint}
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
              const busy = !!busyId && busyId.startsWith(b.id)
              const hasDue = b.bills?.[0] && balanceDue(b.bills[0]) > 0.01
              const effPaymentStatus = hasDue ? 'PARTIAL' : 'PAID'
              return (
                <TableRow key={b.id} className={b.status === 'CANCELLED' ? 'bg-muted/30' : ''}>
                  <TableCell>
                    <div className="font-semibold text-sm">{b.guest?.name || 'Guest'}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                      <Phone className="h-3 w-3 text-muted-foreground" />
                      <span>{b.guest?.phone}</span>
                    </div>
                    {b.guest?.company && (
                      <div className="text-[10px] text-violet-700 dark:text-violet-300 font-medium">
                        {b.guest.company}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="font-medium">
                    <div>Room {b.room?.number}</div>
                    <div className="text-[11px] text-muted-foreground">{b.room?.type}</div>
                  </TableCell>
                  <TableCell>
                    {b.status === 'CANCELLED' ? (
                      <div className="space-y-0.5">
                        <div className="text-xs font-semibold text-red-600 dark:text-red-400 flex items-center gap-1">
                          <XCircle className="h-3.5 w-3.5 shrink-0" />
                          <span>Cancelled: {formatDateTime(b.actualCheckOut || b.updatedAt || b.createdAt)}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Reserved: {formatDate(b.checkIn)} → {formatDate(b.checkOut)} ({b.days}n)
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="text-sm font-medium">{formatDate(b.checkIn)}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          out: {formatDateTime(b.checkOut)}
                        </div>
                        {(b.autoExtendedDays || 0) > 0 && (
                          <div className="mt-1 space-y-0.5">
                            <Badge
                              variant="outline"
                              className="border-amber-500 bg-amber-50 text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200 inline-flex items-center gap-1 font-semibold text-[10px] px-1.5 py-0.5"
                            >
                              <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400 shrink-0" />
                              OVERSTAY +{b.autoExtendedDays} day{b.autoExtendedDays! > 1 ? 's' : ''} (auto)
                            </Badge>
                            {b.originalCheckOut && (
                              <div className="text-[10px] text-muted-foreground">
                                Orig: {formatDateTime(b.originalCheckOut)}
                              </div>
                            )}
                          </div>
                        )}
                        {b.status === 'ACTIVE' && (
                          <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                            <Clock className="h-2.5 w-2.5 shrink-0" />
                            Next auto: {formatDateTime(nextAutoExtensionAt(b, parseInt(hotelSettings.overstayGraceMinutes || '0', 10)))}
                          </div>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{b.days}</TableCell>
                  <TableCell>{formatINR(b.ratePerDay)}</TableCell>
                  <TableCell>
                    {b.advance > 0 ? (
                      <span className="font-semibold text-emerald-700 dark:text-emerald-400">{formatINR(b.advance)}</span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={
                        b.status === 'ACTIVE'
                          ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
                          : b.status === 'BOOKED'
                            ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300 font-semibold'
                            : b.status === 'COMPLETED'
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300 font-semibold'
                      }
                    >
                      {b.status === 'ACTIVE' ? 'In-house' : b.status === 'BOOKED' ? 'Booked' : b.status === 'CANCELLED' ? 'Cancelled' : b.status}
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
                          onClick={() => openExtendModal(b)}
                        >
                          <CalendarClock className="h-3 w-3" /> Extend
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-xs w-full justify-center border-emerald-300 bg-emerald-50/60 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                          disabled={busy}
                          onClick={() => {
                            if (b.bills?.length) {
                              if (confirm(`Check out ${b.guest?.name || 'Guest'} from Room ${b.room?.number}?`)) action(b, 'checkout')
                            } else {
                              setBillBooking(b)
                            }
                          }}
                        >
                          <Wallet className="h-3 w-3" /> Checkout
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-xs w-full justify-center text-destructive hover:bg-destructive/10"
                          disabled={busy}
                          onClick={() => openCancelDialog(b)}
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
                          variant="outline"
                          className="h-7 gap-1 px-2 text-xs w-full justify-center"
                          disabled={busy}
                          onClick={() => openExtendModal(b)}
                        >
                          <CalendarClock className="h-3 w-3" /> Extend
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-xs w-full justify-center"
                          disabled={busy}
                          onClick={() => openEditModal(b)}
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 px-2 text-xs w-full justify-center text-destructive hover:bg-destructive/10"
                          disabled={busy}
                          onClick={() => openCancelDialog(b)}
                        >
                          <XCircle className="h-3 w-3" /> Cancel
                        </Button>
                      </div>
                    )}
                    {(b.status === 'CANCELLED' || b.status === 'COMPLETED') && (
                      <div className="flex items-center justify-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2.5 text-xs border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          title="View Stored Details & Cancellation History"
                          onClick={() => setViewDetailsBooking(b)}
                        >
                          <Eye className="h-3.5 w-3.5" /> Details
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="Delete Record (Admin PIN Required)"
                          onClick={() => setDeleteTargetBooking(b)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
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

      <GenerateBillDialog
        open={!!billBooking}
        onOpenChange={(o) => !o && setBillBooking(null)}
        booking={billBooking as any}
        defaultGstPercent={hotelSettings.gstPercent}
        onSuccess={(bill) => {
          setBillBooking(null)
          load()
          onDataChanged()
          toast({
            variant: 'success',
            title: 'Checked Out',
            description: `Invoice ${bill.billNumber} generated. Print it from the Billing tab.`,
          })
        }}
      />

      {/* Extend stay dialog (Admin PIN authorized) */}
      <Dialog open={!!extendBooking} onOpenChange={(o) => { if (!o) setExtendBooking(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-emerald-600" />
              Manual Stay Extension
            </DialogTitle>
            <DialogDescription>
              {extendBooking?.guest?.name} · Room {extendBooking?.room?.number} · Current Check-Out:{' '}
              {formatDateTime(extendBooking?.checkOut)}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3.5 pt-1">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <Label htmlFor="ext-date" className="text-xs font-semibold">New Check-Out Date *</Label>
                <Input
                  id="ext-date"
                  type="date"
                  value={newDate}
                  min={extendBooking ? istDateStr(new Date(extendBooking.checkIn)) : ''}
                  onChange={(e) => {
                    const d = e.target.value
                    setNewDate(d)
                    if (extendBooking && d) {
                      setNewDays(calcNights(extendBooking.checkIn, d))
                    }
                  }}
                  className="h-9 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ext-time" className="text-xs font-semibold">New Check-Out Time *</Label>
                <Input
                  id="ext-time"
                  type="time"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="ext-days" className="text-xs font-semibold">Billable Days *</Label>
              <Input
                id="ext-days"
                type="number"
                min="1"
                value={newDays}
                onChange={(e) => setNewDays(e.target.value)}
                className="h-9 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Prefilled by calendar nights calculation. Can be adjusted if needed.
              </p>
            </div>

            <div className="space-y-1">
              <Label htmlFor="ext-reason" className="text-xs font-semibold">Reason for Extension *</Label>
              <Input
                id="ext-reason"
                placeholder="e.g. Guest requested 1 more night, flight delayed..."
                value={extendReason}
                onChange={(e) => setExtendReason(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="ext-pin" className="text-xs font-semibold flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <ShieldAlert className="h-3.5 w-3.5" /> Admin PIN (Required) *
              </Label>
              <Input
                id="ext-pin"
                type="password"
                inputMode="numeric"
                placeholder="Enter Admin PIN"
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                className="h-9 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                Manual stay extensions require authorization from an administrator.
              </p>
            </div>

            {extendError && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive flex items-start gap-1.5">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{extendError}</span>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2 border-t">
              <Button
                variant="outline"
                className="flex-1 h-9 text-xs"
                onClick={() => setExtendBooking(null)}
                disabled={extendSaving}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-9 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={extendSaving}
                onClick={handleExtendSubmit}
              >
                {extendSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                Confirm Extension
              </Button>
            </div>
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

      {/* Edit Booking Details Modal */}
      <Dialog open={!!editModalBooking} onOpenChange={(o) => !o && setEditModalBooking(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4 text-emerald-600" />
              <span>Edit Booking — Room {editModalBooking?.room?.number}</span>
            </DialogTitle>
            <DialogDescription>
              Update guest contact info, daily room rate, or recorded advance.
            </DialogDescription>
          </DialogHeader>

          {editModalBooking && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="space-y-1">
                  <Label htmlFor="edit-name" className="text-xs">Guest Name</Label>
                  <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} className="h-9 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-phone" className="text-xs">Phone Number</Label>
                  <Input id="edit-phone" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="h-9 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-rate" className="text-xs">Rate / Night (₹)</Label>
                  <Input id="edit-rate" type="number" value={editRate} onChange={(e) => setEditRate(e.target.value)} className="h-9 text-xs" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="edit-adv" className="text-xs">Advance Amount (₹)</Label>
                  <Input id="edit-adv" type="number" value={editAdvance} onChange={(e) => setEditAdvance(e.target.value)} className="h-9 text-xs" />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setEditModalBooking(null)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                  disabled={savingEdit}
                  onClick={handleSaveEdit}
                >
                  {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save Changes
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Cancel Booking Dialog */}
      <Dialog open={!!cancelModalBooking} onOpenChange={(o) => !o && setCancelModalBooking(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <XCircle className="h-5 w-5 text-amber-600" />
              <span>Cancel Booking — Room {cancelModalBooking?.room?.number}</span>
            </DialogTitle>
            <DialogDescription>
              Cancelling will release Room {cancelModalBooking?.room?.number} and store all original booking details along with the cancellation date and reason in the permanent archive.
            </DialogDescription>
          </DialogHeader>

          {cancelModalBooking && (
            <div className="space-y-4">
              {/* Original Booking Summary Card */}
              <div className="rounded-lg border bg-muted/40 p-3 text-xs space-y-1.5">
                <div className="font-semibold text-foreground flex items-center justify-between">
                  <span>{cancelModalBooking.guest?.name || 'Guest'}</span>
                  <Badge variant="outline">{cancelModalBooking.status}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-muted-foreground">
                  <div>📞 Phone: <span className="text-foreground">{cancelModalBooking.guest?.phone || '—'}</span></div>
                  <div>🚪 Room: <span className="text-foreground">Room {cancelModalBooking.room?.number}</span></div>
                  <div>📅 Check-in: <span className="text-foreground">{formatDate(cancelModalBooking.checkIn)}</span></div>
                  <div>📅 Check-out: <span className="text-foreground">{formatDate(cancelModalBooking.checkOut)} ({cancelModalBooking.days}n)</span></div>
                  <div>💰 Rate: <span className="text-foreground">{formatINR(cancelModalBooking.ratePerDay)}/night</span></div>
                  <div>💵 Advance Paid: <span className="font-semibold text-emerald-600">{formatINR(cancelModalBooking.advance || 0)}</span></div>
                </div>
              </div>

              {/* Cancellation Details Form */}
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="cancel-reason" className="text-xs font-semibold">Reason for Cancellation</Label>
                  <Select value={cancelReason} onValueChange={setCancelReason}>
                    <SelectTrigger id="cancel-reason" className="h-8 text-xs">
                      <SelectValue placeholder="Select reason" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Customer change of plans">Customer change of plans</SelectItem>
                      <SelectItem value="Customer travel rescheduled">Customer travel rescheduled</SelectItem>
                      <SelectItem value="Customer emergency/medical">Customer emergency / medical</SelectItem>
                      <SelectItem value="Booking error / duplicate">Booking error / duplicate</SelectItem>
                      <SelectItem value="No show / Unreachable">No show / Unreachable</SelectItem>
                      <SelectItem value="Price / Room type issue">Price / Room type issue</SelectItem>
                      <SelectItem value="Other reason">Other reason</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {cancelModalBooking.advance > 0 && (
                  <div className="rounded border border-amber-200 bg-amber-50/50 p-2.5 dark:border-amber-900/50 dark:bg-amber-950/20 space-y-2 text-xs">
                    <p className="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1">
                      <Wallet className="h-3.5 w-3.5" /> Advance Settlement / Refund
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="refund-amount" className="text-[11px]">Refund Amount (₹)</Label>
                        <Input
                          id="refund-amount"
                          type="number"
                          placeholder="e.g. 1000"
                          value={refundAmount}
                          onChange={(e) => setRefundAmount(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="refund-note" className="text-[11px]">Settlement Note</Label>
                        <Input
                          id="refund-note"
                          placeholder="e.g. Full refund via UPI / Retained"
                          value={refundNote}
                          onChange={(e) => setRefundNote(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}

                <div className="rounded bg-blue-50/70 p-2 text-[11px] text-blue-800 dark:bg-blue-950/30 dark:text-blue-300 flex items-start gap-1.5">
                  <Info className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>Cancellation timestamp ({formatDateTime(new Date().toISOString())}), staff details, and original booking stay info will be permanently stored in the audit logs.</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setCancelModalBooking(null)} disabled={cancellingBooking}>
                  Keep Booking
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                  disabled={cancellingBooking}
                  onClick={handleConfirmCancel}
                >
                  {cancellingBooking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                  Confirm Cancellation
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* View Booking Details & Cancellation History Dialog */}
      <Dialog open={!!viewDetailsBooking} onOpenChange={(o) => !o && setViewDetailsBooking(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between pr-4">
              <span className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-blue-600" />
                <span>Booking Record — Room {viewDetailsBooking?.room?.number}</span>
              </span>
              <Badge
                variant="outline"
                className={
                  viewDetailsBooking?.status === 'CANCELLED'
                    ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300 font-semibold'
                    : ''
                }
              >
                {viewDetailsBooking?.status}
              </Badge>
            </DialogTitle>
            <DialogDescription>
              {viewDetailsBooking?.status === 'CANCELLED'
                ? `Cancelled on ${formatDateTime(viewDetailsBooking?.actualCheckOut || viewDetailsBooking?.updatedAt)}`
                : `Booked on ${formatDateTime(viewDetailsBooking?.createdAt)}`}
            </DialogDescription>
          </DialogHeader>

          {viewDetailsBooking && (
            <div className="space-y-4 text-xs">
              {/* Cancellation Highlight Banner */}
              {viewDetailsBooking.status === 'CANCELLED' && (
                <div className="rounded-lg border border-red-200 bg-red-50/80 p-3 dark:border-red-900/50 dark:bg-red-950/30 space-y-1 text-red-900 dark:text-red-200">
                  <div className="flex items-center gap-1.5 font-semibold text-xs">
                    <XCircle className="h-4 w-4 text-red-600" />
                    <span>Booking Was Cancelled</span>
                  </div>
                  <div className="text-[11px]">
                    <span className="font-medium">Cancellation Date &amp; Time:</span> {formatDateTime(viewDetailsBooking.actualCheckOut || viewDetailsBooking.updatedAt)}
                  </div>
                </div>
              )}

              {/* Guest Details */}
              <div className="rounded-lg border bg-card p-3 space-y-2">
                <p className="font-semibold text-foreground text-xs">Guest Information</p>
                <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                  <div>Name: <span className="font-medium text-foreground">{viewDetailsBooking.guest?.name || '—'}</span></div>
                  <div>Phone: <span className="font-medium text-foreground">{viewDetailsBooking.guest?.phone || '—'}</span></div>
                  {viewDetailsBooking.guest?.company && (
                    <div>Company: <span className="font-medium text-foreground">{viewDetailsBooking.guest.company}</span></div>
                  )}
                  {viewDetailsBooking.guest?.gst && (
                    <div>GST: <span className="font-medium text-foreground">{viewDetailsBooking.guest.gst}</span></div>
                  )}
                  {viewDetailsBooking.guest?.email && (
                    <div>Email: <span className="font-medium text-foreground">{viewDetailsBooking.guest.email}</span></div>
                  )}
                  {viewDetailsBooking.guest?.address && (
                    <div className="col-span-2">Address: <span className="font-medium text-foreground">{viewDetailsBooking.guest.address}</span></div>
                  )}
                </div>
              </div>

              {/* Stay & Room Details */}
              <div className="rounded-lg border bg-card p-3 space-y-2">
                <p className="font-semibold text-foreground text-xs">Reservation Details</p>
                <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                  <div>Room Number: <span className="font-medium text-foreground">Room {viewDetailsBooking.room?.number}</span></div>
                  <div>Room Type: <span className="font-medium text-foreground">{viewDetailsBooking.room?.type || 'Standard'}</span></div>
                  <div>Check-in: <span className="font-medium text-foreground">{formatDate(viewDetailsBooking.checkIn)}</span></div>
                  <div>Check-out: <span className="font-medium text-foreground">{formatDate(viewDetailsBooking.checkOut)} ({viewDetailsBooking.days} nights)</span></div>
                  <div>Rate / Night: <span className="font-medium text-foreground">{formatINR(viewDetailsBooking.ratePerDay)}</span></div>
                  <div>Total Est. Room Charge: <span className="font-medium text-foreground">{formatINR(viewDetailsBooking.ratePerDay * viewDetailsBooking.days)}</span></div>
                  <div>Advance Paid: <span className="font-semibold text-emerald-600">{formatINR(viewDetailsBooking.advance || 0)}</span></div>
                  <div>Corporate Booking: <span className="font-medium text-foreground">{viewDetailsBooking.isCorporate ? 'Yes' : 'No'}</span></div>
                  <div>Booking Created: <span className="font-medium text-foreground">{formatDateTime(viewDetailsBooking.createdAt)}</span></div>
                </div>
              </div>

              {/* Notes & Cancellation History */}
              {viewDetailsBooking.notes && (
                <div className="rounded-lg border bg-card p-3 space-y-1.5">
                  <p className="font-semibold text-foreground text-xs">Notes &amp; Activity Log</p>
                  <div className="rounded bg-muted/50 p-2 font-mono text-[11px] whitespace-pre-wrap text-foreground">
                    {viewDetailsBooking.notes}
                  </div>
                </div>
              )}

              {/* Extension History */}
              {viewDetailsBooking.extensions && viewDetailsBooking.extensions.length > 0 && (
                <div className="rounded-lg border bg-card p-3 space-y-2">
                  <p className="flex items-center gap-1.5 font-semibold text-xs text-foreground">
                    <History className="h-3.5 w-3.5 text-blue-600" /> Extension History
                  </p>
                  <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                    {viewDetailsBooking.extensions.map((ext) => (
                      <div key={ext.id} className="rounded border bg-muted/30 p-2 text-xs space-y-1">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="text-[10px]">
                            {ext.type === 'AUTO' ? '⚡ Automatic' : '🛡️ Manual'}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">{formatDateTime(ext.createdAt)}</span>
                        </div>
                        <div className="text-[11px]">
                          {formatDateTime(ext.fromCheckOut)} → <span className="font-semibold">{formatDateTime(ext.toCheckOut)}</span>
                        </div>
                        {ext.reason && <div className="text-[10px] italic text-muted-foreground">&quot;{ext.reason}&quot;</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setViewDetailsBooking(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Admin PIN Protected Delete Booking Dialog */}
      <AdminDeleteDialog
        open={!!deleteTargetBooking}
        onOpenChange={(open) => !open && setDeleteTargetBooking(null)}
        title="Delete Booking Record"
        itemType="Booking"
        itemName={deleteTargetBooking ? `Booking for ${deleteTargetBooking.guest?.name || 'Guest'} (Room ${deleteTargetBooking.room?.number || ''})` : ''}
        warningNotice="This permanently deletes the booking record and any associated bills/orders. Admin authorization required."
        onConfirm={async (pin) => {
          if (!deleteTargetBooking) return
          const res = await apiAs<{ success?: boolean; error?: string }>(
            `/api/bookings?id=${deleteTargetBooking.id}`,
            getCachedUser(),
            { method: 'DELETE', adminPin: pin }
          )
          if (res && res.error) {
            throw new Error(res.error)
          }
          setDeleteTargetBooking(null)
          toast({ variant: 'success', title: 'Deleted', description: 'Booking permanently deleted.' })
          await load()
          onDataChanged()
        }}
      />
    </div>
  )
}
