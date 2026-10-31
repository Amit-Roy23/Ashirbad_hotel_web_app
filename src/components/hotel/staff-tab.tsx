'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, apiAs, addDays, formatINR, formatDate, formatDateTime, exportCSV, printTableReport, sanitizePhone, matchesSearch, todayStr } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { toast } from '@/hooks/use-toast'
import {
  CalendarCheck,
  Download,
  HandCoins,
  History,
  Loader2,
  Pencil,
  Phone,
  Plus,
  Printer,
  Search,
  Trash2,
  UserRound,
  Wallet,
} from 'lucide-react'
import { AdminDeleteDialog } from './admin-delete-dialog'

// ============ Types ============

interface StaffPayment {
  id: string
  type: 'SALARY' | 'ADVANCE' | 'ADVANCE_RETURN' | 'BONUS' | 'DEDUCTION' | string
  amount: number
  gross: number
  recovered: number
  deduction: number
  period?: string | null
  days: number
  method: string
  date: string
  recoveryNotes?: string | null
  notes?: string | null
}

interface WorkDay {
  id: string
  date: string
  units: number
  paymentId?: string | null
}

interface Summary {
  advanceGiven: number
  advanceRecovered: number
  advanceReturned: number
  advanceOutstanding: number
  salaryNetPaid: number
  salaryEarnedPaid: number
  bonusPaid: number
  deductions: number
  totalPaidOut: number
  unpaidDays: number
  unpaidAmount: number
  currentPeriod: string
  thisMonthPaid: number
  thisMonthDue: number
}

interface Staff {
  id: string
  name: string
  phone?: string | null
  role: string
  payType: 'MONTHLY' | 'DAILY' | string
  salary: number
  dailyRate: number
  joinDate: string
  address?: string | null
  aadhaar?: string | null
  active: boolean
  payments: StaffPayment[]
  workDays: WorkDay[]
  summary: Summary
}

interface AuditRow {
  id: string
  action: string
  details?: string | null
  userName?: string | null
  createdAt: string
}

const ROLES = ['Manager', 'Reception', 'Housekeeping', 'Chef', 'Kitchen Helper', 'Waiter', 'Guard', 'Accountant', 'Driver', 'Other']
const MODES = [
  ['CASH', 'Cash'],
  ['UPI', 'UPI'],
  ['CARD', 'Card'],
  ['BANK', 'Bank Transfer'],
]
const TYPE_LABEL: Record<string, string> = {
  SALARY: 'Salary',
  ADVANCE: 'Advance given',
  ADVANCE_RETURN: 'Advance returned',
  BONUS: 'Bonus',
  DEDUCTION: 'Fine / deduction',
}

