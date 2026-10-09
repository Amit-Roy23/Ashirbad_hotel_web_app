'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api, apiAs, formatINR, formatDate, formatDateTime, exportCSV, printTableReport, todayStr } from '@/lib/hotel-utils'
import { triggerPrintInvoice } from '@/lib/print-invoice'
import { getCachedUser } from './user-context'
import {
  Loader2,
  Download,
  BedDouble,
  ClipboardList,
  UsersRound,
  Banknote,
  Receipt,
  UtensilsCrossed,
  UsersRound as StaffIcon,
  TrendingDown,
  TrendingUp,
  AlertCircle,
  FileText,
  Trash2,
  Printer,
  Eye,
  Search,
  Building2,
  Phone,
  Mail,
  MapPin,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  CreditCard,
} from 'lucide-react'

export interface GstBillRow {
  id?: string
  billNumber: string
  date: string
  guestName: string
  phone: string
  email?: string | null
  company?: string | null
  guestGst?: string | null
  address?: string | null
  idProof?: string | null
  originalRoomNumber?: string
  roomNumber: string
  roomDescription: string
  days: number
  actualRoomTotal: number
  billedRoomTotal: number
  foodTotal: number
  extraCharges: number
  discount: number
  taxableAmount: number
  gstPercent: number
  actualGst: number
  internalGst: number
  grandTotal: number
  internalTotal: number
  isCustom: boolean
  payCash: number
  payUpi: number
  payCard: number
  advanceApplied: number
  paid: number
  balance: number
  approvedBy?: string | null
  createdBy?: string | null
  status: string
  notes?: string | null
  booking?: any
}

interface ReportData {
  range: { from: string; to: string; days: number }
  occupancy: {
    totalRooms: number
    occupiedNow: number
    vacantNow: number
    occupancyPercent: number
    roomNightsSold: number
    bookingsCount: number
    inHouseGuests: number
  }
  collections: { cash: number; upi: number; card: number; bills: number; directFood: number; advances: number; total: number }
  collectionsDaily: DayCollection[]
  revenue: {
    actualRoomRevenue: number
    billedRoomRevenue: number
    gst: number
    foodRoomPosted: number
    foodDirect: number
    discounts: number
    grandTotal: number
  }
  invoices: {
    count: number
    customCount: number
    rows: {
      id?: string
      billNumber: string
      date: string
      guestName: string
      originalRoomNumber?: string
      roomNumber: string
      actualRoomTotal: number
      billedRoomTotal: number
      roomDescription?: string | null
      foodTotal: number
      gst: number
      internalGst: number
      grandTotal: number
      internalTotal: number
      isCustom: boolean
      approvedBy: string | null
    }[]
  }
  food: {
    ordersCount: number
    roomPostedCount: number
    rows: { id: string; time: string; roomNumber: string | null; tableNo: string | null; items: string; total: number; createdBy: string | null; postedToRoom: boolean }[]
  }
  staff: {
    salaryTotal: number
    advanceTotal: number
    rows: { id?: string; staffName: string; type: string; amount: number; method: string; date: string; recoveryNotes: string | null }[]
  }
  expenses: {
    total: number
    byCategory: Record<string, number>
    rows: { id?: string; date: string; category: string; description: string; amount: number; method: string; vendor: string | null }[]
  }
  outstanding: {
    total: number
    rows: { id?: string; billNumber: string; guestName: string; phone: string; roomNumber: string; grandTotal: number; paid: number; balance: number; createdAt: string }[]
  }
  gstBills: {
    count: number
    normalCount: number
    customCount: number
    totalGstAmount: number
    totalTaxableAmount: number
    totalGrandTotal: number
    totalInternalGst: number
    rows: GstBillRow[]
  }
  bookings: {
    rows: {
      id?: string
      guestName: string
      phone: string
      roomNumber: string
      checkIn: string
      checkOut: string | null
      days: number
      ratePerDay: number
      status: string
      paymentStatus: string
      isCorporate: boolean
    }[]
  }
}

interface DayCollection {
  date: string
  cash: number
  upi: number
  card: number
  bills: number
  directFood: number
  advances: number
  total: number
}

