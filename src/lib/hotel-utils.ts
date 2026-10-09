export function formatINR(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(n)) return '₹0'
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '-'
  const date = new Date(d)
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return '-'
  const date = new Date(d)
  return (
    date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) +
    ', ' +
    date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  )
}

export function todayStr(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function toDateStr(d: string | Date | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (isNaN(date.getTime())) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(days: number, fromDate?: string | Date): string {
  const d = fromDate ? new Date(fromDate) : new Date()
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Checks if two date ranges [inA, outA] and [inB, outB] overlap in hotel calendar days.
 * In hotel reservations:
 * - A guest staying 08/01 to 10/01 occupies the nights of 08/01 and 09/01, leaving 10/01 at checkout.
 * - A guest arriving 10/01 occupies nights starting 10/01.
 * They do NOT overlap because outA (10/01) == inB (10/01).
 * Range overlap condition: inA < outB AND outA > inB (strictly in date-only format YYYY-MM-DD).
 */
export function doDateRangesOverlap(
  inA: string | Date | null | undefined,
  outA: string | Date | null | undefined,
  inB: string | Date | null | undefined,
  outB: string | Date | null | undefined
): boolean {
  const startA = toDateStr(inA)
  if (!startA) return false
  const endA = outA ? toDateStr(outA) : addDays(1, inA as string | Date)
  const startB = toDateStr(inB)
  if (!startB) return false
  const endB = outB ? toDateStr(outB) : addDays(1, inB as string | Date)

  return startA < endB && endA > startB
}

export interface ApiFetchOptions extends RequestInit {
  adminPin?: string
}

export async function api<T = unknown>(url: string, options?: ApiFetchOptions): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    ...(options?.headers as Record<string, string> || {}),
  }
  if (options?.adminPin) {
    headers['X-Admin-Pin'] = options.adminPin
  }
  const res = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers,
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || 'Something went wrong')
  }
  return data as T
}

/**
 * Fetch wrapper for list endpoints. Guarantees an array is returned even if
 * the endpoint wraps rows (e.g. { entries: [...] }) — prevents
 * "x.filter is not a function" client crashes from shape mismatches.
 */
export async function apiList<T = unknown>(url: string, options?: ApiFetchOptions): Promise<T[]> {
  const data = await api<T[] | { entries?: T[] }>(url, options)
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object' && Array.isArray((data as { entries?: T[] }).entries)) {
    return (data as { entries?: T[] }).entries as T[]
  }
  return []
}

/** Fetch wrapper that attaches the logged-in user identity for audit trails */
export function apiAs<T = unknown>(
  url: string,
  user: { id: string; name: string; role: string } | null,
  options?: ApiFetchOptions
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    ...((options?.headers as Record<string, string>) || {}),
  }
  if (user) {
    headers['X-User-Id'] = user.id
    headers['X-User-Name'] = encodeURIComponent(user.name)
    headers['X-User-Role'] = user.role
  }
  if (options?.adminPin) {
    headers['X-Admin-Pin'] = options.adminPin
  }
  return fetch(url, { cache: 'no-store', ...options, headers }).then(async (res) => {
    const data = await res.json()
    if (!res.ok) {
      throw new Error((data as { error?: string }).error || 'Something went wrong')
    }
    return data as T
  })
}

/** Client-side CSV export */
export function exportCSV(
  filename: string,
  headers: string[],
  rows: (string | number | null | undefined)[][]
) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(link.href)
}

