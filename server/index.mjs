import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import express from 'express'
import pg from 'pg'
import cors from 'cors'
import { createServer as createHttpsServer } from 'node:https'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const app = express()
const port = Number(process.env.API_PORT || 3001)
const mobilePort = Number(process.env.MOBILE_API_PORT || 3002)
const mobileLanEnabled = process.env.MOBILE_LAN === '1'
const allowedOrigins = new Set([
  'https://localhost',
  'capacitor://localhost',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])
const authSessions = new Map()
const pool = new pg.Pool({
  host: process.env.PGHOST || '/tmp',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'pharma_plus',
  user: process.env.PGUSER || process.env.USER,
  password: process.env.PGPASSWORD || undefined,
})

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true)
    return callback(new Error('This origin is not allowed to access the pharmacy API.'))
  },
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}))
app.use(express.json({ limit: '32kb' }))

function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function createOwnerSession(email) {
  const token = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000
  authSessions.set(token, { email, expiresAt })
  return { token, expiresAt: new Date(expiresAt).toISOString() }
}

function requireOwner(request, response, next) {
  const authorization = request.get('authorization') || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  const session = authSessions.get(token)
  if (!session || session.expiresAt <= Date.now()) {
    if (token) authSessions.delete(token)
    return response.status(401).json({ error: 'Please sign in as the pharmacy owner.' })
  }
  request.ownerEmail = session.email
  request.ownerToken = token
  next()
}