interface TabProps {
  refreshKey: number
  onDataChanged: () => void
  initialFilter?: string
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  iconClassName,
  valueClassName,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
  iconClassName?: string
  valueClassName?: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-full bg-muted p-2.5">
          <Icon className={iconClassName || 'h-5 w-5 text-emerald-700 dark:text-emerald-400'} />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`truncate text-lg font-bold ${valueClassName || ''}`}>{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

export function ReportsTab({ refreshKey }: TabProps) {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [gstSearch, setGstSearch] = useState('')
  const [gstTypeFilter, setGstTypeFilter] = useState<'ALL' | 'NORMAL' | 'CUSTOM'>('ALL')
  const [selectedGstBill, setSelectedGstBill] = useState<GstBillRow | null>(null)

  const [from, setFrom] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(todayStr())
  // Collections tab: '' = whole selected range, otherwise one day (YYYY-MM-DD)
  const [collectionDay, setCollectionDay] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, s] = await Promise.all([
        api<ReportData>(`/api/reports?from=${from}&to=${to}`),
        api<Record<string, string>>('/api/settings').catch(() => ({})),
      ])
      setData(r)
      if (s) setSettings(s)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    load()
  }, [load, refreshKey])


  const filteredGstRows = (data?.gstBills?.rows || []).filter((r) => {
    if (gstTypeFilter === 'NORMAL' && r.isCustom) return false
    if (gstTypeFilter === 'CUSTOM' && !r.isCustom) return false
    if (!gstSearch.trim()) return true
    const q = gstSearch.toLowerCase().trim()
    return (
      r.guestName.toLowerCase().includes(q) ||
      r.phone.toLowerCase().includes(q) ||
      (r.email && r.email.toLowerCase().includes(q)) ||
      (r.company && r.company.toLowerCase().includes(q)) ||
      (r.guestGst && r.guestGst.toLowerCase().includes(q)) ||
      r.billNumber.toLowerCase().includes(q) ||
      r.roomNumber.toLowerCase().includes(q) ||
      (r.address && r.address.toLowerCase().includes(q))
    )
  })

  if (loading && !data) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Reports</h2>
        <p className="text-xs text-muted-foreground">Operational &amp; financial reports for management</p>
      </div>

      {/* Range picker */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="rep-from">From</Label>
            <Input id="rep-from" type="date" value={from} max={todayStr()} onChange={(e) => setFrom(e.target.value)} className="h-9 w-40 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rep-to">To</Label>
            <Input id="rep-to" type="date" value={to} max={todayStr()} onChange={(e) => setTo(e.target.value)} className="h-9 w-40 text-xs" />
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Refresh
          </Button>
          {data && (
            <p className="text-xs text-muted-foreground">
              {data.range.days} day(s) · {data.invoices.count} invoices · {data.gstBills?.count || 0} GST bills · {data.bookings.rows.length} bookings
            </p>
          )}
        </CardContent>
      </Card>

      {data && (() => {
          const netProfit = (data.revenue.grandTotal || 0) - (data.expenses.total || 0)
          const isProfit = netProfit >= 0
          const margin = data.revenue.grandTotal > 0
            ? ((netProfit / data.revenue.grandTotal) * 100).toFixed(1)
            : '0.0'

          return (
            <>
              {/* Summary stat cards */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <StatCard
                  icon={BedDouble}
                  label="Occupancy (now)"
                  value={`${data.occupancy.occupancyPercent}%`}
                  sub={`${data.occupancy.occupiedNow}/${data.occupancy.totalRooms} rooms`}
                />
                <StatCard
                  icon={Banknote}
                  label="Collections"
                  value={formatINR(data.collections.total)}
                  sub={`Cash ${formatINR(data.collections.cash)} · UPI ${formatINR(data.collections.upi)} · Card ${formatINR(data.collections.card)}`}
                />
                <StatCard
                  icon={FileText}
                  label="Revenue (internal)"
                  value={formatINR(data.revenue.grandTotal)}
                  sub={`Room: ${formatINR(data.revenue.actualRoomRevenue)} · Direct Food: ${formatINR(data.revenue.foodDirect)} · GST: ${formatINR(data.revenue.gst)}`}
                />
                <StatCard
                  icon={TrendingDown}
                  iconClassName="h-5 w-5 text-rose-600 dark:text-rose-400"
                  label="Expenses"
                  value={formatINR(data.expenses.total)}
                  sub={`${data.expenses.rows.length} entries`}
                />
                <StatCard
                  icon={isProfit ? TrendingUp : TrendingDown}
                  iconClassName={isProfit ? 'h-5 w-5 text-emerald-600 dark:text-emerald-400' : 'h-5 w-5 text-rose-600 dark:text-rose-400'}
                  valueClassName={isProfit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}
                  label="Net Profit"
                  value={formatINR(netProfit)}
                  sub={`${isProfit ? '+' : ''}${margin}% net margin`}
                />
              </div>

          <Tabs defaultValue="invoices">
            <TabsList className="flex w-full flex-wrap gap-1 sm:w-auto">
              <TabsTrigger value="invoices">Invoices</TabsTrigger>
              <TabsTrigger value="collections">Collections</TabsTrigger>
              <TabsTrigger value="bookings">Bookings</TabsTrigger>
              <TabsTrigger value="food">Food Sales</TabsTrigger>
              <TabsTrigger value="staff">Staff</TabsTrigger>
              <TabsTrigger value="expenses">Expenses</TabsTrigger>
              <TabsTrigger value="outstanding">Outstanding</TabsTrigger>
              <TabsTrigger value="gstBills">GST Bills</TabsTrigger>
            </TabsList>

            {/* ===== Invoice report ===== */}
            <TabsContent value="invoices" className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {data.invoices.count} invoices · {data.invoices.customCount} custom
                </Badge>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      printTableReport(
                        'Invoice Report',
                        ['Invoice', 'Date', 'Guest', 'Original Room', 'Billed Room', 'Actual Room', 'Billed Room Tariff', 'Room Description', 'GST', 'Internal GST', 'Invoice Total', 'Internal Total', 'Custom', 'Approved By'],
                        data.invoices.rows.map((r) => [
                          r.billNumber, formatDateTime(r.date), r.guestName, r.originalRoomNumber || r.roomNumber, r.roomNumber,
                          formatINR(r.actualRoomTotal), formatINR(r.billedRoomTotal), r.roomDescription || '', formatINR(r.gst), formatINR(r.internalGst), formatINR(r.grandTotal), formatINR(r.internalTotal),
                          r.isCustom ? 'Yes' : 'No', r.approvedBy || '',
                        ]),
                        `Date Range: ${formatDate(from)} to ${formatDate(to)}`
                      )
                    }
                  >
                    <Printer className="h-3.5 w-3.5" /> Print
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      exportCSV(
                        'invoice-report.csv',
                        ['Invoice', 'Date', 'Guest', 'Original Room', 'Billed Room', 'Actual Room', 'Billed Room Tariff', 'Room Description', 'GST', 'Internal GST', 'Invoice Total', 'Internal Total', 'Custom', 'Approved By'],
                        data.invoices.rows.map((r) => [
                          r.billNumber, formatDateTime(r.date), r.guestName, r.originalRoomNumber || r.roomNumber, r.roomNumber,
                          r.actualRoomTotal, r.billedRoomTotal, r.roomDescription || '', r.gst, r.internalGst, r.grandTotal, r.internalTotal,
                          r.isCustom ? 'Yes' : 'No', r.approvedBy || '',
                        ])
                      )
                    }
                  >
                    <Download className="h-3.5 w-3.5" /> Export
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Guest</TableHead>
                      <TableHead>Original Room</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Actual</TableHead>
                      <TableHead>Billed</TableHead>
                      <TableHead>Food</TableHead>
                      <TableHead>GST</TableHead>
                      <TableHead>Invoice Total</TableHead>
                      <TableHead>Internal Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.invoices.rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={12} className="py-6 text-center text-sm text-muted-foreground">
                          No invoices in this range.
                        </TableCell>
                      </TableRow>
                    )}
                    {data.invoices.rows.map((r) => (
                      <TableRow key={r.billNumber}>
                        <TableCell className="text-xs font-medium">
                          {r.billNumber}
                          {r.isCustom && (
                            <Badge variant="outline" className="ml-1 h-4 border-violet-400 px-1 text-[9px] text-violet-700 dark:text-violet-300">
                              CUSTOM
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{formatDateTime(r.date)}</TableCell>
                        <TableCell className="text-xs font-medium">{r.guestName}</TableCell>
                        <TableCell className="text-xs font-semibold text-foreground">
                          Room {r.originalRoomNumber || r.roomNumber}
                        </TableCell>
                        <TableCell className={`text-xs ${r.roomNumber && r.originalRoomNumber && r.roomNumber !== r.originalRoomNumber ? 'font-semibold text-violet-700 dark:text-violet-300' : ''}`}>
                          Room {r.roomNumber}
                          {r.roomNumber && r.originalRoomNumber && r.roomNumber !== r.originalRoomNumber && (
                            <span className="ml-1 text-[10px] text-violet-600 font-normal">(Custom)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatINR(r.actualRoomTotal)}</TableCell>
                        <TableCell className={`text-xs ${r.isCustom ? 'font-bold text-violet-700 dark:text-violet-300' : ''}`}>
                          {formatINR(r.billedRoomTotal)}
                        </TableCell>
                        <TableCell className="text-xs">{formatINR(r.foodTotal)}</TableCell>
                        <TableCell className="text-xs">{formatINR(r.gst)}</TableCell>
                        <TableCell className="text-xs font-bold">{formatINR(r.grandTotal)}</TableCell>
                        <TableCell className="text-xs font-medium text-muted-foreground">{formatINR(r.internalTotal)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Internal room revenue kept at actual tariff: <b>{formatINR(data.revenue.actualRoomRevenue)}</b> · Internal revenue (total):{' '}
                <b>{formatINR(data.revenue.grandTotal)}</b> · Internal GST: <b>{formatINR(data.revenue.gst)}</b> · Discounts given: <b>{formatINR(data.revenue.discounts)}</b>
              </p>
            </TabsContent>

            {/* ===== Collections report ===== */}
            <TabsContent value="collections" className="mt-4 space-y-3">
              {(() => {
                const daily = data.collectionsDaily || []
                const day = collectionDay ? daily.find((d) => d.date === collectionDay) : null
                const zero = { cash: 0, upi: 0, card: 0, bills: 0, directFood: 0, advances: 0, total: 0 }
                const c = collectionDay
                  ? day || zero
                  : {
                      cash: data.collections.cash,
                      upi: data.collections.upi,
                      card: data.collections.card,
                      bills: data.collections.bills,
                      directFood: data.collections.directFood,
                      advances: data.collections.advances,
                      total: data.collections.total,
                    }
                return (
                  <>
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="col-day" className="text-xs">Day</Label>
                        <Input
                          id="col-day"
                          type="date"
                          value={collectionDay}
                          min={from}
                          max={to}
                          onChange={(e) => setCollectionDay(e.target.value)}
                          className="h-9 w-40 text-xs"
                        />
                      </div>
                      <Button size="sm" variant={collectionDay === todayStr() ? 'default' : 'outline'} className="h-9" onClick={() => setCollectionDay(todayStr())}>
                        Today
                      </Button>
                      <Button size="sm" variant={collectionDay ? 'outline' : 'default'} className="h-9" onClick={() => setCollectionDay('')}>
                        All days in range
                      </Button>
                      <p className="pb-2 text-xs text-muted-foreground">
                        {collectionDay ? `Showing ${formatDate(collectionDay)}` : `Showing ${formatDate(from)} – ${formatDate(to)}`}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <Card>
                        <CardContent className="p-4 text-center">
                          <p className="text-xs text-muted-foreground">Cash</p>
                          <p className="text-lg font-bold">{formatINR(c.cash)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <p className="text-xs text-muted-foreground">UPI</p>
                          <p className="text-lg font-bold">{formatINR(c.upi)}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="p-4 text-center">
                          <p className="text-xs text-muted-foreground">Card</p>
                          <p className="text-lg font-bold">{formatINR(c.card)}</p>
                        </CardContent>
                      </Card>
                    </div>
                    <div className="space-y-1 rounded-lg bg-muted p-3 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Bill collections (room + food)</span>
                        <span className="font-medium">{formatINR(c.bills)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Direct restaurant (paid at counter)</span>
                        <span className="font-medium">{formatINR(c.directFood)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Guest advances</span>
                        <span className="font-medium">{formatINR(c.advances)}</span>
                      </div>
                      <div className="flex justify-between border-t pt-1 font-bold">
                        <span>Total</span>
                        <span>{formatINR(c.total)}</span>
                      </div>
                    </div>

                    <div className="max-h-96 overflow-y-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Day</TableHead>
                            <TableHead className="text-right">Cash</TableHead>
                            <TableHead className="text-right">UPI</TableHead>
                            <TableHead className="text-right">Card</TableHead>
                            <TableHead className="text-right">Restaurant</TableHead>
                            <TableHead className="text-right">Advances</TableHead>
                            <TableHead className="text-right">Total</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {daily.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
                                No collections in this range.
                              </TableCell>
                            </TableRow>
                          )}
                          {daily.map((d) => (
                            <TableRow
                              key={d.date}
                              className={`cursor-pointer ${d.date === collectionDay ? 'bg-emerald-50 dark:bg-emerald-950/40' : ''}`}
                              onClick={() => setCollectionDay(d.date === collectionDay ? '' : d.date)}
                            >
                              <TableCell className="text-xs font-medium">{formatDate(d.date)}</TableCell>
                              <TableCell className="text-right text-xs">{formatINR(d.cash)}</TableCell>
                              <TableCell className="text-right text-xs">{formatINR(d.upi)}</TableCell>
                              <TableCell className="text-right text-xs">{formatINR(d.card)}</TableCell>
                              <TableCell className="text-right text-xs">{formatINR(d.directFood)}</TableCell>
                              <TableCell className="text-right text-xs">{formatINR(d.advances)}</TableCell>
                              <TableCell className="text-right text-xs font-bold">{formatINR(d.total)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                )
              })()}
            </TabsContent>

            {/* ===== Booking report ===== */}
            <TabsContent value="bookings" className="mt-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{data.occupancy.bookingsCount} bookings</Badge>
                <Badge variant="outline">{data.occupancy.roomNightsSold} room-nights billed</Badge>
                <Badge variant="outline">{data.occupancy.inHouseGuests} in-house now</Badge>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      printTableReport(
                        'Bookings Report',
                        ['Guest', 'Phone', 'Room', 'Check-In', 'Check-Out', 'Nights', 'Rate', 'Status', 'Payment'],
                        data.bookings.rows.map((r) => [
                          r.guestName, r.phone, r.roomNumber, formatDate(r.checkIn), formatDate(r.checkOut),
                          r.days, formatINR(r.ratePerDay), r.status, r.paymentStatus,
                        ]),
                        `Date Range: ${formatDate(from)} to ${formatDate(to)}`
                      )
                    }
                  >
                    <Printer className="h-3.5 w-3.5" /> Print
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      exportCSV(
                        'booking-report.csv',
                        ['Guest', 'Phone', 'Room', 'Check-In', 'Check-Out', 'Nights', 'Rate', 'Status', 'Payment'],
                        data.bookings.rows.map((r) => [
                          r.guestName, r.phone, r.roomNumber, formatDate(r.checkIn), formatDate(r.checkOut),
                          r.days, r.ratePerDay, r.status, r.paymentStatus,
                        ])
                      )
                    }
                  >
                    <Download className="h-3.5 w-3.5" /> Export
                  </Button>
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Guest</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Stay</TableHead>
                      <TableHead>Rate</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Payment</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.bookings.rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                          No bookings in this range.
                        </TableCell>
                      </TableRow>
                    )}
                    {data.bookings.rows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">
                          <div className="font-medium">{r.guestName}</div>
                          <div className="text-muted-foreground">{r.phone}</div>
                        </TableCell>
                        <TableCell className="text-xs">{r.roomNumber}</TableCell>
                        <TableCell className="text-xs">
                          {formatDate(r.checkIn)} → {formatDate(r.checkOut)} ({r.days}n)
                        </TableCell>
                        <TableCell className="text-xs">{formatINR(r.ratePerDay)}</TableCell>
                        <TableCell className="text-xs">{r.status}</TableCell>
                        <TableCell className="text-xs">{r.paymentStatus}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* ===== Food report ===== */}
            <TabsContent value="food" className="mt-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{data.food.ordersCount} orders</Badge>
                <Badge variant="outline">{data.food.roomPostedCount} posted to rooms</Badge>
                <Badge variant="outline">
                  Room-posted: {formatINR(data.revenue.foodRoomPosted)} · Direct: {formatINR(data.revenue.foodDirect)}
                </Badge>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      printTableReport(
                        'Food Sales Report',
                        ['Time', 'Room', 'Table', 'Items', 'Total', 'Posted To Room', 'Taken By'],
                        data.food.rows.map((r) => [
                          formatDateTime(r.time), r.roomNumber || '', r.tableNo || '', r.items, formatINR(r.total),
                          r.postedToRoom ? 'Yes' : 'No', r.createdBy || '',
                        ]),
                        `Date Range: ${formatDate(from)} to ${formatDate(to)}`
                      )
                    }
                  >
                    <Printer className="h-3.5 w-3.5" /> Print
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      exportCSV(
                        'food-sales.csv',
                        ['Time', 'Room', 'Table', 'Items', 'Total', 'Posted To Room', 'Taken By'],
                        data.food.rows.map((r) => [
                          formatDateTime(r.time), r.roomNumber || '', r.tableNo || '', r.items, r.total,
                          r.postedToRoom ? 'Yes' : 'No', r.createdBy || '',
                        ])
                      )
                    }
                  >
                    <Download className="h-3.5 w-3.5" /> Export
                  </Button>
                </div>
              </div>
              <div className="max-h-96 space-y-1.5 overflow-y-auto">
                {data.food.rows.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">No food sales in range.</p>}
                {data.food.rows.map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.items}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatDateTime(r.time)} · {r.roomNumber ? `Room ${r.roomNumber}` : `Table ${r.tableNo}`}
                        {r.createdBy ? ` · by ${r.createdBy}` : ''}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{formatINR(r.total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* ===== Staff report ===== */}
            <TabsContent value="staff" className="mt-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Salary paid: {formatINR(data.staff.salaryTotal)}</Badge>
                <Badge variant="outline">Advances: {formatINR(data.staff.advanceTotal)}</Badge>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      printTableReport(
                        'Staff Payments Report',
                        ['Staff', 'Type', 'Amount', 'Mode', 'Date', 'Recovery Notes'],
                        data.staff.rows.map((r) => [
                          r.staffName, r.type, formatINR(r.amount), r.method, formatDate(r.date), r.recoveryNotes || '',
                        ]),
                        `Date Range: ${formatDate(from)} to ${formatDate(to)}`
                      )
                    }
                  >
                    <Printer className="h-3.5 w-3.5" /> Print
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      exportCSV(
                        'staff-report.csv',
                        ['Staff', 'Type', 'Amount', 'Mode', 'Date', 'Recovery Notes'],
                        data.staff.rows.map((r) => [
                          r.staffName, r.type, r.amount, r.method, formatDate(r.date), r.recoveryNotes || '',
                        ])
                      )
                    }
                  >
                    <Download className="h-3.5 w-3.5" /> Export
                  </Button>
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Mode</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Recovery</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.staff.rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                          No staff payments in range.
                        </TableCell>
                      </TableRow>
                    )}
                    {data.staff.rows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs font-medium">{r.staffName}</TableCell>
                        <TableCell className="text-xs">{r.type}</TableCell>
                        <TableCell className="text-xs">{r.method}</TableCell>
                        <TableCell className="text-xs">{formatDate(r.date)}</TableCell>
                        <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">{r.recoveryNotes || '—'}</TableCell>
                        <TableCell className="text-right text-xs font-bold">{formatINR(r.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* ===== Expense report ===== */}
            <TabsContent value="expenses" className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Total: {formatINR(data.expenses.total)}</Badge>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      printTableReport(
                        'Expenses Report',
                        ['Date', 'Category', 'Description', 'Vendor', 'Mode', 'Amount'],
                        data.expenses.rows.map((r) => [
                          formatDate(r.date), r.category, r.description, r.vendor || '', r.method, formatINR(r.amount),
                        ]),
                        `Date Range: ${formatDate(from)} to ${formatDate(to)}`
                      )
                    }
                  >
                    <Printer className="h-3.5 w-3.5" /> Print
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      exportCSV(
                        'expense-report.csv',
                        ['Date', 'Category', 'Description', 'Vendor', 'Mode', 'Amount'],
                        data.expenses.rows.map((r) => [
                          formatDate(r.date), r.category, r.description, r.vendor || '', r.method, r.amount,
                        ])
                      )
                    }
                  >
                    <Download className="h-3.5 w-3.5" /> Export
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.expenses.byCategory).map(([cat, amt]) => (
                  <span key={cat} className="rounded-lg bg-muted px-3 py-1.5 text-xs">
                    {cat}: <b>{formatINR(amt)}</b>
                  </span>
                ))}
              </div>
              <div className="max-h-96 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.expenses.rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">
                          No expenses in range.
                        </TableCell>
                      </TableRow>
                    )}
                    {data.expenses.rows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-xs">{formatDate(r.date)}</TableCell>
                        <TableCell className="text-xs">{r.category}</TableCell>
                        <TableCell className="max-w-[240px] truncate text-xs">{r.description}</TableCell>
                        <TableCell className="text-right text-xs font-bold">{formatINR(r.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* ===== Outstanding report ===== */}
            <TabsContent value="outstanding" className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-red-600">
                  Total Outstanding: {formatINR(data.outstanding.total)}
                </Badge>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      printTableReport(
                        'Outstanding Due Report',
                        ['Invoice', 'Guest', 'Phone', 'Room', 'Total', 'Paid', 'Balance', 'Date'],
                        data.outstanding.rows.map((r) => [
                          r.billNumber, r.guestName, r.phone, r.roomNumber, formatINR(r.grandTotal), formatINR(r.paid), formatINR(r.balance), formatDate(r.createdAt),
                        ]),
                        `Total Outstanding: ${formatINR(data.outstanding.total)}`
                      )
                    }
                  >
                    <Printer className="h-3.5 w-3.5" /> Print
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      exportCSV(
                        'outstanding-report.csv',
                        ['Invoice', 'Guest', 'Phone', 'Room', 'Total', 'Paid', 'Balance', 'Date'],
                        data.outstanding.rows.map((r) => [
                          r.billNumber, r.guestName, r.phone, r.roomNumber, r.grandTotal, r.paid, r.balance, formatDate(r.createdAt),
                        ])
                      )
                    }
                  >
                    <Download className="h-3.5 w-3.5" /> Export
                  </Button>
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Guest</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Paid</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.outstanding.rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                          Nothing outstanding — all bills collected.
                        </TableCell>
                      </TableRow>
                    )}
                    {data.outstanding.rows.map((r) => (
                      <TableRow key={r.billNumber}>
                        <TableCell className="text-xs font-medium">{r.billNumber}</TableCell>
                        <TableCell className="text-xs">
                          <div>{r.guestName}</div>
                          <div className="text-muted-foreground">{r.phone}</div>
                        </TableCell>
                        <TableCell className="text-xs">{r.roomNumber}</TableCell>
                        <TableCell className="text-xs">{formatINR(r.grandTotal)}</TableCell>
                        <TableCell className="text-xs">{formatINR(r.paid)}</TableCell>
                        <TableCell className="text-right text-xs font-bold text-red-600">{formatINR(r.balance)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* ===== GST Bills report ===== */}
            <TabsContent value="gstBills" className="mt-4 space-y-3">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border bg-card p-3 shadow-sm">
                  <p className="text-[11px] font-medium text-muted-foreground">Total GST Bills</p>
                  <p className="text-lg font-bold text-foreground">
                    {data.gstBills?.count || 0}{' '}
                    <span className="text-xs font-normal text-muted-foreground">
                      ({data.gstBills?.normalCount || 0} Normal · {data.gstBills?.customCount || 0} Custom)
                    </span>
                  </p>
                </div>
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-50/40 p-3 shadow-sm dark:bg-emerald-950/20">
                  <p className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Total GST Paid</p>
                  <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                    {formatINR(data.gstBills?.totalGstAmount || 0)}
                  </p>
                  {(data.gstBills?.customCount || 0) > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      Internal GST: {formatINR(data.gstBills?.totalInternalGst || 0)}
                    </p>
                  )}
                </div>
                <div className="rounded-lg border bg-card p-3 shadow-sm">
                  <p className="text-[11px] font-medium text-muted-foreground">Total Taxable Value</p>
                  <p className="text-lg font-bold text-foreground">
                    {formatINR(data.gstBills?.totalTaxableAmount || 0)}
                  </p>
                </div>
                <div className="rounded-lg border bg-card p-3 shadow-sm">
                  <p className="text-[11px] font-medium text-muted-foreground">Gross Billed (with GST)</p>
                  <p className="text-lg font-bold text-foreground">
                    {formatINR(data.gstBills?.totalGrandTotal || 0)}
                  </p>
                </div>
              </div>

              {/* Filters & Actions Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search guest, phone, GSTIN, company, bill #..."
                      value={gstSearch}
                      onChange={(e) => setGstSearch(e.target.value)}
                      className="h-8.5 w-64 pl-8 text-xs"
                    />
                  </div>
                  <div className="flex rounded-md border bg-muted/40 p-0.5 text-xs">
                    <Button
                      size="sm"
                      variant={gstTypeFilter === 'ALL' ? 'default' : 'ghost'}
                      className="h-7 px-2.5 text-xs font-medium"
                      onClick={() => setGstTypeFilter('ALL')}
                    >
                      All ({data.gstBills?.count || 0})
                    </Button>
                    <Button
                      size="sm"
                      variant={gstTypeFilter === 'NORMAL' ? 'default' : 'ghost'}
                      className="h-7 px-2.5 text-xs font-medium"
                      onClick={() => setGstTypeFilter('NORMAL')}
                    >
                      Normal ({data.gstBills?.normalCount || 0})
                    </Button>
                    <Button
                      size="sm"
                      variant={gstTypeFilter === 'CUSTOM' ? 'default' : 'ghost'}
                      className="h-7 px-2.5 text-xs font-medium text-violet-700 dark:text-violet-300"
                      onClick={() => setGstTypeFilter('CUSTOM')}
                    >
                      Custom ({data.gstBills?.customCount || 0})
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      printTableReport(
                        'GST Tax Invoices Report',
                        [
                          'Customer Name',
                          'Invoice Number',
                          'How Much Guest Paid',
                          'How Much GST Paid',
                        ],
                        filteredGstRows.map((r) => [
                          r.guestName,
                          r.billNumber,
                          formatINR(r.paid),
                          formatINR(r.actualGst),
                        ]),
                        `Date Range: ${formatDate(from)} to ${formatDate(to)} · Total GST Paid: ${formatINR(data.gstBills?.totalGstAmount || 0)}`
                      )
                    }
                  >
                    <Printer className="h-3.5 w-3.5" /> Print GST Report
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() =>
                      exportCSV(
                        'gst-bills-report.csv',
                        [
                          'Customer Name',
                          'Invoice Number',
                          'How Much Guest Paid',
                          'How Much GST Paid',
                        ],
                        filteredGstRows.map((r) => [
                          r.guestName,
                          r.billNumber,
                          r.paid,
                          r.actualGst,
                        ])
                      )
                    }
                  >
                    <Download className="h-3.5 w-3.5" /> Export GST Report
                  </Button>
                </div>
              </div>

              {/* GST Bills Table */}
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice &amp; Date</TableHead>
                      <TableHead>Guest Details</TableHead>
                      <TableHead>Bill Type</TableHead>
                      <TableHead>Original Room</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead className="text-right">Taxable (₹)</TableHead>
                      <TableHead className="text-right">GST Rate &amp; Paid</TableHead>
                      <TableHead className="text-right">Total Bill</TableHead>
                      <TableHead className="text-right">Paid / Balance</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredGstRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                          {data.gstBills?.rows.length === 0
                            ? 'No GST bills in this date range.'
                            : 'No GST bills match your search filter.'}
                        </TableCell>
                      </TableRow>
                    )}
                    {filteredGstRows.map((r) => (
                      <TableRow key={r.billNumber} className="hover:bg-muted/40">
                        <TableCell className="text-xs">
                          <div className="font-semibold text-foreground">{r.billNumber}</div>
                          <div className="text-[11px] text-muted-foreground">{formatDateTime(r.date)}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-semibold text-foreground">{r.guestName}</div>
                          <div className="text-[11px] text-muted-foreground">{r.phone}</div>
                          {r.guestGst && (
                            <div className="mt-0.5">
                              <Badge
                                variant="outline"
                                className="border-emerald-500/40 bg-emerald-50/60 px-1 py-0 text-[10px] font-mono font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                              >
                                GSTIN: {r.guestGst}
                              </Badge>
                            </div>
                          )}
                          {r.company && (
                            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                              <Building2 className="h-3 w-3 inline" />
                              <span className="truncate max-w-[140px]">{r.company}</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.isCustom ? (
                            <div className="space-y-0.5">
                              <Badge className="bg-violet-600 hover:bg-violet-700 text-white px-1.5 py-0 text-[10px]">
                                CUSTOM BILL
                              </Badge>
                              <div className="text-[10px] font-medium text-violet-700 dark:text-violet-300">
                                Billed: {formatINR(r.billedRoomTotal)}
                              </div>
                              <div className="text-[9px] text-muted-foreground">
                                (Actual: {formatINR(r.actualRoomTotal)})
                              </div>
                              {r.approvedBy && (
                                <div className="text-[9px] text-muted-foreground">
                                  Appr: {r.approvedBy}
                                </div>
                              )}
                            </div>
                          ) : (
                            <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                              NORMAL BILL
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-semibold text-foreground">Room {r.originalRoomNumber || r.roomNumber}</div>
                          <div className="text-[10px] text-muted-foreground">Original stay</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className={`font-medium ${r.roomNumber && r.originalRoomNumber && r.roomNumber !== r.originalRoomNumber ? 'font-semibold text-violet-700 dark:text-violet-300' : ''}`}>
                            Room {r.roomNumber}
                            {r.roomNumber && r.originalRoomNumber && r.roomNumber !== r.originalRoomNumber && (
                              <span className="ml-1 text-[10px] text-violet-600 font-normal">(Custom)</span>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground">{r.roomDescription}</div>
                          <div className="text-[10px] text-muted-foreground">{r.days} night(s)</div>
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          <div className="font-semibold">{formatINR(r.taxableAmount)}</div>
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          <div className="font-bold text-emerald-700 dark:text-emerald-400">
                            {formatINR(r.actualGst)}
                          </div>
                          <div className="text-[10px] text-muted-foreground">({r.gstPercent}%)</div>
                          {r.isCustom && r.internalGst !== r.actualGst && (
                            <div className="text-[9px] text-muted-foreground">
                              Int: {formatINR(r.internalGst)}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs font-bold text-foreground">
                          {formatINR(r.grandTotal)}
                        </TableCell>
                        <TableCell className="text-right text-xs">
                          <div className="font-medium">{formatINR(r.paid)}</div>
                          {r.balance > 0.01 ? (
                            <Badge variant="destructive" className="mt-0.5 px-1 py-0 text-[9px]">
                              Due: {formatINR(r.balance)}
                            </Badge>
                          ) : (
                            <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                              ✓ Paid
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                              title="View Guest & Bill Details"
                              onClick={() => setSelectedGstBill(r)}
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-950/30"
                              title="Print GST Invoice"
                              onClick={() => triggerPrintInvoice(r, settings)}
                            >
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
                <p>
                  <b>GST Summary:</b> Total GST Paid by guests:{' '}
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">
                    {formatINR(data.gstBills?.totalGstAmount || 0)}
                  </span>{' '}
                  across <b>{data.gstBills?.count || 0}</b> bill(s) (
                  <b>{data.gstBills?.normalCount || 0}</b> normal bills,{' '}
                  <b>{data.gstBills?.customCount || 0}</b> custom corporate bills).
                  {data.gstBills?.customCount > 0 && (
                    <>
                      {' '}· Hotel internal accounting GST on actual room tariff:{' '}
                      <b>{formatINR(data.gstBills?.totalInternalGst || 0)}</b>.
                    </>
                  )}
                </p>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )
    })()}

      {/* ===== Guest & GST Bill Details Dialog ===== */}
      <Dialog open={!!selectedGstBill} onOpenChange={(open) => !open && setSelectedGstBill(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedGstBill && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
                  <div>
                    <DialogTitle className="text-base font-bold flex items-center gap-2">
                      <span>GST Bill Details</span>
                      <span className="font-mono text-emerald-700 dark:text-emerald-400">
                        {selectedGstBill.billNumber}
                      </span>
                    </DialogTitle>
                    <DialogDescription className="text-xs">
                      Issued on {formatDateTime(selectedGstBill.date)}
                    </DialogDescription>
                  </div>
                  {selectedGstBill.isCustom ? (
                    <Badge className="bg-violet-600 hover:bg-violet-700 text-white">CUSTOM BILL</Badge>
                  ) : (
                    <Badge variant="secondary">NORMAL BILL</Badge>
                  )}
                </div>
              </DialogHeader>

              <div className="space-y-4 text-xs">
                {/* Guest Details Section */}
                <div className="rounded-lg border bg-muted/20 p-3.5 space-y-2.5">
                  <h4 className="font-bold text-foreground text-xs flex items-center gap-1.5">
                    <UsersRound className="h-4 w-4 text-emerald-600" />
                    Guest Information
                  </h4>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Guest Name</span>
                      <span className="font-semibold text-foreground text-sm">{selectedGstBill.guestName}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Phone Number</span>
                      <span className="font-medium text-foreground">{selectedGstBill.phone}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Email</span>
                      <span className="text-foreground">{selectedGstBill.email || '—'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Company / Corporate</span>
                      <span className="text-foreground font-medium">{selectedGstBill.company || '—'}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Guest GSTIN</span>
                      {selectedGstBill.guestGst ? (
                        <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                          {selectedGstBill.guestGst}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">ID Proof</span>
                      <span className="text-foreground">{selectedGstBill.idProof || '—'}</span>
                    </div>
                    <div className="col-span-2 sm:col-span-3">
                      <span className="text-muted-foreground block text-[11px]">Address</span>
                      <span className="text-foreground">{selectedGstBill.address || '—'}</span>
                    </div>
                  </div>
                </div>

                {/* Stay & Room Details */}
                <div className="rounded-lg border bg-muted/20 p-3.5 space-y-2">
                  <h4 className="font-bold text-foreground text-xs flex items-center gap-1.5">
                    <BedDouble className="h-4 w-4 text-emerald-600" />
                    Stay &amp; Room Details
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Original Stay Room</span>
                      <span className="font-semibold text-foreground">Room {selectedGstBill.originalRoomNumber || selectedGstBill.roomNumber}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Billed / Printed Room</span>
                      <span className="font-semibold text-foreground">Room {selectedGstBill.roomNumber}</span>
                      {selectedGstBill.roomNumber !== (selectedGstBill.originalRoomNumber || selectedGstBill.roomNumber) && (
                        <span className="text-[10px] text-violet-600 block">(Customized)</span>
                      )}
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Room Description</span>
                      <span className="text-foreground">{selectedGstBill.roomDescription}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[11px]">Stay Duration</span>
                      <span className="text-foreground font-medium">{selectedGstBill.days} Night(s)</span>
                    </div>
                  </div>
                </div>

                {/* Financial & GST Breakdown */}
                <div className="rounded-lg border p-3.5 space-y-2.5">
                  <h4 className="font-bold text-foreground text-xs flex items-center gap-1.5">
                    <Receipt className="h-4 w-4 text-emerald-600" />
                    Financial &amp; GST Calculation Breakdown
                  </h4>
                  <div className="space-y-1.5 border-t pt-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Room Tariff ({selectedGstBill.isCustom ? 'Billed Custom Rate' : 'Actual Rate'})
                      </span>
                      <span className="font-medium">{formatINR(selectedGstBill.billedRoomTotal)}</span>
                    </div>
                    {selectedGstBill.isCustom && (
                      <div className="flex justify-between text-violet-700 dark:text-violet-300">
                        <span>Actual Internal Room Tariff (Hotel side)</span>
                        <span>{formatINR(selectedGstBill.actualRoomTotal)}</span>
                      </div>
                    )}
                    {selectedGstBill.extraCharges > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Extra Charges</span>
                        <span className="font-medium">{formatINR(selectedGstBill.extraCharges)}</span>
                      </div>
                    )}
                    {selectedGstBill.discount > 0 && (
                      <div className="flex justify-between text-red-600">
                        <span>Discount</span>
                        <span>-{formatINR(selectedGstBill.discount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t pt-1 font-semibold text-foreground">
                      <span>Taxable Amount (Subtotal)</span>
                      <span>{formatINR(selectedGstBill.taxableAmount)}</span>
                    </div>
                    <div className="flex justify-between text-emerald-700 dark:text-emerald-400 font-semibold">
                      <span>GST Applied ({selectedGstBill.gstPercent}%)</span>
                      <span>+{formatINR(selectedGstBill.actualGst)}</span>
                    </div>
                    {selectedGstBill.isCustom && (
                      <div className="flex justify-between text-muted-foreground text-[11px]">
                        <span>Internal Hotel GST (on actual tariff)</span>
                        <span>{formatINR(selectedGstBill.internalGst)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t-2 pt-1 text-sm font-bold text-foreground">
                      <span>Total Invoice Amount (Grand Total)</span>
                      <span>{formatINR(selectedGstBill.grandTotal)}</span>
                    </div>
                  </div>

                  {/* Payment Details */}
                  <div className="border-t pt-2.5 space-y-1 bg-muted/30 p-2.5 rounded">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">Advance Adjusted</span>
                      <span>{formatINR(selectedGstBill.advanceApplied)}</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">Paid (Cash / UPI / Card)</span>
                      <span>
                        Cash: {formatINR(selectedGstBill.payCash)} · UPI: {formatINR(selectedGstBill.payUpi)} · Card: {formatINR(selectedGstBill.payCard)}
                      </span>
                    </div>
                    <div className="flex justify-between font-bold border-t pt-1">
                      <span>Total Paid</span>
                      <span className="text-emerald-700 dark:text-emerald-400">{formatINR(selectedGstBill.paid)}</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>Balance Outstanding</span>
                      <span className={selectedGstBill.balance > 0.01 ? 'text-red-600' : 'text-emerald-600'}>
                        {selectedGstBill.balance > 0.01 ? formatINR(selectedGstBill.balance) : '✓ Fully Paid (₹0)'}
                      </span>
                    </div>
                  </div>

                  {/* Additional Metadata */}
                  {(selectedGstBill.approvedBy || selectedGstBill.createdBy || selectedGstBill.notes) && (
                    <div className="text-[11px] text-muted-foreground border-t pt-2 space-y-0.5">
                      {selectedGstBill.approvedBy && <div>Custom Rate Approved By: <b>{selectedGstBill.approvedBy}</b></div>}
                      {selectedGstBill.createdBy && <div>Billed By: <b>{selectedGstBill.createdBy}</b></div>}
                      {selectedGstBill.notes && <div>Notes: {selectedGstBill.notes}</div>}
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => triggerPrintInvoice(selectedGstBill, settings)}
                >
                  <Printer className="h-4 w-4 text-blue-600" /> Print Tax Invoice
                </Button>
                <Button variant="default" onClick={() => setSelectedGstBill(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
