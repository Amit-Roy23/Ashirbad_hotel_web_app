'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CheckinDialog } from './checkin-dialog'
import { RoomStatusBadge } from './status-badge'
import { api, apiAs, formatINR, formatDate } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { toast } from '@/hooks/use-toast'
import {
  BedDouble,
  DoorOpen,
  Users,
  IndianRupee,
  Wallet,
  Banknote,
  Smartphone,
  CreditCard,
  Loader2,
  Wrench,
  ArrowLeftRight,
  Coffee,
  LogIn,
  LogOut,
  UserPlus,
  Search,
  AlertCircle,
  BrushCleaning,
  CalendarCheck,
  CalendarX2,
  Printer,
} from 'lucide-react'

interface Guest {
  id: string
  name: string
  phone: string
  company?: string
}

interface Booking {
  id: string
  checkIn: string
  checkOut?: string
  days: number
  guestCount: number
  ratePerDay: number
  advance: number
  guest: Guest
}

interface Room {
  id: string
  number: string
  type: string
  rate: number
  capacity: number
  status: string
  housekeeping?: string
  bookings: Booking[]
}

interface ArrivalDepartureRow {
  id: string
  guestName: string
  roomNumber: string
  checkIn?: string
  checkOut?: string
  days?: number
  billOutstanding?: number
}

interface Stats {
  totalRooms: number
  vacant: number
  occupied: number
  maintenance: number
  dirtyRooms: number
  occupancyPercent: number
  activeGuests: number
  arrivals: ArrivalDepartureRow[]
  departures: ArrivalDepartureRow[]
  todayRevenue: number
  todayCash: number
  todayUpi: number
  todayCard: number
  todayIncome: number
  todayExpense: number
  todayNet: number
  outstanding: number
  pendingFoodAmount: number
  potentialRevenue: number
}

const STATUS_STYLES: Record<string, { card: string; dot: string }> = {
  VACANT: { card: 'border-emerald-300 bg-emerald-50 hover:border-emerald-500 hover:shadow-md dark:border-emerald-800 dark:bg-emerald-950/40', dot: 'bg-emerald-500' },
  OCCUPIED: { card: 'border-red-300 bg-red-50 hover:border-red-500 hover:shadow-md dark:border-red-800 dark:bg-red-950/40', dot: 'bg-red-500' },
  MAINTENANCE: { card: 'border-zinc-300 bg-zinc-50 hover:border-zinc-500 hover:shadow-md dark:border-zinc-600 dark:bg-zinc-800/60', dot: 'bg-zinc-400' },
}

interface DashboardProps {
  refreshKey: number
  onDataChanged: () => void
  onNavigate: (target: { tab: string; q?: string }) => void
}

