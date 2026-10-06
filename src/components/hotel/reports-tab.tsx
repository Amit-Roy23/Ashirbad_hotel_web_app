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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api, apiAs, formatINR, formatDate, formatDateTime, exportCSV, todayStr } from '@/lib/hotel-utils'
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
  AlertCircle,
  FileText,
  Trash2,
} from 'lucide-react'

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
  collections: { cash: number; upi: number; card: number; directFood: number; advances: number; total: number }
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
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  sub?: string
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="rounded-full bg-muted p-2.5">
          <Icon className="h-5 w-5 text-emerald-700 dark:text-emerald-400" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-lg font-bold">{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

export function ReportsTab({ refreshKey, onDataChanged }: TabProps) {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(todayStr())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api<ReportData>(`/api/reports?from=${from}&to=${to}`)
      setData(r)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  async function deleteReportItem(endpoint: string, id: string, label: string) {
    if (!confirm(`Are you sure you want to delete ${label}?`)) return
    try {
      const res = await apiAs<{ success?: boolean; error?: string }>(
        `${endpoint}?id=${id}`,
        getCachedUser(),
        { method: 'DELETE' }
      )
      if (res && res.error) {
        alert(res.error)
      } else {
        await load()
        onDataChanged?.()
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Could not delete item')
    }
  }

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
              {data.range.days} day(s) · {data.invoices.count} invoices · {data.bookings.rows.length} bookings
            </p>
          )}
        </CardContent>
      </Card>

      {data && (
        <>
          {/* Summary stat cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
              sub={`Actual Room: ${formatINR(data.revenue.actualRoomRevenue)} · Billed: ${formatINR(data.revenue.billedRoomRevenue)}`}
            />
            <StatCard
              icon={TrendingDown}
              label="Expenses"
              value={formatINR(data.expenses.total)}
              sub={`${data.expenses.rows.length} entries`}
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
            </TabsList>

            {/* ===== Invoice report ===== */}
            <TabsContent value="invoices" className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  {data.invoices.count} invoices · {data.invoices.customCount} custom
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto gap-1"
                  onClick={() =>
                    exportCSV(
                      'invoice-report.csv',
                      ['Invoice', 'Date', 'Guest', 'Room', 'Actual Room', 'Billed Room', 'Room Description', 'Food', 'GST', 'Internal GST', 'Invoice Total', 'Internal Total', 'Custom', 'Approved By'],
                      data.invoices.rows.map((r) => [
                        r.billNumber, formatDateTime(r.date), r.guestName, r.roomNumber,
                        r.actualRoomTotal, r.billedRoomTotal, r.roomDescription || '', r.foodTotal, r.gst, r.internalGst, r.grandTotal, r.internalTotal,
                        r.isCustom ? 'Yes' : 'No', r.approvedBy || '',
                      ])
                    )
                  }
                >
                  <Download className="h-3.5 w-3.5" /> Export
                </Button>
              </div>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Guest</TableHead>
                      <TableHead>Room</TableHead>
                      <TableHead>Actual</TableHead>
                      <TableHead>Billed</TableHead>
                      <TableHead>Food</TableHead>
                      <TableHead>GST</TableHead>
                      <TableHead>Invoice Total</TableHead>
                      <TableHead>Internal Total</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.invoices.rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={11} className="py-6 text-center text-sm text-muted-foreground">
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
                        <TableCell className="text-xs">{r.guestName}</TableCell>
                        <TableCell className="text-xs">{r.roomNumber}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatINR(r.actualRoomTotal)}</TableCell>
                        <TableCell className={`text-xs ${r.isCustom ? 'font-bold text-violet-700 dark:text-violet-300' : ''}`}>
                          {formatINR(r.billedRoomTotal)}
                        </TableCell>
                        <TableCell className="text-xs">{formatINR(r.foodTotal)}</TableCell>
                        <TableCell className="text-xs">{formatINR(r.gst)}</TableCell>
                        <TableCell className="text-xs font-bold">{formatINR(r.grandTotal)}</TableCell>
                        <TableCell className="text-xs font-medium text-muted-foreground">{formatINR(r.internalTotal)}</TableCell>
                        <TableCell className="text-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={() => r.id && deleteReportItem('/api/bills', r.id, `Invoice ${r.billNumber}`)}
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </Button>
                        </TableCell>
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
              <div className="grid grid-cols-3 gap-3">
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground">Cash</p>
                    <p className="text-lg font-bold">{formatINR(data.collections.cash)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground">UPI</p>
                    <p className="text-lg font-bold">{formatINR(data.collections.upi)}</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 text-center">
                    <p className="text-xs text-muted-foreground">Card</p>
                    <p className="text-lg font-bold">{formatINR(data.collections.card)}</p>
                  </CardContent>
                </Card>
              </div>
              <div className="space-y-1 rounded-lg bg-muted p-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Bill collections (room + food)</span>
                  <span className="font-medium">{formatINR(data.collections.total - data.collections.directFood - data.collections.advances)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Direct restaurant (walk-in)</span>
                  <span className="font-medium">{formatINR(data.collections.directFood)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Guest advances</span>
                  <span className="font-medium">{formatINR(data.collections.advances)}</span>
                </div>
                <div className="flex justify-between border-t pt-1 font-bold">
                  <span>Total</span>
                  <span>{formatINR(data.collections.total)}</span>
                </div>
              </div>
            </TabsContent>

            {/* ===== Booking report ===== */}
            <TabsContent value="bookings" className="mt-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{data.occupancy.bookingsCount} bookings</Badge>
                <Badge variant="outline">{data.occupancy.roomNightsSold} room-nights billed</Badge>
                <Badge variant="outline">{data.occupancy.inHouseGuests} in-house now</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto gap-1"
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
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.bookings.rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
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
                        <TableCell className="text-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={() => r.id && deleteReportItem('/api/bookings', r.id, `Booking for Room ${r.roomNumber}`)}
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </Button>
                        </TableCell>
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
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto gap-1"
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
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                        onClick={() => deleteReportItem('/api/orders', r.id, `Food order (${formatINR(r.total)})`)}
                        title="Delete order"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
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
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto gap-1"
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
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.staff.rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
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
                        <TableCell className="text-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={() => r.id && deleteReportItem('/api/staff-payments', r.id, `Staff payment for ${r.staffName}`)}
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </Button>
                        </TableCell>
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
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto gap-1"
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
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.expenses.rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
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
                        <TableCell className="text-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={() => r.id && deleteReportItem('/api/ledger', r.id, `Expense "${r.description}"`)}
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </Button>
                        </TableCell>
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
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto gap-1"
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
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.outstanding.rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">
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
                        <TableCell className="text-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={() => r.id && deleteReportItem('/api/bills', r.id, `Outstanding Bill ${r.billNumber}`)}
                          >
                            <Trash2 className="h-3 w-3" /> Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