app.get('/api/auth/status', async (request, response, next) => {
  try {
    const result = await pool.query('SELECT EXISTS (SELECT 1 FROM owner_accounts) AS configured')
    response.set('Cache-Control', 'no-store')
    response.json({
      ownerConfigured: result.rows[0].configured,
      canSetupOwner: isLoopback(request.socket.remoteAddress),
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/auth/setup', async (request, response, next) => {
  const body = request.body ?? {}
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!isLoopback(request.socket.remoteAddress)) {
    return response.status(403).json({ error: 'Create the first owner account from the Mac running the database.' })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response.status(400).json({ error: 'Enter a valid email address.' })
  }
  if (password.length < 12 || password.length > 128) {
    return response.status(400).json({ error: 'Use a password between 12 and 128 characters.' })
  }

  const salt = randomBytes(16)
  const passwordHash = scryptSync(password, salt, 64)
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(72419135)')
    const existing = await client.query('SELECT 1 FROM owner_accounts LIMIT 1')
    if (existing.rowCount) {
      await client.query('ROLLBACK')
      return response.status(409).json({ error: 'The owner account is already set up. Sign in instead.' })
    }
    await client.query(
      'INSERT INTO owner_accounts (id, email, password_salt, password_hash) VALUES (1, $1, $2, $3)',
      [email, salt, passwordHash],
    )
    await client.query('COMMIT')
    response.status(201).json({ email, ...createOwnerSession(email) })
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    next(error)
  } finally {
    client?.release()
  }
})

app.post('/api/auth/login', async (request, response, next) => {
  const body = request.body ?? {}
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  try {
    const result = await pool.query(
      'SELECT email, password_salt, password_hash FROM owner_accounts WHERE email = $1',
      [email],
    )
    const owner = result.rows[0]
    const candidate = owner
      ? scryptSync(password, owner.password_salt, 64)
      : scryptSync(password || 'invalid', Buffer.alloc(16), 64)
    if (!owner || !timingSafeEqual(candidate, owner.password_hash)) {
      return response.status(401).json({ error: 'Email or password is incorrect.' })
    }
    response.set('Cache-Control', 'no-store')
    response.json({ email: owner.email, ...createOwnerSession(owner.email) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/session', requireOwner, (request, response) => {
  response.set('Cache-Control', 'no-store')
  response.json({ email: request.ownerEmail })
})

app.post('/api/auth/logout', requireOwner, (request, response) => {
  authSessions.delete(request.ownerToken)
  response.status(204).end()
})

const medicineQuery = `
  SELECT
    m.id::int AS id, m.name, COALESCE(c.name, 'Uncategorized') AS category,
    m.pack, m.price::float8 AS price, m.stock, m.reorder_level AS "reorderLevel",
    to_char(m.expiry_date, 'YYYY-MM-DD') AS expiry, m.sku, m.generic_name AS "genericName",
    m.manufacturer, m.batch_number AS "batchNumber", m.gst_rate::float8 AS "gstRate",
    m.hsn_code AS "hsnCode", m.prescription_required AS "prescriptionRequired",
    m.description, m.image_url AS "imageUrl", m.is_active AS available
  FROM medicines m
  LEFT JOIN categories c ON c.id = m.category_id
`

function medicineInput(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const category = typeof body.category === 'string' ? body.category.trim() : ''
  const pack = typeof body.pack === 'string' ? body.pack.trim() : ''
  const price = Number(body.price)
  const stock = Number(body.stock)
  const reorderLevel = Number(body.reorderLevel ?? 10)
  const expiry = body.expiry ? String(body.expiry).slice(0, 10) : null

  if (!name || !category || !pack) {
    return { error: 'Name, category, and pack size are required.' }
  }
  if (!Number.isFinite(price) || price < 0 || !Number.isInteger(stock) || stock < 0) {
    return { error: 'Price must be non-negative and stock must be a non-negative whole number.' }
  }
  if (!Number.isInteger(reorderLevel) || reorderLevel < 0) {
    return { error: 'Reorder level must be a non-negative whole number.' }
  }
  const parsedExpiry = expiry ? new Date(`${expiry}T00:00:00.000Z`) : null
  if (
    expiry &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) ||
      Number.isNaN(parsedExpiry?.getTime()) ||
      parsedExpiry?.toISOString().slice(0, 10) !== expiry)
  ) {
    return { error: 'Expiry date must be a valid YYYY-MM-DD date.' }
  }

  return {
    value: {
      name,
      category,
      pack,
      price,
      stock,
      reorderLevel,
      expiry,
      sku: typeof body.sku === 'string' && body.sku.trim() ? body.sku.trim() : null,
      genericName: typeof body.genericName === 'string' ? body.genericName.trim() || null : null,
      manufacturer: typeof body.manufacturer === 'string' ? body.manufacturer.trim() || null : null,
      batchNumber: typeof body.batchNumber === 'string' ? body.batchNumber.trim() || null : null,
      gstRate: Number(body.gstRate ?? 0),
      hsnCode: typeof body.hsnCode === 'string' ? body.hsnCode.trim() || null : null,
      prescriptionRequired: body.prescriptionRequired === true,
      description: typeof body.description === 'string' ? body.description.trim() || null : null,
      imageUrl: typeof body.imageUrl === 'string' ? body.imageUrl.trim() || null : null,
    },
  }
}

async function categoryId(client, name) {
  const result = await client.query(
    `INSERT INTO categories (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [name],
  )
  return result.rows[0].id
}

app.get('/api/health', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1')
    response.json({ status: 'ok' })
  } catch (error) {
    next(error)
  }
})

app.get('/api/categories', async (_request, response, next) => {
  try {
    const result = await pool.query('SELECT id, name, description FROM categories ORDER BY name')
    response.json(result.rows)
  } catch (error) {
    next(error)
  }
})

app.get('/api/catalog/categories', async (_request, response, next) => {
  try {
    const result = await pool.query('SELECT name FROM categories ORDER BY name')
    response.json(result.rows)
  } catch (error) {
    next(error)
  }
})

app.post('/api/categories', requireOwner, async (request, response, next) => {
  const name = typeof request.body.name === 'string' ? request.body.name.trim() : ''
  if (!name) return response.status(400).json({ error: 'Category name is required.' })

  try {
    const result = await pool.query(
      `INSERT INTO categories (name, description) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description
       RETURNING id, name, description`,
      [name, typeof request.body.description === 'string' ? request.body.description.trim() || null : null],
    )
    response.status(201).json(result.rows[0])
  } catch (error) {
    next(error)
  }
})

app.get('/api/catalog/medicines', async (_request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT m.id::int AS id, m.name, COALESCE(c.name, 'Uncategorized') AS category,
        m.pack, m.price::float8 AS price, m.stock, m.description,
        m.image_url AS "imageUrl"
       FROM medicines m
       LEFT JOIN categories c ON c.id = m.category_id
       WHERE m.is_active AND m.stock > 0
       ORDER BY m.name`,
    )
    response.json(result.rows)
  } catch (error) {
    next(error)
  }
})

app.get('/api/medicines', requireOwner, async (_request, response, next) => {
  try {
    const result = await pool.query(`${medicineQuery} WHERE m.is_active ORDER BY m.name`)
    response.json(result.rows)
  } catch (error) {
    next(error)
  }
})

