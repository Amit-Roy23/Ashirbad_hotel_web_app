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
import { PaymentStatusBadge } from './status-badge'
import { TableControls, SortableTh, useSort, usePagination } from './table-controls'
import { api, apiAs, formatINR, formatDate, exportCSV } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { Loader2, History, Pencil, Trash2 } from 'lucide-react'

interface Bill {
  id: string
  billNumber: string
  grandTotal: number
}

interface Booking {
  id: string
  checkIn: string
  checkOut?: string | null
  days: number
  guestCount?: number
  ratePerDay: number
  advance: number
  status: string
  paymentStatus: string
  room?: { number: string; type: string } | null
  bills?: Bill[]
}

interface GuestRow {
  id: string
  phone: string
  name: string
  company?: string | null
  gst?: string | null
  address?: string | null
  createdAt: string
  bookings: Booking[]
}

interface TabProps {
  refreshKey: number
  onDataChanged: () => void
  initialFilter?: string
}

export function GuestsTab({ refreshKey, initialFilter }: TabProps) {
  const [guests, setGuests] = useState<GuestRow[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [viewGuest, setViewGuest] = useState<GuestRow | null>(null)
  const [editGuest, setEditGuest] = useState<GuestRow | null>(null)
  const [editName, setEditName] = useState('')
  const [editCompany, setEditCompany] = useState('')
  const [editGst, setEditGst] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (initialFilter) setSearch(initialFilter)
  }, [initialFilter])

  const load = useCallback(async () => {
    try {
      setGuests(await api<GuestRow[]>('/api/guests'))
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
    if (!q) return guests
    return guests.filter((g) =>
      `${g.name} ${g.phone} ${g.company || ''} ${g.gst || ''}`.toLowerCase().includes(q)
    )
  }, [guests, search])

  const { sorted, sort, toggle } = useSort<Record<string, unknown>>(filtered as unknown as Record<string, unknown>[], 'createdAt')
  const { paged, controls } = usePagination(sorted as unknown as GuestRow[], 10)

  function doExport() {
    exportCSV(
      'guests.csv',
      ['Name', 'Phone', 'Company', 'GST', 'Address', 'Total Stays', 'First Seen'],
      (filtered as unknown as GuestRow[]).map((g) => [
        g.name, g.phone, g.company || '', g.gst || '', g.address || '', g.bookings.length, formatDate(g.createdAt),
      ])
    )
  }

  function openEdit(g: GuestRow) {
    setEditGuest(g)
    setEditName(g.name)
    setEditCompany(g.company || '')
    setEditGst(g.gst || '')
    setEditAddress(g.address || '')
  }

  async function deleteGuest(g: GuestRow) {
    if (!confirm(`Are you sure you want to delete guest profile ${g.name} (${g.phone})?`)) return
    setBusy(true)
    try {
      const res = await apiAs<{ success?: boolean; error?: string }>(
        `/api/guests?id=${g.id}`,
        getCachedUser(),
        { method: 'DELETE' }
      )
      if (res && res.error) {
        alert(res.error)
      } else {
        await load()
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not delete guest')
    } finally {
      setBusy(false)
    }
  }

  async function saveEdit() {
    if (!editGuest) return
    setBusy(true)
    try {
      await apiAs('/api/guests', getCachedUser(), {
        method: 'POST',
        body: JSON.stringify({
          phone: editGuest.phone,
          name: editName,
          company: editCompany || undefined,
          gst: editGst || undefined,
          address: editAddress || undefined,
        }),
      })
      setEditGuest(null)
      await load()
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

  const returningGuests = guests.filter((g) => g.bookings.length > 1).length

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Guests</h2>
        <p className="text-xs text-muted-foreground">
          {guests.length} guests saved · {returningGuests} returning · phone auto-fill active at check-in
        </p>
      </div>

      <TableControls
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Name, phone, company, GST…"
        onReset={() => setSearch('')}
        onExport={doExport}
      />

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableTh label="Name" sortKey="name" sort={sort} onToggle={toggle} />
              <TableHead>Phone</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>GST</TableHead>
              <SortableTh label="Stays" sortKey="bookings" sort={sort} onToggle={toggle} className="text-center" />
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(paged as unknown as GuestRow[]).length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                  No guests found.
                </TableCell>
              </TableRow>
            )}
            {(paged as unknown as GuestRow[]).map((g) => (
              <TableRow key={g.id}>
                <TableCell className="font-medium">
                  {g.name}
                  {g.bookings.length > 1 && (
                    <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      returning
                    </span>
                  )}
                </TableCell>
                <TableCell>{g.phone}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{g.company || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{g.gst || '—'}</TableCell>
                <TableCell className="text-center">{g.bookings.length}</TableCell>
                <TableCell className="text-center">
                  <div className="flex justify-center gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => setViewGuest(g)}
                    >
                      <History className="h-3 w-3" /> History
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => openEdit(g)}>
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                      onClick={() => deleteGuest(g)}
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {controls}

      {/* History dialog */}
      <Dialog open={!!viewGuest} onOpenChange={(o) => !o && setViewGuest(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>{viewGuest?.name}</span>
              {viewGuest?.bookings && viewGuest.bookings.length > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  Total Stays: <strong className="text-foreground">{viewGuest.bookings.length}</strong>
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {viewGuest?.phone}
              {viewGuest?.company ? ` · ${viewGuest.company}` : ''}
              {viewGuest?.gst ? ` · GST ${viewGuest.gst}` : ''}
              {viewGuest?.address ? ` · ${viewGuest.address}` : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
            {(viewGuest?.bookings.length || 0) === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No past or active bookings recorded for this guest.
              </div>
            ) : (
              viewGuest?.bookings.map((b) => {
                const latestBill = b.bills?.[0]
                const statusCls =
                  b.status === 'ACTIVE'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                    : b.status === 'BOOKED'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      : b.status === 'CANCELLED'
                        ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                        : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'
                return (
                  <div key={b.id} className="rounded-xl border p-3 text-sm space-y-2 bg-card shadow-xs">
                    <div className="flex items-center justify-between">
                      <div className="font-bold text-base flex items-center gap-2">
                        <span>Room {b.room?.number || '—'}</span>
                        {b.room?.type && (
                          <span className="text-xs font-normal text-muted-foreground">({b.room.type})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusCls}`}>
                          {b.status}
                        </span>
                        <PaymentStatusBadge status={b.paymentStatus} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-1 border-t">
                      <div>
                        <span className="font-medium text-foreground">Duration:</span> {b.days} night{b.days > 1 ? 's' : ''} ({b.guestCount || 1} guest{(b.guestCount || 1) > 1 ? 's' : ''})
                      </div>
                      <div>
                        <span className="font-medium text-foreground">Rate:</span> {formatINR(b.ratePerDay)}/night
                      </div>
                      <div>
                        <span className="font-medium text-foreground">Check-In:</span> {formatDate(b.checkIn)}
                      </div>
                      <div>
                        <span className="font-medium text-foreground">Check-Out:</span> {formatDate(b.checkOut)}
                      </div>
                      {b.advance > 0 && (
                        <div>
                          <span className="font-medium text-emerald-600">Advance:</span> {formatINR(b.advance)}
                        </div>
                      )}
                      {latestBill && (
                        <div>
                          <span className="font-medium text-foreground">Bill Total:</span> {formatINR(latestBill.grandTotal)} ({latestBill.billNumber})
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editGuest} onOpenChange={(o) => !o && setEditGuest(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Guest Profile</DialogTitle>
            <DialogDescription>Phone {editGuest?.phone} — used for auto-fill on next visit.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="g-name">Name</Label>
              <Input id="g-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-company">Company</Label>
              <Input id="g-company" value={editCompany} onChange={(e) => setEditCompany(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-gst">GST Number</Label>
              <Input id="g-gst" value={editGst} onChange={(e) => setEditGst(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-addr">Address</Label>
              <Input id="g-addr" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} />
            </div>
            <Button className="w-full" disabled={busy || !editName.trim()} onClick={saveEdit}>
              Save Profile
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
