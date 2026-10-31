/**
 * Banquet timing shared by the server (hall availability) and the screens (labels).
 * Every booking uses a daily time window on each of its days:
 * a preset slot has fixed hours; a CUSTOM slot has its own start and end time.
 */

export const SLOT_PRESETS: Record<string, { label: string; start: string; end: string }> = {
  MORNING: { label: 'Morning', start: '09:00', end: '15:30' },
  EVENING: { label: 'Evening', start: '18:00', end: '23:30' },
  FULL_DAY: { label: 'Full Day', start: '09:00', end: '23:30' },
}

export const MAX_BANQUET_DAYS = 30

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function isValidTime(t: unknown): t is string {
  return typeof t === 'string' && TIME_RE.test(t)
}

export function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** Daily start and end time of a booking ("HH:MM") */
export function slotTimes(slot: string | null | undefined, startTime?: string | null, endTime?: string | null) {
  if (slot === 'CUSTOM' && isValidTime(startTime) && isValidTime(endTime)) return { start: startTime, end: endTime }
  const preset = SLOT_PRESETS[slot || ''] || SLOT_PRESETS.EVENING
  return { start: preset.start, end: preset.end }
}

/** Two daily windows overlap (touching ends, e.g. 15:30 and 15:30, do not) */
export function windowsOverlap(a: { start: string; end: string }, b: { start: string; end: string }) {
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end)
}

/** "6:00 PM" */
export function formatTime12(t: string) {
  const [h, m] = t.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`
}

/** "Evening · 6:00 PM – 11:30 PM" or "Custom · 10:00 AM – 4:00 PM" */
export function slotLabel(slot: string | null | undefined, startTime?: string | null, endTime?: string | null) {
  const { start, end } = slotTimes(slot, startTime, endTime)
  const name = slot === 'CUSTOM' ? 'Custom' : SLOT_PRESETS[slot || '']?.label || 'Evening'
  return `${name} · ${formatTime12(start)} – ${formatTime12(end)}`
}

/** yyyy-mm-dd plus n days */
export function addDaysStr(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
