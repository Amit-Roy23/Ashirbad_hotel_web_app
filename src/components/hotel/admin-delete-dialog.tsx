'use client'

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ShieldAlert, Trash2, Loader2, Eye, EyeOff, Lock, AlertTriangle } from 'lucide-react'

export interface AdminDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  itemName?: string
  itemType?: string
  warningNotice?: string
  onConfirm: (adminPin: string) => Promise<void>
}

export function AdminDeleteDialog({
  open,
  onOpenChange,
  title = 'Admin Authorization Required',
  description = 'Permanent record deletion requires an authorized Admin PIN or Password.',
  itemName,
  itemType,
  warningNotice,
  onConfirm,
}: AdminDeleteDialogProps) {
  const [pin, setPin] = React.useState('')
  const [showPin, setShowPin] = React.useState(false)
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (open) {
      setPin('')
      setShowPin(false)
      setError('')
      setBusy(false)
      const timer = setTimeout(() => {
        inputRef.current?.focus()
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [open])

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault()
    if (!pin.trim()) {
      setError('Admin PIN or Password is required')
      inputRef.current?.focus()
      return
    }

    setBusy(true)
    setError('')
    try {
      await onConfirm(pin.trim())
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid Admin PIN or delete failed')
      inputRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val) => !busy && onOpenChange(val)}>
      <DialogContent className="sm:max-w-[425px] border-red-200 dark:border-red-900/50">
        <DialogHeader className="space-y-2">
          <div className="flex items-center gap-2.5 text-red-600 dark:text-red-400">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/60 border border-red-200 dark:border-red-800">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold text-foreground">{title}</DialogTitle>
              <div className="text-xs text-red-600 dark:text-red-400 font-medium">Security Protected Action</div>
            </div>
          </div>
          <DialogDescription className="text-xs text-muted-foreground pt-1">
            {description}
          </DialogDescription>
        </DialogHeader>

        {itemName && (
          <div className="rounded-lg border border-red-200 bg-red-50/70 p-3 dark:border-red-950 dark:bg-red-950/30">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="text-[11px] font-semibold text-red-800 dark:text-red-300 uppercase tracking-wider">
                  Item to Delete {itemType ? `(${itemType})` : ''}
                </div>
                <div className="text-sm font-bold text-red-950 dark:text-red-100 break-words">
                  {itemName}
                </div>
                <div className="text-[11px] text-red-700 dark:text-red-300">
                  {warningNotice || 'This action cannot be undone and will permanently remove associated data.'}
                </div>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="admin-delete-pin" className="text-xs font-semibold flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-foreground">
                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                Enter Admin PIN / Password <span className="text-red-500">*</span>
              </span>
            </Label>
            <div className="relative">
              <Input
                id="admin-delete-pin"
                ref={inputRef}
                type={showPin ? 'text' : 'password'}
                inputMode="numeric"
                autoComplete="off"
                placeholder="Enter Admin PIN"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value)
                  if (error) setError('')
                }}
                disabled={busy}
                className="pr-10 tracking-widest text-base font-mono"
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                tabIndex={-1}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
                aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
              >
                {showPin ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2.5 text-xs font-medium text-destructive animate-in fade-in-50">
              {error}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={busy || !pin.trim()}
              className="gap-1.5 shadow-sm"
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Verifying & Deleting…
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" />
                  Authorize & Delete
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
