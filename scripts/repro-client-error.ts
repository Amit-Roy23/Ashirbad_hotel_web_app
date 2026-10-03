/**
 * Reproduce the user's client-side exception on hotel-manager-two.vercel.app
 * Emulates: Windows Chrome, en-IN locale, Asia/Kolkata timezone, wide desktop viewport,
 * pre-existing localStorage (stale hotel-user + theme), and old-cached-page scenario.
 */
// @ts-ignore
import { chromium } from 'playwright'

const URL = process.env.TARGET_URL || 'https://hotel-manager-two.vercel.app/'

async function runScenario(name: string, opts: { seedStorage?: boolean } = {}) {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({
    viewport: { width: 1536, height: 831 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    colorScheme: 'light',
    deviceScaleFactor: 1,
  })

  if (opts.seedStorage) {
    // Visit first to establish origin, then seed stale storage like an older app version would have
    const page0 = await ctx.newPage()
    await page0.goto(URL, { waitUntil: 'domcontentloaded' })
    await page0.evaluate(() => {
      localStorage.setItem('hotel-user', JSON.stringify({ id: 'old', name: 'Old User', role: 'ADMIN' }))
      localStorage.setItem('theme', 'dark')
      localStorage.setItem('hotel-settings-cache', '{"hotelName":"Old Cache"}')
      sessionStorage.setItem('x', '1')
    })
    await page0.close()
  }

  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack?.slice(0, 800)}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console.error] ${m.text().slice(0, 500)}`)
  })
  page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()} :: ${r.failure()?.errorText}`))
  page.on('response', (r) => {
    if (r.status() >= 400) errors.push(`[http ${r.status()}] ${r.url()}`)
  })

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(4000)

  const bodyText = (await page.locator('body').innerText().catch(() => '<no body>')).slice(0, 300)
  const hasErrorPage = bodyText.includes('Application error')

  console.log(`\n===== SCENARIO: ${name} =====`)
  console.log(`Error page shown: ${hasErrorPage}`)
  console.log(`Body preview: ${bodyText.replace(/\n+/g, ' | ').slice(0, 200)}`)
  if (errors.length) {
    console.log(`Captured ${errors.length} error events:`)
    for (const e of errors.slice(0, 20)) console.log('  ' + e.split('\n').join('\n  '))
  } else {
    console.log('No error events captured.')
  }
  await browser.close()
  return { name, hasErrorPage, errors }
}

async function main() {
  const results: { name: string; hasErrorPage: boolean; errors: string[] }[] = []
  results.push(await runScenario('user-env-fresh-storage'))
  results.push(await runScenario('user-env-stale-storage', { seedStorage: true }))

  // Scenario 3: rapid reload x2 (cache revalidation behavior)
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 831 }, locale: 'en-IN', timezoneId: 'Asia/Kolkata' })
  const page = await ctx.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))
  await page.goto(URL, { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const t3 = await page.locator('body').innerText().catch(() => '')
  console.log(`\n===== SCENARIO: triple-reload =====`)
  console.log(`Error page shown: ${t3.includes('Application error')}`)
  console.log(errors.length ? errors.join('\n') : 'No error events captured.')
  await browser.close()

  const anyFail = results.some((r) => r.hasErrorPage) || t3.includes('Application error')
  console.log(`\n>>> ANY SCENARIO REPRODUCED: ${anyFail ? 'YES' : 'NO'}`)
}

main().catch((e) => {
  console.error('SCRIPT FAILED:', e)
  process.exit(1)
})
