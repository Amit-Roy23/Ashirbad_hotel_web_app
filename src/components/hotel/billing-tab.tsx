'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { GenerateBillDialog } from './generate-bill-dialog'
import { EditBillDialog } from './edit-bill-dialog'
import { EditAdvanceBookingDialog } from './edit-advance-booking-dialog'
import { PrintableInvoice } from './printable-invoice'
import { PrintableAdvanceReceipt } from './printable-advance-receipt'
import { triggerPrintInvoice, triggerPrintAdvanceReceipt } from '@/lib/print-invoice'
import { api, apiAs, formatINR, formatDate, formatDateTime, exportCSV, totalReceived, balanceDue, payableNow } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import {
  Loader2,
  Receipt,
  Building2,
  Printer,
  Wallet,
  AlertCircle,
  Trash2,
  Edit3,
  CalendarCheck,
  CreditCard,
  Banknote,
  Smartphone,
  Eye,
  CheckCircle2,
} from 'lucide-react'

interface Guest {
  id: string
  name: string
  phone: string
  company?: string
  gst?: string
}

interface Room {
  id: string
  number: string
  type: string
}

interface Booking {
  id: string
  checkIn: string
  checkOut?: string | null
  originalCheckOut?: string | null
  actualCheckOut?: string | null
  autoExtendedDays?: number
  days: number
  ratePerDay: number
  advance: number
  status: string
  paymentStatus: string
  isCorporate: boolean
  createdAt?: string
  room: Room
  guest: Guest
  foodOrders: { id: string; total: number }[]
  bills: { id: string; grandTotal: number; payCash: number; payUpi: number; payCard: number }[]
}

interface Bill {
  id: string
  billNumber: string
  days: number
  actualRoomTotal: number
  billedRoomTotal: number
  roomNumber?: string | null
  roomDescription?: string | null
  gstPercent: number
  actualGst: number
  internalGst?: number
  internalTotal?: number
  foodTotal: number
  extraCharges: number
  discount: number
  grandTotal: number
  payCash: number
  payUpi: number
  payCard: number
  advanceApplied: number
  isCorporate: boolean
  corporateName?: string | null
  gstNumber?: string | null
  createdBy?: string | null
  approvedBy?: string | null
  notes?: string | null
  createdAt: string
  booking: Booking
}

interface TabProps {
  refreshKey: number
  onDataChanged: () => void
  initialFilter?: string
}

