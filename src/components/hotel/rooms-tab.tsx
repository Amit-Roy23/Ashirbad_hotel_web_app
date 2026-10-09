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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { CheckinDialog } from './checkin-dialog'
import { GenerateBillDialog, type Bill } from './generate-bill-dialog'
import { EditBillDialog } from './edit-bill-dialog'
import { RoomFoodBillDialog } from './room-food-bill-dialog'
import { PrintableInvoice } from './printable-invoice'
import { triggerPrintInvoice, triggerPrintAdvanceReceipt } from '@/lib/print-invoice'
import { BookingDialog } from './booking-dialog'
import { RoomStatusBadge } from './status-badge'
import { TableControls } from './table-controls'
import { Separator } from '@/components/ui/separator'
import { api, apiAs, formatINR, formatDate, formatDateTime, getRoomOperationalState, todayStr, addDays, toDateStr } from '@/lib/hotel-utils'
import { nextAutoExtensionAt } from '@/lib/stay'
import { getCachedUser } from './user-context'
import { toast } from '@/hooks/use-toast'
import {
  Loader2,
  Plus,
  BrushCleaning,
  Wrench,
  BedDouble,
  Printer,
  Wallet,
  Trash2,
  Receipt,
  Building2,
  Edit3,
  LogIn,
  CalendarCheck,
  DoorOpen,
  CalendarDays,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  CalendarPlus,
  Sparkles,
  AlertTriangle,
  Clock,
  Utensils,
} from 'lucide-react'

interface Guest {
  id: string
  name: string
  phone: string
  company?: string | null
}

interface Booking {
  id: string
  checkIn: string
  checkOut?: string | null
  originalCheckOut?: string | null
  autoExtendedDays?: number
  days: number
  guest: Guest
  advance: number
  ratePerDay?: number
  guestCount?: number
  status?: string
}

interface Room {
  id: string
  number: string
  floor?: string | null
  type: string
  capacity: number
  rate: number
  status: string
  housekeeping: string
  notes?: string | null
  bookings: Booking[]
}

const TYPES = ['Non-AC', 'AC', 'Deluxe AC', 'Suite']

interface TabProps {
  refreshKey: number
  onDataChanged: () => void
  initialFilter?: string
  onNavigate?: (target: { tab: string; q?: string }) => void
}

