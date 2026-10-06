'use client'

import * as React from 'react'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { BedDouble, Search, UserRound, ReceiptText, ClipboardList, Loader2, ArrowRight } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/hotel-utils'

interface GuestHit {
  id: string
  name: string
  phone: string
  company?: string | null
  bookings?: { id: string; room?: { number: string }; status: string }[]
}

interface BookingHit {
  id: string
  room: { number: string }
  guest: { name: string; phone: string }
  status: string
  paymentStatus: string
}

interface BillHit {
  id: string
  billNumber: string
  grandTotal: number
  createdAt: string
  booking: { guest: { name: string }; room: { number: string } }
}

interface RoomHit {
  id: string
  number: string
  type: string
  status: string
}

interface SearchResults {
  guests: GuestHit[]
  bookings: BookingHit[]
  bills: BillHit[]
  rooms: RoomHit[]
}

const EMPTY: SearchResults = { guests: [], bookings: [], bills: [], rooms: [] }

// Shared in-memory search index cache across modal openings
let globalIndexCache: SearchResults | null = null
let indexPromise: Promise<SearchResults> | null = null

function fetchSearchIndex(force = false): Promise<SearchResults> {
  if (globalIndexCache && !force) return Promise.resolve(globalIndexCache)
  if (!indexPromise) {
    indexPromise = fetch('/api/search?index=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: SearchResults) => {
        globalIndexCache = data
        return data
      })
      .catch(() => EMPTY)
      .finally(() => {
        indexPromise = null
      })
  }
  return indexPromise
}

