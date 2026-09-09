// Deletes the local PGlite data directory so the next boot migrates and seeds fresh.
// It never opens the database - the dev server must be stopped, because PGlite does
// not lock its data directory and two writers can corrupt it.
import fs from 'node:fs'
import path from 'node:path'

const dir = path.resolve(process.cwd(), '.data', 'pg')
if (!fs.existsSync(dir)) {
  console.log('Nothing to reset - ' + dir + ' does not exist.')
  process.exit(0)
}
fs.rmSync(dir, { recursive: true, force: true })
console.log('Deleted ' + dir)
console.log('Start the dev server to migrate and seed a fresh database.')
