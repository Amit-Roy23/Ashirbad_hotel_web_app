'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, apiAs, addDays, exportCSV, formatDate, formatINR, printTableReport, todayStr } from '@/lib/hotel-utils'
import { askAdminPin } from '@/lib/admin-pin'
import { RESTAURANT_EXPENSE_HEADS } from '@/lib/restaurant-expense'
import type { RestaurantReport } from '@/lib/restaurant-report'
import { getCachedUser } from './user-context'
import { AdminDeleteDialog } from './admin-delete-dialog'
import { toast } from '@/hooks/use-toast'
import { Download, Loader2, Pencil, Plus, Printer, Trash2 } from 'lucide-react'

type Expense = RestaurantReport['expenses'][number]

/** Restaurant sales, collections, expenses and profit for a period, with expense entry */
export function RestaurantReportPanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [from, setFrom] = useState(todayStr())
  const [to, setTo] = useState(todayStr())
  const [report, setReport] = useState<RestaurantReport | null>(null)
  const [reload, setReload] = useState(0)
  const [editing, setEditing] = useState<Expense | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Expense | null>(null)

  useEffect(() => {
    let alive = true
    api<RestaurantReport>(`/api/restaurant-report?from=${from}&to=${to || from}`)
      .then((d) => alive && setReport(d))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [from, to, refreshKey, reload])

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

  const period = from === to ? formatDate(from) : `${formatDate(from)} to ${formatDate(to)}`

  function printReport() {
    if (!report) return
    const s = report.sales
    const rows: (string | number)[][] = [
      ['Orders taken', s.orders, ''],
      ['Food sales (before GST)', '', formatINR(s.itemsValue)],
      ['GST on food bills', `${s.gstOrders} GST bill(s)`, formatINR(s.gst)],
      ['Food bills total', '', formatINR(s.total)],
      ['  Paid at counter', s.paidCounter.count, formatINR(s.paidCounter.total)],
      ['  Room service', s.roomFood.count, formatINR(s.roomFood.total)],
      ['  Still pending', s.pending.count, formatINR(s.pending.total)],
      ['Collected for food (Cash / UPI / Card / Other)', `${formatINR(report.collected.cash)} / ${formatINR(report.collected.upi)} / ${formatINR(report.collected.card)} / ${formatINR(report.collected.other)}`, formatINR(report.collected.total)],
      ...report.expenseHeads.map((h) => [`Expense: ${h.head}`, '', formatINR(h.amount)]),
      ['Total restaurant expenses', '', formatINR(report.expenseTotal)],
      [report.profit < 0 ? 'Loss (sales before GST − expenses)' : 'Profit (sales before GST − expenses)', '', `${report.profit < 0 ? '−' : ''}${formatINR(Math.abs(report.profit))}`],
    ]
    printTableReport('Restaurant Report', ['Item', 'Count / Detail', 'Amount'], rows, period)
  }

  function exportDaily() {
    if (!report) return
    exportCSV(
      `restaurant-report-${from}-to-${to}`,
      ['Date', 'Orders', 'Sales before GST', 'GST', 'Expenses', 'Profit'],
      report.daily.map((d) => [d.date, d.orders, d.sales, d.gst, d.expenses, d.profit])
    )
  }

  if (!report) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
      </div>
    )
  }
  const s = report.sales

  return (
    <div className="space-y-4">
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
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={printReport}>
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={exportDaily}>
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Food sales (before GST)" value={formatINR(s.itemsValue)} sub={`${s.orders} order(s)${s.cancelled ? ` · ${s.cancelled} cancelled` : ''}`} />
        <Stat label="GST on food bills" value={formatINR(s.gst)} sub={`${s.gstOrders} GST bill(s) · bills total ${formatINR(s.total)}`} />
        <Stat label="Restaurant expenses" value={formatINR(report.expenseTotal)} sub={`${report.expenses.length} entr${report.expenses.length === 1 ? 'y' : 'ies'}`} tone="red" />
        <Stat label={report.profit < 0 ? 'Loss' : 'Profit'} value={`${report.profit < 0 ? '−' : ''}${formatINR(Math.abs(report.profit))}`} sub="Sales before GST − expenses" tone={report.profit >= 0 ? 'green' : 'red'} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-1.5 p-4 text-sm">
            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Food bills</p>
            <Line label={`Paid at counter (${s.paidCounter.count})`} value={formatINR(s.paidCounter.total)} />
            <Line label={`Room service (${s.roomFood.count})`} value={formatINR(s.roomFood.total)} />
            <Line label={`Still pending (${s.pending.count})`} value={formatINR(s.pending.total)} warn={s.pending.total > 0} />
            <div className="border-t pt-1.5">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Money collected for food</p>
              <Line label="Cash" value={formatINR(report.collected.cash)} />
              <Line label="UPI" value={formatINR(report.collected.upi)} />
              <Line label="Card" value={formatINR(report.collected.card)} />
              {report.collected.other > 0 && <Line label="Split / other" value={formatINR(report.collected.other)} />}
              <Line label="Total collected (incl. GST)" value={formatINR(report.collected.total)} bold />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-sm">
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Top selling items</p>
            {report.topItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">No orders in this period.</p>
            ) : (
              <ul className="space-y-1">
                {report.topItems.slice(0, 8).map((it) => (
                  <li key={it.name} className="flex justify-between gap-2">
                    <span className="truncate">
                      {it.name} <span className="text-xs text-muted-foreground">× {it.qty}</span>
                    </span>
                    <b>{formatINR(it.amount)}</b>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold">Restaurant Expenses</p>
              <p className="text-xs text-muted-foreground">Vegetables, grocery, gas, kitchen staff and other running costs. Adding, editing or deleting needs the Admin PIN.</p>
            </div>
            <Button size="sm" className="gap-1 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" /> Add Expense
            </Button>
          </div>
          {report.expenseHeads.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {report.expenseHeads.map((h) => (
                <span key={h.head} className="rounded-full bg-muted px-2.5 py-1 text-xs">
                  {h.head}: <b>{formatINR(h.amount)}</b>
                </span>
              ))}
            </div>
          )}
          {report.expenses.length === 0 ? (
            <p className="text-xs text-muted-foreground">No restaurant expense in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Head</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Mode</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.expenses.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-xs">{formatDate(e.date)}</TableCell>
                      <TableCell className="text-xs font-medium">{e.head}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {e.description.includes(':') ? e.description.slice(e.description.indexOf(':') + 1).trim() : ''}
                        {e.vendor ? ` · ${e.vendor}` : ''}
                      </TableCell>
                      <TableCell className="text-xs">{e.method}</TableCell>
                      <TableCell className="text-right font-semibold">{formatINR(e.amount)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Edit expense" onClick={() => setEditing(e)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" aria-label="Delete expense" onClick={() => setDeleting(e)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {report.daily.length > 1 && (
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 text-sm font-bold">Day by day</p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Sales</TableHead>
                    <TableHead className="text-right">GST</TableHead>
                    <TableHead className="text-right">Expenses</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.daily.map((d) => (
                    <TableRow key={d.date}>
                      <TableCell className="text-xs">{formatDate(d.date)}</TableCell>
                      <TableCell className="text-right text-xs">{d.orders}</TableCell>
                      <TableCell className="text-right text-xs">{formatINR(d.sales)}</TableCell>
                      <TableCell className="text-right text-xs">{formatINR(d.gst)}</TableCell>
                      <TableCell className="text-right text-xs text-red-600">{formatINR(d.expenses)}</TableCell>
                      <TableCell className={`text-right text-xs font-semibold ${d.profit < 0 ? 'text-red-600' : 'text-emerald-700 dark:text-emerald-400'}`}>
                        {d.profit < 0 ? '−' : ''}
                        {formatINR(Math.abs(d.profit))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {editing && (
        <ExpenseDialog
          expense={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            setReload((n) => n + 1)
          }}
        />
      )}
      <AdminDeleteDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete Restaurant Expense"
        itemName={deleting ? `${deleting.description} · ${formatINR(deleting.amount)}` : ''}
        itemType="restaurant expense"
        onConfirm={async (adminPin) => {
          if (!deleting) return
          await apiAs(`/api/restaurant-expenses?id=${deleting.id}`, getCachedUser(), { method: 'DELETE', adminPin })
          toast({ variant: 'success', title: 'Expense deleted' })
          setDeleting(null)
          setReload((n) => n + 1)
        }}
      />
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'green' | 'red' }) {
  const color = tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-emerald-700 dark:text-emerald-400' : ''
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className={`text-lg font-bold ${color}`}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function Line({ label, value, bold, warn }: { label: string; value: string; bold?: boolean; warn?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''} ${warn ? 'text-amber-700 dark:text-amber-400' : ''}`}>
      <span className={bold || warn ? '' : 'text-muted-foreground'}>{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  )
}

function ExpenseDialog({ expense, onClose, onSaved }: { expense: Expense | null; onClose: () => void; onSaved: () => void }) {
  const noteOf = (d: string) => (d.includes(':') ? d.slice(d.indexOf(':') + 1).trim() : '')
  const [head, setHead] = useState<string>(expense?.head || 'Vegetables')
  const [note, setNote] = useState(expense ? noteOf(expense.description) : '')
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '')
  const [method, setMethod] = useState(expense?.method && expense.method !== 'SPLIT' ? expense.method : 'CASH')
  const [date, setDate] = useState(expense ? expense.date.slice(0, 10) : todayStr())
  const [vendor, setVendor] = useState(expense?.vendor || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    const amt = parseFloat(amount) || 0
    if (amt <= 0) return setError('Enter the amount spent')
    if (head === 'Other' && !note.trim()) return setError('Say what the expense was for')
    const pin = await askAdminPin(`${expense ? 'Change' : 'Add'} restaurant expense: ${head} ${formatINR(amt)}. Enter the Admin PIN.`)
    if (!pin) return
    setSaving(true)
    setError('')
    try {
      await apiAs('/api/restaurant-expenses', getCachedUser(), {
        method: expense ? 'PATCH' : 'POST',
        adminPin: pin,
        body: JSON.stringify({ id: expense?.id, head, note: note.trim(), amount: amt, method, date, vendor: vendor.trim() }),
      })
      toast({ variant: 'success', title: expense ? 'Expense updated' : 'Expense added', description: `${head} ${formatINR(amt)}` })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{expense ? 'Edit' : 'Add'} Restaurant Expense</DialogTitle>
          <DialogDescription>Shows in the restaurant report and in Accounts as money paid out.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Head</Label>
            <Select value={head} onValueChange={setHead}>
              <SelectTrigger className="w-full" aria-label="Expense head">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESTAURANT_EXPENSE_HEADS.map((h) => (
                  <SelectItem key={h} value={h}>
                    {h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="re-amt">Amount (₹)</Label>
            <Input id="re-amt" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Mode</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-full" aria-label="Payment mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">Cash</SelectItem>
                <SelectItem value="UPI">UPI</SelectItem>
                <SelectItem value="CARD">Card</SelectItem>
                <SelectItem value="BANK">Bank</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="re-date">Date</Label>
            <Input id="re-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="re-note">Details</Label>
          <Input id="re-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Onion 5 kg, tomato 3 kg" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="re-vendor">Shop / paid to</Label>
          <Input id="re-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Optional" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-700" disabled={saving} onClick={save}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save Expense
        </Button>
      </DialogContent>
    </Dialog>
  )
}