export function GlobalSearch({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate: (target: { tab: string; q?: string }) => void
}) {
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<SearchResults>(EMPTY)
  const [loading, setLoading] = React.useState(false)
  const localIndexRef = React.useRef<SearchResults>(globalIndexCache || EMPTY)

  // Refresh the index every time the dialog opens so new guests, bookings, bills and
  // room status changes are searchable without a page reload (cached copy is shown meanwhile)
  React.useEffect(() => {
    if (!open) return
    fetchSearchIndex(true).then((data) => {
      localIndexRef.current = data
    })
  }, [open])

  React.useEffect(() => {
    if (!open) {
      setQuery('')
      setResults(EMPTY)
      setLoading(false)
    }
  }, [open])

  // Instant synchronous search filter over local in-memory index
  const runLocalSearch = React.useCallback((searchQuery: string): SearchResults => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return EMPTY

    const idx = localIndexRef.current || globalIndexCache || EMPTY

    const guests = (idx.guests || [])
      .filter((g) => `${g.name} ${g.phone} ${g.company || ''}`.toLowerCase().includes(q))
      .slice(0, 8)

    const rooms = (idx.rooms || [])
      .filter((r) => `${r.number} ${r.type} ${r.status}`.toLowerCase().includes(q))
      .slice(0, 8)

    const bookings = (idx.bookings || [])
      .filter((b) => `${b.guest?.name || ''} ${b.guest?.phone || ''} ${b.room?.number || ''} ${b.id || ''}`.toLowerCase().includes(q))
      .slice(0, 8)

    const bills = (idx.bills || [])
      .filter((b) => `${b.billNumber} ${b.booking?.guest?.name || ''} ${b.booking?.room?.number || ''}`.toLowerCase().includes(q))
      .slice(0, 8)

    return { guests, rooms, bookings, bills }
  }, [])

  // Handle Query Changes: Instant local result + fast background sync
  const handleQueryChange = (val: string) => {
    setQuery(val)
    const q = val.trim()
    if (!q) {
      setResults(EMPTY)
      setLoading(false)
      return
    }

    // 1. INSTANT 0ms result from memory index
    const instantHits = runLocalSearch(q)
    setResults(instantHits)
  }

  // 2. Background async query to merge any additional database records
  React.useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) return

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: controller.signal,
          headers: { 'Cache-Control': 'no-cache' },
        })
        if (res.ok) {
          const serverData: SearchResults = await res.json()
          setResults((prev) => {
            // Merge unique items by id
            const mergeUnique = <T extends { id: string }>(a: T[], b: T[]) => {
              const map = new Map<string, T>()
              for (const item of a) map.set(item.id, item)
              for (const item of b) map.set(item.id, item)
              return Array.from(map.values()).slice(0, 8)
            }
            return {
              guests: mergeUnique(serverData.guests || [], prev.guests || []),
              rooms: mergeUnique(serverData.rooms || [], prev.rooms || []),
              bookings: mergeUnique(serverData.bookings || [], prev.bookings || []),
              bills: mergeUnique(serverData.bills || [], prev.bills || []),
            }
          })
        }
      } catch (err: unknown) {
        if ((err as Error)?.name !== 'AbortError') {
          // ignore abort
        }
      } finally {
        setLoading(false)
      }
    }, 120)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, open])

  const go = (tab: string, q?: string) => {
    onOpenChange(false)
    onNavigate({ tab, q })
  }

  const total = results.guests.length + results.bookings.length + results.bills.length + results.rooms.length

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      <div className="relative">
        <CommandInput
          placeholder="Search guest name, phone, room, invoice, booking ID…"
          value={query}
          onValueChange={handleQueryChange}
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      <CommandList className="max-h-[380px]">
        {!query && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            <Search className="mx-auto mb-2.5 h-7 w-7 text-muted-foreground/60" aria-hidden />
            <p className="font-semibold text-foreground text-xs">Search Ashirvad Lodge System</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Instant search across guests, bookings, rooms, and billing invoices.
            </p>
            <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground/80">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono">Guest Name</span>
              <span>•</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono">10-Digit Mobile</span>
              <span>•</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono">Room Number</span>
              <span>•</span>
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono">Invoice #</span>
            </div>
          </div>
        )}

        {query && total === 0 && !loading && (
          <CommandEmpty className="py-8 text-center text-xs text-muted-foreground">
            No matches found for &quot;{query}&quot;. Try a name, mobile number, or room.
          </CommandEmpty>
        )}

        {results.guests.length > 0 && (
          <CommandGroup heading={`Guests (${results.guests.length})`}>
            {results.guests.map((g) => (
              <CommandItem
                key={g.id}
                value={`${g.name} ${g.phone} ${g.company || ''}`}
                onSelect={() => go('guests', g.phone)}
                className="cursor-pointer hover:bg-accent/80"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 mr-2 shrink-0">
                  <UserRound className="h-3.5 w-3.5" aria-hidden />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-foreground truncate">{g.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    <span className="font-mono">{g.phone}</span>
                    {g.company ? ` · ${g.company}` : ''}
                    {g.bookings?.[0] ? ` · Last Stay: Room ${g.bookings[0].room?.number ?? '-'}` : ''}
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-50 shrink-0 ml-2" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results.rooms.length > 0 && (
          <CommandGroup heading={`Rooms (${results.rooms.length})`}>
            {results.rooms.map((r) => (
              <CommandItem
                key={r.id}
                value={`Room ${r.number} ${r.type} ${r.status}`}
                onSelect={() => go('rooms', r.number)}
                className="cursor-pointer hover:bg-accent/80"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-950/60 text-sky-700 dark:text-sky-400 mr-2 shrink-0">
                  <BedDouble className="h-3.5 w-3.5" aria-hidden />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-bold text-foreground">Room {r.number}</span>
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    {r.type} · {r.status}
                  </span>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-50 shrink-0 ml-2" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results.bookings.length > 0 && (
          <CommandGroup heading={`Bookings (${results.bookings.length})`}>
            {results.bookings.map((b) => (
              <CommandItem
                key={b.id}
                value={`Booking ${b.guest?.name || ''} Room ${b.room?.number || ''} ${b.status}`}
                onSelect={() => go('bookings', b.guest?.name || b.guest?.phone || '')}
                className="cursor-pointer hover:bg-accent/80"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 mr-2 shrink-0">
                  <ClipboardList className="h-3.5 w-3.5" aria-hidden />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-foreground truncate">
                    {b.guest?.name || 'Guest'} · Room {b.room?.number}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    Status: <span className="font-semibold">{b.status}</span> · Pay: {b.paymentStatus}
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-50 shrink-0 ml-2" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {results.bills.length > 0 && (
          <CommandGroup heading={`Billing Invoices (${results.bills.length})`}>
            {results.bills.map((b) => (
              <CommandItem
                key={b.id}
                value={`Invoice ${b.billNumber} ${b.booking?.guest?.name || ''}`}
                onSelect={() => go('billing', b.billNumber)}
                className="cursor-pointer hover:bg-accent/80"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400 mr-2 shrink-0">
                  <ReceiptText className="h-3.5 w-3.5" aria-hidden />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-foreground truncate">
                    {b.billNumber} · {formatINR(b.grandTotal)}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {b.booking?.guest?.name || 'Guest'} · Room {b.booking?.room?.number || '-'} ·{' '}
                    {formatDate(b.createdAt)}
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-50 shrink-0 ml-2" />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}


