'use client'

/**
 * Root-level error boundary (last resort).
 * Replaces the entire <html> when the app shell itself fails.
 * Shows the real error + reload actions so the screen is never blank.
 */

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[HotelManager] Global error boundary:', error)
  }, [error])

  const msg = (error?.message || 'Unknown client-side exception').slice(0, 400)

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          background: '#fef2f2',
          color: '#7f1d1d',
          padding: '1.5rem',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            maxWidth: 460,
            width: '100%',
            background: '#fff',
            border: '1px solid #fecaca',
            borderRadius: 16,
            padding: '1.75rem',
            textAlign: 'center',
            boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          }}
        >
          <div style={{ fontSize: 40, lineHeight: 1 }}>🏨</div>
          <h1 style={{ fontSize: 19, margin: '0.75rem 0 0.35rem', fontWeight: 700 }}>
            Ashirbad Hotel failed to start
          </h1>
          <p style={{ fontSize: 14, margin: '0 0 1rem', color: '#b91c1c' }}>
            A quick refresh usually fixes this. Your saved data is safe.
          </p>
          <pre
            style={{
              textAlign: 'left',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontSize: 11,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 8,
              padding: '0.6rem 0.75rem',
              margin: '0 0 1rem',
            }}
          >
            {msg}
            {error?.digest ? `\n(ref: ${error.digest})` : ''}
          </pre>
          <button
            onClick={reset}
            style={{
              background: '#059669',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              padding: '0.6rem 1.25rem',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              marginRight: 8,
            }}
          >
            Reload App
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#fff',
              color: '#374151',
              border: '1px solid #d1d5db',
              borderRadius: 10,
              padding: '0.6rem 1.25rem',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Hard Refresh
          </button>
        </div>
      </body>
    </html>
  )
}
