import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'
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

function publicAccount(row) {
  return {
    id: Number(row.id),
    role: row.role,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    pharmacyId: row.pharmacy_id === null ? null : Number(row.pharmacy_id),
    pharmacyName: row.pharmacy_name,
    pharmacyPhone: row.pharmacy_phone,
    pharmacyAddress: row.pharmacy_address,
    pharmacyCity: row.pharmacy_city,
    pharmacyState: row.pharmacy_state,
    pharmacyPostalCode: row.pharmacy_postal_code,
    drugLicenseNumber: row.drug_license_number,
  }
}

async function findAccount(email) {
  const result = await pool.query(
    `SELECT u.id, u.role, u.email, u.full_name, u.phone, u.password_salt, u.password_hash,
       u.pharmacy_id, p.name AS pharmacy_name, p.phone AS pharmacy_phone,
       p.address AS pharmacy_address, p.city AS pharmacy_city,
       p.state AS pharmacy_state, p.postal_code AS pharmacy_postal_code,
       p.drug_license_number
     FROM user_accounts u
     LEFT JOIN pharmacies p ON p.id = u.pharmacy_id
     WHERE lower(u.email) = lower($1)`,
    [email],
  )
  return result.rows[0]
}

function createAccountSession(account) {
  const token = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + 8 * 60 * 60 * 1000
  const user = publicAccount(account)
  authSessions.set(token, { user, expiresAt })
  return { token, expiresAt: new Date(expiresAt).toISOString(), user }
}

function requireAuth(request, response, next) {
  const authorization = request.get('authorization') || ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  const session = authSessions.get(token)
  if (!session || session.expiresAt <= Date.now()) {
    if (token) authSessions.delete(token)
    return response.status(401).json({ error: 'Please sign in to continue.' })
  }
  request.user = session.user
  request.sessionToken = token
  next()
}

function requireRole(role) {
  return (request, response, next) => {
    if (request.user.role !== role) {
      return response.status(403).json({ error: `This action requires a ${role.replace('_', ' ')} account.` })
    }
    next()
  }
}

const requireOwner = (request, response, next) => {
  requireAuth(request, response, () => requireRole('pharmacy_owner')(request, response, next))
}
const requireCustomer = (request, response, next) => {
  requireAuth(request, response, () => requireRole('customer')(request, response, next))
}

