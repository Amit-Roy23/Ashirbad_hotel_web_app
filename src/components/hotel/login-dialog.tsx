'use client'

import * as React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Lock, UserRound } from 'lucide-react'
import { api } from '@/lib/hotel-utils'
import type { AppUser } from './user-context'

interface AppUserRow {
  id: string
  name: string
  role: string
  active: boolean
}

export function LoginDialog({
  open,
  onOpenChange,
  onLogin,
  onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLogin: (u: AppUser) => void
  onSuccess?: () => void
}) {
  const [users, setUsers] = React.useState<AppUserRow[]>([])
  const [selected, setSelected] = React.useState<AppUserRow | null>(null)
  const [pin, setPin] = React.useState('')
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setUsers([])
    setSelected(null)
    setPin('')
    setError('')
    fetch('/api/users')
      .then((r) => r.json())
      .then((rows: AppUserRow[]) => {
        setUsers(rows.filter((u) => u.active))
      })
      .catch(() => setError('Could not load users'))
  }, [open])

  async function submit() {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      const user = await api<AppUser>('/api/auth', {
        method: 'POST',
        body: JSON.stringify({ userId: selected.id, pin }),
      })
      onLogin(user)
      onOpenChange(false)
      onSuccess?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign in</DialogTitle>
          <DialogDescription>Select your name and enter PIN for sensitive actions.</DialogDescription>
        </DialogHeader>
        {!selected ? (
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {users.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setSelected(u)}
                className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-accent"
              >
                <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden />
                <div className="flex-1">
                  <div className="text-sm font-medium">{u.name}</div>
                  <div className="text-xs text-muted-foreground">{u.role}</div>
                </div>
              </button>
            ))}
            {error && <p className="pt-2 text-xs text-destructive">{error}</p>}
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
              <div>
                <div className="text-sm font-medium">{selected.name}</div>
                <div className="text-xs text-muted-foreground">{selected.role}</div>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>
                Change
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-pin">PIN</Label>
              <div className="relative">
                <Lock className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <Input
                  id="login-pin"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="••••"
                  className="pl-8 text-lg tracking-widest"
                  autoFocus
                />
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || pin.length < 3}>
              {busy ? 'Checking…' : 'Sign in'}
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
