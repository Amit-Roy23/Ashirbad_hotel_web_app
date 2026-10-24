'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TableControls, SortableTh, useSort, usePagination } from './table-controls'
import { api, apiAs, apiList, formatINR, formatDate, exportCSV, printTableReport, todayStr } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { Loader2, Plus, Trash2, Tag, TrendingDown, Pencil } from 'lucide-react'
import { AdminDeleteDialog } from './admin-delete-dialog'

interface ExpenseCategory {
  id: string
  name: string
  active: boolean
}

interface LedgerEntry {
  id: string
  date: string
  category: string
  description: string
  amount: number
  method: string
  vendor?: string | null
}

interface TabProps {
  refreshKey: number
  onDataChanged: () => void
  initialFilter?: string
}

export function ExpensesTab({ refreshKey, onDataChanged }: TabProps) {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('ALL')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [catOpen, setCatOpen] = useState(false)
  const [newCat, setNewCat] = useState('')

  // add expense form
  const [eCategory, setECategory] = useState('')
  const [eAmount, setEAmount] = useState('')
  const [eDesc, setEDesc] = useState('')
  const [eMethod, setEMethod] = useState('CASH')
  const [eVendor, setEVendor] = useState('')
  const [eDate, setEDate] = useState(todayStr())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // edit expense form
  const [editEntry, setEditEntry] = useState<LedgerEntry | null>(null)
  const [editCategory, setEditCategory] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editMethod, setEditMethod] = useState('CASH')
  const [editVendor, setEditVendor] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [deleteTargetExpense, setDeleteTargetExpense] = useState<LedgerEntry | null>(null)
  const [deleteTargetCategory, setDeleteTargetCategory] = useState<ExpenseCategory | null>(null)

  const load = useCallback(async () => {
    try {
      const [l, c] = await Promise.all([
        apiList<LedgerEntry>('/api/ledger?type=EXPENSE'),
        apiList<ExpenseCategory>('/api/expense-categories'),
      ])
      setEntries(l)
      setCategories(c)
    } catch {
      // silent — keep previous data
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (q && !`${e.description} ${e.vendor || ''} ${e.category}`.toLowerCase().includes(q)) return false
      if (category !== 'ALL' && e.category !== category) return false
      const d = new Date(e.date).toISOString().slice(0, 10)
      if (from && d < from) return false
      if (to && d > to) return false
      return true
    })
  }, [entries, search, category, from, to])

  const summary = useMemo(() => {
    const today = todayStr()
    const thisMonth = today.slice(0, 7)
    const total = filtered.reduce((s, e) => s + e.amount, 0)
    const todayTotal = entries
      .filter((e) => new Date(e.date).toISOString().slice(0, 10) === today)
      .reduce((s, e) => s + e.amount, 0)
    const monthTotal = entries
      .filter((e) => new Date(e.date).toISOString().slice(0, 7) === thisMonth)
      .reduce((s, e) => s + e.amount, 0)
    const byCategory: Record<string, number> = {}
    for (const e of filtered) byCategory[e.category] = (byCategory[e.category] || 0) + e.amount
    return { total, todayTotal, monthTotal, byCategory }
  }, [filtered, entries])

  const { sorted, sort, toggle } = useSort<Record<string, unknown>>(filtered as unknown as Record<string, unknown>[], 'date')
  const { paged, controls } = usePagination(sorted as unknown as LedgerEntry[], 10)

  const expenseHeaders = ['Date', 'Category', 'Description', 'Vendor/Staff', 'Mode', 'Amount']

  function doExport() {
    exportCSV(
      'expenses.csv',
      expenseHeaders,
      (filtered as unknown as LedgerEntry[]).map((e) => [
        formatDate(e.date), e.category, e.description, e.vendor || '', e.method, e.amount,
      ])
    )
  }

  function doPrint() {
    printTableReport(
      'Expenses Report',
      expenseHeaders,
      (filtered as unknown as LedgerEntry[]).map((e) => [
        formatDate(e.date), e.category, e.description, e.vendor || '', e.method, formatINR(e.amount),
      ]),
      `Total Expenses: ${formatINR(summary.total)} (${filtered.length} entries)`
    )
  }

  function resetFilters() {
    setSearch('')
    setCategory('ALL')
    setFrom('')
    setTo('')
  }

  async function addExpense() {
    if (!eAmount || !eDesc.trim()) {
      setError('Description and amount required')
      return
    }
    setSaving(true)
    setError('')
    try {
      await apiAs('/api/ledger', getCachedUser(), {
        method: 'POST',
        body: JSON.stringify({
          type: 'EXPENSE',
          category: eCategory || 'OTHER',
          description: eDesc.trim(),
          amount: eAmount,
          method: eMethod,
          vendor: eVendor.trim() || undefined,
          date: eDate,
        }),
      })
      setAddOpen(false)
      setEAmount('')
      setEDesc('')
      setEVendor('')
      await load()
      onDataChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  function openEdit(entry: LedgerEntry) {
    setEditEntry(entry)
    setEditCategory(entry.category)
    setEditAmount(String(entry.amount))
    setEditDesc(entry.description)
    setEditMethod(entry.method)
    setEditVendor(entry.vendor || '')
    setEditDate(new Date(entry.date).toISOString().slice(0, 10))
    setEditError('')
  }

  async function saveEdit() {
    if (!editEntry || !editAmount || !editDesc.trim()) {
      setEditError('Description and amount required')
      return
    }
    setEditSaving(true)
    setEditError('')
    try {
      await apiAs('/api/ledger', getCachedUser(), {
        method: 'PATCH',
        body: JSON.stringify({
          id: editEntry.id,
          category: editCategory || 'OTHER',
          description: editDesc.trim(),
          amount: editAmount,
          method: editMethod,
          vendor: editVendor.trim() || undefined,
          date: editDate,
        }),
      })
      setEditEntry(null)
      await load()
      onDataChanged()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to save changes')
    } finally {
      setEditSaving(false)
    }
  }

  function deleteExpense(entry: LedgerEntry) {
    setDeleteTargetExpense(entry)
  }

  async function addCategory() {
    if (!newCat.trim()) return
    try {
      await api('/api/expense-categories', { method: 'POST', body: JSON.stringify({ name: newCat.trim() }) })
      setNewCat('')
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed')
    }
  }

  function deleteCategory(cat: ExpenseCategory) {
    setDeleteTargetCategory(cat)
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Expenses</h2>
          <p className="text-xs text-muted-foreground">Operational expenses, petty cash and staff payouts</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setCatOpen(true)}>
            <Tag className="h-4 w-4" /> Categories
          </Button>
          <Button
            className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            onClick={() => {
              setECategory('OTHER')
              setAddOpen(true)
            }}
          >
            <Plus className="h-4 w-4" /> Add Expense
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Today</p>
            <p className="text-lg font-bold">{formatINR(summary.todayTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">This Month</p>
            <p className="text-lg font-bold">{formatINR(summary.monthTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Filtered Total</p>
            <p className="text-lg font-bold">{formatINR(summary.total)}</p>
          </CardContent>
        </Card>
      </div>

      <TableControls
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Description, vendor…"
        filters={[
          {
            key: 'category',
            label: 'Category',
            options: categories.map((c) => ({ value: c.name, label: c.name })),
          },
        ]}
        filterValues={{ category }}
        onFilterChange={(k, v) => k === 'category' && setCategory(v)}
        onReset={resetFilters}
        onExport={doExport}
        onPrint={doPrint}
      >
        <div className="flex items-center gap-1.5">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[145px] text-xs" aria-label="From date" />
          <span className="text-xs text-muted-foreground font-medium">to</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[145px] text-xs" aria-label="To date" />
        </div>
      </TableControls>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableTh label="Date" sortKey="date" sort={sort} onToggle={toggle} />
              <TableHead>Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Vendor / Staff</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(paged as unknown as LedgerEntry[]).length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  No expenses recorded.
                </TableCell>
              </TableRow>
            )}
            {(paged as unknown as LedgerEntry[]).map((e) => (
              <TableRow key={e.id}>
                <TableCell className="text-xs">{formatDate(e.date)}</TableCell>
                <TableCell>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">{e.category}</span>
                </TableCell>
                <TableCell className="max-w-[260px]">
                  <div className="truncate text-sm">{e.description}</div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{e.vendor || '—'}</TableCell>
                <TableCell className="text-xs">{e.method}</TableCell>
                <TableCell className="text-right text-sm font-bold text-red-600 dark:text-red-400">
                  {formatINR(e.amount)}
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex justify-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => openEdit(e)}
                    >
                      <Pencil className="h-3 w-3" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                      onClick={() => deleteExpense(e)}
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {controls}

      {/* Category summary */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-red-500" />
            <p className="text-sm font-semibold">Filtered Breakdown by Category</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary.byCategory).length === 0 && (
              <p className="text-xs text-muted-foreground">No data.</p>
            )}
            {Object.entries(summary.byCategory).map(([cat, amt]) => (
              <span key={cat} className="rounded-lg bg-muted px-3 py-1.5 text-xs">
                {cat}: <b>{formatINR(amt)}</b>
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Add expense dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Expense</DialogTitle>
            <DialogDescription>Petty cash, purchases, bills and other operational spends</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={eCategory} onValueChange={setECategory}>
                  <SelectTrigger aria-label="Category">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.filter((c) => c.active).map((c) => (
                      <SelectItem key={c.id} value={c.name}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Amount (₹) *</Label>
                <Input type="number" min="0" value={eAmount} onChange={(e) => setEAmount(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description *</Label>
              <Input value={eDesc} onChange={(e) => setEDesc(e.target.value)} placeholder="e.g. Vegetables purchase from market" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Vendor / Staff</Label>
                <Input value={eVendor} onChange={(e) => setEVendor(e.target.value)} placeholder="Optional" />
              </div>
              <div className="space-y-1.5">
                <Label>Payment Mode</Label>
                <Select value={eMethod} onValueChange={setEMethod}>
                  <SelectTrigger aria-label="Mode">
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
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={eDate} max={todayStr()} onChange={(e) => setEDate(e.target.value)} />
            </div>
            {error && <p className="text-sm font-medium text-destructive">{error}</p>}
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={addExpense} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Expense
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Categories manager */}
      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent className="max-w-sm max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Expense Categories</DialogTitle>
            <DialogDescription>Configurable categories for organizing expenses</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col min-h-0 space-y-3 pt-1">
            <div className="flex gap-2">
              <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="New category name" />
              <Button onClick={addCategory} disabled={!newCat.trim()}>
                Add
              </Button>
            </div>
            <ul className="max-h-[50vh] sm:max-h-64 overflow-y-auto space-y-1.5 pr-1 touch-pan-y">
              {categories.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                  <span className="truncate pr-2">{c.name}</span>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30" onClick={() => deleteCategory(c)} aria-label={`Delete ${c.name}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </DialogContent>
      </Dialog>
      {/* Edit expense dialog */}
      <Dialog open={!!editEntry} onOpenChange={(o) => !o && setEditEntry(null)}>
        <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Expense</DialogTitle>
            <DialogDescription>Modify operational expense details</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {editError && <div className="rounded-lg bg-red-50 p-2 text-xs text-red-600 dark:bg-red-950/50">{editError}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date *</Label>
                <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Category *</Label>
                <Select value={editCategory} onValueChange={setEditCategory}>
                  <SelectTrigger aria-label="Edit category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.name}>
                        {c.name}
                      </SelectItem>
                    ))}
                    <SelectItem value="OTHER">OTHER</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description *</Label>
              <Input value={editDesc} onChange={(e) => setEditDesc(e.target.value)} placeholder="e.g. EB Bill, Groceries, Plumbing" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount (₹) *</Label>
                <Input type="number" min="0" step="any" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Payment Mode</Label>
                <Select value={editMethod} onValueChange={setEditMethod}>
                  <SelectTrigger aria-label="Edit mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">CASH</SelectItem>
                    <SelectItem value="UPI">UPI</SelectItem>
                    <SelectItem value="CARD">CARD</SelectItem>
                    <SelectItem value="BANK">BANK</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Vendor / Staff (Optional)</Label>
              <Input value={editVendor} onChange={(e) => setEditVendor(e.target.value)} placeholder="e.g. Ramesh, CESC, Local Shop" />
            </div>
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={editSaving} onClick={saveEdit}>
              {editSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Admin PIN Protected Delete Expense Dialog */}
      <AdminDeleteDialog
        open={!!deleteTargetExpense}
        onOpenChange={(open) => !open && setDeleteTargetExpense(null)}
        title="Delete Expense Record"
        itemType="Expense"
        itemName={deleteTargetExpense ? `${deleteTargetExpense.description} (${formatINR(deleteTargetExpense.amount)})` : ''}
        warningNotice="This will permanently delete this operational expense from the accounts ledger. Admin PIN is required."
        onConfirm={async (adminPin) => {
          if (!deleteTargetExpense) return
          const res = await apiAs<{ success?: boolean; error?: string }>(
            `/api/ledger?id=${deleteTargetExpense.id}`,
            getCachedUser(),
            { method: 'DELETE', adminPin }
          )
          if (res && res.error) {
            throw new Error(res.error)
          }
          setEntries((prev) => prev.filter((e) => e.id !== deleteTargetExpense.id))
          setDeleteTargetExpense(null)
          await load()
          onDataChanged()
        }}
      />

      {/* Admin PIN Protected Delete Category Dialog */}
      <AdminDeleteDialog
        open={!!deleteTargetCategory}
        onOpenChange={(open) => !open && setDeleteTargetCategory(null)}
        title="Delete Expense Category"
        itemType="Category"
        itemName={deleteTargetCategory ? deleteTargetCategory.name : ''}
        warningNotice="Deleting an expense category requires Admin authorization."
        onConfirm={async (adminPin) => {
          if (!deleteTargetCategory) return
          await api(`/api/expense-categories?id=${deleteTargetCategory.id}`, { method: 'DELETE', adminPin })
          setDeleteTargetCategory(null)
          await load()
        }}
      />
    </div>
  )
}
