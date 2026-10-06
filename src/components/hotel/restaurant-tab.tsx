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
import {
  Loader2,
  Plus,
  Minus,
  ShoppingBag,
  Check,
  Trash2,
  Download,
  Printer,
  Receipt,
  Search,
  Hash,
  Utensils,
  BedDouble,
  RotateCcw,
  SendHorizontal,
  PackageCheck,
} from 'lucide-react'

export interface MenuItem {
  id: string
  name: string
  category: string
  price: number
  available: boolean
  itemNumber?: number
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
  menuItemId?: string | null
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
  const [activeTab, setActiveTab] = useState('order')
  const [rawMenu, setRawMenu] = useState<MenuItem[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [orders, setOrders] = useState<FoodOrder[]>([])
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [orderFilter, setOrderFilter] = useState('ALL') // ALL | PENDING | ROOM | DIRECT
  const [printOrder, setPrintOrder] = useState<FoodOrder | null>(null)

  // Order building state (POS)
  const [orderType, setOrderType] = useState<'ROOM' | 'DIRECT'>('ROOM')
  const [selectedBookingId, setSelectedBookingId] = useState('')
  const [orderNotes, setOrderNotes] = useState('')
  const [cart, setCart] = useState<Record<string, { menuItemId: string; itemNumber: number; name: string; price: number; quantity: number }>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [quickNumInput, setQuickNumInput] = useState('')
  const [menuSearch, setMenuSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('ALL')
  const [lastAddedFeedback, setLastAddedFeedback] = useState<{ number: number; name: string } | null>(null)

  // Add menu item form
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
      setRawMenu(menuData)
      setBookings(bookingData)
      setOrders(orderData)
      setSettings(settingsData)
      if (bookingData.length > 0 && !selectedBookingId) {
        setSelectedBookingId(bookingData[0].id)
      }
    } finally {
      setLoading(false)
    }
  }, [selectedBookingId])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  // Deterministically assign 1-based Menu Item Numbers across sorted menu items
  const menu: MenuItem[] = useMemo(() => {
    return rawMenu.map((item, idx) => ({
      ...item,
      itemNumber: idx + 1,
    }))
  }, [rawMenu])

  // Lookup map: number -> MenuItem
  const menuByNumber = useMemo(() => {
    const map = new Map<number, MenuItem>()
    menu.forEach((item) => {
      if (item.itemNumber) map.set(item.itemNumber, item)
    })
    return map
  }, [menu])

  // Lookup map: id -> MenuItem
  const menuById = useMemo(() => {
    const map = new Map<string, MenuItem>()
    menu.forEach((item) => {
      map.set(item.id, item)
    })
    return map
  }, [menu])

  const categories = useMemo(() => {
    const cats = [...new Set(menu.map((m) => m.category))]
    return cats
  }, [menu])

  const cartTotal = useMemo(
    () => Object.values(cart).reduce((s, it) => s + it.price * it.quantity, 0),
    [cart]
  )

  const cartItemCount = useMemo(
    () => Object.values(cart).reduce((s, it) => s + it.quantity, 0),
    [cart]
  )

  // Add item to cart by MenuItem object
  function addToCart(item: MenuItem, qty = 1) {
    if (!item.available) return
    const num = item.itemNumber || 0
    setCart((prev) => {
      const cur = prev[item.id]
      return {
        ...prev,
        [item.id]: {
          menuItemId: item.id,
          itemNumber: num,
          name: item.name,
          price: item.price,
          quantity: (cur?.quantity || 0) + qty,
        },
      }
    })
    setLastAddedFeedback({ number: num, name: item.name })
    setTimeout(() => {
      setLastAddedFeedback((cur) => (cur?.number === num ? null : cur))
    }, 2000)
    setError('')
  }

  // Remove item from cart
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

  function clearCart() {
    setCart({})
    setError('')
  }

  // Quick order by number input handler (e.g. typing "1" or "1, 3, 5" or "2*3")
  function handleQuickNumberSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault()
    const trimmed = quickNumInput.trim()
    if (!trimmed) return

    // Support comma/space separated inputs (e.g. "1, 4, 7" or "1*2, 3")
    const tokens = trimmed.split(/[\s,]+/).filter(Boolean)
    let addedCount = 0

    for (const tok of tokens) {
      let itemNum = parseInt(tok)
      let qty = 1
      if (tok.includes('*') || tok.toLowerCase().includes('x')) {
        const parts = tok.toLowerCase().split(/[*x]/)
        itemNum = parseInt(parts[0])
        qty = parseInt(parts[1]) || 1
      }

      if (!isNaN(itemNum)) {
        const target = menuByNumber.get(itemNum)
        if (target && target.available) {
          addToCart(target, qty)
          addedCount++
        }
      }
    }

    if (addedCount > 0) {
      setQuickNumInput('')
    } else {
      setError(`No available menu item found for number: ${trimmed}`)
    }
  }

  // Preview match for current quick input
  const quickMatchItem = useMemo(() => {
    const num = parseInt(quickNumInput.trim())
    if (!isNaN(num)) {
      return menuByNumber.get(num) || null
    }
    return null
  }, [quickNumInput, menuByNumber])

  // Filtered menu grid
  const filteredMenu = useMemo(() => {
    return menu.filter((item) => {
      const matchesCat = selectedCategory === 'ALL' || item.category === selectedCategory
      const q = menuSearch.toLowerCase().trim()
      if (!q) return matchesCat
      const matchesNum = String(item.itemNumber) === q || `#${item.itemNumber}` === q
      const matchesText = item.name.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)
      return matchesCat && (matchesNum || matchesText)
    })
  }, [menu, selectedCategory, menuSearch])

  // Place Order Action
  async function placeOrder() {
    const items = Object.values(cart).map((it) => ({
      menuItemId: it.menuItemId,
      name: `[#${it.itemNumber}] ${it.name}`,
      price: it.price,
      quantity: it.quantity,
    }))

    if (items.length === 0) {
      setError('Add at least one item to the order')
      return
    }

    if (orderType === 'ROOM' && !selectedBookingId) {
      setError('Please select an active guest room for room service')
      return
    }

    setSaving(true)
    setError('')
    try {
      const selectedBooking = orderType === 'ROOM' ? bookings.find((b) => b.id === selectedBookingId) : null
      const createdOrder = await apiAs<FoodOrder>('/api/orders', getCachedUser(), {
        method: 'POST',
        body: JSON.stringify({
          ...(orderType === 'ROOM'
            ? { bookingId: selectedBooking?.id, roomId: selectedBooking?.room.id }
            : {}),
          notes: orderNotes.trim() || undefined,
          items,
        }),
      })

      setCart({})
      setOrderNotes('')
      await load()
      onDataChanged()

      // Prompt printing KOT / receipt
      setPrintOrder(createdOrder)
      setActiveTab('orders')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Order placement failed')
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
    setRawMenu((prev) =>
      prev.map((m) => (m.id === item.id ? { ...m, available: nextAvailable } : m))
    )
    try {
      await api('/api/menu', { method: 'PATCH', body: JSON.stringify({ id: item.id, available: nextAvailable }) })
    } catch (e) {
      setRawMenu((prev) =>
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
      setRawMenu((prev) => [...prev, createdItem])
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
    const targetItem = rawMenu.find((m) => m.id === id)
    setRawMenu((prev) => prev.filter((m) => m.id !== id))
    try {
      await api(`/api/menu?id=${id}`, { method: 'DELETE' })
    } catch (e) {
      if (targetItem) setRawMenu((prev) => [...prev, targetItem])
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
      case 'DIRECT':
        return orders.filter((o) => !o.room)
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
      ['Time', 'Type', 'Room / Guest', 'Items', 'Total', 'Status', 'Taken By'],
      filteredOrders.map((o) => [
        formatDateTime(o.createdAt),
        o.room ? 'Room Service' : 'Direct / Parcel',
        o.room ? `Room ${o.room.number} (${o.booking?.guest?.name || '-'})` : 'Direct Takeaway',
        o.items.map((it) => `${it.name} x${it.quantity}`).join('; '),
        o.total,
        o.status,
        o.createdBy || '',
      ])
    )
  }

  return (
    <div className="space-y-4">
      {/* Header Feedback Banner */}
      {lastAddedFeedback && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-xl animate-in fade-in slide-in-from-bottom-3">
          <Badge className="bg-white text-emerald-800 font-bold px-1.5 py-0.5 text-xs">
            #{lastAddedFeedback.number}
          </Badge>
          <span>{lastAddedFeedback.name} added to order</span>
          <Check className="h-4 w-4" />
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="w-full grid grid-cols-3 sm:w-auto sm:inline-flex">
            <TabsTrigger value="order" className="gap-1.5">
              <Utensils className="h-3.5 w-3.5" />
              <span>Room Service Order</span>
              {cartItemCount > 0 && (
                <span className="rounded-full bg-emerald-600 px-1.5 py-0.2 text-[11px] font-bold text-white">
                  {cartItemCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="orders" className="gap-1.5">
              <span>Orders</span>
              {pendingOrders.length > 0 && (
                <span className="rounded-full bg-red-600 px-1.5 py-0.2 text-[10px] font-bold text-white">
                  {pendingOrders.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="menu" className="gap-1.5">
              <span>Menu Items</span>
              <span className="text-[11px] text-muted-foreground">({menu.length})</span>
            </TabsTrigger>
          </TabsList>

          {cartTotal > 0 && activeTab !== 'order' && (
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 font-semibold"
              onClick={() => setActiveTab('order')}
            >
              <ShoppingBag className="h-4 w-4" /> Order: {formatINR(cartTotal)} ({cartItemCount})
            </Button>
          )}
        </div>

        {/* ================= POS NEW ORDER TAB ================= */}
        <TabsContent value="order" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Left side: Menu items & Number ordering (7-8 cols) */}
            <div className="space-y-4 lg:col-span-7 xl:col-span-8">
              {/* Speed / Fast Numeric Ordering Bar */}
              <Card className="border-emerald-200 dark:border-emerald-900/60 bg-gradient-to-r from-emerald-50/50 to-transparent dark:from-emerald-950/20">
                <CardContent className="p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="quick-number-input" className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                      <Hash className="h-4 w-4 text-emerald-600" /> Fast Order By Menu Number
                    </Label>
                    <span className="text-[11px] text-muted-foreground">
                      Click any number below or type &amp; Enter
                    </span>
                  </div>

                  <form onSubmit={handleQuickNumberSubmit} className="flex gap-2">
                    <div className="relative flex-1">
                      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-muted-foreground font-mono font-bold text-sm">
                        #
                      </div>
                      <Input
                        id="quick-number-input"
                        type="text"
                        placeholder="Type menu number (e.g. 1, 2, 5...)"
                        value={quickNumInput}
                        onChange={(e) => setQuickNumInput(e.target.value)}
                        className="pl-7 font-mono font-medium text-sm h-10 border-emerald-300 dark:border-emerald-800 focus-visible:ring-emerald-500"
                      />
                    </div>
                    <Button
                      type="submit"
                      disabled={!quickNumInput.trim()}
                      className="bg-emerald-600 hover:bg-emerald-700 h-10 px-4 font-semibold gap-1"
                    >
                      <Plus className="h-4 w-4" /> Add #{quickNumInput.trim() || '?'}
                    </Button>
                  </form>

                  {/* Live Match Preview */}
                  {quickMatchItem && (
                    <div className="flex items-center justify-between rounded-md bg-white dark:bg-zinc-900 border border-emerald-300 dark:border-emerald-800 px-3 py-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                          #{quickMatchItem.itemNumber}
                        </span>
                        <span className="font-semibold">{quickMatchItem.name}</span>
                        <span className="text-muted-foreground">({quickMatchItem.category})</span>
                      </div>
                      <span className="font-bold text-emerald-600">{formatINR(quickMatchItem.price)}</span>
                    </div>
                  )}

                  {/* Quick Number Buttons Bar */}
                  <div className="space-y-1 pt-1">
                    <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                      Tap Menu Number to Add:
                    </p>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-1 rounded-md bg-background/80 border">
                      {menu.map((item) => {
                        const inCartQty = cart[item.id]?.quantity || 0
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => addToCart(item)}
                            disabled={!item.available}
                            title={`#${item.itemNumber} ${item.name} - ${formatINR(item.price)}`}
                            className={`group relative flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all shadow-sm ${
                              !item.available
                                ? 'opacity-40 cursor-not-allowed bg-muted text-muted-foreground'
                                : inCartQty > 0
                                  ? 'bg-emerald-600 text-white hover:bg-emerald-700 ring-2 ring-emerald-400'
                                  : 'bg-card hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border text-foreground hover:border-emerald-400'
                            }`}
                          >
                            <span className="font-mono font-extrabold text-[11px] text-emerald-600 dark:text-emerald-400 group-hover:text-emerald-700 dark:group-hover:text-emerald-300">
                              #{item.itemNumber}
                            </span>
                            <span className="truncate max-w-[90px]">{item.name}</span>
                            {inCartQty > 0 && (
                              <span className="ml-0.5 rounded-full bg-white px-1 text-[10px] font-bold text-emerald-800">
                                {inCartQty}
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Category Pills & Search */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
                  <Button
                    size="sm"
                    variant={selectedCategory === 'ALL' ? 'default' : 'outline'}
                    className={`h-8 text-xs font-semibold ${selectedCategory === 'ALL' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
                    onClick={() => setSelectedCategory('ALL')}
                  >
                    All ({menu.length})
                  </Button>
                  {categories.map((cat) => {
                    const count = menu.filter((m) => m.category === cat).length
                    return (
                      <Button
                        key={cat}
                        size="sm"
                        variant={selectedCategory === cat ? 'default' : 'outline'}
                        className={`h-8 text-xs font-semibold whitespace-nowrap ${selectedCategory === cat ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
                        onClick={() => setSelectedCategory(cat)}
                      >
                        {cat} ({count})
                      </Button>
                    )
                  })}
                </div>

                <div className="relative w-full sm:w-48">
                  <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search menu / #..."
                    value={menuSearch}
                    onChange={(e) => setMenuSearch(e.target.value)}
                    className="h-8 pl-8 text-xs"
                  />
                </div>
              </div>

              {/* Visual Menu Cards Grid with Clickable Number Badges */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {filteredMenu.map((item) => {
                  const inCartQty = cart[item.id]?.quantity || 0
                  return (
                    <Card
                      key={item.id}
                      className={`relative overflow-hidden transition-all border ${
                        !item.available
                          ? 'opacity-50 bg-muted/40'
                          : inCartQty > 0
                            ? 'border-emerald-500 shadow-md ring-1 ring-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/10'
                            : 'hover:border-emerald-400 hover:shadow-sm'
                      }`}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            {/* Clickable Number Button */}
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => addToCart(item)}
                                disabled={!item.available}
                                title={`Click #${item.itemNumber} to add`}
                                className="inline-flex items-center justify-center rounded-md bg-emerald-100 px-2 py-0.5 font-mono text-xs font-black text-emerald-800 hover:bg-emerald-200 active:scale-95 transition-all dark:bg-emerald-900/60 dark:text-emerald-300 dark:hover:bg-emerald-800"
                              >
                                #{item.itemNumber}
                              </button>
                              <span className="text-[10px] uppercase font-semibold text-muted-foreground truncate">
                                {item.category}
                              </span>
                            </div>

                            <p
                              className="mt-1 font-semibold text-sm leading-tight line-clamp-1 cursor-pointer hover:text-emerald-600"
                              onClick={() => addToCart(item)}
                              title={item.name}
                            >
                              {item.name}
                            </p>
                            <p className="mt-0.5 text-sm font-bold text-emerald-700 dark:text-emerald-400">
                              {formatINR(item.price)}
                            </p>
                          </div>

                          {/* Order / Quantity Controls */}
                          <div className="flex flex-col items-end gap-1">
                            {!item.available ? (
                              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                                Out of Stock
                              </Badge>
                            ) : inCartQty > 0 ? (
                              <div className="flex items-center gap-1 rounded-lg border bg-background p-0.5 shadow-sm">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                  onClick={() => removeFromCart(item)}
                                >
                                  <Minus className="h-3 w-3" />
                                </Button>
                                <span className="w-5 text-center font-mono text-xs font-bold text-emerald-700 dark:text-emerald-400">
                                  {inCartQty}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-emerald-600 hover:text-emerald-700"
                                  onClick={() => addToCart(item)}
                                >
                                  <Plus className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs font-semibold hover:bg-emerald-600 hover:text-white hover:border-emerald-600 transition-all gap-1"
                                onClick={() => addToCart(item)}
                              >
                                <Plus className="h-3 w-3" /> Add
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>

              {filteredMenu.length === 0 && (
                <div className="rounded-xl border-2 border-dashed py-12 text-center text-sm text-muted-foreground">
                  No menu items found for &quot;{menuSearch}&quot; in {selectedCategory}.
                </div>
              )}
            </div>

            {/* Right side: Active POS Order / Cart Workspace (4-5 cols) */}
            <div className="space-y-4 lg:col-span-5 xl:col-span-4">
              <Card className="sticky top-4 border-2 border-emerald-500/30 shadow-md">
                <CardContent className="p-4 space-y-3.5">
                  <div className="flex items-center justify-between border-b pb-2.5">
                    <div className="flex items-center gap-2">
                      <ShoppingBag className="h-5 w-5 text-emerald-600" />
                      <h3 className="font-bold text-base">Active Order Cart</h3>
                    </div>
                    {cartItemCount > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                        onClick={clearCart}
                      >
                        <RotateCcw className="mr-1 h-3 w-3" /> Clear
                      </Button>
                    )}
                  </div>

                  {/* Order Destination Selector: Room Service or Direct Takeaway */}
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                      <Button
                        type="button"
                        size="sm"
                        variant={orderType === 'ROOM' ? 'default' : 'ghost'}
                        className={`h-8 text-xs font-bold gap-1.5 ${orderType === 'ROOM' ? 'bg-zinc-800 text-white dark:bg-zinc-700' : ''}`}
                        onClick={() => setOrderType('ROOM')}
                      >
                        <BedDouble className="h-3.5 w-3.5" /> Room Service
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={orderType === 'DIRECT' ? 'default' : 'ghost'}
                        className={`h-8 text-xs font-bold gap-1.5 ${orderType === 'DIRECT' ? 'bg-zinc-800 text-white dark:bg-zinc-700' : ''}`}
                        onClick={() => setOrderType('DIRECT')}
                      >
                        <PackageCheck className="h-3.5 w-3.5" /> Direct / Takeaway
                      </Button>
                    </div>

                    {orderType === 'ROOM' ? (
                      <div className="space-y-1.5">
                        <Label htmlFor="pos-room-select" className="text-xs font-semibold text-muted-foreground">
                          Select Guest Room (Delivered to Room)
                        </Label>
                        {bookings.length > 0 ? (
                          <Select value={selectedBookingId} onValueChange={setSelectedBookingId}>
                            <SelectTrigger id="pos-room-select" className="h-9 text-xs">
                              <SelectValue placeholder="Select active guest room..." />
                            </SelectTrigger>
                            <SelectContent>
                              {bookings.map((b) => (
                                <SelectItem key={b.id} value={b.id}>
                                  Room {b.room.number} · {b.guest.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                            No active hotel guests currently checked in.
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-md bg-muted/60 p-2 text-xs text-muted-foreground">
                        Order will be prepared as a direct counter / parcel takeaway order.
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Cart Items List */}
                  <div className="space-y-2">
                    <Label className="text-xs font-semibold text-muted-foreground">Order Items ({cartItemCount})</Label>
                    <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1 divide-y">
                      {Object.values(cart).map((it) => (
                        <div key={it.menuItemId} className="flex items-center justify-between pt-1.5 text-xs">
                          <div className="min-w-0 flex-1 pr-2">
                            <div className="flex items-center gap-1.5 font-medium">
                              <span className="font-mono font-extrabold text-[11px] text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-1 rounded">
                                #{it.itemNumber}
                              </span>
                              <span className="truncate">{it.name}</span>
                            </div>
                            <div className="text-[11px] text-muted-foreground pl-6">
                              {formatINR(it.price)} × {it.quantity} = <span className="font-bold text-foreground">{formatINR(it.price * it.quantity)}</span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => {
                                const m = menuById.get(it.menuItemId)
                                if (m) removeFromCart(m)
                              }}
                            >
                              <Minus className="h-2.5 w-2.5" />
                            </Button>
                            <span className="w-5 text-center font-mono font-bold text-xs">{it.quantity}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => {
                                const m = menuById.get(it.menuItemId)
                                if (m) addToCart(m)
                              }}
                            >
                              <Plus className="h-2.5 w-2.5" />
                            </Button>
                          </div>
                        </div>
                      ))}

                      {Object.keys(cart).length === 0 && (
                        <div className="py-8 text-center text-xs text-muted-foreground">
                          Cart is empty. Click any menu number or item to start ordering.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Special Notes / Instructions */}
                  <div className="space-y-1">
                    <Label htmlFor="pos-order-notes" className="text-xs text-muted-foreground">
                      Kitchen Notes / Special Request (Optional)
                    </Label>
                    <Input
                      id="pos-order-notes"
                      placeholder="e.g. Less spicy, extra onions..."
                      value={orderNotes}
                      onChange={(e) => setOrderNotes(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>

                  {/* Total Amount Box */}
                  <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-3 border border-emerald-200 dark:border-emerald-900">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>Total Items</span>
                      <span className="font-bold text-foreground">{cartItemCount} item(s)</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between font-bold text-base">
                      <span>Total Amount:</span>
                      <span className="text-lg text-emerald-700 dark:text-emerald-400">
                        {formatINR(cartTotal)}
                      </span>
                    </div>
                  </div>

                  {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

                  {/* Place Order CTA Button */}
                  <Button
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-11 text-sm shadow-md"
                    onClick={placeOrder}
                    disabled={saving || cartItemCount === 0}
                  >
                    {saving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <SendHorizontal className="mr-2 h-4 w-4" />
                    )}
                    Place Order &amp; Print KOT ({formatINR(cartTotal)})
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* ================= ORDERS LIST TAB ================= */}
        <TabsContent value="orders" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={orderFilter} onValueChange={setOrderFilter}>
              <SelectTrigger className="h-9 w-[180px]" aria-label="Filter orders">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Orders</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="ROOM">Room Service</SelectItem>
                <SelectItem value="DIRECT">Direct / Takeaway</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="ml-auto gap-1" onClick={exportOrders}>
              <Download className="h-3.5 w-3.5" /> Export
            </Button>
          </div>

          {filteredOrders.length === 0 && (
            <div className="rounded-xl border-2 border-dashed py-12 text-center text-sm text-muted-foreground">
              No food orders match the selected filter.
            </div>
          )}

          {filteredOrders.map((o) => (
            <Card key={o.id} className={o.status === 'PENDING' ? 'border-orange-300 dark:border-orange-800 shadow-sm' : 'opacity-80'}>
              <CardContent className="p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {o.room ? (
                        <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-xs font-bold text-white dark:bg-zinc-600 flex items-center gap-1">
                          <BedDouble className="h-3 w-3" /> Room {o.room?.number}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 rounded-md bg-zinc-700 px-2 py-0.5 text-xs font-bold text-white dark:bg-zinc-600">
                          <PackageCheck className="h-3 w-3" /> Direct / Takeaway
                        </span>
                      )}
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

                    {/* Itemized list showing menu numbers if present */}
                    <p className="mt-1.5 text-xs font-medium text-foreground">
                      {o.items.map((it) => `${it.name} ×${it.quantity}`).join(', ')}
                    </p>
                    {o.notes && (
                      <p className="text-[11px] italic text-amber-700 dark:text-amber-400">
                        Note: {o.notes}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {formatDateTime(o.createdAt)}{o.createdBy ? ` · by ${o.createdBy}` : ''}
                    </p>
                  </div>

                  <div className="text-right flex flex-col items-end gap-1.5">
                    <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">{formatINR(o.total)}</p>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11px] gap-1"
                        onClick={() => setPrintOrder(o)}
                        title="Print Food Bill / KOT"
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
                              className="h-7 bg-emerald-600 px-2 text-[11px] hover:bg-emerald-700 font-bold"
                              onClick={() => markPaid(o, 'CASH')}
                              disabled={busyId === o.id}
                            >
                              {busyId === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />} Cash
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px] font-bold"
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

        {/* ================= MENU MANAGEMENT TAB ================= */}
        <TabsContent value="menu" className="mt-4 space-y-4">
          {/* Add Menu Item Card */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-bold flex items-center gap-1.5">
                <Plus className="h-4 w-4 text-emerald-600" /> Add New Menu Item
              </p>
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
                <Button type="submit" disabled={adding} className="bg-emerald-600 hover:bg-emerald-700 font-semibold">
                  {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />} Add Item
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Categorized Menu List with Menu Numbers */}
          {categories.map((cat) => (
            <div key={cat} className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <span>{cat}</span>
                <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px]">
                  {menu.filter((m) => m.category === cat).length}
                </span>
              </h4>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {menu
                  .filter((m) => m.category === cat)
                  .map((item) => {
                    const inCartQty = cart[item.id]?.quantity || 0
                    return (
                      <Card key={item.id} className={`transition-all ${!item.available ? 'opacity-50' : 'hover:border-emerald-300'}`}>
                        <CardContent className="flex items-center justify-between p-3 gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {/* Prominent Number Badge */}
                              <button
                                type="button"
                                onClick={() => {
                                  addToCart(item)
                                  setActiveTab('order')
                                }}
                                title="Click to order this item"
                                className="inline-flex items-center justify-center rounded-md bg-emerald-100 px-2 py-0.5 font-mono text-xs font-black text-emerald-800 hover:bg-emerald-200 transition-all dark:bg-emerald-900/60 dark:text-emerald-300"
                              >
                                #{item.itemNumber}
                              </button>
                              <p className="truncate text-sm font-semibold">{item.name}</p>
                            </div>
                            <p className="mt-0.5 pl-7 text-sm font-bold text-emerald-700 dark:text-emerald-400">
                              {formatINR(item.price)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {/* Fast Add to Order Button */}
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs font-semibold gap-1"
                              onClick={() => {
                                addToCart(item)
                              }}
                              disabled={!item.available}
                              title="Add to active order"
                            >
                              <Plus className="h-3 w-3" />
                              {inCartQty > 0 ? (
                                <span className="font-bold text-emerald-600">({inCartQty})</span>
                              ) : (
                                'Order'
                              )}
                            </Button>
                            <Switch checked={item.available} onCheckedChange={() => toggleAvailability(item)} title="Toggle availability" />
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => deleteMenuItem(item.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    )
                  })}
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>

      {/* Printable Food Bill / KOT Dialog */}
      <Dialog open={!!printOrder} onOpenChange={(o) => !o && setPrintOrder(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-emerald-600" /> Food Bill / KOT Receipt
            </DialogTitle>
            <DialogDescription>{printOrder && formatDateTime(printOrder.createdAt)}</DialogDescription>
          </DialogHeader>
          {printOrder && (
            <div className="space-y-3">
              <div className="print-area rounded-lg border p-4 text-sm bg-card">
                <div className="mb-3 text-center">
                  <p className="text-lg font-bold">
                    {settings.restaurantName || (settings.hotelName ? `${settings.hotelName} Kitchen & Room Service` : 'Ashirbad Lodge')}
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
                    KITCHEN ORDER TICKET &amp; RECEIPT
                  </p>
                </div>

                <div className="mb-3 space-y-0.5 border-y py-2 text-xs text-muted-foreground">
                  <p>Order ID: #{printOrder.id.slice(-6).toUpperCase()} · Date: {formatDateTime(printOrder.createdAt)}</p>
                  {printOrder.room ? (
                    <p className="font-semibold text-foreground">Location: Room Service (Room {printOrder.room.number})</p>
                  ) : (
                    <p className="font-semibold text-foreground">Location: Direct / Takeaway</p>
                  )}
                  {printOrder.booking?.guest?.name && (
                    <p>Guest: {printOrder.booking.guest.name}</p>
                  )}
                  {printOrder.notes && (
                    <p className="font-medium text-amber-700 dark:text-amber-400">Note: {printOrder.notes}</p>
                  )}
                  {printOrder.createdBy && <p>Taken By: {printOrder.createdBy}</p>}
                </div>

                {/* Itemized Table */}
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground font-semibold">
                      <th className="py-1">Menu Item</th>
                      <th className="py-1 text-center">Qty</th>
                      <th className="py-1 text-right">Price</th>
                      <th className="py-1 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {printOrder.items.map((it, idx) => (
                      <tr key={it.id || idx} className="border-b/50">
                        <td className="py-1.5 font-medium">{it.name}</td>
                        <td className="py-1.5 text-center font-bold">{it.quantity}</td>
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
                    <span>Status / Payment</span>
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
                  Thank you for ordering with us!
                </p>
              </div>

              <Button className="w-full print:hidden bg-emerald-600 hover:bg-emerald-700" onClick={() => triggerPrintFoodBill(printOrder, settings)}>
                <Printer className="mr-2 h-4 w-4" /> Print Food Bill / KOT
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