export function Dashboard({ refreshKey, onDataChanged, onNavigate }: DashboardProps) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [checkinRoom, setCheckinRoom] = useState<Room | null>(null)
  const [viewRoom, setViewRoom] = useState<Room | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [roomsData, statsData] = await Promise.all([api<Room[]>('/api/rooms'), api<Stats>('/api/stats')])
      setRooms(roomsData)
      setStats(statsData)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  async function toggleMaintenance(room: Room) {
    setBusy(true)
    try {
      const newStatus = room.status === 'MAINTENANCE' ? 'VACANT' : 'MAINTENANCE'
      const res = await apiAs<{ error?: string }>(
        '/api/rooms',
        getCachedUser(),
        { method: 'PATCH', body: JSON.stringify({ id: room.id, status: newStatus, housekeeping: 'CLEAN' }) }
      )
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
      setViewRoom(null)
      toast({
        variant: 'success',
        title: 'Room Status Updated',
        description: `Room ${room.number} is now marked ${newStatus === 'MAINTENANCE' ? 'Under Maintenance' : 'Vacant'}.`,
      })
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: e instanceof Error ? e.message : 'Failed to update room status',
      })
    } finally {
      setBusy(false)
    }
  }

  async function markClean(room: Room) {
    setBusy(true)
    try {
      const res = await apiAs<{ error?: string }>('/api/rooms', getCachedUser(), {
        method: 'PATCH',
        body: JSON.stringify({ id: room.id, housekeeping: 'CLEAN' }),
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
      setViewRoom(null)
      toast({
        variant: 'success',
        title: 'Room Marked Clean',
        description: `Room ${room.number} is clean and ready for check-in.`,
      })
    } catch (e) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: e instanceof Error ? e.message : 'Failed to mark room clean',
      })
    } finally {
      setBusy(false)
    }
  }

  const grouped = rooms.reduce<Record<string, Room[]>>((acc, room) => {
    const floor = room.number.charAt(0)
    if (!acc[floor]) acc[floor] = []
    acc[floor].push(room)
    return acc
  }, {})

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <Button
          size="sm"
          className="justify-start gap-2 bg-emerald-600 hover:bg-emerald-700"
          onClick={() => {
            const vacantRoom = rooms.find((r) => r.status === 'VACANT' && r.housekeeping !== 'DIRTY')
            if (vacantRoom) setCheckinRoom(vacantRoom)
          }}
        >
          <LogIn className="h-4 w-4" /> Check-in
        </Button>
        <Button size="sm" variant="outline" className="justify-start gap-2" onClick={() => onNavigate({ tab: 'bookings' })}>
          <UserPlus className="h-4 w-4" /> New Booking
        </Button>
        <Button size="sm" variant="outline" className="justify-start gap-2" onClick={() => onNavigate({ tab: 'guests' })}>
          <Search className="h-4 w-4" /> Guest Search
        </Button>
        <Button size="sm" variant="outline" className="justify-start gap-2" onClick={() => onNavigate({ tab: 'billing' })}>
          <Wallet className="h-4 w-4" /> Checkout / Bill
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-transparent dark:border-emerald-900 dark:from-emerald-950/40">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-full bg-emerald-100 p-2.5 dark:bg-emerald-900">
              <DoorOpen className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Vacant / Total</p>
              <p className="text-xl font-bold">
                {stats?.vacant}/{stats?.totalRooms}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-gradient-to-br from-red-50 to-transparent dark:border-red-900 dark:from-red-950/40">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-full bg-red-100 p-2.5 dark:bg-red-900">
              <BedDouble className="h-5 w-5 text-red-700 dark:text-red-300" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Occupied</p>
              <p className="text-xl font-bold">{stats?.occupied}</p>
              <p className="text-[10px] text-muted-foreground">{stats?.occupancyPercent}% occupancy</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-teal-200 bg-gradient-to-br from-teal-50 to-transparent dark:border-teal-900 dark:from-teal-950/40">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-full bg-teal-100 p-2.5 dark:bg-teal-900">
              <IndianRupee className="h-5 w-5 text-teal-700 dark:text-teal-300" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Today Revenue</p>
              <p className="text-xl font-bold">{formatINR(stats?.todayRevenue)}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-transparent dark:border-amber-900 dark:from-amber-950/40">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-full bg-amber-100 p-2.5 dark:bg-amber-900">
              <Users className="h-5 w-5 text-amber-700 dark:text-amber-300" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">In-House Guests</p>
              <p className="text-xl font-bold">{stats?.activeGuests}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Collections + money summary */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <Wallet className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              <p className="text-sm font-semibold">Today&apos;s Collection (Cash / UPI / Card)</p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-muted p-3 text-center">
                <Banknote className="mx-auto mb-1 h-5 w-5 text-emerald-700 dark:text-emerald-400" />
                <p className="text-[11px] text-muted-foreground">Cash</p>
                <p className="text-sm font-bold">{formatINR(stats?.todayCash)}</p>
              </div>
              <div className="rounded-lg bg-muted p-3 text-center">
                <Smartphone className="mx-auto mb-1 h-5 w-5 text-violet-600" />
                <p className="text-[11px] text-muted-foreground">UPI</p>
                <p className="text-sm font-bold">{formatINR(stats?.todayUpi)}</p>
              </div>
              <div className="rounded-lg bg-muted p-3 text-center">
                <CreditCard className="mx-auto mb-1 h-5 w-5 text-orange-600" />
                <p className="text-[11px] text-muted-foreground">Card</p>
                <p className="text-sm font-bold">{formatINR(stats?.todayCard)}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap justify-between gap-2 border-t pt-3 text-xs">
              <span className="text-muted-foreground">
                Income <b className="text-foreground">{formatINR(stats?.todayIncome)}</b>
              </span>
              <span className="text-muted-foreground">
                Expenses <b className="text-foreground">{formatINR(stats?.todayExpense)}</b>
              </span>
              <span className="text-muted-foreground">
                Net <b className={stats && stats.todayNet < 0 ? 'text-red-600' : 'text-emerald-600'}>{formatINR(stats?.todayNet)}</b>
              </span>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-rows-2 gap-3">
          <Card className="border-red-200 dark:border-red-900">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="rounded-full bg-red-100 p-2.5 dark:bg-red-900">
                <AlertCircle className="h-5 w-5 text-red-700 dark:text-red-300" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Outstanding Balance (all bills)</p>
                <p className="text-xl font-bold text-red-700 dark:text-red-400">{formatINR(stats?.outstanding)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <BrushCleaning className="h-4 w-4 text-amber-600" />
                <span>
                  <b className="text-foreground">{stats?.dirtyRooms}</b> room(s) to clean
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Coffee className="h-4 w-4 text-orange-500" />
                <span>
                  Pending food <b className="text-foreground">{formatINR(stats?.pendingFoodAmount)}</b>
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Wrench className="h-4 w-4 text-zinc-500" />
                <span>
                  Maintenance <b className="text-foreground">{stats?.maintenance}</b>
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Arrivals & Departures */}
      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <CalendarCheck className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-semibold">Today&apos;s Arrivals</p>
            </div>
            {(stats?.arrivals?.length || 0) === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">No arrivals today.</p>
            ) : (
              <ul className="max-h-40 space-y-1.5 overflow-y-auto text-sm">
                {stats!.arrivals.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-md bg-muted px-2.5 py-1.5">
                    <span className="truncate font-medium">{a.guestName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">Room {a.roomNumber}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="mb-2 flex items-center gap-2">
              <CalendarX2 className="h-4 w-4 text-orange-600" />
              <p className="text-sm font-semibold">Expected Departures</p>
            </div>
            {(stats?.departures?.length || 0) === 0 ? (
              <p className="py-2 text-xs text-muted-foreground">No departures scheduled today.</p>
            ) : (
              <ul className="max-h-40 space-y-1.5 overflow-y-auto text-sm">
                {stats!.departures.map((d) => (
                  <li key={d.id} className="flex items-center justify-between rounded-md bg-muted px-2.5 py-1.5">
                    <span className="truncate font-medium">{d.guestName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      Room {d.roomNumber}
                      {d.billOutstanding ? ` · due ${formatINR(d.billOutstanding)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>



      {/* Check-in dialog */}
      <CheckinDialog
        open={!!checkinRoom}
        onOpenChange={(open) => !open && setCheckinRoom(null)}
        room={checkinRoom}
        onSuccess={() => {
          load()
          onDataChanged()
        }}
      />

      {/* Occupied/Maintenance/Dirty room view */}
      <Dialog open={!!viewRoom} onOpenChange={(open) => !open && setViewRoom(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Room {viewRoom?.number} <RoomStatusBadge status={viewRoom?.status || ''} housekeeping={viewRoom?.housekeeping} />
            </DialogTitle>
            <DialogDescription>
              {viewRoom?.type} • {formatINR(viewRoom?.rate)}/night
            </DialogDescription>
          </DialogHeader>
          {viewRoom?.status === 'OCCUPIED' && viewRoom.bookings?.[0] && (
            <div className="space-y-3">
              <div className="space-y-1.5 rounded-lg bg-muted p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Guest</span>
                  <span className="font-semibold">{viewRoom.bookings[0].guest?.name || 'Guest'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Phone</span>
                  <a href={`tel:${viewRoom.bookings[0].guest?.phone || ''}`} className="font-semibold text-emerald-700 dark:text-emerald-400">
                    {viewRoom.bookings[0].guest?.phone || '-'}
                  </a>
                </div>
                {viewRoom.bookings[0].guest?.company && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Company</span>
                    <span className="font-semibold">{viewRoom.bookings[0].guest.company}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Check-In</span>
                  <span className="font-semibold">{formatDate(viewRoom.bookings[0].checkIn)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Expected Out</span>
                  <span className="font-semibold">{formatDate(viewRoom.bookings[0].checkOut)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Guests</span>
                  <span className="font-semibold">{viewRoom.bookings[0].guestCount}</span>
                </div>
                {viewRoom.bookings[0].advance > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Advance</span>
                    <span className="font-semibold">{formatINR(viewRoom.bookings[0].advance)}</span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => {
                    onNavigate({ tab: 'billing', q: viewRoom.number })
                    setViewRoom(null)
                  }}
                >
                  <Printer className="mr-1.5 h-4 w-4" /> Print Bill
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    onNavigate({ tab: 'billing', q: viewRoom.number })
                    setViewRoom(null)
                  }}
                >
                  <Wallet className="mr-1.5 h-4 w-4" /> Billing &amp; Checkout
                </Button>
              </div>
            </div>
          )}
          {viewRoom?.status === 'MAINTENANCE' && (
            <p className="text-sm text-muted-foreground">This room is under maintenance.</p>
          )}
          {viewRoom && viewRoom.status === 'VACANT' && viewRoom.housekeeping === 'DIRTY' && (
            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm transition-all"
              onClick={() => markClean(viewRoom)}
              disabled={busy}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BrushCleaning className="mr-2 h-4 w-4" />}
              Mark Clean (Ready for check-in)
            </Button>
          )}
          {viewRoom && viewRoom.status !== 'OCCUPIED' && (
            <Button
              className="w-full"
              variant="outline"
              onClick={() => toggleMaintenance(viewRoom)}
              disabled={busy}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {viewRoom.status === 'MAINTENANCE' ? (
                <>
                  <ArrowLeftRight className="mr-2 h-4 w-4" /> Mark as Vacant
                </>
              ) : (
                <>
                  <Wrench className="mr-2 h-4 w-4" /> Mark Under Maintenance
                </>
              )}
            </Button>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