app.post('/api/medicines', requireOwner, async (request, response, next) => {
  const parsed = medicineInput(request.body)
  if (parsed.error) return response.status(400).json({ error: parsed.error })
  if (!Number.isFinite(parsed.value.gstRate) || parsed.value.gstRate < 0 || parsed.value.gstRate > 100) {
    return response.status(400).json({ error: 'GST rate must be between 0 and 100.' })
  }

  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const category = await categoryId(client, parsed.value.category)
    const item = parsed.value
    const inserted = await client.query(
      `INSERT INTO medicines
        (sku, name, generic_name, category_id, pack, manufacturer, batch_number,
         expiry_date, price, stock, reorder_level, gst_rate, hsn_code,
         prescription_required, description, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING id`,
      [item.sku, item.name, item.genericName, category, item.pack, item.manufacturer,
        item.batchNumber, item.expiry, item.price, item.stock, item.reorderLevel,
        item.gstRate, item.hsnCode, item.prescriptionRequired, item.description, item.imageUrl],
    )
    const id = inserted.rows[0].id
    if (item.stock > 0) {
      await client.query(
        `INSERT INTO stock_movements (medicine_id, movement_type, quantity_change, note)
         VALUES ($1, 'opening', $2, 'Opening inventory')`,
        [id, item.stock],
      )
    }
    const result = await client.query(`${medicineQuery} WHERE m.id = $1`, [id])
    await client.query('COMMIT')
    response.status(201).json(result.rows[0])
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    next(error)
  } finally {
    client?.release()
  }
})

app.put('/api/medicines/:id', requireOwner, async (request, response, next) => {
  const id = Number(request.params.id)
  const parsed = medicineInput(request.body)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid medicine ID.' })
  if (parsed.error) return response.status(400).json({ error: parsed.error })
  if (!Number.isFinite(parsed.value.gstRate) || parsed.value.gstRate < 0 || parsed.value.gstRate > 100) {
    return response.status(400).json({ error: 'GST rate must be between 0 and 100.' })
  }

  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const existing = await client.query(
      'SELECT stock FROM medicines WHERE id = $1 AND is_active FOR UPDATE',
      [id],
    )
    if (!existing.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Medicine was not found.' })
    }
    const category = await categoryId(client, parsed.value.category)
    const item = parsed.value
    await client.query(
      `UPDATE medicines SET
        sku = $2, name = $3, generic_name = $4, category_id = $5, pack = $6,
        manufacturer = $7, batch_number = $8, expiry_date = $9, price = $10,
        stock = $11, reorder_level = $12, gst_rate = $13, hsn_code = $14,
        prescription_required = $15, description = $16, image_url = $17,
        updated_at = now()
       WHERE id = $1 AND is_active
       RETURNING id`,
      [id, item.sku, item.name, item.genericName, category, item.pack, item.manufacturer,
        item.batchNumber, item.expiry, item.price, item.stock, item.reorderLevel,
        item.gstRate, item.hsnCode, item.prescriptionRequired, item.description, item.imageUrl],
    )
    const stockChange = item.stock - existing.rows[0].stock
    if (stockChange !== 0) {
      await client.query(
        `INSERT INTO stock_movements (medicine_id, movement_type, quantity_change, note)
         VALUES ($1, 'adjustment', $2, 'Owner inventory adjustment')`,
        [id, stockChange],
      )
    }
    const result = await client.query(`${medicineQuery} WHERE m.id = $1`, [id])
    await client.query('COMMIT')
    response.json(result.rows[0])
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    next(error)
  } finally {
    client?.release()
  }
})

app.delete('/api/medicines/:id', requireOwner, async (request, response, next) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid medicine ID.' })

  try {
    const result = await pool.query(
      `UPDATE medicines SET is_active = false, updated_at = now()
       WHERE id = $1 AND is_active`,
      [id],
    )
    if (!result.rowCount) return response.status(404).json({ error: 'Medicine was not found.' })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

app.use((error, _request, response, _next) => {
  console.error('Pharma Plus API error:', error)
  if (error.code === '23505') {
    return response.status(409).json({ error: 'That SKU or category already exists.' })
  }
  response.status(500).json({ error: 'The request could not be completed. Check the API logs for details.' })
})

const distPath = fileURLToPath(new URL('../dist/', import.meta.url))
app.use(express.static(distPath))
app.get(/.*/, (_request, response, next) => {
  response.sendFile(fileURLToPath(new URL('../dist/index.html', import.meta.url)), (error) => {
    if (error) next()
  })
})

try {
  await pool.query('SELECT 1')
  app.listen(port, '127.0.0.1', () => {
    console.log(`Pharma Plus API listening on http://127.0.0.1:${port}`)
  })
  if (mobileLanEnabled) {
    const keyPath = fileURLToPath(new URL('../.devcerts/server.key', import.meta.url))
    const certPath = fileURLToPath(new URL('../.devcerts/server.crt', import.meta.url))
    const [key, cert] = await Promise.all([readFile(keyPath), readFile(certPath)])
    createHttpsServer({ key, cert }, app).listen(mobilePort, '0.0.0.0', () => {
      console.log(`Secure mobile API listening on https://0.0.0.0:${mobilePort}`)
    })
  }
} catch (error) {
  console.error('Could not start the Pharma Plus API. Check the PostgreSQL connection and mobile TLS certificate:', error)
  await pool.end()
  process.exitCode = 1
}
