import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const schemaPath = fileURLToPath(new URL('../database/schema.sql', import.meta.url))
const schema = await readFile(schemaPath, 'utf8')
const pool = new pg.Pool({
  host: process.env.PGHOST || '/tmp',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'pharma_plus',
  user: process.env.PGUSER || process.env.USER,
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
