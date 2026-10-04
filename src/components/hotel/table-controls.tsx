'use client'

import * as React from 'react'
import { Search, RotateCcw, Download, ArrowUp, ArrowDown, Filter } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { exportCSV } from '@/lib/hotel-utils'
import { cn } from '@/lib/utils'

// ============ Sort helper ============
export interface SortState {
  key: string | null
  dir: 'asc' | 'desc'
}

export function useSort<T extends Record<string, unknown>>(
  rows: T[],
  initialKey: string | null = null,
  initialDir: 'asc' | 'desc' = 'desc'
) {
  const [sort, setSort] = React.useState<SortState>({ key: initialKey, dir: initialDir })

  const sorted = React.useMemo(() => {
    if (!sort.key) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sort.key as keyof T]
      const bv = b[sort.key as keyof T]
      const an = typeof av === 'number' ? av : av === null || av === undefined ? -Infinity : String(av).toLowerCase()
      const bn = typeof bv === 'number' ? bv : bv === null || bv === undefined ? -Infinity : String(bv).toLowerCase()
      if (an < bn) return sort.dir === 'asc' ? -1 : 1
      if (an > bn) return sort.dir === 'asc' ? 1 : -1
      return 0
    })
    return copy
  }, [rows, sort])

  function toggle(key: string) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    )
  }

  return { sorted, sort, toggle }
}

// ============ Pagination helper ============
export function usePagination<T>(rows: T[], defaultSize = 10) {
  const [page, setPage] = React.useState(1)
  const [size, setSize] = React.useState(defaultSize)

  React.useEffect(() => {
    setPage(1)
  }, [rows.length])

  const totalPages = Math.max(1, Math.ceil(rows.length / size))
  const safePage = Math.min(page, totalPages)
  const paged = rows.slice((safePage - 1) * size, safePage * size)

  const controls = (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        <span>
          {rows.length === 0 ? 0 : (safePage - 1) * size + 1}–{Math.min(safePage * size, rows.length)} of{' '}
          {rows.length}
        </span>
        <Select
          value={String(size)}
          onValueChange={(v) => {
            setSize(parseInt(v))
            setPage(1)
          }}
        >
          <SelectTrigger className="h-7 w-[70px] text-xs" aria-label="Rows per page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 25, 50].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} / page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" className="h-7 px-2" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>
          Prev
        </Button>
        <span className="px-1">
          {safePage} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2"
          disabled={safePage >= totalPages}
          onClick={() => setPage(safePage + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )

  return { paged, controls, reset: () => setPage(1) }
}

// ============ Filter bar ============
export interface SelectFilterConfig {
  key: string
  label: string
  options: { value: string; label: string }[]
}

export function TableControls({
  search,
  onSearch,
  searchPlaceholder = 'Search…',
  filters,
  filterValues,
  onFilterChange,
  onReset,
  onExport,
  exportName = 'export',
  children,
}: {
  search: string
  onSearch: (v: string) => void
  searchPlaceholder?: string
  filters?: SelectFilterConfig[]
  filterValues?: Record<string, string>
  onFilterChange?: (key: string, value: string) => void
  onReset?: () => void
  onExport?: () => void
  exportName?: string
  children?: React.ReactNode // extra custom filters (date ranges etc.)
}) {
  const hasFilters =
    filters && filterValues && Object.values(filterValues).some((v) => v && v !== 'ALL')
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 pl-8 text-xs"
            aria-label="Search table"
          />
        </div>
        {(filters || []).map((f) => (
          <Select
            key={f.key}
            value={filterValues?.[f.key] || 'ALL'}
            onValueChange={(v) => onFilterChange?.(f.key, v)}
          >
            <SelectTrigger className="h-9 w-[140px] text-xs" aria-label={f.label}>
              <Filter className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <SelectValue placeholder={f.label} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All {f.label}</SelectItem>
              {f.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        {children}
        {onReset && (
          <Button variant="ghost" size="sm" onClick={onReset} className="h-9 gap-1.5 text-xs">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Reset
          </Button>
        )}
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs font-semibold"
            onClick={
              onExport ||
              (() => exportCSV(`${exportName}.csv`, ['data'], []))
            }
          >
            <Download className="h-3.5 w-3.5" aria-hidden />
            Export
          </Button>
        </div>
      </div>
      {hasFilters && (
        <p className="text-[11px] text-muted-foreground">Filters active — showing filtered results</p>
      )}
    </div>
  )
}

// ============ Sortable header cell ============
export function SortableTh({
  label,
  sortKey,
  sort,
  onToggle,
  className,
}: {
  label: string
  sortKey: string
  sort: SortState
  onToggle: (key: string) => void
  className?: string
}) {
  const active = sort.key === sortKey
  return (
    <th className={cn('h-10 px-2 text-left align-middle font-medium', className)}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground',
          active ? 'text-foreground' : 'text-muted-foreground'
        )}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {active &&
          (sort.dir === 'asc' ? (
            <ArrowUp className="h-3 w-3" aria-hidden />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden />
          ))}
      </button>
    </th>
  )
}
