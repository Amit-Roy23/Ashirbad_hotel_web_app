'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TableControls, usePagination } from './table-controls'
import { api, addDays, exportCSV, formatDate, formatDateTime, formatINR, matchesSearch, printTableReport, todayStr } from '@/lib/hotel-utils'
import { ArrowDownLeft, ArrowUpRight, Loader2, Scale, Wallet } from 'lucide-react'

type Source =
  | 'ROOM_BILL'
  | 'DUE_COLLECTED'
  | 'BILL_CORRECTION'
  | 'ROOM_ADVANCE'
  | 'PART_PAYMENT'
  | 'ROOM_FOOD'
  | 'RESTAURANT'
  | 'BANQUET_ADVANCE'
  | 'BANQUET_PAYMENT'
  | 'OTHER_INCOME'
  | 'EXPENSE'
  | 'SALARY'
  | 'STAFF_ADVANCE'
  | 'REFUND'
  | 'INVENTORY'

interface Entry {
  id: string
  date: string
  direction: 'IN' | 'OUT'
  source: Source
  description: string
  party: string
  ref: string
  cash: number
  upi: number
  card: number
  bank: number
  other: number
  amount: number
  by?: string | null
}

interface Day {
  date: string
  in: number
  out: number
  net: number
  inCash: number
  inUpi: number
  inCard: number
  inBank: number
  inOther: number
  outCash: number
}

interface DayBook {
  entries: Entry[]
  days: Day[]
  totals: { in: number; out: number; net: number; inCash: number; inUpi: number; inCard: number; inBank: number; inOther: number; outCash: number }
}

const SOURCE_LABEL: Record<Source, string> = {
  ROOM_BILL: 'Room bill (checkout)',
  DUE_COLLECTED: 'Due collected',
  BILL_CORRECTION: 'Bill payment corrected',
  ROOM_ADVANCE: 'Room advance',
  PART_PAYMENT: 'Part payment (stay)',
  ROOM_FOOD: 'Room food',
  RESTAURANT: 'Restaurant',
  BANQUET_ADVANCE: 'Banquet advance',
  BANQUET_PAYMENT: 'Banquet payment',
  OTHER_INCOME: 'Other income',
  EXPENSE: 'Expense',
  SALARY: 'Salary',
  STAFF_ADVANCE: 'Staff advance',
  REFUND: 'Refund',
  INVENTORY: 'Inventory purchase',
}

const modeText = (e: Entry) =>
  [
    e.cash ? `Cash ${formatINR(e.cash)}` : '',
    e.upi ? `UPI ${formatINR(e.upi)}` : '',
    e.card ? `Card ${formatINR(e.card)}` : '',
    e.bank ? `Bank ${formatINR(e.bank)}` : '',
    e.other ? `Split/Other ${formatINR(e.other)}` : '',
  ]
    .filter(Boolean)
    .join(' + ')

interface TabProps {
  refreshKey: number
  onDataChanged: () => void
  initialFilter?: string
}

