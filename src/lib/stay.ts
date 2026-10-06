export const IST_OFFSET = '+05:30'

/**
 * Returns 'YYYY-MM-DD' of date in Indian Standard Time (UTC+05:30)
 * Completely timezone agnostic across any server or browser timezone.
 */
export function istDateStr(d: Date | string | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return ''
  // 5.5 hours in ms = 19,800,000 ms
  const istTime = new Date(date.getTime() + 5.5 * 60 * 60 * 1000)
  const y = istTime.getUTCFullYear()
  const m = String(istTime.getUTCMonth() + 1).padStart(2, '0')
  const day = String(istTime.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Creates a Date in IST (UTC+05:30) given a 'YYYY-MM-DD' date string and 'HH:mm' or 'HH:mm:ss' time.
 */
export function makeIST(dateStr: string, hhmm = '08:00'): Date {
  const cleanDate = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr.trim()
  let cleanTime = hhmm.trim() || '08:00'
  if (cleanTime.length === 5) {
    cleanTime += ':00'
  }
  return new Date(`${cleanDate}T${cleanTime}+05:30`)
}

/**
 * Calculates calendar-day nights difference between checkIn and checkOut in IST.
 * Calendar date-based only (not hour-based). Minimum 1 night.
 */
export function calcNights(checkIn: Date | string | null | undefined, checkOut: Date | string | null | undefined): number {
  if (!checkIn || !checkOut) return 1
  const inStr = istDateStr(checkIn)
  const outStr = istDateStr(checkOut)
  if (!inStr || !outStr) return 1

  const [y1, m1, d1] = inStr.split('-').map(Number)
  const [y2, m2, d2] = outStr.split('-').map(Number)
  const utc1 = Date.UTC(y1, m1 - 1, d1)
  const utc2 = Date.UTC(y2, m2 - 1, d2)
  const diffDays = Math.round((utc2 - utc1) / (24 * 60 * 60 * 1000))
  return Math.max(1, diffDays)
}

export interface StayBooking {
  status?: string | null
  checkIn: Date | string
  checkOut?: Date | string | null
}

/**
 * Computes whether an ACTIVE booking is overdue and how many 24h extension cycles (k) should be added.
 */
export function computeOverstay(
  booking: StayBooking,
  now: Date = new Date(),
  graceMinutes = 0
): { overdue: boolean; extraDays: number; newCheckOut: Date | null } {
  if (booking.status !== 'ACTIVE' || !booking.checkOut) {
    return {
      overdue: false,
      extraDays: 0,
      newCheckOut: booking.checkOut ? new Date(booking.checkOut) : null,
    }
  }

  const checkOutDate = typeof booking.checkOut === 'string' ? new Date(booking.checkOut) : booking.checkOut
  if (isNaN(checkOutDate.getTime())) {
    return { overdue: false, extraDays: 0, newCheckOut: null }
  }

  const graceMs = (graceMinutes || 0) * 60 * 1000
  const deadlineMs = checkOutDate.getTime() + graceMs
  const nowMs = now.getTime()

  if (nowMs > deadlineMs) {
    const msOver = nowMs - deadlineMs
    const k = Math.ceil(msOver / (24 * 60 * 60 * 1000))
    const extraDays = Math.max(1, k)
    const newCheckOut = new Date(checkOutDate.getTime() + extraDays * 24 * 60 * 60 * 1000)
    return { overdue: true, extraDays, newCheckOut }
  }

  return { overdue: false, extraDays: 0, newCheckOut: checkOutDate }
}

/**
 * Returns the exact timestamp when the next automatic extension will fire for an ACTIVE booking.
 */
export function nextAutoExtensionAt(
  booking: StayBooking,
  graceMinutes = 0
): Date | null {
  if (booking.status !== 'ACTIVE' || !booking.checkOut) return null
  const checkOutDate = typeof booking.checkOut === 'string' ? new Date(booking.checkOut) : booking.checkOut
  if (isNaN(checkOutDate.getTime())) return null
  return new Date(checkOutDate.getTime() + (graceMinutes || 0) * 60 * 1000)
}
