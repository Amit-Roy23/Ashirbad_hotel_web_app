'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { api, apiAs, formatINR, formatDate, exportCSV, sanitizePhone } from '@/lib/hotel-utils'
import { getCachedUser } from './user-context'
import { Loader2, Plus, Phone, IndianRupee, UserRound, ArrowRightLeft, Search, Trash2 } from 'lucide-react'
import { AdminDeleteDialog } from './admin-delete-dialog'

interface StaffPayment {
  id: string
  type: string
  amount: number
  method: string
  date: string
  recoveryNotes?: string | null
  notes?: string | null
}

interface Staff {
  id: string
  name: string
  phone?: string
  role: string
  salary: number
  joinDate: string
  address?: string
  active: boolean
  payments: StaffPayment[]
}

const ROLES = ['Manager', 'Reception', 'Housekeeping', 'Chef', 'Guard', 'Accountant', 'Other']

export function StaffTab({ refreshKey, onDataChanged }: { refreshKey: number; onDataChanged: () => void }) {
  const [staff, setStaff] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [payStaff, setPayStaff] = useState<Staff | null>(null)
  const [deleteTargetStaff, setDeleteTargetStaff] = useState<Staff | null>(null)

  // filters
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')

  // add staff form
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState('Staff')
  const [salary, setSalary] = useState('')
  const [joinDate, setJoinDate] = useState(new Date().toISOString().slice(0, 10))
  const [address, setAddress] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')

  // payment form
  const [payType, setPayType] = useState('SALARY')
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('CASH')
  const [payRecovery, setPayRecovery] = useState('')
  const [payNotes, setPayNotes] = useState('')
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await api<Staff[]>('/api/staff')
      setStaff(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  async function addStaff() {
    if (!name.trim()) {
      setError('Name required')
      return
    }
    const cleanPhone = sanitizePhone(phone)
    if (phone.trim() && cleanPhone.length !== 10) {
      setError('Staff phone number must be a valid 10-digit mobile number')
      return
    }
    setAdding(true)
    setError('')
    try {
      await api('/api/staff', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), phone: cleanPhone || undefined, role, salary, joinDate, address }),
      })
      setName('')
      setPhone('')
      setSalary('')
      setAddress('')
      setAddOpen(false)
      await load()
      onDataChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setAdding(false)
    }
  }

  function deleteStaffMember(member: Staff) {
    setDeleteTargetStaff(member)
  }

  async function recordPayment() {
    if (!payStaff || !payAmount) {
      setPayError('Enter amount')
      return
    }
    setPaying(true)
    setPayError('')
    try {
      await apiAs('/api/staff-payments', getCachedUser(), {
        method: 'POST',
        body: JSON.stringify({
          staffId: payStaff.id,
          type: payType,
          amount: payAmount,
          method: payMethod,
          recoveryNotes: payType === 'ADVANCE' ? payRecovery || undefined : undefined,
          notes: payNotes,
        }),
      })
      setPayStaff(null)
      setPayAmount('')
      setPayNotes('')
      setPayRecovery('')
      await load()
      onDataChanged()
    } catch (e) {
      setPayError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setPaying(false)
    }
  }

  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase()
    return staff.filter((s) => {
      if (q && !`${s.name} ${s.phone || ''} ${s.role}`.toLowerCase().includes(q)) return false
      if (roleFilter !== 'ALL' && s.role !== roleFilter) return false
      if (statusFilter === 'ACTIVE' && !s.active) return false
      if (statusFilter === 'INACTIVE' && s.active) return false
      return true
    })
  }, [staff, search, roleFilter, statusFilter])

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  function exportStaff() {
    exportCSV(
      'staff.csv',
      ['Name', 'Phone', 'Role', 'Monthly Salary', 'Joined', 'Status', 'Advances', 'Salary Paid Total'],
      filteredStaff.map((s) => [
        s.name,
        s.phone || '',
        s.role,
        s.salary,
        formatDate(s.joinDate),
        s.active ? 'Active' : 'Inactive',
        (s.payments || []).filter((p) => p.type === 'ADVANCE').reduce((sum, p) => sum + p.amount, 0),
        (s.payments || []).filter((p) => p.type === 'SALARY').reduce((sum, p) => sum + p.amount, 0),
      ])
    )
  }

  const totalMonthlySalary = staff.filter((s) => s.active).reduce((sum, s) => sum + s.salary, 0)

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-semibold">Total Staff: {staff.filter((s) => s.active).length}</p>
            <p className="text-xs text-muted-foreground">Monthly salary expense: {formatINR(totalMonthlySalary)}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportStaff}>
              Export
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => setAddOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Add Staff
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone, role…" className="pl-8" aria-label="Search staff" />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="h-9 w-[140px]" aria-label="Role filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Roles</SelectItem>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[130px]" aria-label="Status filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
          </SelectContent>
        </Select>
        {(search || roleFilter !== 'ALL' || statusFilter !== 'ALL') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch('')
              setRoleFilter('ALL')
              setStatusFilter('ALL')
            }}
          >
            Reset
          </Button>
        )}
      </div>

      {filteredStaff.map((s) => {
        const advances = (s.payments || []).filter((p) => p.type === 'ADVANCE').reduce((sum, p) => sum + p.amount, 0)
        const paidSalary = (s.payments || []).filter((p) => p.type === 'SALARY').reduce((sum, p) => sum + p.amount, 0)
        return (
          <Card key={s.id} className={!s.active ? 'opacity-60' : ''}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="rounded-full bg-emerald-100 p-2">
                    <UserRound className="h-5 w-5 text-emerald-700" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{s.name}</span>
                      <Badge variant="outline" className="text-[10px]">{s.role}</Badge>
                      {!s.active && <Badge variant="secondary" className="text-[10px]">INACTIVE</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                      {s.phone && (
                        <a href={`tel:${s.phone}`} className="flex items-center gap-1 text-emerald-700">
                          <Phone className="h-3 w-3" /> {s.phone}
                        </a>
                      )}
                      <span>Salary: {formatINR(s.salary)}/month</span>
                      <span>Joined: {formatDate(s.joinDate)}</span>
                      {advances > 0 && <span className="text-orange-600 font-medium">Advance taken: {formatINR(advances)}</span>}
                      {paidSalary > 0 && <span className="text-emerald-700">Salary paid (total): {formatINR(paidSalary)}</span>}
                    </div>
                    {(s.payments || []).length > 0 && (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Last payment: {s.payments[0].type} {formatINR(s.payments[0].amount)} ({s.payments[0].method}) on{' '}
                        {formatDate(s.payments[0].date)}
                        {s.payments[0].recoveryNotes ? ` — recovery: ${s.payments[0].recoveryNotes}` : ''}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={() => {
                      setPayStaff(s)
                      setPayType('SALARY')
                      setPayAmount('')
                      setPayMethod('CASH')
                      setPayRecovery('')
                      setPayNotes('')
                      setPayError('')
                    }}
                  >
                    <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> Pay / Advance
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                    onClick={() => deleteStaffMember(s)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}

      {/* Add staff dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Staff Member</DialogTitle>
            <DialogDescription>Staff details, role and salary information</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Phone (10 Digits)</Label>
                <Input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="10-digit mobile number"
                  value={phone}
                  onChange={(e) => setPhone(sanitizePhone(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Monthly Salary (₹)</Label>
                <Input type="number" value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Join Date</Label>
                <Input type="date" value={joinDate} onChange={(e) => setJoinDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Address</Label>
              <Input value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={addStaff} disabled={adding}>
              {adding && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Staff
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payment dialog */}
      <Dialog open={!!payStaff} onOpenChange={(o) => !o && setPayStaff(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Payment — {payStaff?.name}</DialogTitle>
            <DialogDescription>Salary, advance, bonus or deduction entry</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Payment Type</Label>
              <Select value={payType} onValueChange={setPayType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SALARY">Salary (Expense)</SelectItem>
                  <SelectItem value="ADVANCE">Advance (Recoverable)</SelectItem>
                  <SelectItem value="BONUS">Bonus (Expense)</SelectItem>
                  <SelectItem value="DEDUCTION">Deduction</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount (₹) *</Label>
                <Input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1.5">
                <Label>Payment Mode</Label>
                <Select value={payMethod} onValueChange={setPayMethod}>
                  <SelectTrigger aria-label="Payment mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="UPI">UPI</SelectItem>
                    <SelectItem value="CARD">Card</SelectItem>
                    <SelectItem value="BANK">Bank Transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {payType === 'ADVANCE' && (
              <div className="space-y-1.5">
                <Label>Recovery / Adjustment Notes</Label>
                <Input value={payRecovery} onChange={(e) => setPayRecovery(e.target.value)} placeholder="e.g. deduct ₹2000 from next 2 months salary" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input value={payNotes} onChange={(e) => setPayNotes(e.target.value)} placeholder="Optional note" />
            </div>
            <p className="flex items-start gap-1.5 rounded-lg bg-muted p-2.5 text-xs text-muted-foreground">
              <IndianRupee className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Salary, bonus and advance all auto-log as expense in the daily ledger (advance marked as Staff Advance).
            </p>
            {payError && <p className="text-sm text-red-600">{payError}</p>}
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={recordPayment} disabled={paying}>
              {paying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record Payment
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Admin PIN Protected Delete Staff Member Dialog */}
      <AdminDeleteDialog
        open={!!deleteTargetStaff}
        onOpenChange={(open) => !open && setDeleteTargetStaff(null)}
        title="Delete Staff Member"
        itemType="Staff"
        itemName={deleteTargetStaff ? `${deleteTargetStaff.name} (${deleteTargetStaff.role})` : ''}
        warningNotice="Deleting a staff member requires Admin PIN or Password authorization."
        onConfirm={async (adminPin) => {
          if (!deleteTargetStaff) return
          const res = await apiAs<{ success?: boolean; error?: string }>(
            `/api/staff?id=${deleteTargetStaff.id}`,
            getCachedUser(),
            { method: 'DELETE', adminPin }
          )
          if (res && res.error) {
            throw new Error(res.error)
          }
          setStaff((prev) => prev.filter((s) => s.id !== deleteTargetStaff.id))
          setDeleteTargetStaff(null)
          onDataChanged()
        }}
      />
    </div>
  )
}
