/**
 * GST is always shown and charged as two halves: CGST and SGST.
 * Each half is either 2.5% or 0% (so the combined rate is 0%, 2.5% or 5%).
 */
export const GST_HALF_RATES = [0, 2.5] as const

export function isValidHalfRate(v: unknown): boolean {
  const n = Number(v)
  return v !== '' && v !== null && v !== undefined && !isNaN(n) && (GST_HALF_RATES as readonly number[]).includes(n)
}

/** Settings value → allowed half rate (legacy/unknown values fall back to 2.5) */
export function normalizeHalfRate(v: unknown, fallback = 2.5): number {
  return isValidHalfRate(v) ? Number(v) : fallback
}

export interface GstSplitInput {
  gstPercent?: number | null
  actualGst?: number | null
  gstAmount?: number | null
  cgstPercent?: number | null
  sgstPercent?: number | null
}

export interface GstSplit {
  cgstPercent: number
  sgstPercent: number
  cgst: number
  sgst: number
  total: number
}

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * CGST / SGST rates and amounts of a bill. Bills saved before the split existed only have the
 * combined rate; those are shown as two equal halves.
 */
export function splitGst(b: GstSplitInput): GstSplit {
  const total = Number(b.actualGst ?? b.gstAmount ?? 0)
  const combined = Number(b.gstPercent || 0)
  let c = Number(b.cgstPercent || 0)
  let s = Number(b.sgstPercent || 0)
  if (Math.abs(c + s - combined) > 0.001) {
    c = combined / 2
    s = combined / 2
  }
  if (c + s <= 0) return { cgstPercent: 0, sgstPercent: 0, cgst: 0, sgst: 0, total }
  const cgst = r2((total * c) / (c + s))
  return { cgstPercent: c, sgstPercent: s, cgst, sgst: r2(total - cgst), total }
}

/** Tax amounts for a taxable value at the given CGST / SGST rates */
export function computeGst(taxable: number, cgstPercent: number, sgstPercent: number) {
  const cgst = r2((Math.max(0, taxable) * cgstPercent) / 100)
  const sgst = r2((Math.max(0, taxable) * sgstPercent) / 100)
  return { cgst, sgst, total: r2(cgst + sgst) }
}

export interface BillMoney {
  grandTotal?: number | null
  advanceApplied?: number | null
  payCash?: number | null
  payUpi?: number | null
  payCard?: number | null
  carriedForward?: number | null
}

/** Money received on a bill (advance / part payments applied + payments at or after checkout) */
export function billReceived(b: BillMoney): number {
  return r2(Number(b.advanceApplied || 0) + Number(b.payCash || 0) + Number(b.payUpi || 0) + Number(b.payCard || 0))
}

/** Amount still owed on a bill; dues moved into a later bill (carriedForward) are no longer owed here */
export function billBalance(b: BillMoney): number {
  return Math.max(0, r2(Number(b.grandTotal || 0) - billReceived(b) - Number(b.carriedForward || 0)))
}