function periodLabel(period?: string | null) {
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return period || ''
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

const payBasis = (s: Staff) => (s.payType === 'DAILY' ? `${formatINR(s.dailyRate)} / day` : `${formatINR(s.salary)} / month`)

// ============ Main tab ============

export function StaffTab({ refreshKey, onDataChanged }: { refreshKey: number; onDataChanged: () => void }) {
  const [staff, setStaff] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('ALL')
  const [basisFilter, setBasisFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ACTIVE')

  const [form, setForm] = useState<{ open: boolean; staff: Staff | null }>({ open: false, staff: null })
  const [salaryFor, setSalaryFor] = useState<Staff | null>(null)
  const [moneyFor, setMoneyFor] = useState<{ staff: Staff; type: string } | null>(null)
  const [daysFor, setDaysFor] = useState<Staff | null>(null)
  const [historyFor, setHistoryFor] = useState<Staff | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Staff | null>(null)

  useEffect(() => {
    let alive = true
    api<Staff[]>('/api/staff')
      .then((rows) => alive && setStaff(Array.isArray(rows) ? rows : []))
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [refreshKey])

  // Keep open dialogs on the latest data after a save
  const fresh = (s: Staff | null) => (s ? staff.find((x) => x.id === s.id) || s : null)

  const filtered = useMemo(
    () =>
      staff.filter((s) => {
        if (!matchesSearch(search, [s.name, s.role], [s.phone])) return false
        if (roleFilter !== 'ALL' && s.role !== roleFilter) return false
        if (basisFilter !== 'ALL' && s.payType !== basisFilter) return false
        if (statusFilter === 'ACTIVE' && !s.active) return false
        if (statusFilter === 'INACTIVE' && s.active) return false
        if (statusFilter === 'ADVANCE' && s.summary.advanceOutstanding <= 0) return false
        return true
      }),
    [staff, search, roleFilter, basisFilter, statusFilter]
  )

  const active = staff.filter((s) => s.active)
  const monthlyPayroll = active.filter((s) => s.payType !== 'DAILY').reduce((t, s) => t + s.salary, 0)
  const advanceOut = staff.reduce((t, s) => t + s.summary.advanceOutstanding, 0)
  const dayWagesDue = staff.reduce((t, s) => t + s.summary.unpaidAmount, 0)
  const monthDue = active.reduce((t, s) => t + s.summary.thisMonthDue, 0)

  const headers = ['Name', 'Phone', 'Role', 'Pay', 'Joined', 'Status', 'Advance Outstanding', 'Salary Paid (net)', 'This Month Due', 'Unpaid Day Wages']
  const rows = (fmt: (n: number) => string | number) =>
    filtered.map((s) => [
      s.name,
      s.phone || '',
      s.role,
      payBasis(s),
      formatDate(s.joinDate),
      s.active ? 'Active' : 'Inactive',
      fmt(s.summary.advanceOutstanding),
      fmt(s.summary.salaryNetPaid),
      fmt(s.summary.thisMonthDue),
      fmt(s.summary.unpaidAmount),
    ])

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Staff</h2>
          <p className="text-xs text-muted-foreground">Salaries, day wages, advances and full payment history</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={() => exportCSV('staff.csv', headers, rows((n) => n))}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() =>
              printTableReport(
                'Staff & Payroll',
                headers,
                rows((n) => formatINR(n)),
                `Active staff ${active.length} · Monthly payroll ${formatINR(monthlyPayroll)} · Advance outstanding ${formatINR(advanceOut)}`
              )
            }
          >
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
          <Button className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => setForm({ open: true, staff: null })}>
            <Plus className="h-4 w-4" /> Add Staff
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Active staff', String(active.length), `${active.filter((s) => s.payType === 'DAILY').length} on day basis`],
          ['Monthly payroll', formatINR(monthlyPayroll), `${formatINR(monthDue)} still due this month`],
          ['Advance outstanding', formatINR(advanceOut), 'to recover from salaries'],
          ['Day wages unpaid', formatINR(dayWagesDue), 'for days already worked'],
        ].map(([label, value, sub]) => (
          <Card key={label}>
            <CardContent className="p-3 sm:p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-xl font-bold">{value}</p>
              <p className="text-[10px] text-muted-foreground">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, role, phone (5+ digits)…" className="pl-8" aria-label="Search staff" />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-9 w-[140px]" aria-label="Role filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Roles</SelectItem>
            {[...new Set([...ROLES, ...staff.map((s) => s.role)])].map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={basisFilter} onValueChange={setBasisFilter}>
          <SelectTrigger className="h-9 w-[140px]" aria-label="Pay basis filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Monthly + Daily</SelectItem>
            <SelectItem value="MONTHLY">Monthly salary</SelectItem>
            <SelectItem value="DAILY">Day basis</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Status filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
            <SelectItem value="ADVANCE">With advance due</SelectItem>
            <SelectItem value="ALL">All staff</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No staff match the filters.</p>}

      <div className="grid gap-3 xl:grid-cols-2">
        {filtered.map((s) => {
          const sm = s.summary
          const last = s.payments[0]
          return (
            <Card key={s.id} className={!s.active ? 'opacity-60' : ''}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="rounded-full bg-emerald-100 p-2 dark:bg-emerald-900">
                      <UserRound className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-semibold">{s.name}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {s.role}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">
                          {s.payType === 'DAILY' ? 'Day basis' : 'Monthly'}
                        </Badge>
                        {!s.active && (
                          <Badge variant="secondary" className="text-[10px]">
                            INACTIVE
                          </Badge>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        {s.phone && (
                          <a href={`tel:${s.phone}`} className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                            <Phone className="h-3 w-3" /> {s.phone}
                          </a>
                        )}
                        <span>{payBasis(s)}</span>
                        <span>Joined {formatDate(s.joinDate)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  <div className={`rounded-md p-2 ${sm.advanceOutstanding > 0 ? 'bg-orange-50 dark:bg-orange-950/40' : 'bg-muted/50'}`}>
                    <p className="text-muted-foreground">Advance due</p>
                    <p className={`font-bold ${sm.advanceOutstanding > 0 ? 'text-orange-700 dark:text-orange-400' : ''}`}>{formatINR(sm.advanceOutstanding)}</p>
                  </div>
                  {s.payType === 'DAILY' ? (
                    <div className="rounded-md bg-muted/50 p-2">
                      <p className="text-muted-foreground">Unpaid days</p>
                      <p className="font-bold">
                        {sm.unpaidDays} · {formatINR(sm.unpaidAmount)}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-md bg-muted/50 p-2">
                      <p className="text-muted-foreground">{periodLabel(sm.currentPeriod)} salary</p>
                      <p className="font-bold">{sm.thisMonthDue > 0 ? `${formatINR(sm.thisMonthDue)} due` : 'Paid'}</p>
                    </div>
                  )}
                  <div className="col-span-2 rounded-md bg-muted/50 p-2 sm:col-span-1">
                    <p className="text-muted-foreground">Total paid out</p>
                    <p className="font-bold">{formatINR(sm.totalPaidOut)}</p>
                  </div>
                </div>
                {last && (
                  <p className="text-[11px] text-muted-foreground">
                    Last: {TYPE_LABEL[last.type] || last.type} {formatINR(last.amount)} ({last.method}) on {formatDate(last.date)}
                    {last.type === 'SALARY' && last.recovered > 0 && ` · advance recovered ${formatINR(last.recovered)}`}
                  </p>
                )}

                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" className="h-8 gap-1 bg-emerald-600 text-xs text-white hover:bg-emerald-700" disabled={!s.active} onClick={() => setSalaryFor(s)}>
                    <Wallet className="h-3.5 w-3.5" /> Pay Salary
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" disabled={!s.active} onClick={() => setMoneyFor({ staff: s, type: 'ADVANCE' })}>
                    <HandCoins className="h-3.5 w-3.5" /> Advance / Other
                  </Button>
                  {s.payType === 'DAILY' && (
                    <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setDaysFor(s)}>
                      <CalendarCheck className="h-3.5 w-3.5" /> Work Days
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => setHistoryFor(s)}>
                    <History className="h-3.5 w-3.5" /> History
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setForm({ open: true, staff: s })}>
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 gap-1 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/30"
                    onClick={() => setDeleteTarget(s)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <StaffFormDialog
        open={form.open}
        staff={form.staff}
        onOpenChange={(open) => setForm((f) => ({ ...f, open }))}
        onSaved={onDataChanged}
      />
      {salaryFor && <SalaryDialog staff={fresh(salaryFor)!} onClose={() => setSalaryFor(null)} onSaved={onDataChanged} />}
      {moneyFor && <MoneyDialog staff={fresh(moneyFor.staff)!} initialType={moneyFor.type} onClose={() => setMoneyFor(null)} onSaved={onDataChanged} />}
      {daysFor && <WorkDaysDialog staff={fresh(daysFor)!} onClose={() => setDaysFor(null)} onSaved={onDataChanged} />}
      {historyFor && <HistoryDialog staff={fresh(historyFor)!} refreshKey={refreshKey} onClose={() => setHistoryFor(null)} onSaved={onDataChanged} />}

      <AdminDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Staff Member"
        itemType="Staff"
        itemName={deleteTarget ? `${deleteTarget.name} (${deleteTarget.role})` : ''}
        warningNotice="Deleting removes the staff member and their payment history. To keep the history, edit the staff member and mark them Inactive instead."
        onConfirm={async (adminPin) => {
          if (!deleteTarget) return
          await apiAs(`/api/staff?id=${deleteTarget.id}`, getCachedUser(), { method: 'DELETE', adminPin })
          setDeleteTarget(null)
          onDataChanged()
        }}
      />
    </div>
  )
}

// ============ Add / edit staff ============

function StaffFormDialog({
  open,
  staff,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  staff: Staff | null
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {open && <StaffForm key={staff?.id || 'new'} staff={staff} onDone={() => onOpenChange(false)} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  )
}

function StaffForm({ staff, onDone, onSaved }: { staff: Staff | null; onDone: () => void; onSaved: () => void }) {
  const [name, setName] = useState(staff?.name || '')
  const [phone, setPhone] = useState(staff?.phone || '')
  const [role, setRole] = useState(staff?.role || 'Housekeeping')
  const [payType, setPayType] = useState(staff?.payType === 'DAILY' ? 'DAILY' : 'MONTHLY')
  const [salary, setSalary] = useState(staff ? String(staff.salary) : '')
  const [dailyRate, setDailyRate] = useState(staff ? String(staff.dailyRate || '') : '')
  const [joinDate, setJoinDate] = useState(staff ? staff.joinDate.slice(0, 10) : todayStr())
  const [address, setAddress] = useState(staff?.address || '')
  const [aadhaar, setAadhaar] = useState(staff?.aadhaar || '')
  const [isActive, setIsActive] = useState(staff ? staff.active : true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Name is required')
    if (phone && sanitizePhone(phone).length !== 10) return setError('Phone must be a 10-digit mobile number')
    if (payType === 'DAILY' && !(parseFloat(dailyRate) > 0)) return setError('Enter the daily rate')
    setSaving(true)
    setError('')
    try {
      await apiAs('/api/staff', getCachedUser(), {
        method: staff ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...(staff ? { id: staff.id } : {}),
          name: name.trim(),
          phone: sanitizePhone(phone),
          role,
          payType,
          salary: salary || 0,
          dailyRate: dailyRate || 0,
          joinDate,
          address: address.trim(),
          aadhaar: aadhaar.trim(),
          active: isActive,
        }),
      })
      toast({ title: staff ? 'Staff updated' : 'Staff added', description: name.trim() })
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
        <DialogTitle>{staff ? `Edit ${staff.name}` : 'Add Staff Member'}</DialogTitle>
        <DialogDescription>Details, role and how they are paid. Every change is kept in the staff history.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="sf-name">Name *</Label>
        <Input id="sf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sf-phone">Phone</Label>
          <Input id="sf-phone" inputMode="numeric" value={phone} onChange={(e) => setPhone(sanitizePhone(e.target.value))} placeholder="10-digit mobile" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sf-role">Role</Label>
          <Input id="sf-role" list="sf-roles" value={role} onChange={(e) => setRole(e.target.value)} />
          <datalist id="sf-roles">
            {ROLES.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Paid</Label>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {[
            ['MONTHLY', 'Monthly salary'],
            ['DAILY', 'Day basis'],
          ].map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setPayType(v)}
              className={`rounded-md py-1.5 text-xs font-medium ${payType === v ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {payType === 'MONTHLY' ? (
          <div className="space-y-1.5">
            <Label htmlFor="sf-salary">Monthly Salary (₹)</Label>
            <Input id="sf-salary" type="number" min="0" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="0" />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="sf-rate">Daily Rate (₹ / full day) *</Label>
            <Input id="sf-rate" type="number" min="0" value={dailyRate} onChange={(e) => setDailyRate(e.target.value)} placeholder="0" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="sf-join">Join Date</Label>
          <Input id="sf-join" type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="sf-addr">Address</Label>
          <Input id="sf-addr" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sf-aadhaar">Aadhaar / ID</Label>
          <Input id="sf-aadhaar" value={aadhaar} onChange={(e) => setAadhaar(e.target.value)} />
        </div>
      </div>
      {staff && (
        <label className="flex items-center justify-between rounded-lg border p-2.5 text-sm">
          <span>
            Active
            <span className="block text-[11px] text-muted-foreground">Inactive staff keep their history but cannot be paid</span>
          </span>
          <Switch checked={isActive} onCheckedChange={setIsActive} aria-label="Active" />
        </label>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving} className="bg-emerald-600 text-white hover:bg-emerald-700">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} {staff ? 'Save Changes' : 'Add Staff'}
        </Button>
      </div>
    </form>
  )
}

// ============ Pay salary ============

function SalaryDialog({ staff, onClose, onSaved }: { staff: Staff; onClose: () => void; onSaved: () => void }) {
  const sm = staff.summary
  const isDaily = staff.payType === 'DAILY'
  const [period, setPeriod] = useState(sm.currentPeriod)
  const [upTo, setUpTo] = useState('')
  const paidForPeriod = staff.payments
    .filter((p) => p.type === 'SALARY' && p.period === period)
    .reduce((t, p) => t + (p.gross || p.amount), 0)
  const remaining = Math.max(0, staff.salary - paidForPeriod)
  const unpaid = staff.workDays.filter((w) => !w.paymentId && (!upTo || w.date <= upTo))
  const dayUnits = Math.round(unpaid.reduce((t, w) => t + w.units, 0) * 100) / 100
  const [grossInput, setGrossInput] = useState('')
  const gross = isDaily ? Math.round(dayUnits * staff.dailyRate * 100) / 100 : grossInput === '' ? remaining : parseFloat(grossInput) || 0
  const [recovered, setRecovered] = useState(String(Math.min(sm.advanceOutstanding, isDaily ? sm.unpaidAmount : remaining)))
  const [deduction, setDeduction] = useState('')
  const [method, setMethod] = useState('CASH')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const rec = Math.max(0, parseFloat(recovered) || 0)
  const ded = Math.max(0, parseFloat(deduction) || 0)
  const net = Math.round((gross - rec - ded) * 100) / 100

  async function pay() {
    if (gross <= 0) return setError(isDaily ? 'No unpaid days to pay' : `Salary for ${periodLabel(period)} is already paid`)
    if (rec > sm.advanceOutstanding + 0.01) return setError(`Only ${formatINR(sm.advanceOutstanding)} advance is outstanding`)
    if (net < 0) return setError('Recovery and deductions cannot be more than the salary')
    setSaving(true)
    setError('')
    try {
      await apiAs('/api/staff-payments', getCachedUser(), {
        method: 'POST',
        body: JSON.stringify({
          staffId: staff.id,
          type: 'SALARY',
          period: isDaily ? undefined : period,
          upTo: isDaily && upTo ? upTo : undefined,
          gross: isDaily ? undefined : gross,
          recovered: rec,
          deduction: ded,
          method,
          notes: notes.trim(),
        }),
      })
      toast({ title: 'Salary paid', description: `${staff.name}: ${formatINR(net)} paid` })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const line = (label: string, value: string, cls = '') => (
    <div className={`flex justify-between ${cls}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pay Salary — {staff.name}</DialogTitle>
          <DialogDescription>{isDaily ? `Day basis · ${formatINR(staff.dailyRate)} per full day` : `Monthly salary ${formatINR(staff.salary)}`}</DialogDescription>
        </DialogHeader>
        {isDaily ? (
          <div className="space-y-1.5">
            <Label htmlFor="sal-upto">Pay days worked up to (optional)</Label>
            <Input id="sal-upto" type="date" value={upTo} onChange={(e) => setUpTo(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              {unpaid.length ? `${unpaid.length} unpaid day(s): ${dayUnits} × ${formatINR(staff.dailyRate)}` : 'No unpaid days. Mark work days first.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sal-month">Salary month</Label>
              <Input id="sal-month" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sal-gross">Salary earned (₹)</Label>
              <Input id="sal-gross" type="number" min="0" value={grossInput === '' ? String(remaining) : grossInput} onChange={(e) => setGrossInput(e.target.value)} />
            </div>
            {paidForPeriod > 0 && (
              <p className="col-span-2 text-xs text-muted-foreground">
                Already paid for {periodLabel(period)}: {formatINR(paidForPeriod)} · left {formatINR(remaining)}
              </p>
            )}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="sal-rec">Advance recovered (₹)</Label>
            <Input id="sal-rec" type="number" min="0" value={recovered} onChange={(e) => setRecovered(e.target.value)} disabled={sm.advanceOutstanding <= 0} />
            <p className="text-[11px] text-muted-foreground">Outstanding: {formatINR(sm.advanceOutstanding)}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sal-ded">Other deduction (₹)</Label>
            <Input id="sal-ded" type="number" min="0" value={deduction} onChange={(e) => setDeduction(e.target.value)} placeholder="0" />
          </div>
        </div>
        <div className="space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">
          {line(isDaily ? `Earned (${dayUnits} days)` : `Salary ${periodLabel(period)}`, formatINR(gross))}
          {rec > 0 && line('− Advance recovered', formatINR(rec), 'text-orange-700 dark:text-orange-400')}
          {ded > 0 && line('− Deduction', formatINR(ded), 'text-red-600')}
          {line('Pay now', formatINR(Math.max(0, net)), 'border-t pt-1 text-base font-bold')}
          {sm.advanceOutstanding > 0 && line('Advance left after this', formatINR(Math.max(0, sm.advanceOutstanding - rec)), 'text-xs text-muted-foreground')}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Paid by</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-full" aria-label="Payment mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sal-notes">Note</Label>
            <Input id="sal-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-700" disabled={saving || gross <= 0 || net < 0} onClick={pay}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Pay {formatINR(Math.max(0, net))}
        </Button>
      </DialogContent>
    </Dialog>
  )
}

// ============ Advance / return / bonus / fine ============

function MoneyDialog({ staff, initialType, onClose, onSaved }: { staff: Staff; initialType: string; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState(initialType)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('CASH')
  const [date, setDate] = useState(todayStr())
  const [recoveryNotes, setRecoveryNotes] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const out = staff.summary.advanceOutstanding
  const amt = parseFloat(amount) || 0

  async function save() {
    if (amt <= 0) return setError('Enter an amount')
    if (type === 'ADVANCE_RETURN' && amt > out + 0.01) return setError(`Only ${formatINR(out)} advance is outstanding`)
    setSaving(true)
    setError('')
    try {
      await apiAs('/api/staff-payments', getCachedUser(), {
        method: 'POST',
        body: JSON.stringify({ staffId: staff.id, type, amount: amt, method, date, recoveryNotes: recoveryNotes.trim(), notes: notes.trim() }),
      })
      toast({ title: 'Saved', description: `${TYPE_LABEL[type]} ${formatINR(amt)} — ${staff.name}` })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{staff.name}</DialogTitle>
          <DialogDescription>Advance outstanding now: {formatINR(out)}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 sm:grid-cols-4">
          {(['ADVANCE', 'ADVANCE_RETURN', 'BONUS', 'DEDUCTION'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              disabled={t === 'ADVANCE_RETURN' && out <= 0}
              className={`rounded-md px-1 py-1.5 text-xs font-medium disabled:opacity-40 ${type === t ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
            >
              {t === 'ADVANCE' ? 'Give advance' : t === 'ADVANCE_RETURN' ? 'Advance returned' : t === 'BONUS' ? 'Bonus' : 'Fine'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="mny-amt">Amount (₹) *</Label>
            <Input id="mny-amt" type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mny-date">Date</Label>
            <Input id="mny-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        {type !== 'DEDUCTION' && (
          <div className="space-y-1.5">
            <Label>{type === 'ADVANCE_RETURN' ? 'Received by' : 'Paid by'}</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-full" aria-label="Payment mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODES.map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {type === 'ADVANCE' && (
          <div className="space-y-1.5">
            <Label htmlFor="mny-plan">Recovery plan</Label>
            <Input id="mny-plan" value={recoveryNotes} onChange={(e) => setRecoveryNotes(e.target.value)} placeholder="e.g. ₹1,000 from each salary" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="mny-note">Note</Label>
          <Input id="mny-note" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </div>
        <p className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
          {type === 'ADVANCE' && `Advance outstanding becomes ${formatINR(out + amt)}. It is recovered when salary is paid.`}
          {type === 'ADVANCE_RETURN' && `Cash returned by ${staff.name}. Advance outstanding becomes ${formatINR(Math.max(0, out - amt))}.`}
          {type === 'BONUS' && 'Paid now and recorded in Expenses as salary.'}
          {type === 'DEDUCTION' && 'A fine or deduction: no money moves; it is listed in the staff history.'}
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button className="w-full bg-emerald-600 text-white hover:bg-emerald-700" disabled={saving} onClick={save}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
        </Button>
      </DialogContent>
    </Dialog>
  )
}

// ============ Work days (day basis) ============

function WorkDaysDialog({ staff, onClose, onSaved }: { staff: Staff; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [days, setDays] = useState<WorkDay[]>(staff.workDays)
  const [extraDate, setExtraDate] = useState('')
  const byDate = new Map(days.map((d) => [d.date, d]))
  const today = todayStr()
  const list = Array.from({ length: 21 }, (_, i) => addDays(-i, today))
  if (extraDate && !list.includes(extraDate)) list.unshift(extraDate)
  const unpaid = days.filter((d) => !d.paymentId)
  const unpaidUnits = unpaid.reduce((t, d) => t + d.units, 0)

  async function mark(date: string, units: number) {
    setBusy(date)
    setError('')
    try {
      await apiAs('/api/staff-workdays', getCachedUser(), { method: 'POST', body: JSON.stringify({ staffId: staff.id, date, units }) })
      setDays((prev) => {
        const rest = prev.filter((d) => d.date !== date)
        return units === 0 ? rest : [{ id: `tmp-${date}`, date, units, paymentId: null }, ...rest]
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy('')
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Work Days — {staff.name}</DialogTitle>
          <DialogDescription>
            Unpaid: {unpaidUnits} day(s) × {formatINR(staff.dailyRate)} = <b>{formatINR(unpaidUnits * staff.dailyRate)}</b>
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Label htmlFor="wd-other" className="text-xs">
            Other date
          </Label>
          <Input id="wd-other" type="date" value={extraDate} max={today} onChange={(e) => setExtraDate(e.target.value)} className="h-8 w-40 text-xs" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <ul className="divide-y rounded-lg border text-sm">
          {list.map((d) => {
            const w = byDate.get(d)
            const paid = !!w?.paymentId
            return (
              <li key={d} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className={d === today ? 'font-semibold' : ''}>
                  {formatDate(d)} {d === today && <span className="text-xs text-muted-foreground">(today)</span>}
                </span>
                {paid ? (
                  <Badge variant="outline" className="border-emerald-400 text-emerald-700">
                    {w!.units === 1 ? 'Full' : 'Half'} · paid
                  </Badge>
                ) : (
                  <div className="flex gap-1">
                    {[
                      [1, 'Full'],
                      [0.5, 'Half'],
                      [0, 'Off'],
                    ].map(([u, l]) => (
                      <Button
                        key={l}
                        size="sm"
                        variant={(w?.units ?? 0) === u ? 'default' : 'outline'}
                        className={`h-7 px-2 text-xs ${(w?.units ?? 0) === u && u ? 'bg-emerald-600 text-white hover:bg-emerald-700' : ''}`}
                        disabled={busy === d}
                        onClick={() => mark(d, Number(u))}
                      >
                        {l}
                      </Button>
                    ))}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

// ============ History ============

function HistoryDialog({ staff, refreshKey, onClose, onSaved }: { staff: Staff; refreshKey: number; onClose: () => void; onSaved: () => void }) {
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [deleting, setDeleting] = useState<StaffPayment | null>(null)
  const sm = staff.summary

  useEffect(() => {
    let alive = true
    api<AuditRow[]>(`/api/staff?historyFor=${staff.id}`)
      .then((rows) => alive && setAudit(Array.isArray(rows) ? rows : []))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [staff.id, refreshKey])

  const payHeaders = ['Date', 'Type', 'For', 'Earned', 'Advance recovered', 'Deduction', 'Paid / Amount', 'Mode', 'Note']
  const payRows = (fmt: (n: number) => string | number) =>
    staff.payments.map((p) => [
      formatDate(p.date),
      TYPE_LABEL[p.type] || p.type,
      p.type === 'SALARY' ? (staff.payType === 'DAILY' ? p.period || '' : periodLabel(p.period)) : p.recoveryNotes || '',
      p.type === 'SALARY' ? fmt(p.gross || p.amount) : '',
      p.type === 'SALARY' && p.recovered ? fmt(p.recovered) : '',
      p.type === 'SALARY' && p.deduction ? fmt(p.deduction) : '',
      fmt(p.amount),
      p.type === 'DEDUCTION' ? '—' : p.method,
      p.notes || '',
    ])

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>History — {staff.name}</DialogTitle>
          <DialogDescription>
            {staff.role} · {payBasis(staff)} · joined {formatDate(staff.joinDate)}
            {staff.phone ? ` · ${staff.phone}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {[
            ['Advance given', sm.advanceGiven],
            ['Recovered from salary', sm.advanceRecovered],
            ['Returned in cash', sm.advanceReturned],
            ['Advance outstanding', sm.advanceOutstanding],
            ['Salary earned (paid)', sm.salaryEarnedPaid],
            ['Salary paid (net)', sm.salaryNetPaid],
            ['Bonus', sm.bonusPaid],
            ['Total paid out', sm.totalPaidOut],
          ].map(([l, v]) => (
            <div key={String(l)} className={`rounded-md p-2 ${l === 'Advance outstanding' && Number(v) > 0 ? 'bg-orange-50 dark:bg-orange-950/40' : 'bg-muted/50'}`}>
              <p className="text-muted-foreground">{l}</p>
              <p className="font-bold">{formatINR(Number(v))}</p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Advance outstanding = advance given − recovered from salary − returned in cash. Salary paid = earned − advance recovered −
          deductions.
        </p>

        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Payment history</p>
          <div className="flex gap-1.5">
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => exportCSV(`staff-${staff.name}-payments.csv`, payHeaders, payRows((n) => n))}>
              <Download className="h-3 w-3" /> Export
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              onClick={() =>
                printTableReport(
                  `Staff Statement — ${staff.name}`,
                  payHeaders,
                  payRows((n) => formatINR(n)),
                  `${staff.role} · ${payBasis(staff)} · Advance outstanding ${formatINR(sm.advanceOutstanding)} · Total paid out ${formatINR(sm.totalPaidOut)}`
                )
              }
            >
              <Printer className="h-3 w-3" /> Print
            </Button>
          </div>
        </div>
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Calculation</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.payments.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-sm text-muted-foreground">
                    No payments yet.
                  </TableCell>
                </TableRow>
              )}
              {staff.payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatDate(p.date)}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs font-medium">{TYPE_LABEL[p.type] || p.type}</TableCell>
                  <TableCell className="min-w-[200px] text-xs text-muted-foreground">
                    {p.type === 'SALARY' ? (
                      <>
                        {staff.payType === 'DAILY' ? p.period : periodLabel(p.period)}: earned {formatINR(p.gross || p.amount)}
                        {p.recovered > 0 && ` − advance ${formatINR(p.recovered)}`}
                        {p.deduction > 0 && ` − deduction ${formatINR(p.deduction)}`} = {formatINR(p.amount)}
                      </>
                    ) : (
                      p.recoveryNotes || p.notes || '—'
                    )}
                    {p.type !== 'DEDUCTION' && <span className="ml-1">· {p.method}</span>}
                    {p.type === 'SALARY' && p.notes && <div>{p.notes}</div>}
                  </TableCell>
                  <TableCell
                    className={`whitespace-nowrap text-right text-sm font-bold ${
                      p.type === 'ADVANCE' ? 'text-orange-700 dark:text-orange-400' : p.type === 'ADVANCE_RETURN' ? 'text-emerald-700' : ''
                    }`}
                  >
                    {formatINR(p.amount)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600" onClick={() => setDeleting(p)} aria-label="Delete payment">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {staff.payType === 'DAILY' && staff.workDays.length > 0 && (
          <div>
            <p className="mb-1 text-sm font-semibold">Work days</p>
            <div className="flex flex-wrap gap-1.5">
              {staff.workDays.slice(0, 60).map((w) => (
                <span
                  key={w.id}
                  className={`rounded px-2 py-0.5 text-[11px] ${w.paymentId ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300'}`}
                >
                  {formatDate(w.date)} · {w.units === 1 ? 'full' : 'half'} · {w.paymentId ? 'paid' : 'unpaid'}
                </span>
              ))}
            </div>
          </div>
        )}

        <div>
          <p className="mb-1 text-sm font-semibold">All changes</p>
          {audit.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <ul className="max-h-60 space-y-1 overflow-y-auto text-xs">
              {audit.map((a) => (
                <li key={a.id} className="rounded border px-2 py-1">
                  <span className="text-muted-foreground">{formatDateTime(a.createdAt)}</span> · {a.details}
                  {a.userName ? <span className="text-muted-foreground"> — {a.userName}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <AdminDeleteDialog
          open={!!deleting}
          onOpenChange={(open) => !open && setDeleting(null)}
          title="Delete Staff Payment"
          itemType="Staff payment"
          itemName={deleting ? `${TYPE_LABEL[deleting.type] || deleting.type} ${formatINR(deleting.amount)} on ${formatDate(deleting.date)}` : ''}
          warningNotice="Its expense is removed too. Deleting a salary payment marks its work days unpaid again and puts any recovered advance back as outstanding."
          onConfirm={async (adminPin) => {
            if (!deleting) return
            await apiAs(`/api/staff-payments?id=${deleting.id}`, getCachedUser(), { method: 'DELETE', adminPin })
            setDeleting(null)
            onSaved()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
