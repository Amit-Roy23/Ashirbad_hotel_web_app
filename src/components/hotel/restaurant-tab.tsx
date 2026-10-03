'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, apiAs, formatINR, formatDateTime, formatDate, exportCSV } from '@/lib/hotel-utils'
import { triggerPrintFoodBill } from '@/lib/print-invoice'
import { getCachedUser } from './user-context'
import { Loader2, Plus, UtensilsCrossed, Minus, ShoppingBag, Check, Trash2, Store, Download, Printer, Receipt } from 'lucide-react'

interface MenuItem {
  id: string
  name: string
  category: string
  price: number
  available: boolean
}

interface Room {
  id: string
  number: string
  status: string
}

interface Booking {
  id: string
  status: string
  room: Room
  guest: { id: string; name: string }
}

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
  tableNo?: string
  notes?: string
  createdBy?: string | null
  items: OrderItem[]
  room?: Room | null
  booking?: { guest: Guest } | null
  createdAt: string
}

interface Guest {
  id: string
  name: string
  phone: string
}

export function RestaurantTab({ refreshKey, onDataChanged }: { refreshKey: number; onDataChanged: () => void }) {
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [orders, setOrders] = useState<FoodOrder[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [orderFilter, setOrderFilter] = useState('ALL') // ALL | PENDING | ROOM | TABLE
  const [printOrder, setPrintOrder] = useState<FoodOrder | null>(null)

  // New order state
  const [orderOpen, setOrderOpen] = useState(false)
  const [tableNo, setTableNo] = useState('')
  const [cart, setCart] = useState<Record<string, { name: string; price: number; quantity: number }>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Add menu item
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('Main Course')
  const [newPrice, setNewPrice] = useState('')
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    try {
      const [menuData, bookingData, orderData, settingsData] = await Promise.all([
        api<MenuItem[]>('/api/menu'),
        api<Booking[]>('/api/bookings?status=ACTIVE'),
        api<FoodOrder[]>('/api/orders'),
        api<Record<string, string>>('/api/settings'),
      ])
      setMenu(menuData)
      setBookings(bookingData)
      setOrders(orderData)
      setSettings(settingsData)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const categories = useMemo(() => [...new Set(menu.map((m) => m.category))], [menu])
  const cartTotal = useMemo(
    () => Object.values(cart).reduce((s, it) => s + it.price * it.quantity, 0),
    [cart]
  )

  function addToCart(item: MenuItem) {
    setCart((prev) => ({
      ...prev,
      [item.id]: {
        name: item.name,
        price: item.price,
        quantity: (prev[item.id]?.quantity || 0) + 1,
      },
    }))
  }

  function removeFromCart(item: MenuItem) {
    setCart((prev) => {
      const cur = prev[item.id]
      if (!cur) return prev
      if (cur.quantity <= 1) {
        const next = { ...prev }
        delete next[item.id]
        return next
      }
      return { ...prev, [item.id]: { ...cur, quantity: cur.quantity - 1 } }
    })
  }

  async function placeOrder() {
    const items = Object.entries(cart).map(([menuItemId, it]) => ({
      menuItemId,
      name: it.name,
      price: it.price,
      quantity: it.quantity,
    }))
    if (items.length === 0) {
      setError('Add at least one item')
      return
    }
    if (!tableNo.trim()) {
      setError('Enter table number')
      return
    }
    setSaving(true)
    setError('')
    try {
      await apiAs('/api/orders', getCachedUser(), {
        method: 'POST',
        body: JSON.stringify({
          tableNo: tableNo.trim(),
          items,
        }),
      })
      setCart({})
      setTableNo('')
      setOrderOpen(false)
      await load()
      onDataChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Order failed')
    } finally {
      setSaving(false)
    }
  }

  async function markPaid(o: FoodOrder, method: string) {
    setBusyId(o.id)
    try {
      await apiAs('/api/orders', getCachedUser(), { method: 'PATCH', body: JSON.stringify({ id: o.id, action: 'paid', method }) })
      await load()
      onDataChanged()
    } finally {
      setBusyId(null)
    }
  }

  async function toggleAvailability(item: MenuItem) {
    const nextAvailable = !item.available
    setMenu((prev) =>
      prev.map((m) => (m.id === item.id ? { ...m, available: nextAvailable } : m))
    )
    try {
      await api('/api/menu', { method: 'PATCH', body: JSON.stringify({ id: item.id, available: nextAvailable }) })
    } catch (e) {
      setMenu((prev) =>
        prev.map((m) => (m.id === item.id ? { ...m, available: item.available } : m))
      )
      alert(e instanceof Error ? e.message : 'Failed to update availability')
    }
  }

  async function addMenuItem() {
    const trimmedName = newName.trim()
    const parsedPrice = parseFloat(newPrice)

    if (!trimmedName) {
      alert('Please enter an item name.')
      return
    }
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      alert('Please enter a valid price greater than 0.')
      return
    }

    setAdding(true)
    try {
      const createdItem = await api<MenuItem>('/api/menu', {
        method: 'POST',
        body: JSON.stringify({ name: trimmedName, category: newCategory, price: parsedPrice }),
      })
      setMenu((prev) => [...prev, createdItem])
      setNewName('')
      setNewPrice('')
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to add menu item')
    } finally {
      setAdding(false)
    }
  }

  async function deleteMenuItem(id: string) {
    if (!confirm('Delete this menu item?')) return
    const targetItem = menu.find((m) => m.id === id)
    setMenu((prev) => prev.filter((m) => m.id !== id))
    try {
      await api(`/api/menu?id=${id}`, { method: 'DELETE' })
    } catch (e) {
      if (targetItem) setMenu((prev) => [...prev, targetItem])
      alert(e instanceof Error ? e.message : 'Failed to delete item')
    }
  }

  const pendingOrders = orders.filter((o) => o.status === 'PENDING')
  const filteredOrders = useMemo(() => {
    switch (orderFilter) {
      case 'PENDING':
        return pendingOrders
      case 'ROOM':
        return orders.filter((o) => !!o.room)
      case 'TABLE':
        return orders.filter((o) => !o.room && !!o.tableNo)
      default:
        return orders
    }
  }, [orders, pendingOrders, orderFilter])

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  function exportOrders() {
    exportCSV(
      'food-orders.csv',
      ['Time', 'Type', 'Location', 'Items', 'Total', 'Status', 'Taken By'],
      filteredOrders.map((o) => [
        formatDateTime(o.createdAt),
        o.room ? 'Room Service' : 'Table',
        o.room ? `Room ${o.room.number}` : `Table ${o.tableNo || '-'}`,
        o.items.map((it) => `${it.name} x${it.quantity}`).join('; '),
        o.total,
        o.status,
        o.createdBy || '',
      ])
    )
  }

  return (
    <div className="space-y-4">
      <Tabs defaultValue="order">
        <TabsList className="w-full grid grid-cols-3 sm:w-auto sm:inline-flex">
          <TabsTrigger value="order">New Order</TabsTrigger>
          <TabsTrigger value="orders">
            Orders {pendingOrders.length > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-[10px] text-white">{pendingOrders.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="menu">Menu</TabsTrigger>
        </TabsList>

        {/* New Order */}
        <TabsContent value="order" className="mt-4">
          <Card>
            <CardContent className="p-4">
              <Button className="w-full bg-emerald-600 hover:bg-emerald-700 sm:w-auto" onClick={() => setOrderOpen(true)}>
                <Plus className="mr-2 h-4 w-4" /> Take New Food Order
              </Button>
              {cartTotal > 0 && (
                <p className="mt-3 text-sm text-orange-600 font-medium">Cart total: {formatINR(cartTotal)}</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Orders list */}
        <TabsContent value="orders" className="mt-4 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={orderFilter} onValueChange={setOrderFilter}>
              <SelectTrigger className="h-9 w-[170px]" aria-label="Filter orders">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Orders</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="ROOM">Room Service</SelectItem>
                <SelectItem value="TABLE">Table (walk-in)</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="ml-auto gap-1" onClick={exportOrders}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </div>
          {filteredOrders.length === 0 && (
            <div className="rounded-xl border-2 border-dashed py-10 text-center text-sm text-muted-foreground">
              No food orders match.
            </div>
          )}
          {filteredOrders.map((o) => (
            <Card key={o.id} className={o.status === 'PENDING' ? 'border-orange-300 dark:border-orange-800' : 'opacity-75'}>
              <CardContent className="p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {o.room ? (
                        <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-bold text-white dark:bg-zinc-600">R-{o.room?.number}</span>
                      ) : o.tableNo ? (
                        <span className="flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-bold text-white dark:bg-zinc-600">
                          <Store className="h-3 w-3" /> T-{o.tableNo}
                        </span>
                      ) : null}
                      <Badge
                        className={
                          o.status === 'PENDING'
                            ? 'bg-orange-500 text-[10px]'
                            : o.status === 'ADDED_TO_BILL'
                              ? 'bg-emerald-600 text-[10px]'
                              : 'bg-zinc-500 text-[10px]'
                        }
                      >
                        {o.status === 'PENDING' ? 'PENDING' : o.status === 'ADDED_TO_BILL' ? 'ADDED TO ROOM BILL' : 'PAID'}
                      </Badge>
                    </div>
                    <p className="mt-1.5 truncate text-xs text-muted-foreground">
                      {o.items.map((it) => `${it.name} ×${it.quantity}`).join(', ')}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDateTime(o.createdAt)}{o.createdBy ? ` · by ${o.createdBy}` : ''}
                    </p>
                  </div>
                  <div className="text-right flex flex-col items-end gap-1.5">
                    <p className="text-sm font-bold">{formatINR(o.total)}</p>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px] gap-1"
                        onClick={() => setPrintOrder(o)}
                        title="Print Restaurant Bill"
                      >
                        <Printer className="h-3 w-3" /> Bill
                      </Button>
                      {o.status === 'PENDING' && (
                        o.booking ? (
                          <span className="text-[10px] text-muted-foreground">Will merge with room bill</span>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              className="h-7 bg-emerald-600 px-2 text-[11px] hover:bg-emerald-700"
                              onClick={() => markPaid(o, 'CASH')}
                              disabled={busyId === o.id}
                            >
                              {busyId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />} Cash
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={() => markPaid(o, 'UPI')}
                              disabled={busyId === o.id}
                            >
                              UPI
                            </Button>
                          </>
                        )
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Menu management */}
        <TabsContent value="menu" className="mt-4 space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-semibold">Add Menu Item</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  addMenuItem()
                }}
                className="grid grid-cols-1 gap-2 sm:grid-cols-4"
              >
                <Input placeholder="Item name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <Select value={newCategory} onValueChange={setNewCategory}>
                  <SelectTrigger aria-label="Category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['Breakfast', 'Rice & Bread', 'Main Course', 'Snacks', 'Beverages', 'Dessert'].map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input type="number" placeholder="Price ₹" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
                <Button type="submit" disabled={adding} className="bg-emerald-600 hover:bg-emerald-700">
                  {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />} Add
                </Button>
              </form>
            </CardContent>
          </Card>

          {categories.map((cat) => (
            <div key={cat}>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{cat}</h4>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {menu
                  .filter((m) => m.category === cat)
                  .map((item) => (
                    <Card key={item.id} className={!item.available ? 'opacity-50' : ''}>
                      <CardContent className="flex items-center justify-between p-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{item.name}</p>
                          <p className="text-sm font-bold text-emerald-700">{formatINR(item.price)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Switch checked={item.available} onCheckedChange={() => toggleAvailability(item)} />
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => deleteMenuItem(item.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>

      {/* Order dialog */}
      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Food Order</DialogTitle>
            <DialogDescription>Create a restaurant table order</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="order-table-no" className="flex items-center gap-1.5 text-sm font-medium">
                <Store className="h-4 w-4 text-emerald-600" /> Table Number
              </Label>
              <Input
                id="order-table-no"
                placeholder="e.g. 1, 2, T1..."
                value={tableNo}
                onChange={(e) => setTableNo(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">Enter restaurant table number</p>
            </div>

            <div className="space-y-1">
              <Label>Items</Label>
              <div className="max-h-72 overflow-y-auto rounded-lg border p-2 space-y-2">
                {categories.map((cat) => (
                  <div key={cat}>
                    <p className="sticky top-0 bg-background py-1 text-[10px] font-bold uppercase text-muted-foreground">{cat}</p>
                    {menu
                      .filter((m) => m.category === cat && m.available)
                      .map((item) => {
                        const inCart = cart[item.id]?.quantity || 0
                        return (
                          <div key={item.id} className="flex items-center justify-between rounded-md px-1.5 py-1.5 hover:bg-muted">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm">{item.name}</p>
                              <p className="text-xs text-muted-foreground">{formatINR(item.price)}</p>
                            </div>
                            {inCart > 0 ? (
                              <div className="flex items-center gap-2">
                                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => removeFromCart(item)}>
                                  <Minus className="h-3 w-3" />
                                </Button>
                                <span className="w-5 text-center text-sm font-bold">{inCart}</span>
                                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => addToCart(item)}>
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => addToCart(item)}>
                                <Plus className="mr-0.5 h-3 w-3" /> Add
                              </Button>
                            )}
                          </div>
                        )
                      })}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-muted p-3">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <ShoppingBag className="h-4 w-4" /> Total
              </span>
              <span className="text-lg font-bold">{formatINR(cartTotal)}</span>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={placeOrder} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Place Order
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Printable Restaurant Bill Dialog */}
      <Dialog open={!!printOrder} onOpenChange={(o) => !o && setPrintOrder(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-emerald-600" /> Restaurant Bill / Receipt
            </DialogTitle>
            <DialogDescription>{printOrder && formatDateTime(printOrder.createdAt)}</DialogDescription>
          </DialogHeader>
          {printOrder && (
            <div className="space-y-3">
              <div className="print-area rounded-lg border p-4 text-sm">
                <div className="mb-3 text-center">
                  <p className="text-lg font-bold">
                    {settings.restaurantName || (settings.hotelName ? `${settings.hotelName} Restaurant` : 'Restaurant')}
                  </p>
                  {(settings.restaurantAddress || settings.hotelAddress) && (
                    <p className="text-xs text-muted-foreground">{settings.restaurantAddress || settings.hotelAddress}</p>
                  )}
                  {(settings.restaurantPhone || settings.hotelPhone) && (
                    <p className="text-xs text-muted-foreground">Ph: {settings.restaurantPhone || settings.hotelPhone}</p>
                  )}
                  {(settings.restaurantGstin || settings.hotelGstin) && (
                    <p className="text-xs text-muted-foreground">GSTIN / FSSAI: {settings.restaurantGstin || settings.hotelGstin}</p>
                  )}
                  <p className="mt-1.5 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                    RESTAURANT INVOICE &amp; KOT
                  </p>
                </div>

                <div className="mb-3 space-y-0.5 border-y py-2 text-xs text-muted-foreground">
                  <p>Order ID: #{printOrder.id.slice(-6).toUpperCase()} · Date: {formatDateTime(printOrder.createdAt)}</p>
                  {printOrder.room ? (
                    <p className="font-semibold text-foreground">Location: Room Service (Room {printOrder.room.number})</p>
                  ) : printOrder.tableNo ? (
                    <p className="font-semibold text-foreground">Location: Table {printOrder.tableNo}</p>
                  ) : null}
                  {printOrder.booking?.guest?.name && (
                    <p>Guest: {printOrder.booking.guest.name}</p>
                  )}
                  {printOrder.createdBy && <p>Taken By: {printOrder.createdBy}</p>}
                </div>

                {/* Itemized Table */}
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground font-semibold">
                      <th className="py-1">Item</th>
                      <th className="py-1 text-center">Qty</th>
                      <th className="py-1 text-right">Price</th>
                      <th className="py-1 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {printOrder.items.map((it, idx) => (
                      <tr key={it.id || idx} className="border-b/50">
                        <td className="py-1.5 font-medium">{it.name}</td>
                        <td className="py-1.5 text-center">{it.quantity}</td>
                        <td className="py-1.5 text-right">{formatINR(it.price)}</td>
                        <td className="py-1.5 text-right font-semibold">{formatINR(it.price * it.quantity)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="mt-3 space-y-1 pt-1">
                  <Separator />
                  <div className="flex justify-between font-bold text-sm pt-1">
                    <span>Total Amount</span>
                    <span className="text-emerald-700 dark:text-emerald-400">{formatINR(printOrder.total)}</span>
                  </div>
                  <div className="flex justify-between text-xs text-muted-foreground pt-1">
                    <span>Payment Method / Status</span>
                    <span className="font-semibold uppercase text-foreground">
                      {printOrder.status === 'PENDING'
                        ? printOrder.room
                          ? 'Added to Room Bill'
                          : 'PENDING'
                        : printOrder.status === 'ADDED_TO_BILL'
                          ? 'Merged into Room Bill'
                          : 'PAID'}
                    </span>
                  </div>
                </div>

                <p className="mt-4 text-center text-[10px] text-muted-foreground">
                  Thank you for dining with us! Please visit again.
                </p>
              </div>

              <Button className="w-full print:hidden bg-emerald-600 hover:bg-emerald-700" onClick={() => triggerPrintFoodBill(printOrder, settings)}>
                <Printer className="mr-2 h-4 w-4" /> Print Food Bill
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
