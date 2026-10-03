// Test the full cloud-db flow locally with real blob store
import fs from 'fs'
import { put, head, get } from '@vercel/blob'

async function main() {
  const envFile = fs.readFileSync('/home/z/my-project/.env.vercel-test', 'utf8')
  for (const line of envFile.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].replace(/^"|"$/g, '')
  }

  // Reset: delete existing blob to simulate first-ever request
  try {
    const { del } = await import('@vercel/blob')
    await del('hotel-manager.db')
    console.log('Blob deleted (fresh start)')
  } catch (e) {
    console.log('Delete skipped:', (e as Error).message?.slice(0, 80))
  }

  // Simulate ensureBlobExists
  let version: string
  try {
    const meta = await head('hotel-manager.db')
    version = meta.etag
  } catch {
    console.log('Blob missing -> uploading bundled db')
    const buf = fs.readFileSync('/home/z/my-project/db/custom.db')
    await put('hotel-manager.db', buf, { access: 'private', addRandomSuffix: false, allowOverwrite: true })
    const meta = await head('hotel-manager.db')
    version = meta.etag
  }
  console.log('Version:', version)

  // Simulate downloadTo
  const result = await get('hotel-manager.db', { access: 'private' })
  if (!result || result.statusCode !== 200) throw new Error('not found')
  const reader = result.stream.getReader()
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)))
  console.log('Downloaded:', buf.length, 'bytes')
  fs.writeFileSync('/tmp/test-cloud.db', buf)

  // Verify it's a valid SQLite db with Prisma
  const { PrismaClient } = await import('@prisma/client')
  const client = new PrismaClient({ datasources: { db: { url: 'file:/tmp/test-cloud.db' } } })
  const rooms = await client.room.count()
  const guests = await client.guest.count()
  console.log('Rooms in cloud db:', rooms, '| Guests:', guests)
  await client.$disconnect()
  console.log('FULL CLOUD DB FLOW OK')
}

main().catch((e) => {
  console.error('FAILED:', e.message?.slice(0, 200))
  process.exit(1)
})
