'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  formatDate,
  toDateStr,
  todayStr,
  addDays,
} from '@/lib/hotel-utils'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Info,
  CalendarCheck,
  Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface BookingSlot {
  id?: string
  checkIn: string | Date
  checkOut?: string | Date | null
  status?: string | null
  guest?: { name?: string; phone?: string; company?: string | null } | null
}

interface RoomDatePickerProps {
  id?: string
  label?: string
  value: string // YYYY-MM-DD
  onChange: (dateStr: string) => void
  mode: 'checkIn' | 'checkOut'
  checkInValue?: string // Required when mode === 'checkOut'
  minDate?: string // YYYY-MM-DD
  maxDate?: string // YYYY-MM-DD
  roomBookings?: BookingSlot[]
  roomNumber?: string
  disabled?: boolean
  className?: string
  placeholder?: string
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const WEEKDAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

export function RoomDatePicker({
  id,
  label,
  value,
  onChange,
  mode,
  checkInValue,
  minDate,
  maxDate,
  roomBookings = [],
  roomNumber,
  disabled = false,
  className,
  placeholder = 'Select date',
}: RoomDatePickerProps) {
  const [open, setOpen] = useState(false)

  // Parse initial view year and month from value, or checkInValue, or today
  const initDate = useMemo(() => {
    const dStr = value || checkInValue || todayStr()
    const d = new Date(dStr + 'T00:00:00')
    return isNaN(d.getTime()) ? new Date() : d
  }, [value, checkInValue])

  const [viewYear, setViewYear] = useState<number>(initDate.getFullYear())
  const [viewMonth, setViewMonth] = useState<number>(initDate.getMonth())

  // Keep view in sync when opening if value changes
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      const dStr = value || checkInValue || todayStr()
      const d = new Date(dStr + 'T00:00:00')
      if (!isNaN(d.getTime())) {
        setViewYear(d.getFullYear())
        setViewMonth(d.getMonth())
      }
    }
    setOpen(isOpen)
  }

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear((y) => y - 1)
    } else {
      setViewMonth((m) => m - 1)
    }
  }

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear((y) => y + 1)
    } else {
      setViewMonth((m) => m + 1)
    }
  }

  // Active or booked reservations for the room
  const validBookings = useMemo(() => {
    return (roomBookings || []).filter(
      (b) => b.status === 'ACTIVE' || b.status === 'BOOKED'
    )
  }, [roomBookings])

  // Generate calendar days for viewYear & viewMonth
  const calendarDays = useMemo(() => {
    const days: {
      dateStr: string
      dayNum: number
      isCurrentMonth: boolean
      isToday: boolean
      isSelected: boolean
      isInStayRange: boolean
      isDisabled: boolean
      status: 'AVAILABLE' | 'BOOKED' | 'CHECKOUT_AVAIL' | 'MAX_CHECKOUT' | 'PAST'
      bookingName?: string
      statusText?: string
    }[] = []

    const curToday = todayStr()
    const firstDay = new Date(viewYear, viewMonth, 1).getDay()
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
    const prevMonthDays = new Date(viewYear, viewMonth, 0).getDate()

    // 1. Trailing days from previous month
    for (let i = firstDay - 1; i >= 0; i--) {
      const dayNum = prevMonthDays - i
      const prevM = viewMonth === 0 ? 11 : viewMonth - 1
      const prevY = viewMonth === 0 ? viewYear - 1 : viewYear
      const mStr = String(prevM + 1).padStart(2, '0')
      const dStr = String(dayNum).padStart(2, '0')
      const dateStr = `${prevY}-${mStr}-${dStr}`

      days.push({
        dateStr,
        dayNum,
        isCurrentMonth: false,
        isToday: dateStr === curToday,
        isSelected: dateStr === value,
        isInStayRange: false,
        isDisabled: true,
        status: 'PAST',
      })
    }

    // 2. Days of current month
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const mStr = String(viewMonth + 1).padStart(2, '0')
      const dStr = String(dayNum).padStart(2, '0')
      const dateStr = `${viewYear}-${mStr}-${dStr}`

      const isToday = dateStr === curToday
      const isSelected = dateStr === value
      const isPast = dateStr < curToday

      // Check if this day is a booked night for an existing booking
      const bookedStay = validBookings.find((b) => {
        const bIn = toDateStr(b.checkIn)
        const bOut = b.checkOut ? toDateStr(b.checkOut) : null
        return bIn <= dateStr && (bOut ? bOut > dateStr : bIn === dateStr)
      })

      // Check if an existing booking checks out on this day
      const checkingOutStay = validBookings.find((b) => {
        return b.checkOut && toDateStr(b.checkOut) === dateStr
      })

      // Check if an upcoming booking checks in on this day
      const upcomingBookingStarting = validBookings.find((b) => {
        return toDateStr(b.checkIn) === dateStr
      })

      let isDisabled = false
      let status: 'AVAILABLE' | 'BOOKED' | 'CHECKOUT_AVAIL' | 'MAX_CHECKOUT' | 'PAST' = 'AVAILABLE'
      let bookingName: string | undefined = undefined
      let statusText: string | undefined = undefined

      if (isPast) {
        isDisabled = true
        status = 'PAST'
        statusText = 'Past date'
      } else if (mode === 'checkIn') {
        if (minDate && dateStr < minDate) {
          isDisabled = true
          status = 'PAST'
        } else if (bookedStay) {
          isDisabled = true
          status = 'BOOKED'
          bookingName = bookedStay.guest?.name || 'Booked'
          statusText = `Reserved for ${bookedStay.guest?.name || 'Guest'} (${formatDate(bookedStay.checkIn)} - ${formatDate(bookedStay.checkOut)})`
        } else if (checkingOutStay && !upcomingBookingStarting) {
          isDisabled = false
          status = 'CHECKOUT_AVAIL'
          bookingName = checkingOutStay.guest?.name || 'Guest'
          statusText = `Available from 12 PM (Previous guest ${checkingOutStay.guest?.name || 'Guest'} checks out in morning)`
        } else {
          isDisabled = false
          status = 'AVAILABLE'
          statusText = 'Available for check-in'
        }
      } else {
        // mode === 'checkOut'
        const effIn = checkInValue || curToday

        if (dateStr <= effIn) {
          isDisabled = true
          status = 'PAST'
          statusText = 'Check-out must be after check-in date'
        } else {
          // Check if checkIn is before an upcoming booking
          const upcomingAfterIn = validBookings
            .filter((b) => toDateStr(b.checkIn) > effIn)
            .sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime())[0]

          if (upcomingAfterIn) {
            const nextInStr = toDateStr(upcomingAfterIn.checkIn)
            if (dateStr > nextInStr) {
              isDisabled = true
              status = 'BOOKED'
              bookingName = upcomingAfterIn.guest?.name || 'Booked'
              statusText = `Cannot check out after ${formatDate(nextInStr)} (Reserved for ${upcomingAfterIn.guest?.name})`
            } else if (dateStr === nextInStr) {
              isDisabled = false
              status = 'MAX_CHECKOUT'
              bookingName = upcomingAfterIn.guest?.name || 'Guest'
              statusText = `Max Check-Out by 11:00 AM (${upcomingAfterIn.guest?.name} arrives at 12 PM)`
            } else {
              isDisabled = false
              status = 'AVAILABLE'
            }
          } else if (bookedStay && toDateStr(bookedStay.checkIn) <= effIn) {
            // Already checking in during a booking (collision handled elsewhere)
            isDisabled = false
            status = 'AVAILABLE'
          } else {
            isDisabled = false
            status = 'AVAILABLE'
          }
        }
      }

      // Check stay range highlighting
      let isInStayRange = false
      if (checkInValue && value && mode === 'checkOut') {
        isInStayRange = dateStr > checkInValue && dateStr <= value
      }

      days.push({
        dateStr,
        dayNum,
        isCurrentMonth: true,
        isToday,
        isSelected,
        isInStayRange,
        isDisabled,
        status,
        bookingName,
        statusText,
      })
    }

    // 3. Trailing days to fill remaining slots (total 35 or 42)
    const totalSlots = days.length <= 35 ? 35 : 42
    const remaining = totalSlots - days.length
    for (let dayNum = 1; dayNum <= remaining; dayNum++) {
      const nextM = viewMonth === 11 ? 0 : viewMonth + 1
      const nextY = viewMonth === 11 ? viewYear + 1 : viewYear
      const mStr = String(nextM + 1).padStart(2, '0')
      const dStr = String(dayNum).padStart(2, '0')
      const dateStr = `${nextY}-${mStr}-${dStr}`

      days.push({
        dateStr,
        dayNum,
        isCurrentMonth: false,
        isToday: dateStr === curToday,
        isSelected: dateStr === value,
        isInStayRange: false,
        isDisabled: true,
        status: 'PAST',
      })
    }

    return days
  }, [viewYear, viewMonth, value, checkInValue, minDate, mode, validBookings])

  // Formatted date string for button display
  const formattedDisplay = useMemo(() => {
    if (!value) return placeholder
    const d = new Date(value + 'T00:00:00')
    if (isNaN(d.getTime())) return value
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
  }, [value, placeholder])

  // Is current selected date on a checkout transfer day?
  const isSelectedCheckoutDay = useMemo(() => {
    if (!value || mode !== 'checkIn') return false
    return validBookings.some((b) => b.checkOut && toDateStr(b.checkOut) === value)
  }, [value, mode, validBookings])

  return (
    <div className={cn('relative space-y-1', className)}>
      {label && <label htmlFor={id} className="text-xs font-semibold text-foreground">{label}</label>}

      <Popover open={open && !disabled} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            className={cn(
              'flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-xs transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
              !value && 'text-muted-foreground',
              isSelectedCheckoutDay && 'border-sky-400 bg-sky-50/50 dark:bg-sky-950/20 text-sky-950 dark:text-sky-200'
            )}
          >
            <span className="flex items-center gap-2 truncate">
              <CalendarDays className={cn("h-4 w-4 shrink-0", isSelectedCheckoutDay ? "text-sky-600 dark:text-sky-400" : "text-emerald-600 dark:text-emerald-400")} />
              <span className="font-semibold text-foreground">{formattedDisplay}</span>
              {isSelectedCheckoutDay && (
                <span className="rounded bg-sky-200/80 px-1 py-0.2 text-[9px] font-bold text-sky-900 dark:bg-sky-900 dark:text-sky-200">
                  Checkout Day
                </span>
              )}
            </span>
            <span className="text-[10px] text-muted-foreground">▼</span>
          </button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={6}
          className="z-50 w-[300px] p-3 shadow-xl rounded-xl border bg-popover text-popover-foreground"
        >
          {/* Calendar Header: Month/Year navigation */}
          <div className="flex items-center justify-between pb-2 border-b">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={prevMonth}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="font-bold text-xs text-foreground">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={nextMonth}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Room info header badge */}
          {roomNumber && (
            <div className="my-1.5 flex items-center justify-between rounded bg-muted/60 px-2 py-1 text-[10px] text-muted-foreground">
              <span>Room {roomNumber} Availability</span>
              <span className="font-semibold text-foreground">
                {mode === 'checkIn' ? 'Select Check-In' : 'Select Check-Out'}
              </span>
            </div>
          )}

          {/* Weekdays header row */}
          <div className="grid grid-cols-7 gap-1 pt-1 text-center text-[10px] font-bold text-muted-foreground">
            {WEEKDAY_NAMES.map((wd) => (
              <div key={wd} className="py-1">
                {wd}
              </div>
            ))}
          </div>

          {/* Calendar Day Grid */}
          <div className="grid grid-cols-7 gap-1 pt-1">
            {calendarDays.map((day, idx) => {
              if (!day.isCurrentMonth) {
                return (
                  <div
                    key={idx}
                    className="flex h-8 w-full items-center justify-center text-[10px] text-muted-foreground/30 select-none"
                  >
                    {day.dayNum}
                  </div>
                )
              }

              // Visual styling per status
              let cellClass =
                'flex flex-col h-8 w-full items-center justify-center rounded text-[11px] font-medium transition-all relative select-none'

              if (day.isSelected) {
                cellClass +=
                  ' bg-emerald-600 text-white font-bold shadow-sm scale-105 z-10'
              } else if (day.status === 'BOOKED') {
                cellClass +=
                  ' bg-amber-100 text-amber-900 line-through opacity-70 cursor-not-allowed dark:bg-amber-950/70 dark:text-amber-300 font-semibold border border-amber-200 dark:border-amber-800'
              } else if (day.status === 'CHECKOUT_AVAIL') {
                cellClass +=
                  ' bg-sky-50 text-sky-900 border border-sky-300 font-bold hover:bg-sky-100 hover:border-sky-500 cursor-pointer dark:bg-sky-950/60 dark:text-sky-200'
              } else if (day.status === 'MAX_CHECKOUT') {
                cellClass +=
                  ' bg-emerald-100 text-emerald-950 font-bold border border-emerald-400 hover:bg-emerald-200 cursor-pointer dark:bg-emerald-950/60 dark:text-emerald-200'
              } else if (day.isDisabled) {
                cellClass +=
                  ' text-muted-foreground/40 cursor-not-allowed opacity-50'
              } else {
                cellClass +=
                  ' text-foreground hover:bg-emerald-50 hover:text-emerald-800 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-200 cursor-pointer'
              }

              if (day.isToday && !day.isSelected) {
                cellClass += ' ring-1 ring-emerald-500 font-bold'
              }

              return (
                <button
                  key={idx}
                  type="button"
                  disabled={day.isDisabled}
                  title={day.statusText || day.dateStr}
                  onClick={() => {
                    if (!day.isDisabled) {
                      onChange(day.dateStr)
                      setOpen(false)
                    }
                  }}
                  className={cellClass}
                >
                  <span className="leading-none">{day.dayNum}</span>
                  {day.status === 'CHECKOUT_AVAIL' && !day.isSelected && (
                    <span className="text-[7px] text-sky-700 dark:text-sky-300 leading-tight font-extrabold">
                      12 PM
                    </span>
                  )}
                  {day.status === 'MAX_CHECKOUT' && !day.isSelected && (
                    <span className="text-[7px] text-emerald-700 dark:text-emerald-300 leading-tight font-extrabold">
                      11 AM
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Calendar Footer: Legend & Quick Shortcuts */}
          <div className="mt-2.5 pt-2 border-t space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-1 text-[9px] text-muted-foreground">
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />
                <span>Available</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-amber-400 inline-block" />
                <span>Booked (Unavailable)</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-sky-400 inline-block" />
                <span>Avail from 12 PM</span>
              </div>
            </div>

            <div className="flex gap-1.5 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 flex-1 text-[10px] px-1 font-medium"
                onClick={() => {
                  const today = todayStr()
                  onChange(today)
                  setOpen(false)
                }}
              >
                Today ({formatDate(todayStr())})
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 flex-1 text-[10px] px-1 font-medium"
                onClick={() => {
                  const tmrw = addDays(1)
                  onChange(tmrw)
                  setOpen(false)
                }}
              >
                Tomorrow
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
