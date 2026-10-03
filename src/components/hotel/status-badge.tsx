'use client'

import { DoorOpen, DoorClosed, Wrench, BrushCleaning, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Room status badge — always pairs color with an icon + text label (PRD 8: no color-alone status) */
export function RoomStatusBadge({
  status,
  housekeeping,
  className,
}: {
  status: string
  housekeeping?: string
  className?: string
}) {
  const dirty = housekeeping === 'DIRTY'
  if (status === 'OCCUPIED') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800 dark:bg-red-950 dark:text-red-300',
          className
        )}
      >
        <DoorClosed className="h-3 w-3" aria-hidden />
        Occupied
      </span>
    )
  }
  if (status === 'MAINTENANCE') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-semibold text-zinc-800 dark:bg-zinc-700 dark:text-zinc-200',
          className
        )}
      >
        <Wrench className="h-3 w-3" aria-hidden />
        Maintenance
      </span>
    )
  }
  if (dirty) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300',
          className
        )}
      >
        <BrushCleaning className="h-3 w-3" aria-hidden />
        Dirty
      </span>
    )
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
        className
      )}
    >
      <DoorOpen className="h-3 w-3" aria-hidden />
      Vacant
    </span>
  )
}

/** Generic payment status chip */
export function PaymentStatusBadge({ status, className }: { status: string; className?: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    PAID: {
      label: 'Paid',
      cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    },
    PARTIAL: {
      label: 'Partial',
      cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    },
    UNPAID: {
      label: 'Unpaid',
      cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    },
  }
  const conf = map[status] || { label: status, cls: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200' }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        conf.cls,
        className
      )}
    >
      <CheckCircle2 className="h-3 w-3" aria-hidden />
      {conf.label}
    </span>
  )
}
