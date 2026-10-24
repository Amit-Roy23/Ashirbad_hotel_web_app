'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/hotel-utils'

export interface KnownCompany {
  company: string
  gst: string | null
  address: string | null
}

/**
 * Company name field that suggests companies seen before (guest profiles and bills).
 * Picking / typing a known company calls onPick so its GSTIN (and address) can autofill.
 */
export function CompanyInput({
  value,
  onChange,
  onPick,
  placeholder = 'Company name',
  className,
  id,
}: {
  value: string
  onChange: (v: string) => void
  onPick?: (c: KnownCompany) => void
  placeholder?: string
  className?: string
  id?: string
}) {
  const listId = useId()
  const [options, setOptions] = useState<KnownCompany[]>([])
  const lastPicked = useRef('')

  useEffect(() => {
    const q = value.trim()
    const t = setTimeout(() => {
      api<KnownCompany[]>(`/api/companies${q ? `?q=${encodeURIComponent(q)}` : ''}`)
        .then((rows) => {
          setOptions(rows)
          const exact = rows.find((r) => r.company.toLowerCase() === q.toLowerCase())
          if (exact && onPick && lastPicked.current !== exact.company.toLowerCase()) {
            lastPicked.current = exact.company.toLowerCase()
            onPick(exact)
          }
        })
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
    // onPick is a parent callback; only a change of the typed value should trigger a lookup
  }, [value])

  return (
    <>
      <Input
        id={id}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.company} value={o.company}>
            {o.gst ? `GSTIN ${o.gst}` : ''}
          </option>
        ))}
      </datalist>
    </>
  )
}
