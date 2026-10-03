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
  return d.toISOString().slice(0, 10)
}

export function addDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function api<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      ...(options?.headers || {}),
    },
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
export async function apiList<T = unknown>(url: string, options?: RequestInit): Promise<T[]> {
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
  options?: RequestInit
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

