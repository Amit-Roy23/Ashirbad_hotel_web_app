'use client'

/**
 * Route-level error boundary.
 * Catches client-side exceptions in the app shell and shows the REAL error
 * (instead of a blank "Application error" page) with a one-click recovery.
 * If the failure looks like a stale-chunk race (right after a deployment),
 * it auto-reloads once to self-heal.
 */

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

const CHUNK_ERROR_PATTERNS = [
  'ChunkLoadError',
  'Loading chunk',
  'Failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'dynamically imported module',
  'Importing a module script failed',
]

const RELOAD_FLAG = 'hm-auto-reload-at'

function looksLikeChunkError(message: string): boolean {
  const m = (message || '').toLowerCase()
  return CHUNK_ERROR_PATTERNS.some((p) => m.includes(p.toLowerCase()))
}

function shouldAutoReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_FLAG) || 0)
    // Only auto-reload once every 15 seconds to avoid loops
    return Date.now() - last > 15000
  } catch {
    return false
  }
}

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const [autoTried, setAutoTried] = useState(false)

  useEffect(() => {
    // Log for diagnosis (visible in browser console)
    console.error('[HotelManager] Client error boundary:', error)

    if (!autoTried && looksLikeChunkError(error.message) && shouldAutoReload()) {
      try {
        sessionStorage.setItem(RELOAD_FLAG, String(Date.now()))
      } catch {
        // ignore
      }
      setAutoTried(true)
      window.location.reload()
    }
  }, [error, autoTried])

  const isChunk = looksLikeChunkError(error.message)

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/40">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 dark:bg-red-900">
          <svg className="h-6 w-6 text-red-600 dark:text-red-300" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
        </div>
        <h2 className="text-lg font-bold text-red-800 dark:text-red-200">
          {isChunk ? 'Update detected' : 'Something went wrong'}
        </h2>
        <p className="text-sm text-red-700 dark:text-red-300">
          {isChunk
            ? 'The app was updated in the background. Reloading usually fixes this instantly.'
            : 'An unexpected error occurred while displaying this page. Your data is safe.'}
        </p>
        <p className="rounded-lg bg-red-100/70 p-2.5 text-left font-mono text-[11px] break-words text-red-900 dark:bg-red-900/50 dark:text-red-200">
          {error.message || 'Unknown error'}
          {error.digest ? ` (ref: ${error.digest})` : ''}
        </p>
        <div className="flex justify-center gap-2">
          <Button onClick={reset} className="bg-red-600 hover:bg-red-700">
            Try again
          </Button>
          <Button variant="outline" onClick={() => window.location.assign('/')}>
            Go to Dashboard
          </Button>
        </div>
      </div>
    </div>
  )
}
