'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { apiAs, formatINR, todayStr } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { toast } from '@/hooks/use-toast'
import { BanquetHall, BanquetBooking } from '@/types/banquet'
import {
  CalendarDays,
  Users,
  Utensils,
  PartyPopper,
  Loader2,
  CheckCircle2,
  Building2,
  Receipt,
  Sparkles,
  Phone,
  Mail,
  MapPin,
  Tag,
  Wallet,
  FileText,
} from 'lucide-react'

interface BanquetBookingDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  halls: BanquetHall[]
  booking?: BanquetBooking | null
  onSuccess: () => void
}

const EVENT_PRESETS = [
  'Wedding Reception',
  'Marriage Ceremony',
  'Birthday Celebration',
  'Engagement / Ring Ceremony',
  'Corporate Conference',
  'Annual General Meeting (AGM)',
  'Anniversary Party',
  'Seminar & Workshop',
  'Cocktail & Sangeet Night',
  'Kitty Party / Get-together',
  'Product Launch',
]

const SLOTS = [
  { value: 'EVENING', label: 'Evening (06:00 PM – 11:30 PM)' },
  { value: 'MORNING', label: 'Morning (09:00 AM – 03:30 PM)' },
  { value: 'FULL_DAY', label: 'Full Day (09:00 AM – 11:30 PM)' },
  { value: 'CUSTOM', label: 'Custom Hours' },
]

