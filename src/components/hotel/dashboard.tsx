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
import { BookingDialog } from './booking-dialog'
import { RoomStatusBadge } from './status-badge'
import { api, apiAs, formatINR, formatDate, getRoomOperationalState } from '@/lib/hotel-utils'
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
  Trash2,
  CalendarPlus,
  Sparkles,
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
  status?: string
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
  booked?: number
  bookedFuture?: number
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
  const [bookingDialogState, setBookingDialogState] = useState<{
    open: boolean
    roomId?: string
    initialCheckInDate?: string
  } | null>(null)
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
            const vacantRoom = rooms.find((r) => {
              const op = getRoomOperationalState(r)
              return (op.displayStatus === 'VACANT' || op.displayStatus === 'VACANT_WITH_FUTURE') && r.housekeeping !== 'DIRTY'
            })
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
      {(() => {
        const opStates = rooms.map((r) => getRoomOperationalState(r))
        const bookedTodayCount = opStates.filter((s) => s.displayStatus === 'BOOKED').length
        const futureReservedCount = opStates.filter((s) => s.displayStatus === 'VACANT_WITH_FUTURE' || (s.displayStatus === 'OCCUPIED' && s.hasFutureBooking)).length
        const totalVacantCount = opStates.filter((s) => s.displayStatus === 'VACANT' || s.displayStatus === 'VACANT_WITH_FUTURE').length

        return (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Card
                className="cursor-pointer transition-all hover:shadow-md border-emerald-200 bg-gradient-to-br from-emerald-50 to-transparent dark:border-emerald-900 dark:from-emerald-950/40"
                onClick={() => onNavigate({ tab: 'rooms' })}
              >
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="rounded-full bg-emerald-100 p-2.5 dark:bg-emerald-900">
                    <DoorOpen className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Vacant / Total</p>
                    <p className="text-xl font-bold">
                      {totalVacantCount}/{stats?.totalRooms || rooms.length}
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card
                className="cursor-pointer transition-all hover:shadow-md border-amber-300 bg-gradient-to-br from-amber-50 to-transparent dark:border-amber-800 dark:from-amber-950/40"
                onClick={() => onNavigate({ tab: 'rooms' })}
              >
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="rounded-full bg-amber-100 p-2.5 dark:bg-amber-900">
                    <CalendarCheck className="h-5 w-5 text-amber-700 dark:text-amber-300" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Reservations</p>
                    <p className="text-xl font-bold text-amber-900 dark:text-amber-200">
                      {bookedTodayCount + futureReservedCount}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {bookedTodayCount > 0 ? `${bookedTodayCount} today · ` : ''}{futureReservedCount} future
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card
                className="cursor-pointer transition-all hover:shadow-md border-red-200 bg-gradient-to-br from-red-50 to-transparent dark:border-red-900 dark:from-red-950/40"
                onClick={() => onNavigate({ tab: 'rooms' })}
              >
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

              <Card
                className="cursor-pointer transition-all hover:shadow-md border-indigo-200 bg-gradient-to-br from-indigo-50 to-transparent dark:border-indigo-900 dark:from-indigo-950/40 sm:col-span-2 lg:col-span-1"
                onClick={() => onNavigate({ tab: 'guests' })}
              >
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="rounded-full bg-indigo-100 p-2.5 dark:bg-indigo-900">
                    <Users className="h-5 w-5 text-indigo-700 dark:text-indigo-300" />
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
                      <CalendarCheck className="h-4 w-4 text-amber-600" />
                      <span>
                        <b className="text-foreground">{bookedTodayCount}</b> booked
                      </span>
                    </div>
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
          </>
        )
      })()}

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
      {/* Occupied/Booked/Maintenance/Dirty/Vacant room view */}
      <Dialog open={!!viewRoom} onOpenChange={(open) => !open && setViewRoom(null)}>
        <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
          {viewRoom && (() => {
            const currentRoom = viewRoom
            const opState = getRoomOperationalState(currentRoom)
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    Room {currentRoom.number}{' '}
                    <RoomStatusBadge
                      status={opState.displayStatus}
                      housekeeping={currentRoom.housekeeping}
                      upcomingText={opState.availableUntilFormatted}
                    />
                  </DialogTitle>
                  <DialogDescription>
                    {currentRoom.type} • {formatINR(currentRoom.rate)}/night
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
                          <span className="rounded bg-amber-200/80 px-2 py-0.5 text-[10px] font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
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
                            Previous guest checkout is on <b>{opState.futureAvailableFromFormatted}</b>. Another guest can reserve starting on or after {opState.futureAvailableFromFormatted}.
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

                  {/* Advance Reservation Room details (DUE TODAY) */}
                  {opState.displayStatus === 'BOOKED' && opState.todayBooking && (
                    <div className="space-y-3">
                      <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                        <div className="flex items-center justify-between border-b border-amber-200/60 pb-1.5 dark:border-amber-800/60">
                          <span className="font-bold text-amber-900 dark:text-amber-200">Advance Reservation (Due Today)</span>
                          <span className="text-[11px] font-semibold rounded bg-amber-200/70 px-1.5 py-0.5 text-amber-900 dark:bg-amber-900 dark:text-amber-200">
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
                        {Number(opState.todayBooking.advance || 0) > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Advance Paid</span>
                            <span className="font-bold text-emerald-700 dark:text-emerald-400">{formatINR(opState.todayBooking.advance)}</span>
                          </div>
                        )}
                      </div>

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

                      {/* Post-checkout Availability for Today's Booking */}
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
                            Expected checkout is on <b>{opState.futureAvailableFromFormatted}</b>. Next guest can reserve from this date onwards.
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
                    <div className="space-y-3">
                      {opState.hasFutureBooking && (
                        <div className="rounded-lg border border-amber-300 bg-amber-50/90 p-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                          ⚠️ Next Booking: <b>{opState.nextFutureBooking?.guest?.name}</b> on {opState.availableUntilFormatted}
                        </div>
                      )}
                      <div className="space-y-1.5 rounded-lg bg-muted p-3 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Guest</span>
                          <span className="font-semibold">{opState.activeBooking.guest?.name || 'Guest'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Phone</span>
                          <a href={`tel:${opState.activeBooking.guest?.phone || ''}`} className="font-semibold text-emerald-700 dark:text-emerald-400">
                            {opState.activeBooking.guest?.phone || '-'}
                          </a>
                        </div>
                        {opState.activeBooking.guest?.company && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Company</span>
                            <span className="font-semibold">{opState.activeBooking.guest.company}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Check-In</span>
                          <span className="font-semibold">{formatDate(opState.activeBooking.checkIn)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Expected Out</span>
                          <span className="font-semibold">{formatDate(opState.activeBooking.checkOut)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Guests</span>
                          <span className="font-semibold">{opState.activeBooking.guestCount}</span>
                        </div>
                        {Number(opState.activeBooking.advance || 0) > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Advance</span>
                            <span className="font-semibold">{formatINR(opState.activeBooking.advance)}</span>
                          </div>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          className="bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={() => {
                            onNavigate({ tab: 'billing', q: currentRoom.number })
                            setViewRoom(null)
                          }}
                        >
                          <Printer className="mr-1.5 h-4 w-4" /> Print Bill
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            onNavigate({ tab: 'billing', q: currentRoom.number })
                            setViewRoom(null)
                          }}
                        >
                          <Wallet className="mr-1.5 h-4 w-4" /> Billing &amp; Checkout
                        </Button>
                      </div>

                      {/* Post-checkout Availability for Occupied Room */}
                      {opState.futureAvailableFromFormatted && (
                        <div className="rounded-xl border border-sky-300 bg-sky-50/70 p-2.5 text-xs space-y-1.5 dark:border-sky-800 dark:bg-sky-950/30">
                          <div className="flex items-center justify-between font-semibold text-sky-900 dark:text-sky-200">
                            <span className="flex items-center gap-1.5">
                              <Sparkles className="h-4 w-4 text-sky-600" />
                              Available Next
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
                    <p className="text-sm text-muted-foreground">This room is under maintenance.</p>
                  )}
                  {opState.displayStatus === 'DIRTY' && (
                    <Button
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm transition-all"
                      onClick={() => markClean(currentRoom)}
                      disabled={busy}
                    >
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BrushCleaning className="mr-2 h-4 w-4" />}
                      Mark Clean (Ready for check-in)
                    </Button>
                  )}
                  {opState.displayStatus !== 'OCCUPIED' && opState.displayStatus !== 'BOOKED' && (
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={() => toggleMaintenance(currentRoom)}
                      disabled={busy}
                    >
                      {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {currentRoom.status === 'MAINTENANCE' ? (
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
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Booking Dialog */}
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
    </div>
  )
}