app.post('/api/auth/signup', async (request, response, next) => {
  const body = request.body ?? {}
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  const phone = typeof body.phone === 'string' ? body.phone.trim() || null : null
  const role = body.role
  if (role !== 'customer' && role !== 'pharmacy_owner') {
    return response.status(400).json({ error: 'Choose a customer or pharmacy owner account.' })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response.status(400).json({ error: 'Enter a valid email address.' })
  }
  if (fullName.length < 2 || fullName.length > 120) {
    return response.status(400).json({ error: 'Enter a name between 2 and 120 characters.' })
  }
  if (password.length < 12 || password.length > 128) {
    return response.status(400).json({ error: 'Use a password between 12 and 128 characters.' })
  }

  const pharmacyName = typeof body.pharmacyName === 'string' ? body.pharmacyName.trim() : ''
  if (role === 'pharmacy_owner' && (pharmacyName.length < 2 || pharmacyName.length > 120)) {
    return response.status(400).json({ error: 'Enter a pharmacy name between 2 and 120 characters.' })
  }
  if (role === 'pharmacy_owner' && !phone) {
    return response.status(400).json({ error: 'Enter the pharmacy owner’s phone number.' })
  }

  const salt = randomBytes(16)
  const passwordHash = scryptSync(password, salt, 64)
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    let pharmacyId = null
    if (role === 'pharmacy_owner') {
      const pharmacyResult = await client.query(
        `INSERT INTO pharmacies (name, phone, email, address, city, state, postal_code, drug_license_number)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          pharmacyName,
          phone,
          email,
          typeof body.pharmacyAddress === 'string' ? body.pharmacyAddress.trim() || null : null,
          typeof body.city === 'string' ? body.city.trim() || null : null,
          typeof body.state === 'string' ? body.state.trim() || null : null,
          typeof body.postalCode === 'string' ? body.postalCode.trim() || null : null,
          typeof body.drugLicenseNumber === 'string' ? body.drugLicenseNumber.trim() || null : null,
        ],
      )
      pharmacyId = pharmacyResult.rows[0].id
    }

    const accountResult = await client.query(
      `INSERT INTO user_accounts (role, email, full_name, phone, password_salt, password_hash, pharmacy_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, role, email, full_name, phone, pharmacy_id`,
      [role, email, fullName, phone, salt, passwordHash, pharmacyId],
    )
    const account = accountResult.rows[0]
    if (role === 'customer') {
      await client.query(
        `INSERT INTO customers (full_name, phone, email, user_account_id)
         VALUES ($1, $2, $3, $4)`,
        [fullName, phone, email, account.id],
      )
      const address = typeof body.address === 'string' ? body.address.trim() : ''
      if (address) {
        await client.query(
          `INSERT INTO customer_addresses (user_account_id, address, city, state, postal_code, is_default)
           VALUES ($1, $2, $3, $4, $5, true)`,
          [
            account.id,
            address,
            typeof body.city === 'string' ? body.city.trim() || null : null,
            typeof body.state === 'string' ? body.state.trim() || null : null,
            typeof body.postalCode === 'string' ? body.postalCode.trim() || null : null,
          ],
        )
      }
    }
    await client.query('COMMIT')
    const completeAccount = await findAccount(email)
    response.set('Cache-Control', 'no-store')
    response.status(201).json(createAccountSession(completeAccount))
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    if (error.code === '23505') {
      return response.status(409).json({ error: 'An account already uses this email or phone number.' })
    }
    next(error)
  } finally {
    client?.release()
  }
})

app.post('/api/auth/login', async (request, response, next) => {
  const body = request.body ?? {}
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const role = body.role
  try {
    const account = await findAccount(email)
    const candidate = account
      ? scryptSync(password, account.password_salt, 64)
      : scryptSync(password || 'invalid', Buffer.alloc(16), 64)
    if (
      !account ||
      !timingSafeEqual(candidate, account.password_hash) ||
      (role && account.role !== role)
    ) {
      return response.status(401).json({ error: 'Email or password is incorrect.' })
    }
    response.set('Cache-Control', 'no-store')
    response.json(createAccountSession(account))
  } catch (error) {
    next(error)
  }
})

app.get('/api/auth/session', requireAuth, (request, response) => {
  response.set('Cache-Control', 'no-store')
  response.json({ user: request.user })
})

app.post('/api/auth/logout', requireAuth, (request, response) => {
  authSessions.delete(request.sessionToken)
  response.status(204).end()
})

app.get('/api/customer/profile', requireCustomer, async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT id, label, address, city, state, postal_code AS "postalCode", latitude, longitude
       FROM customer_addresses WHERE user_account_id = $1
       ORDER BY is_default DESC, id`,
      [request.user.id],
    )
    response.json({ user: request.user, addresses: result.rows })
  } catch (error) {
    next(error)
  }
})

app.put('/api/customer/profile', requireCustomer, async (request, response, next) => {
  const body = request.body ?? {}
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  const phone = typeof body.phone === 'string' ? body.phone.trim() || null : null
  const address = typeof body.address === 'string' ? body.address.trim() : ''
  const city = typeof body.city === 'string' ? body.city.trim() : ''
  const state = typeof body.state === 'string' ? body.state.trim() : ''
  const postalCode = typeof body.postalCode === 'string' ? body.postalCode.trim() : ''
  const locationProvided = Object.hasOwn(body, 'latitude') || Object.hasOwn(body, 'longitude')
  const latitude = body.latitude ?? null
  const longitude = body.longitude ?? null
  if (fullName.length < 2 || fullName.length > 120) {
    return response.status(400).json({ error: 'Enter a name between 2 and 120 characters.' })
  }
  if (
    locationProvided &&
    ((latitude === null) !== (longitude === null) ||
      (latitude !== null && (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
      (longitude !== null && (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180)))
  ) {
    return response.status(400).json({ error: 'Enter valid latitude and longitude coordinates.' })
  }

  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const accountResult = await client.query(
      `UPDATE user_accounts SET full_name = $2, phone = $3, updated_at = now()
       WHERE id = $1 AND role = 'customer'
       RETURNING id, role, email, full_name, phone, pharmacy_id`,
      [request.user.id, fullName, phone],
    )
    await client.query(
      `UPDATE customers SET full_name = $2, phone = $3
       WHERE user_account_id = $1`,
      [request.user.id, fullName, phone],
    )
    const hasLocation = latitude !== null && longitude !== null
    const hasManualAddress = Boolean(address || city || state || postalCode)
    if (hasLocation || hasManualAddress) {
      const existing = await client.query(
        `UPDATE customer_addresses SET address = $2, city = $3, state = $4, postal_code = $5,
           latitude = CASE WHEN $6 THEN $7 ELSE latitude END,
           longitude = CASE WHEN $6 THEN $8 ELSE longitude END
         WHERE user_account_id = $1 AND is_default
         RETURNING id`,
        [
          request.user.id,
          address,
          city || null,
          state || null,
          postalCode || null,
          locationProvided,
          latitude,
          longitude,
        ],
      )
      if (!existing.rowCount) {
        await client.query(
          `INSERT INTO customer_addresses (user_account_id, address, city, state, postal_code, latitude, longitude, is_default)
           VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
          [
            request.user.id,
            address,
            city || null,
            state || null,
            postalCode || null,
            locationProvided ? latitude : null,
            locationProvided ? longitude : null,
          ],
        )
      }
    } else if (locationProvided) {
      await client.query(
        'DELETE FROM customer_addresses WHERE user_account_id = $1 AND is_default',
        [request.user.id],
      )
    }
    await client.query('COMMIT')
    const account = await findAccount(accountResult.rows[0].email)
    const user = publicAccount(account)
    authSessions.get(request.sessionToken).user = user
    const addresses = await pool.query(
      `SELECT id, label, address, city, state, postal_code AS "postalCode", latitude, longitude
       FROM customer_addresses WHERE user_account_id = $1
       ORDER BY is_default DESC, id`,
      [request.user.id],
    )
    response.json({ user, addresses: addresses.rows })
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    if (error.code === '23505') {
      return response.status(409).json({ error: 'That phone number is already in use.' })
    }
    next(error)
  } finally {
    client?.release()
  }
})

const medicineQuery = `
  SELECT
    m.id::int AS id, m.pharmacy_id::int AS "pharmacyId", p.name AS "pharmacyName",
    m.name, COALESCE(c.name, 'Uncategorized') AS category,
    m.pack, m.price::float8 AS price, m.stock, m.reorder_level AS "reorderLevel",
    to_char(m.expiry_date, 'YYYY-MM-DD') AS expiry, m.sku, m.generic_name AS "genericName",
    m.manufacturer, m.batch_number AS "batchNumber", m.gst_rate::float8 AS "gstRate",
    m.hsn_code AS "hsnCode", m.prescription_required AS "prescriptionRequired",
    m.description, m.image_url AS "imageUrl", m.is_active AS available
  FROM medicines m
  LEFT JOIN categories c ON c.id = m.category_id
  JOIN pharmacies p ON p.id = m.pharmacy_id
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

app.get('/api/catalog/pharmacies', async (_request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT id::int AS id, name, city, state
       FROM pharmacies ORDER BY name`,
    )
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

app.get('/api/catalog/medicines', async (request, response, next) => {
  const pharmacyIdValue = request.query.pharmacyId
  const pharmacyId = Number(pharmacyIdValue)
  if (
    pharmacyIdValue !== undefined &&
    (typeof pharmacyIdValue !== 'string' || !Number.isSafeInteger(pharmacyId) || pharmacyId < 1)
  ) {
    return response.status(400).json({ error: 'Invalid pharmacy ID.' })
  }
  try {
    const result = await pool.query(
      `SELECT m.id::int AS id, m.pharmacy_id::int AS "pharmacyId",
        p.name AS "pharmacyName", m.name, COALESCE(c.name, 'Uncategorized') AS category,
        m.pack, m.price::float8 AS price, m.stock, m.description, m.image_url AS "imageUrl",
        COALESCE(r.rating, 0)::float8 AS rating, COALESCE(r."reviewCount", 0)::int AS "reviewCount"
       FROM medicines m
       LEFT JOIN categories c ON c.id = m.category_id
       JOIN pharmacies p ON p.id = m.pharmacy_id
       LEFT JOIN (
         SELECT medicine_id, AVG(rating)::float8 AS rating, COUNT(*)::int AS "reviewCount"
         FROM product_reviews GROUP BY medicine_id
       ) r ON r.medicine_id = m.id
       WHERE m.is_active AND m.stock > 0
         AND ($1::bigint IS NULL OR m.pharmacy_id = $1)
       ORDER BY m.name`,
      [pharmacyIdValue === undefined ? null : pharmacyId],
    )
    response.json(result.rows)
  } catch (error) {
    next(error)
  }
})

app.get('/api/medicines', requireOwner, async (request, response, next) => {
  try {
    const result = await pool.query(
      `${medicineQuery} WHERE m.pharmacy_id = $1 AND m.is_active ORDER BY m.name`,
      [request.user.pharmacyId],
    )
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
        (pharmacy_id, sku, name, generic_name, category_id, pack, manufacturer, batch_number,
         expiry_date, price, stock, reorder_level, gst_rate, hsn_code,
         prescription_required, description, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING id`,
      [request.user.pharmacyId, item.sku, item.name, item.genericName, category, item.pack, item.manufacturer,
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
    const result = await client.query(
      `${medicineQuery} WHERE m.id = $1 AND m.pharmacy_id = $2`,
      [id, request.user.pharmacyId],
    )
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
      'SELECT stock FROM medicines WHERE id = $1 AND pharmacy_id = $2 AND is_active FOR UPDATE',
      [id, request.user.pharmacyId],
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
        WHERE id = $1 AND pharmacy_id = $18 AND is_active
       RETURNING id`,
      [id, item.sku, item.name, item.genericName, category, item.pack, item.manufacturer,
        item.batchNumber, item.expiry, item.price, item.stock, item.reorderLevel,
         item.gstRate, item.hsnCode, item.prescriptionRequired, item.description, item.imageUrl,
         request.user.pharmacyId],
    )
    const stockChange = item.stock - existing.rows[0].stock
    if (stockChange !== 0) {
      await client.query(
        `INSERT INTO stock_movements (medicine_id, movement_type, quantity_change, note)
         VALUES ($1, 'adjustment', $2, 'Owner inventory adjustment')`,
        [id, stockChange],
      )
    }
    const result = await client.query(
      `${medicineQuery} WHERE m.id = $1 AND m.pharmacy_id = $2`,
      [id, request.user.pharmacyId],
    )
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
       WHERE id = $1 AND pharmacy_id = $2 AND is_active`,
      [id, request.user.pharmacyId],
    )
    if (!result.rowCount) return response.status(404).json({ error: 'Medicine was not found.' })
    response.status(204).end()
  } catch (error) {
    next(error)
  }
})

const orderSelect = `
  SELECT o.id::int AS id, o.order_number AS "orderNumber", o.status,
    o.pharmacy_id::int AS "pharmacyId", p.name AS "pharmacyName",
    o.total::float8 AS total, o.delivery_address AS "deliveryAddress",
    c.full_name AS "customerName", c.phone AS "customerPhone",
    o.created_at AS "createdAt", o.updated_at AS "updatedAt",
    COALESCE((
      SELECT json_agg(json_build_object(
        'medicineId', i.medicine_id::int, 'name', i.medicine_name, 'quantity', i.quantity,
        'unitPrice', i.unit_price::float8, 'lineTotal', i.line_total::float8
      ) ORDER BY i.id)
      FROM sales_order_items i WHERE i.order_id = o.id
    ), '[]'::json) AS items,
    COALESCE((
      SELECT json_agg(json_build_object('status', e.status, 'createdAt', e.created_at) ORDER BY e.created_at, e.id)
      FROM order_status_events e WHERE e.order_id = o.id
    ), '[]'::json) AS events
  FROM sales_orders o
  JOIN pharmacies p ON p.id = o.pharmacy_id
  LEFT JOIN customers c ON c.id = o.customer_id
`

app.post('/api/customer/orders', requireCustomer, async (request, response, next) => {
  const items = request.body?.items
  const paymentMethod = typeof request.body?.paymentMethod === 'string' ? request.body.paymentMethod.trim() : ''
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > 30 ||
    items.some((item) =>
      !Number.isSafeInteger(item?.medicineId) ||
      item.medicineId < 1 ||
      !Number.isSafeInteger(item?.quantity) ||
      item.quantity < 1 ||
      item.quantity > 50,
    ) ||
    new Set(items.map((item) => item.medicineId)).size !== items.length
  ) {
    return response.status(400).json({ error: 'Choose between 1 and 30 medicines with valid quantities.' })
  }
  if (!['Cash on Delivery', 'UPI Payment'].includes(paymentMethod)) {
    return response.status(400).json({ error: 'Choose a supported payment method.' })
  }

  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const customer = await client.query(
      'SELECT id FROM customers WHERE user_account_id = $1',
      [request.user.id],
    )
    if (!customer.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Customer profile was not found.' })
    }

    const addressResult = await client.query(
      `SELECT NULLIF(concat_ws(', ', NULLIF(address, ''), city, state, postal_code), '') AS address,
        latitude, longitude
       FROM customer_addresses WHERE user_account_id = $1 AND is_default
       ORDER BY id LIMIT 1`,
      [request.user.id],
    )
    const savedAddress = addressResult.rows[0]
    const deliveryAddress = savedAddress?.address ||
      (savedAddress?.latitude !== null && savedAddress?.latitude !== undefined
        ? `GPS ${savedAddress.latitude}, ${savedAddress.longitude}`
        : '')
    if (!deliveryAddress) {
      await client.query('ROLLBACK')
      return response.status(400).json({ error: 'Add a delivery address or GPS location in your profile before ordering.' })
    }

    const medicineIds = items.map((item) => item.medicineId).sort((a, b) => a - b)
    const medicineResult = await client.query(
      `SELECT id::int AS id, pharmacy_id::int AS "pharmacyId", name, price::float8 AS price, stock
       FROM medicines WHERE id = ANY($1::bigint[]) AND is_active
       ORDER BY id FOR UPDATE`,
      [medicineIds],
    )
    if (medicineResult.rowCount !== items.length) {
      await client.query('ROLLBACK')
      return response.status(409).json({ error: 'One or more medicines are no longer available. Refresh your cart.' })
    }
    const pharmacyIds = new Set(medicineResult.rows.map((item) => item.pharmacyId))
    if (pharmacyIds.size !== 1) {
      await client.query('ROLLBACK')
      return response.status(400).json({ error: 'Place separate orders for medicines from different pharmacies.' })
    }
    const medicineById = new Map(medicineResult.rows.map((item) => [item.id, item]))
    for (const item of items) {
      if (medicineById.get(item.medicineId).stock < item.quantity) {
        await client.query('ROLLBACK')
        return response.status(409).json({ error: `There is not enough stock for ${medicineById.get(item.medicineId).name}.` })
      }
    }

    const subtotal = items.reduce((sum, item) => sum + medicineById.get(item.medicineId).price * item.quantity, 0)
    const tax = Math.round(subtotal * 0.05 * 100) / 100
    const total = subtotal + (subtotal > 0 ? 49 : 0) + tax
    const deliveryOtp = String(randomInt(100000, 1000000))
    const otpHash = createHash('sha256').update(deliveryOtp).digest('hex')
    const orderNumber = `PH-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`
    const inserted = await client.query(
      `INSERT INTO sales_orders
        (order_number, customer_id, pharmacy_id, delivery_otp_hash, status, payment_method,
         subtotal, tax_amount, delivery_fee, total, delivery_address)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9, $10)
       RETURNING id::int AS id`,
      [orderNumber, customer.rows[0].id, [...pharmacyIds][0], otpHash, paymentMethod,
        subtotal, tax, subtotal > 0 ? 49 : 0, total, deliveryAddress],
    )
    const orderId = inserted.rows[0].id
    for (const item of items) {
      const medicine = medicineById.get(item.medicineId)
      const lineTotal = medicine.price * item.quantity
      await client.query(
        `INSERT INTO sales_order_items (order_id, medicine_id, medicine_name, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, item.medicineId, medicine.name, item.quantity, medicine.price, lineTotal],
      )
      await client.query(
        'UPDATE medicines SET stock = stock - $2, updated_at = now() WHERE id = $1',
        [item.medicineId, item.quantity],
      )
      await client.query(
        `INSERT INTO stock_movements (medicine_id, movement_type, quantity_change, note)
         VALUES ($1, 'sale', $2, $3)`,
        [item.medicineId, -item.quantity, `Order ${orderNumber}`],
      )
    }
    await client.query(
      `INSERT INTO order_status_events (order_id, status) VALUES ($1, 'pending')`,
      [orderId],
    )
    const order = await client.query(`${orderSelect} WHERE o.id = $1`, [orderId])
    await client.query('COMMIT')
    response.status(201).json({ ...order.rows[0], deliveryOtp })
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    next(error)
  } finally {
    client?.release()
  }
})

app.get('/api/customer/orders', requireCustomer, async (request, response, next) => {
  try {
    const result = await pool.query(
      `${orderSelect}
       WHERE c.user_account_id = $1
       ORDER BY o.created_at DESC, o.id DESC`,
      [request.user.id],
    )
    response.json(result.rows)
  } catch (error) {
    next(error)
  }
})

app.get('/api/owner/orders', requireOwner, async (request, response, next) => {
  try {
    const result = await pool.query(
      `${orderSelect} WHERE o.pharmacy_id = $1 ORDER BY o.created_at DESC, o.id DESC`,
      [request.user.pharmacyId],
    )
    response.json(result.rows)
  } catch (error) {
    next(error)
  }
})

app.get('/api/owner/stock-movements', requireOwner, async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT sm.id::int AS id, sm.movement_type AS type, sm.quantity_change AS "quantityChange",
        sm.note, sm.created_at AS "createdAt", m.id::int AS "medicineId",
        m.name AS "medicineName", m.sku
       FROM stock_movements sm
       JOIN medicines m ON m.id = sm.medicine_id
       WHERE m.pharmacy_id = $1
       ORDER BY sm.created_at DESC, sm.id DESC
       LIMIT 100`,
      [request.user.pharmacyId],
    )
    response.json(result.rows)
  } catch (error) {
    next(error)
  }
})

app.put('/api/owner/orders/:id/status', requireOwner, async (request, response, next) => {
  const id = Number(request.params.id)
  const nextStatus = request.body?.status
  const otp = typeof request.body?.otp === 'string' ? request.body.otp.trim() : ''
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid order ID.' })
  const transitions = {
    pending: ['accepted', 'declined'],
    accepted: ['preparing'],
    preparing: ['out_for_delivery'],
    out_for_delivery: ['delivered'],
    delivered: [],
    declined: [],
    cancelled: [],
  }

  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const order = await client.query(
      'SELECT id, status, delivery_otp_hash FROM sales_orders WHERE id = $1 AND pharmacy_id = $2 FOR UPDATE',
      [id, request.user.pharmacyId],
    )
    if (!order.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Order was not found.' })
    }
    const current = order.rows[0]
    if (!transitions[current.status]?.includes(nextStatus)) {
      await client.query('ROLLBACK')
      return response.status(409).json({ error: `Cannot change an order from ${current.status} to ${nextStatus}.` })
    }
    if (nextStatus === 'delivered') {
      const suppliedHash = createHash('sha256').update(otp).digest()
      const storedHash = Buffer.from(current.delivery_otp_hash || '', 'hex')
      if (!/^\d{6}$/.test(otp) || storedHash.length !== suppliedHash.length || !timingSafeEqual(suppliedHash, storedHash)) {
        await client.query('ROLLBACK')
        return response.status(400).json({ error: 'The delivery code is incorrect. Ask the customer to confirm the code.' })
      }
    }
    if (nextStatus === 'declined') {
      const items = await client.query(
        'SELECT medicine_id, quantity FROM sales_order_items WHERE order_id = $1 AND medicine_id IS NOT NULL',
        [id],
      )
      for (const item of items.rows) {
        await client.query(
          'UPDATE medicines SET stock = stock + $2, updated_at = now() WHERE id = $1',
          [item.medicine_id, item.quantity],
        )
        await client.query(
          `INSERT INTO stock_movements (medicine_id, movement_type, quantity_change, note)
           VALUES ($1, 'return', $2, $3)`,
          [item.medicine_id, item.quantity, `Restocked after order ${id} was declined`],
        )
      }
    }
    await client.query(
      `UPDATE sales_orders SET status = $2, updated_at = now(),
         delivery_otp_hash = CASE WHEN $2 = 'delivered' THEN NULL ELSE delivery_otp_hash END
       WHERE id = $1`,
      [id, nextStatus],
    )
    await client.query(
      'INSERT INTO order_status_events (order_id, status) VALUES ($1, $2)',
      [id, nextStatus],
    )
    const updated = await client.query(`${orderSelect} WHERE o.id = $1`, [id])
    await client.query('COMMIT')
    response.json(updated.rows[0])
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    next(error)
  } finally {
    client?.release()
  }
})

app.get('/api/catalog/medicines/:id/reviews', async (request, response, next) => {
  const medicineId = Number(request.params.id)
  if (!Number.isSafeInteger(medicineId) || medicineId < 1) return response.status(400).json({ error: 'Invalid medicine ID.' })
  try {
    const result = await pool.query(
      `SELECT r.id::int AS id, r.rating, r.comment, r.created_at AS "createdAt", c.full_name AS "customerName"
       FROM product_reviews r
       JOIN customers c ON c.id = r.customer_id
       WHERE r.medicine_id = $1
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 50`,
      [medicineId],
    )
    const summary = await pool.query(
      'SELECT COALESCE(AVG(rating), 0)::float8 AS rating, COUNT(*)::int AS "reviewCount" FROM product_reviews WHERE medicine_id = $1',
      [medicineId],
    )
    response.json({ reviews: result.rows, ...summary.rows[0] })
  } catch (error) {
    next(error)
  }
})

app.post('/api/customer/medicines/:id/reviews', requireCustomer, async (request, response, next) => {
  const medicineId = Number(request.params.id)
  const rating = request.body?.rating
  const comment = typeof request.body?.comment === 'string' ? request.body.comment.trim() : ''
  if (!Number.isSafeInteger(medicineId) || medicineId < 1) return response.status(400).json({ error: 'Invalid medicine ID.' })
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || comment.length > 500) {
    return response.status(400).json({ error: 'Choose a 1–5 star rating and keep comments under 500 characters.' })
  }
  try {
    const eligible = await pool.query(
      `SELECT c.id FROM customers c
       JOIN sales_orders o ON o.customer_id = c.id AND o.status = 'delivered'
       JOIN sales_order_items i ON i.order_id = o.id AND i.medicine_id = $2
       WHERE c.user_account_id = $1
       LIMIT 1`,
      [request.user.id, medicineId],
    )
    if (!eligible.rowCount) {
      return response.status(403).json({ error: 'Product reviews are available after your order containing this medicine is delivered.' })
    }
    const result = await pool.query(
      `INSERT INTO product_reviews (medicine_id, customer_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (medicine_id, customer_id) DO UPDATE SET
         rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now()
       RETURNING id::int AS id, rating, comment, created_at AS "createdAt"`,
      [medicineId, eligible.rows[0].id, rating, comment],
    )
    response.status(201).json(result.rows[0])
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
