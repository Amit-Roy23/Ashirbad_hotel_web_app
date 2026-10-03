'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Dashboard } from '@/components/hotel/dashboard'
import { RoomsTab } from '@/components/hotel/rooms-tab'
import { BookingsTab } from '@/components/hotel/bookings-tab'
import { GuestsTab } from '@/components/hotel/guests-tab'
import { BillingTab } from '@/components/hotel/billing-tab'
import { RestaurantTab } from '@/components/hotel/restaurant-tab'
import { PaymentsTab } from '@/components/hotel/payments-tab'
import { StaffTab } from '@/components/hotel/staff-tab'
import { ExpensesTab } from '@/components/hotel/expenses-tab'
import { ReportsTab } from '@/components/hotel/reports-tab'
import { SettingsTab } from '@/components/hotel/settings-tab'
import { GlobalSearch } from '@/components/hotel/global-search'
import { LoginDialog } from '@/components/hotel/login-dialog'
import { UserProvider, useUser } from '@/components/hotel/user-context'
import { formatINR } from '@/lib/hotel-utils'
import {
  LayoutGrid,
  ClipboardList,
  Receipt,
  UtensilsCrossed,
  UsersRound,
  BookOpenCheck,
  Hotel,
  BedDouble,
  Contact,
  Wallet,
  TrendingDown,
  FileBarChart,
  Settings as SettingsIcon,
  Sun,
  Moon,
  Search,
  Menu,
  LogIn,
  LogOut,
  ShieldCheck,
} from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

const TABS = [
  { id: 'dashboard', label: 'Dashboard', component: Dashboard, icon: LayoutGrid },
  { id: 'rooms', label: 'Rooms', component: RoomsTab, icon: BedDouble },
  { id: 'bookings', label: 'Bookings', component: BookingsTab, icon: ClipboardList },
  { id: 'guests', label: 'Guests', component: GuestsTab, icon: Contact },
  { id: 'billing', label: 'Billing', component: BillingTab, icon: Receipt },
  { id: 'restaurant', label: 'Restaurant', component: RestaurantTab, icon: UtensilsCrossed },
  { id: 'payments', label: 'Payments', component: PaymentsTab, icon: Wallet },
  { id: 'staff', label: 'Staff', component: StaffTab, icon: UsersRound },
  { id: 'expenses', label: 'Expenses', component: ExpensesTab, icon: TrendingDown },
  { id: 'reports', label: 'Reports', component: ReportsTab, icon: FileBarChart },
  { id: 'settings', label: 'Settings', component: SettingsTab, icon: SettingsIcon },
] as const

type TabId = (typeof TABS)[number]['id']

interface Stats {
  vacant: number
  totalRooms: number
  todayRevenue: number
}

const MOBILE_PRIMARY: TabId[] = ['dashboard', 'bookings', 'billing', 'restaurant']
const MOBILE_MORE: TabId[] = ['rooms', 'guests', 'payments', 'staff', 'expenses', 'reports', 'settings']

interface NavTarget {
  tab: string
  q?: string
}

