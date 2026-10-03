'use client'

import * as React from 'react'

export interface AppUser {
  id: string
  name: string
  role: string // ADMIN | MANAGER | RECEPTION
}

interface UserContextValue {
  user: AppUser | null
  login: (u: AppUser) => void
  logout: () => void
  canApproveBilling: boolean
  isAdmin: boolean
}

const UserContext = React.createContext<UserContextValue>({
  user: null,
  login: () => {},
  logout: () => {},
  canApproveBilling: false,
  isAdmin: false,
})

const STORAGE_KEY = 'hotel-user'

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AppUser | null>(null)
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setUser(JSON.parse(raw))
    } catch {
      // ignore
    }
    setLoaded(true)
  }, [])

  const login = React.useCallback((u: AppUser) => {
    setUser(u)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(u))
    } catch {
      // ignore
    }
  }, [])

  const logout = React.useCallback(() => {
    setUser(null)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore
    }
  }, [])

  const value = React.useMemo(
    () => ({
      user,
      login,
      logout,
      canApproveBilling: user?.role === 'ADMIN' || user?.role === 'MANAGER',
      isAdmin: user?.role === 'ADMIN',
    }),
    [user, login, logout]
  )

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>
}

export function useUser() {
  return React.useContext(UserContext)
}

/** localStorage helper for the app-wide current user (used by simple tabs) */
export function getCachedUser(): AppUser | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}
