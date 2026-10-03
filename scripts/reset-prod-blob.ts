import fs from 'fs'
import { del, put } from '@vercel/blob'

async function main() {
  const envFile = fs.readFileSync('/home/z/my-project/.env.vercel-test', 'utf8')
  for (const line of envFile.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].replace(/^"|"$/g, '')
  }
  try { await del('hotel-manager.db'); console.log('Old blob deleted') } catch (e) { console.log('del:', (e as Error).message?.slice(0, 60)) }
  const buf = fs.readFileSync('/home/z/my-project/db/custom.db')
  await put('hotel-manager.db', buf, { access: 'private', addRandomSuffix: false, allowOverwrite: true })
  console.log('Fresh DB uploaded (30 rooms, clean state)')
}
main().catch((e) => { console.error(e.message); process.exit(1) })