/** Client-side Report / Table printing */
export function printTableReport(
  title: string,
  headers: string[],
  rows: (string | number | null | undefined)[][],
  subtitle?: string
) {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined || v === '') return '—'
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  const theadHtml = headers
    .map(
      (h) =>
        `<th style="border: 1px solid #cbd5e1; padding: 8px 10px; background-color: #f1f5f9; text-align: left; font-size: 11px; font-weight: 700; color: #1e293b; text-transform: uppercase;">${esc(h)}</th>`
    )
    .join('')

  const tbodyHtml = rows
    .map(
      (row, idx) =>
        `<tr style="background-color: ${idx % 2 === 0 ? '#ffffff' : '#f8fafc'};">` +
        row
          .map(
            (cell) =>
              `<td style="border: 1px solid #e2e8f0; padding: 7px 10px; font-size: 11px; color: #334155;">${esc(cell)}</td>`
          )
          .join('') +
        `</tr>`
    )
    .join('')

  const printTime = new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${esc(title)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; padding: 15px; color: #0f172a; }
    .header { margin-bottom: 12px; border-bottom: 2px solid #0f172a; padding-bottom: 8px; display: flex; justify-content: space-between; align-items: flex-end; }
    .title { font-size: 18px; font-weight: 800; color: #0f172a; letter-spacing: -0.3px; }
    .subtitle { font-size: 11px; color: #64748b; margin-top: 2px; }
    .meta { font-size: 11px; color: #64748b; text-align: right; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    @media print {
      body { padding: 0; }
      th { background-color: #e2e8f0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="title">${esc(title)}</div>
      ${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ''}
    </div>
    <div class="meta">
      <div>Printed: <strong>${printTime}</strong></div>
      <div>Total Records: <strong>${rows.length}</strong></div>
    </div>
  </div>
  <table>
    <thead><tr>${theadHtml}</tr></thead>
    <tbody>${tbodyHtml || '<tr><td colspan="' + headers.length + '" style="text-align: center; padding: 20px; color: #94a3b8;">No records found</td></tr>'}</tbody>
  </table>
</body>
</html>
  `

  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)

  const doc = iframe.contentWindow?.document
  if (!doc) return

  doc.open()
  doc.write(html)
  doc.close()

  setTimeout(() => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    setTimeout(() => {
      document.body.removeChild(iframe)
    }, 1000)
  }, 300)
}

export function dateOnly(d: string | Date | null | undefined): string {
  if (!d) return '-'
  return new Date(d).toISOString().slice(0, 10)
}

/** Sum values in an object array by a key */
export function sumBy<T>(arr: T[], fn: (item: T) => number): number {
  return arr.reduce((s, x) => s + (fn(x) || 0), 0)
}

/** Sanitize input string to digits only and max 10 digits */
export function sanitizePhone(val: string): string {
  return val.replace(/\D/g, '').slice(0, 10)
}

/** Validate whether string is a valid 10-digit mobile phone number */
export function isValidPhone(val: string): boolean {
  const digits = val.replace(/\D/g, '')
  return digits.length === 10 && /^[6-9]\d{9}$/.test(digits)
}

export interface BillLike {
  grandTotal?: number | null
  advanceApplied?: number | null
  payCash?: number | null
  payUpi?: number | null
  payCard?: number | null
}

/** Total money received for a bill = advanceApplied + payCash + payUpi + payCard */
export function totalReceived(bill: BillLike | null | undefined): number {
  if (!bill) return 0
  const total =
    Number(bill.advanceApplied || 0) +
    Number(bill.payCash || 0) +
    Number(bill.payUpi || 0) +
    Number(bill.payCard || 0)
  return Math.round(total * 100) / 100
}

/** Balance due on a bill = grandTotal - totalReceived */
export function balanceDue(bill: BillLike | null | undefined): number {
  if (!bill) return 0
  const bal = Number(bill.grandTotal || 0) - totalReceived(bill)
  return Math.max(0, Math.round(bal * 100) / 100)
}

/** Payable now at checkout/billing = grandTotal - advanceApplied */
export function payableNow(bill: BillLike | null | undefined): number {
  if (!bill) return 0
  const pay = Number(bill.grandTotal || 0) - Number(bill.advanceApplied || 0)
  return Math.max(0, Math.round(pay * 100) / 100)
}

export interface BookingSummary {
  id: string
  checkIn: string | Date
  checkOut?: string | Date | null
  originalCheckOut?: string | Date | null
  autoExtendedDays?: number
  guestCount?: number
  days?: number
  ratePerDay?: number
  status?: string | null
  advance?: number
  guest?: { id?: string; name?: string; phone?: string; company?: string | null; gst?: string | null } | null
}

export interface RoomWithBookings {
  id?: string
  number?: string
  floor?: string | null
  type?: string
  capacity?: number
  rate?: number
  status?: string
  housekeeping?: string
  notes?: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bookings?: any[]
}

export interface RoomOperationalState {
  isOccupied: boolean
  activeBooking: BookingSummary | null
  isBookedToday: boolean
  todayBooking: BookingSummary | null
  hasFutureBooking: boolean
  nextFutureBooking: BookingSummary | null
  futureAvailableFromDate: string | null
  futureAvailableFromFormatted: string | null
  allFutureBookings: BookingSummary[]
  availableUntilDate: string | null
  availableUntilFormatted: string | null
  maxNightsAvailable: number | null
  displayStatus: 'OCCUPIED' | 'BOOKED' | 'VACANT_WITH_FUTURE' | 'DIRTY' | 'MAINTENANCE' | 'VACANT'
}

/**
 * Computes the real-time operational state of a room by analyzing its active and upcoming bookings.
 * This ensures that rooms with future reservations remain available for stay before the reservation date.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getRoomOperationalState(room: RoomWithBookings | any): RoomOperationalState {
  const emptyState: RoomOperationalState = {
    isOccupied: false,
    activeBooking: null,
    isBookedToday: false,
    todayBooking: null,
    hasFutureBooking: false,
    nextFutureBooking: null,
    futureAvailableFromDate: null,
    futureAvailableFromFormatted: null,
    allFutureBookings: [],
    availableUntilDate: null,
    availableUntilFormatted: null,
    maxNightsAvailable: null,
    displayStatus: 'VACANT',
  }

  if (!room) return emptyState

  if (room.status === 'MAINTENANCE') {
    return {
      ...emptyState,
      displayStatus: 'MAINTENANCE',
    }
  }

  const curTodayStr = todayStr()
  const todayStart = new Date(curTodayStr + 'T00:00:00')

  const activeBooking = room.bookings?.find((b: BookingSummary) => b.status === 'ACTIVE') || null

  const bookedReservations: BookingSummary[] = (room.bookings?.filter((b: BookingSummary) => b.status === 'BOOKED') || []).sort(
    (a: BookingSummary, b: BookingSummary) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime()
  )

  // Today booking = checkIn date is today or past, not yet checked in
  const todayBooking =
    bookedReservations.find((b) => toDateStr(b.checkIn) <= curTodayStr) || null

  // Future bookings = checkIn date is strictly after today
  const allFutureBookings = bookedReservations.filter((b) => toDateStr(b.checkIn) > curTodayStr)
  const nextFutureBooking = allFutureBookings[0] || null

  const hasFutureBooking = !!nextFutureBooking

  let availableUntilDate: string | null = null
  let availableUntilFormatted: string | null = null
  let maxNightsAvailable: number | null = null
  let futureAvailableFromDate: string | null = null
  let futureAvailableFromFormatted: string | null = null

  if (nextFutureBooking) {
    const fCheckInStr = toDateStr(nextFutureBooking.checkIn)
    availableUntilDate = fCheckInStr
    availableUntilFormatted = formatDate(nextFutureBooking.checkIn)
    const diffMs = new Date(fCheckInStr + 'T00:00:00').getTime() - todayStart.getTime()
    maxNightsAvailable = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)))

    if (nextFutureBooking.checkOut) {
      futureAvailableFromDate = toDateStr(nextFutureBooking.checkOut)
      futureAvailableFromFormatted = formatDate(nextFutureBooking.checkOut)
    }
  } else if (todayBooking && todayBooking.checkOut) {
    futureAvailableFromDate = toDateStr(todayBooking.checkOut)
    futureAvailableFromFormatted = formatDate(todayBooking.checkOut)
  } else if (activeBooking && activeBooking.checkOut) {
    futureAvailableFromDate = toDateStr(activeBooking.checkOut)
    futureAvailableFromFormatted = formatDate(activeBooking.checkOut)
  }

  const baseResult = {
    isOccupied: false,
    activeBooking,
    isBookedToday: !!todayBooking,
    todayBooking,
    hasFutureBooking,
    nextFutureBooking,
    futureAvailableFromDate,
    futureAvailableFromFormatted,
    allFutureBookings,
    availableUntilDate,
    availableUntilFormatted,
    maxNightsAvailable,
  }

  if (activeBooking) {
    return {
      ...baseResult,
      isOccupied: true,
      displayStatus: 'OCCUPIED',
    }
  }

  if (todayBooking) {
    return {
      ...baseResult,
      displayStatus: 'BOOKED',
    }
  }

  if (room.housekeeping === 'DIRTY') {
    return {
      ...baseResult,
      displayStatus: 'DIRTY',
    }
  }

  if (hasFutureBooking) {
    return {
      ...baseResult,
      displayStatus: 'VACANT_WITH_FUTURE',
    }
  }

  return {
    ...baseResult,
    displayStatus: 'VACANT',
  }
}


/** Lodging (room) invoices are issued at 0% or 5% GST only */
export const LODGING_GST_RATES = ['0', '5'] as const

/** Maps any stored/legacy GST value onto an allowed lodging rate (0 stays 0, anything else becomes 5) */
export function normalizeLodgingGst(v: string | number | null | undefined): string {
  return Number(v) === 0 ? '0' : '5'
}

export type GovIdType = 'AADHAAR' | 'PAN' | 'PASSPORT' | 'VOTER_ID' | 'DRIVING_LICENSE'

export const GOV_ID_TYPES: { value: GovIdType; label: string; placeholder: string; mask: string }[] = [
  { value: 'AADHAAR', label: 'Aadhaar Card', placeholder: '12-digit UID (e.g. 1234 5678 9012)', mask: '12 digits' },
  { value: 'PAN', label: 'PAN Card', placeholder: '10-char PAN (e.g. ABCDE1234F)', mask: 'ABCDE1234F' },
  { value: 'PASSPORT', label: 'Passport', placeholder: 'Passport No. (e.g. A1234567)', mask: 'A1234567' },
  { value: 'VOTER_ID', label: 'Voter ID Card', placeholder: 'Voter ID / EPIC No. (e.g. ABC1234567)', mask: 'EPIC No.' },
  { value: 'DRIVING_LICENSE', label: 'Driving License', placeholder: 'Driving License No.', mask: 'DL No.' },
]

export function validateGovId(type: GovIdType, value: string): { valid: boolean; error?: string; formatted: string } {
  const trimmed = value ? value.trim() : ''
  if (!trimmed) {
    return { valid: false, error: 'Government ID proof is mandatory', formatted: '' }
  }

  if (type === 'AADHAAR') {
    const digits = trimmed.replace(/\D/g, '')
    if (digits.length !== 12) {
      return {
        valid: false,
        error: `Aadhaar number must be exactly 12 numeric digits (${digits.length}/12 entered)`,
        formatted: digits,
      }
    }
    const formatted = `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8, 12)}`
    return { valid: true, formatted: `AADHAAR: ${formatted}` }
  }

  if (type === 'PAN') {
    const upper = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/
    if (upper.length !== 10 || !panRegex.test(upper)) {
      return {
        valid: false,
        error: 'PAN must be standard 10 alphanumeric characters (5 letters, 4 numbers, 1 letter e.g. ABCDE1234F)',
        formatted: upper,
      }
    }
    return { valid: true, formatted: `PAN: ${upper}` }
  }

  if (type === 'PASSPORT') {
    const upper = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (upper.length < 6 || upper.length > 9) {
      return {
        valid: false,
        error: 'Passport number must be 6 to 9 characters (e.g. A1234567)',
        formatted: upper,
      }
    }
    return { valid: true, formatted: `PASSPORT: ${upper}` }
  }

  if (type === 'VOTER_ID') {
    const upper = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (upper.length < 6 || upper.length > 15) {
      return {
        valid: false,
        error: 'Voter ID must be at least 6 characters (e.g. ABC1234567)',
        formatted: upper,
      }
    }
    return { valid: true, formatted: `VOTER_ID: ${upper}` }
  }

  if (type === 'DRIVING_LICENSE') {
    const upper = trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (upper.length < 8 || upper.length > 20) {
      return {
        valid: false,
        error: 'Driving license must be at least 8 characters',
        formatted: upper,
      }
    }
    return { valid: true, formatted: `DRIVING_LICENSE: ${upper}` }
  }

  return { valid: true, formatted: trimmed }
}

export function parseGovId(raw: string | null | undefined): { idType: GovIdType; idNumber: string } {
  if (!raw || !raw.trim()) {
    return { idType: 'AADHAAR', idNumber: '' }
  }
  const str = raw.trim()
  if (str.toUpperCase().startsWith('AADHAAR:')) {
    return { idType: 'AADHAAR', idNumber: str.slice(8).trim() }
  }
  if (str.toUpperCase().startsWith('PAN:')) {
    return { idType: 'PAN', idNumber: str.slice(4).trim() }
  }
  if (str.toUpperCase().startsWith('PASSPORT:')) {
    return { idType: 'PASSPORT', idNumber: str.slice(9).trim() }
  }
  if (str.toUpperCase().startsWith('VOTER_ID:')) {
    return { idType: 'VOTER_ID', idNumber: str.slice(9).trim() }
  }
  if (str.toUpperCase().startsWith('DRIVING_LICENSE:')) {
    return { idType: 'DRIVING_LICENSE', idNumber: str.slice(16).trim() }
  }

  // Auto-detect if raw string without prefix
  const cleanDigits = str.replace(/\D/g, '')
  if (cleanDigits.length === 12) {
    return { idType: 'AADHAAR', idNumber: str }
  }
  if (/^[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}$/.test(str)) {
    return { idType: 'PAN', idNumber: str.toUpperCase() }
  }
  if (/^[A-Za-z]{1}[0-9]{7}$/.test(str)) {
    return { idType: 'PASSPORT', idNumber: str.toUpperCase() }
  }

  return { idType: 'AADHAAR', idNumber: str }
}

export function formatGovIdDisplay(raw: string | null | undefined): string {
  if (!raw || !raw.trim()) return '-'
  const parsed = parseGovId(raw)
  const item = GOV_ID_TYPES.find((t) => t.value === parsed.idType)
  const label = item ? item.label : parsed.idType
  return `${label}: ${parsed.idNumber}`
}
