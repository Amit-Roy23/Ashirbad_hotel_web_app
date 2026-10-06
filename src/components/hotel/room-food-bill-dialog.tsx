'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { api, apiAs, formatINR, formatDateTime } from '@/lib/hotel-utils'
import { triggerPrintFoodBill } from '@/lib/print-invoice'
import { getCachedUser } from './user-context'
import {
  Utensils,
  Printer,
  Check,
  Loader2,
  Plus,
  Receipt,
  BedDouble,
  User,
  ShoppingBag,
} from 'lucide-react'

interface OrderItem {
  id: string
  name: string
  price: number
  quantity: number
}

interface FoodOrder {
  id: string
  total: number
  status: string
  notes?: string
  createdBy?: string | null
  items: OrderItem[]
  room?: { id: string; number: string } | null
  booking?: { guest: { id: string; name: string; phone?: string } } | null
  createdAt: string
}

interface RoomFoodBillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  roomId?: string
  roomNumber?: string
  bookingId?: string
  guestName?: string
  onOpenLodgingBill?: () => void
  onOpenNewOrder?: () => void
  onDataChanged?: () => void
}

export function RoomFoodBillDialog({
  open,
  onOpenChange,
  roomId,
  roomNumber,
  bookingId,
  guestName,
  onOpenLodgingBill,
  onOpenNewOrder,
  onDataChanged,
}: RoomFoodBillDialogProps) {
  const [orders, setOrders] = useState<FoodOrder[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!open) return
    setLoading(true)
    try {
      const [allOrders, settingsData] = await Promise.all([
        api<FoodOrder[]>('/api/orders'),
        api<Record<string, string>>('/api/settings'),
      ])
      setSettings(settingsData)

      // Filter orders belonging to this booking or room
      const roomOrders = allOrders.filter(
        (o) =>
          (bookingId && o.booking && (o as any).bookingId === bookingId) ||
          (roomId && o.room && o.room.id === roomId) ||
          (roomNumber && o.room && o.room.number === roomNumber)
      )
      setOrders(roomOrders)
    } finally {
      setLoading(false)
    }
  }, [open, bookingId, roomId, roomNumber])

  useEffect(() => {
    load()
  }, [load])

  const pendingOrders = useMemo(
    () => orders.filter((o) => o.status === 'PENDING'),
    [orders]
  )

  const pendingFoodTotal = useMemo(
    () => pendingOrders.reduce((sum, o) => sum + o.total, 0),
    [pendingOrders]
  )

  const allItems = useMemo(() => {
    return pendingOrders.flatMap((o) => o.items)
  }, [pendingOrders])

  async function markPaid(orderId: string, method: string) {
    setBusyId(orderId)
    try {
      await apiAs('/api/orders', getCachedUser(), {
        method: 'PATCH',
        body: JSON.stringify({ id: orderId, action: 'paid', method }),
      })
      await load()
      if (onDataChanged) onDataChanged()
    } finally {
      setBusyId(null)
    }
  }

  // Aggregate single print object for entire room food bill
  function handlePrintAllFoodBill() {
    if (pendingOrders.length === 0 && orders.length === 0) return

    const targetOrders = pendingOrders.length > 0 ? pendingOrders : orders
    const aggregatedOrder: FoodOrder = {
      id: targetOrders[0]?.id || 'FOOD-ROOM',
      total: targetOrders.reduce((s, o) => s + o.total, 0),
      status: pendingOrders.length > 0 ? 'PENDING' : 'PAID',
      items: targetOrders.flatMap((o) => o.items),
      room: { id: roomId || '', number: roomNumber || '' },
      booking: { guest: { id: '', name: guestName || 'Guest' } },
      createdAt: targetOrders[0]?.createdAt || new Date().toISOString(),
      notes: targetOrders.map((o) => o.notes).filter(Boolean).join('; ') || undefined,
    }

    triggerPrintFoodBill(aggregatedOrder, settings)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Utensils className="h-5 w-5 text-emerald-600" />
            Fooding Bill · Room {roomNumber || '—'}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-3 text-xs">
            {guestName && (
              <span className="flex items-center gap-1 font-medium text-foreground">
                <User className="h-3 w-3 text-muted-foreground" /> {guestName}
              </span>
            )}
            <span className="flex items-center gap-1">
              <BedDouble className="h-3 w-3 text-muted-foreground" /> Room Service
            </span>
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Total Pending Fooding Summary */}
            <div className="rounded-xl border border-emerald-300 bg-emerald-50/70 p-4 dark:border-emerald-900 dark:bg-emerald-950/30 space-y-2">
              <div className="flex items-center justify-between text-xs text-emerald-900 dark:text-emerald-300 font-medium">
                <span className="flex items-center gap-1.5">
                  <ShoppingBag className="h-4 w-4 text-emerald-600" />
                  Active Room Service Fooding
                </span>
                <Badge className="bg-emerald-600 text-white text-[10px] font-bold">
                  {pendingOrders.length} Pending Order{pendingOrders.length === 1 ? '' : 's'}
                </Badge>
              </div>

              <div className="flex items-baseline justify-between pt-1">
                <span className="text-sm font-semibold text-muted-foreground">Fooding Amount Due:</span>
                <span className="text-2xl font-extrabold text-emerald-700 dark:text-emerald-400">
                  {formatINR(pendingFoodTotal)}
                </span>
              </div>
            </div>

            {/* List of Orders / Items */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Fooding Items &amp; Orders
                </Label>
                {allItems.length > 0 && (
                  <span className="text-xs font-semibold text-muted-foreground">
                    {allItems.reduce((s, it) => s + it.quantity, 0)} total item(s)
                  </span>
                )}
              </div>

              {orders.length === 0 ? (
                <div className="rounded-xl border-2 border-dashed py-8 text-center space-y-2.5">
                  <p className="text-sm text-muted-foreground">No food orders recorded for this room.</p>
                  {onOpenNewOrder && (
                    <Button
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold gap-1"
                      onClick={() => {
                        onOpenChange(false)
                        onOpenNewOrder()
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" /> Take Food Order for Room {roomNumber}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {orders.map((o, idx) => (
                    <div
                      key={o.id}
                      className={`rounded-lg border p-3 text-xs space-y-2 ${
                        o.status === 'PENDING'
                          ? 'border-emerald-300 bg-card shadow-sm dark:border-emerald-900'
                          : 'bg-muted/40 opacity-70'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-foreground">Order #{idx + 1}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatDateTime(o.createdAt)}
                          </span>
                        </div>
                        <Badge
                          variant={o.status === 'PENDING' ? 'default' : 'secondary'}
                          className={`text-[10px] font-bold ${o.status === 'PENDING' ? 'bg-orange-500 text-white' : ''}`}
                        >
                          {o.status === 'PENDING' ? 'PENDING (ON ROOM)' : o.status}
                        </Badge>
                      </div>

                      {/* Itemized Table for this order */}
                      <div className="space-y-1 divide-y divide-border/40">
                        {o.items.map((it, itIdx) => (
                          <div key={it.id || itIdx} className="flex justify-between pt-1 text-xs">
                            <span className="font-medium text-foreground">
                              {it.name} <span className="text-muted-foreground">× {it.quantity}</span>
                            </span>
                            <span className="font-semibold text-foreground">
                              {formatINR(it.price * it.quantity)}
                            </span>
                          </div>
                        ))}
                      </div>

                      {o.notes && (
                        <p className="text-[11px] italic text-amber-700 dark:text-amber-400">
                          Note: {o.notes}
                        </p>
                      )}

                      <Separator />

                      <div className="flex items-center justify-between pt-0.5">
                        <span className="font-bold">Order Total: {formatINR(o.total)}</span>
                        {o.status === 'PENDING' && (
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 px-2 text-[11px] font-semibold"
                              onClick={() => triggerPrintFoodBill(o, settings)}
                              title="Print this order slip"
                            >
                              <Printer className="h-3 w-3 mr-1" /> KOT
                            </Button>
                            <Button
                              size="sm"
                              className="h-6 bg-emerald-600 hover:bg-emerald-700 text-white px-2 text-[11px] font-bold"
                              onClick={() => markPaid(o.id, 'CASH')}
                              disabled={busyId === o.id}
                            >
                              {busyId === o.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Check className="h-3 w-3 mr-1" />
                              )}
                              Pay Cash
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Action Buttons Footer */}
            <div className="space-y-2 pt-2 border-t">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="font-bold text-xs gap-1.5 h-10"
                  onClick={handlePrintAllFoodBill}
                  disabled={orders.length === 0}
                >
                  <Printer className="h-4 w-4" /> Print Fooding Bill
                </Button>

                {onOpenLodgingBill && (
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 h-10"
                    onClick={() => {
                      onOpenChange(false)
                      onOpenLodgingBill()
                    }}
                  >
                    <Receipt className="h-4 w-4" /> Lodging Checkout Bill
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
