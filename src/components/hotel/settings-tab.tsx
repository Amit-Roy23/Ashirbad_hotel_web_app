'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useTheme } from 'next-themes'
import { api, apiAs, formatDateTime, exportCSV, LODGING_GST_RATES, normalizeLodgingGst } from '@/lib/hotel-utils'
import { useUser, getCachedUser } from './user-context'
import { LoginDialog } from './login-dialog'
import { AdminDeleteDialog } from './admin-delete-dialog'
import { toast } from '@/hooks/use-toast'
import {
  Loader2,
  Hotel,
  Percent,
  Hash,
  UsersRound,
  ShieldCheck,
  History,
  Moon,
  Sun,
  Plus,
  UtensilsCrossed,
  Key,
  Clock,
  Trash2,
  Lock,
} from 'lucide-react'

interface AppUserRow {
  id: string
  name: string
  role: string
  active: boolean
  createdAt: string
}

/** "BILL_FINALIZED" -> "Bill Finalized" */
function auditLabel(action: string): string {
  return action
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function auditTone(action: string): string {
  if (/DELETE|CANCEL/.test(action)) return 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-300'
  if (/CUSTOM|WAIVED|CORRECTION/.test(action)) return 'border-violet-300 text-violet-700 dark:border-violet-800 dark:text-violet-300'
  if (/PAYMENT|BILL|ORDER_PAID|LEDGER_INCOME/.test(action)) return 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300'
  if (/EXTEND|CHECKOUT|CHECKIN|CHANGE_ROOM/.test(action)) return 'border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-300'
  return 'text-foreground'
}

interface AuditRow {
  id: string
  action: string
  entity: string
  entityId?: string | null
  details?: string | null
  userName?: string | null
  userRole?: string | null
  createdAt: string
}

const ROLE_OPTIONS = ['ADMIN', 'MANAGER', 'RECEPTION']

interface TabProps {
  refreshKey: number
  onDataChanged: () => void
  initialFilter?: string
}

export function SettingsTab({ refreshKey, onDataChanged }: TabProps) {
  const { theme, setTheme } = useTheme()
  const { user, login, isAdmin } = useUser()
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [users, setUsers] = useState<AppUserRow[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [auditAction, setAuditAction] = useState('ALL')
  const [auditSearch, setAuditSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [userDlg, setUserDlg] = useState<{ mode: 'add' | 'edit'; row?: AppUserRow } | null>(null)
  const [deleteTargetUser, setDeleteTargetUser] = useState<AppUserRow | null>(null)
  const [uName, setUName] = useState('')
  const [uRole, setURole] = useState('RECEPTION')
  const [uPin, setUPin] = useState('')

  const load = useCallback(async () => {
    try {
      const [s, u, a] = await Promise.all([
        api<Record<string, string>>('/api/settings'),
        api<AppUserRow[]>('/api/users'),
        api<AuditRow[]>('/api/audit'),
      ])
      setSettings(s)
      setUsers(u)
      setAudit(a)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  async function saveSettings() {
    setSaving(true)
    try {
      const currentUser = user || getCachedUser()
      const updated = await apiAs<Record<string, string>>('/api/settings', currentUser, {
        method: 'PATCH',
        body: JSON.stringify(settings),
      })
      if (updated && typeof updated === 'object') {
        setSettings(updated)
      }
      setSaved(true)
      toast({
        title: 'Settings saved',
        description: 'Hotel profile, billing rules, and stay settings have been updated.',
      })
      setTimeout(() => setSaved(false), 2500)
      if (onDataChanged) onDataChanged()
      await load()
    } catch (e) {
      toast({
        title: 'Save failed',
        description: e instanceof Error ? e.message : 'Could not save settings',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  async function saveUser() {
    if (!userDlg) return
    try {
      const currentUser = user || getCachedUser()
      if (userDlg.mode === 'add') {
        await apiAs('/api/users', currentUser, {
          method: 'POST',
          body: JSON.stringify({ name: uName, role: uRole, pin: uPin }),
        })
      } else {
        await apiAs('/api/users', currentUser, {
          method: 'PATCH',
          body: JSON.stringify({ id: userDlg.row!.id, name: uName, role: uRole, ...(uPin ? { pin: uPin } : {}) }),
        })
      }
      setUserDlg(null)
      if (onDataChanged) onDataChanged()
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Save failed')
    }
  }

  function exportAudit() {
    exportCSV(
      'audit-log.csv',
      ['Time', 'Action', 'Entity', 'Details', 'User', 'Role'],
      audit.map((a) => [formatDateTime(a.createdAt), a.action, a.entity, a.details || '', a.userName || '', a.userRole || ''])
    )
  }


  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  const auditActions = [...new Set(audit.map((a) => a.action))].sort()
  const auditQ = auditSearch.trim().toLowerCase()
  const filteredAudit = audit.filter((a) => {
    if (auditAction !== 'ALL' && a.action !== auditAction) return false
    if (auditQ && !`${a.action} ${a.details || ''} ${a.userName || ''} ${a.entity}`.toLowerCase().includes(auditQ)) return false
    return true
  })

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Settings</h2>
        <p className="text-xs text-muted-foreground">Hotel profile, billing rules, users &amp; permissions, audit trail</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Hotel info + billing */}
        <Card>
          <CardContent className="space-y-4 p-4">
            <div className="flex items-center gap-2">
              <Hotel className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-semibold">Hotel Information</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="s-name">Hotel Name</Label>
                <Input id="s-name" value={settings.hotelName || ''} onChange={(e) => setSettings({ ...settings, hotelName: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="s-addr">Address</Label>
                <Input id="s-addr" value={settings.hotelAddress || ''} onChange={(e) => setSettings({ ...settings, hotelAddress: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-phone">Phone</Label>
                <Input id="s-phone" value={settings.hotelPhone || ''} onChange={(e) => setSettings({ ...settings, hotelPhone: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-gstin">Hotel GSTIN</Label>
                <Input id="s-gstin" value={settings.hotelGstin || ''} onChange={(e) => setSettings({ ...settings, hotelGstin: e.target.value })} placeholder="e.g. 19AAAAA0000A1Z5" />
              </div>
            </div>

            <div className="flex items-center gap-2 border-t pt-3">
              <UtensilsCrossed className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-semibold">Restaurant Information (Separate Billing)</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="s-rname">Restaurant Name</Label>
                <Input
                  id="s-rname"
                  value={settings.restaurantName || ''}
                  placeholder="e.g. Ashirbad Restaurant"
                  onChange={(e) => setSettings({ ...settings, restaurantName: e.target.value })}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="s-raddr">Restaurant Address</Label>
                <Input
                  id="s-raddr"
                  value={settings.restaurantAddress || ''}
                  placeholder="Same as hotel or separate address"
                  onChange={(e) => setSettings({ ...settings, restaurantAddress: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-rphone">Restaurant Phone</Label>
                <Input
                  id="s-rphone"
                  value={settings.restaurantPhone || ''}
                  onChange={(e) => setSettings({ ...settings, restaurantPhone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-rgstin">GSTIN / FSSAI No.</Label>
                <Input
                  id="s-rgstin"
                  value={settings.restaurantGstin || ''}
                  onChange={(e) => setSettings({ ...settings, restaurantGstin: e.target.value })}
                  placeholder="e.g. FSSAI / GST No"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 border-t pt-3">
              <Percent className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-semibold">Billing &amp; Tax Rules</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-gst">Default GST %</Label>
                {/* Lodging bills allow only 0% or 5% GST */}
                <div id="s-gst" className="grid h-9 grid-cols-2 gap-1">
                  {LODGING_GST_RATES.map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setSettings({ ...settings, gstPercent: pct })}
                      className={`rounded border text-xs font-semibold transition-colors ${
                        normalizeLodgingGst(settings.gstPercent) === pct
                          ? 'bg-emerald-600 text-white border-emerald-600'
                          : 'bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-inv">Invoice Prefix</Label>
                <Input id="s-inv" value={settings.invoicePrefix || ''} onChange={(e) => setSettings({ ...settings, invoicePrefix: e.target.value })} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="s-counter" className="flex items-center gap-1.5">
                  <Hash className="h-3 w-3" /> Next Invoice Number
                </Label>
                <div className="rounded-md bg-muted px-3 py-2 text-sm font-semibold">
                  {settings.invoicePrefix || 'INV'}-{String(settings.invoiceCounter || 1).padStart(4, '0')}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 border-t pt-3">
              <Clock className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-semibold">Stay &amp; Checkout Rules</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-checkout-time">Check-Out Time (IST)</Label>
                <Input
                  id="s-checkout-time"
                  type="time"
                  value={settings.checkoutTime || '08:00'}
                  onChange={(e) => setSettings({ ...settings, checkoutTime: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-grace">Grace Period (minutes)</Label>
                <Input
                  id="s-grace"
                  type="number"
                  min="0"
                  value={settings.overstayGraceMinutes || '0'}
                  onChange={(e) => setSettings({ ...settings, overstayGraceMinutes: e.target.value })}
                />
              </div>
              <div className="col-span-2 flex items-center justify-between rounded-lg border p-3 bg-muted/20">
                <div className="space-y-0.5">
                  <Label className="text-xs font-semibold">Auto-Extend Overstays</Label>
                  <p className="text-[11px] text-muted-foreground">
                    Automatically add +1 day every 24h when active guests stay past check-out + grace.
                  </p>
                </div>
                <Switch
                  checked={settings.autoExtendEnabled !== 'false'}
                  onCheckedChange={(checked) =>
                    setSettings({ ...settings, autoExtendEnabled: checked ? 'true' : 'false' })
                  }
                />
              </div>
            </div>

            <div className="flex items-center gap-2 border-t pt-3">
              <Lock className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-semibold">Admin Security PIN</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="s-adminpin">Master Admin / Delete Authorization PIN</Label>
                <Input
                  id="s-adminpin"
                  type="password"
                  inputMode="numeric"
                  placeholder="Master PIN (Default: 0000)"
                  value={settings.adminPin || ''}
                  onChange={(e) => setSettings({ ...settings, adminPin: e.target.value })}
                />
                <p className="text-[11px] text-muted-foreground">
                  Master PIN to authorize deletions across the entire hotel app (any active Admin&apos;s login PIN also works).
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                Settings update across all bills, dashboard, and stay calculations.
              </p>
              <Button onClick={saveSettings} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {saved ? 'Saved ✓' : 'Save Settings'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {/* Users & roles */}
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <UsersRound className="h-4 w-4 text-emerald-600" />
                  <p className="text-sm font-semibold">App Users &amp; Permissions</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => {
                    setUName('')
                    setURole('RECEPTION')
                    setUPin('')
                    setUserDlg({ mode: 'add' })
                  }}
                >
                  <Plus className="h-3.5 w-3.5" /> Add User
                </Button>
              </div>
              <ul className="space-y-1.5">
                {users.map((u) => (
                  <li key={u.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <div>
                      <span className="text-sm font-medium">{u.name}</span>
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        {u.role}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs gap-1 border-violet-200 text-violet-700 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950/40"
                        onClick={() => {
                          setUName(u.name)
                          setURole(u.role)
                          setUPin('')
                          setUserDlg({ mode: 'edit', row: u })
                        }}
                      >
                        <Key className="h-3 w-3" /> Change PIN
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 w-7 p-0 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
                        title="Delete User (Admin Protected)"
                        onClick={() => setDeleteTargetUser(u)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                <p className="mb-1 flex items-center gap-1 font-medium text-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Role permissions
                </p>
                <p>• ADMIN / MANAGER — can approve custom corporate billing, change settings, manage users</p>
                <p>• RECEPTION — daily operations: bookings, check-in/out, food orders, normal billing</p>
                {!user && (
                  <p className="mt-1 text-foreground">
                    Not signed in.{' '}
                    <button className="underline" onClick={() => setLoginOpen(true)}>
                      Sign in
                    </button>
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Theme */}
          <Card>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-semibold">Appearance</p>
                <p className="text-xs text-muted-foreground">Light / Dark mode — saved for this browser</p>
              </div>
              <div className="flex gap-1.5">
                <Button
                  variant={theme === 'light' ? 'default' : 'outline'}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setTheme('light')}
                >
                  <Sun className="h-4 w-4" /> Light
                </Button>
                <Button
                  variant={theme === 'dark' ? 'default' : 'outline'}
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setTheme('dark')}
                >
                  <Moon className="h-4 w-4" /> Dark
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Audit trail */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-semibold">Audit Trail</p>
              <span className="text-xs text-muted-foreground">
                {filteredAudit.length} of {audit.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Input
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Search details or user…"
                className="h-8 w-[200px] text-xs"
                aria-label="Search audit trail"
              />
              <Select value={auditAction} onValueChange={setAuditAction}>
                <SelectTrigger className="h-8 w-[190px]" aria-label="Filter audit actions">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Actions</SelectItem>
                  {auditActions.map((act) => (
                    <SelectItem key={act} value={act}>
                      {auditLabel(act)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={exportAudit}>
                Export
              </Button>
            </div>
          </div>

          <div className="max-h-[480px] overflow-y-auto rounded-lg border divide-y">
            {filteredAudit.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No audit entries found.</p>
            )}
            {filteredAudit.map((a) => (
              <div key={a.id} className="space-y-1 px-3 py-2.5 hover:bg-muted/40">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge variant="outline" className={`text-[10px] font-semibold ${auditTone(a.action)}`}>
                    {auditLabel(a.action)}
                  </Badge>
                  <span className="text-[11px] text-muted-foreground">{formatDateTime(a.createdAt)}</span>
                  <span className="ml-auto text-[11px] font-medium text-foreground">
                    {a.userName || '—'}
                    {a.userRole ? <span className="font-normal text-muted-foreground"> · {a.userRole}</span> : null}
                  </span>
                </div>
                {a.details && (
                  <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">{a.details}</p>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onLogin={login} onSuccess={load} />

      {/* User add/edit dialog */}
      <Dialog open={!!userDlg} onOpenChange={(o) => !o && setUserDlg(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>{userDlg?.mode === 'add' ? 'Add App User' : 'Edit App User'}</DialogTitle>
            <DialogDescription>Users sign in with name + PIN. Only ADMIN can manage users.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="u-name">Name</Label>
              <Input id="u-name" value={uName} onChange={(e) => setUName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={uRole} onValueChange={setURole}>
                <SelectTrigger aria-label="Role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-pin">PIN {userDlg?.mode === 'edit' && '(leave blank to keep)'}</Label>
              <Input id="u-pin" type="password" inputMode="numeric" value={uPin} onChange={(e) => setUPin(e.target.value)} autoComplete="off" />
            </div>
            <Button className="w-full" onClick={saveUser} disabled={!uName.trim() || (userDlg?.mode === 'add' && uPin.length < 3)}>
              Save User
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Admin Protected User Delete Dialog */}
      <AdminDeleteDialog
        open={!!deleteTargetUser}
        onOpenChange={(open) => !open && setDeleteTargetUser(null)}
        title="Delete App User"
        itemType="User Account"
        itemName={deleteTargetUser ? `${deleteTargetUser.name} (${deleteTargetUser.role})` : ''}
        warningNotice="Deleting this user account permanently removes their login access. Admin PIN is required."
        onConfirm={async (adminPin) => {
          if (!deleteTargetUser) return
          const currentUser = user || getCachedUser()
          const res = await apiAs<{ success?: boolean; error?: string }>(
            `/api/users?id=${deleteTargetUser.id}`,
            currentUser,
            { method: 'DELETE', adminPin }
          )
          if (res && res.error) {
            throw new Error(res.error)
          }
          toast({
            title: 'User deleted',
            description: `User account ${deleteTargetUser.name} has been removed.`,
          })
          if (onDataChanged) onDataChanged()
          await load()
        }}
      />
    </div>
  )
}