export function RoomsTab({ refreshKey, onDataChanged, initialFilter, onNavigate }: TabProps) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [search, setSearch] = useState('')
  const [floor, setFloor] = useState('ALL')
  const [type, setType] = useState('ALL')
  const [status, setStatus] = useState('ALL')

  const [checkinRoom, setCheckinRoom] = useState<Room | null>(null)
  const [viewRoom, setViewRoom] = useState<Room | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteRoomId, setDeleteRoomId] = useState('')
  const [newNumber, setNewNumber] = useState('')
  const [newFloor, setNewFloor] = useState('1')
  const [newType, setNewType] = useState('Non-AC')
  const [newRate, setNewRate] = useState('800')
  const [newCapacity, setNewCapacity] = useState('2')
  const [billBooking, setBillBooking] = useState<any | null>(null)
  const [lastBill, setLastBill] = useState<Bill | null>(null)
  const [editBill, setEditBill] = useState<Bill | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'calendar'>('grid')
  const [calendarStartDate, setCalendarStartDate] = useState<string>(todayStr())
  const [bookingDialogState, setBookingDialogState] = useState<{
    open: boolean
    roomId?: string
    initialCheckInDate?: string
  } | null>(null)
  const [foodBillState, setFoodBillState] = useState<{
    open: boolean
    roomId?: string
    roomNumber?: string
    bookingId?: string
    guestName?: string
  } | null>(null)

  useEffect(() => {
    if (initialFilter) setSearch(initialFilter)
  }, [initialFilter])

  const calendarDates = useMemo(() => {
    const dates: { dateStr: string; label: string; dayName: string; isToday: boolean }[] = []
    const today = todayStr()
    for (let i = 0; i < 14; i++) {
      const dStr = addDays(i, calendarStartDate)
      const d = new Date(dStr + 'T00:00:00')
      const dayName = d.toLocaleDateString('en-IN', { weekday: 'short' })
      const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      dates.push({
        dateStr: dStr,
        label,
        dayName,
        isToday: dStr === today,
      })
    }
    return dates
  }, [calendarStartDate])

  const load = useCallback(async () => {
    try {
      const [rData, sData] = await Promise.all([
        api<Room[]>('/api/rooms'),
        api<Record<string, string>>('/api/settings'),
      ])
      setRooms(rData)
      setSettings(sData)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const floors = useMemo(() => [...new Set(rooms.map((r) => r.floor || r.number.charAt(0)))].sort(), [rooms])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rooms.filter((r) => {
      const opState = getRoomOperationalState(r)
      const allGuestInfo = (r.bookings || [])
        .map((b) => `${b.guest?.name || ''} ${b.guest?.phone || ''} ${b.guest?.company || ''}`)
        .join(' ')
      if (q && !`${r.number} ${r.type} ${allGuestInfo} ${opState.nextFutureBooking?.guest?.name || ''} ${opState.nextFutureBooking?.guest?.phone || ''}`.toLowerCase().includes(q)) return false
      if (floor !== 'ALL' && (r.floor ? r.floor !== floor : !r.number.startsWith(floor))) return false
      if (type !== 'ALL' && r.type !== type) return false
      if (status !== 'ALL') {
        if (status === 'BOOKED') {
          if (opState.displayStatus !== 'BOOKED') return false
        } else if (status === 'VACANT_WITH_FUTURE') {
          if (opState.displayStatus !== 'VACANT_WITH_FUTURE') return false
        } else if (status === 'DIRTY') {
          if (opState.displayStatus !== 'DIRTY') return false
        } else if (status === 'VACANT') {
          if (opState.displayStatus !== 'VACANT' && opState.displayStatus !== 'VACANT_WITH_FUTURE') return false
        } else if (status === 'OCCUPIED') {
          if (opState.displayStatus !== 'OCCUPIED') return false
        } else if (status === 'MAINTENANCE') {
          if (opState.displayStatus !== 'MAINTENANCE') return false
        }
      }
      return true
    })
  }, [rooms, search, floor, type, status])

  // Header counts use the same derived state as the room cards so the two never disagree
  const statusCounts = useMemo(() => {
    const counts = { VACANT: 0, VACANT_WITH_FUTURE: 0, BOOKED: 0, OCCUPIED: 0, DIRTY: 0, MAINTENANCE: 0 }
    for (const r of rooms) counts[getRoomOperationalState(r).displayStatus]++
    return counts
  }, [rooms])

  const grouped = useMemo(() => {
    return filtered.reduce<Record<string, Room[]>>((acc, room) => {
      const f = room.floor || room.number.charAt(0)
      if (!acc[f]) acc[f] = []
      acc[f].push(room)
      return acc
    }, {})
  }, [filtered])

  function resetFilters() {
    setSearch('')
    setFloor('ALL')
    setType('ALL')
    setStatus('ALL')
  }

  async function patchRoom(room: Room, data: Record<string, unknown>) {
    setBusy(true)
    try {
      const res = await apiAs<{ error?: string }>('/api/rooms', getCachedUser(), {
        method: 'PATCH',
        body: JSON.stringify({ id: room.id, ...data }),
      })
      if (res && res.error) {
        toast({
          variant: 'destructive',
          title: 'Update Failed',
          description: res.error,
        })
        return
      }

      await load()
      onDataChanged()

      if (data.housekeeping === 'CLEAN' && (!data.status || data.status === 'VACANT')) {
        toast({
          variant: 'success',
          title: 'Room Marked Clean',
          description: `Room ${room.number} is clean and ready for check-in.`,
        })
        setViewRoom(null)
      } else if (data.status) {
        const isMaint = data.status === 'MAINTENANCE'
        toast({
          variant: 'success',
          title: 'Room Status Updated',
          description: `Room ${room.number} is now marked ${isMaint ? 'Under Maintenance' : 'Vacant'}.`,
        })
        setViewRoom(null)
      } else if (data.rate !== undefined) {
        toast({
          variant: 'success',
          title: 'Rate Updated',
          description: `Room ${room.number} rate updated to ${formatINR(Number(data.rate))}/night.`,
        })
        setViewRoom((prev) => (prev ? ({ ...prev, ...data } as Room) : null))
      } else if (data.type !== undefined) {
        toast({
          variant: 'success',
          title: 'Room Type Updated',
          description: `Room ${room.number} type updated to ${data.type}.`,
        })
        setViewRoom((prev) => (prev ? ({ ...prev, ...data } as Room) : null))
      }
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: e instanceof Error ? e.message : 'Could not update room',
      })
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteRoom(roomId: string, roomNum?: string) {
    if (!roomId) return
    const targetRoom = rooms.find((r) => r.id === roomId)
    const num = roomNum || targetRoom?.number || ''
    if (!confirm(`Are you sure you want to delete Room ${num}?`)) return
    
    // Instant optimistic update
    setRooms((prev) => prev.filter((r) => r.id !== roomId))
    setViewRoom(null)
    setDeleteOpen(false)
    setDeleteRoomId('')
    
    setBusy(true)
    try {
      const res = await apiAs<{ success?: boolean; error?: string }>(
        `/api/rooms?id=${roomId}`,
        getCachedUser(),
        { method: 'DELETE' }
      )
      if (res && res.error) {
        toast({
          variant: 'destructive',
          title: 'Delete Failed',
          description: res.error,
        })
        await load()
      } else {
        toast({
          variant: 'success',
          title: 'Room Deleted',
          description: `Room ${num} has been deleted.`,
        })
        onDataChanged()
      }
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: e instanceof Error ? e.message : 'Could not delete room',
      })
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function addRoom() {
    const cleanNum = newNumber.replace(/\D/g, '').trim()
    if (!cleanNum) return
    const cap = parseInt(newCapacity) || 2
    if (cap < 1 || cap > 4) {
      toast({
        variant: 'destructive',
        title: 'Invalid Capacity',
        description: 'Room capacity must be between 1 and 4 guests.',
      })
      return
    }
    setBusy(true)
    try {
      const res = await apiAs<{ error?: string }>('/api/rooms', getCachedUser(), {
        method: 'POST',
        body: JSON.stringify({
          number: cleanNum,
          floor: newFloor.trim() || cleanNum.charAt(0) || '1',
          type: newType,
          rate: newRate,
          capacity: newCapacity,
        }),
      })
      if (res && res.error) {
        toast({
          variant: 'destructive',
          title: 'Add Room Failed',
          description: res.error,
        })
        return
      }
      setAddOpen(false)
      setNewNumber('')
      setNewFloor('1')
      await load()
      onDataChanged()
      toast({
        variant: 'success',
        title: 'Room Added',
        description: `Room ${cleanNum} has been added successfully.`,
      })
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: e instanceof Error ? e.message : 'Could not add room',
      })
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Rooms</h2>
          <p className="text-xs text-muted-foreground">
            {statusCounts.VACANT + statusCounts.VACANT_WITH_FUTURE} vacant ·{' '}
            {statusCounts.BOOKED} booked ·{' '}
            {statusCounts.OCCUPIED} occupied ·{' '}
            {statusCounts.DIRTY} to clean ·{' '}
            {statusCounts.MAINTENANCE} maintenance
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex items-center rounded-lg border bg-muted/40 p-0.5">
            <Button
              size="sm"
              variant={viewMode === 'grid' ? 'default' : 'ghost'}
              className="h-8 gap-1.5 px-2.5 text-xs font-medium"
              onClick={() => setViewMode('grid')}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Grid View
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'calendar' ? 'default' : 'ghost'}
              className="h-8 gap-1.5 px-2.5 text-xs font-medium"
              onClick={() => setViewMode('calendar')}
            >
              <CalendarDays className="h-3.5 w-3.5" /> 📅 Schedule View
            </Button>
          </div>

          <Button variant="outline" className="gap-2" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add Room
          </Button>
          <Button
            variant="outline"
            className="gap-2 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" /> Delete Room
          </Button>
        </div>
      </div>

      <TableControls
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Room number, type, guest…"
        filters={[
          { key: 'floor', label: 'Floor', options: floors.map((f) => ({ value: f, label: `Floor ${f}` })) },
          { key: 'type', label: 'Type', options: [...new Set(rooms.map((r) => r.type))].map((t) => ({ value: t, label: t })) },
          {
            key: 'status',
            label: 'Status',
            options: [
              { value: 'VACANT', label: 'Vacant (Clean / Available)' },
              { value: 'BOOKED', label: 'Booked (Due Today)' },
              { value: 'VACANT_WITH_FUTURE', label: 'Vacant (Upcoming Reservation)' },
              { value: 'DIRTY', label: 'Dirty (To Clean)' },
              { value: 'OCCUPIED', label: 'Occupied' },
              { value: 'MAINTENANCE', label: 'Maintenance' },
            ],
          },
        ]}
        filterValues={{ floor, type, status }}
        onFilterChange={(k, v) => {
          if (k === 'floor') setFloor(v)
          if (k === 'type') setType(v)
          if (k === 'status') setStatus(v)
        }}
        onReset={resetFilters}
      />

      {viewMode === 'grid' ? (
        Object.entries(grouped).map(([f, floorRooms]) => (
          <div key={f}>
            <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Floor {f}</h3>
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-10">
              {floorRooms.map((room) => {
                const opState = getRoomOperationalState(room)
                const borderCls =
                  opState.displayStatus === 'OCCUPIED'
                    ? 'border-red-300 bg-red-50 hover:border-red-400 dark:border-red-800 dark:bg-red-950/40'
                    : opState.displayStatus === 'BOOKED'
                      ? 'border-amber-400 bg-amber-50/90 hover:border-amber-500 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/60'
                      : opState.displayStatus === 'VACANT_WITH_FUTURE'
                        ? 'border-emerald-400 bg-gradient-to-b from-emerald-50 to-amber-50/40 hover:border-emerald-500 hover:bg-emerald-100/90 dark:border-emerald-700 dark:from-emerald-950/60 dark:to-amber-950/30'
                        : opState.displayStatus === 'DIRTY'
                          ? 'border-orange-300 bg-orange-50 hover:border-orange-400 dark:border-orange-800 dark:bg-orange-950/40'
                          : opState.displayStatus === 'MAINTENANCE'
                            ? 'border-zinc-300 bg-zinc-50 hover:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-800/60'
                            : 'border-emerald-300 bg-emerald-50 hover:border-emerald-400 dark:border-emerald-800 dark:bg-emerald-950/40'

                return (
                  <button
                    key={room.id}
                    onClick={() => {
                      if (opState.displayStatus === 'VACANT') {
                        setCheckinRoom(room)
                      } else {
                        setViewRoom(room)
                      }
                    }}
                    className={`min-h-[92px] rounded-xl border-2 p-2.5 text-left transition-all active:scale-95 hover:shadow-md ${borderCls}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-base font-bold">{room.number}</span>
                      {opState.hasFutureBooking ? (
                        <span className="rounded bg-amber-200/90 px-1 py-0.5 text-[9px] font-bold text-amber-950 dark:bg-amber-900 dark:text-amber-200">
                          {opState.availableUntilFormatted ? `Till ${opState.availableUntilFormatted.slice(0, 6)}` : 'Reserved'}
                        </span>
                      ) : (
                        <BedDouble className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{room.type}</p>
                    {opState.displayStatus === 'OCCUPIED' && opState.activeBooking ? (
                      <div className="mt-1">
                        <p className="truncate text-[10px] font-semibold text-red-700 dark:text-red-400">
                          {opState.activeBooking.guest?.name || 'Guest'}
                        </p>
                        {opState.hasFutureBooking && (
                          <p className="truncate text-[9px] font-medium text-amber-800 dark:text-amber-300">
                            Next: {opState.nextFutureBooking?.guest?.name?.split(' ')[0]} ({opState.availableUntilFormatted?.slice(0, 6)})
                          </p>
                        )}
                      </div>
                    ) : opState.displayStatus === 'BOOKED' ? (
                      <p className="mt-1 truncate text-[10px] font-semibold text-amber-900 dark:text-amber-200">
                        Booked: {opState.todayBooking?.guest?.name || 'Guest'} (Today)
                      </p>
                    ) : opState.displayStatus === 'VACANT_WITH_FUTURE' ? (
                      <div className="mt-1">
                        <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                          {formatINR(room.rate)} · Vacant
                        </p>
                        <p className="truncate text-[9px] font-medium text-amber-800 dark:text-amber-300">
                          Next: {opState.nextFutureBooking?.guest?.name?.split(' ')[0]} ({opState.availableUntilFormatted?.slice(0, 6)})
                        </p>
                      </div>
                    ) : opState.displayStatus === 'DIRTY' ? (
                      <p className="mt-1 text-[10px] font-semibold text-orange-700 dark:text-orange-400">To Clean</p>
                    ) : (
                      <p className="mt-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">{formatINR(room.rate)} · Vacant</p>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))
      ) : (
        /* 📅 14-Day Timeline / Schedule Calendar View */
        <div className="space-y-3 rounded-xl border bg-card p-4 shadow-sm">
          {/* Calendar Toolbar & Legend */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 px-2.5 text-xs"
                onClick={() => setCalendarStartDate((prev) => addDays(-7, prev))}
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Prev 7 Days
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs font-semibold"
                onClick={() => setCalendarStartDate(todayStr())}
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1 px-2.5 text-xs"
                onClick={() => setCalendarStartDate((prev) => addDays(7, prev))}
              >
                Next 7 Days <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs font-medium text-muted-foreground ml-2">
                Showing 14 days: <b>{calendarDates[0]?.label}</b> – <b>{calendarDates[13]?.label}</b>
              </span>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-red-500/80 inline-block" />
                <span className="text-muted-foreground">Occupied</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-amber-400 inline-block" />
                <span className="text-muted-foreground">Advance Booked</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-emerald-400 inline-block" />
                <span className="text-muted-foreground">Available</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-sky-400 inline-block" />
                <span className="text-muted-foreground">Checkout / Bookable</span>
              </div>
            </div>
          </div>

          {/* Schedule Table */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="sticky left-0 z-20 min-w-[130px] bg-background/95 p-2 font-semibold text-foreground backdrop-blur shadow-sm">
                    Room
                  </th>
                  {calendarDates.map((cd) => (
                    <th
                      key={cd.dateStr}
                      className={`min-w-[84px] p-2 text-center border-l ${
                        cd.isToday ? 'bg-emerald-100/70 dark:bg-emerald-950/60 font-bold text-emerald-950 dark:text-emerald-200' : 'text-muted-foreground'
                      }`}
                    >
                      <div className="text-[10px] uppercase tracking-wider">{cd.dayName}</div>
                      <div className={`text-xs font-bold ${cd.isToday ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground'}`}>
                        {cd.label}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((room) => {
                  return (
                    <tr key={room.id} className="border-b hover:bg-muted/20 transition-colors">
                      {/* Room Header Cell */}
                      <td className="sticky left-0 z-10 bg-background/95 p-2 border-r backdrop-blur shadow-sm">
                        <button
                          type="button"
                          onClick={() => setViewRoom(room)}
                          className="text-left group flex flex-col"
                        >
                          <span className="font-bold text-sm text-foreground group-hover:text-emerald-600 transition-colors">
                            Room {room.number}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {room.type} • {formatINR(room.rate)}
                          </span>
                        </button>
                      </td>

                      {/* Date Cells */}
                      {calendarDates.map((cd) => {
                        const dateStr = cd.dateStr

                        // Check active booking on dateStr
                        const activeOnDate = (room.bookings || []).find((b) => {
                          if (b.status !== 'ACTIVE') return false
                          const inStr = toDateStr(b.checkIn)
                          const outStr = b.checkOut ? toDateStr(b.checkOut) : null
                          return inStr <= dateStr && (!outStr || outStr > dateStr)
                        })

                        // Check advance reservation on dateStr
                        const bookedOnDate = (room.bookings || []).find((b) => {
                          if (b.status !== 'BOOKED') return false
                          const inStr = toDateStr(b.checkIn)
                          const outStr = b.checkOut ? toDateStr(b.checkOut) : null
                          return inStr <= dateStr && (outStr ? outStr > dateStr : inStr === dateStr)
                        })

                        // Check checkout happening on dateStr
                        const checkingOutOnDate = (room.bookings || []).find((b) => {
                          if (b.status !== 'ACTIVE' && b.status !== 'BOOKED') return false
                          return b.checkOut && toDateStr(b.checkOut) === dateStr
                        })

                        // Check new check-in starting on dateStr
                        const checkingInOnDate = (room.bookings || []).find((b) => {
                          if (b.status !== 'ACTIVE' && b.status !== 'BOOKED') return false
                          return toDateStr(b.checkIn) === dateStr
                        })

                        if (activeOnDate) {
                          return (
                            <td key={dateStr} className="p-1 border-l text-center">
                              <button
                                type="button"
                                onClick={() => setViewRoom(room)}
                                className="w-full h-11 rounded bg-red-100 dark:bg-red-950/60 border border-red-300 dark:border-red-800 p-1 text-[10px] font-semibold text-red-800 dark:text-red-300 flex flex-col items-center justify-center hover:opacity-90 transition-opacity"
                                title={`Occupied by ${activeOnDate.guest?.name || 'Guest'} (Checkout: ${formatDate(activeOnDate.checkOut)})`}
                              >
                                <span className="truncate w-full font-bold">{activeOnDate.guest?.name?.split(' ')[0] || 'Guest'}</span>
                                <span className="text-[9px] opacity-80">Occupied</span>
                              </button>
                            </td>
                          )
                        }

                        if (bookedOnDate) {
                          return (
                            <td key={dateStr} className="p-1 border-l text-center">
                              <button
                                type="button"
                                onClick={() => setViewRoom(room)}
                                className="w-full h-11 rounded bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 p-1 text-[10px] font-semibold text-amber-900 dark:text-amber-200 flex flex-col items-center justify-center hover:opacity-90 transition-opacity"
                                title={`Reserved for ${bookedOnDate.guest?.name || 'Guest'} (Out: ${formatDate(bookedOnDate.checkOut)})`}
                              >
                                <span className="truncate w-full font-bold">{bookedOnDate.guest?.name?.split(' ')[0] || 'Guest'}</span>
                                <span className="text-[9px] opacity-80">Reserved</span>
                              </button>
                            </td>
                          )
                        }

                        if (checkingOutOnDate && !checkingInOnDate) {
                          return (
                            <td key={dateStr} className="p-1 border-l text-center">
                              <button
                                type="button"
                                onClick={() => {
                                  setBookingDialogState({
                                    open: true,
                                    roomId: room.id,
                                    initialCheckInDate: dateStr,
                                  })
                                }}
                                className="w-full h-11 rounded bg-sky-50 dark:bg-sky-950/40 border border-sky-300 dark:border-sky-800 hover:border-sky-500 p-1 text-[10px] font-semibold text-sky-900 dark:text-sky-200 flex flex-col items-center justify-center hover:bg-sky-100 transition-all group"
                                title={`Previous guest checks out today on ${formatDate(dateStr)}. Click to book from ${dateStr} onwards!`}
                              >
                                <span className="text-[9px] text-sky-700 dark:text-sky-300 truncate w-full">
                                  Out: {checkingOutOnDate.guest?.name?.split(' ')[0] || 'Guest'}
                                </span>
                                <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 group-hover:underline">
                                  + Book Now
                                </span>
                              </button>
                            </td>
                          )
                        }

                        if (room.status === 'MAINTENANCE') {
                          return (
                            <td key={dateStr} className="p-1 border-l text-center">
                              <div className="w-full h-11 rounded bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700 p-1 text-[9px] font-medium text-zinc-500 flex items-center justify-center">
                                Maint
                              </div>
                            </td>
                          )
                        }

                        // Available date cell
                        return (
                          <td key={dateStr} className="p-1 border-l text-center">
                            <button
                              type="button"
                              onClick={() => {
                                setBookingDialogState({
                                  open: true,
                                  roomId: room.id,
                                  initialCheckInDate: dateStr,
                                })
                              }}
                              className="w-full h-11 rounded bg-emerald-50/40 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/50 border border-dashed border-emerald-200 hover:border-emerald-500 p-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400 flex flex-col items-center justify-center transition-all group"
                              title={`Room ${room.number} is available on ${formatDate(dateStr)}. Click to book.`}
                            >
                              <span className="opacity-70 group-hover:opacity-100 font-semibold">+ Book</span>
                            </button>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <CheckinDialog
        open={!!checkinRoom}
        onOpenChange={(o) => !o && setCheckinRoom(null)}
        room={checkinRoom}
        onSuccess={async () => {
          const targetRoomId = checkinRoom?.id
          const updatedRooms = await api<Room[]>('/api/rooms')
          setRooms(updatedRooms)
          onDataChanged()
          if (targetRoomId) {
            const freshRoom = updatedRooms.find((r) => r.id === targetRoomId)
            if (freshRoom) {
              setViewRoom(freshRoom)
            }
          }
        }}
      />

      {/* Room detail modal */}
      <Dialog open={!!viewRoom} onOpenChange={(o) => !o && setViewRoom(null)}>
        <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
          {viewRoom && (() => {
            const currentRoom = viewRoom
            const opState = getRoomOperationalState(currentRoom)
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    Room {currentRoom.number}
                    <RoomStatusBadge
                      status={opState.displayStatus}
                      housekeeping={currentRoom.housekeeping}
                      upcomingText={opState.availableUntilFormatted}
                    />
                  </DialogTitle>
                  <DialogDescription>
                    {currentRoom.type} • Max {currentRoom.capacity} guests • {formatINR(currentRoom.rate)}/night
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3">
                  {/* VACANT WITH FUTURE RESERVATION */}
                  {opState.displayStatus === 'VACANT_WITH_FUTURE' && (
                    <div className="space-y-3">
                      <div className="rounded-xl border border-emerald-300 bg-emerald-50/80 p-3.5 space-y-2.5 dark:border-emerald-800 dark:bg-emerald-950/40">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                            <DoorOpen className="h-4 w-4 text-emerald-600" />
                            Vacant &amp; Available for Stay
                          </span>
                          <span className="rounded bg-amber-200/80 px-2 py-0.5 text-[10px] font-bold text-amber-900 dark:bg-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                            Until {opState.availableUntilFormatted}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 dark:text-slate-300">
                          This room is ready right now for walk-in guests or reservations up to <b>{opState.maxNightsAvailable} night{opState.maxNightsAvailable! > 1 ? 's' : ''}</b> (until {opState.availableUntilFormatted}).
                        </p>
                        <div className="pt-2 border-t border-emerald-200/60 dark:border-emerald-800/60 text-xs flex justify-between items-center">
                          <span className="text-muted-foreground">Upcoming Reservation:</span>
                          <span className="font-semibold text-foreground">
                            {opState.nextFutureBooking?.guest?.name} ({formatDate(opState.nextFutureBooking?.checkIn)})
                          </span>
                        </div>
                      </div>

                      {/* Primary Action: Direct Check-In for interim guest */}
                      <Button
                        className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-2 shadow-sm"
                        onClick={() => {
                          setCheckinRoom(currentRoom)
                          setViewRoom(null)
                        }}
                      >
                        <LogIn className="h-4 w-4" />
                        Check-In Walk-In Guest (Max checkout {opState.availableUntilFormatted})
                      </Button>

                      {/* Advance reservation details card */}
                      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs space-y-2 dark:border-amber-900 dark:bg-amber-950/30">
                        <div className="flex items-center justify-between font-semibold text-amber-900 dark:text-amber-200">
                          <span className="flex items-center gap-1.5">
                            <CalendarCheck className="h-3.5 w-3.5 text-amber-600" />
                            Advance Reservation Details
                          </span>
                          <span>{formatINR(opState.nextFutureBooking?.advance || 0)} Advance</span>
                        </div>
                        <div className="grid grid-cols-2 gap-1.5 text-[11px] pt-1 border-t border-amber-200/60 dark:border-amber-800/60">
                          <div>
                            <span className="text-muted-foreground">Guest: </span>
                            <span className="font-semibold">{opState.nextFutureBooking?.guest?.name}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Phone: </span>
                            <span className="font-semibold">{opState.nextFutureBooking?.guest?.phone}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Check-In: </span>
                            <span className="font-semibold">{formatDate(opState.nextFutureBooking?.checkIn)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Check-Out: </span>
                            <span className="font-semibold">{formatDate(opState.nextFutureBooking?.checkOut)}</span>
                          </div>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex-1 text-[11px] h-7 border-amber-300 text-amber-900 dark:border-amber-800 dark:text-amber-200"
                            onClick={() => {
                              if (opState.nextFutureBooking) {
                                triggerPrintAdvanceReceipt(
                                  {
                                    ...opState.nextFutureBooking,
                                    room: { number: currentRoom.number, type: currentRoom.type },
                                  },
                                  settings
                                )
                              }
                            }}
                          >
                            <Printer className="mr-1 h-3 w-3" /> Print Receipt
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-[11px] h-7 text-red-600 border-red-200 hover:bg-red-50"
                            onClick={async () => {
                              if (!opState.nextFutureBooking) return
                              if (!confirm(`Cancel advance reservation for ${opState.nextFutureBooking.guest?.name}?`)) return
                              setBusy(true)
                              try {
                                await apiAs('/api/bookings', getCachedUser(), {
                                  method: 'PATCH',
                                  body: JSON.stringify({ id: opState.nextFutureBooking.id, action: 'cancel' }),
                                })
                                await load()
                                onDataChanged()
                                setViewRoom(null)
                                toast({ variant: 'success', title: 'Booking Cancelled', description: 'Advance booking cancelled.' })
                              } catch (e) {
                                toast({ variant: 'destructive', title: 'Error', description: e instanceof Error ? e.message : 'Failed' })
                              } finally {
                                setBusy(false)
                              }
                            }}
                          >
                            <Trash2 className="mr-1 h-3 w-3" /> Cancel
                          </Button>
                        </div>
                      </div>

                      {/* Post-checkout Availability & Booking Card */}
                      {opState.futureAvailableFromFormatted && (
                        <div className="rounded-xl border border-sky-300 bg-sky-50/70 p-3 text-xs space-y-2 dark:border-sky-800 dark:bg-sky-950/30">
                          <div className="flex items-center justify-between font-semibold text-sky-900 dark:text-sky-200">
                            <span className="flex items-center gap-1.5">
                              <Sparkles className="h-4 w-4 text-sky-600" />
                              Available for Booking (Post-Checkout)
                            </span>
                            <span className="rounded bg-sky-200/80 px-2 py-0.5 text-[10px] font-bold text-sky-900 dark:bg-sky-900 dark:text-sky-200">
                              From {opState.futureAvailableFromFormatted}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-300">
                            Previous guest checkout is on <b>{opState.futureAvailableFromFormatted}</b>. Another guest can book this room starting on or after {opState.futureAvailableFromFormatted}.
                          </p>
                          <Button
                            size="sm"
                            className="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold gap-1.5 shadow-sm"
                            onClick={() => {
                              setBookingDialogState({
                                open: true,
                                roomId: currentRoom.id,
                                initialCheckInDate: opState.futureAvailableFromDate || undefined,
                              })
                              setViewRoom(null)
                            }}
                          >
                            <CalendarPlus className="h-3.5 w-3.5" />
                            Book Room (From {opState.futureAvailableFromFormatted})
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Advance Booked Room details (DUE TODAY) */}
                  {opState.displayStatus === 'BOOKED' && opState.todayBooking && (
                    <div className="space-y-3">
                      <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                        <div className="flex items-center justify-between border-b border-amber-200/60 pb-1.5 dark:border-amber-800/60">
                          <span className="font-bold text-amber-900 dark:text-amber-200">Advance Reservation (Due Today)</span>
                          <span className="text-[11px] font-semibold rounded bg-amber-200/70 px-1.5 py-0.5 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                            Booked
                          </span>
                        </div>
                        <div className="flex justify-between pt-1">
                          <span className="text-muted-foreground">Guest</span>
                          <span className="font-semibold text-foreground">{opState.todayBooking.guest?.name || 'Guest'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Phone</span>
                          <a href={`tel:${opState.todayBooking.guest?.phone || ''}`} className="font-semibold text-emerald-700 dark:text-emerald-400">
                            {opState.todayBooking.guest?.phone || '-'}
                          </a>
                        </div>
                        {opState.todayBooking.guest?.company && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Company</span>
                            <span className="font-semibold">{opState.todayBooking.guest.company}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Booked Check-In</span>
                          <span className="font-semibold">{formatDate(opState.todayBooking.checkIn)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Expected Out</span>
                          <span className="font-semibold">{formatDate(opState.todayBooking.checkOut)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Guests</span>
                          <span className="font-semibold">{opState.todayBooking.guestCount}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Advance Paid</span>
                          <span className="font-bold text-emerald-700 dark:text-emerald-400">{formatINR(opState.todayBooking.advance)}</span>
                        </div>
                      </div>

                      {/* Actions: Check-In & Cancel Booking */}
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                          disabled={busy}
                          onClick={async () => {
                            if (!opState.todayBooking) return
                            setBusy(true)
                            try {
                              const res = await apiAs<{ error?: string }>('/api/bookings', getCachedUser(), {
                                method: 'PATCH',
                                body: JSON.stringify({ id: opState.todayBooking.id, action: 'checkin' }),
                              })
                              if (res && res.error) {
                                toast({ variant: 'destructive', title: 'Check-In Failed', description: res.error })
                                return
                              }
                              await load()
                              onDataChanged()
                              setViewRoom(null)
                              toast({
                                variant: 'success',
                                title: 'Check-In Completed',
                                description: `Guest ${opState.todayBooking.guest?.name || ''} checked into Room ${currentRoom.number}.`,
                              })
                            } catch (e) {
                              toast({
                                variant: 'destructive',
                                title: 'Error',
                                description: e instanceof Error ? e.message : 'Check-in failed',
                              })
                            } finally {
                              setBusy(false)
                            }
                          }}
                        >
                          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <LogIn className="mr-1.5 h-4 w-4" />}
                          Check-In Now
                        </Button>
                        <Button
                          variant="outline"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                          disabled={busy}
                          onClick={async () => {
                            if (!opState.todayBooking) return
                            if (!confirm(`Are you sure you want to cancel the advance booking for ${opState.todayBooking.guest?.name || 'Guest'} in Room ${currentRoom.number}?`)) return
                            setBusy(true)
                            try {
                              const res = await apiAs<{ error?: string }>('/api/bookings', getCachedUser(), {
                                method: 'PATCH',
                                body: JSON.stringify({ id: opState.todayBooking.id, action: 'cancel' }),
                              })
                              if (res && res.error) {
                                toast({ variant: 'destructive', title: 'Cancellation Failed', description: res.error })
                                return
                              }
                              await load()
                              onDataChanged()
                              setViewRoom(null)
                              toast({
                                variant: 'success',
                                title: 'Booking Cancelled',
                                description: `Advance reservation for Room ${currentRoom.number} has been cancelled.`,
                              })
                            } catch (e) {
                              toast({
                                variant: 'destructive',
                                title: 'Error',
                                description: e instanceof Error ? e.message : 'Cancellation failed',
                              })
                            } finally {
                              setBusy(false)
                            }
                          }}
                        >
                          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
                          Cancel Booking
                        </Button>
                      </div>

                      <Button
                        variant="outline"
                        className="w-full border-amber-300 text-amber-900 bg-amber-50/70 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                        onClick={() => {
                          if (opState.todayBooking) {
                            triggerPrintAdvanceReceipt(
                              {
                                ...opState.todayBooking,
                                room: { number: currentRoom.number, type: currentRoom.type },
                              },
                              settings
                            )
                          }
                        }}
                      >
                        <Printer className="mr-1.5 h-4 w-4" /> Print Booking Bill / Advance Receipt
                      </Button>

                      {/* Post-checkout Availability & Booking Card for Today's Booking */}
                      {opState.futureAvailableFromFormatted && (
                        <div className="rounded-xl border border-sky-300 bg-sky-50/70 p-3 text-xs space-y-2 dark:border-sky-800 dark:bg-sky-950/30">
                          <div className="flex items-center justify-between font-semibold text-sky-900 dark:text-sky-200">
                            <span className="flex items-center gap-1.5">
                              <Sparkles className="h-4 w-4 text-sky-600" />
                              Available for Next Booking
                            </span>
                            <span className="rounded bg-sky-200/80 px-2 py-0.5 text-[10px] font-bold text-sky-900 dark:bg-sky-900 dark:text-sky-200">
                              From {opState.futureAvailableFromFormatted}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-300">
                            Expected checkout is on <b>{opState.futureAvailableFromFormatted}</b>. Next guest can reserve this room from {opState.futureAvailableFromFormatted} onwards.
                          </p>
                          <Button
                            size="sm"
                            className="w-full bg-sky-600 hover:bg-sky-700 text-white font-semibold gap-1.5 shadow-sm"
                            onClick={() => {
                              setBookingDialogState({
                                open: true,
                                roomId: currentRoom.id,
                                initialCheckInDate: opState.futureAvailableFromDate || undefined,
                              })
                              setViewRoom(null)
                            }}
                          >
                            <CalendarPlus className="h-3.5 w-3.5" />
                            Book Next Stay (From {opState.futureAvailableFromFormatted})
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Occupied Room details */}
                  {opState.displayStatus === 'OCCUPIED' && opState.activeBooking && (
                    <div className="space-y-2">
                      {opState.hasFutureBooking && (
                        <div className="rounded-lg border border-amber-300 bg-amber-50/90 p-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 flex items-center justify-between">
                          <span className="font-medium">
                            ⚠️ Next Booking: <b>{opState.nextFutureBooking?.guest?.name}</b> on {opState.availableUntilFormatted}
                          </span>
                        </div>
                      )}
                      <div className="space-y-1.5 rounded-lg bg-muted p-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">In-House Guest</span>
                          <span className="font-semibold">{opState.activeBooking.guest?.name || 'Guest'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Phone</span>
                          <span className="font-semibold">{opState.activeBooking.guest?.phone}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Check-In</span>
                          <span className="font-semibold">{formatDate(opState.activeBooking.checkIn)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Expected Out</span>
                          <span className="font-semibold">{formatDateTime(opState.activeBooking.checkOut)}</span>
                        </div>
                        {(opState.activeBooking.autoExtendedDays || 0) > 0 && (
                          <div className="rounded border border-amber-300 bg-amber-50/80 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="font-bold flex items-center gap-1">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                                OVERSTAY +{opState.activeBooking.autoExtendedDays} day{opState.activeBooking.autoExtendedDays! > 1 ? 's' : ''} (auto)
                              </span>
                            </div>
                            {opState.activeBooking.originalCheckOut && (
                              <div className="text-[11px] text-muted-foreground">
                                Original check-out: {formatDateTime(opState.activeBooking.originalCheckOut)}
                              </div>
                            )}
                            <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Next auto-extension: {formatDateTime(nextAutoExtensionAt(opState.activeBooking, parseInt(settings.overstayGraceMinutes || '0', 10)))}
                            </div>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Advance</span>
                          <span className="font-semibold">{formatINR(opState.activeBooking.advance)}</span>
                        </div>
                      </div>

                      {/* Billing & Action Options: Print Bill, Lodging Checkout & Fooding Bill */}
                      <div className="space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Button
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                            onClick={() => {
                              const b = opState.activeBooking || currentRoom?.bookings?.[0]
                              if (b) {
                                setBillBooking({
                                  ...b,
                                  ratePerDay: b.ratePerDay ?? currentRoom.rate,
                                  room: { id: currentRoom.id, number: currentRoom.number, type: currentRoom.type },
                                })
                                setViewRoom(null)
                              }
                            }}
                          >
                            <Printer className="mr-1.5 h-4 w-4" /> Print Bill
                          </Button>
                          <Button
                            variant="outline"
                            className="font-semibold"
                            onClick={() => {
                              const b = opState.activeBooking || currentRoom?.bookings?.[0]
                              if (b) {
                                setBillBooking({
                                  ...b,
                                  ratePerDay: b.ratePerDay ?? currentRoom.rate,
                                  room: { id: currentRoom.id, number: currentRoom.number, type: currentRoom.type },
                                })
                                setViewRoom(null)
                              }
                            }}
                          >
                            <Receipt className="mr-1.5 h-4 w-4" /> Lodging Checkout
                          </Button>
                        </div>

                        <Button
                          variant="outline"
                          className="w-full border-amber-500/40 text-amber-900 hover:bg-amber-50 hover:text-amber-950 dark:border-amber-600/50 dark:text-amber-200 dark:hover:bg-amber-950/40 font-semibold"
                          onClick={() => {
                            const b = opState.activeBooking || currentRoom?.bookings?.[0]
                            if (b) {
                              setFoodBillState({
                                open: true,
                                roomId: currentRoom.id,
                                roomNumber: currentRoom.number,
                                bookingId: b.id,
                                guestName: b.guest?.name,
                              })
                              setViewRoom(null)
                            }
                          }}
                        >
                          <Utensils className="mr-1.5 h-4 w-4 text-amber-600 dark:text-amber-400" /> Fooding Bill (Room Service)
                        </Button>
                      </div>

                      {/* Post-checkout Availability for Occupied Room */}
                      {opState.futureAvailableFromFormatted && (
                        <div className="rounded-xl border border-sky-300 bg-sky-50/70 p-2.5 text-xs space-y-1.5 dark:border-sky-800 dark:bg-sky-950/30">
                          <div className="flex items-center justify-between font-semibold text-sky-900 dark:text-sky-200">
                            <span className="flex items-center gap-1.5">
                              <Sparkles className="h-3.5 w-3.5 text-sky-600" />
                              Available for Next Stay
                            </span>
                            <span className="rounded bg-sky-200/80 px-2 py-0.5 text-[10px] font-bold text-sky-900 dark:bg-sky-900 dark:text-sky-200">
                              From {opState.futureAvailableFromFormatted}
                            </span>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full h-8 border-sky-300 text-sky-900 bg-sky-50 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200 font-medium gap-1.5 shadow-sm"
                            onClick={() => {
                              setBookingDialogState({
                                open: true,
                                roomId: currentRoom.id,
                                initialCheckInDate: opState.futureAvailableFromDate || undefined,
                              })
                              setViewRoom(null)
                            }}
                          >
                            <CalendarPlus className="h-3.5 w-3.5" />
                            Book Future Stay (From {opState.futureAvailableFromFormatted})
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {currentRoom.status === 'MAINTENANCE' && (
                    <p className="text-sm text-muted-foreground">Room is under maintenance — book after marking vacant.</p>
                  )}

                  {currentRoom.status === 'VACANT' && currentRoom.housekeeping === 'DIRTY' && opState.displayStatus !== 'BOOKED' && (
                    <Button
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm transition-all"
                      disabled={busy}
                      onClick={() => patchRoom(currentRoom, { housekeeping: 'CLEAN' })}
                    >
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BrushCleaning className="mr-2 h-4 w-4" />}
                      Mark Clean (Ready for check-in)
                    </Button>
                  )}

                  {currentRoom.status !== 'OCCUPIED' && (
                    <Button
                      className="w-full"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        patchRoom(currentRoom, {
                          status: currentRoom.status === 'MAINTENANCE' ? 'VACANT' : 'MAINTENANCE',
                          housekeeping: 'CLEAN',
                        })
                      }
                    >
                      <Wrench className="mr-2 h-4 w-4" />
                      {currentRoom.status === 'MAINTENANCE' ? 'Mark as Vacant' : 'Mark Under Maintenance'}
                    </Button>
                  )}

                  {viewRoom && (
                    <>
                      <div className="flex gap-2">
                        <div className="flex-1 space-y-1">
                          <Label htmlFor="room-rate" className="text-xs">
                            Rate / night
                          </Label>
                          <Input
                            id="room-rate"
                            type="number"
                            defaultValue={viewRoom.rate}
                            onBlur={(e) => {
                              const v = parseFloat(e.target.value)
                              if (!isNaN(v) && v > 0 && v !== viewRoom.rate) patchRoom(viewRoom, { rate: v })
                            }}
                          />
                        </div>
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs">Type</Label>
                          <Select value={viewRoom.type} onValueChange={(t) => t !== viewRoom.type && patchRoom(viewRoom, { type: t })}>
                            <SelectTrigger aria-label="Room type">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TYPES.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {t}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Add room */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>Add Room</DialogTitle>
            <DialogDescription>Room structure is modular — add more rooms anytime.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="add-num">Room Number *</Label>
                <Input
                  id="add-num"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="e.g. 401"
                  value={newNumber}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, '')
                    setNewNumber(val)
                    if (val.length > 0 && !newFloor) {
                      setNewFloor(val.charAt(0))
                    }
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-floor">Floor *</Label>
                <Input
                  id="add-floor"
                  type="text"
                  placeholder="e.g. 1, 2, 4"
                  value={newFloor}
                  onChange={(e) => setNewFloor(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={newType} onValueChange={setNewType}>
                  <SelectTrigger aria-label="Type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-rate">Rate (₹/night)</Label>
                <Input id="add-rate" type="number" value={newRate} onChange={(e) => setNewRate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-cap">Capacity (Max 4)</Label>
              <Input id="add-cap" type="number" min="1" max="4" value={newCapacity} onChange={(e) => setNewCapacity(e.target.value)} />
            </div>
            <Button className="w-full" disabled={busy || !newNumber.trim()} onClick={addRoom}>
              Add Room
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete room modal */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <Trash2 className="h-5 w-5" /> Delete Room
            </DialogTitle>
            <DialogDescription>Select a vacant room to remove permanently.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Select Room</Label>
              <Select value={deleteRoomId} onValueChange={setDeleteRoomId}>
                <SelectTrigger aria-label="Select room to delete">
                  <SelectValue placeholder="Choose a room" />
                </SelectTrigger>
                <SelectContent>
                  {rooms.map((r) => (
                    <SelectItem key={r.id} value={r.id} disabled={r.status === 'OCCUPIED'}>
                      Room {r.number} ({r.type} - {r.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="destructive"
              className="w-full"
              disabled={busy || !deleteRoomId}
              onClick={() => handleDeleteRoom(deleteRoomId)}
            >
              Delete Room
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Generate Bill Modal in-place */}
      <GenerateBillDialog
        open={!!billBooking}
        onOpenChange={(o) => !o && setBillBooking(null)}
        booking={billBooking}
        defaultGstPercent={settings.gstPercent}
        onSuccess={(bill) => {
          if (Number(bill.gstPercent) > 0) {
            setLastBill(bill)
          } else {
            toast({
              variant: 'success',
              title: 'Check Out Complete',
              description: `Room checked out. Invoice ${bill.billNumber} (0% GST) saved directly to Invoices.`,
            })
          }
          load()
          onDataChanged()
        }}
      />

      {/* Printable Invoice Modal */}
      <Dialog open={!!lastBill} onOpenChange={(o) => !o && setLastBill(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader className="print:hidden">
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-emerald-600 dark:text-emerald-400" /> Bill {lastBill?.billNumber}
            </DialogTitle>
            <DialogDescription>{formatDateTime(lastBill?.createdAt)}</DialogDescription>
          </DialogHeader>
          {lastBill && (
            <div className="space-y-3">
              <PrintableInvoice bill={lastBill as any} settings={settings} />
              <div className="flex gap-2 print:hidden">
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => triggerPrintInvoice(lastBill, settings)}>
                  <Printer className="mr-2 h-4 w-4" /> Print / Save PDF
                </Button>
                <Button variant="outline" onClick={() => setEditBill(lastBill)}>
                  <Edit3 className="mr-2 h-4 w-4 text-emerald-600" /> Edit Bill
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Bill Modal */}
      <EditBillDialog
        open={!!editBill}
        onOpenChange={(o) => !o && setEditBill(null)}
        bill={editBill as any}
        onSuccess={(updatedBill) => {
          setLastBill(updatedBill as any)
          load()
          onDataChanged()
        }}
      />

      {/* Booking Dialog for direct schedule booking */}
      {bookingDialogState?.open && (
        <BookingDialog
          open={bookingDialogState.open}
          onOpenChange={(open) => !open && setBookingDialogState(null)}
          roomId={bookingDialogState.roomId}
          initialCheckInDate={bookingDialogState.initialCheckInDate}
          onSuccess={() => {
            setBookingDialogState(null)
            load()
            onDataChanged()
          }}
        />
      )}

      {/* Room Fooding Bill Dialog */}
      {foodBillState?.open && (
        <RoomFoodBillDialog
          open={foodBillState.open}
          onOpenChange={(open) => !open && setFoodBillState(null)}
          roomId={foodBillState.roomId}
          roomNumber={foodBillState.roomNumber}
          bookingId={foodBillState.bookingId}
          guestName={foodBillState.guestName}
          onOpenLodgingBill={() => {
            const targetRoom = rooms.find((r) => r.id === foodBillState.roomId || r.number === foodBillState.roomNumber)
            const b =
              targetRoom?.bookings?.find((x) => x.id === foodBillState.bookingId) ||
              targetRoom?.bookings?.find((x) => x.status === 'ACTIVE')
            if (targetRoom && b) {
              setBillBooking({
                ...b,
                ratePerDay: b.ratePerDay ?? targetRoom.rate,
                room: { id: targetRoom.id, number: targetRoom.number, type: targetRoom.type },
              })
            }
          }}
          onOpenNewOrder={() => {
            if (onNavigate) {
              onNavigate({ tab: 'restaurant', q: foodBillState.roomNumber })
            }
          }}
          onDataChanged={() => {
            load()
            onDataChanged()
          }}
        />
      )}
    </div>
  )
}
