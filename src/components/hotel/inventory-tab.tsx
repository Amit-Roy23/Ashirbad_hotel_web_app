'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TableControls, SortableTh, useSort, usePagination } from './table-controls'
import { AdminDeleteDialog } from './admin-delete-dialog'
import { getCachedUser } from './user-context'
import { askAdminPin } from '@/lib/admin-pin'
import { apiAs, formatINR, formatDate, formatDateTime, exportCSV, printTableReport, todayStr } from '@/lib/hotel-utils'
import { toast } from '@/hooks/use-toast'
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ClipboardCheck,
  History,
  IndianRupee,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  PackageX,
} from 'lucide-react'

// ============ Types & constants ============

type ItemStatus = 'OK' | 'LOW' | 'OUT'
type MovementType = 'OPENING' | 'PURCHASE' | 'ISSUE' | 'WASTAGE' | 'ADJUSTMENT'
type EntryType = Exclude<MovementType, 'OPENING'>

interface InventoryItem {
  id: string
  name: string
  category: string
  unit: string
  stock: number
  reorderLevel: number
  avgCost: number
  location?: string | null
  notes?: string | null
  active: boolean
  status: ItemStatus
  value: number
  updatedAt: string
}

interface Summary {
  totalItems: number
  stockValue: number
  lowCount: number
  outCount: number
  monthPurchase: number
}

interface Movement {
  id: string
  itemId: string
  type: MovementType
  quantity: number
  balanceAfter: number
  unitCost: number
  totalCost: number
  vendor?: string | null
  reference?: string | null
  department?: string | null
  roomNumber?: string | null
  method?: string | null
  expenseRecorded: boolean
  note?: string | null
  createdBy?: string | null
  date: string
  isLatest: boolean
  item: { name: string; unit: string; category: string }
}

interface ReportRow {
  itemId: string
  name: string
  category: string
  unit: string
  opening: number
  purchasedQty: number
  purchasedCost: number
  usedQty: number
  usedCost: number
  wastedQty: number
  wastedCost: number
  adjustedQty: number
  closing: number
  closingValue: number
}

interface Report {
  rows: ReportRow[]
  totals: { purchasedCost: number; usedCost: number; wastedCost: number; closingValue: number }
}

const CATEGORIES = [
  'Housekeeping & Linen',
  'Guest Amenities',
  'Cleaning Supplies',
  'Kitchen & Food Stock',
  'Beverages',
  'Maintenance & Electrical',
  'Banquet Supplies',
  'Stationery & Office',
  'Other',
]
const UNITS = ['pcs', 'kg', 'g', 'ltr', 'ml', 'pack', 'box', 'bottle', 'roll', 'set', 'pair', 'dozen', 'packet']
const DEPARTMENTS = ['Housekeeping', 'Rooms', 'Kitchen / Restaurant', 'Banquet', 'Maintenance', 'Front Office', 'Other']
const PAY_MODES = ['CASH', 'UPI', 'CARD', 'BANK']