/** Day Book: all money in and out, date by date, with the mode it was paid in */
export function AccountsTab({ refreshKey }: TabProps) {
  const [from, setFrom] = useState(todayStr())
  const [to, setTo] = useState(todayStr())
  const [book, setBook] = useState<DayBook | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [direction, setDirection] = useState('ALL')
  const [source, setSource] = useState('ALL')

  useEffect(() => {
    let alive = true
    api<DayBook>(`/api/daybook?from=${from}&to=${to || from}`)
      .then((d) => alive && setBook(d))
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [from, to, refreshKey])

  const entries = useMemo(
    () =>
      (book?.entries || [])
        .filter((e) => (direction === 'ALL' || e.direction === direction) && (source === 'ALL' || e.source === source))
        .filter((e) => matchesSearch(search, [e.description, e.party, e.ref, SOURCE_LABEL[e.source], e.by, e.amount], [e.party]))
        .slice()
        .reverse(),
    [book, direction, source, search]
  )
  const { paged, controls } = usePagination(entries, 25)
  const shown = useMemo(() => {
    const t = { in: 0, out: 0 }
    for (const e of entries) e.direction === 'IN' ? (t.in += e.amount) : (t.out += e.amount)
    return t
  }, [entries])

  const period = from === to ? formatDate(from) : `${formatDate(from)} to ${formatDate(to)}`
  const headers = ['Date & Time', 'In / Out', 'Type', 'Description', 'Party', 'Mode', 'Amount', 'By']
  const tableRows = (fmt: (n: number) => string | number) =>
    entries.map((e) => [
      formatDateTime(e.date),
      e.direction === 'IN' ? 'Money In' : 'Money Out',
      SOURCE_LABEL[e.source],
      e.description,
      e.party,
      modeText(e),
      fmt(e.direction === 'IN' ? e.amount : -e.amount),
      e.by || '',
    ])

  function setPeriod(p: string) {
    const t = todayStr()
    if (p === 'TODAY') [setFrom, setTo].forEach((f) => f(t))
    if (p === 'YESTERDAY') [setFrom, setTo].forEach((f) => f(addDays(-1, t)))
    if (p === 'WEEK') {
      setFrom(addDays(-6, t))
      setTo(t)
    }
    if (p === 'MONTH') {
      setFrom(`${t.slice(0, 8)}01`)
      setTo(t)
    }
  }

  if (loading && !book) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  const totals = book?.totals

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Accounts — Day Book</h2>
          <p className="text-xs text-muted-foreground">
            Every payment received and paid out, on the day it happened. Dues collected later count on the day they are paid.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            ['TODAY', 'Today'],
            ['YESTERDAY', 'Yesterday'],
            ['WEEK', 'Last 7 days'],
            ['MONTH', 'This month'],
          ].map(([k, label]) => (
            <Button key={k} size="sm" variant="outline" className="h-8 text-xs" onClick={() => setPeriod(k)}>
              {label}
            </Button>
          ))}
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[140px] text-xs" aria-label="From date" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-[140px] text-xs" aria-label="To date" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
            <div className="rounded-full bg-emerald-100 p-2.5 dark:bg-emerald-900">
              <ArrowDownLeft className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Money In</p>
              <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400">{formatINR(totals?.in)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
            <div className="rounded-full bg-red-100 p-2.5 dark:bg-red-900">
              <ArrowUpRight className="h-5 w-5 text-red-700 dark:text-red-300" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Money Out</p>
              <p className="text-xl font-bold text-red-700 dark:text-red-400">{formatINR(totals?.out)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
            <div className="rounded-full bg-sky-100 p-2.5 dark:bg-sky-900">
              <Scale className="h-5 w-5 text-sky-700 dark:text-sky-300" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Net (In − Out)</p>
              <p className={`text-xl font-bold ${(totals?.net || 0) < 0 ? 'text-red-700' : ''}`}>{formatINR(totals?.net)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
            <div className="rounded-full bg-amber-100 p-2.5 dark:bg-amber-900">
              <Wallet className="h-5 w-5 text-amber-700 dark:text-amber-300" />
            </div>
            <div className="text-xs">
              <p className="text-muted-foreground">Received by mode</p>
              <p>
                Cash <b>{formatINR((totals?.inCash || 0) + (totals?.inOther || 0))}</b> · UPI <b>{formatINR(totals?.inUpi)}</b>
              </p>
              <p>
                Card <b>{formatINR(totals?.inCard)}</b> · Bank <b>{formatINR(totals?.inBank)}</b>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {(book?.days.length || 0) > 1 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Money In</TableHead>
                <TableHead className="text-right">Cash</TableHead>
                <TableHead className="text-right">UPI</TableHead>
                <TableHead className="text-right">Card / Bank</TableHead>
                <TableHead className="text-right">Money Out</TableHead>
                <TableHead className="text-right">Net</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {book!.days
                .slice()
                .reverse()
                .map((d) => (
                  <TableRow key={d.date}>
                    <TableCell className="whitespace-nowrap text-xs font-medium">{formatDate(d.date)}</TableCell>
                    <TableCell className="text-right text-xs font-semibold text-emerald-700 dark:text-emerald-400">{formatINR(d.in)}</TableCell>
                    <TableCell className="text-right text-xs">{formatINR(d.inCash + d.inOther)}</TableCell>
                    <TableCell className="text-right text-xs">{formatINR(d.inUpi)}</TableCell>
                    <TableCell className="text-right text-xs">{formatINR(d.inCard + d.inBank)}</TableCell>
                    <TableCell className="text-right text-xs font-semibold text-red-600">{formatINR(d.out)}</TableCell>
                    <TableCell className={`text-right text-xs font-bold ${d.net < 0 ? 'text-red-600' : ''}`}>{formatINR(d.net)}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      )}

      <TableControls
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Description, guest, bill no., amount…"
        filters={[
          { key: 'direction', label: 'In / Out', options: [{ value: 'IN', label: 'Money In' }, { value: 'OUT', label: 'Money Out' }] },
          { key: 'source', label: 'Type', options: (Object.keys(SOURCE_LABEL) as Source[]).map((k) => ({ value: k, label: SOURCE_LABEL[k] })) },
        ]}
        filterValues={{ direction, source }}
        onFilterChange={(k, v) => (k === 'direction' ? setDirection(v) : setSource(v))}
        onReset={() => {
          setSearch('')
          setDirection('ALL')
          setSource('ALL')
        }}
        onExport={() => exportCSV(`day-book-${from}-to-${to}.csv`, headers, tableRows((n) => n))}
        onPrint={() =>
          printTableReport(
            'Day Book',
            headers,
            tableRows((n) => formatINR(n)),
            `${period} · In ${formatINR(shown.in)} · Out ${formatINR(shown.out)} · Net ${formatINR(shown.in - shown.out)}`
          )
        }
      />

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date & Time</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                  No money in or out for {period}.
                </TableCell>
              </TableRow>
            )}
            {paged.map((e) => (
              <TableRow key={e.id}>
                <TableCell className="whitespace-nowrap text-xs">
                  {formatDateTime(e.date)}
                  {e.by && <div className="text-[10px] text-muted-foreground">by {e.by}</div>}
                </TableCell>
                <TableCell>
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      e.direction === 'IN'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                    }`}
                  >
                    {SOURCE_LABEL[e.source]}
                  </span>
                </TableCell>
                <TableCell className="min-w-[220px] text-xs">
                  <div>{e.description}</div>
                  {e.party && <div className="text-[11px] text-muted-foreground">{e.party}</div>}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{modeText(e) || '—'}</TableCell>
                <TableCell
                  className={`whitespace-nowrap text-right text-sm font-bold ${
                    e.direction === 'IN' ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {e.direction === 'IN' ? '+' : '−'}
                  {formatINR(Math.abs(e.amount))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {controls}
      <p className="text-[11px] text-muted-foreground">
        Shown: in {formatINR(shown.in)} · out {formatINR(shown.out)}. Room rent and GST written to the books when a bill is made are not money
        received, so they are not listed here; the payments for them are.
      </p>
    </div>
  )
}
