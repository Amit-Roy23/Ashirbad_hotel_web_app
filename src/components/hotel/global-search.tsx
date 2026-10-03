'use client'

import * as React from 'react'
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { BedDouble, Search, UserRound, ReceiptText, ClipboardList } from 'lucide-react'
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

  React.useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setResults(EMPTY)
      return
    }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
        setResults(await res.json())
      } catch {
        // ignore
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [query, open])

  const go = (tab: string, q?: string) => {
    onOpenChange(false)
    onNavigate({ tab, q })
  }

  const total = results.guests.length + results.bookings.length + results.bills.length + results.rooms.length

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search guest, phone, room, invoice no, booking ID…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {loading && <div className="px-4 py-3 text-sm text-muted-foreground">Searching…</div>}
        {!loading && query && total === 0 && <CommandEmpty>No matches found.</CommandEmpty>}
        {!query && (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            <Search className="mx-auto mb-2 h-6 w-6" aria-hidden />
            Type to search guests, bookings, rooms and invoices.
            <br />
            <span className="text-xs">Tip: enter a phone number to auto-fill a returning guest.</span>
          </div>
        )}
        {results.guests.length > 0 && (
          <CommandGroup heading="Guests">
            {results.guests.map((g) => (
              <CommandItem key={g.id} onSelect={() => go('guests', g.phone)}>
                <UserRound className="mr-2 h-4 w-4" aria-hidden />
                <div className="flex-1">
                  <div className="text-sm font-medium">{g.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {g.phone}
                    {g.company ? ` · ${g.company}` : ''}
                    {g.bookings?.[0] ? ` · last: Room ${g.bookings[0].room?.number ?? '-'}` : ''}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results.rooms.length > 0 && (
          <CommandGroup heading="Rooms">
            {results.rooms.map((r) => (
              <CommandItem key={r.id} onSelect={() => go('rooms', r.number)}>
                <BedDouble className="mr-2 h-4 w-4" aria-hidden />
                <div className="flex-1">
                  <span className="text-sm font-medium">Room {r.number}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {r.type} · {r.status}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results.bookings.length > 0 && (
          <CommandGroup heading="Bookings">
            {results.bookings.map((b) => (
              <CommandItem key={b.id} onSelect={() => go('bookings', b.guest?.name || '')}>
                <ClipboardList className="mr-2 h-4 w-4" aria-hidden />
                <div className="flex-1 text-sm">
                  {b.guest?.name || 'Guest'} · Room {b.room?.number} · {b.status}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {results.bills.length > 0 && (
          <CommandGroup heading="Invoices">
            {results.bills.map((b) => (
              <CommandItem key={b.id} onSelect={() => go('billing', b.billNumber)}>
                <ReceiptText className="mr-2 h-4 w-4" aria-hidden />
                <div className="flex-1">
                  <div className="text-sm font-medium">{b.billNumber}</div>
                  <div className="text-xs text-muted-foreground">
                    {b.booking?.guest?.name || 'Guest'} · Room {b.booking?.room?.number} · {formatINR(b.grandTotal)} ·{' '}
                    {formatDate(b.createdAt)}
                  </div>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  )
}