const TYPE_META: Record<MovementType, { label: string; cls: string }> = {
  OPENING: { label: 'Opening', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300' },
  PURCHASE: { label: 'Stock In', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  ISSUE: { label: 'Used', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300' },
  WASTAGE: { label: 'Wastage', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  ADJUSTMENT: { label: 'Count Fix', cls: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300' },
}

const STATUS_META: Record<ItemStatus, { label: string; cls: string }> = {
  OK: { label: 'In Stock', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  LOW: { label: 'Low Stock', cls: 'bg-amber-200 text-amber-950 dark:bg-amber-900 dark:text-amber-200' },
  OUT: { label: 'Out of Stock', cls: 'bg-red-600 text-white dark:bg-red-700' },
}

const qty = (n: number) => Number(n.toFixed(3)).toString()
const monthStart = () => `${todayStr().slice(0, 8)}01`

function movementDetails(m: Movement) {
  return [
    m.vendor && `From ${m.vendor}`,
    m.reference && `Bill ${m.reference}`,
    m.method && m.type === 'PURCHASE' && m.method,
    m.expenseRecorded && 'in Expenses',
    m.department && `For ${m.department}`,
    m.roomNumber && `Room ${m.roomNumber}`,
    m.note,
  ]
    .filter(Boolean)
    .join(' · ')
}

interface TabProps {
  refreshKey: number
  onDataChanged: () => void
  initialFilter?: string
}

// ============ Main tab ============

export function InventoryTab({ refreshKey, onDataChanged }: TabProps) {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [subTab, setSubTab] = useState('stock')
  const [showArchived, setShowArchived] = useState(false)

  const [itemDialog, setItemDialog] = useState<{ open: boolean; item: InventoryItem | null }>({ open: false, item: null })
  const [entryDialog, setEntryDialog] = useState<{ open: boolean; item: InventoryItem | null; type: EntryType }>({
    open: false,
    item: null,
    type: 'PURCHASE',
  })
  const [deleteItem, setDeleteItem] = useState<InventoryItem | null>(null)
  const [historyItemId, setHistoryItemId] = useState('ALL')
  const [historyKey, setHistoryKey] = useState(0)

  useEffect(() => {
    let alive = true
    apiAs<{ items: InventoryItem[]; summary: Summary }>(`/api/inventory${showArchived ? '?archived=true' : ''}`, getCachedUser())
      .then((data) => {
        if (!alive) return
        setItems(data.items || [])
        setSummary(data.summary || null)
      })
      .catch(() => {}) // keep previous data
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [showArchived, refreshKey])

  // onDataChanged bumps refreshKey, which reloads the items
  function changed() {
    setHistoryKey((k) => k + 1)
    onDataChanged()
  }

  function openEntry(type: EntryType, item: InventoryItem | null = null) {
    setEntryDialog({ open: true, item, type })
  }

  function showHistory(item: InventoryItem) {
    setHistoryItemId(item.id)
    setSubTab('history')
  }

  async function restore(item: InventoryItem) {
    try {
      await apiAs('/api/inventory', getCachedUser(), { method: 'PATCH', body: JSON.stringify({ id: item.id, active: true }) })
      toast({ title: 'Item restored', description: `${item.name} is active again.` })
      changed()
    } catch (e) {
      toast({ variant: 'destructive', title: 'Could not restore', description: e instanceof Error ? e.message : '' })
    }
  }

  const activeItems = useMemo(() => items.filter((i) => i.active), [items])
  const alerts = useMemo(
    () => activeItems.filter((i) => i.status !== 'OK').sort((a, b) => (a.status === 'OUT' ? -1 : 1) - (b.status === 'OUT' ? -1 : 1)),
    [activeItems]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold">Inventory</h2>
          <p className="text-xs text-muted-foreground">Stock of linen, amenities, cleaning, kitchen and other supplies</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setItemDialog({ open: true, item: null })}>
            <Plus className="h-4 w-4" /> Add Item
          </Button>
          <Button variant="outline" className="gap-2" disabled={activeItems.length === 0} onClick={() => openEntry('ISSUE')}>
            <ArrowUpFromLine className="h-4 w-4" /> Use Stock
          </Button>
          <Button
            className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
            disabled={activeItems.length === 0}
            onClick={() => openEntry('PURCHASE')}
          >
            <ArrowDownToLine className="h-4 w-4" /> Stock In
          </Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
            <div className="rounded-full bg-sky-100 p-2.5 dark:bg-sky-900">
              <Boxes className="h-5 w-5 text-sky-700 dark:text-sky-300" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Items</p>
              <p className="text-xl font-bold">{summary?.totalItems ?? 0}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
            <div className="rounded-full bg-emerald-100 p-2.5 dark:bg-emerald-900">
              <IndianRupee className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Stock Value</p>
              <p className="text-xl font-bold">{formatINR(summary?.stockValue)}</p>
              <p className="text-[10px] text-muted-foreground">at average cost</p>
            </div>
          </CardContent>
        </Card>
        <Card className={(summary?.lowCount || 0) + (summary?.outCount || 0) > 0 ? 'border-red-300 dark:border-red-800' : ''}>
          <CardContent className="flex items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
            <div className="rounded-full bg-red-100 p-2.5 dark:bg-red-900">
              <AlertTriangle className="h-5 w-5 text-red-700 dark:text-red-300" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Needs Reorder</p>
              <p className="text-xl font-bold text-red-700 dark:text-red-400">{(summary?.lowCount || 0) + (summary?.outCount || 0)}</p>
              <p className="text-[10px] text-muted-foreground">
                {summary?.outCount || 0} out · {summary?.lowCount || 0} low
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
            <div className="rounded-full bg-amber-100 p-2.5 dark:bg-amber-900">
              <ArrowDownToLine className="h-5 w-5 text-amber-700 dark:text-amber-300" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Purchases</p>
              <p className="text-xl font-bold">{formatINR(summary?.monthPurchase)}</p>
              <p className="text-[10px] text-muted-foreground">this month</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Reorder alert */}
      {alerts.length > 0 && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950/30">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-red-800 dark:text-red-300">
            <AlertTriangle className="h-4 w-4" /> {alerts.length} item{alerts.length > 1 ? 's' : ''} need reordering
          </div>
          <div className="flex flex-wrap gap-2">
            {alerts.slice(0, 12).map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => openEntry('PURCHASE', i)}
                className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-background px-2.5 py-1 text-xs hover:border-red-400 dark:border-red-900"
                title={`Stock in ${i.name}`}
              >
                <span className="font-semibold">{i.name}</span>
                <span className={i.status === 'OUT' ? 'font-bold text-red-700 dark:text-red-400' : 'text-amber-800 dark:text-amber-300'}>
                  {qty(i.stock)} {i.unit}
                </span>
                {i.reorderLevel > 0 && <span className="text-muted-foreground">/ min {qty(i.reorderLevel)}</span>}
                <ArrowDownToLine className="h-3 w-3 text-emerald-600" />
              </button>
            ))}
            {alerts.length > 12 && <span className="self-center text-xs text-muted-foreground">+{alerts.length - 12} more</span>}
          </div>
        </div>
      )}

      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList className="grid h-auto w-full grid-cols-3 gap-1 sm:inline-flex sm:w-auto sm:self-start [&>button]:h-8 sm:[&>button]:px-4">
          <TabsTrigger value="stock" className="gap-1.5">
            <Boxes className="h-4 w-4" /> Stock
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-4 w-4" /> History
          </TabsTrigger>
          <TabsTrigger value="report" className="gap-1.5">
            <ClipboardCheck className="h-4 w-4" /> Report
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="mt-3">
          <StockList
            items={items}
            showArchived={showArchived}
            onShowArchived={setShowArchived}
            onEntry={openEntry}
            onEdit={(item) => setItemDialog({ open: true, item })}
            onHistory={showHistory}
            onDelete={setDeleteItem}
            onRestore={restore}
            onAdd={() => setItemDialog({ open: true, item: null })}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-3">
          <MovementHistory
            key={historyKey}
            items={items}
            itemId={historyItemId}
            onItemId={setHistoryItemId}
            onChanged={changed}
          />
        </TabsContent>

        <TabsContent value="report" className="mt-3">
          <StockReport refreshKey={historyKey} />
        </TabsContent>
      </Tabs>

      <ItemDialog
        open={itemDialog.open}
        item={itemDialog.item}
        categories={[...new Set([...CATEGORIES, ...items.map((i) => i.category)])]}
        onOpenChange={(open) => setItemDialog((s) => ({ ...s, open }))}
        onSaved={changed}
      />

      <EntryDialog
        key={`${entryDialog.open}-${entryDialog.item?.id || 'any'}-${entryDialog.type}`}
        open={entryDialog.open}
        items={activeItems}
        initialItem={entryDialog.item}
        initialType={entryDialog.type}
        onOpenChange={(open) => setEntryDialog((s) => ({ ...s, open }))}
        onSaved={changed}
      />

      <AdminDeleteDialog
        open={!!deleteItem}
        onOpenChange={(open) => !open && setDeleteItem(null)}
        title="Delete Inventory Item"
        itemType="Inventory item"
        itemName={deleteItem ? `${deleteItem.name} (${qty(deleteItem.stock)} ${deleteItem.unit} in stock)` : ''}
        warningNotice="An item that has stock history is archived instead of deleted, so past reports stay correct. It can be restored later."
        onConfirm={async (adminPin) => {
          if (!deleteItem) return
          const res = await apiAs<{ archived?: boolean }>(`/api/inventory?id=${deleteItem.id}`, getCachedUser(), {
            method: 'DELETE',
            adminPin,
          })
          toast({
            title: res.archived ? 'Item archived' : 'Item deleted',
            description: res.archived
              ? `${deleteItem.name} has stock history, so it was archived. Turn on "Show archived" to restore it.`
              : `${deleteItem.name} was deleted.`,
          })
          setDeleteItem(null)
          changed()
        }}
      />
    </div>
  )
}

// ============ Stock list ============

function StockList({
  items,
  showArchived,
  onShowArchived,
  onEntry,
  onEdit,
  onHistory,
  onDelete,
  onRestore,
  onAdd,
}: {
  items: InventoryItem[]
  showArchived: boolean
  onShowArchived: (v: boolean) => void
  onEntry: (type: EntryType, item: InventoryItem) => void
  onEdit: (item: InventoryItem) => void
  onHistory: (item: InventoryItem) => void
  onDelete: (item: InventoryItem) => void
  onRestore: (item: InventoryItem) => void
  onAdd: () => void
}) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('ALL')
  const [status, setStatus] = useState('ALL')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((i) => {
      if (q && !`${i.name} ${i.category} ${i.location || ''}`.toLowerCase().includes(q)) return false
      if (category !== 'ALL' && i.category !== category) return false
      if (status !== 'ALL' && (status === 'ARCHIVED' ? i.active : !i.active || i.status !== status)) return false
      return true
    })
  }, [items, search, category, status])

  const { sorted, sort, toggle } = useSort<Record<string, unknown>>(filtered as unknown as Record<string, unknown>[], 'name', 'asc')
  const rows = sorted as unknown as InventoryItem[]
  const { paged, controls } = usePagination(rows, 25)

  const headers = ['Item', 'Category', 'In Stock', 'Unit', 'Reorder At', 'Avg Cost', 'Value', 'Status', 'Location']
  const tableRows = (fmt: (n: number) => string | number) =>
    rows.map((i) => [
      i.name,
      i.category,
      qty(i.stock),
      i.unit,
      qty(i.reorderLevel),
      fmt(i.avgCost),
      fmt(i.value),
      i.active ? STATUS_META[i.status].label : 'Archived',
      i.location || '',
    ])

  return (
    <div className="space-y-3">
      <TableControls
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Item, category, location…"
        filters={[
          { key: 'category', label: 'Category', options: [...new Set(items.map((i) => i.category))].sort().map((c) => ({ value: c, label: c })) },
          {
            key: 'status',
            label: 'Status',
            options: [
              { value: 'OK', label: 'In Stock' },
              { value: 'LOW', label: 'Low Stock' },
              { value: 'OUT', label: 'Out of Stock' },
              ...(showArchived ? [{ value: 'ARCHIVED', label: 'Archived' }] : []),
            ],
          },
        ]}
        filterValues={{ category, status }}
        onFilterChange={(k, v) => (k === 'category' ? setCategory(v) : setStatus(v))}
        onReset={() => {
          setSearch('')
          setCategory('ALL')
          setStatus('ALL')
        }}
        onExport={() => exportCSV('inventory-stock.csv', headers, tableRows((n) => n))}
        onPrint={() =>
          printTableReport(
            'Inventory Stock',
            headers,
            tableRows((n) => formatINR(n)),
            `${rows.length} items · Stock value ${formatINR(rows.reduce((s, i) => s + (i.active ? i.value : 0), 0))} · ${formatDateTime(new Date())}`
          )
        }
      >
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={showArchived} onCheckedChange={onShowArchived} aria-label="Show archived items" />
          Show archived
        </label>
      </TableControls>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableTh label="Item" sortKey="name" sort={sort} onToggle={toggle} />
              <SortableTh label="Category" sortKey="category" sort={sort} onToggle={toggle} />
              <SortableTh label="In Stock" sortKey="stock" sort={sort} onToggle={toggle} className="text-right" />
              <TableHead className="text-right">Reorder At</TableHead>
              <SortableTh label="Avg Cost" sortKey="avgCost" sort={sort} onToggle={toggle} className="text-right" />
              <SortableTh label="Value" sortKey="value" sort={sort} onToggle={toggle} className="text-right" />
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center">
                  {items.length === 0 ? (
                    <div className="space-y-2">
                      <PackageX className="mx-auto h-8 w-8 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">No inventory items yet.</p>
                      <Button size="sm" className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onAdd}>
                        <Plus className="h-4 w-4" /> Add your first item
                      </Button>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No items match the filters.</p>
                  )}
                </TableCell>
              </TableRow>
            )}
            {paged.map((i) => (
              <TableRow key={i.id} className={!i.active ? 'opacity-60' : i.status === 'OUT' ? 'bg-red-50/60 dark:bg-red-950/20' : ''}>
                <TableCell>
                  <div className="font-semibold">{i.name}</div>
                  {i.location && <div className="text-[11px] text-muted-foreground">{i.location}</div>}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs">{i.category}</TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <span className="font-bold">{qty(i.stock)}</span> <span className="text-xs text-muted-foreground">{i.unit}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                  {i.reorderLevel > 0 ? `${qty(i.reorderLevel)} ${i.unit}` : '—'}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-xs">{formatINR(i.avgCost)}</TableCell>
                <TableCell className="whitespace-nowrap text-right text-sm font-semibold">{formatINR(i.value)}</TableCell>
                <TableCell>
                  {i.active ? (
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_META[i.status].cls}`}>
                      {STATUS_META[i.status].label}
                    </span>
                  ) : (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">Archived</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    {i.active ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 border-emerald-300 px-2 text-xs text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                          onClick={() => onEntry('PURCHASE', i)}
                        >
                          <ArrowDownToLine className="h-3 w-3" /> In
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-xs"
                          disabled={i.stock <= 0}
                          onClick={() => onEntry('ISSUE', i)}
                        >
                          <ArrowUpFromLine className="h-3 w-3" /> Use
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={`More actions for ${i.name}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem disabled={i.stock <= 0} onClick={() => onEntry('WASTAGE', i)}>
                              <Trash2 className="h-4 w-4" /> Record wastage
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onEntry('ADJUSTMENT', i)}>
                              <ClipboardCheck className="h-4 w-4" /> Stock count correction
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onHistory(i)}>
                              <History className="h-4 w-4" /> View history
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onEdit(i)}>
                              <Pencil className="h-4 w-4" /> Edit item
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-red-600 focus:text-red-700" onClick={() => onDelete(i)}>
                              <Trash2 className="h-4 w-4" /> Delete item
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-xs" onClick={() => onHistory(i)}>
                          <History className="h-3 w-3" /> History
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-xs" onClick={() => onRestore(i)}>
                          <RotateCcw className="h-3 w-3" /> Restore
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {controls}
    </div>
  )
}