export function BillingTab({ refreshKey, onDataChanged, initialFilter }: TabProps) {
  const [activeTab, setActiveTab] = useState<'CHECKOUT' | 'BOOKING'>('CHECKOUT')
  const [allBookings, setAllBookings] = useState<Booking[]>([])
  const [bills, setBills] = useState<Bill[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Booking | null>(null)
  const [busy, setBusy] = useState(false)

  const [lastBill, setLastBill] = useState<Bill | null>(null)
  const [selectedAdvanceBooking, setSelectedAdvanceBooking] = useState<Booking | null>(null)
  const [editBill, setEditBill] = useState<Bill | null>(null)
  const [editAdvanceBooking, setEditAdvanceBooking] = useState<Booking | null>(null)

  // List filters - Checkout Bills
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [kind, setKind] = useState('ALL') // ALL | GST | NON_GST | CUSTOM | PAID | UNPAID

  // List filters - Booking Bills
  const [advSearch, setAdvSearch] = useState('')
  const [advFrom, setAdvFrom] = useState('')
  const [advTo, setAdvTo] = useState('')

  // Collect payment dialog
  const [collectBill, setCollectBill] = useState<Bill | null>(null)
  const [cCash, setCCash] = useState('0')
  const [cUpi, setCUpi] = useState('0')
  const [cCard, setCCard] = useState('0')
  const [error, setError] = useState('')

  useEffect(() => {
    if (initialFilter) setSearch(initialFilter)
  }, [initialFilter])

  const load = useCallback(async () => {
    try {
      const [allBData, billData, s] = await Promise.all([
        api<Booking[]>('/api/bookings'),
        api<Bill[]>('/api/bills'),
        api<Record<string, string>>('/api/settings'),
      ])
      setAllBookings(allBData)
      setBills(billData)
      setSettings(s)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const inHouseBookings = useMemo(() => allBookings.filter((b) => b.status === 'ACTIVE'), [allBookings])
  const advanceBookings = useMemo(() => allBookings.filter((b) => b.advance > 0 || b.status === 'BOOKED'), [allBookings])

  const num = (v: string) => parseFloat(v) || 0
  const paidOf = (b: Bill) => totalReceived(b)
  const balanceOf = (b: Bill) => balanceDue(b)
  const outstandingBills = useMemo(() => bills.filter((b) => balanceOf(b) > 0.01), [bills])

  async function collectPayment() {
    if (!collectBill) return
    const amount = num(cCash) + num(cUpi) + num(cCard)
    if (amount <= 0) {
      setError('Enter a payment amount')
      return
    }
    setBusy(true)
    setError('')
    try {
      await apiAs('/api/bills', getCachedUser(), {
        method: 'POST',
        body: JSON.stringify({
          action: 'payment',
          id: collectBill.id,
          payCash: num(cCash),
          payUpi: num(cUpi),
          payCard: num(cCard),
        }),
      })
      setCollectBill(null)
      setCCash('0')
      setCUpi('0')
      setCCard('0')
      await load()
      onDataChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed')
    } finally {
      setBusy(false)
    }
  }

  async function deleteBill(bill: Bill) {
    if (!confirm(`Are you sure you want to delete Invoice ${bill.billNumber} (${formatINR(bill.grandTotal)})?`)) return
    setBusy(true)
    try {
      const res = await apiAs<{ success?: boolean; error?: string }>(
        `/api/bills?id=${bill.id}`,
        getCachedUser(),
        { method: 'DELETE' }
      )
      if (res && res.error) {
        alert(res.error)
      } else {
        if (lastBill?.id === bill.id) setLastBill(null)
        await load()
        onDataChanged()
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not delete invoice')
    } finally {
      setBusy(false)
    }
  }

  // Filtered checkout bills
  const filteredBills = useMemo(() => {
    const q = search.trim().toLowerCase()
    return bills.filter((b) => {
      if (q) {
        const hay = `${b.billNumber} ${b.booking?.guest?.name || ''} ${b.booking?.guest?.phone || ''} ${b.roomNumber || b.booking?.room?.number || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (from && new Date(b.createdAt).toISOString().slice(0, 10) < from) return false
      if (to && new Date(b.createdAt).toISOString().slice(0, 10) > to) return false
      if (kind === 'CUSTOM' && !b.isCorporate) return false
      if (kind === 'GST' && (!b.actualGst || b.actualGst <= 0)) return false
      if (kind === 'NON_GST' && b.actualGst > 0) return false
      if (kind === 'PAID' && balanceOf(b) > 0.01) return false
      if (kind === 'UNPAID' && balanceOf(b) <= 0.01) return false
      return true
    })
  }, [bills, search, from, to, kind])

  const { sorted: sortedBills, sort: sortBills, toggle: toggleSortBills } = useSort<Record<string, unknown>>(
    filteredBills as unknown as Record<string, unknown>[],
    'createdAt'
  )
  const { paged: pagedBills, controls: billControls } = usePagination(sortedBills as unknown as Bill[], 10)

  // Filtered booking advance receipts
  const filteredAdvanceBookings = useMemo(() => {
    const q = advSearch.trim().toLowerCase()
    return advanceBookings.filter((b) => {
      if (q) {
        const hay = `${b.guest?.name || ''} ${b.guest?.phone || ''} ${b.room?.number || ''} ${b.guest?.company || ''} ADV-${b.id}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      const created = b.createdAt ? new Date(b.createdAt).toISOString().slice(0, 10) : ''
      if (advFrom && created && created < advFrom) return false
      if (advTo && created && created > advTo) return false
      return true
    })
  }, [advanceBookings, advSearch, advFrom, advTo])

  const { sorted: sortedAdvance, sort: sortAdvance, toggle: toggleSortAdvance } = useSort<Record<string, unknown>>(
    filteredAdvanceBookings as unknown as Record<string, unknown>[],
    'createdAt'
  )
  const { paged: pagedAdvance, controls: advanceControls } = usePagination(sortedAdvance as unknown as Booking[], 10)

  function doExportCheckout() {
    exportCSV(
      'checkout_invoices.csv',
      ['Invoice', 'Date', 'Guest', 'Phone', 'Room', 'Actual Room', 'Billed Room', 'Food', 'GST', 'Grand Total', 'Advance Applied', 'Paid at Checkout', 'Balance Due', 'Status'],
      (filteredBills as unknown as Bill[]).map((b) => [
        b.billNumber,
        formatDateTime(b.createdAt),
        b.booking?.guest?.name || '',
        b.booking?.guest?.phone || '',
        b.roomNumber || b.booking?.room?.number || '',
        b.actualRoomTotal,
        b.billedRoomTotal,
        b.foodTotal,
        b.actualGst,
        b.grandTotal,
        b.advanceApplied,
        paidOf(b) - (b.advanceApplied || 0),
        balanceOf(b),
        balanceOf(b) <= 0.01 ? 'PAID' : 'PARTIAL',
      ])
    )
  }

  function doExportBooking() {
    exportCSV(
      'advance_booking_bills.csv',
      ['Receipt No', 'Date', 'Guest', 'Phone', 'Room', 'Check-In', 'Check-Out', 'Nights', 'Rate/Night', 'Estimated Stay Value', 'Advance Paid', 'Balance on Checkout', 'Status'],
      (filteredAdvanceBookings as unknown as Booking[]).map((b) => [
        `ADV-${b.id.slice(-6).toUpperCase()}`,
        formatDateTime(b.createdAt),
        b.guest?.name || '',
        b.guest?.phone || '',
        b.room?.number || '',
        formatDate(b.checkIn),
        formatDate(b.checkOut),
        b.days,
        b.ratePerDay,
        b.ratePerDay * b.days,
        b.advance,
        Math.max(0, b.ratePerDay * b.days - b.advance),
        'PAID',
      ])
    )
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Top Segmented Tabs: Checkout Bills vs Booking Bills */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-2 shadow-xs">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={activeTab === 'CHECKOUT' ? 'default' : 'ghost'}
            className={
              activeTab === 'CHECKOUT'
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }
            onClick={() => setActiveTab('CHECKOUT')}
          >
            <Receipt className="mr-2 h-4 w-4" />
            Checkout Bills (Final Settlement Invoices)
            <Badge variant="secondary" className="ml-2 bg-white/20 text-current">
              {bills.length}
            </Badge>
          </Button>

          <Button
            variant={activeTab === 'BOOKING' ? 'default' : 'ghost'}
            className={
              activeTab === 'BOOKING'
                ? 'bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-xs'
                : 'text-muted-foreground hover:text-foreground'
            }
            onClick={() => setActiveTab('BOOKING')}
          >
            <CalendarCheck className="mr-2 h-4 w-4" />
            Booking Bills (Advance Receipts)
            <Badge variant="secondary" className="ml-2 bg-white/20 text-current">
              {advanceBookings.length}
            </Badge>
          </Button>
        </div>

        <div className="text-xs text-muted-foreground px-2">
          {activeTab === 'CHECKOUT'
            ? `${inHouseBookings.length} guest(s) ready to checkout`
            : `${formatINR(advanceBookings.reduce((s, b) => s + (b.advance || 0), 0))} total advance collected`}
        </div>
      </div>

      {/* ========================================================= */}
      {/* TAB 1: CHECKOUT BILLS (FINAL INVOICES) */}
      {/* ========================================================= */}
      {activeTab === 'CHECKOUT' && (
        <div className="space-y-5">
          {/* In-house guests to bill */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground">
                In-House Guests — Ready for Checkout &amp; Final Billing
              </h3>
              <span className="text-xs text-muted-foreground">Click to generate settlement invoice</span>
            </div>

            {inHouseBookings.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed py-8 text-center text-sm text-muted-foreground">
                No in-house guests currently staying.
              </div>
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {inHouseBookings.map((b) => {
                  const estStay = b.days * b.ratePerDay
                  const foodTotal = (b.foodOrders || []).reduce((s, o) => s + o.total, 0)
                  const estTotal = estStay + foodTotal
                  const estPayable = Math.max(0, estTotal - (b.advance || 0))
                  return (
                    <button
                      key={b.id}
                      onClick={() => setSelected(b)}
                      className="flex flex-col justify-between rounded-xl border bg-card p-3.5 text-left transition-all hover:border-emerald-500 hover:shadow-md active:scale-[0.99]"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="rounded-md bg-emerald-700 px-2 py-0.5 text-xs font-bold text-white">
                              Room {b.room?.number}
                            </span>
                            <span className="font-semibold text-sm">{b.guest?.name || 'Guest'}</span>
                          </div>
                          {b.isCorporate && (
                            <Badge variant="outline" className="h-4 border-violet-400 px-1 text-[9px] text-violet-700 dark:text-violet-300">
                              CORP
                            </Badge>
                          )}
                        </div>

                        <p className="text-xs text-muted-foreground">
                          {(() => {
                            const autoDays = b.autoExtendedDays || 0
                            const plannedNights = Math.max(1, b.days - autoDays)
                            return autoDays > 0 ? (
                              <span>Planned {plannedNights}n + {autoDays} auto-extended day(s) = {b.days}d</span>
                            ) : (
                              <span>{b.days} night{b.days > 1 ? 's' : ''}</span>
                            )
                          })()} × {formatINR(b.ratePerDay)} = <b>{formatINR(estStay)}</b>
                          {foodTotal > 0 && ` • Food: ${formatINR(foodTotal)}`}
                        </p>
                      </div>

                      <div className="mt-3 flex items-center justify-between border-t pt-2 text-xs">
                        {b.advance > 0 ? (
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">
                            Advance Paid: <b>{formatINR(b.advance)}</b>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">No advance paid</span>
                        )}

                        <span className="font-bold text-slate-900 dark:text-white">
                          Payable: {formatINR(estPayable)}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Outstanding balances */}
          <Card className="border-red-200 dark:border-red-900">
            <CardContent className="p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  <p className="text-sm font-semibold">
                    Outstanding Balances — {formatINR(outstandingBills.reduce((s, b) => s + balanceOf(b), 0))}
                  </p>
                </div>
                <Badge variant="outline" className="text-red-600 border-red-300 dark:border-red-800">
                  {outstandingBills.length} unpaid / partial bill(s)
                </Badge>
              </div>

              {outstandingBills.length === 0 ? (
                <p className="text-xs text-muted-foreground">All checkout bills are fully settled. No pending balance.</p>
              ) : (
                <ul className="max-h-52 space-y-1.5 overflow-y-auto">
                  {outstandingBills.map((b) => (
                    <li key={b.id} className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm">
                      <div>
                        <span className="font-medium">{b.billNumber}</span>
                        <span className="ml-2 text-xs text-muted-foreground">
                          {b.booking?.guest?.name || 'Guest'} · Room {b.roomNumber || b.booking?.room?.number}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <PaymentStatusBadge status={balanceOf(b) >= b.grandTotal ? 'UNPAID' : 'PARTIAL'} />
                        <span className="font-bold text-red-600">{formatINR(balanceOf(b))}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-xs font-semibold bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
                          onClick={() => {
                            setCollectBill(b)
                            setCCash(String(balanceOf(b)))
                            setCUpi('0')
                            setCCard('0')
                            setError('')
                          }}
                        >
                          <Wallet className="h-3 w-3" /> Collect &amp; Mark Paid
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="Delete Invoice"
                          onClick={() => deleteBill(b)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Checkout Invoice history */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground">Checkout Invoices History</h3>
            </div>

            <TableControls
              search={search}
              onSearch={setSearch}
              searchPlaceholder="Invoice no, guest, room…"
              filters={[
                {
                  key: 'kind',
                  label: 'Type',
                  options: [
                    { value: 'GST', label: 'GST Tax Invoices' },
                    { value: 'NON_GST', label: 'Non-GST Bills' },
                    { value: 'CUSTOM', label: 'Custom / Corp' },
                    { value: 'PAID', label: 'Fully Paid' },
                    { value: 'UNPAID', label: 'With Balance' },
                  ],
                },
              ]}
              filterValues={{ kind }}
              onFilterChange={(k, v) => k === 'kind' && setKind(v)}
              onReset={() => {
                setSearch('')
                setFrom('')
                setTo('')
                setKind('ALL')
              }}
              onExport={doExportCheckout}
            >
              <div className="flex items-center gap-1.5">
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[145px] text-xs" aria-label="From date" />
                <span className="text-xs text-muted-foreground font-medium">to</span>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[145px] text-xs" aria-label="To date" />
              </div>
            </TableControls>

            <div className="mt-2 rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh label="Invoice" sortKey="billNumber" sort={sortBills} onToggle={toggleSortBills} />
                    <TableHead>Guest</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>Billed Amount</TableHead>
                    <TableHead>Settlement</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedBills.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                        No checkout invoices found.
                      </TableCell>
                    </TableRow>
                  )}
                  {pagedBills.map((b) => {
                    const isPaid = balanceOf(b) <= 0.01
                    const checkoutPaid = (b.payCash || 0) + (b.payUpi || 0) + (b.payCard || 0)
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="py-2.5">
                          <div className="flex items-center gap-1">
                            <span className="font-semibold text-xs sm:text-sm">{b.billNumber}</span>
                            <Badge variant="outline" className="h-4 border-emerald-400 px-1 text-[9px] text-emerald-700 dark:text-emerald-300">
                              FINAL
                            </Badge>
                            {(b.billedRoomTotal !== b.actualRoomTotal || (b.roomNumber && b.roomNumber !== b.booking?.room?.number)) && (
                              <Badge variant="outline" className="h-4 border-violet-400 px-1 text-[9px] text-violet-700 dark:text-violet-300">
                                CUSTOM
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground">{formatDate(b.createdAt)}</div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="text-xs sm:text-sm font-medium">{b.booking?.guest?.name || 'Guest'}</div>
                          <div className="text-[11px] text-muted-foreground">{b.booking?.guest?.phone}</div>
                        </TableCell>
                        <TableCell className="py-2.5 font-semibold text-xs">
                          Room {b.roomNumber || b.booking?.room?.number}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="font-bold text-xs sm:text-sm">{formatINR(b.grandTotal)}</div>
                          {b.advanceApplied > 0 && (
                            <div className="text-[11px] text-emerald-700 dark:text-emerald-400 font-medium">
                              Adv: -{formatINR(b.advanceApplied)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="font-medium text-xs sm:text-sm">{formatINR(checkoutPaid)}</div>
                          {!isPaid && (
                            <div className="text-[11px] text-red-600 font-semibold">
                              Due: {formatINR(balanceOf(b))}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5">
                          <PaymentStatusBadge status={isPaid ? 'PAID' : paidOf(b) > 0 ? 'PARTIAL' : 'UNPAID'} />
                        </TableCell>
                        <TableCell className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-7 w-7 border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800 dark:hover:bg-emerald-950/40"
                              title="View Bill"
                              onClick={() => setLastBill(b)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/40"
                              title="Edit Bill & GST"
                              onClick={() => setEditBill(b)}
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              title="Delete Invoice"
                              onClick={() => deleteBill(b)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            {billControls}
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* TAB 2: BOOKING BILLS (ADVANCE RECEIPTS) */}
      {/* ========================================================= */}
      {activeTab === 'BOOKING' && (
        <div className="space-y-5">
          {/* Summary Stat Cards for Advance Bookings */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-transparent dark:border-amber-900 dark:from-amber-950/40">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-full bg-amber-100 p-2.5 dark:bg-amber-900">
                  <Banknote className="h-5 w-5 text-amber-700 dark:text-amber-300" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Total Advance Received</p>
                  <p className="text-xl font-bold text-amber-900 dark:text-amber-200">
                    {formatINR(advanceBookings.reduce((s, b) => s + (b.advance || 0), 0))}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-transparent dark:border-emerald-900 dark:from-emerald-950/40">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-full bg-emerald-100 p-2.5 dark:bg-emerald-900">
                  <CalendarCheck className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Advance Booking Receipts</p>
                  <p className="text-xl font-bold">{advanceBookings.length}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-transparent dark:border-blue-900 dark:from-blue-950/40 sm:col-span-1 col-span-2">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="rounded-full bg-blue-100 p-2.5 dark:bg-blue-900">
                  <CheckCircle2 className="h-5 w-5 text-blue-700 dark:text-blue-300" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Upcoming Booked Reservations</p>
                  <p className="text-xl font-bold">
                    {allBookings.filter((b) => b.status === 'BOOKED').length}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Booking Bills Table */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Advance Booking Bills &amp; Receipts
              </h3>
            </div>

            <TableControls
              search={advSearch}
              onSearch={setAdvSearch}
              searchPlaceholder="Receipt no, guest, room, phone…"
              filterValues={{}}
              onFilterChange={() => {}}
              onReset={() => {
                setAdvSearch('')
                setAdvFrom('')
                setAdvTo('')
              }}
              onExport={doExportBooking}
            >
              <div className="flex items-center gap-1.5">
                <Input type="date" value={advFrom} onChange={(e) => setAdvFrom(e.target.value)} className="h-9 w-[145px] text-xs" aria-label="From date" />
                <span className="text-xs text-muted-foreground font-medium">to</span>
                <Input type="date" value={advTo} onChange={(e) => setAdvTo(e.target.value)} className="h-9 w-[145px] text-xs" aria-label="To date" />
              </div>
            </TableControls>

            <div className="mt-2 rounded-lg border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh label="Receipt No" sortKey="id" sort={sortAdvance} onToggle={toggleSortAdvance} />
                    <TableHead>Guest</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>Stay Dates</TableHead>
                    <TableHead>Advance Paid</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pagedAdvance.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                        No advance booking bills found.
                      </TableCell>
                    </TableRow>
                  )}
                  {pagedAdvance.map((b) => {
                    const receiptNo = `ADV-${b.id.slice(-6).toUpperCase()}`
                    const stayTotal = (b.ratePerDay || 0) * (b.days || 1)
                    const estBalance = Math.max(0, stayTotal - (b.advance || 0))
                    return (
                      <TableRow key={b.id}>
                        <TableCell className="py-2.5">
                          <div className="font-semibold text-xs sm:text-sm text-amber-900 dark:text-amber-200">
                            {receiptNo}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {b.createdAt ? formatDate(b.createdAt) : formatDate(new Date())}
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="text-xs sm:text-sm font-medium">{b.guest?.name || 'Guest'}</div>
                          <div className="text-[11px] text-muted-foreground">{b.guest?.phone}</div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="font-semibold text-xs">Room {b.room?.number}</div>
                          <div className="text-[11px] text-muted-foreground">{b.room?.type}</div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="text-xs">{formatDate(b.checkIn)} → {formatDate(b.checkOut)}</div>
                          <div className="text-[11px] text-muted-foreground">{b.days} night{b.days > 1 ? 's' : ''}</div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="font-bold text-xs sm:text-sm text-emerald-700 dark:text-emerald-400">
                            {formatINR(b.advance || 0)}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            Est: {formatINR(stayTotal)}{estBalance > 0 ? ` · Due: ${formatINR(estBalance)}` : ''}
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <div className="flex flex-col gap-1 items-start">
                            <PaymentStatusBadge status="PAID" />
                            <Badge variant="outline" className="h-4 border-amber-400 px-1 text-[9px] text-amber-800 dark:text-amber-300">
                              {b.status === 'BOOKED' ? 'RESERVED' : b.status}
                            </Badge>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-7 w-7 border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
                              title="View Receipt"
                              onClick={() => setSelectedAdvanceBooking(b)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:bg-amber-50 hover:text-amber-800 dark:hover:bg-amber-950/40"
                              title="Edit Advance Booking Bill"
                              onClick={() => setEditAdvanceBooking(b)}
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                              title="Print Receipt"
                              onClick={() => triggerPrintAdvanceReceipt(b, settings)}
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            {advanceControls}
          </div>
        </div>
      )}

      {/* Checkout Bill Generator Dialog */}
      <GenerateBillDialog
        open={!!selected}
        onOpenChange={(o) => !o && setSelected(null)}
        booking={selected}
        defaultGstPercent={settings.gstPercent}
        onSuccess={(bill) => {
          setLastBill(bill as unknown as Bill)
          load()
          onDataChanged()
        }}
      />

      {/* Collect outstanding payment modal */}
      <Dialog open={!!collectBill} onOpenChange={(o) => !o && setCollectBill(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Collect Payment — {collectBill?.billNumber}</DialogTitle>
            <DialogDescription>
              {collectBill?.booking?.guest?.name} · Room {collectBill?.roomNumber || collectBill?.booking?.room?.number} · Outstanding{' '}
              <b>{formatINR(collectBill ? balanceOf(collectBill) : 0)}</b>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px]">Cash</Label>
                <Input type="number" value={cCash} onChange={(e) => setCCash(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">UPI</Label>
                <Input type="number" value={cUpi} onChange={(e) => setCUpi(e.target.value)} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Card</Label>
                <Input type="number" value={cCard} onChange={(e) => setCCard(e.target.value)} className="h-9" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Recording {formatINR(num(cCash) + num(cUpi) + num(cCard))} against {formatINR(collectBill ? balanceOf(collectBill) : 0)} due.
            </p>
            {error && <p className="text-sm font-medium text-destructive">{error}</p>}
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={collectPayment} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record Payment &amp; Mark Paid
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Checkout Invoice preview (printable) */}
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
                <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold" onClick={() => triggerPrintInvoice(lastBill, settings)}>
                  <Printer className="mr-2 h-4 w-4" /> Print / Save PDF
                </Button>
                <Button variant="outline" onClick={() => setEditBill(lastBill)}>
                  <Edit3 className="mr-2 h-4 w-4 text-emerald-600" /> Edit Bill
                </Button>
                <Button variant="destructive" onClick={() => deleteBill(lastBill)}>
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Advance Booking Receipt preview (printable) */}
      <Dialog open={!!selectedAdvanceBooking} onOpenChange={(o) => !o && setSelectedAdvanceBooking(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader className="print:hidden">
            <DialogTitle className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
              <CalendarCheck className="h-5 w-5 text-amber-600" /> Advance Booking Receipt
            </DialogTitle>
            <DialogDescription>
              Receipt No: ADV-{selectedAdvanceBooking?.id.slice(-6).toUpperCase()}
            </DialogDescription>
          </DialogHeader>
          {selectedAdvanceBooking && (
            <div className="space-y-3">
              <PrintableAdvanceReceipt booking={selectedAdvanceBooking as any} settings={settings} />
              <div className="flex gap-2 print:hidden">
                <Button
                  className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-semibold"
                  onClick={() => triggerPrintAdvanceReceipt(selectedAdvanceBooking, settings)}
                >
                  <Printer className="mr-2 h-4 w-4" /> Print / Save PDF
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    const toEdit = selectedAdvanceBooking
                    setSelectedAdvanceBooking(null)
                    setEditAdvanceBooking(toEdit)
                  }}
                >
                  <Edit3 className="mr-2 h-4 w-4 text-amber-700" /> Edit Bill
                </Button>
                <Button variant="outline" onClick={() => setSelectedAdvanceBooking(null)}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Bill Dialog */}
      <EditBillDialog
        open={!!editBill}
        onOpenChange={(o) => !o && setEditBill(null)}
        bill={editBill}
        onSuccess={(updatedBill) => {
          setLastBill(updatedBill)
          load()
          onDataChanged()
        }}
      />

      {/* Edit Advance Booking Bill Dialog */}
      <EditAdvanceBookingDialog
        open={!!editAdvanceBooking}
        onOpenChange={(o) => !o && setEditAdvanceBooking(null)}
        booking={editAdvanceBooking as any}
        onSuccess={() => {
          setEditAdvanceBooking(null)
          load()
          onDataChanged()
        }}
      />
    </div>
  )
}
