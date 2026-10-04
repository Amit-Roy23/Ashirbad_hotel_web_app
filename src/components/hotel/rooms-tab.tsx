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
import { CheckinDialog } from './checkin-dialog'
import { GenerateBillDialog, type Bill } from './generate-bill-dialog'
import { EditBillDialog } from './edit-bill-dialog'
import { PrintableInvoice } from './printable-invoice'
import { triggerPrintInvoice } from '@/lib/print-invoice'
import { RoomStatusBadge } from './status-badge'
import { TableControls } from './table-controls'
import { Separator } from '@/components/ui/separator'
import { api, apiAs, formatINR, formatDate, formatDateTime } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { toast } from '@/hooks/use-toast'
import { Loader2, Plus, BrushCleaning, Wrench, BedDouble, Printer, Wallet, Trash2, Receipt, Building2, Edit3 } from 'lucide-react'

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
  days: number
  guest: Guest
  advance: number
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

  useEffect(() => {
    if (initialFilter) setSearch(initialFilter)
  }, [initialFilter])

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
      if (q && !`${r.number} ${r.type}`.toLowerCase().includes(q)) return false
      if (floor !== 'ALL' && (r.floor ? r.floor !== floor : !r.number.startsWith(floor))) return false
      if (type !== 'ALL' && r.type !== type) return false
      if (status !== 'ALL') {
        if (status === 'DIRTY') {
          if (r.housekeeping !== 'DIRTY') return false
        } else if (status === 'VACANT') {
          if (r.status !== 'VACANT' || r.housekeeping === 'DIRTY') return false
        } else if (r.status !== status) {
          return false
        }
      }
      return true
    })
  }, [rooms, search, floor, type, status])

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
            {rooms.filter((r) => r.status === 'VACANT' && r.housekeeping !== 'DIRTY').length} vacant ·{' '}
            {rooms.filter((r) => r.status === 'OCCUPIED').length} occupied ·{' '}
            {rooms.filter((r) => r.housekeeping === 'DIRTY').length} to clean ·{' '}
            {rooms.filter((r) => r.status === 'MAINTENANCE').length} maintenance
          </p>
        </div>
        <div className="flex items-center gap-2">
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
        searchPlaceholder="Room number, type…"
        filters={[
          { key: 'floor', label: 'Floor', options: floors.map((f) => ({ value: f, label: `Floor ${f}` })) },
          { key: 'type', label: 'Type', options: [...new Set(rooms.map((r) => r.type))].map((t) => ({ value: t, label: t })) },
          {
            key: 'status',
            label: 'Status',
            options: [
              { value: 'VACANT', label: 'Vacant (Clean)' },
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

      {Object.entries(grouped).map(([f, floorRooms]) => (
        <div key={f}>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Floor {f}</h3>
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-10">
            {floorRooms.map((room) => {
              const dirty = room.status === 'VACANT' && room.housekeeping === 'DIRTY'
              const borderCls = dirty
                ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40'
                : room.status === 'OCCUPIED'
                  ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40'
                  : room.status === 'MAINTENANCE'
                    ? 'border-zinc-300 bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800/60'
                    : 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40'
              return (
                <button
                  key={room.id}
                  onClick={() => (room.status === 'VACANT' && !dirty ? setCheckinRoom(room) : setViewRoom(room))}
                  className={`min-h-[92px] rounded-xl border-2 p-2.5 text-left transition-all active:scale-95 hover:shadow-md ${borderCls}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold">{room.number}</span>
                    <BedDouble className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  </div>
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{room.type}</p>
                  {room.status === 'OCCUPIED' && room.bookings?.[0] ? (
                    <p className="mt-1 truncate text-[10px] font-semibold text-red-700 dark:text-red-400">
                      {room.bookings[0].guest?.name || 'Guest'}
                    </p>
                  ) : dirty ? (
                    <p className="mt-1 text-[10px] font-semibold text-amber-700 dark:text-amber-400">To Clean</p>
                  ) : (
                    <p className="mt-1 text-[10px] font-medium">{formatINR(room.rate)}</p>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      ))}

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

      {/* Room detail */}
      <Dialog open={!!viewRoom} onOpenChange={(o) => !o && setViewRoom(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              Room {viewRoom?.number}
              <RoomStatusBadge status={viewRoom?.status || ''} housekeeping={viewRoom?.housekeeping} />
            </DialogTitle>
            <DialogDescription>
              {viewRoom?.type} • Max {viewRoom?.capacity} guests • {formatINR(viewRoom?.rate)}/night
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {viewRoom?.status === 'OCCUPIED' && viewRoom.bookings?.[0] && (
              <div className="space-y-2">
                <div className="space-y-1.5 rounded-lg bg-muted p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Guest</span>
                    <span className="font-semibold">{viewRoom.bookings[0].guest?.name || 'Guest'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Phone</span>
                    <span className="font-semibold">{viewRoom.bookings[0].guest?.phone}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Check-In</span>
                    <span className="font-semibold">{formatDate(viewRoom.bookings[0].checkIn)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expected Out</span>
                    <span className="font-semibold">{formatDate(viewRoom.bookings[0].checkOut)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Advance</span>
                    <span className="font-semibold">{formatINR(viewRoom.bookings[0].advance)}</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => {
                      if (viewRoom?.bookings?.[0]) {
                        const b = viewRoom.bookings[0]
                        setBillBooking({
                          ...b,
                          ratePerDay: viewRoom.rate,
                          room: { id: viewRoom.id, number: viewRoom.number, type: viewRoom.type },
                        })
                        setViewRoom(null)
                      }
                    }}
                  >
                    <Printer className="mr-1.5 h-4 w-4" /> Print Bill
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (viewRoom?.bookings?.[0]) {
                        const b = viewRoom.bookings[0]
                        setBillBooking({
                          ...b,
                          ratePerDay: viewRoom.rate,
                          room: { id: viewRoom.id, number: viewRoom.number, type: viewRoom.type },
                        })
                        setViewRoom(null)
                      }
                    }}
                  >
                    <Wallet className="mr-1.5 h-4 w-4" /> Billing / Checkout
                  </Button>
                </div>
              </div>
            )}
            {viewRoom?.status === 'MAINTENANCE' && (
              <p className="text-sm text-muted-foreground">Room is under maintenance — book after marking vacant.</p>
            )}

            {viewRoom && viewRoom.status === 'VACANT' && viewRoom.housekeeping === 'DIRTY' && (
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium shadow-sm transition-all"
                disabled={busy}
                onClick={() => patchRoom(viewRoom, { housekeeping: 'CLEAN' })}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BrushCleaning className="mr-2 h-4 w-4" />}
                Mark Clean (Ready for check-in)
              </Button>
            )}
            {viewRoom && viewRoom.status !== 'OCCUPIED' && (
              <Button
                className="w-full"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  patchRoom(viewRoom, {
                    status: viewRoom.status === 'MAINTENANCE' ? 'VACANT' : 'MAINTENANCE',
                    housekeeping: 'CLEAN',
                  })
                }
              >
                <Wrench className="mr-2 h-4 w-4" />
                {viewRoom.status === 'MAINTENANCE' ? 'Mark as Vacant' : 'Mark Under Maintenance'}
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
              <Label htmlFor="add-cap">Capacity</Label>
              <Input id="add-cap" type="number" min="1" value={newCapacity} onChange={(e) => setNewCapacity(e.target.value)} />
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
        onSuccess={(bill) => {
          setLastBill(bill)
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
    </div>
  )
}