// ============ Add / edit item ============

function ItemDialog({
  open,
  item,
  categories,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  item: InventoryItem | null
  categories: string[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {open && <ItemForm key={item?.id || 'new'} item={item} categories={categories} onDone={() => onOpenChange(false)} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function ItemForm({
  item,
  categories,
  onDone,
  onSaved,
}: {
  item: InventoryItem | null
  categories: string[]
  onDone: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(item?.name || '')
  const [category, setCategory] = useState(item?.category || CATEGORIES[0])
  const [unit, setUnit] = useState(item?.unit || 'pcs')
  const [reorderLevel, setReorderLevel] = useState(item ? String(item.reorderLevel) : '')
  const [location, setLocation] = useState(item?.location || '')
  const [notes, setNotes] = useState(item?.notes || '')
  const [openingStock, setOpeningStock] = useState('')
  const [openingCost, setOpeningCost] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Item name is required')
    setSaving(true)
    setError('')
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        category: category.trim() || 'Other',
        unit: unit.trim() || 'pcs',
        reorderLevel: reorderLevel || 0,
        location: location.trim(),
        notes: notes.trim(),
      }
      if (item) body.id = item.id
      else {
        body.openingStock = openingStock || 0
        body.openingCost = openingCost || 0
      }
      await apiAs('/api/inventory', getCachedUser(), { method: item ? 'PATCH' : 'POST', body: JSON.stringify(body) })
      toast({ title: item ? 'Item updated' : 'Item added', description: name.trim() })
      onSaved()
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <DialogHeader>
        <DialogTitle>{item ? 'Edit Item' : 'Add Inventory Item'}</DialogTitle>
        <DialogDescription>
          {item ? 'Stock changes only through Stock In, Use, Wastage or a count correction.' : 'Add anything the hotel keeps in stock.'}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="inv-name">Item Name *</Label>
        <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bath Towel, Toilet Soap, Rice" autoFocus />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="inv-cat">Category</Label>
          <Input id="inv-cat" list="inv-categories" value={category} onChange={(e) => setCategory(e.target.value)} />
          <datalist id="inv-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-unit">Unit</Label>
          <Input id="inv-unit" list="inv-units" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <datalist id="inv-units">
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-reorder">Reorder Level ({unit || 'units'})</Label>
          <Input id="inv-reorder" type="number" min="0" step="any" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} placeholder="Alert at or below" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="inv-loc">Location</Label>
          <Input id="inv-loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Store room, kitchen…" />
        </div>
      </div>
      {!item && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="space-y-1.5">
            <Label htmlFor="inv-open">Opening Stock</Label>
            <Input id="inv-open" type="number" min="0" step="any" value={openingStock} onChange={(e) => setOpeningStock(e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="inv-open-cost">Cost / {unit || 'unit'} (₹)</Label>
            <Input id="inv-open-cost" type="number" min="0" step="any" value={openingCost} onChange={(e) => setOpeningCost(e.target.value)} placeholder="0" />
          </div>
          <p className="col-span-2 text-[11px] text-muted-foreground">
            Stock already on the shelf. It is not added to Expenses; record new purchases with Stock In.
          </p>
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="inv-notes">Notes</Label>
        <Input id="inv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Brand, size, supplier…" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-700">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} {item ? 'Save Changes' : 'Add Item'}
        </Button>
      </div>
    </form>
  )
}

// ============ Stock entry (in / use / wastage / count) ============

const ENTRY_TABS: { type: EntryType; label: string }[] = [
  { type: 'PURCHASE', label: 'Stock In' },
  { type: 'ISSUE', label: 'Use' },
  { type: 'WASTAGE', label: 'Wastage' },
  { type: 'ADJUSTMENT', label: 'Count Fix' },
]

function EntryDialog({
  open,
  items,
  initialItem,
  initialType,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  items: InventoryItem[]
  initialItem: InventoryItem | null
  initialType: EntryType
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const [type, setType] = useState<EntryType>(initialType)
  const [itemId, setItemId] = useState(initialItem?.id || '')
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState(initialItem && initialItem.avgCost > 0 ? String(initialItem.avgCost) : '')
  const [counted, setCounted] = useState('')
  const [vendor, setVendor] = useState('')
  const [reference, setReference] = useState('')
  const [method, setMethod] = useState('CASH')
  const [recordExpense, setRecordExpense] = useState(true)
  const [department, setDepartment] = useState('Housekeeping')
  const [roomNumber, setRoomNumber] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const item = items.find((i) => i.id === itemId) || null
  const q = parseFloat(quantity) || 0
  const cost = parseFloat(unitCost) || 0
  const countedN = counted === '' ? NaN : parseFloat(counted)
  const diff = item && Number.isFinite(countedN) ? Math.round((countedN - item.stock) * 1000) / 1000 : 0
  const outType = type === 'ISSUE' || type === 'WASTAGE'
  const tooMuch = !!item && outType && q > item.stock + 0.0005

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!item) return setError('Select an item')
    if (type === 'ADJUSTMENT') {
      if (!Number.isFinite(countedN) || countedN < 0) return setError('Enter the counted stock')
      if (diff === 0) return setError('Counted stock matches the system stock')
      if (!note.trim()) return setError('Give a reason for the correction')
    } else {
      if (q <= 0) return setError('Enter a quantity more than 0')
      if (tooMuch) return setError(`Only ${qty(item.stock)} ${item.unit} in stock`)
      if (type === 'WASTAGE' && !note.trim()) return setError('Give a reason for the wastage')
    }

    let adminPin: string | undefined
    if (type === 'ADJUSTMENT') {
      const pin = await askAdminPin(
        `Stock count correction: ${item.name} ${qty(item.stock)} → ${qty(countedN)} ${item.unit}. Enter the Admin PIN to approve.`
      )
      if (!pin) return
      adminPin = pin
    }

    setSaving(true)
    setError('')
    try {
      await apiAs('/api/inventory-movements', getCachedUser(), {
        method: 'POST',
        adminPin,
        body: JSON.stringify({
          itemId: item.id,
          type,
          quantity: q,
          unitCost: cost,
          countedStock: countedN,
          vendor: vendor.trim(),
          reference: reference.trim(),
          method,
          recordExpense,
          department,
          roomNumber: roomNumber.trim(),
          note: note.trim(),
        }),
      })
      const done =
        type === 'PURCHASE'
          ? `${qty(q)} ${item.unit} added to ${item.name}`
          : type === 'ADJUSTMENT'
            ? `${item.name} corrected to ${qty(countedN)} ${item.unit}`
            : `${qty(q)} ${item.unit} of ${item.name} ${type === 'ISSUE' ? 'used' : 'written off'}`
      toast({ title: 'Stock updated', description: done })
      onSaved()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="space-y-3">
          <DialogHeader>
            <DialogTitle>Stock Entry</DialogTitle>
            <DialogDescription>
              {type === 'PURCHASE' && 'Goods received from a supplier.'}
              {type === 'ISSUE' && 'Stock taken out for use.'}
              {type === 'WASTAGE' && 'Damaged, expired or lost stock.'}
              {type === 'ADJUSTMENT' && 'Set the stock to what was physically counted (Admin PIN needed).'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label="Entry type">
            {ENTRY_TABS.map((t) => (
              <button
                key={t.type}
                type="button"
                role="tab"
                aria-selected={type === t.type}
                onClick={() => {
                  setType(t.type)
                  setError('')
                }}
                className={`rounded-md px-1 py-1.5 text-xs font-medium transition ${
                  type === t.type ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label>Item *</Label>
            <Select
              value={itemId}
              onValueChange={(v) => {
                setItemId(v)
                const it = items.find((i) => i.id === v)
                if (it && it.avgCost > 0 && !unitCost) setUnitCost(String(it.avgCost))
              }}
            >
              <SelectTrigger className="w-full" aria-label="Item">
                <SelectValue placeholder="Select an item" />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name} — {qty(i.stock)} {i.unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {item && (
              <p className="text-[11px] text-muted-foreground">
                In stock: <b className="text-foreground">{qty(item.stock)} {item.unit}</b> · Avg cost {formatINR(item.avgCost)}/{item.unit}
              </p>
            )}
          </div>

          {type === 'ADJUSTMENT' ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ent-count">Counted Stock *</Label>
                <Input id="ent-count" type="number" min="0" step="any" value={counted} onChange={(e) => setCounted(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Difference</Label>
                <div
                  className={`flex h-9 items-center rounded-md border px-3 text-sm font-semibold ${
                    diff > 0 ? 'text-emerald-700 dark:text-emerald-400' : diff < 0 ? 'text-red-600' : 'text-muted-foreground'
                  }`}
                >
                  {diff > 0 ? '+' : ''}
                  {qty(diff)} {item?.unit || ''}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ent-qty">Quantity{item ? ` (${item.unit})` : ''} *</Label>
                <Input
                  id="ent-qty"
                  type="number"
                  min="0"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  aria-invalid={tooMuch}
                />
                {tooMuch && <p className="text-[11px] text-red-600">More than in stock</p>}
              </div>
              {type === 'PURCHASE' ? (
                <div className="space-y-1.5">
                  <Label htmlFor="ent-cost">Cost / {item?.unit || 'unit'} (₹)</Label>
                  <Input id="ent-cost" type="number" min="0" step="any" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label>Value</Label>
                  <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{formatINR(q * (item?.avgCost || 0))}</div>
                </div>
              )}
            </div>
          )}

          {type === 'PURCHASE' && (
            <>
              <div className="flex items-center justify-between rounded-md bg-emerald-50 px-3 py-2 text-sm dark:bg-emerald-950/40">
                <span>Total</span>
                <b>{formatINR(q * cost)}</b>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="ent-vendor">Supplier</Label>
                  <Input id="ent-vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Shop / supplier name" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ent-ref">Bill No.</Label>
                  <Input id="ent-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={recordExpense} onCheckedChange={setRecordExpense} aria-label="Add to Expenses" />
                  Add to Expenses
                </label>
                {recordExpense && (
                  <Select value={method} onValueChange={setMethod}>
                    <SelectTrigger className="h-8 w-28 text-xs" aria-label="Payment mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PAY_MODES.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="w-full text-[11px] text-muted-foreground">
                  {recordExpense
                    ? 'Recorded in Expenses under INVENTORY with this payment mode.'
                    : 'Turn off if this purchase is already entered in Expenses or was not paid by the hotel.'}
                </p>
              </div>
            </>
          )}

          {type === 'ISSUE' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Used For</Label>
                <Select value={department} onValueChange={setDepartment}>
                  <SelectTrigger className="w-full" aria-label="Used for">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ent-room">Room No.</Label>
                <Input id="ent-room" value={roomNumber} onChange={(e) => setRoomNumber(e.target.value.replace(/[^\dA-Za-z-]/g, ''))} placeholder="Optional" />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="ent-note">
              {type === 'WASTAGE' || type === 'ADJUSTMENT' ? 'Reason *' : 'Note'}
            </Label>
            <Input
              id="ent-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                type === 'WASTAGE' ? 'e.g. Torn, expired, broken' : type === 'ADJUSTMENT' ? 'e.g. Monthly stock count' : 'Optional'
              }
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !item} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ============ History ============

function MovementHistory({
  items,
  itemId,
  onItemId,
  onChanged,
}: {
  items: InventoryItem[]
  itemId: string
  onItemId: (id: string) => void
  onChanged: () => void
}) {
  const [rows, setRows] = useState<Movement[]>([])
  const [loading, setLoading] = useState(true)
  const [type, setType] = useState('ALL')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [deleting, setDeleting] = useState<Movement | null>(null)

  useEffect(() => {
    const params = new URLSearchParams()
    if (itemId !== 'ALL') params.set('itemId', itemId)
    if (type !== 'ALL') params.set('type', type)
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    let alive = true
    apiAs<Movement[]>(`/api/inventory-movements?${params}`, getCachedUser())
      .then((data) => alive && setRows(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [itemId, type, from, to])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((m) => `${m.item.name} ${movementDetails(m)} ${m.createdBy || ''}`.toLowerCase().includes(q))
  }, [rows, search])
  const { paged, controls } = usePagination(filtered, 25)

  const headers = ['Date', 'Item', 'Entry', 'Quantity', 'Unit', 'Balance', 'Value', 'Details', 'By']
  const csvRows = () =>
    filtered.map((m) => [
      formatDateTime(m.date),
      m.item.name,
      TYPE_META[m.type].label,
      (m.quantity > 0 ? '+' : '') + qty(m.quantity),
      m.item.unit,
      qty(m.balanceAfter),
      m.totalCost,
      movementDetails(m),
      m.createdBy || '',
    ])
  const totals = useMemo(() => {
    const t = { in: 0, used: 0, wasted: 0 }
    for (const m of filtered) {
      if (m.type === 'PURCHASE') t.in += m.totalCost
      if (m.type === 'ISSUE') t.used += m.totalCost
      if (m.type === 'WASTAGE') t.wasted += m.totalCost
    }
    return t
  }, [filtered])

  return (
    <div className="space-y-3">
      <TableControls
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Item, supplier, room, note…"
        filters={[
          {
            key: 'item',
            label: 'Item',
            options: items.map((i) => ({ value: i.id, label: i.name })),
          },
          {
            key: 'type',
            label: 'Entry',
            options: (Object.keys(TYPE_META) as MovementType[]).map((t) => ({ value: t, label: TYPE_META[t].label })),
          },
        ]}
        filterValues={{ item: itemId, type }}
        onFilterChange={(k, v) => (k === 'item' ? onItemId(v) : setType(v))}
        onReset={() => {
          onItemId('ALL')
          setType('ALL')
          setFrom('')
          setTo('')
          setSearch('')
        }}
        onExport={() => exportCSV('inventory-history.csv', headers, csvRows())}
        onPrint={() =>
          printTableReport(
            'Inventory Stock History',
            headers,
            csvRows().map((r) => {
              r[6] = formatINR(Number(r[6]))
              return r
            }),
            `${filtered.length} entries${from || to ? ` · ${from ? formatDate(from) : '…'} to ${to ? formatDate(to) : '…'}` : ''}`
          )
        }
      >
        <div className="flex items-center gap-1.5">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[145px] text-xs" aria-label="From date" />
          <span className="text-xs font-medium text-muted-foreground">to</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[145px] text-xs" aria-label="To date" />
        </div>
      </TableControls>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-lg bg-emerald-50 px-3 py-1.5 dark:bg-emerald-950/40">
          Purchased: <b>{formatINR(totals.in)}</b>
        </span>
        <span className="rounded-lg bg-amber-50 px-3 py-1.5 dark:bg-amber-950/40">
          Used: <b>{formatINR(totals.used)}</b>
        </span>
        <span className="rounded-lg bg-red-50 px-3 py-1.5 dark:bg-red-950/40">
          Wasted: <b>{formatINR(totals.wasted)}</b>
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Entry</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right">Value</TableHead>
              <TableHead>Details</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-emerald-600" />
                </TableCell>
              </TableRow>
            )}
            {!loading && paged.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  No stock entries found.
                </TableCell>
              </TableRow>
            )}
            {paged.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="whitespace-nowrap text-xs">
                  {formatDateTime(m.date)}
                  {m.createdBy && <div className="text-[10px] text-muted-foreground">by {m.createdBy}</div>}
                </TableCell>
                <TableCell className="font-medium">{m.item.name}</TableCell>
                <TableCell>
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TYPE_META[m.type].cls}`}>
                    {TYPE_META[m.type].label}
                  </span>
                </TableCell>
                <TableCell
                  className={`whitespace-nowrap text-right font-bold ${
                    m.quantity > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {m.quantity > 0 ? '+' : ''}
                  {qty(m.quantity)} <span className="text-xs font-normal text-muted-foreground">{m.item.unit}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-xs">{qty(m.balanceAfter)}</TableCell>
                <TableCell className="whitespace-nowrap text-right text-xs">{formatINR(m.totalCost)}</TableCell>
                <TableCell className="min-w-[180px] max-w-[320px] text-xs text-muted-foreground">{movementDetails(m) || '—'}</TableCell>
                <TableCell className="text-right">
                  {m.isLatest ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                      onClick={() => setDeleting(m)}
                    >
                      <Trash2 className="h-3 w-3" /> Undo
                    </Button>
                  ) : (
                    <span className="text-[10px] text-muted-foreground" title="Only the latest entry of an item can be undone">
                      —
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {controls}
      <p className="text-[11px] text-muted-foreground">
        Only the latest entry of each item can be undone, so every running balance stays correct. To fix an older mistake, use a
        stock count correction.
      </p>

      <AdminDeleteDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Undo Stock Entry"
        itemType="Stock entry"
        itemName={
          deleting
            ? `${TYPE_META[deleting.type].label}: ${deleting.quantity > 0 ? '+' : ''}${qty(deleting.quantity)} ${deleting.item.unit} ${deleting.item.name}`
            : ''
        }
        warningNotice={
          deleting?.expenseRecorded
            ? 'The stock goes back to what it was before this entry, and its expense is removed from Expenses.'
            : 'The stock goes back to what it was before this entry.'
        }
        onConfirm={async (adminPin) => {
          if (!deleting) return
          await apiAs(`/api/inventory-movements?id=${deleting.id}`, getCachedUser(), { method: 'DELETE', adminPin })
          toast({ title: 'Entry undone', description: `${deleting.item.name} stock restored.` })
          setDeleting(null)
          onChanged()
        }}
      />
    </div>
  )
}

// ============ Report ============

function StockReport({ refreshKey }: { refreshKey: number }) {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayStr())
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [onlyActive, setOnlyActive] = useState(false)

  useEffect(() => {
    let alive = true
    const params = new URLSearchParams()
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    apiAs<Report>(`/api/inventory-report?${params}`, getCachedUser())
      .then((r) => alive && setReport(r))
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [from, to, refreshKey])

  const rows = useMemo(
    () =>
      (report?.rows || []).filter(
        (r) => !onlyActive || r.purchasedQty || r.usedQty || r.wastedQty || r.adjustedQty
      ),
    [report, onlyActive]
  )
  const headers = ['Item', 'Unit', 'Opening', 'In', 'In ₹', 'Used', 'Used ₹', 'Wasted', 'Wasted ₹', 'Correction', 'Closing', 'Value ₹']
  const csvRows = (fmt: (n: number) => string | number) =>
    rows.map((r) => [
      r.name,
      r.unit,
      qty(r.opening),
      qty(r.purchasedQty),
      fmt(r.purchasedCost),
      qty(r.usedQty),
      fmt(r.usedCost),
      qty(r.wastedQty),
      fmt(r.wastedCost),
      (r.adjustedQty > 0 ? '+' : '') + qty(r.adjustedQty),
      qty(r.closing),
      fmt(r.closingValue),
    ])
  const period = `${from ? formatDate(from) : 'Start'} to ${to ? formatDate(to) : 'today'}`

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-[145px] text-xs" aria-label="From date" />
          <span className="text-xs font-medium text-muted-foreground">to</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-[145px] text-xs" aria-label="To date" />
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={onlyActive} onCheckedChange={setOnlyActive} aria-label="Only items with activity" />
          Only items with activity
        </label>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => exportCSV('inventory-report.csv', headers, csvRows((n) => n))}>
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              printTableReport(
                'Inventory Stock Report',
                headers,
                csvRows((n) => formatINR(n)),
                `${period} · Purchased ${formatINR(report?.totals.purchasedCost)} · Used ${formatINR(report?.totals.usedCost)} · Wasted ${formatINR(report?.totals.wastedCost)}`
              )
            }
          >
            Print
          </Button>
        </div>
      </div>

      {report && (
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <div className="rounded-lg border bg-emerald-50 p-2.5 dark:bg-emerald-950/30">
            Purchased<div className="text-base font-bold">{formatINR(report.totals.purchasedCost)}</div>
          </div>
          <div className="rounded-lg border bg-amber-50 p-2.5 dark:bg-amber-950/30">
            Used<div className="text-base font-bold">{formatINR(report.totals.usedCost)}</div>
          </div>
          <div className="rounded-lg border bg-red-50 p-2.5 dark:bg-red-950/30">
            Wasted<div className="text-base font-bold">{formatINR(report.totals.wastedCost)}</div>
          </div>
          <div className="rounded-lg border bg-sky-50 p-2.5 dark:bg-sky-950/30">
            Closing stock value<div className="text-base font-bold">{formatINR(report.totals.closingValue)}</div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">In</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Wasted</TableHead>
              <TableHead className="text-right">Correction</TableHead>
              <TableHead className="text-right">Closing</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-emerald-600" />
                </TableCell>
              </TableRow>
            )}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                  Nothing to report for {period}.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.itemId}>
                <TableCell>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {r.category} · {r.unit}
                  </div>
                </TableCell>
                <TableCell className="text-right text-xs">{qty(r.opening)}</TableCell>
                <TableCell className="whitespace-nowrap text-right text-xs">
                  {r.purchasedQty ? (
                    <>
                      <b className="text-emerald-700 dark:text-emerald-400">+{qty(r.purchasedQty)}</b>
                      <div className="text-[10px] text-muted-foreground">{formatINR(r.purchasedCost)}</div>
                    </>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-xs">
                  {r.usedQty ? (
                    <>
                      <b>{qty(r.usedQty)}</b>
                      <div className="text-[10px] text-muted-foreground">{formatINR(r.usedCost)}</div>
                    </>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-xs">
                  {r.wastedQty ? (
                    <>
                      <b className="text-red-600">{qty(r.wastedQty)}</b>
                      <div className="text-[10px] text-muted-foreground">{formatINR(r.wastedCost)}</div>
                    </>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell className="text-right text-xs">
                  {r.adjustedQty ? `${r.adjustedQty > 0 ? '+' : ''}${qty(r.adjustedQty)}` : '—'}
                </TableCell>
                <TableCell className="text-right text-sm font-bold">{qty(r.closing)}</TableCell>
                <TableCell className="whitespace-nowrap text-right text-xs">{formatINR(r.closingValue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Opening and closing are the stock at the start and end of the period. Used and wasted are valued at the average cost when
        they were taken out; the closing value uses today&apos;s average cost.
      </p>
    </div>
  )
}
