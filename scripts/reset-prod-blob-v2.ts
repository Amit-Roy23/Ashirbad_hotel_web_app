/**
 * Reset PRODUCTION blob DB to clean state (30 vacant rooms, no transactions).
 * Run: bun scripts/reset-prod-blob-v2.ts
 */
import fs from 'fs'
import { put, head } from '@vercel/blob'
import { PrismaClient } from '@prisma/client'

const TOKEN_FILE = '/home/z/my-project/.env.vercel-token'

async function main() {
  const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim()
  process.env.BLOB_READ_WRITE_TOKEN = token

  const buf = fs.readFileSync('/home/z/my-project/db/custom.db')
  await put('hotel-manager.db', buf, {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    token,
  })
  const meta = await head('hotel-manager.db', { token })
  console.log('Clean DB uploaded. New version:', meta.etag || meta.uploadedAt)
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
