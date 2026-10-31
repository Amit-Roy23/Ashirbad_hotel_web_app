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
import { api, apiAs, formatINR, formatDate, formatDateTime, exportCSV, printTableReport, todayStr, matchesPhone, formatGovIdDisplay } from '@/lib/hotel-utils'
import { addDaysStr, slotLabel } from '@/lib/banquet-time'
import { splitGst } from '@/lib/gst'
import { getCachedUser } from './user-context'
import { toast } from '@/hooks/use-toast'
import { BanquetHall, BanquetBooking, BanquetBill, BanquetStats } from '@/types/banquet'
import { BanquetBookingDialog } from './banquet-booking-dialog'
import { BanquetBillDialog } from './banquet-bill-dialog'
import { triggerPrintBanquetInvoice, triggerPrintBanquetAdvanceReceipt } from '@/lib/print-banquet-invoice'
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
  Ban,
  Wallet,
  FileText,
} from 'lucide-react'
import { AdminDeleteDialog } from './admin-delete-dialog'
import { BanquetPaymentDialog, BanquetPaymentHistory } from './banquet-payments'

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
  // One search for bookings, invoices and the overview
  const [search, setSearch] = useState(initialFilter || '')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [hallFilter, setHallFilter] = useState('ALL')
  const [viewBooking, setViewBooking] = useState<BanquetBooking | null>(null)
  const [justBooked, setJustBooked] = useState(false)

  // Dialog states
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false)
  const [selectedBooking, setSelectedBooking] = useState<BanquetBooking | null>(null)
  const [deleteTargetBanquetBooking, setDeleteTargetBanquetBooking] = useState<BanquetBooking | null>(null)
  const [deleteTargetBanquetBill, setDeleteTargetBanquetBill] = useState<BanquetBill | null>(null)
  const [cancelTargetBooking, setCancelTargetBooking] = useState<BanquetBooking | null>(null)
  const [cancelReason, setCancelReason] = useState('Client requested cancellation')
  const [cancelRefundAmount, setCancelRefundAmount] = useState('0')
  const [cancelRefundMethod, setCancelRefundMethod] = useState('CASH')
  const [cancelRefundNote, setCancelRefundNote] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelPin, setCancelPin] = useState('')
  const [cancelError, setCancelError] = useState('')

  const [billDialogOpen, setBillDialogOpen] = useState(false)
  const [billingBooking, setBillingBooking] = useState<BanquetBooking | null>(null)
  const [editingBill, setEditingBill] = useState<BanquetBill | null>(null)
  const [billMode, setBillMode] = useState<'pay' | 'edit'>('pay')
  const [payFor, setPayFor] = useState<BanquetBooking | null>(null)
  const [deleteHall, setDeleteHall] = useState<BanquetHall | null>(null)

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
  function handleDeleteBooking(b: BanquetBooking) {
    setDeleteTargetBanquetBooking(b)
  }

  function handleDeleteBill(b: BanquetBill) {
    setDeleteTargetBanquetBill(b)
  }

  // Cancel Booking Handlers
  function handleOpenCancel(b: BanquetBooking) {
    setCancelTargetBooking(b)
    setCancelReason('Client requested cancellation')
    setCancelRefundAmount(String(b.advancePaid || 0))
    setCancelRefundMethod('CASH')
    setCancelRefundNote('')
    setCancelPin('')
    setCancelError('')
  }

  async function handleConfirmCancel() {
    if (!cancelTargetBooking) return
    if (!cancelPin.trim()) {
      setCancelError('Enter the Admin PIN to cancel this booking')
      return
    }
    setCancelBusy(true)
    setCancelError('')
    try {
      await apiAs('/api/banquet-bookings', getCachedUser(), {
        method: 'POST',
        adminPin: cancelPin.trim(),
        body: JSON.stringify({
          action: 'cancel',
          id: cancelTargetBooking.id,
          reason: cancelReason,
          refundAmount: parseFloat(cancelRefundAmount) || 0,
          refundMethod: cancelRefundMethod,
          refundNote: cancelRefundNote,
        }),
      })
      toast({
        variant: 'success',
        title: 'Banquet Booking Cancelled',
        description: `Booking ${cancelTargetBooking.bookingNumber} (${cancelTargetBooking.customerName}) has been cancelled and hall slot freed.`,
      })
      setCancelTargetBooking(null)
      setViewBooking(null)
      loadData()
      onDataChanged()
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Could not cancel booking')
    } finally {
      setCancelBusy(false)
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

  // Filtered lists: text fields match anywhere; phone numbers match from the 5th digit typed
  const q = search.trim().toLowerCase()
  const bookingMatches = (b: BanquetBooking) =>
    !q ||
    [b.customerName, b.eventName, b.bookingNumber, b.hall?.name, b.companyName].some((v) => v?.toLowerCase().includes(q)) ||
    matchesPhone(b.customerPhone, q)
  const filteredBookings = bookings.filter((b) => {
    if (hallFilter !== 'ALL' && b.hallId !== hallFilter) return false
    if (statusFilter !== 'ALL' && b.status !== statusFilter) return false
    return bookingMatches(b)
  })

  const filteredBills = bills.filter(
    (b) =>
      !q ||
      [b.billNumber, b.customerName, b.eventName, b.hallName, b.companyName].some((v) => v?.toLowerCase().includes(q)) ||
      matchesPhone(b.customerPhone, q)
  )

  const todayIso = todayStr()
  // Paid / balance: from the invoice once there is one, before that from the estimate and advance
  const billOf = (b: BanquetBooking) => bills.find((x) => x.banquetBookingId === b.id)
  const paidFor = (b: BanquetBooking) => {
    const bill = billOf(b)
    return bill
      ? (bill.advanceApplied || 0) + (bill.payCash || 0) + (bill.payUpi || 0) + (bill.payCard || 0) + (bill.payBank || 0)
      : b.advancePaid || 0
  }
  const balanceFor = (b: BanquetBooking) => {
    const bill = billOf(b)
    return Math.max(0, Math.round(((bill ? bill.grandTotal : b.totalEstimated) - paidFor(b)) * 100) / 100)
  }

  // A multi-day event runs from its first to its last day
  const lastDayOf = (b: BanquetBooking) => addDaysStr(b.eventDate.slice(0, 10), Math.max(1, b.days || 1) - 1)
  const todayBookings = bookings.filter(
    (b) => b.eventDate && b.status !== 'CANCELLED' && b.eventDate.slice(0, 10) <= todayIso && lastDayOf(b) >= todayIso && bookingMatches(b)
  )
  const upcomingBookings = bookings
    .filter((b) => b.eventDate && b.eventDate.slice(0, 10) >= todayIso && b.status !== 'CANCELLED' && bookingMatches(b))
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
  const whenText = (b: BanquetBooking) =>
    `${formatDate(b.eventDate)}${(b.days || 1) > 1 ? ` – ${formatDate(lastDayOf(b))} (${b.days} days)` : ''}`

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
          <CardContent className="flex items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
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
          <CardContent className="flex items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
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
          <CardContent className="flex items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
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
          <CardContent className="flex items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
            <div className="rounded-full bg-red-100 p-2.5 dark:bg-red-900">
              <AlertCircle className="h-5 w-5 text-red-700 dark:text-red-300" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Outstanding Balance</p>
              <p className="text-lg font-bold text-red-700 dark:text-red-400">{formatINR(stats?.totalOutstanding)}</p>
              <p className="text-[10px] text-muted-foreground">
                Invoices {formatINR(stats?.invoiceOutstanding)} · bookings {formatINR(stats?.bookingsOutstanding)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search across bookings, invoices and today's / upcoming events */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search banquet: host name, event, booking / invoice no., company, or phone (5+ digits)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-10 pl-9 text-sm"
          aria-label="Search banquet bookings and invoices"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
      {q && (
        <p className="-mt-2 text-xs text-muted-foreground">
          {filteredBookings.length} booking{filteredBookings.length === 1 ? '' : 's'} and {filteredBills.length} invoice
          {filteredBills.length === 1 ? '' : 's'} match “{search.trim()}”
          {/^\d{1,4}$/.test(search.trim()) && ' · type at least 5 digits to search phone numbers'}
        </p>
      )}

      {/* Main Tabs */}
      <Tabs value={activeSubTab} onValueChange={(v) => setActiveSubTab(v as any)}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 sm:inline-flex sm:w-auto sm:flex-wrap [&>button]:h-8">
          <TabsTrigger value="overview" className="gap-1.5">
            <PartyPopper className="h-4 w-4" /> <span className="sm:hidden">Overview</span><span className="hidden sm:inline">Overview &amp; Today&apos;s Events</span>
          </TabsTrigger>
          <TabsTrigger value="bookings" className="gap-1.5">
            <CalendarDays className="h-4 w-4" /> <span className="sm:hidden">Bookings</span><span className="hidden sm:inline">Bookings &amp; Inquiries</span> ({bookings.length})
          </TabsTrigger>
          <TabsTrigger value="bills" className="gap-1.5">
            <Receipt className="h-4 w-4" /> <span className="sm:hidden">Billing</span><span className="hidden sm:inline">Banquet Billing &amp; Invoices</span> ({bills.length})
          </TabsTrigger>
          <TabsTrigger value="halls" className="gap-1.5">
            <Building2 className="h-4 w-4" /> <span className="sm:hidden">Halls</span><span className="hidden sm:inline">Venues &amp; Halls</span> ({halls.length})
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
                        <p className="text-xs text-muted-foreground">
                          {b.hall?.name} · {slotLabel(b.slot, b.startTime, b.endTime)}
                          {(b.days || 1) > 1 && ` · ${whenText(b)}`}
                        </p>
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
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setViewBooking(b)}>
                        <Eye className="mr-1 h-3 w-3" /> Details
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
                      {b.status !== 'COMPLETED' && b.status !== 'CANCELLED' && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 border-red-200 dark:border-red-900"
                          onClick={() => handleOpenCancel(b)}
                          title="Cancel Booking"
                        >
                          <Ban className="mr-1 h-3 w-3" /> Cancel
                        </Button>
                      )}
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
                <p className="text-xs text-muted-foreground py-4 text-center">{q ? 'No upcoming events match the search.' : 'No upcoming events booked yet.'}</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {upcomingBookings.slice(0, q ? 50 : 8).map((b) => (
                    <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-xs hover:bg-muted/40 transition-colors">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-foreground">{b.eventName}</span>
                          <Badge variant="outline" className="text-[10px]">{b.hall?.name}</Badge>
                          <Badge className="bg-emerald-600 text-[9px] h-4">{slotLabel(b.slot, b.startTime, b.endTime)}</Badge>
                          {(b.days || 1) > 1 && <Badge variant="outline" className="h-4 text-[9px]">{b.days} days</Badge>}
                        </div>
                        <div className="text-muted-foreground text-[11px]">
                          Host: <b>{b.customerName}</b> ({b.customerPhone}) · {b.guestCount} Guests · {formatINR(b.totalEstimated)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-right">
                          <span className="font-bold text-emerald-700 dark:text-emerald-400 block">{whenText(b)}</span>
                          <span className="text-[10px] text-muted-foreground">Adv: {formatINR(b.advancePaid)}</span>
                        </div>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setViewBooking(b)} title="Booking Details">
                          <Eye className="h-3.5 w-3.5" />
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
                          onClick={() => handleOpenCancel(b)}
                          title="Cancel Booking"
                        >
                          <Ban className="h-3.5 w-3.5" />
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
              onClick={() => {
                const headers = ['Booking No', 'Event Date(s)', 'Time', 'Event Name', 'Hall', 'Customer', 'Phone', 'Guests', 'Hall Rent', 'Food Total', 'Est. Total', 'Advance Paid', 'Status', 'Payment Status']
                exportCSV(
                  'banquet_bookings.csv',
                  headers,
                  filteredBookings.map((b) => [
                    b.bookingNumber,
                    whenText(b),
                    slotLabel(b.slot, b.startTime, b.endTime),
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
              }}
            >
              <Download className="h-3.5 w-3.5" /> Export
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-xs"
              onClick={() => {
                const headers = ['Booking No', 'Event Date(s)', 'Time', 'Event Name', 'Hall', 'Customer', 'Phone', 'Guests', 'Hall Rent', 'Food Total', 'Est. Total', 'Advance Paid', 'Status', 'Payment Status']
                printTableReport(
                  'Banquet Bookings Report',
                  headers,
                  filteredBookings.map((b) => [
                    b.bookingNumber,
                    whenText(b),
                    slotLabel(b.slot, b.startTime, b.endTime),
                    b.eventName,
                    b.hall?.name || '',
                    b.customerName,
                    b.customerPhone,
                    b.guestCount,
                    formatINR(b.hallRent),
                    formatINR(b.foodTotal),
                    formatINR(b.totalEstimated),
                    formatINR(b.advancePaid),
                    b.status,
                    b.paymentStatus,
                  ]),
                  `${filteredBookings.length} banquet bookings listed`
                )
              }}
            >
              <Printer className="h-3.5 w-3.5" /> Print
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
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBookings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-8 text-center text-sm text-muted-foreground">
                      No banquet bookings found matching your search.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredBookings.map((b) => (
                    <TableRow key={b.id} className={b.status === 'CANCELLED' ? 'bg-muted/20 opacity-80' : ''}>
                      <TableCell className="text-xs font-semibold">
                        <button type="button" className="text-left hover:underline" onClick={() => setViewBooking(b)}>
                          {b.bookingNumber}
                        </button>
                        <div className="text-[10px] text-muted-foreground">{formatDate(b.createdAt)}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs font-medium">
                        <div>{whenText(b)}</div>
                        <Badge variant="outline" className="text-[9px] h-4 mt-0.5">{slotLabel(b.slot, b.startTime, b.endTime)}</Badge>
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
                        {formatINR(paidFor(b))}
                      </TableCell>
                      <TableCell className={`text-right text-xs font-bold ${balanceFor(b) > 0.01 && b.status !== 'CANCELLED' ? 'text-red-600' : 'text-muted-foreground'}`}>
                        {b.status === 'CANCELLED' ? '—' : formatINR(balanceFor(b))}
                      </TableCell>
                      <TableCell className="text-xs">
                        {b.status === 'CONFIRMED' && (
                          <Badge className="bg-emerald-600 text-white font-semibold">CONFIRMED</Badge>
                        )}
                        {b.status === 'CANCELLED' && (
                          <Badge variant="destructive" className="bg-red-500/15 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800 font-semibold">
                            CANCELLED
                          </Badge>
                        )}
                        {b.status === 'COMPLETED' && (
                          <Badge variant="secondary" className="font-semibold">COMPLETED</Badge>
                        )}
                        {b.status === 'IN_PROGRESS' && (
                          <Badge className="bg-amber-600 text-white font-semibold">IN PROGRESS</Badge>
                        )}
                        {b.status === 'ENQUIRY' && (
                          <Badge variant="outline" className="text-muted-foreground font-semibold">ENQUIRY</Badge>
                        )}
                        {!['CONFIRMED', 'CANCELLED', 'COMPLETED', 'IN_PROGRESS', 'ENQUIRY'].includes(b.status) && (
                          <Badge variant="outline">{b.status}</Badge>
                        )}
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
                            title={b.status === 'COMPLETED' ? 'Already invoiced — see Billing & Invoices' : b.status === 'CANCELLED' ? 'Booking is cancelled' : 'Generate Final Bill'}
                          >
                            <Receipt className="h-3 w-3" /> Bill
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setViewBooking(b)} title="Booking Details">
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0"
                            onClick={() => triggerPrintBanquetAdvanceReceipt(b)}
                            title="Print Advance Receipt"
                          >
                            <FileText className="h-3.5 w-3.5" />
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
                          {b.status !== 'COMPLETED' && b.status !== 'CANCELLED' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                              onClick={() => handleOpenCancel(b)}
                              title="Cancel Booking"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          )}
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

            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-xs"
              onClick={() => {
                const headers = ['Invoice No', 'Date', 'Customer', 'Phone', 'Event', 'Hall', 'Taxable', 'CGST', 'SGST', 'Grand Total', 'Advance Deducted', 'Paid at Completion', 'Balance Due', 'Status']
                exportCSV(
                  'banquet_invoices.csv',
                  headers,
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
                      splitGst({ ...b, actualGst: b.gstAmount }).cgst,
                      splitGst({ ...b, actualGst: b.gstAmount }).sgst,
                      b.grandTotal,
                      b.advanceApplied,
                      paid - b.advanceApplied,
                      bal,
                      b.paymentStatus,
                    ]
                  })
                )
              }}
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="gap-1 text-xs"
              onClick={() => {
                const headers = ['Invoice No', 'Date', 'Customer', 'Phone', 'Event', 'Hall', 'Taxable', 'CGST', 'SGST', 'Grand Total', 'Advance Deducted', 'Paid at Completion', 'Balance Due', 'Status']
                printTableReport(
                  'Banquet Invoices Report',
                  headers,
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
                      formatINR(b.taxableAmount),
                      formatINR(splitGst({ ...b, actualGst: b.gstAmount }).cgst),
                      formatINR(splitGst({ ...b, actualGst: b.gstAmount }).sgst),
                      formatINR(b.grandTotal),
                      formatINR(b.advanceApplied),
                      formatINR(paid - b.advanceApplied),
                      formatINR(bal),
                      b.paymentStatus,
                    ]
                  }),
                  `${filteredBills.length} banquet invoices listed`
                )
              }}
            >
              <Printer className="h-3.5 w-3.5" /> Print
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
                  <TableHead className="text-right">CGST + SGST</TableHead>
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
                      {q ? 'No banquet invoices match the search.' : 'No banquet invoices generated yet.'}
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
                        <TableCell className="text-right text-xs">
                          {formatINR(splitGst({ ...b, actualGst: b.gstAmount }).cgst)} + {formatINR(splitGst({ ...b, actualGst: b.gstAmount }).sgst)}
                        </TableCell>
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
                                  setBillMode('pay')
                                  setBillDialogOpen(true)
                                }}
                                title="Record a payment"
                              >
                                <Wallet className="h-3 w-3" /> Pay
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => {
                                setEditingBill(b)
                                setBillingBooking(null)
                                setBillMode('edit')
                                setBillDialogOpen(true)
                              }}
                              title="Edit invoice (Admin PIN)"
                            >
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
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
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                      onClick={() => setDeleteHall(h)}
                      title="Delete hall"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
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
        onSuccess={(saved, created) => {
          loadData()
          onDataChanged()
          // Right after a new booking, show its details with the advance receipt ready to print
          if (created && saved) {
            setJustBooked(true)
            setViewBooking(saved)
          }
        }}
      />

      {/* Billing Dialog */}
      <BanquetBillDialog
        open={billDialogOpen}
        onOpenChange={setBillDialogOpen}
        booking={billingBooking}
        existingBill={editingBill}
        mode={billMode}
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

      {/* Booking details */}
      <Dialog
        open={!!viewBooking}
        onOpenChange={(open) => {
          if (!open) {
            setViewBooking(null)
            setJustBooked(false)
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          {viewBooking &&
            (() => {
              const b = viewBooking
              const days = Math.max(1, b.days || 1)
              const ratePerDay = b.hallRatePerDay || b.hallRent / days
              const balance = b.status === 'CANCELLED' ? 0 : balanceFor(b)
              const active = b.status !== 'COMPLETED' && b.status !== 'CANCELLED'
              const row = (label: string, value: React.ReactNode) =>
                value === null || value === undefined || value === '' ? null : (
                  <div className="flex justify-between gap-3 py-0.5">
                    <span className="text-muted-foreground">{label}</span>
                    <span className="text-right font-medium">{value}</span>
                  </div>
                )
              return (
                <>
                  <DialogHeader>
                    <DialogTitle className="flex flex-wrap items-center gap-2">
                      {b.bookingNumber}
                      <Badge variant="outline">{b.status}</Badge>
                      <Badge variant="outline" className={b.paymentStatus === 'PAID' ? 'border-emerald-400 text-emerald-700' : ''}>
                        {b.paymentStatus}
                      </Badge>
                    </DialogTitle>
                    <DialogDescription>
                      {b.eventName} · {b.hall?.name} · booked {formatDateTime(b.createdAt)}
                      {b.createdBy ? ` by ${b.createdBy}` : ''}
                    </DialogDescription>
                  </DialogHeader>

                  {justBooked && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm dark:border-emerald-800 dark:bg-emerald-950/40">
                      <span className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300">
                        <CheckCircle2 className="h-4 w-4" /> Booking confirmed
                        {b.advancePaid > 0 ? ` · advance ${formatINR(b.advancePaid)} received` : ''}
                      </span>
                      <Button size="sm" className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => triggerPrintBanquetAdvanceReceipt(b)}>
                        <Printer className="h-4 w-4" /> Print Advance Receipt
                      </Button>
                    </div>
                  )}

                  <div className="grid gap-3 text-xs sm:grid-cols-2">
                    <div className="rounded-lg border p-3">
                      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Event</p>
                      {row('Occasion', b.eventName)}
                      {row('Hall', b.hall?.name)}
                      {row('Date', whenText(b))}
                      {row('Time', slotLabel(b.slot, b.startTime, b.endTime))}
                      {row('Guests', b.guestCount)}
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Host / Client</p>
                      {row('Name', b.customerName)}
                      {row('Phone', b.customerPhone)}
                      {row('Email', b.customerEmail)}
                      {row('Address', b.customerAddress)}
                      {row('Company', b.companyName)}
                      {row('GSTIN', b.gstNumber)}
                      {row('ID Proof', b.idProof ? formatGovIdDisplay(b.idProof) : 'Not recorded')}
                    </div>
                  </div>

                  <div className="rounded-lg border p-3 text-xs">
                    <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Charges (estimate)</p>
                    {row('Hall rent', b.hallRent > 0 ? `${formatINR(ratePerDay)} × ${days} day${days > 1 ? 's' : ''} = ${formatINR(b.hallRent)}` : 'Not included')}
                    {row(
                      'Catering',
                      b.foodTotal > 0
                        ? `${b.foodPackageName ? `${b.foodPackageName}: ` : ''}${b.guestCount} × ${formatINR(b.foodRatePerPlate)}${days > 1 ? ` × ${days} days` : ''} = ${formatINR(b.foodTotal)}`
                        : 'Not included'
                    )}
                    {b.decorEnabled === false
                      ? row('Decor, AV & discount', 'Not included')
                      : (
                        <>
                          {b.decorCharges > 0 && row('Stage & decor', formatINR(b.decorCharges))}
                          {b.extraCharges > 0 && row('Sound, DJ & AV', formatINR(b.extraCharges))}
                          {b.discount > 0 && row('Discount', `- ${formatINR(b.discount)}`)}
                        </>
                      )}
                    <div className="mt-1.5 flex justify-between border-t pt-1.5 text-sm font-bold">
                      <span>Estimated total (before GST)</span>
                      <span>{formatINR(b.totalEstimated)}</span>
                    </div>
                    {billOf(b) && (
                      <div className="flex justify-between text-sm font-bold">
                        <span>Invoice {billOf(b)!.billNumber} (with GST)</span>
                        <span>{formatINR(billOf(b)!.grandTotal)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                      <span>Paid</span>
                      <span>{formatINR(paidFor(b))}</span>
                    </div>
                    <div className={`flex justify-between text-sm font-semibold ${balance > 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                      <span>Balance</span>
                      <span>{formatINR(balance)}</span>
                    </div>
                  </div>

                  <BanquetPaymentHistory bookingId={b.id} refreshKey={refreshKey + bills.length + Math.round(b.advancePaid)} />

                  {b.notes && (
                    <div className="rounded-lg border bg-muted/30 p-3 text-xs">
                      <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Notes</p>
                      <p className="whitespace-pre-wrap break-words">{b.notes}</p>
                    </div>
                  )}

                  <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
                    {!justBooked && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => triggerPrintBanquetAdvanceReceipt(b)}>
                        <Printer className="h-4 w-4" /> Advance Receipt
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => {
                        setSelectedBooking(b)
                        setViewBooking(null)
                        setJustBooked(false)
                        setBookingDialogOpen(true)
                      }}
                    >
                      <Edit className="h-4 w-4" /> Edit
                    </Button>
                    {b.status !== 'CANCELLED' && balanceFor(b) > 0.01 && (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPayFor(b)}>
                        <Wallet className="h-4 w-4" /> Record Payment
                      </Button>
                    )}
                    {active && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:hover:bg-red-950/30"
                          onClick={() => handleOpenCancel(b)}
                        >
                          <Ban className="h-4 w-4" /> Cancel Booking
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={() => {
                            setBillingBooking(b)
                            setEditingBill(null)
                            setViewBooking(null)
                            setJustBooked(false)
                            setBillDialogOpen(true)
                          }}
                        >
                          <Receipt className="h-4 w-4" /> Final Bill
                        </Button>
                      </>
                    )}
                  </div>
                </>
              )
            })()}
        </DialogContent>
      </Dialog>

      {/* Cancel Banquet Booking Dialog */}
      <Dialog open={!!cancelTargetBooking} onOpenChange={(open) => !open && setCancelTargetBooking(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base text-red-600 dark:text-red-400">
              <XCircle className="h-5 w-5" /> Cancel Banquet Booking
            </DialogTitle>
            <DialogDescription>
              Cancel reservation and release the banquet hall date/slot.
            </DialogDescription>
          </DialogHeader>

          {cancelTargetBooking && (
            <div className="space-y-3 pt-1 text-xs">
              {/* Booking Summary Card */}
              <div className="rounded-lg border bg-muted/40 p-3 space-y-1">
                <div className="flex justify-between items-center font-bold text-sm">
                  <span>{cancelTargetBooking.eventName}</span>
                  <Badge variant="outline">{cancelTargetBooking.bookingNumber}</Badge>
                </div>
                <p className="text-muted-foreground">
                  Host: <b>{cancelTargetBooking.customerName}</b> ({cancelTargetBooking.customerPhone})
                </p>
                <div className="flex justify-between text-muted-foreground pt-1 border-t border-dashed">
                  <span>Venue: {cancelTargetBooking.hall?.name} ({slotLabel(cancelTargetBooking.slot, cancelTargetBooking.startTime, cancelTargetBooking.endTime)})</span>
                  <span className="font-semibold text-foreground">{whenText(cancelTargetBooking)}</span>
                </div>
                <div className="flex justify-between pt-1">
                  <span>Estimated Total: <b>{formatINR(cancelTargetBooking.totalEstimated)}</b></span>
                  <span className="font-bold text-emerald-700 dark:text-emerald-400">
                    Advance Paid: {formatINR(cancelTargetBooking.advancePaid)}
                  </span>
                </div>
              </div>

              {/* Cancellation Reason */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Cancellation Reason *</Label>
                <div className="grid grid-cols-2 gap-1.5 pb-1">
                  {[
                    'Client requested cancellation',
                    'Date postponed / rescheduled',
                    'Personal emergency',
                    'Duplicate / test booking',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      className={`text-[11px] px-2 py-1 rounded border text-left truncate transition-colors ${
                        cancelReason === preset
                          ? 'border-red-500 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800 font-medium'
                          : 'bg-muted/50 hover:bg-muted text-muted-foreground'
                      }`}
                      onClick={() => setCancelReason(preset)}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <Input
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Specify reason..."
                  className="h-8 text-xs"
                  required
                />
              </div>

              {/* Advance Refund Section if advance was paid */}
              {Number(cancelTargetBooking.advancePaid) > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-800 dark:bg-amber-950/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                      Advance Refund Settlement
                    </Label>
                    <span className="text-[11px] font-bold text-amber-800 dark:text-amber-300">
                      Advance Held: {formatINR(cancelTargetBooking.advancePaid)}
                    </span>
                  </div>

                  <div className="flex gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2"
                      onClick={() => setCancelRefundAmount(String(cancelTargetBooking.advancePaid))}
                    >
                      Full Refund ({formatINR(cancelTargetBooking.advancePaid)})
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2"
                      onClick={() => setCancelRefundAmount(String(Math.round(Number(cancelTargetBooking.advancePaid) / 2)))}
                    >
                      50% Refund
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2"
                      onClick={() => setCancelRefundAmount('0')}
                    >
                      No Refund (Forfeited)
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div className="space-y-1">
                      <Label className="text-[11px]">Refund Amount (₹)</Label>
                      <Input
                        type="number"
                        min="0"
                        max={cancelTargetBooking.advancePaid}
                        value={cancelRefundAmount}
                        onChange={(e) => setCancelRefundAmount(e.target.value)}
                        className="h-8 text-xs bg-white dark:bg-slate-900"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px]">Refund Method</Label>
                      <Select value={cancelRefundMethod} onValueChange={(val) => setCancelRefundMethod(val as any)}>
                        <SelectTrigger className="h-8 text-xs bg-white dark:bg-slate-900">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="CASH">Cash</SelectItem>
                          <SelectItem value="UPI">UPI / QR</SelectItem>
                          <SelectItem value="CARD">Card</SelectItem>
                          <SelectItem value="BANK">Bank Transfer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-[11px]">Refund / Policy Remarks</Label>
                    <Input
                      value={cancelRefundNote}
                      onChange={(e) => setCancelRefundNote(e.target.value)}
                      placeholder="e.g. Deducted cancellation charge per hotel policy"
                      className="h-8 text-xs bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-1.5 rounded-lg border border-red-200 bg-red-50/50 p-3 dark:border-red-900 dark:bg-red-950/20">
                <Label htmlFor="cancel-admin-pin" className="text-xs font-semibold">
                  Admin PIN *
                </Label>
                <Input
                  id="cancel-admin-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={cancelPin}
                  onChange={(e) => {
                    setCancelPin(e.target.value)
                    setCancelError('')
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleConfirmCancel()}
                  placeholder="Admin PIN needed to cancel"
                  className="h-9 text-sm"
                />
                {cancelError && <p className="text-xs text-red-600">{cancelError}</p>}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCancelTargetBooking(null)}
                  disabled={cancelBusy}
                >
                  Keep Booking
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleConfirmCancel}
                  disabled={cancelBusy || !cancelReason.trim() || !cancelPin.trim()}
                  className="gap-1 font-semibold"
                >
                  {cancelBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Confirm Cancellation
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Admin PIN Protected Delete Banquet Booking Dialog */}
      <AdminDeleteDialog
        open={!!deleteTargetBanquetBooking}
        onOpenChange={(open) => !open && setDeleteTargetBanquetBooking(null)}
        title="Delete Banquet Booking"
        itemType="Banquet Booking"
        itemName={deleteTargetBanquetBooking ? `Booking ${deleteTargetBanquetBooking.bookingNumber} (${deleteTargetBanquetBooking.customerName}) - ${deleteTargetBanquetBooking.eventName}` : ''}
        warningNotice="Deleting this booking permanently deletes related bills and ledger records. Admin PIN is required."
        onConfirm={async (adminPin) => {
          if (!deleteTargetBanquetBooking) return
          await apiAs(`/api/banquet-bookings?id=${deleteTargetBanquetBooking.id}`, getCachedUser(), { method: 'DELETE', adminPin })
          toast({ variant: 'success', title: 'Deleted', description: 'Banquet booking deleted.' })
          setDeleteTargetBanquetBooking(null)
          loadData()
          onDataChanged()
        }}
      />

      {payFor && (
        <BanquetPaymentDialog
          booking={payFor}
          balance={balanceFor(payFor)}
          invoiceNumber={billOf(payFor)?.billNumber}
          onClose={() => setPayFor(null)}
          onSaved={() => {
            setPayFor(null)
            setViewBooking(null)
            loadData()
            onDataChanged()
          }}
        />
      )}

      <AdminDeleteDialog
        open={!!deleteHall}
        onOpenChange={(open) => !open && setDeleteHall(null)}
        title="Delete Banquet Hall"
        itemType="Banquet hall"
        itemName={deleteHall ? `${deleteHall.name} (capacity ${deleteHall.capacity})` : ''}
        warningNotice="A hall that has bookings cannot be deleted; set it to MAINTENANCE instead."
        onConfirm={async (adminPin) => {
          if (!deleteHall) return
          await apiAs(`/api/banquet-halls?id=${deleteHall.id}`, getCachedUser(), { method: 'DELETE', adminPin })
          toast({ variant: 'success', title: 'Hall deleted', description: deleteHall.name })
          setDeleteHall(null)
          loadData()
          onDataChanged()
        }}
      />

      {/* Admin PIN Protected Delete Banquet Invoice Dialog */}
      <AdminDeleteDialog
        open={!!deleteTargetBanquetBill}
        onOpenChange={(open) => !open && setDeleteTargetBanquetBill(null)}
        title="Delete Banquet Invoice"
        itemType="Banquet Invoice"
        itemName={deleteTargetBanquetBill ? `Invoice ${deleteTargetBanquetBill.billNumber} (${formatINR(deleteTargetBanquetBill.grandTotal)}) for ${deleteTargetBanquetBill.customerName}` : ''}
        warningNotice="Deleting a banquet invoice deletes associated income ledger records. Admin PIN is required."
        onConfirm={async (adminPin) => {
          if (!deleteTargetBanquetBill) return
          await apiAs(`/api/banquet-bills?id=${deleteTargetBanquetBill.id}`, getCachedUser(), { method: 'DELETE', adminPin })
          toast({ variant: 'success', title: 'Deleted', description: 'Banquet invoice deleted.' })
          setDeleteTargetBanquetBill(null)
          loadData()
          onDataChanged()
        }}
      />
    </div>
  )
}
