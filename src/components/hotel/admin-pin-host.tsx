'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { registerAdminPinHost, type AdminPinRequest } from '@/lib/admin-pin'

/**
 * Renders Admin PIN prompts requested through requestAdminApproval / askAdminPin.
 * As a Radix dialog it stacks correctly on top of any dialog that is already open.
 */
export function AdminPinHost() {
  const [request, setRequest] = useState<AdminPinRequest | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const requestRef = useRef<AdminPinRequest | null>(null)

  useEffect(
    () =>
      registerAdminPinHost((req) => {
        // A new prompt replaces one that is still open; the old one counts as cancelled
        requestRef.current?.resolve(null)
        requestRef.current = req
        setRequest(req)
        setPin('')
        setError('')
        setBusy(false)
      }),
    []
  )

  function finish(result: string | null) {
    const req = requestRef.current
    requestRef.current = null
    setRequest(null)
    req?.resolve(result)
  }

  async function submit() {
    const req = requestRef.current
    if (!req || busy) return
    const value = pin.trim()
    if (!value) {
      setError('Enter the Admin PIN')
      return
    }
    setBusy(true)
    setError('')
    try {
      const problem = await req.validate(value)
      if (requestRef.current !== req) return
      if (!problem) return finish(value)
      setError(problem)
    } catch {
      setError('Could not verify PIN')
    }
    setBusy(false)
  }

  return (
    <Dialog open={!!request} onOpenChange={(o) => !o && finish(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-emerald-600" /> Admin approval required
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">{request?.message}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <Input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            placeholder="Admin PIN"
            value={pin}
            onChange={(e) => {
              setPin(e.target.value)
              if (error) setError('')
            }}
            aria-invalid={!!error}
          />
          <p className="min-h-[18px] text-xs text-red-600">{error}</p>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Approve
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
