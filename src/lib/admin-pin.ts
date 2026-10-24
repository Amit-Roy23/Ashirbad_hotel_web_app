/**
 * Small self-contained Admin PIN prompt (plain DOM, so it can be used from any print helper).
 * Resolves true only when the server confirms the PIN belongs to an active ADMIN user;
 * the approval is written to the audit trail with the given reason.
 */
export function requestAdminApproval(reason: string, message?: string): Promise<boolean> {
  return showPinModal(message || reason, async (pin) => {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify-admin', pin, reason }),
    })
    if (res.ok) return null
    const data = await res.json().catch(() => ({}))
    return data.error || 'Invalid Admin PIN'
  }).then((pin) => pin !== null)
}

/**
 * Asks for the Admin PIN and returns it (null if cancelled). The server action that receives
 * it verifies the PIN itself.
 */
export function askAdminPin(message: string): Promise<string | null> {
  return showPinModal(message, async () => null)
}

export interface AdminPinRequest {
  message: string
  /** returns an error message to keep the dialog open, or null to accept */
  validate: (pin: string) => Promise<string | null>
  resolve: (pin: string | null) => void
}

// The app mounts <AdminPinHost /> which renders the prompt as a real dialog. That matters when
// the prompt opens on top of another dialog: the open dialog blocks clicks and steals focus from
// anything rendered outside the dialog system, so a plain DOM overlay could not be used.
let pinHost: ((req: AdminPinRequest) => void) | null = null

export function registerAdminPinHost(host: (req: AdminPinRequest) => void): () => void {
  pinHost = host
  return () => {
    if (pinHost === host) pinHost = null
  }
}

/** validate(pin) returns an error message to keep the dialog open, or null to accept */
function showPinModal(message: string, validate: (pin: string) => Promise<string | null>): Promise<string | null> {
  if (pinHost) {
    const host = pinHost
    return new Promise((resolve) => host({ message, validate, resolve }))
  }
  return showDomPinModal(message, validate)
}

/** Fallback when no host is mounted */
function showDomPinModal(message: string, validate: (pin: string) => Promise<string | null>): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9999;pointer-events:auto;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif'
    const box = document.createElement('div')
    box.style.cssText =
      'width:100%;max-width:340px;background:#fff;color:#111827;border-radius:12px;padding:18px;box-shadow:0 20px 40px rgba(0,0,0,.25)'
    box.innerHTML = `
      <div style="font-weight:700;font-size:15px;margin-bottom:6px">Admin approval required</div>
      <div data-msg style="font-size:12px;color:#4b5563;margin-bottom:12px;line-height:1.45"></div>
      <input data-pin type="password" inputmode="numeric" autocomplete="off" placeholder="Admin PIN"
        style="width:100%;height:38px;border:1px solid #d1d5db;border-radius:8px;padding:0 10px;font-size:14px;box-sizing:border-box" />
      <div data-err style="color:#dc2626;font-size:12px;min-height:18px;margin-top:6px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px">
        <button data-cancel type="button" style="height:34px;padding:0 14px;border:1px solid #d1d5db;border-radius:8px;background:#fff;font-size:13px;cursor:pointer">Cancel</button>
        <button data-ok type="button" style="height:34px;padding:0 14px;border:0;border-radius:8px;background:#059669;color:#fff;font-weight:600;font-size:13px;cursor:pointer">Approve</button>
      </div>`
    ;(box.querySelector('[data-msg]') as HTMLElement).textContent = message
    overlay.appendChild(box)
    document.body.appendChild(overlay)

    const pinInput = box.querySelector('[data-pin]') as HTMLInputElement
    const err = box.querySelector('[data-err]') as HTMLElement
    const okBtn = box.querySelector('[data-ok]') as HTMLButtonElement
    const close = (result: string | null) => {
      overlay.remove()
      resolve(result)
    }
    const submit = async () => {
      const pin = pinInput.value.trim()
      if (!pin) {
        err.textContent = 'Enter the Admin PIN'
        return
      }
      okBtn.disabled = true
      err.textContent = ''
      try {
        const problem = await validate(pin)
        if (!problem) return close(pin)
        err.textContent = problem
      } catch {
        err.textContent = 'Could not verify PIN'
      }
      okBtn.disabled = false
    }
    okBtn.addEventListener('click', submit)
    ;(box.querySelector('[data-cancel]') as HTMLElement).addEventListener('click', () => close(null))
    pinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit()
      if (e.key === 'Escape') close(null)
    })
    setTimeout(() => pinInput.focus(), 0)
  })
}

/**
 * Runs an action; if the server answers that an Admin PIN is needed (e.g. checking in a guest
 * with outstanding dues), asks for the PIN and retries with it.
 */
export async function runWithAdminPin<T>(run: (adminPin?: string) => Promise<T>): Promise<T | null> {
  let pin: string | undefined
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await run(pin)
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      if (!/Admin PIN/i.test(msg)) throw e
      const entered = await askAdminPin(attempt > 0 ? `Invalid PIN. ${msg}` : msg)
      if (!entered) return null
      pin = entered
    }
  }
  return null
}
