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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { api, apiAs, formatINR, formatDate, formatDateTime, exportCSV, todayStr } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { toast } from '@/hooks/use-toast'
import { BanquetHall, BanquetBooking, BanquetBill, BanquetStats } from '@/types/banquet'
import { BanquetBookingDialog } from './banquet-booking-dialog'
import { BanquetBillDialog } from './banquet-bill-dialog'
import { triggerPrintBanquetInvoice } from '@/lib/print-banquet-invoice'
import {
  PartyPopper,
  CalendarDays,
  Receipt,
  Building2,
  Users,
  IndianRupee,
  Plus,
  Search,
  Download,
  Printer,
  Trash2,
  Edit,
  CheckCircle,
  Clock,
  Sparkles,
  Loader2,
  AlertCircle,
  Eye,
  CheckCircle2,
  XCircle,
  Wallet,
} from 'lucide-react'

interface BanquetTabProps {
  refreshKey: number
  onDataChanged: () => void
  initialFilter?: string
}

export function BanquetTab({ refreshKey, onDataChanged, initialFilter }: BanquetTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'bookings' | 'bills' | 'halls'>('overview')
  const [loading, setLoading] = useState(true)

  // Data
  const [halls, setHalls] = useState<BanquetHall[]>([])
  const [bookings, setBookings] = useState<BanquetBooking[]>([])
  const [bills, setBills] = useState<BanquetBill[]>([])
  const [stats, setStats] = useState<BanquetStats | null>(null)

  // Filters
  const [searchBooking, setSearchBooking] = useState(initialFilter || '')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [hallFilter, setHallFilter] = useState('ALL')
  const [searchBill, setSearchBill] = useState('')

  // Dialog states
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false)
  const [selectedBooking, setSelectedBooking] = useState<BanquetBooking | null>(null)

  const [billDialogOpen, setBillDialogOpen] = useState(false)
  const [billingBooking, setBillingBooking] = useState<BanquetBooking | null>(null)
  const [editingBill, setEditingBill] = useState<BanquetBill | null>(null)

  // Hall modal state
  const [hallModalOpen, setHallModalOpen] = useState(false)
  const [editingHall, setEditingHall] = useState<BanquetHall | null>(null)
  const [hallName, setHallName] = useState('')
  const [hallCapacity, setHallCapacity] = useState('150')
  const [hallRate, setHallRate] = useState('20000')
  const [hallAmenities, setHallAmenities] = useState('')
  const [hallDescription, setHallDescription] = useState('')
  const [hallStatus, setHallStatus] = useState('AVAILABLE')
  const [hallBusy, setHallBusy] = useState(false)

  // Load All Banquet Data
  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [hallsData, bookingsData, billsData, statsData] = await Promise.all([
        api<BanquetHall[]>('/api/banquet-halls'),
        api<BanquetBooking[]>('/api/banquet-bookings'),
        api<BanquetBill[]>('/api/banquet-bills'),
        api<BanquetStats>('/api/banquet-stats'),
      ])
      setHalls(hallsData || [])
      setBookings(bookingsData || [])
      setBills(billsData || [])
      setStats(statsData || null)
    } catch (e) {
      console.error('Error loading banquet data:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData, refreshKey])

  // Hall Save
  async function handleSaveHall(e: React.FormEvent) {
    e.preventDefault()
    if (!hallName.trim()) return

    setHallBusy(true)
    try {
      if (editingHall) {
        await apiAs('/api/banquet-halls', getCachedUser(), {
          method: 'PATCH',
          body: JSON.stringify({
            id: editingHall.id,
            name: hallName,
            capacity: parseInt(hallCapacity) || 100,
            baseRate: parseFloat(hallRate) || 0,
            amenities: hallAmenities,
            description: hallDescription,
            status: hallStatus,
          }),
        })
        toast({ variant: 'success', title: 'Hall Updated', description: `${hallName} updated.` })
      } else {
        await apiAs('/api/banquet-halls', getCachedUser(), {
          method: 'POST',
          body: JSON.stringify({
            name: hallName,
            capacity: parseInt(hallCapacity) || 100,
            baseRate: parseFloat(hallRate) || 0,
            amenities: hallAmenities,
            description: hallDescription,
            status: hallStatus,
          }),
        })
        toast({ variant: 'success', title: 'Hall Created', description: `${hallName} added.` })
      }
      setHallModalOpen(false)
      loadData()
      onDataChanged()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: err instanceof Error ? err.message : 'Could not save banquet hall' })
    } finally {
      setHallBusy(false)
    }
  }

  // Delete Handlers
  async function handleDeleteBooking(b: BanquetBooking) {
    if (!confirm(`Are you sure you want to delete booking ${b.bookingNumber} (${b.customerName})?`)) return
    try {
      await apiAs(`/api/banquet-bookings?id=${b.id}`, getCachedUser(), { method: 'DELETE' })
      toast({ variant: 'success', title: 'Deleted', description: 'Banquet booking deleted.' })
      loadData()
      onDataChanged()
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: e instanceof Error ? e.message : 'Could not delete booking' })
    }
  }

  async function handleDeleteBill(b: BanquetBill) {
    if (!confirm(`Are you sure you want to delete banquet invoice ${b.billNumber}?`)) return
    try {
      await apiAs(`/api/banquet-bills?id=${b.id}`, getCachedUser(), { method: 'DELETE' })
      toast({ variant: 'success', title: 'Deleted', description: 'Banquet invoice deleted.' })
      loadData()
      onDataChanged()
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: e instanceof Error ? e.message : 'Could not delete banquet invoice' })
    }
  }

  // Status Updater
  async function updateBookingStatus(b: BanquetBooking, newStatus: string) {
    try {
      await apiAs('/api/banquet-bookings', getCachedUser(), {
        method: 'PATCH',
        body: JSON.stringify({ id: b.id, status: newStatus }),
      })
      toast({ variant: 'success', title: 'Status Updated', description: `Booking marked as ${newStatus}.` })
      loadData()
      onDataChanged()
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: e instanceof Error ? e.message : 'Failed to update status' })
    }
  }

  // Filtered lists
  const filteredBookings = bookings.filter((b) => {
    if (hallFilter !== 'ALL' && b.hallId !== hallFilter) return false
    if (statusFilter !== 'ALL' && b.status !== statusFilter) return false
    if (searchBooking.trim()) {
      const q = searchBooking.toLowerCase()
      const matchName = b.customerName?.toLowerCase().includes(q)
      const matchPhone = b.customerPhone?.includes(q)
      const matchEvent = b.eventName?.toLowerCase().includes(q)
      const matchNum = b.bookingNumber?.toLowerCase().includes(q)
      const matchHall = b.hall?.name?.toLowerCase().includes(q)
      return matchName || matchPhone || matchEvent || matchNum || matchHall
    }
    return true
  })

  const filteredBills = bills.filter((b) => {
    if (searchBill.trim()) {
      const q = searchBill.toLowerCase()
      const matchNum = b.billNumber?.toLowerCase().includes(q)
      const matchName = b.customerName?.toLowerCase().includes(q)
      const matchPhone = b.customerPhone?.includes(q)
      const matchEvent = b.eventName?.toLowerCase().includes(q)
      const matchHall = b.hallName?.toLowerCase().includes(q)
      return matchNum || matchName || matchPhone || matchEvent || matchHall
    }
    return true
  })

  const todayIso = todayStr()
  const todayBookings = bookings.filter((b) => b.eventDate && b.eventDate.slice(0, 10) === todayIso)
  const upcomingBookings = bookings.filter((b) => b.eventDate && b.eventDate.slice(0, 10) >= todayIso && b.status !== 'CANCELLED')

  if (loading && !stats) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header & Quick Action Buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight">Banquet &amp; Events Management</h2>
            <Badge className="bg-emerald-600 text-[10px] tracking-wide uppercase">Dedicated Billing</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Complete management for weddings, parties, corporate conventions &amp; dedicated banquet billing
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm"
            onClick={() => {
              setSelectedBooking(null)
              setBookingDialogOpen(true)
            }}
          >
            <Plus className="h-4 w-4" /> New Banquet Booking
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              setEditingHall(null)
              setHallName('')
              setHallCapacity('150')
              setHallRate('20000')
              setHallAmenities('')
              setHallDescription('')
              setHallStatus('AVAILABLE')
              setHallModalOpen(true)
            }}
          >
            <Building2 className="h-4 w-4" /> Add Hall
          </Button>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-transparent dark:border-emerald-900 dark:from-emerald-950/40">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-full bg-emerald-100 p-2.5 dark:bg-emerald-900">
              <IndianRupee className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Banquet Revenue</p>
              <p className="text-lg font-bold">{formatINR(stats?.totalBilledRevenue)}</p>
              <p className="text-[10px] text-muted-foreground">{bills.length} bills generated</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-teal-200 bg-gradient-to-br from-teal-50 to-transparent dark:border-teal-900 dark:from-teal-950/40">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-full bg-teal-100 p-2.5 dark:bg-teal-900">
              <PartyPopper className="h-5 w-5 text-teal-700 dark:text-teal-300" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Upcoming Functions</p>
              <p className="text-lg font-bold">{upcomingBookings.length}</p>
              <p className="text-[10px] text-muted-foreground">{todayBookings.length} scheduled today</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-indigo-200 bg-gradient-to-br from-indigo-50 to-transparent dark:border-indigo-900 dark:from-indigo-950/40">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-full bg-indigo-100 p-2.5 dark:bg-indigo-900">
              <Building2 className="h-5 w-5 text-indigo-700 dark:text-indigo-300" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Banquet Halls</p>
              <p className="text-lg font-bold">{halls.length} Venues</p>
              <p className="text-[10px] text-muted-foreground">Available for events</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-red-200 bg-gradient-to-br from-red-50 to-transparent dark:border-red-900 dark:from-red-950/40">
          <CardContent className="flex items-center gap-3 p-4">
            <div className="rounded-full bg-red-100 p-2.5 dark:bg-red-900">
              <AlertCircle className="h-5 w-5 text-red-700 dark:text-red-300" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Outstanding Balance</p>
              <p className="text-lg font-bold text-red-700 dark:text-red-400">{formatINR(stats?.totalOutstanding)}</p>
              <p className="text-[10px] text-muted-foreground">To collect from events</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeSubTab} onValueChange={(v) => setActiveSubTab(v as any)}>
        <TabsList className="flex w-full flex-wrap gap-1 sm:w-auto">
          <TabsTrigger value="overview" className="gap-1.5">
            <PartyPopper className="h-4 w-4" /> Overview &amp; Today&apos;s Events
          </TabsTrigger>
          <TabsTrigger value="bookings" className="gap-1.5">
            <CalendarDays className="h-4 w-4" /> Bookings &amp; Inquiries ({bookings.length})
          </TabsTrigger>
          <TabsTrigger value="bills" className="gap-1.5">
            <Receipt className="h-4 w-4" /> Banquet Billing &amp; Invoices ({bills.length})
          </TabsTrigger>
          <TabsTrigger value="halls" className="gap-1.5">
            <Building2 className="h-4 w-4" /> Venues &amp; Halls ({halls.length})
          </TabsTrigger>
        </TabsList>

        {/* ================= TAB 1: OVERVIEW ================= */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {/* Today's Events Banner */}
          <div className="rounded-xl border border-emerald-300 bg-emerald-50/60 p-4 dark:border-emerald-800 dark:bg-emerald-950/30 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-emerald-600" />
                <h3 className="font-bold text-base text-emerald-900 dark:text-emerald-200">
                  Today&apos;s Banquet Functions ({todayBookings.length})
                </h3>
              </div>
              <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                {formatDate(new Date())}
              </span>
            </div>

            {todayBookings.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No banquet functions or party events scheduled for today.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {todayBookings.map((b) => (
                  <div key={b.id} className="rounded-lg border bg-background p-3 shadow-sm space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-bold text-sm text-foreground">{b.eventName}</h4>
                        <p className="text-xs text-muted-foreground">{b.hall?.name} · {b.slot}</p>
                      </div>
                      <Badge className="bg-emerald-600 text-[10px]">{b.status}</Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-1 text-xs pt-1 border-t">
                      <div>Host: <span className="font-semibold">{b.customerName}</span></div>
                      <div>Phone: <span className="font-semibold">{b.customerPhone}</span></div>
                      <div>Guests: <span className="font-semibold">{b.guestCount}</span></div>
                      <div>Est. Value: <span className="font-bold text-emerald-700 dark:text-emerald-400">{formatINR(b.totalEstimated)}</span></div>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        className="h-7 text-xs flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                        disabled={b.status === 'COMPLETED' || b.status === 'CANCELLED'}
                        title={b.status === 'COMPLETED' ? 'Already invoiced — see Billing & Invoices' : undefined}
                        onClick={() => {
                          setBillingBooking(b)
                          setEditingBill(null)
                          setBillDialogOpen(true)
                        }}
                      >
                        <Receipt className="mr-1 h-3 w-3" /> Generate Bill
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          setSelectedBooking(b)
                          setBookingDialogOpen(true)
                        }}
                      >
                        <Edit className="mr-1 h-3 w-3" /> Edit
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming Events Timeline */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-emerald-600" />
                  <h3 className="font-semibold text-sm">Upcoming Event Schedule (Next 30 Days)</h3>
                </div>
                <Badge variant="outline">{upcomingBookings.length} Bookings</Badge>
              </div>

              {upcomingBookings.length === 0 ? (
                <p className="text-xs text-muted-foreground py-4 text-center">No upcoming events booked yet.</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {upcomingBookings.slice(0, 8).map((b) => (
                    <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-xs hover:bg-muted/40 transition-colors">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-foreground">{b.eventName}</span>
                          <Badge variant="outline" className="text-[10px]">{b.hall?.name}</Badge>
                          <Badge className="bg-emerald-600 text-[9px] h-4">{b.slot}</Badge>
                        </div>
                        <div className="text-muted-foreground text-[11px]">
                          Host: <b>{b.customerName}</b> ({b.customerPhone}) · {b.guestCount} Guests · {formatINR(b.totalEstimated)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <span className="font-bold text-emerald-700 dark:text-emerald-400 block">{formatDate(b.eventDate)}</span>
                          <span className="text-[10px] text-muted-foreground">Adv: {formatINR(b.advancePaid)}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={() => {
                            setSelectedBooking(b)
                            setBookingDialogOpen(true)
                          }}
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================= TAB 2: BOOKINGS & INQUIRIES ================= */}
        <TabsContent value="bookings" className="mt-4 space-y-3">
          {/* Controls Bar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by Host, Phone, Event or Booking #..."
                value={searchBooking}
                onChange={(e) => setSearchBooking(e.target.value)}
                className="h-9 pl-8 text-xs"
              />
            </div>

            <Select value={hallFilter} onValueChange={setHallFilter}>
              <SelectTrigger className="h-9 w-36 text-xs">
                <SelectValue placeholder="All Halls" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Halls</SelectItem>
                {halls.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-32 text-xs">
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Status</SelectItem>
                <SelectItem value="CONFIRMED">CONFIRMED</SelectItem>
                <SelectItem value="ENQUIRY">ENQUIRY</SelectItem>
                <SelectItem value="IN_PROGRESS">IN PROGRESS</SelectItem>
                <SelectItem value="COMPLETED">COMPLETED</SelectItem>
                <SelectItem value="CANCELLED">CANCELLED</SelectItem>
              </SelectContent>
            </Select>

            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-xs"
              onClick={() =>
                exportCSV(
                  'banquet_bookings.csv',
                  ['Booking No', 'Event Date', 'Slot', 'Event Name', 'Hall', 'Customer', 'Phone', 'Guests', 'Hall Rent', 'Food Total', 'Est. Total', 'Advance Paid', 'Status', 'Payment Status'],
                  filteredBookings.map((b) => [
                    b.bookingNumber,
                    formatDate(b.eventDate),
                    b.slot,
                    b.eventName,
                    b.hall?.name || '',
                    b.customerName,
                    b.customerPhone,
                    b.guestCount,
                    b.hallRent,
                    b.foodTotal,
                    b.totalEstimated,
                    b.advancePaid,
                    b.status,
                    b.paymentStatus,
                  ])
                )
              }
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </div>

          {/* Bookings Table */}
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking #</TableHead>
                  <TableHead>Event Date &amp; Slot</TableHead>
                  <TableHead>Event &amp; Venue</TableHead>
                  <TableHead>Host / Client</TableHead>
                  <TableHead className="text-right">Guests</TableHead>
                  <TableHead className="text-right">Est. Total</TableHead>
                  <TableHead className="text-right">Advance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBookings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                      No banquet bookings found matching your search.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredBookings.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="text-xs font-semibold">
                        {b.bookingNumber}
                        <div className="text-[10px] text-muted-foreground">{formatDate(b.createdAt)}</div>
                      </TableCell>
                      <TableCell className="text-xs font-medium">
                        <div>{formatDate(b.eventDate)}</div>
                        <Badge variant="outline" className="text-[9px] h-4 mt-0.5">{b.slot}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="font-bold text-foreground">{b.eventName}</div>
                        <div className="text-[11px] text-muted-foreground">{b.hall?.name}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium">{b.customerName}</div>
                        <div className="text-muted-foreground">{b.customerPhone}</div>
                      </TableCell>
                      <TableCell className="text-right text-xs font-semibold">{b.guestCount}</TableCell>
                      <TableCell className="text-right text-xs font-bold">{formatINR(b.totalEstimated)}</TableCell>
                      <TableCell className="text-right text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        {formatINR(b.advancePaid)}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge
                          variant={b.status === 'CONFIRMED' ? 'default' : 'outline'}
                          className={b.status === 'CONFIRMED' ? 'bg-emerald-600' : ''}
                        >
                          {b.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1 px-2"
                            disabled={b.status === 'COMPLETED' || b.status === 'CANCELLED'}
                            onClick={() => {
                              setBillingBooking(b)
                              setEditingBill(null)
                              setBillDialogOpen(true)
                            }}
                            title={b.status === 'COMPLETED' ? 'Already invoiced — see Billing & Invoices' : 'Generate Final Bill'}
                          >
                            <Receipt className="h-3 w-3" /> Bill
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => {
                              setSelectedBooking(b)
                              setBookingDialogOpen(true)
                            }}
                            title="Edit Booking"
                          >
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                            onClick={() => handleDeleteBooking(b)}
                            title="Delete Booking"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ================= TAB 3: BANQUET BILLING & INVOICES ================= */}
        <TabsContent value="bills" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search Banquet Invoices by Bill #, Customer, Event..."
                value={searchBill}
                onChange={(e) => setSearchBill(e.target.value)}
                className="h-9 pl-8 text-xs"
              />
            </div>

            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-xs"
              onClick={() =>
                exportCSV(
                  'banquet_invoices.csv',
                  ['Invoice No', 'Date', 'Customer', 'Phone', 'Event', 'Hall', 'Taxable', 'GST', 'Grand Total', 'Advance Deducted', 'Paid at Completion', 'Balance Due', 'Status'],
                  filteredBills.map((b) => {
                    const paid = (b.advanceApplied || 0) + (b.payCash || 0) + (b.payUpi || 0) + (b.payCard || 0) + (b.payBank || 0)
                    const bal = Math.max(0, b.grandTotal - paid)
                    return [
                      b.billNumber,
                      formatDateTime(b.createdAt),
                      b.customerName,
                      b.customerPhone,
                      b.eventName,
                      b.hallName,
                      b.taxableAmount,
                      b.gstAmount,
                      b.grandTotal,
                      b.advanceApplied,
                      paid - b.advanceApplied,
                      bal,
                      b.paymentStatus,
                    ]
                  })
                )
              }
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
          </div>

          {/* Dedicated Invoices Table */}
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Host / Client</TableHead>
                  <TableHead>Event &amp; Hall</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">GST ({bills[0]?.gstPercent || 18}%)</TableHead>
                  <TableHead className="text-right">Total Bill</TableHead>
                  <TableHead className="text-right">Total Paid</TableHead>
                  <TableHead className="text-right">Balance Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBills.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                      No banquet invoices generated yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredBills.map((b) => {
                    const totalPaid = (b.advanceApplied || 0) + (b.payCash || 0) + (b.payUpi || 0) + (b.payCard || 0) + (b.payBank || 0)
                    const balance = Math.max(0, Math.round((b.grandTotal - totalPaid) * 100) / 100)
                    const isPaid = balance <= 0.01

                    return (
                      <TableRow key={b.id}>
                        <TableCell className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                          {b.billNumber}
                        </TableCell>
                        <TableCell className="text-xs">{formatDateTime(b.createdAt)}</TableCell>
                        <TableCell className="text-xs">
                          <div className="font-semibold">{b.customerName}</div>
                          <div className="text-[11px] text-muted-foreground">{b.customerPhone}</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="font-medium text-foreground">{b.eventName}</div>
                          <div className="text-[11px] text-muted-foreground">{b.hallName}</div>
                        </TableCell>
                        <TableCell className="text-right text-xs">{formatINR(b.taxableAmount)}</TableCell>
                        <TableCell className="text-right text-xs">{formatINR(b.gstAmount)}</TableCell>
                        <TableCell className="text-right text-xs font-bold text-foreground">
                          {formatINR(b.grandTotal)}
                        </TableCell>
                        <TableCell className="text-right text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                          {formatINR(totalPaid)}
                        </TableCell>
                        <TableCell className="text-right text-xs font-bold">
                          <span className={isPaid ? 'text-emerald-600' : 'text-red-600'}>
                            {formatINR(balance)}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs">
                          <Badge variant={isPaid ? 'default' : 'outline'} className={isPaid ? 'bg-emerald-600' : 'border-red-400 text-red-700'}>
                            {isPaid ? 'PAID' : 'DUE'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() => triggerPrintBanquetInvoice(b)}
                              title="Print Banquet Invoice"
                            >
                              <Printer className="h-3 w-3" /> Print
                            </Button>
                            {!isPaid && (
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 gap-1 px-2 text-xs"
                                onClick={() => {
                                  setEditingBill(b)
                                  setBillingBooking(null)
                                  setBillDialogOpen(true)
                                }}
                                title="Settle Remaining Balance"
                              >
                                <Wallet className="h-3 w-3" /> Pay
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                              onClick={() => handleDeleteBill(b)}
                              title="Delete Banquet Invoice"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* ================= TAB 4: VENUES & HALLS ================= */}
        <TabsContent value="halls" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {halls.map((h) => (
              <Card key={h.id} className="overflow-hidden border-emerald-100 dark:border-emerald-950">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-bold text-base text-foreground">{h.name}</h4>
                      <p className="text-xs text-muted-foreground">Capacity: <b>{h.capacity} Guests</b></p>
                    </div>
                    <Badge variant={h.status === 'AVAILABLE' ? 'default' : 'outline'} className={h.status === 'AVAILABLE' ? 'bg-emerald-600' : ''}>
                      {h.status}
                    </Badge>
                  </div>

                  <div className="rounded-lg bg-muted p-2.5 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Base Rental Rate:</span>
                      <span className="font-bold text-emerald-700 dark:text-emerald-400">{formatINR(h.baseRate)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Pricing Type:</span>
                      <span className="font-medium">{h.rateType}</span>
                    </div>
                  </div>

                  {h.amenities && (
                    <div className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">Amenities: </span>
                      {h.amenities}
                    </div>
                  )}

                  {h.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{h.description}</p>
                  )}

                  <div className="flex gap-2 pt-2 border-t">
                    <Button
                      size="sm"
                      className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={() => {
                        setSelectedBooking(null)
                        setBookingDialogOpen(true)
                      }}
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Book This Hall
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => {
                        setEditingHall(h)
                        setHallName(h.name)
                        setHallCapacity(String(h.capacity))
                        setHallRate(String(h.baseRate))
                        setHallAmenities(h.amenities || '')
                        setHallDescription(h.description || '')
                        setHallStatus(h.status)
                        setHallModalOpen(true)
                      }}
                    >
                      <Edit className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* Booking Dialog */}
      <BanquetBookingDialog
        open={bookingDialogOpen}
        onOpenChange={setBookingDialogOpen}
        halls={halls}
        booking={selectedBooking}
        onSuccess={() => {
          loadData()
          onDataChanged()
        }}
      />

      {/* Billing Dialog */}
      <BanquetBillDialog
        open={billDialogOpen}
        onOpenChange={setBillDialogOpen}
        booking={billingBooking}
        existingBill={editingBill}
        onSuccess={() => {
          loadData()
          onDataChanged()
        }}
      />

      {/* Hall Modal */}
      <Dialog open={hallModalOpen} onOpenChange={setHallModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingHall ? 'Edit Banquet Hall' : 'Add New Banquet Hall'}</DialogTitle>
            <DialogDescription>Define banquet venue name, guest capacity, amenities, and rental rates.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveHall} className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label className="text-xs">Hall / Venue Name *</Label>
              <Input
                value={hallName}
                onChange={(e) => setHallName(e.target.value)}
                placeholder="e.g. Imperial Ballroom"
                className="h-9 text-xs"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Guest Capacity *</Label>
                <Input
                  type="number"
                  min="10"
                  value={hallCapacity}
                  onChange={(e) => setHallCapacity(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Base Rent (₹) *</Label>
                <Input
                  type="number"
                  min="0"
                  value={hallRate}
                  onChange={(e) => setHallRate(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Status</Label>
              <Select value={hallStatus} onValueChange={setHallStatus}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="AVAILABLE">AVAILABLE</SelectItem>
                  <SelectItem value="MAINTENANCE">MAINTENANCE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amenities / Features</Label>
              <Input
                value={hallAmenities}
                onChange={(e) => setHallAmenities(e.target.value)}
                placeholder="e.g. Central AC, DJ Lights, Stage, Projector"
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Description</Label>
              <Textarea
                rows={2}
                value={hallDescription}
                onChange={(e) => setHallDescription(e.target.value)}
                placeholder="Hall features and details..."
                className="text-xs resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={() => setHallModalOpen(false)} disabled={hallBusy}>
                Cancel
              </Button>
              <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold" disabled={hallBusy}>
                {hallBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                {editingHall ? 'Update Hall' : 'Save Hall'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
