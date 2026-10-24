'use client'

import { Label } from '@/components/ui/label'
import { GST_HALF_RATES } from '@/lib/gst'

/** One GST half (CGST or SGST): 0% or 2.5% */
function HalfToggle({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-foreground">{label}</Label>
      <div className="grid h-9 grid-cols-2 gap-1">
        {GST_HALF_RATES.map((pct) => (
          <button
            key={pct}
            type="button"
            disabled={disabled}
            onClick={() => onChange(pct)}
            className={`rounded border text-xs font-semibold transition-colors disabled:opacity-50 ${
              value === pct
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {pct}%
          </button>
        ))}
      </div>
    </div>
  )
}

/** CGST and SGST selectors side by side (each 0% or 2.5%) */
export function GstPicker({
  cgst,
  sgst,
  onChange,
  disabled,
}: {
  cgst: number
  sgst: number
  onChange: (next: { cgst: number; sgst: number }) => void
  disabled?: boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <HalfToggle label="CGST" value={cgst} onChange={(v) => onChange({ cgst: v, sgst })} disabled={disabled} />
      <HalfToggle label="SGST" value={sgst} onChange={(v) => onChange({ cgst, sgst: v })} disabled={disabled} />
    </div>
  )
}
