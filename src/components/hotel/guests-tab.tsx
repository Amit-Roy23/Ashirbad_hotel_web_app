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
import { PaymentStatusBadge } from './status-badge'
import { TableControls, SortableTh, useSort, usePagination } from './table-controls'
import { api, apiAs, formatINR, formatDate, formatDateTime, exportCSV, GovIdType, GOV_ID_TYPES, validateGovId, parseGovId, formatGovIdDisplay } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { Loader2, History, Pencil, Trash2, ShieldCheck, AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { AdminDeleteDialog } from './admin-delete-dialog'

interface DueItem {
  billId: string
  billNumber: string
  bookingId: string
  roomNumber: string
  checkIn: string
  checkOut: string | null
  actualCheckOut: string | null
  checkoutDate: string
  days: number
  grandTotal: number
  paidTotal: number
  balanceDue: number
  paymentStatus: string
  status: string
  createdAt: string
}

interface Bill {
  id: string
  billNumber: string
  grandTotal: number
  payCash?: number
  payUpi?: number
  payCard?: number
  advanceApplied?: number
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
  idProof?: string | null
  createdAt: string
  totalDue?: number
  dueHistory?: DueItem[]
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
  const [editIdType, setEditIdType] = useState<GovIdType>('AADHAAR')
  const [editIdNumber, setEditIdNumber] = useState('')
  const [editCompany, setEditCompany] = useState('')
  const [editGst, setEditGst] = useState('')
  const [editAddress, setEditAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<GuestRow | null>(null)

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
      'guests-report.csv',
      ['Name', 'Phone Number', 'ID Proof and Number', 'Staying Date (From - To)'],
      (filtered as unknown as GuestRow[]).map((g) => {
        const stayDates =
          g.bookings && g.bookings.length > 0
            ? g.bookings
                .map((b) => `${formatDate(b.checkIn)} to ${b.checkOut ? formatDate(b.checkOut) : 'Present'}`)
                .join('; ')
            : '—'
        return [
          g.name,
          g.phone,
          g.idProof ? formatGovIdDisplay(g.idProof) : '—',
          stayDates,
        ]
      })
    )
  }

  function openEdit(g: GuestRow) {
    setEditGuest(g)
    setEditName(g.name)
    if (g.idProof) {
      const parsed = parseGovId(g.idProof)
      setEditIdType(parsed.idType)
      setEditIdNumber(parsed.idNumber)
    } else {
      setEditIdType('AADHAAR')
      setEditIdNumber('')
    }
    setEditCompany(g.company || '')
    setEditGst(g.gst || '')
    setEditAddress(g.address || '')
  }

  async function saveEdit() {
    if (!editGuest) return
    const idCheck = editIdNumber.trim() ? validateGovId(editIdType, editIdNumber) : null
    if (idCheck && !idCheck.valid) {
      alert(idCheck.error || 'Invalid ID proof')
      return
    }
    setBusy(true)
    try {
      await apiAs('/api/guests', getCachedUser(), {
        method: 'POST',
        body: JSON.stringify({
          phone: editGuest.phone,
          name: editName,
          idProof: idCheck ? idCheck.formatted : editIdNumber.trim() ? editIdNumber : undefined,
          // Send empty strings (not undefined) so a cleared field is actually cleared
          company: editCompany.trim(),
          gst: editGst.trim(),
          address: editAddress.trim(),
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
              <TableHead>ID Proof</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>GST</TableHead>
              <SortableTh label="Stays" sortKey="bookings" sort={sort} onToggle={toggle} className="text-center" />
              <TableHead className="text-right">Outstanding Due</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(paged as unknown as GuestRow[]).length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
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
                <TableCell>
                  {g.idProof ? (
                    <span className="inline-flex items-center gap-1 rounded bg-muted/60 px-1.5 py-0.5 text-xs font-mono font-medium text-foreground">
                      <ShieldCheck className="h-3 w-3 text-emerald-600 shrink-0" />
                      {formatGovIdDisplay(g.idProof)}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{g.company || '—'}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{g.gst || '—'}</TableCell>
                <TableCell className="text-center">{g.bookings.length}</TableCell>
                <TableCell className="text-right font-medium">
                  {g.totalDue && g.totalDue > 0.01 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700 dark:bg-red-950 dark:text-red-300">
                      {formatINR(g.totalDue)}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">₹0</span>
                  )}
                </TableCell>
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
                      onClick={() => setDeleteTarget(g)}
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
              {viewGuest?.idProof ? ` · ${formatGovIdDisplay(viewGuest.idProof)}` : ''}
              {viewGuest?.company ? ` · ${viewGuest.company}` : ''}
              {viewGuest?.gst ? ` · GST ${viewGuest.gst}` : ''}
              {viewGuest?.address ? ` · ${viewGuest.address}` : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
            {/* Outstanding Past Due Alert in History Dialog */}
            {viewGuest?.totalDue && viewGuest.totalDue > 0.01 && (
              <div className="rounded-lg border-2 border-red-500/80 bg-red-50 p-3 dark:border-red-600 dark:bg-red-950/40 text-red-950 dark:text-red-100 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-red-700 dark:text-red-400">
                    <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
                    <span>OUTSTANDING DUE PAYMENT RECORD</span>
                  </div>
                  <Badge variant="destructive" className="font-bold text-[11px] px-2 py-0.5">
                    Total Due: {formatINR(viewGuest.totalDue)}
                  </Badge>
                </div>
                <p className="text-[11px] text-red-800 dark:text-red-300">
                  This guest currently has <strong>{viewGuest.dueHistory?.length || 1} unpaid bill(s)</strong> totaling <strong>{formatINR(viewGuest.totalDue)}</strong> from past checkout(s):
                </p>
                <div className="space-y-1.5">
                  {viewGuest.dueHistory?.map((due) => (
                    <div key={due.billId || due.billNumber} className="rounded border border-red-200 bg-white/90 dark:bg-red-900/30 p-2 text-xs flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-foreground text-xs">
                          Room {due.roomNumber} • Invoice #{due.billNumber}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          Checked out on: <span className="font-medium text-foreground">{formatDateTime(due.checkoutDate)}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-red-600 dark:text-red-400 text-xs">{formatINR(due.balanceDue)}</div>
                        <div className="text-[10px] text-muted-foreground">Billed: {formatINR(due.grandTotal)} | Paid: {formatINR(due.paidTotal)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
            <div className="space-y-2 rounded-lg border bg-muted/30 p-2.5">
              <Label className="text-xs font-semibold flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                Govt. ID Proof
              </Label>
              <div className="grid grid-cols-1 gap-2">
                <Select value={editIdType} onValueChange={(val: GovIdType) => setEditIdType(val)}>
                  <SelectTrigger className="h-8 text-xs bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GOV_ID_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value} className="text-xs">
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  placeholder={GOV_ID_TYPES.find((t) => t.value === editIdType)?.placeholder || 'ID Number'}
                  value={editIdNumber}
                  onChange={(e) => {
                    const raw = e.target.value
                    if (editIdType === 'AADHAAR') {
                      setEditIdNumber(raw.replace(/\D/g, '').slice(0, 12))
                    } else {
                      setEditIdNumber(raw.toUpperCase())
                    }
                  }}
                  className="h-8 text-xs font-mono uppercase bg-background"
                />
              </div>
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

      {/* Admin PIN Protected Delete Dialog */}
      <AdminDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Guest Profile"
        itemType="Guest"
        itemName={deleteTarget ? `${deleteTarget.name} (${deleteTarget.phone})` : ''}
        warningNotice="Deleting this guest profile requires an Admin PIN or Password."
        onConfirm={async (adminPin) => {
          if (!deleteTarget) return
          const res = await apiAs<{ success?: boolean; error?: string }>(
            `/api/guests?id=${deleteTarget.id}`,
            getCachedUser(),
            { method: 'DELETE', adminPin }
          )
          if (res && res.error) {
            throw new Error(res.error)
          }
          await load()
        }}
      />
    </div>
  )
}
