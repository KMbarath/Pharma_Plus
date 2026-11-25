import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const schemaPath = fileURLToPath(new URL('../database/schema.sql', import.meta.url))
const schema = await readFile(schemaPath, 'utf8')
const databaseHost = process.env.PGHOST || (process.platform === 'win32' ? '127.0.0.1' : '/tmp')
const databaseUser = process.env.PGUSER || process.env.USER || process.env.USERNAME
const pool = new pg.Pool({
  host: databaseHost,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'pharma_plus',
  user: databaseUser,
  password: process.env.PGPASSWORD || undefined,
})

try {
  await pool.query(schema)
  console.log('Pharma Plus database schema is ready.')
} catch (error) {
  console.error('Could not apply the Pharma Plus database schema:', error)
  process.exitCode = 1
} finally {
  await pool.end()
}
