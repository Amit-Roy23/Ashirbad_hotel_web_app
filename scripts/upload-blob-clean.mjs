import fs from 'fs'
import { put, head } from '@vercel/blob'

// Token comes from the environment — never hardcode it in the repo.
// Usage: BLOB_READ_WRITE_TOKEN=vercel_blob_rw_... bun scripts/upload-blob-clean.mjs
const token = process.env.BLOB_READ_WRITE_TOKEN
if (!token) {
  console.error('Set BLOB_READ_WRITE_TOKEN in the environment first.')
  process.exit(1)
}

const buf = fs.readFileSync('/home/z/my-project/db/custom.db')
await put('hotel-manager.db', buf, { access: 'private', addRandomSuffix: false, allowOverwrite: true, token })
const meta = await head('hotel-manager.db', { token })
console.log('Uploaded clean demo DB. version:', meta.etag || String(meta.uploadedAt), 'size:', buf.length)
