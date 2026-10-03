'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, formatINR, formatDate, formatDateTime, todayStr } from '@/lib/hotel-utils'
import { Loader2, Plus, TrendingUp, TrendingDown, Wallet, Scale } from 'lucide-react'

interface LedgerEntry {
  id: string
  date: string
  type: string
  category: string
  description: string
  amount: number
  method: string
  source: string
}

const EXPENSE_CATEGORIES = ['SALARY', 'PURCHASE', 'UTILITIES', 'MAINTENANCE', 'STAFF', 'OTHER']
const INCOME_CATEGORIES = ['ROOM_RENT', 'FOOD', 'ADVANCE', 'GST', 'OTHER']

export function LedgerTab({ refreshKey, onDataChanged }: { refreshKey: number; onDataChanged: () => void }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([])
  const [summary, setSummary] = useState({ totalIncome: 0, totalExpense: 0, net: 0 })
  const [date, setDate] = useState(todayStr())
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)

  // form
  const [fType, setFType] = useState('EXPENSE')
  const [fCategory, setFCategory] = useState('PURCHASE')
  const [fDesc, setFDesc] = useState('')
  const [fAmount, setFAmount] = useState('')
  const [fMethod, setFMethod] = useState('CASH')
  const [fDate, setFDate] = useState(todayStr())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (date) params.set('date', date)
      if (typeFilter !== 'ALL') params.set('type', typeFilter)
      const data = await api<{ entries: LedgerEntry[]; totalIncome: number; totalExpense: number; net: number }>(
        `/api/ledger?${params.toString()}`
      )
      setEntries(Array.isArray(data?.entries) ? data.entries : [])
      setSummary({
        totalIncome: Number(data?.totalIncome) || 0,
        totalExpense: Number(data?.totalExpense) || 0,
        net: Number(data?.net) || 0,
      })
    } finally {
      setLoading(false)
    }
  }, [date, typeFilter])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  async function addEntry() {
    if (!fDesc.trim() || !fAmount) {
      setError('Description and amount required')
      return
    }
    setSaving(true)
    setError('')
    try {
      await api('/api/ledger', {
        method: 'POST',
        body: JSON.stringify({
          type: fType,
          category: fCategory,
          description: fDesc.trim(),
          amount: fAmount,
          method: fMethod,
          date: fDate,
        }),
      })
      setFDesc('')
      setFAmount('')
      setAddOpen(false)
      await load()
      onDataChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  function changeType(v: string) {
    setFType(v)
    setFCategory(v === 'INCOME' ? 'ROOM_RENT' : 'PURCHASE')
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-2.5">
        <Card className="border-emerald-200">
          <CardContent className="p-3.5">
            <div className="flex items-center gap-1.5 text-emerald-700">
              <TrendingUp className="h-4 w-4" />
              <p className="text-[11px] font-medium">Income</p>
            </div>
            <p className="mt-1 text-lg font-bold">{formatINR(summary.totalIncome)}</p>
          </CardContent>
        </Card>
        <Card className="border-red-200">
          <CardContent className="p-3.5">
            <div className="flex items-center gap-1.5 text-red-700">
              <TrendingDown className="h-4 w-4" />
              <p className="text-[11px] font-medium">Expense</p>
            </div>
            <p className="mt-1 text-lg font-bold">{formatINR(summary.totalExpense)}</p>
          </CardContent>
        </Card>
        <Card className={summary.net >= 0 ? 'border-teal-200' : 'border-red-200'}>
          <CardContent className="p-3.5">
            <div className="flex items-center gap-1.5 text-teal-700">
              <Scale className="h-4 w-4" />
              <p className="text-[11px] font-medium">Net</p>
            </div>
            <p className={`mt-1 text-lg font-bold ${summary.net < 0 ? 'text-red-600' : ''}`}>{formatINR(summary.net)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters + add */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-2.5 p-4">
          <div className="space-y-1">
            <Label className="text-xs">Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-9 w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="INCOME">Income</SelectItem>
                <SelectItem value="EXPENSE">Expense</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            onClick={() => {
              setDate('')
              setTypeFilter('ALL')
            }}
          >
            Clear
          </Button>
          <Button
            className="ml-auto h-9 bg-emerald-600 hover:bg-emerald-700"
            size="sm"
            onClick={() => {
              setAddOpen(true)
              setFDate(date || todayStr())
              setError('')
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Add Entry
          </Button>
        </CardContent>
      </Card>

      {/* Entries */}
      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-7 w-7 animate-spin text-emerald-600" />
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed py-10 text-center text-sm text-muted-foreground">
          <Wallet className="mx-auto mb-2 h-7 w-7 opacity-30" />
          No ledger entries for this day.
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <Card key={e.id}>
              <CardContent className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      className={
                        e.type === 'INCOME' ? 'bg-emerald-600 text-[9px]' : 'bg-red-500 text-[9px]'
                      }
                    >
                      {e.category.replace('_', ' ')}
                    </Badge>
                    <span className="text-sm font-medium">{e.description}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatDateTime(e.date)} • {e.method} • {e.source === 'AUTO' ? 'Auto (billing)' : 'Manual'}
                  </p>
                </div>
                <p className={`shrink-0 text-sm font-bold ${e.type === 'INCOME' ? 'text-emerald-700' : 'text-red-600'}`}>
                  {e.type === 'INCOME' ? '+' : '-'}
                  {formatINR(e.amount)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add entry dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Ledger Entry</DialogTitle>
            <DialogDescription>Manual income or expense record</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={fType} onValueChange={changeType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="INCOME">Income</SelectItem>
                    <SelectItem value="EXPENSE">Expense</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={fCategory} onValueChange={setFCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(fType === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => (
                      <SelectItem key={c} value={c}>
                        {c.replace('_', ' ')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description *</Label>
              <Input value={fDesc} onChange={(e) => setFDesc(e.target.value)} placeholder="e.g. Grocery purchase" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount (₹) *</Label>
                <Input type="number" value={fAmount} onChange={(e) => setFAmount(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Method</Label>
                <Select value={fMethod} onValueChange={setFMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="UPI">UPI</SelectItem>
                    <SelectItem value="CARD">Card</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={addEntry} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Entry
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