export function BanquetBookingDialog({
  open,
  onOpenChange,
  halls,
  booking,
  onSuccess,
}: BanquetBookingDialogProps) {
  const [busy, setBusy] = useState(false)
  const isEditing = !!booking

  // Form State
  const [hallId, setHallId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [gstNumber, setGstNumber] = useState('')
  const [eventName, setEventName] = useState('Wedding Reception')
  const [customEventName, setCustomEventName] = useState('')
  const [eventDate, setEventDate] = useState(todayStr())
  const [slot, setSlot] = useState('EVENING')
  const [guestCount, setGuestCount] = useState('150')
  const [hallRent, setHallRent] = useState('25000')
  const [foodRatePerPlate, setFoodRatePerPlate] = useState('650')
  const [foodPackageName, setFoodPackageName] = useState('Standard Buffet')
  const [decorCharges, setDecorCharges] = useState('10000')
  const [extraCharges, setExtraCharges] = useState('0')
  const [discount, setDiscount] = useState('0')
  const [advancePaid, setAdvancePaid] = useState('10000')
  const [advanceMethod, setAdvanceMethod] = useState('UPI')
  const [status, setStatus] = useState('CONFIRMED')
  const [notes, setNotes] = useState('')

  // Sync with hall selection or existing booking
  useEffect(() => {
    if (booking) {
      setHallId(booking.hallId)
      setCustomerName(booking.customerName)
      setCustomerPhone(booking.customerPhone)
      setCustomerEmail(booking.customerEmail || '')
      setCustomerAddress(booking.customerAddress || '')
      setCompanyName(booking.companyName || '')
      setGstNumber(booking.gstNumber || '')
      if (EVENT_PRESETS.includes(booking.eventName)) {
        setEventName(booking.eventName)
        setCustomEventName('')
      } else {
        setEventName('Other')
        setCustomEventName(booking.eventName)
      }
      setEventDate(booking.eventDate ? booking.eventDate.slice(0, 10) : todayStr())
      setSlot(booking.slot || 'EVENING')
      setGuestCount(String(booking.guestCount || 100))
      setHallRent(String(booking.hallRent || 0))
      setFoodRatePerPlate(String(booking.foodRatePerPlate || 0))
      setFoodPackageName(booking.foodPackageName || 'Standard Buffet')
      setDecorCharges(String(booking.decorCharges || 0))
      setExtraCharges(String(booking.extraCharges || 0))
      setDiscount(String(booking.discount || 0))
      setAdvancePaid(String(booking.advancePaid || 0))
      setStatus(booking.status || 'CONFIRMED')
      setNotes(booking.notes || '')
    } else {
      if (halls.length > 0 && !hallId) {
        const first = halls[0]
        setHallId(first.id)
        setHallRent(String(first.baseRate || 20000))
        setGuestCount(String(first.capacity || 150))
      }
      setCustomerName('')
      setCustomerPhone('')
      setCustomerEmail('')
      setCustomerAddress('')
      setCompanyName('')
      setGstNumber('')
      setEventName('Wedding Reception')
      setCustomEventName('')
      setEventDate(todayStr())
      setSlot('EVENING')
      setFoodRatePerPlate('650')
      setFoodPackageName('Royal Buffet')
      setDecorCharges('10000')
      setExtraCharges('0')
      setDiscount('0')
      setAdvancePaid('10000')
      setAdvanceMethod('UPI')
      setStatus('CONFIRMED')
      setNotes('')
    }
  }, [booking, halls, open])

  // When hall changes in create mode, auto-fill base rate & capacity
  function onHallChange(newId: string) {
    setHallId(newId)
    if (!isEditing) {
      const selected = halls.find((h) => h.id === newId)
      if (selected) {
        setHallRent(String(selected.baseRate))
        setGuestCount(String(selected.capacity))
      }
    }
  }

  // Live total calculations
  const numGuests = Math.max(0, parseInt(guestCount) || 0)
  const numHallRent = Math.max(0, parseFloat(hallRent) || 0)
  const numFoodPerPlate = Math.max(0, parseFloat(foodRatePerPlate) || 0)
  const totalFood = numGuests * numFoodPerPlate
  const numDecor = Math.max(0, parseFloat(decorCharges) || 0)
  const numExtra = Math.max(0, parseFloat(extraCharges) || 0)
  const numDiscount = Math.max(0, parseFloat(discount) || 0)
  const numAdvance = Math.max(0, parseFloat(advancePaid) || 0)

  const grandEstimated = Math.max(0, numHallRent + totalFood + numDecor + numExtra - numDiscount)
  const balanceEstimated = Math.max(0, grandEstimated - numAdvance)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!hallId) {
      toast({ variant: 'destructive', title: 'Hall Required', description: 'Please select a banquet hall.' })
      return
    }
    if (!customerName.trim() || !customerPhone.trim()) {
      toast({ variant: 'destructive', title: 'Required Fields', description: 'Customer Name and Phone Number are required.' })
      return
    }

    const finalEventName = eventName === 'Other' ? customEventName.trim() || 'Special Event' : eventName

    setBusy(true)
    try {
      if (isEditing && booking) {
        await apiAs('/api/banquet-bookings', getCachedUser(), {
          method: 'PATCH',
          body: JSON.stringify({
            id: booking.id,
            hallId,
            customerName,
            customerPhone,
            customerEmail,
            customerAddress,
            companyName,
            gstNumber,
            eventName: finalEventName,
            eventDate,
            slot,
            guestCount: numGuests,
            hallRent: numHallRent,
            foodRatePerPlate: numFoodPerPlate,
            foodPackageName,
            foodTotal: totalFood,
            decorCharges: numDecor,
            extraCharges: numExtra,
            discount: numDiscount,
            advancePaid: numAdvance,
            status,
            notes,
          }),
        })
        toast({ variant: 'success', title: 'Booking Updated', description: `Banquet booking for ${customerName} updated.` })
      } else {
        await apiAs('/api/banquet-bookings', getCachedUser(), {
          method: 'POST',
          body: JSON.stringify({
            hallId,
            customerName,
            customerPhone,
            customerEmail,
            customerAddress,
            companyName,
            gstNumber,
            eventName: finalEventName,
            eventDate,
            slot,
            guestCount: numGuests,
            hallRent: numHallRent,
            foodRatePerPlate: numFoodPerPlate,
            foodPackageName,
            foodTotal: totalFood,
            decorCharges: numDecor,
            extraCharges: numExtra,
            discount: numDiscount,
            advancePaid: numAdvance,
            advanceMethod,
            status,
            notes,
          }),
        })
        toast({ variant: 'success', title: 'Banquet Booked', description: `Banquet booking confirmed for ${customerName}.` })
      }
      onSuccess()
      onOpenChange(false)
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error Saving Booking',
        description: err instanceof Error ? err.message : 'Could not save banquet booking',
      })
    } finally {
      setBusy(false)
    }
  }

  const selectedHallObj = halls.find((h) => h.id === hallId)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-0 sm:max-w-4xl">
        {/* Modal Header */}
        <div className="sticky top-0 z-10 border-b bg-background/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
                <PartyPopper className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold tracking-tight">
                  {isEditing ? `Edit Banquet Booking (${booking?.bookingNumber})` : 'New Banquet & Event Reservation'}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Complete event scheduling, host details, catering package, and advance deposit.
                </DialogDescription>
              </div>
            </div>
            {isEditing && (
              <Badge variant="outline" className="hidden sm:inline-flex border-emerald-500/30 text-emerald-600 dark:text-emerald-400 font-mono text-xs">
                {booking?.bookingNumber}
              </Badge>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 px-6 py-4">
          {/* Section 1: Event & Venue Details */}
          <div className="rounded-xl border bg-card p-4 shadow-xs">
            <div className="mb-3.5 flex items-center gap-2 border-b pb-2.5">
              <Building2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                1. Venue &amp; Event Schedule
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {/* Banquet Hall */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Banquet Hall <span className="text-destructive">*</span>
                </Label>
                <Select value={hallId} onValueChange={onHallChange}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Choose a hall" />
                  </SelectTrigger>
                  <SelectContent>
                    {halls.map((h) => (
                      <SelectItem key={h.id} value={h.id} className="text-xs">
                        {h.name} (Cap: {h.capacity} · Base: {formatINR(h.baseRate)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Event Date */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Event Date <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className="h-9 text-xs"
                  required
                />
              </div>

              {/* Time Slot */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Time Slot <span className="text-destructive">*</span>
                </Label>
                <Select value={slot} onValueChange={setSlot}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Select Slot" />
                  </SelectTrigger>
                  <SelectContent>
                    {SLOTS.map((s) => (
                      <SelectItem key={s.value} value={s.value} className="text-xs">
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Expected Guests */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium text-foreground">
                    Expected Guests <span className="text-destructive">*</span>
                  </Label>
                  {selectedHallObj && (
                    <span className="text-[10px] text-muted-foreground">
                      Max Cap: {selectedHallObj.capacity}
                    </span>
                  )}
                </div>
                <Input
                  type="number"
                  min="1"
                  value={guestCount}
                  onChange={(e) => setGuestCount(e.target.value)}
                  placeholder="e.g. 150"
                  className="h-9 text-xs"
                  required
                />
              </div>

              {/* Event / Occasion */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Event / Occasion <span className="text-destructive">*</span>
                </Label>
                <Select value={eventName} onValueChange={setEventName}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Occasion" />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_PRESETS.map((p) => (
                      <SelectItem key={p} value={p} className="text-xs">
                        {p}
                      </SelectItem>
                    ))}
                    <SelectItem value="Other" className="text-xs font-medium text-emerald-600">
                      Other (Custom Occasion)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Custom Occasion Name if selected */}
              {eventName === 'Other' ? (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium text-foreground">
                    Custom Occasion Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    placeholder="e.g. Silver Jubilee Gala"
                    value={customEventName}
                    onChange={(e) => setCustomEventName(e.target.value)}
                    className="h-9 text-xs"
                    required
                  />
                </div>
              ) : (
                <div className="hidden lg:block">
                  <div className="h-full rounded-lg bg-muted/40 p-2 text-[11px] text-muted-foreground flex items-center justify-center text-center">
                    <span>Selected Hall: <strong className="text-foreground">{selectedHallObj?.name || '—'}</strong></span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Customer / Host Details */}
          <div className="rounded-xl border bg-card p-4 shadow-xs">
            <div className="mb-3.5 flex items-center gap-2 border-b pb-2.5">
              <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                2. Customer &amp; Host Information
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
              {/* Host Name */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Customer / Host Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="Full name of organizer / host"
                  className="h-9 text-xs"
                  required
                />
              </div>

              {/* Phone Number */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Phone Number <span className="text-destructive">*</span>
                </Label>
                <Input
                  type="tel"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="10-digit primary mobile"
                  className="h-9 text-xs font-mono"
                  required
                />
              </div>

              {/* Email Address */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Email Address <span className="text-muted-foreground text-[10px]">(Optional)</span>
                </Label>
                <Input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  placeholder="client@example.com"
                  className="h-9 text-xs"
                />
              </div>

              {/* Company / Org */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Company / Organization <span className="text-muted-foreground text-[10px]">(Optional)</span>
                </Label>
                <Input
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Corporate / Firm Name"
                  className="h-9 text-xs"
                />
              </div>

              {/* Client GSTIN */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Client GSTIN <span className="text-muted-foreground text-[10px]">(Optional)</span>
                </Label>
                <Input
                  value={gstNumber}
                  onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
                  placeholder="22AAAAA0000A1Z5"
                  className="h-9 text-xs font-mono uppercase"
                />
              </div>

              {/* Address */}
              <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
                <Label className="text-xs font-medium text-foreground">
                  Billing Address / City <span className="text-muted-foreground text-[10px]">(Optional)</span>
                </Label>
                <Input
                  value={customerAddress}
                  onChange={(e) => setCustomerAddress(e.target.value)}
                  placeholder="Customer address for billing"
                  className="h-9 text-xs"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Catering & Venue Pricing Breakdown */}
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 shadow-xs">
            <div className="mb-3.5 flex items-center justify-between border-b border-emerald-500/20 pb-2.5">
              <div className="flex items-center gap-2">
                <Utensils className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-900 dark:text-emerald-300">
                  3. Catering &amp; Venue Pricing Details
                </h3>
              </div>
              <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                Total Guests: <strong className="font-bold">{numGuests}</strong>
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
              {/* Hall Rent */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Hall / Venue Rent (₹)
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={hallRent}
                  onChange={(e) => setHallRent(e.target.value)}
                  className="h-9 text-xs font-mono font-medium"
                />
              </div>

              {/* Food Package Name */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Catering Package Name
                </Label>
                <Input
                  value={foodPackageName}
                  onChange={(e) => setFoodPackageName(e.target.value)}
                  placeholder="e.g. Royal Buffet / Veg Deluxe"
                  className="h-9 text-xs"
                />
              </div>

              {/* Food Rate per Plate */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Food Rate (₹ / Plate)
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={foodRatePerPlate}
                  onChange={(e) => setFoodRatePerPlate(e.target.value)}
                  className="h-9 text-xs font-mono font-medium"
                />
              </div>

              {/* Food Subtotal Calculated */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Catering Total (₹) <span className="text-[10px] text-muted-foreground">({numGuests} × ₹{numFoodPerPlate})</span>
                </Label>
                <div className="flex h-9 items-center rounded-md border bg-muted/60 px-3 text-xs font-mono font-bold text-foreground">
                  {formatINR(totalFood)}
                </div>
              </div>

              {/* Decor Charges */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Stage &amp; Decor Charges (₹)
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={decorCharges}
                  onChange={(e) => setDecorCharges(e.target.value)}
                  className="h-9 text-xs font-mono font-medium"
                />
              </div>

              {/* Extra / AV Services */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Sound, DJ &amp; AV / Extra (₹)
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={extraCharges}
                  onChange={(e) => setExtraCharges(e.target.value)}
                  className="h-9 text-xs font-mono font-medium"
                />
              </div>

              {/* Discount */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Discount / Concession (₹)
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  className="h-9 text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400"
                />
              </div>

              {/* Est Grand Total Card */}
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                  Est. Grand Total (₹)
                </Label>
                <div className="flex h-9 items-center justify-between rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 text-xs font-mono font-bold text-emerald-800 dark:text-emerald-200">
                  <span>Grand Total:</span>
                  <span className="text-sm">{formatINR(grandEstimated)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Advance Settlement & Booking Status */}
          <div className="rounded-xl border bg-card p-4 shadow-xs">
            <div className="mb-3.5 flex items-center gap-2 border-b pb-2.5">
              <Wallet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                4. Advance Settlement &amp; Status
              </h3>
            </div>

            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
              {/* Advance Amount */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Advance Amount Paid (₹)
                </Label>
                <Input
                  type="number"
                  min="0"
                  value={advancePaid}
                  onChange={(e) => setAdvancePaid(e.target.value)}
                  className="h-9 text-xs font-mono font-bold text-emerald-700 dark:text-emerald-400"
                />
              </div>

              {/* Advance Mode */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Advance Payment Mode
                </Label>
                <Select value={advanceMethod} onValueChange={setAdvanceMethod}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Payment Mode" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UPI" className="text-xs">UPI / QR Code</SelectItem>
                    <SelectItem value="CASH" className="text-xs">Cash</SelectItem>
                    <SelectItem value="CARD" className="text-xs">Debit / Credit Card</SelectItem>
                    <SelectItem value="BANK" className="text-xs">Bank Transfer / NEFT</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Status */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-foreground">
                  Booking Status
                </Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CONFIRMED" className="text-xs font-medium text-emerald-600">CONFIRMED</SelectItem>
                    <SelectItem value="ENQUIRY" className="text-xs">ENQUIRY (Tentative)</SelectItem>
                    <SelectItem value="IN_PROGRESS" className="text-xs">IN PROGRESS</SelectItem>
                    <SelectItem value="COMPLETED" className="text-xs">COMPLETED</SelectItem>
                    <SelectItem value="CANCELLED" className="text-xs text-destructive">CANCELLED</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Financial Summary Highlight Banner */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <div>
                  <span className="text-muted-foreground">Estimated Total: </span>
                  <span className="font-semibold text-foreground">{formatINR(grandEstimated)}</span>
                </div>
                <div className="text-muted-foreground">−</div>
                <div>
                  <span className="text-muted-foreground">Advance Received: </span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatINR(numAdvance)}</span>
                </div>
                <div className="text-muted-foreground">=</div>
                <div>
                  <span className="text-muted-foreground">Remaining Balance on Event: </span>
                  <span className="font-mono text-sm font-bold text-foreground">{formatINR(balanceEstimated)}</span>
                </div>
              </div>

              <Badge
                variant="outline"
                className={
                  numAdvance >= grandEstimated && grandEstimated > 0
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : numAdvance > 0
                    ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                    : 'border-muted-foreground/30 text-muted-foreground'
                }
              >
                {numAdvance >= grandEstimated && grandEstimated > 0
                  ? 'Fully Paid Advance'
                  : numAdvance > 0
                  ? 'Advance Received'
                  : 'Zero Advance'}
              </Badge>
            </div>
          </div>

          {/* Section 5: Special Instructions & Dietary Notes */}
          <div className="rounded-xl border bg-card p-4 shadow-xs">
            <div className="mb-2 flex items-center gap-2">
              <FileText className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                5. Special Instructions &amp; Catering Notes
              </h3>
            </div>
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Jain food required for 20 guests, Stage setup by 4 PM, Welcome drink at entrance..."
              className="resize-none text-xs"
            />
          </div>

          {/* Footer Actions */}
          <div className="sticky bottom-0 z-10 -mx-6 -mb-4 flex items-center justify-end gap-3 border-t bg-background/95 px-6 py-3.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              className="h-9 px-4 text-xs font-medium"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="h-9 bg-emerald-600 px-5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
            >
              {busy ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {isEditing ? 'Save Booking Changes' : 'Confirm Banquet Booking'}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