function Shell() {
  const { theme, setTheme } = useTheme()
  const { user, login, logout, canApproveBilling } = useUser()
  const [tab, setTab] = useState<TabId>('dashboard')
  const [refreshKey, setRefreshKey] = useState(0)
  const [stats, setStats] = useState<Stats | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [hotelName, setHotelName] = useState('Ashirbad Lodge')
  const [navTarget, setNavTarget] = useState<NavTarget | null>(null)

  // Global data refresh signal: any module change triggers refresh of all tabs
  const onDataChanged = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  useEffect(() => {
    fetch('/api/stats', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: Stats) => setStats(d))
      .catch(() => {})
    fetch('/api/settings', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { hotelName?: string }) => d.hotelName && setHotelName(d.hotelName))
      .catch(() => {})
  }, [refreshKey])

  function onNavigate(target: NavTarget) {
    const t = TABS.find((x) => x.id === target.tab)
    if (t) {
      setTab(t.id)
      setNavTarget(target)
    }
  }

  const ActiveComponent = TABS.find((t) => t.id === tab)?.component || Dashboard

  function renderTab() {
    const props = {
      refreshKey,
      onDataChanged,
      initialFilter: tab === navTarget?.tab ? navTarget?.q : undefined,
    }
    switch (tab) {
      case 'dashboard':
        return <Dashboard {...props} onNavigate={onNavigate} />
      case 'rooms':
        return <RoomsTab {...props} onNavigate={onNavigate} />
      case 'bookings':
        return <BookingsTab {...props} />
      case 'guests':
        return <GuestsTab {...props} />
      case 'billing':
        return <BillingTab {...props} />
      case 'restaurant':
        return <RestaurantTab {...props} />
      case 'payments':
        return <PaymentsTab {...props} />
      case 'staff':
        return <StaffTab {...props} />
      case 'expenses':
        return <ExpensesTab {...props} />
      case 'reports':
        return <ReportsTab {...props} />
      case 'settings':
        return <SettingsTab {...props} onDataChanged={onDataChanged} />
      default:
        return <Dashboard {...props} onNavigate={onNavigate} />
    }
  }

  function mobileNavButton(t: (typeof TABS)[number]) {
    const Icon = t.icon
    return (
      <button
        key={t.id}
        onClick={() => {
          setTab(t.id)
          setMoreOpen(false)
        }}
        className={`flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 text-[10px] font-medium transition-colors ${
          tab === t.id ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'
        }`}
      >
        <Icon className={`h-5 w-5 ${tab === t.id ? 'text-emerald-600 dark:text-emerald-400' : ''}`} />
        {t.label}
      </button>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="rounded-lg bg-emerald-600 p-1.5">
              <Hotel className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold leading-tight sm:text-lg">{hotelName}</h1>
              <p className="text-[11px] leading-tight text-muted-foreground">
                {stats ? `${stats.vacant}/${stats.totalRooms} vacant` : 'Hotel operations suite'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="hidden items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 dark:bg-emerald-950/50 sm:flex">
              <span className="text-xs text-muted-foreground">Today revenue</span>
              <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                {formatINR(stats?.todayRevenue)}
              </span>
            </div>

            {/* Global search */}
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              aria-label="Global search"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="h-4 w-4" />
            </Button>

            {/* Theme toggle */}
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              aria-label="Toggle light or dark mode"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              <Sun className="hidden h-4 w-4 dark:block" aria-hidden />
              <Moon className="h-4 w-4 dark:hidden" aria-hidden />
            </Button>

            {/* User */}
            {user ? (
              <div className="flex items-center gap-1">
                <div
                  className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1.5 md:flex"
                  title={canApproveBilling ? 'Can approve custom billing' : 'Standard staff access'}
                >
                  <ShieldCheck
                    className={`h-3.5 w-3.5 ${canApproveBilling ? 'text-emerald-600' : 'text-muted-foreground'}`}
                    aria-hidden
                  />
                  <span className="text-xs font-medium">{user.name}</span>
                  <span className="text-[10px] uppercase text-muted-foreground">{user.role}</span>
                </div>
                <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Sign out" onClick={logout}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Sign in" onClick={() => setLoginOpen(true)}>
                <LogIn className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        {/* Desktop tabs */}
        <nav className="hidden border-t sm:block" aria-label="Main navigation">
          <div className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
            {TABS.map((t) => {
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                    tab === t.id
                      ? 'border-emerald-600 text-emerald-700 dark:border-emerald-400 dark:text-emerald-400'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </button>
              )
            })}
          </div>
        </nav>
      </header>

      {/* Content */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-3 pb-24 pt-4 sm:px-4 sm:pb-8">
        {renderTab()}
      </main>

      {/* Footer */}
      <footer className="mt-auto hidden border-t bg-background py-3 sm:block">
        <p className="text-center text-xs text-muted-foreground">
          {hotelName} — Booking &amp; operations management · Light / Dark mode · Mobile friendly
        </p>
      </footer>

      {/* Mobile bottom navigation */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/90 sm:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        aria-label="Mobile navigation"
      >
        <div className="grid grid-cols-5">
          {MOBILE_PRIMARY.map((id) => mobileNavButton(TABS.find((t) => t.id === id)!))}
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-0.5 py-1.5 text-[10px] font-medium text-muted-foreground"
                aria-label="More sections"
              >
                <Menu className="h-5 w-5" />
                More
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <SheetHeader className="p-0 pb-2">
                <SheetTitle className="text-left">All Sections</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-4 gap-2">
                {MOBILE_MORE.map((id) => {
                  const t = TABS.find((x) => x.id === id)!
                  const Icon = t.icon
                  return (
                    <button
                      key={t.id}
                      onClick={() => {
                        setTab(t.id)
                        setMoreOpen(false)
                      }}
                      className={`flex min-h-[72px] flex-col items-center justify-center gap-1 rounded-xl border p-2 text-[10px] font-medium ${
                        tab === t.id
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                          : 'text-muted-foreground'
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                      {t.label}
                    </button>
                  )
                })}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>

      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} onNavigate={onNavigate} />
      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onLogin={login} />
    </div>
  )
}

export default function Home() {
  return (
    <UserProvider>
      <Shell />
    </UserProvider>
  )
}
