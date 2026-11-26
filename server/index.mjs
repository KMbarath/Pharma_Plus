import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import express from 'express'
import pg from 'pg'
import cors from 'cors'
import { createServer as createHttpsServer } from 'node:https'
import { mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import multer from 'multer'
import { canTransitionOrderStatus, isOrderStatus } from './order-status.mjs'
import {
  createDeliveryCodeVerifier,
  deriveDeliveryCode,
  loadDeliveryCodeKeyRing,
  verifyDeliveryCode,
} from './delivery-code.mjs'

const app = express()
const port = Number(process.env.API_PORT || 3001)
const mobilePort = Number(process.env.MOBILE_API_PORT || 3002)
const mobileLanEnabled = process.env.MOBILE_LAN === '1'
const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const prescriptionStorageDir = resolve(
  process.env.PRESCRIPTION_STORAGE_DIR || join(homedir(), '.pharma-plus', 'private-prescriptions'),
)
const forbiddenPrescriptionDirs = [projectRoot]
const prescriptionStorageKey = process.env.PRESCRIPTION_STORAGE_KEY || ''
const clamScanPath = process.env.CLAMSCAN_PATH || 'clamscan'
const databaseHost = process.env.PGHOST || (process.platform === 'win32' ? '127.0.0.1' : '/tmp')
const databaseUser = process.env.PGUSER || process.env.USER || process.env.USERNAME
const deliveryCodeKeyRing = await loadDeliveryCodeKeyRing()
const productImageDirectory = fileURLToPath(new URL('../uploads/products/', import.meta.url))
const allowedOrigins = new Set([
  'https://localhost',
  'capacitor://localhost',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
])
const authSessions = new Map()
const checkoutQuotes = new Map()
const pool = new pg.Pool({
  host: databaseHost,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'pharma_plus',
  user: databaseUser,
  password: process.env.PGPASSWORD || undefined,
})

const prescriptionUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2, parts: 3, fieldSize: 8192 },
})
const upiQrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1, fields: 0, parts: 1 },
})

function parseUpiQrUpload(request, response, next) {
  upiQrUpload.single('file')(request, response, (error) => {
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE'
      return response.status(tooLarge ? 413 : 400).json({
        error: tooLarge ? 'UPI QR images must be 1 MB or smaller.' : 'Upload one UPI QR image.',
      })
    }
    if (error) return next(error)
    next()
  })
}

class ApiError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED', details = {}) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

async function rollbackTransaction(client) {
  try {
    await client.query('ROLLBACK')
  } catch (error) {
    console.error('Could not roll back a database transaction:', error)
  }
}

function priceToCents(value) {
  const price = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(price) || price < 0) return null
  return Math.round(price * 100)
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true)
    return callback(new Error('This origin is not allowed to access the pharmacy API.'))
  },
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}))
app.use(express.json({ limit: '32kb' }))
app.use('/api/uploads/products', express.static(productImageDirectory, {
  fallthrough: false,
  index: false,
  maxAge: '1d',
}))

function productImageExtension(contentType, image) {
  if (
    contentType === 'image/jpeg' &&
    image.length >= 3 &&
    image[0] === 0xff &&
    image[1] === 0xd8 &&
    image[2] === 0xff
  ) return 'jpg'
  if (
    contentType === 'image/png' &&
    image.length >= 8 &&
    image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  ) return 'png'
  if (
    contentType === 'image/webp' &&
    image.length >= 12 &&
    image.toString('ascii', 0, 4) === 'RIFF' &&
    image.toString('ascii', 8, 12) === 'WEBP'
  ) return 'webp'
  return null
}

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
const requireAdmin = (request, response, next) => {
  requireAuth(request, response, () => requireRole('admin')(request, response, next))
}

async function requireAuthorizedPharmacist(request, response, next) {
  if (!Number.isSafeInteger(request.user.pharmacyId) || request.user.pharmacyId < 1) {
    return response.status(403).json({ error: 'This account is not linked to a pharmacy.' })
  }
  try {
    const result = await pool.query(
      `SELECT 1
       FROM pharmacies p
       JOIN LATERAL (
         SELECT decision, authorized_pharmacist_name, authorized_pharmacist_registration
         FROM pharmacy_verifications
         WHERE pharmacy_id = p.id
         ORDER BY submitted_at DESC
         LIMIT 1
       ) v ON true
       WHERE p.id = $1 AND p.approval_status = 'approved'
         AND v.decision = 'approved'
         AND NULLIF(btrim(v.authorized_pharmacist_registration), '') IS NOT NULL
         AND lower(btrim(v.authorized_pharmacist_name)) = lower(btrim($2))`,
      [request.user.pharmacyId, request.user.fullName],
    )
    if (!result.rowCount) {
      return response.status(403).json({
        error: 'Prescription review is limited to the pharmacist named in this pharmacy’s approved verification.',
      })
    }
    next()
  } catch (error) {
    next(error)
  }
}

function prescriptionEncryptionKey() {
  if (!/^[\da-f]{64}$/i.test(prescriptionStorageKey)) {
    const error = new Error('Prescription storage is not configured. Set PRESCRIPTION_STORAGE_KEY to a random 32-byte hex key.')
    error.status = 503
    throw error
  }
  return Buffer.from(prescriptionStorageKey, 'hex')
}

function encryptPrescription(buffer) {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', prescriptionEncryptionKey(), nonce)
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()])
  return Buffer.concat([Buffer.from('PPPR1'), nonce, cipher.getAuthTag(), ciphertext])
}

function decryptPrescription(buffer) {
  if (buffer.length < 33 || buffer.subarray(0, 5).toString('ascii') !== 'PPPR1') {
    throw new Error('The stored prescription document has an invalid encrypted format.')
  }
  const nonce = buffer.subarray(5, 17)
  const authTag = buffer.subarray(17, 33)
  const decipher = createDecipheriv('aes-256-gcm', prescriptionEncryptionKey(), nonce)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(buffer.subarray(33)), decipher.final()])
}

function prescriptionStoragePath(storageKey) {
  if (!/^[\da-f-]{36}\.bin$/i.test(storageKey)) {
    throw new Error('The prescription storage key is invalid.')
  }
  if (forbiddenPrescriptionDirs.some((forbiddenDir) => {
    const relativePath = relative(forbiddenDir, prescriptionStorageDir)
    return relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  })) {
    const error = new Error('Prescription storage must be outside the project and its public frontend assets.')
    error.status = 503
    throw error
  }
  return join(prescriptionStorageDir, storageKey)
}

async function ensurePrivatePrescriptionStorage(storageKey) {
  prescriptionStoragePath(storageKey)
  await mkdir(prescriptionStorageDir, { recursive: true, mode: 0o700 })
  const actualDirectory = await realpath(prescriptionStorageDir)
  if (forbiddenPrescriptionDirs.some((forbiddenDir) => {
    const relativePath = relative(forbiddenDir, actualDirectory)
    return relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  })) {
    const error = new Error('Prescription storage resolves inside the project and is not safe to use.')
    error.status = 503
    throw error
  }
  return join(actualDirectory, storageKey)
}

function validatePrescriptionFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    return 'Choose a prescription document to upload.'
  }
  if (file.mimetype === 'application/pdf' &&
      file.buffer.subarray(0, 5).toString('ascii') === '%PDF-') return null
  if (file.mimetype === 'image/png' &&
      file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null
  if (file.mimetype === 'image/jpeg' &&
      file.buffer.length >= 3 && file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff) return null
  return 'Use a valid PDF, JPEG, or PNG prescription document.'
}

function validateUpiQrFile(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    return 'Choose a UPI QR image to upload.'
  }
  if (file.mimetype === 'image/png' &&
      file.buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null
  if (file.mimetype === 'image/jpeg' &&
      file.buffer.length >= 3 && file.buffer[0] === 0xff && file.buffer[1] === 0xd8 && file.buffer[2] === 0xff) return null
  if (file.mimetype === 'image/webp' && file.buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      file.buffer.subarray(8, 12).toString('ascii') === 'WEBP') return null
  return 'Use a valid PNG, JPEG, or WebP UPI QR image.'
}

function scanPrescriptionBuffer(buffer) {
  return new Promise((resolveScan, rejectScan) => {
    const scanner = spawn(clamScanPath, ['--no-summary', '-'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let output = ''
    let settled = false
    const timeout = setTimeout(() => {
      scanner.kill()
      if (!settled) {
        settled = true
        const error = new Error('Malware screening timed out. The document was not saved.')
        error.status = 503
        rejectScan(error)
      }
    }, 30000)
    const collect = (chunk) => {
      output = `${output}${chunk.toString()}`.slice(-8192)
    }
    scanner.stdout.on('data', collect)
    scanner.stderr.on('data', collect)
    scanner.on('error', (cause) => {
      clearTimeout(timeout)
      if (settled) return
      settled = true
      const error = new Error(cause.code === 'ENOENT'
        ? 'Malware screening is unavailable. Install ClamAV or set CLAMSCAN_PATH; uploads remain disabled until scanning works.'
        : 'Malware screening could not start. The document was not saved.')
      error.status = 503
      rejectScan(error)
    })
    scanner.on('close', (code) => {
      clearTimeout(timeout)
      if (settled) return
      settled = true
      if (code === 0) return resolveScan()
      if (code === 1 && /FOUND/i.test(output)) {
        const error = new Error('Malware screening rejected this document.')
        error.status = 400
        return rejectScan(error)
      }
      const error = new Error(`Malware screening failed (exit ${code ?? 'unknown'}). The document was not saved.`)
      error.status = 503
      rejectScan(error)
    })
    scanner.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') {
        clearTimeout(timeout)
        if (!settled) {
          settled = true
          const scanError = new Error('Malware screening could not read the document.')
          scanError.status = 503
          rejectScan(scanError)
        }
      }
    })
    scanner.stdin.end(buffer)
  })
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

async function ensureAdminAccount() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  const password = process.env.ADMIN_PASSWORD || ''
  const fullName = (process.env.ADMIN_NAME || 'Pharma Plus Admin').trim()
  if (!email && !password) return
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) {
    throw new Error('ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters are required to create an admin account.')
  }
  const salt = randomBytes(16)
  const passwordHash = scryptSync(password, salt, 64)
  await pool.query(
    `INSERT INTO user_accounts (role, email, full_name, password_salt, password_hash)
     VALUES ('admin', $1, $2, $3, $4) ON CONFLICT (email) DO NOTHING`,
    [email, fullName, salt, passwordHash],
  )
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
      await client.query(
        `UPDATE pharmacies SET approval_status = 'pending', onboarding_submitted_at = now() WHERE id = $1`,
        [pharmacyId],
      )
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

// Compatibility endpoint for clients that use the conventional /auth/me contract.
app.get('/api/auth/me', requireAuth, (request, response) => {
  response.set('Cache-Control', 'no-store')
  response.json({ user: request.user })
})

app.post('/api/auth/logout', requireAuth, (request, response) => {
  authSessions.delete(request.sessionToken)
  response.status(204).end()
})

app.get('/api/me/profile', requireCustomer, async (request, response, next) => {
  try {
    const account = await findAccount(request.user.email)
    if (!account || account.role !== 'customer') return response.status(404).json({ error: 'Customer profile was not found.' })
    response.json({ user: publicAccount(account) })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/me/profile', requireCustomer, async (request, response, next) => {
  const fullName = typeof request.body?.fullName === 'string' ? request.body.fullName.trim() : ''
  const phone = typeof request.body?.phone === 'string' ? request.body.phone.trim() || null : null
  if (fullName.length < 2 || fullName.length > 120) {
    return response.status(400).json({ error: 'Enter a name between 2 and 120 characters.' })
  }
  if (Object.hasOwn(request.body ?? {}, 'phone') && request.body.phone !== null && typeof request.body.phone !== 'string') {
    return response.status(400).json({ error: 'Enter a valid phone number.' })
  }
  if (phone && phone.length > 40) return response.status(400).json({ error: 'Phone number must be 40 characters or fewer.' })

  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const updated = await client.query(
      `UPDATE user_accounts SET full_name = $2, phone = $3, updated_at = now()
       WHERE id = $1 AND role = 'customer' RETURNING email`,
      [request.user.id, fullName, phone],
    )
    if (!updated.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Customer profile was not found.' })
    }
    await client.query(
      `UPDATE customers SET full_name = $2, phone = $3 WHERE user_account_id = $1`,
      [request.user.id, fullName, phone],
    )
    await client.query('COMMIT')
    const account = await findAccount(updated.rows[0].email)
    const user = publicAccount(account)
    authSessions.get(request.sessionToken).user = user
    response.json({ user })
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    if (error.code === '23505') return response.status(409).json({ error: 'That phone number is already in use.' })
    next(error)
  } finally {
    client?.release()
  }
})

function customerSettingsRow(row) {
  return {
    language: row.language,
    theme: row.theme,
    textScale: Number(row.textScale),
    orderNotificationsEnabled: row.orderNotificationsEnabled,
    medicineNotificationsEnabled: row.medicineNotificationsEnabled,
    updatedAt: row.updatedAt,
  }
}

const customerSettingsSelect = `
  SELECT language, theme, text_scale::float8 AS "textScale",
    order_notifications_enabled AS "orderNotificationsEnabled",
    medicine_notifications_enabled AS "medicineNotificationsEnabled",
    updated_at AS "updatedAt"
  FROM customer_settings WHERE user_account_id = $1
`

app.get('/api/me/settings', requireCustomer, async (request, response, next) => {
  try {
    await pool.query(
      `INSERT INTO customer_settings (user_account_id) VALUES ($1)
       ON CONFLICT (user_account_id) DO NOTHING`,
      [request.user.id],
    )
    const result = await pool.query(customerSettingsSelect, [request.user.id])
    if (!result.rowCount) return response.status(404).json({ error: 'Customer settings were not found.' })
    response.json({ settings: customerSettingsRow(result.rows[0]) })
  } catch (error) {
    next(error)
  }
})

app.patch('/api/me/settings', requireCustomer, async (request, response, next) => {
  const body = request.body ?? {}
  const allowedFields = new Set([
    'language',
    'theme',
    'textScale',
    'orderNotificationsEnabled',
    'medicineNotificationsEnabled',
  ])
  const unknownFields = Object.keys(body).filter((key) => !allowedFields.has(key))
  if (unknownFields.length) return response.status(400).json({ error: 'One or more settings are not supported.' })
  if (!Object.keys(body).length) return response.status(400).json({ error: 'Choose at least one setting to update.' })
  if (Object.hasOwn(body, 'language') && body.language !== 'en') {
    return response.status(400).json({ error: 'That language is not available yet.' })
  }
  if (Object.hasOwn(body, 'theme') && !['system', 'light', 'dark'].includes(body.theme)) {
    return response.status(400).json({ error: 'Choose system, light, or dark theme.' })
  }
  if (
    Object.hasOwn(body, 'textScale') &&
    (typeof body.textScale !== 'number' || !Number.isFinite(body.textScale) || body.textScale < 0.9 || body.textScale > 1.2)
  ) {
    return response.status(400).json({ error: 'Text size must be between 90% and 120%.' })
  }
  for (const field of ['orderNotificationsEnabled', 'medicineNotificationsEnabled']) {
    if (Object.hasOwn(body, field) && typeof body[field] !== 'boolean') {
      return response.status(400).json({ error: `Choose whether ${field === 'orderNotificationsEnabled' ? 'order updates' : 'medicine alerts'} are enabled.` })
    }
  }

  try {
    const result = await pool.query(
      `INSERT INTO customer_settings
         (user_account_id, language, theme, text_scale,
          order_notifications_enabled, medicine_notifications_enabled)
       VALUES ($1, COALESCE($2, 'en'), COALESCE($3, 'system'), COALESCE($4::numeric, 1),
          COALESCE($5, true), COALESCE($6, true))
       ON CONFLICT (user_account_id) DO UPDATE SET
         language = COALESCE($2, customer_settings.language),
         theme = COALESCE($3, customer_settings.theme),
         text_scale = COALESCE($4::numeric, customer_settings.text_scale),
         order_notifications_enabled = COALESCE($5, customer_settings.order_notifications_enabled),
         medicine_notifications_enabled = COALESCE($6, customer_settings.medicine_notifications_enabled),
         updated_at = now()
       RETURNING language, theme, text_scale::float8 AS "textScale",
         order_notifications_enabled AS "orderNotificationsEnabled",
         medicine_notifications_enabled AS "medicineNotificationsEnabled",
         updated_at AS "updatedAt"`,
      [
        request.user.id,
        Object.hasOwn(body, 'language') ? body.language : null,
        Object.hasOwn(body, 'theme') ? body.theme : null,
        Object.hasOwn(body, 'textScale') ? body.textScale : null,
        Object.hasOwn(body, 'orderNotificationsEnabled') ? body.orderNotificationsEnabled : null,
        Object.hasOwn(body, 'medicineNotificationsEnabled') ? body.medicineNotificationsEnabled : null,
      ],
    )
    response.json({ settings: customerSettingsRow(result.rows[0]) })
  } catch (error) {
    next(error)
  }
})

function familyProfileStatus(row) {
  if (row.removedAt) return 'removed'
  if (row.authorizationRevokedAt) return 'revoked'
  return 'active'
}

function familyProfileRow(row) {
  return {
    id: row.id,
    displayName: row.displayName,
    relationship: row.relationship,
    memberType: row.memberType,
    authorizationType: row.authorizationType,
    authorizationVersion: row.authorizationVersion,
    authorizationConfirmedAt: row.authorizationConfirmedAt,
    authorizationRevokedAt: row.authorizationRevokedAt,
    removedAt: row.removedAt,
    status: familyProfileStatus(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

const familyProfileSelect = `
  SELECT id::int AS id, display_name AS "displayName", relationship,
    member_type AS "memberType", authorization_type AS "authorizationType",
    authorization_policy_version AS "authorizationVersion",
    authorization_confirmed_at AS "authorizationConfirmedAt",
    authorization_revoked_at AS "authorizationRevokedAt", removed_at AS "removedAt",
    created_at AS "createdAt", updated_at AS "updatedAt"
  FROM family_profiles
`

async function recordFamilyProfileEvent(client, profileId, actorUserId, action, details = {}) {
  await client.query(
    `INSERT INTO family_profile_audit_events
       (family_profile_id, actor_user_id, action, details)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [profileId, actorUserId, action, JSON.stringify(details)],
  )
}

app.get('/api/me/family', requireCustomer, async (request, response, next) => {
  try {
    const result = await pool.query(
      `${familyProfileSelect}
       WHERE owner_user_id = $1
       ORDER BY created_at, id`,
      [request.user.id],
    )
    response.json({ familyProfiles: result.rows.map(familyProfileRow) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/me/family', requireCustomer, async (request, response, next) => {
  const body = request.body ?? {}
  const allowedFields = new Set(['displayName', 'relationship', 'memberType', 'authorizationConfirmed'])
  if (Object.keys(body).some((key) => !allowedFields.has(key))) {
    return response.status(400).json({ error: 'Only a name, relationship, member type, and authorization confirmation may be saved.' })
  }
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : ''
  const relationship = typeof body.relationship === 'string' ? body.relationship.trim() : ''
  const memberType = body.memberType
  if (displayName.length < 2 || displayName.length > 120) {
    return response.status(400).json({ error: 'Enter a family member name between 2 and 120 characters.' })
  }
  if (!relationship || relationship.length > 40) {
    return response.status(400).json({ error: 'Enter a relationship up to 40 characters.' })
  }
  if (!['adult', 'minor'].includes(memberType)) {
    return response.status(400).json({ error: 'Choose whether this family member is an adult or a minor.' })
  }
  if (body.authorizationConfirmed !== true) {
    return response.status(400).json({ error: 'Confirm that the adult has consented or that you are authorized to manage this minor.' })
  }

  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const authorizationType = memberType === 'adult' ? 'adult_consent' : 'guardian_authorization'
    const result = await client.query(
      `INSERT INTO family_profiles
         (owner_user_id, display_name, relationship, member_type, authorization_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id::int AS id, display_name AS "displayName", relationship,
         member_type AS "memberType", authorization_type AS "authorizationType",
         authorization_policy_version AS "authorizationVersion",
         authorization_confirmed_at AS "authorizationConfirmedAt",
         authorization_revoked_at AS "authorizationRevokedAt", removed_at AS "removedAt",
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [request.user.id, displayName, relationship, memberType, authorizationType],
    )
    const profile = result.rows[0]
    await recordFamilyProfileEvent(client, profile.id, request.user.id, 'created', {
      memberType,
      authorizationType,
      authorizationVersion: 'v1',
    })
    await client.query('COMMIT')
    response.status(201).json(familyProfileRow(profile))
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    next(error)
  } finally {
    client?.release()
  }
})

app.patch('/api/me/family/:id', requireCustomer, async (request, response, next) => {
  const profileId = Number(request.params.id)
  if (!Number.isSafeInteger(profileId) || profileId < 1) return response.status(400).json({ error: 'Invalid family profile ID.' })
  const body = request.body ?? {}
  const allowedFields = new Set(['displayName', 'relationship'])
  if (!Object.keys(body).length || Object.keys(body).some((key) => !allowedFields.has(key))) {
    return response.status(400).json({ error: 'Update only the family member name or relationship.' })
  }
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const existing = await client.query(
      `${familyProfileSelect}
       WHERE id = $1 AND owner_user_id = $2
       FOR UPDATE`,
      [profileId, request.user.id],
    )
    if (!existing.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Family profile was not found.' })
    }
    if (existing.rows[0].removedAt || existing.rows[0].authorizationRevokedAt) {
      await client.query('ROLLBACK')
      return response.status(409).json({ error: 'A removed or revoked family profile cannot be edited.' })
    }
    const displayName = Object.hasOwn(body, 'displayName')
      ? typeof body.displayName === 'string' ? body.displayName.trim() : ''
      : existing.rows[0].displayName
    const relationship = Object.hasOwn(body, 'relationship')
      ? typeof body.relationship === 'string' ? body.relationship.trim() : ''
      : existing.rows[0].relationship
    if (displayName.length < 2 || displayName.length > 120) {
      await client.query('ROLLBACK')
      return response.status(400).json({ error: 'Enter a family member name between 2 and 120 characters.' })
    }
    if (!relationship || relationship.length > 40) {
      await client.query('ROLLBACK')
      return response.status(400).json({ error: 'Enter a relationship up to 40 characters.' })
    }
    const updated = await client.query(
      `UPDATE family_profiles SET display_name = $3, relationship = $4, updated_at = now()
       WHERE id = $1 AND owner_user_id = $2
       RETURNING id::int AS id, display_name AS "displayName", relationship,
         member_type AS "memberType", authorization_type AS "authorizationType",
         authorization_policy_version AS "authorizationVersion",
         authorization_confirmed_at AS "authorizationConfirmedAt",
         authorization_revoked_at AS "authorizationRevokedAt", removed_at AS "removedAt",
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [profileId, request.user.id, displayName, relationship],
    )
    await recordFamilyProfileEvent(client, profileId, request.user.id, 'updated', {
      changedFields: Object.keys(body),
    })
    await client.query('COMMIT')
    response.json(familyProfileRow(updated.rows[0]))
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    next(error)
  } finally {
    client?.release()
  }
})

app.post('/api/me/family/:id/revoke', requireCustomer, async (request, response, next) => {
  const profileId = Number(request.params.id)
  if (!Number.isSafeInteger(profileId) || profileId < 1) return response.status(400).json({ error: 'Invalid family profile ID.' })
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const existing = await client.query(
      `${familyProfileSelect}
       WHERE id = $1 AND owner_user_id = $2
       FOR UPDATE`,
      [profileId, request.user.id],
    )
    if (!existing.rowCount || existing.rows[0].removedAt) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Family profile was not found.' })
    }
    if (existing.rows[0].authorizationRevokedAt) {
      await client.query('COMMIT')
      return response.json(familyProfileRow(existing.rows[0]))
    }
    const updated = await client.query(
      `UPDATE family_profiles SET authorization_revoked_at = now(), updated_at = now()
       WHERE id = $1 AND owner_user_id = $2
       RETURNING id::int AS id, display_name AS "displayName", relationship,
         member_type AS "memberType", authorization_type AS "authorizationType",
         authorization_policy_version AS "authorizationVersion",
         authorization_confirmed_at AS "authorizationConfirmedAt",
         authorization_revoked_at AS "authorizationRevokedAt", removed_at AS "removedAt",
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [profileId, request.user.id],
    )
    await recordFamilyProfileEvent(client, profileId, request.user.id, 'authorization_revoked')
    await client.query('COMMIT')
    response.json(familyProfileRow(updated.rows[0]))
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    next(error)
  } finally {
    client?.release()
  }
})

app.delete('/api/me/family/:id', requireCustomer, async (request, response, next) => {
  const profileId = Number(request.params.id)
  if (!Number.isSafeInteger(profileId) || profileId < 1) return response.status(400).json({ error: 'Invalid family profile ID.' })
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const existing = await client.query(
      `${familyProfileSelect}
       WHERE id = $1 AND owner_user_id = $2
       FOR UPDATE`,
      [profileId, request.user.id],
    )
    if (!existing.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Family profile was not found.' })
    }
    if (existing.rows[0].removedAt) {
      await client.query('COMMIT')
      return response.json(familyProfileRow(existing.rows[0]))
    }
    const removed = await client.query(
      `UPDATE family_profiles
       SET display_name = 'Removed profile', relationship = 'removed',
         authorization_revoked_at = COALESCE(authorization_revoked_at, now()),
         removed_at = now(), updated_at = now()
       WHERE id = $1 AND owner_user_id = $2
       RETURNING id::int AS id, display_name AS "displayName", relationship,
         member_type AS "memberType", authorization_type AS "authorizationType",
         authorization_policy_version AS "authorizationVersion",
         authorization_confirmed_at AS "authorizationConfirmedAt",
         authorization_revoked_at AS "authorizationRevokedAt", removed_at AS "removedAt",
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [profileId, request.user.id],
    )
    await recordFamilyProfileEvent(client, profileId, request.user.id, 'removed')
    await client.query('COMMIT')
    response.json(familyProfileRow(removed.rows[0]))
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    next(error)
  } finally {
    client?.release()
  }
})

app.get('/api/me/addresses', requireCustomer, async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT id::int AS id, label, contact_phone AS "contactPhone", address, city, state,
        postal_code AS "postalCode", latitude, longitude, is_default AS "isDefault"
       FROM customer_addresses WHERE user_account_id = $1
       ORDER BY is_default DESC, id`,
      [request.user.id],
    )
    response.json({ addresses: result.rows })
  } catch (error) {
    next(error)
  }
})

function parseSavedAddress(body, existing = null) {
  const value = (key, fallback = '') => Object.hasOwn(body, key) ? body[key] : fallback
  const labelValue = value('label', existing?.label ?? '')
  if (typeof labelValue !== 'string') return { error: 'Enter a valid address label.' }
  const label = labelValue.trim()
  const contactPhoneValue = value('contactPhone', existing?.contactPhone ?? null)
  if (contactPhoneValue !== null && typeof contactPhoneValue !== 'string') {
    return { error: 'Enter a valid contact number.' }
  }
  const contactPhone = typeof contactPhoneValue === 'string' ? contactPhoneValue.trim() || null : null
  const addressValue = value('address', existing?.address ?? null)
  if (addressValue !== null && typeof addressValue !== 'string') return { error: 'Enter a valid street address.' }
  const address = typeof addressValue === 'string' ? addressValue.trim() || null : null
  const cityValue = value('city', existing?.city ?? null)
  if (cityValue !== null && typeof cityValue !== 'string') return { error: 'Enter a valid city.' }
  const city = typeof cityValue === 'string' ? cityValue.trim() || null : null
  const stateValue = value('state', existing?.state ?? null)
  if (stateValue !== null && typeof stateValue !== 'string') return { error: 'Enter a valid state.' }
  const state = typeof stateValue === 'string' ? stateValue.trim() || null : null
  const postalCodeValue = value('postalCode', existing?.postalCode ?? null)
  if (postalCodeValue !== null && typeof postalCodeValue !== 'string') return { error: 'Enter a valid postal code.' }
  const postalCode = typeof postalCodeValue === 'string' ? postalCodeValue.trim() || null : null
  const latitude = value('latitude', existing?.latitude ?? null)
  const longitude = value('longitude', existing?.longitude ?? null)
  const isDefault = value('isDefault', existing?.isDefault ?? false)
  if (!label || label.length > 60) return { error: 'Enter an address label up to 60 characters.' }
  if ((address?.length ?? 0) > 500 || (city?.length ?? 0) > 120 || (state?.length ?? 0) > 120 || (postalCode?.length ?? 0) > 30) {
    return { error: 'Address details exceed the allowed length.' }
  }
  if (contactPhone && contactPhone.length > 40) return { error: 'Contact number must be 40 characters or fewer.' }
  if ((latitude === null) !== (longitude === null) ||
      (latitude !== null && (typeof latitude !== 'number' || !Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
      (longitude !== null && (typeof longitude !== 'number' || !Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
    return { error: 'Enter valid latitude and longitude coordinates.' }
  }
  if (!address && (latitude === null || longitude === null)) {
    return { error: 'Enter a street address or use GPS to save coordinates.' }
  }
  if (typeof isDefault !== 'boolean') return { error: 'Choose whether this is your default address.' }
  return { value: { label, contactPhone, address, city, state, postalCode, latitude, longitude, isDefault } }
}

app.post('/api/me/addresses', requireCustomer, async (request, response, next) => {
  const parsed = parseSavedAddress(request.body ?? {})
  if (parsed.error) return response.status(400).json({ error: parsed.error })
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    await client.query('SELECT id FROM user_accounts WHERE id = $1 FOR UPDATE', [request.user.id])
    const hasDefault = await client.query(
      'SELECT 1 FROM customer_addresses WHERE user_account_id = $1 AND is_default LIMIT 1',
      [request.user.id],
    )
    const address = parsed.value
    const isDefault = address.isDefault || !hasDefault.rowCount
    if (isDefault) {
      await client.query('UPDATE customer_addresses SET is_default = false WHERE user_account_id = $1', [request.user.id])
    }
    const result = await client.query(
      `INSERT INTO customer_addresses
        (user_account_id, label, contact_phone, address, city, state, postal_code,
         latitude, longitude, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id::int AS id, label, contact_phone AS "contactPhone", address, city, state,
         postal_code AS "postalCode", latitude, longitude, is_default AS "isDefault"`,
      [request.user.id, address.label, address.contactPhone, address.address, address.city,
        address.state, address.postalCode, address.latitude, address.longitude, isDefault],
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

app.patch('/api/me/addresses/:id', requireCustomer, async (request, response, next) => {
  const addressId = Number(request.params.id)
  if (!Number.isSafeInteger(addressId) || addressId < 1) return response.status(400).json({ error: 'Invalid address ID.' })
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    await client.query('SELECT id FROM user_accounts WHERE id = $1 FOR UPDATE', [request.user.id])
    const existing = await client.query(
      `SELECT id::int AS id, label, contact_phone AS "contactPhone", address, city, state,
        postal_code AS "postalCode", latitude, longitude, is_default AS "isDefault"
       FROM customer_addresses WHERE id = $1 AND user_account_id = $2 FOR UPDATE`,
      [addressId, request.user.id],
    )
    if (!existing.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Saved address was not found.' })
    }
    const parsed = parseSavedAddress(request.body ?? {}, existing.rows[0])
    if (parsed.error) {
      await client.query('ROLLBACK')
      return response.status(400).json({ error: parsed.error })
    }
    const address = parsed.value
    if (address.isDefault) {
      await client.query(
        'UPDATE customer_addresses SET is_default = false WHERE user_account_id = $1 AND id <> $2',
        [request.user.id, addressId],
      )
    }
    const updated = await client.query(
      `UPDATE customer_addresses SET label = $3, contact_phone = $4, address = $5,
        city = $6, state = $7, postal_code = $8, latitude = $9, longitude = $10,
        is_default = $11
       WHERE id = $1 AND user_account_id = $2
       RETURNING id::int AS id, label, contact_phone AS "contactPhone", address, city, state,
         postal_code AS "postalCode", latitude, longitude, is_default AS "isDefault"`,
      [addressId, request.user.id, address.label, address.contactPhone, address.address,
        address.city, address.state, address.postalCode, address.latitude, address.longitude, address.isDefault],
    )
    await client.query('COMMIT')
    response.json(updated.rows[0])
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    next(error)
  } finally {
    client?.release()
  }
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
    m.brand_name AS "brandName", m.generic_name AS "genericName", m.strength,
    m.dosage_form AS "dosageForm", m.pack_quantity AS "packQuantity", m.pack_unit AS "packUnit",
    m.pack, m.price::float8 AS price, m.stock, m.reorder_level AS "reorderLevel",
    to_char(m.expiry_date, 'YYYY-MM-DD') AS expiry, m.sku,
    m.manufacturer, m.batch_number AS "batchNumber", m.gst_rate::float8 AS "gstRate",
    m.hsn_code AS "hsnCode", m.prescription_required AS "prescriptionRequired",
    m.description, m.image_url AS "imageUrl", m.is_active AS available
  FROM medicines m
  LEFT JOIN categories c ON c.id = m.category_id
  JOIN pharmacies p ON p.id = m.pharmacy_id
`

const availableStockExpression = `CASE
  WHEN m.expiry_date IS NOT NULL AND m.expiry_date < CURRENT_DATE THEN 0
  WHEN EXISTS (SELECT 1 FROM inventory_batches ib WHERE ib.medicine_id = m.id)
    THEN LEAST(m.stock, COALESCE((
      SELECT SUM(ib.quantity_remaining)::int
      FROM inventory_batches ib
      WHERE ib.medicine_id = m.id
        AND ib.quantity_remaining > 0
        AND (ib.expiry_date IS NULL OR ib.expiry_date >= CURRENT_DATE)
    ), 0))
  ELSE m.stock
END`

function medicineInput(body) {
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const category = typeof body.category === 'string' ? body.category.trim() : ''
  const pack = typeof body.pack === 'string' ? body.pack.trim() : ''
  const brandName = typeof body.brandName === 'string' ? body.brandName.trim() : ''
  const genericName = typeof body.genericName === 'string' ? body.genericName.trim() : ''
  const strength = typeof body.strength === 'string' ? body.strength.trim() : ''
  const dosageForm = typeof body.dosageForm === 'string' ? body.dosageForm.trim() : ''
  const packQuantity = Number(body.packQuantity)
  const packUnit = typeof body.packUnit === 'string' ? body.packUnit.trim() : ''
  const price = Number(body.price)
  const stock = Number(body.stock)
  const reorderLevel = Number(body.reorderLevel ?? 10)
  const expiry = body.expiry ? String(body.expiry).slice(0, 10) : null

  if (!name || !category || !pack || !brandName || !genericName || !strength || !dosageForm || !packUnit) {
    return { error: 'Name, category, pack label, brand, generic ingredient, strength, dosage form, and pack unit are required.' }
  }
  if (!Number.isSafeInteger(packQuantity) || packQuantity < 1 || packQuantity > 100000) {
    return { error: 'Pack quantity must be a whole number between 1 and 100000.' }
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
      brandName,
      genericName,
      strength,
      dosageForm,
      packQuantity,
      packUnit,
      price,
      stock,
      reorderLevel,
      expiry,
      sku: typeof body.sku === 'string' && body.sku.trim() ? body.sku.trim() : null,
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

async function createInventoryBatch(client, medicineId, item, quantity, batchNumber) {
  if (quantity <= 0) return null
  const result = await client.query(
    `INSERT INTO inventory_batches
      (medicine_id, batch_number, quantity_received, quantity_remaining, expiry_date)
     VALUES ($1, $2, $3, $3, $4)
     RETURNING id::int AS id`,
    [medicineId, batchNumber, quantity, item.expiry],
  )
  return result.rows[0].id
}

async function setInventoryBatchesToStock(client, medicineId, item) {
  const batches = await client.query(
    `SELECT id::int AS id, batch_number AS "batchNumber", quantity_received AS "quantityReceived",
       quantity_remaining AS "quantityRemaining", expiry_date::text AS expiry
     FROM inventory_batches
     WHERE medicine_id = $1
     ORDER BY expiry_date ASC NULLS LAST, received_at ASC, id ASC
     FOR UPDATE`,
    [medicineId],
  )
  let batchTotal = batches.rows.reduce((total, batch) => total + batch.quantityRemaining, 0)
  let difference = item.stock - batchTotal
  const changes = []

  if (difference > 0) {
    let batch = item.batchNumber
      ? batches.rows.find((row) => row.batchNumber === item.batchNumber)
      : null
    if (batch && batch.expiry !== item.expiry) {
      throw new ApiError(
        409,
        'That batch number already exists with a different expiry date. Use a new batch number for the additional stock.',
        'BATCH_EXPIRY_MISMATCH',
      )
    }

    let batchId
    if (batch) {
      const updated = await client.query(
        `UPDATE inventory_batches
         SET quantity_received = quantity_received + $2,
             quantity_remaining = quantity_remaining + $2
         WHERE id = $1
         RETURNING id::int AS id`,
        [batch.id, difference],
      )
      batchId = updated.rows[0].id
    } else {
      const batchNumber = item.batchNumber || `ADJUST-${randomUUID()}`
      batchId = await createInventoryBatch(client, medicineId, item, difference, batchNumber)
    }
    changes.push({ batchId, quantityChange: difference })
  } else if (difference < 0) {
    difference = -difference
    for (const batch of batches.rows) {
      if (difference === 0) break
      const quantityChange = Math.min(difference, batch.quantityRemaining)
      if (!quantityChange) continue
      await client.query(
        'UPDATE inventory_batches SET quantity_remaining = quantity_remaining - $2 WHERE id = $1',
        [batch.id, quantityChange],
      )
      changes.push({ batchId: batch.id, quantityChange: -quantityChange })
      difference -= quantityChange
    }
  }

  for (const change of changes) {
    await client.query(
      `INSERT INTO stock_movements (medicine_id, inventory_batch_id, movement_type, quantity_change, note)
       VALUES ($1, $2, 'adjustment', $3, 'Owner inventory adjustment')`,
      [medicineId, change.batchId, change.quantityChange],
    )
  }
  batchTotal = item.stock
  return batchTotal
}

app.get('/api/health', async (_request, response, next) => {
  try {
    await pool.query('SELECT 1')
    response.json({ status: 'ok' })
  } catch (error) {
    next(error)
  }
})

app.get('/api/admin/overview', requireAdmin, async (_request, response, next) => {
  try {
    const [accounts, pharmacies, orders, lowStock, recentOrders] = await Promise.all([
      pool.query(`SELECT role, COUNT(*)::int AS count FROM user_accounts GROUP BY role`),
      pool.query(`SELECT COUNT(*)::int AS count FROM pharmacies`),
      pool.query(`SELECT COUNT(*)::int AS count, COALESCE(SUM(total), 0)::float8 AS revenue FROM sales_orders WHERE status = 'delivered'`),
      pool.query(`SELECT m.id::int AS id, m.name, m.stock, m.reorder_level AS "reorderLevel", p.name AS "pharmacyName" FROM medicines m JOIN pharmacies p ON p.id = m.pharmacy_id WHERE m.is_active AND m.stock <= m.reorder_level ORDER BY m.stock ASC LIMIT 8`),
      pool.query(`SELECT o.id::int AS id, o.order_number AS "orderNumber", o.status, o.total::float8 AS total, p.name AS "pharmacyName", o.created_at AS "createdAt" FROM sales_orders o JOIN pharmacies p ON p.id = o.pharmacy_id ORDER BY o.created_at DESC LIMIT 8`),
    ])
    response.json({ accounts: Object.fromEntries(accounts.rows.map((row) => [row.role, row.count])), pharmacies: pharmacies.rows[0].count, deliveredOrders: orders.rows[0].count, revenue: orders.rows[0].revenue, lowStock: lowStock.rows, recentOrders: recentOrders.rows })
  } catch (error) { next(error) }
})

app.post('/api/owner/pharmacy/onboard', requireOwner, async (request, response, next) => {
  const body = request.body ?? {}
  const fields = ['registrationNumber', 'licenseNumber', 'authorizedPharmacistName', 'authorizedPharmacistRegistration', 'evidenceUrl']
  const values = fields.map((field) => typeof body[field] === 'string' ? body[field].trim() : '')
  if (values.slice(0, 4).some((value) => !value)) return response.status(400).json({ error: 'Registration, license, and authorized pharmacist details are required.' })
  try {
    const result = await pool.query(
      `INSERT INTO pharmacy_verifications (pharmacy_id, registration_number, license_number, authorized_pharmacist_name, authorized_pharmacist_registration, evidence_url, decision)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending') RETURNING id, submitted_at AS "submittedAt"`,
      [request.user.pharmacyId, ...values],
    )
    await pool.query(`UPDATE pharmacies SET approval_status = 'pending', rejection_reason = NULL, onboarding_submitted_at = now() WHERE id = $1`, [request.user.pharmacyId])
    await pool.query(`INSERT INTO audit_events (actor, action, entity_type, entity_id, details) VALUES ($1, 'pharmacy_onboarding_submitted', 'pharmacy', $2, $3)`, [request.user.email, request.user.pharmacyId, JSON.stringify({ verificationId: result.rows[0].id })])
    response.status(201).json(result.rows[0])
  } catch (error) { next(error) }
})

app.get('/api/admin/pharmacies/pending', requireAdmin, async (_request, response, next) => {
  try {
    const result = await pool.query(`SELECT p.id::int AS id, p.name, p.email, p.phone, p.address, p.city, p.state, p.postal_code AS "postalCode", p.drug_license_number AS "drugLicenseNumber", p.approval_status AS "approvalStatus", p.rejection_reason AS "rejectionReason", v.id::int AS "verificationId", v.registration_number AS "registrationNumber", v.license_number AS "licenseNumber", v.authorized_pharmacist_name AS "authorizedPharmacistName", v.authorized_pharmacist_registration AS "authorizedPharmacistRegistration", v.evidence_url AS "evidenceUrl", v.submitted_at AS "submittedAt" FROM pharmacies p LEFT JOIN LATERAL (SELECT * FROM pharmacy_verifications WHERE pharmacy_id = p.id ORDER BY submitted_at DESC LIMIT 1) v ON true WHERE p.approval_status IN ('pending', 'rejected', 'revoked') ORDER BY p.onboarding_submitted_at DESC NULLS LAST`)
    response.json(result.rows)
  } catch (error) { next(error) }
})

app.post('/api/admin/pharmacies/:id/decision', requireAdmin, async (request, response, next) => {
  const pharmacyId = Number(request.params.id)
  const decision = request.body?.decision
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : null
  if (!Number.isSafeInteger(pharmacyId) || pharmacyId < 1 || !['approved', 'rejected', 'revoked'].includes(decision)) return response.status(400).json({ error: 'Choose an approved, rejected, or revoked decision.' })
  if (decision !== 'approved' && !reason) return response.status(400).json({ error: 'A rejection or revocation reason is required.' })
  try {
    const result = await pool.query(`UPDATE pharmacies SET approval_status = $2, rejection_reason = $3, approved_at = CASE WHEN $2 = 'approved' THEN now() ELSE NULL END, approved_by = CASE WHEN $2 = 'approved' THEN $4::bigint ELSE NULL END WHERE id = $1 RETURNING id::int AS id, approval_status AS "approvalStatus", rejection_reason AS "rejectionReason"`, [pharmacyId, decision, reason, request.user.id])
    if (!result.rowCount) return response.status(404).json({ error: 'Pharmacy was not found.' })
    await pool.query(`UPDATE pharmacy_verifications SET decision = $2, reviewed_at = now(), reviewed_by = $3, rejection_reason = $4 WHERE id = (SELECT id FROM pharmacy_verifications WHERE pharmacy_id = $1 ORDER BY submitted_at DESC LIMIT 1)`, [pharmacyId, decision, request.user.id, reason])
    await pool.query(`INSERT INTO audit_events (actor, action, entity_type, entity_id, details) VALUES ($1, $2, 'pharmacy', $3, $4)`, [request.user.email, `pharmacy_${decision}`, pharmacyId, JSON.stringify({ reason })])
    response.json(result.rows[0])
  } catch (error) { next(error) }
})

app.get('/api/categories', async (_request, response, next) => {
  try {
    const result = await pool.query('SELECT id, name, description FROM categories ORDER BY name')
    response.json(result.rows)
  } catch (error) {
    next(error)
  }
})

app.get('/api/catalog/pharmacies', async (request, response, next) => {
  try {
    const search = typeof request.query.search === 'string' ? request.query.search.trim() : ''
    const result = await pool.query(
      `SELECT id::int AS id, name, city, state
       FROM pharmacies WHERE approval_status = 'approved'
       AND ($1 = '' OR name ILIKE '%' || $1 || '%' OR city ILIKE '%' || $1 || '%') ORDER BY name`,
      [search],
    )
    response.json(result.rows)
  } catch (error) {
    next(error)
  }
})

function validCoordinatePair(latitude, longitude) {
  return (latitude === null && longitude === null) ||
    (typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
      typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180)
}

function pharmacyDistanceKm(originLatitude, originLongitude, latitude, longitude) {
  if ([originLatitude, originLongitude, latitude, longitude].some((value) => value === null || value === undefined)) return null
  const radians = (degrees) => degrees * Math.PI / 180
  const latitudeDelta = radians(latitude - originLatitude)
  const longitudeDelta = radians(longitude - originLongitude)
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(originLatitude)) * Math.cos(radians(latitude)) * Math.sin(longitudeDelta / 2) ** 2
  const boundedHaversine = Math.min(1, Math.max(0, haversine))
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(boundedHaversine), Math.sqrt(1 - boundedHaversine)) * 10) / 10
}

function publicMarketplaceSettings(row, originLatitude = null, originLongitude = null) {
  const settings = row.setting_value ?? {}
  const deliveryFee = Number.isFinite(Number(settings.deliveryFee)) && settings.deliveryFee !== null
    ? Number(settings.deliveryFee)
    : null
  return {
    id: Number(row.id),
    name: row.name,
    phone: row.phone,
    address: row.address,
    city: row.city,
    state: row.state,
    pickupAvailable: settings.pickupAvailable !== false,
    deliveryFee,
    upiQrAvailable: Boolean(row.upi_qr_available),
    distanceKm: pharmacyDistanceKm(originLatitude, originLongitude, row.latitude, row.longitude),
  }
}

app.get('/api/pharmacies/:id', async (request, response, next) => {
  const id = Number(request.params.id)
  const latitude = request.query.latitude === undefined ? null : Number(request.query.latitude)
  const longitude = request.query.longitude === undefined ? null : Number(request.query.longitude)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid pharmacy ID.' })
  if ((request.query.latitude !== undefined || request.query.longitude !== undefined) &&
      !validCoordinatePair(latitude, longitude)) {
    return response.status(400).json({ error: 'Provide a valid latitude and longitude pair.' })
  }
  try {
    const result = await pool.query(
      `SELECT p.id::int AS id, p.name, p.phone, p.address, p.city, p.state,
        p.latitude, p.longitude, ps.setting_value,
        EXISTS (SELECT 1 FROM pharmacy_upi_qr_codes q WHERE q.pharmacy_id = p.id) AS upi_qr_available
       FROM pharmacies p
       LEFT JOIN pharmacy_settings ps ON ps.setting_key = 'marketplace:' || p.id::text
       WHERE p.id = $1 AND p.approval_status = 'approved'`,
      [id],
    )
    if (!result.rowCount) return response.status(404).json({ error: 'Verified pharmacy was not found.' })
    response.json(publicMarketplaceSettings(result.rows[0], latitude, longitude))
  } catch (error) {
    next(error)
  }
})

app.get('/api/pharmacies/:id/upi-qr', async (request, response, next) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid pharmacy ID.' })
  try {
    const result = await pool.query(
      `SELECT q.mime_type, q.image_data
       FROM pharmacy_upi_qr_codes q
       JOIN pharmacies p ON p.id = q.pharmacy_id
       WHERE p.id = $1 AND p.approval_status = 'approved'`,
      [id],
    )
    if (!result.rowCount) return response.status(404).json({ error: 'This pharmacy has not configured a UPI QR code.' })
    response.set({
      'Content-Type': result.rows[0].mime_type,
      'Content-Length': result.rows[0].image_data.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    response.send(result.rows[0].image_data)
  } catch (error) {
    next(error)
  }
})

app.get('/api/owner/marketplace-settings', requireOwner, async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT p.latitude, p.longitude, ps.setting_value,
        EXISTS (SELECT 1 FROM pharmacy_upi_qr_codes q WHERE q.pharmacy_id = p.id) AS upi_qr_available
       FROM pharmacies p
       LEFT JOIN pharmacy_settings ps ON ps.setting_key = 'marketplace:' || p.id::text
       WHERE p.id = $1`,
      [request.user.pharmacyId],
    )
    if (!result.rowCount) return response.status(404).json({ error: 'Pharmacy was not found.' })
    const row = result.rows[0]
    const settings = row.setting_value ?? {}
    response.json({
      latitude: row.latitude,
      longitude: row.longitude,
      pickupAvailable: settings.pickupAvailable !== false,
      deliveryFee: Number.isFinite(Number(settings.deliveryFee)) && settings.deliveryFee !== null
        ? Number(settings.deliveryFee)
        : '',
      upiQrAvailable: row.upi_qr_available,
    })
  } catch (error) {
    next(error)
  }
})

app.put('/api/owner/marketplace-settings', requireOwner, async (request, response, next) => {
  const latitude = request.body?.latitude === '' || request.body?.latitude === undefined
    ? null
    : request.body.latitude
  const longitude = request.body?.longitude === '' || request.body?.longitude === undefined
    ? null
    : request.body.longitude
  const deliveryFee = request.body?.deliveryFee === '' || request.body?.deliveryFee === undefined
    ? null
    : request.body.deliveryFee
  const pickupAvailable = request.body?.pickupAvailable
  if (!validCoordinatePair(latitude, longitude)) {
    return response.status(400).json({ error: 'Enter both valid coordinates or leave both blank.' })
  }
  if (deliveryFee !== null && (typeof deliveryFee !== 'number' || !Number.isFinite(deliveryFee) || deliveryFee < 0 || deliveryFee > 100000)) {
    return response.status(400).json({ error: 'Delivery fee must be a non-negative amount up to ₹100,000, or left blank.' })
  }
  if (typeof pickupAvailable !== 'boolean') {
    return response.status(400).json({ error: 'Choose whether pharmacy pickup is available.' })
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const pharmacy = await client.query(
      `UPDATE pharmacies SET latitude = $2, longitude = $3, updated_at = now()
       WHERE id = $1 RETURNING id`,
      [request.user.pharmacyId, latitude, longitude],
    )
    if (!pharmacy.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Pharmacy was not found.' })
    }
    const value = { pickupAvailable, deliveryFee }
    await client.query(
      `INSERT INTO pharmacy_settings (setting_key, setting_value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
      [`marketplace:${request.user.pharmacyId}`, JSON.stringify(value)],
    )
    await client.query('COMMIT')
    response.json({ latitude, longitude, ...value })
  } catch (error) {
    await client.query('ROLLBACK')
    next(error)
  } finally {
    client.release()
  }
})

app.post('/api/owner/marketplace-settings/upi-qr', requireOwner, parseUpiQrUpload, async (request, response, next) => {
  const fileError = validateUpiQrFile(request.file)
  if (fileError) return response.status(400).json({ error: fileError })
  try {
    await pool.query(
      `INSERT INTO pharmacy_upi_qr_codes (pharmacy_id, mime_type, image_data, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (pharmacy_id) DO UPDATE
       SET mime_type = EXCLUDED.mime_type, image_data = EXCLUDED.image_data, updated_at = now()`,
      [request.user.pharmacyId, request.file.mimetype, request.file.buffer],
    )
    response.json({ upiQrAvailable: true })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/owner/marketplace-settings/upi-qr', requireOwner, async (request, response, next) => {
  try {
    await pool.query(
      'DELETE FROM pharmacy_upi_qr_codes WHERE pharmacy_id = $1',
      [request.user.pharmacyId],
    )
    response.status(204).end()
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

app.get('/api/catalog/compare', async (request, response, next) => {
  const productKey = typeof request.query.productKey === 'string' ? request.query.productKey.trim() : ''
  const medicineId = Number(productKey)
  const latitude = request.query.latitude === undefined ? null : Number(request.query.latitude)
  const longitude = request.query.longitude === undefined ? null : Number(request.query.longitude)
  if (!Number.isSafeInteger(medicineId) || medicineId < 1) {
    return response.status(400).json({ error: 'Choose a valid product to compare.' })
  }
  if ((request.query.latitude !== undefined || request.query.longitude !== undefined) &&
      !validCoordinatePair(latitude, longitude)) {
    return response.status(400).json({ error: 'Provide a valid latitude and longitude pair.' })
  }
  try {
    const sourceResult = await pool.query(
      `SELECT m.id::int AS id, m.pharmacy_id::int AS "pharmacyId", m.name,
        m.brand_name AS "brandName",
        m.generic_name AS "genericName", m.strength, m.dosage_form AS "dosageForm",
        m.pack_quantity AS "packQuantity", m.pack_unit AS "packUnit", m.pack,
        m.prescription_required AS "prescriptionRequired",
        m.price::float8 AS price, m.stock, ${availableStockExpression}::int AS "availableStock",
        m.description, m.image_url AS "imageUrl", COALESCE(c.name, 'Uncategorized') AS category,
        p.name AS "pharmacyName", p.approval_status AS "pharmacyApprovalStatus"
       FROM medicines m
       JOIN pharmacies p ON p.id = m.pharmacy_id
       LEFT JOIN categories c ON c.id = m.category_id
       WHERE m.id = $1 AND m.is_active`,
      [medicineId],
    )
    if (!sourceResult.rowCount || sourceResult.rows[0].pharmacyApprovalStatus !== 'approved') {
      return response.status(404).json({ error: 'This medicine listing is no longer available from a verified pharmacy.' })
    }

    const source = sourceResult.rows[0]
    const identity = {
      brandName: source.brandName,
      genericName: source.genericName,
      strength: source.strength,
      dosageForm: source.dosageForm,
      packQuantity: source.packQuantity === null ? null : Number(source.packQuantity),
      packUnit: source.packUnit,
    }
    const identityComplete = Object.values(identity).every((value) =>
      typeof value === 'string' ? Boolean(value.trim()) : Number.isSafeInteger(value) && value > 0,
    )

    const selectListings = async () => {
      const result = await pool.query(
        `SELECT m.id::int AS "medicineId", m.pharmacy_id::int AS "pharmacyId",
          p.name AS "pharmacyName", p.address, p.city, p.state, p.phone,
          m.name, m.brand_name AS "brandName", m.generic_name AS "genericName",
          m.strength, m.dosage_form AS "dosageForm", m.pack_quantity AS "packQuantity",
          m.pack_unit AS "packUnit", m.pack, m.prescription_required AS "prescriptionRequired",
          m.price::float8 AS price,
          m.stock, ${availableStockExpression}::int AS "availableStock",
          m.description, m.image_url AS "imageUrl", COALESCE(c.name, 'Uncategorized') AS category,
          COALESCE((ps.setting_value->>'pickupAvailable')::boolean, true) AS "pickupAvailable",
          CASE WHEN jsonb_typeof(ps.setting_value->'deliveryFee') = 'number'
            THEN (ps.setting_value->>'deliveryFee')::float8 ELSE NULL END AS "deliveryFee",
          p.latitude, p.longitude
         FROM medicines m
         JOIN pharmacies p ON p.id = m.pharmacy_id AND p.approval_status = 'approved'
         LEFT JOIN categories c ON c.id = m.category_id
         LEFT JOIN pharmacy_settings ps ON ps.setting_key = 'marketplace:' || p.id::text
         WHERE m.is_active
           AND lower(btrim(m.brand_name)) = lower(btrim($2)) AND
             lower(btrim(m.generic_name)) = lower(btrim($3)) AND
             lower(btrim(m.strength)) = lower(btrim($4)) AND
             lower(btrim(m.dosage_form)) = lower(btrim($5)) AND
             m.pack_quantity = $6 AND lower(btrim(m.pack_unit)) = lower(btrim($7))
         ORDER BY m.price, p.name`,
        [identity.brandName, identity.genericName, identity.strength, identity.dosageForm,
          identity.packQuantity, identity.packUnit],
      )
      return result.rows.map((row) => ({
        ...row,
        available: Number(row.availableStock) > 0,
        availableStock: Number(row.availableStock),
        packQuantity: row.packQuantity === null ? null : Number(row.packQuantity),
        distanceKm: pharmacyDistanceKm(latitude, longitude, row.latitude, row.longitude),
        estimatedDeliveryTotal: row.deliveryFee === null
          ? null
          : Number(row.price) + Number(row.deliveryFee) + Math.round(Number(row.price) * 0.05 * 100) / 100,
      }))
    }

    const listings = identityComplete
      ? await selectListings()
      : []
    let nonIdenticalListings = []
    if (identityComplete) {
      const result = await pool.query(
        `SELECT m.id::int AS "medicineId", m.pharmacy_id::int AS "pharmacyId",
          p.name AS "pharmacyName", m.name, m.brand_name AS "brandName",
          m.generic_name AS "genericName", m.strength, m.dosage_form AS "dosageForm",
          m.pack_quantity AS "packQuantity", m.pack_unit AS "packUnit", m.pack,
          m.price::float8 AS price, m.stock,
          ${availableStockExpression}::int AS "availableStock"
         FROM medicines m
         JOIN pharmacies p ON p.id = m.pharmacy_id AND p.approval_status = 'approved'
         WHERE m.is_active AND m.id <> $1 AND (
           ($2 <> '' AND lower(btrim(m.generic_name)) = lower(btrim($2))) OR
           ($3 <> '' AND lower(btrim(m.brand_name)) = lower(btrim($3)))
         ) AND NOT COALESCE((
           lower(btrim(m.brand_name)) = lower(btrim($3)) AND
           lower(btrim(m.generic_name)) = lower(btrim($2)) AND
           lower(btrim(m.strength)) = lower(btrim($4)) AND
           lower(btrim(m.dosage_form)) = lower(btrim($5)) AND
           m.pack_quantity = $6 AND lower(btrim(m.pack_unit)) = lower(btrim($7))
         ), false)
         ORDER BY m.name, p.name LIMIT 30`,
        [medicineId, identity.genericName ?? '', identity.brandName ?? '',
          identity.strength, identity.dosageForm, identity.packQuantity, identity.packUnit],
      )
      nonIdenticalListings = result.rows.map((row) => ({
        ...row,
        available: Number(row.availableStock) > 0,
        availableStock: Number(row.availableStock),
        packQuantity: row.packQuantity === null ? null : Number(row.packQuantity),
        nonIdentical: true,
      }))
    }
    response.json({
      product: { ...source, ...identity, identityComplete },
      listings,
      nonIdenticalListings,
      exactMatchCriteria: ['brand', 'generic ingredient', 'strength', 'dosage form', 'pack quantity', 'pack unit'],
      approximateDistanceOnly: true,
    })
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
  const query = typeof request.query.q === 'string' ? request.query.q.trim() : ''
  const category = typeof request.query.category === 'string' ? request.query.category.trim() : ''
  const page = Math.max(1, Number.parseInt(String(request.query.page || '1'), 10) || 1)
  const pageSize = Math.min(60, Math.max(1, Number.parseInt(String(request.query.pageSize || '30'), 10) || 30))
  if (
    pharmacyIdValue !== undefined &&
    (typeof pharmacyIdValue !== 'string' || !Number.isSafeInteger(pharmacyId) || pharmacyId < 1)
  ) {
    return response.status(400).json({ error: 'Invalid pharmacy ID.' })
  }
  try {
    const result = await pool.query(
      `SELECT m.id::int AS id, m.pharmacy_id::int AS "pharmacyId",
        p.name AS "pharmacyName", m.name, m.brand_name AS "brandName",
        m.generic_name AS "genericName", m.strength, m.dosage_form AS "dosageForm",
        m.pack_quantity AS "packQuantity", m.pack_unit AS "packUnit",
        COALESCE((ps.setting_value->>'pickupAvailable')::boolean, true) AS "pickupAvailable",
        CASE WHEN jsonb_typeof(ps.setting_value->'deliveryFee') = 'number'
          THEN (ps.setting_value->>'deliveryFee')::float8 ELSE NULL END AS "deliveryFee",
        COALESCE(c.name, 'Uncategorized') AS category,
        m.pack, m.price::float8 AS price, ${availableStockExpression}::int AS stock,
        m.description, m.image_url AS "imageUrl",
        COALESCE(r.rating, 0)::float8 AS rating, COALESCE(r."reviewCount", 0)::int AS "reviewCount"
       FROM medicines m
       LEFT JOIN categories c ON c.id = m.category_id
       JOIN pharmacies p ON p.id = m.pharmacy_id AND p.approval_status = 'approved'
       LEFT JOIN pharmacy_settings ps ON ps.setting_key = 'marketplace:' || p.id::text
       LEFT JOIN (
         SELECT r.medicine_id, AVG(r.rating)::float8 AS rating, COUNT(*)::int AS "reviewCount"
         FROM product_reviews r
         WHERE EXISTS (
           SELECT 1 FROM sales_orders o
           WHERE o.id = r.order_id AND o.customer_id = r.customer_id AND o.status = 'delivered'
             AND EXISTS (
               SELECT 1 FROM sales_order_items i
               WHERE i.order_id = o.id AND i.medicine_id = r.medicine_id
             )
         )
         GROUP BY r.medicine_id
       ) r ON r.medicine_id = m.id
       WHERE m.is_active AND (${availableStockExpression}) > 0
         AND ($1::bigint IS NULL OR m.pharmacy_id = $1)
         AND ($2 = '' OR m.name ILIKE '%' || $2 || '%' OR m.brand_name ILIKE '%' || $2 || '%'
           OR m.generic_name ILIKE '%' || $2 || '%' OR m.strength ILIKE '%' || $2 || '%'
           OR m.dosage_form ILIKE '%' || $2 || '%' OR m.manufacturer ILIKE '%' || $2 || '%'
           OR c.name ILIKE '%' || $2 || '%')
         AND ($3 = '' OR c.name = $3)
       ORDER BY m.name LIMIT $4 OFFSET $5`,
      [pharmacyIdValue === undefined ? null : pharmacyId, query, category, pageSize, (page - 1) * pageSize],
    )
    response.json(result.rows)
  } catch (error) {
    next(error)
  }
})

app.get('/api/medicines/:id', async (request, response, next) => {
  const medicineId = Number(request.params.id)
  const pharmacyId = request.query.pharmacyId === undefined ? null : Number(request.query.pharmacyId)
  if (!Number.isSafeInteger(medicineId) || medicineId < 1) {
    return response.status(400).json({ error: 'Invalid medicine ID.' })
  }
  if (pharmacyId !== null && (!Number.isSafeInteger(pharmacyId) || pharmacyId < 1)) {
    return response.status(400).json({ error: 'Invalid pharmacy ID.' })
  }

  try {
    const result = await pool.query(
      `SELECT m.id::int AS id, m.pharmacy_id::int AS "pharmacyId", p.name AS "pharmacyName",
        m.name, m.brand_name AS "brandName", m.generic_name AS "genericName", m.strength,
        m.dosage_form AS "dosageForm", m.pack_quantity AS "packQuantity", m.pack_unit AS "packUnit",
        m.pack, m.price::float8 AS price, m.stock, m.reorder_level AS "reorderLevel",
        ${availableStockExpression}::int AS "availableStock",
        m.expiry_date AS "expiryDate", (m.expiry_date < CURRENT_DATE) AS "isExpired",
        (m.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days') AS "expiresSoon",
        m.manufacturer, m.batch_number AS "batchNumber",
        m.gst_rate::float8 AS "gstRate", m.hsn_code AS "hsnCode",
        m.prescription_required AS "prescriptionRequired", m.description,
        m.image_url AS "imageUrl", m.is_active AS "isActive",
        COALESCE(c.id, 0)::int AS "categoryId", COALESCE(c.name, 'Uncategorized') AS category,
        COALESCE(r.rating, 0)::float8 AS rating, COALESCE(r."reviewCount", 0)::int AS "reviewCount",
        EXISTS (SELECT 1 FROM inventory_batches ib WHERE ib.medicine_id = m.id) AS "hasBatches",
        COALESCE((SELECT SUM(ib.quantity_remaining)::int FROM inventory_batches ib
          WHERE ib.medicine_id = m.id AND ib.quantity_remaining > 0
            AND ib.expiry_date IS NOT NULL AND ib.expiry_date < CURRENT_DATE), 0)::int AS "expiredBatchQuantity"
       FROM medicines m
       JOIN pharmacies p ON p.id = m.pharmacy_id AND p.approval_status = 'approved'
       LEFT JOIN categories c ON c.id = m.category_id
       LEFT JOIN (
         SELECT medicine_id, AVG(rating)::float8 AS rating, COUNT(*)::int AS "reviewCount"
         FROM product_reviews GROUP BY medicine_id
       ) r ON r.medicine_id = m.id
       WHERE m.id = $1`,
      [medicineId],
    )
    if (!result.rowCount) return response.status(404).json({ error: 'Medicine was not found at an approved pharmacy.' })

    const medicine = result.rows[0]
    const availableStock = Number(medicine.availableStock)
    const available = medicine.isActive && availableStock > 0
    const expired = medicine.isExpired === true
    const availabilityReason = !medicine.isActive
      ? 'inactive'
      : expired
        ? 'expired'
        : available
          ? null
          : medicine.hasBatches && Number(medicine.expiredBatchQuantity) > 0
            ? 'expired_batches'
            : 'out_of_stock'
    const warnings = []
    if (medicine.prescriptionRequired) warnings.push('Prescription required. A pharmacist must verify it before dispensing.')
    if (expired) warnings.push('This medicine listing is expired and cannot be purchased.')
    else if (medicine.hasBatches && Number(medicine.expiredBatchQuantity) > 0) {
      warnings.push(`${medicine.expiredBatchQuantity} expired batch unit(s) are excluded from sellable stock.`)
    }
    if (available && availableStock <= Number(medicine.reorderLevel)) {
      warnings.push('Limited sellable stock is available.')
    }
    if (!expired && medicine.expiresSoon) warnings.push('This medicine listing expires within 30 days.')

    let recommendations = []
    if (medicine.isActive && medicine.categoryId > 0) {
      const recommendationPharmacyId = pharmacyId ?? medicine.pharmacyId
      const selectedPharmacy = await pool.query(
        `SELECT id FROM pharmacies WHERE id = $1 AND approval_status = 'approved'`,
        [recommendationPharmacyId],
      )
      if (!selectedPharmacy.rowCount) {
        return response.status(404).json({ error: 'Selected pharmacy was not found or is not approved.' })
      }
      const recommended = await pool.query(
        `SELECT m.id::int AS id, m.pharmacy_id::int AS "pharmacyId", p.name AS "pharmacyName",
          m.name, m.brand_name AS "brandName", m.generic_name AS "genericName", m.strength,
          m.dosage_form AS "dosageForm", m.pack_quantity AS "packQuantity", m.pack_unit AS "packUnit",
          m.pack, m.price::float8 AS price, ${availableStockExpression}::int AS stock,
          m.manufacturer, m.prescription_required AS "prescriptionRequired",
          m.description, m.image_url AS "imageUrl", c.name AS category,
          COALESCE(r.rating, 0)::float8 AS rating, COALESCE(r."reviewCount", 0)::int AS "reviewCount"
         FROM medicines m
         JOIN pharmacies p ON p.id = m.pharmacy_id AND p.approval_status = 'approved'
         JOIN categories c ON c.id = m.category_id
         LEFT JOIN (
           SELECT medicine_id, AVG(rating)::float8 AS rating, COUNT(*)::int AS "reviewCount"
           FROM product_reviews GROUP BY medicine_id
         ) r ON r.medicine_id = m.id
         WHERE m.is_active AND m.id <> $1 AND m.category_id = $2
           AND m.pharmacy_id = $3 AND (${availableStockExpression}) > 0
         ORDER BY m.name LIMIT 6`,
        [medicineId, medicine.categoryId, recommendationPharmacyId],
      )
      recommendations = recommended.rows
    }
    response.json({
      medicine: {
        ...medicine,
        packQuantity: medicine.packQuantity === null ? null : Number(medicine.packQuantity),
        availableStock,
        available,
        availabilityReason,
        expiredBatchQuantity: Number(medicine.expiredBatchQuantity),
        warnings,
      },
      recommendations,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/me/favorites', requireCustomer, async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT medicine_id::int AS "medicineId"
       FROM customer_favorites WHERE customer_account_id = $1 ORDER BY created_at DESC`,
      [request.user.id],
    )
    response.json({ medicineIds: result.rows.map((row) => row.medicineId) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/me/favorites', requireCustomer, async (request, response, next) => {
  const medicineId = Number(request.body?.medicineId)
  if (!Number.isSafeInteger(medicineId) || medicineId < 1) {
    return response.status(400).json({ error: 'Choose a valid medicine to favorite.' })
  }
  try {
    const medicine = await pool.query(
      `SELECT m.id FROM medicines m
       JOIN pharmacies p ON p.id = m.pharmacy_id AND p.approval_status = 'approved'
       WHERE m.id = $1`,
      [medicineId],
    )
    if (!medicine.rowCount) return response.status(404).json({ error: 'Medicine was not found at an approved pharmacy.' })
    await pool.query(
      `INSERT INTO customer_favorites (customer_account_id, medicine_id)
       VALUES ($1, $2) ON CONFLICT (customer_account_id, medicine_id) DO NOTHING`,
      [request.user.id, medicineId],
    )
    response.status(201).json({ medicineId })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/me/favorites/:medicineId', requireCustomer, async (request, response, next) => {
  const medicineId = Number(request.params.medicineId)
  if (!Number.isSafeInteger(medicineId) || medicineId < 1) {
    return response.status(400).json({ error: 'Invalid medicine ID.' })
  }
  try {
    await pool.query(
      `DELETE FROM customer_favorites WHERE customer_account_id = $1 AND medicine_id = $2`,
      [request.user.id, medicineId],
    )
    response.json({ medicineId, favorited: false })
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

app.post(
  '/api/owner/product-images',
  requireOwner,
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb' }),
  async (request, response, next) => {
    const contentType = (request.get('content-type') || '').split(';', 1)[0].trim().toLowerCase()
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
      return response.status(415).json({ error: 'Choose a JPEG, PNG, or WebP image.' })
    }
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      return response.status(400).json({ error: 'Choose a non-empty product image.' })
    }
    const extension = productImageExtension(contentType, request.body)
    if (!extension) {
      return response.status(400).json({ error: 'The selected file is not a valid supported image.' })
    }
    const pharmacyId = request.user.pharmacyId
    if (!Number.isSafeInteger(pharmacyId) || pharmacyId < 1) {
      return response.status(403).json({ error: 'This owner account has no pharmacy to upload images for.' })
    }

    const fileName = `${randomUUID()}.${extension}`
    const ownerDirectory = join(productImageDirectory, String(pharmacyId))
    try {
      await mkdir(ownerDirectory, { recursive: true })
      await writeFile(join(ownerDirectory, fileName), request.body, { flag: 'wx' })
      response.status(201).json({ imageUrl: `/api/uploads/products/${pharmacyId}/${fileName}` })
    } catch (error) {
      next(error)
    }
  },
)

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
        (pharmacy_id, sku, name, brand_name, generic_name, strength, dosage_form, pack_quantity, pack_unit,
         category_id, pack, manufacturer, batch_number,
         expiry_date, price, stock, reorder_level, gst_rate, hsn_code,
         prescription_required, description, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING id`,
      [request.user.pharmacyId, item.sku, item.name, item.brandName, item.genericName, item.strength,
        item.dosageForm, item.packQuantity, item.packUnit, category, item.pack, item.manufacturer,
        item.batchNumber, item.expiry, item.price, item.stock, item.reorderLevel, item.gstRate,
        item.hsnCode, item.prescriptionRequired, item.description, item.imageUrl],
    )
    const id = inserted.rows[0].id
    if (item.stock > 0) {
      const batchId = await createInventoryBatch(
        client,
        id,
        item,
        item.stock,
        item.batchNumber || `OPENING-${id}`,
      )
      await client.query(
        `INSERT INTO stock_movements
          (medicine_id, inventory_batch_id, movement_type, quantity_change, note)
         VALUES ($1, $2, 'opening', $3, 'Opening inventory')`,
        [id, batchId, item.stock],
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
      'SELECT id FROM medicines WHERE id = $1 AND pharmacy_id = $2 AND is_active FOR UPDATE',
      [id, request.user.pharmacyId],
    )
    if (!existing.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Medicine was not found.' })
    }
    await setInventoryBatchesToStock(client, id, parsed.value)
    const category = await categoryId(client, parsed.value.category)
    const item = parsed.value
    await client.query(
      `UPDATE medicines SET
        sku = $2, name = $3, brand_name = $4, generic_name = $5, strength = $6,
        dosage_form = $7, pack_quantity = $8, pack_unit = $9, category_id = $10, pack = $11,
        manufacturer = $12, batch_number = $13, expiry_date = $14, price = $15,
        stock = $16, reorder_level = $17, gst_rate = $18, hsn_code = $19,
        prescription_required = $20, description = $21, image_url = $22,
        updated_at = now()
        WHERE id = $1 AND pharmacy_id = $23 AND is_active
       RETURNING id`,
      [id, item.sku, item.name, item.brandName, item.genericName, item.strength, item.dosageForm,
        item.packQuantity, item.packUnit, category, item.pack, item.manufacturer, item.batchNumber,
        item.expiry, item.price, item.stock, item.reorderLevel, item.gstRate, item.hsnCode,
        item.prescriptionRequired, item.description, item.imageUrl, request.user.pharmacyId],
    )
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

app.post('/api/me/prescriptions', requireCustomer, prescriptionUpload.single('file'), async (request, response, next) => {
  const fileError = validatePrescriptionFile(request.file)
  if (fileError) return response.status(400).json({ error: fileError })

  let items
  try {
    items = JSON.parse(request.body?.items ?? '')
  } catch {
    return response.status(400).json({ error: 'Select the restricted medicines and quantities this prescription covers.' })
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 30 ||
      items.some((item) => !Number.isSafeInteger(item?.medicineId) || item.medicineId < 1 ||
        !Number.isSafeInteger(item?.quantity) || item.quantity < 1 || item.quantity > 50) ||
      new Set(items.map((item) => item.medicineId)).size !== items.length) {
    return response.status(400).json({ error: 'Choose between 1 and 30 restricted medicines with valid quantities.' })
  }

  try {
    prescriptionEncryptionKey()
    const medicines = await pool.query(
      `SELECT m.id::int AS id, m.pharmacy_id::int AS "pharmacyId"
       FROM medicines m
       JOIN pharmacies p ON p.id = m.pharmacy_id AND p.approval_status = 'approved'
       WHERE m.id = ANY($1::bigint[]) AND m.is_active AND m.prescription_required`,
      [items.map((item) => item.medicineId)],
    )
    if (medicines.rowCount !== items.length) {
      return response.status(400).json({ error: 'Prescriptions can only be attached to active restricted medicines from approved pharmacies.' })
    }
    const pharmacyIds = new Set(medicines.rows.map((medicine) => medicine.pharmacyId))
    if (pharmacyIds.size !== 1) {
      return response.status(400).json({ error: 'A prescription upload can cover restricted medicines from one pharmacy only.' })
    }
    await scanPrescriptionBuffer(request.file.buffer)

    const storageKey = `${randomUUID()}.bin`
    const storagePath = await ensurePrivatePrescriptionStorage(storageKey)
    try {
      await writeFile(storagePath, encryptPrescription(request.file.buffer), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      try {
        await unlink(storagePath)
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') console.error('Could not remove a partial prescription upload:', cleanupError)
      }
      return next(error)
    }

    let client
    try {
      client = await pool.connect()
      await client.query('BEGIN')
      const inserted = await client.query(
        `INSERT INTO prescriptions
          (customer_account_id, pharmacy_id, storage_key, original_filename, mime_type,
           file_size, file_sha256, retention_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE + 30)
         RETURNING id::int AS id, status, submitted_at AS "submittedAt"`,
        [request.user.id, [...pharmacyIds][0], storageKey, 'prescription',
          request.file.mimetype, request.file.size, createHash('sha256').update(request.file.buffer).digest('hex')],
      )
      const prescription = inserted.rows[0]
      for (const item of items) {
        await client.query(
          `INSERT INTO prescription_medicines (prescription_id, medicine_id, requested_quantity)
           VALUES ($1, $2, $3)`,
          [prescription.id, item.medicineId, item.quantity],
        )
      }
      await client.query(
        `INSERT INTO audit_events (actor, action, entity_type, entity_id, details)
         VALUES ($1, 'prescription_uploaded', 'prescription', $2, $3)`,
        [request.user.email, prescription.id, JSON.stringify({ pharmacyId: [...pharmacyIds][0], medicineIds: items.map((item) => item.medicineId) })],
      )
      await client.query('COMMIT')
      response.set('Cache-Control', 'no-store')
      response.status(201).json({
        id: prescription.id,
        status: prescription.status,
        submittedAt: prescription.submittedAt,
        message: 'Your encrypted document was uploaded for pharmacist review.',
      })
    } catch (error) {
      if (client) await client.query('ROLLBACK')
      try {
        await unlink(storagePath)
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') console.error('Could not remove an uncommitted prescription file:', cleanupError)
      }
      next(error)
    } finally {
      client?.release()
    }
  } catch (error) {
    next(error)
  }
})

app.get('/api/me/prescriptions', requireCustomer, async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT p.id::int AS id, p.status, p.submitted_at AS "submittedAt",
          p.prescription_date AS "prescriptionDate", p.valid_until AS "validUntil",
          p.review_reason AS "reviewReason", p.retention_until AS "retentionUntil",
          (p.storage_key IS NOT NULL AND p.document_deleted_at IS NULL) AS "documentAvailable",
          COALESCE((
            SELECT json_agg(json_build_object(
              'medicineId', pm.medicine_id::int, 'name', m.name,
              'requestedQuantity', pm.requested_quantity,
              'approvedQuantity', pm.approved_quantity,
              'remainingQuantity', GREATEST(COALESCE(pm.approved_quantity, 0) - pm.reserved_quantity, 0)
            ) ORDER BY m.name)
            FROM prescription_medicines pm
            JOIN medicines m ON m.id = pm.medicine_id
            WHERE pm.prescription_id = p.id
          ), '[]'::json) AS items
       FROM prescriptions p
       WHERE p.customer_account_id = $1
       ORDER BY p.submitted_at DESC`,
      [request.user.id],
    )
    response.set('Cache-Control', 'no-store')
    response.json(result.rows)
  } catch (error) {
    next(error)
  }
})

async function sendPrescriptionFile(response, prescription, id, next) {
  if (!prescription) return response.status(404).json({ error: 'Prescription document was not found.' })
  if (!prescription.storage_key || prescription.document_deleted_at) {
    return response.status(410).json({ error: 'The retained prescription document has been deleted.' })
  }
  try {
    const encrypted = await readFile(await ensurePrivatePrescriptionStorage(prescription.storage_key))
    const document = decryptPrescription(encrypted)
    const checksum = createHash('sha256').update(document).digest('hex')
    if (checksum !== prescription.file_sha256) {
      return response.status(500).json({ error: 'The stored prescription document failed its integrity check.' })
    }
    const extension = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' }[prescription.mime_type]
    response.set({
      'Cache-Control': 'no-store, private',
      'Content-Disposition': `attachment; filename="prescription-${id}.${extension}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': prescription.mime_type,
      'Content-Length': String(document.length),
    })
    response.send(document)
  } catch (error) {
    next(error)
  }
}

app.get('/api/me/prescriptions/:id/file', requireCustomer, async (request, response, next) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid prescription ID.' })
  try {
    const result = await pool.query(
      `SELECT storage_key, mime_type, file_sha256, document_deleted_at
       FROM prescriptions WHERE id = $1 AND customer_account_id = $2`,
      [id, request.user.id],
    )
    await sendPrescriptionFile(response, result.rows[0], id, next)
  } catch (error) {
    next(error)
  }
})

app.get('/api/owner/prescriptions', requireOwner, requireAuthorizedPharmacist, async (request, response, next) => {
  try {
    const result = await pool.query(
      `SELECT p.id::int AS id, p.status, p.submitted_at AS "submittedAt",
          p.prescription_date AS "prescriptionDate", p.valid_until AS "validUntil",
          p.review_reason AS "reviewReason", p.retention_until AS "retentionUntil",
          (p.storage_key IS NOT NULL AND p.document_deleted_at IS NULL) AS "documentAvailable",
          c.full_name AS "customerName",
          COALESCE((
            SELECT json_agg(json_build_object(
              'medicineId', pm.medicine_id::int, 'name', m.name,
              'requestedQuantity', pm.requested_quantity,
              'approvedQuantity', pm.approved_quantity,
              'remainingQuantity', GREATEST(COALESCE(pm.approved_quantity, 0) - pm.reserved_quantity, 0),
              'medicineMatches', pm.medicine_matches
            ) ORDER BY m.name)
            FROM prescription_medicines pm
            JOIN medicines m ON m.id = pm.medicine_id
            WHERE pm.prescription_id = p.id
          ), '[]'::json) AS items
       FROM prescriptions p
       JOIN user_accounts c ON c.id = p.customer_account_id
       WHERE p.pharmacy_id = $1
         AND p.status IN ('pending', 'correction_required')
       ORDER BY CASE p.status WHEN 'pending' THEN 0 ELSE 1 END, p.submitted_at, p.id
       LIMIT 100`,
      [request.user.pharmacyId],
    )
    response.set('Cache-Control', 'no-store')
    response.json(result.rows)
  } catch (error) {
    next(error)
  }
})

app.get('/api/owner/prescriptions/:id/file', requireOwner, requireAuthorizedPharmacist, async (request, response, next) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid prescription ID.' })
  try {
    const result = await pool.query(
      `SELECT storage_key, mime_type, file_sha256, document_deleted_at
       FROM prescriptions WHERE id = $1 AND pharmacy_id = $2`,
      [id, request.user.pharmacyId],
    )
    await sendPrescriptionFile(response, result.rows[0], id, next)
  } catch (error) {
    next(error)
  }
})

app.post('/api/owner/prescriptions/:id/review', requireOwner, requireAuthorizedPharmacist, async (request, response, next) => {
  const id = Number(request.params.id)
  const decision = request.body?.decision
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : ''
  const prescriptionDate = request.body?.prescriptionDate
  const validUntil = request.body?.validUntil
  const patientMatches = request.body?.patientMatches === true
  const prescriberValid = request.body?.prescriberValid === true
  const legalRequirementsSatisfied = request.body?.legalRequirementsSatisfied === true
  const medicineReviews = request.body?.items
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid prescription ID.' })
  if (!['approved', 'rejected', 'correction_requested'].includes(decision) || reason.length < 3 || reason.length > 1000) {
    return response.status(400).json({ error: 'Choose a decision and provide a review reason between 3 and 1000 characters.' })
  }
  if (decision === 'approved' && (
    !validDate(prescriptionDate) ||
    !validDate(validUntil) ||
    validUntil < prescriptionDate ||
    !patientMatches ||
    !prescriberValid ||
    !legalRequirementsSatisfied ||
    !Array.isArray(medicineReviews)
  )) {
    return response.status(400).json({ error: 'Approval requires valid dates and confirmation of patient, prescriber, medicine, and legal requirements.' })
  }

  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const prescriptionResult = await client.query(
      `SELECT id, customer_account_id, status, storage_key, document_deleted_at
       FROM prescriptions
       WHERE id = $1 AND pharmacy_id = $2
       FOR UPDATE`,
      [id, request.user.pharmacyId],
    )
    if (!prescriptionResult.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Prescription was not found for this pharmacy.' })
    }
    const existing = prescriptionResult.rows[0]
    if (!['pending', 'correction_required'].includes(existing.status)) {
      await client.query('ROLLBACK')
      return response.status(409).json({ error: 'This prescription is no longer available for review.' })
    }
    if (decision === 'approved' && (!existing.storage_key || existing.document_deleted_at)) {
      await client.query('ROLLBACK')
      return response.status(409).json({ error: 'The private prescription document is no longer available, so it cannot be approved.' })
    }
    if (decision === 'approved') {
      const dateCheck = await client.query(
        `SELECT $1::date <= CURRENT_DATE AS "prescriptionDateValid",
            $2::date >= CURRENT_DATE AS "expiryDateValid"`,
        [prescriptionDate, validUntil],
      )
      if (!dateCheck.rows[0].prescriptionDateValid || !dateCheck.rows[0].expiryDateValid) {
        await client.query('ROLLBACK')
        return response.status(400).json({ error: 'The prescription date cannot be in the future and its expiry must be today or later.' })
      }
    }
    const requestedItems = await client.query(
      `SELECT medicine_id::int AS "medicineId", requested_quantity AS "requestedQuantity",
          reserved_quantity AS "reservedQuantity"
       FROM prescription_medicines
       WHERE prescription_id = $1
       ORDER BY medicine_id
       FOR UPDATE`,
      [id],
    )
    const reviewedItems = decision === 'approved' ? medicineReviews : []
    if (decision === 'approved') {
      const byId = new Map(reviewedItems.map((item) => [item?.medicineId, item]))
      if (reviewedItems.length !== requestedItems.rowCount ||
          requestedItems.rows.some((item) => {
            const review = byId.get(item.medicineId)
            return !review ||
              review.medicineMatches !== true ||
              !Number.isSafeInteger(review.approvedQuantity) ||
              review.approvedQuantity < item.requestedQuantity ||
              review.approvedQuantity > 10000 ||
              review.approvedQuantity < item.reservedQuantity
          })) {
        await client.query('ROLLBACK')
        return response.status(400).json({ error: 'Confirm every requested medicine and set an approved quantity that covers the request and existing reservations.' })
      }
    }
    const reviewJson = decision === 'approved'
      ? requestedItems.rows.map((item) => {
        const review = reviewedItems.find((entry) => entry.medicineId === item.medicineId)
        return {
          medicineId: item.medicineId,
          medicineMatches: true,
          requestedQuantity: item.requestedQuantity,
          approvedQuantity: review.approvedQuantity,
        }
      })
      : []
    await client.query(
      `INSERT INTO prescription_verifications
        (prescription_id, reviewer_user_account_id, decision, reason, prescription_date,
         valid_until, patient_matches, prescriber_valid, legal_requirements_satisfied, medicine_reviews)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [id, request.user.id, decision, reason,
        decision === 'approved' ? prescriptionDate : null,
        decision === 'approved' ? validUntil : null,
        patientMatches, prescriberValid, legalRequirementsSatisfied, JSON.stringify(reviewJson)],
    )
    if (decision === 'approved') {
      for (const item of reviewedItems) {
        await client.query(
          `UPDATE prescription_medicines
           SET medicine_matches = true, approved_quantity = $3
           WHERE prescription_id = $1 AND medicine_id = $2`,
          [id, item.medicineId, item.approvedQuantity],
        )
      }
    }
    const status = decision === 'correction_requested' ? 'correction_required' : decision
    const updated = await client.query(
      `UPDATE prescriptions
       SET status = $2,
           prescription_date = $3,
           valid_until = $4,
           review_reason = $5,
           reviewed_by_user_account_id = $6,
           reviewed_at = now(),
           retention_until = CASE WHEN $2 = 'approved' THEN $4::date + 30 ELSE CURRENT_DATE + 30 END
       WHERE id = $1
       RETURNING id::int AS id, status, prescription_date AS "prescriptionDate",
         valid_until AS "validUntil", reviewed_at AS "reviewedAt", retention_until AS "retentionUntil"`,
      [id, status, decision === 'approved' ? prescriptionDate : null,
        decision === 'approved' ? validUntil : null, reason, request.user.id],
    )
    await client.query(
      `INSERT INTO audit_events (actor, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'prescription', $3, $4)`,
      [request.user.email, `prescription_${decision}`, id, JSON.stringify({
        pharmacyId: request.user.pharmacyId,
        validUntil: decision === 'approved' ? validUntil : null,
      })],
    )
    await client.query('COMMIT')
    response.set('Cache-Control', 'no-store')
    response.json(updated.rows[0])
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    next(error)
  } finally {
    client?.release()
  }
})

const orderSelect = `
  SELECT o.id::int AS id, o.order_number AS "orderNumber", o.status,
    o.pharmacy_id::int AS "pharmacyId", p.name AS "pharmacyName",
    o.total::float8 AS total, o.delivery_address AS "deliveryAddress",
    o.subtotal::float8 AS subtotal, o.discount_amount::float8 AS "discountAmount",
    o.discount_code AS "discountCode", o.tax_amount::float8 AS "taxAmount",
    o.delivery_fee::float8 AS "deliveryFee", o.payment_method AS "paymentMethod",
    o.payment_status AS "paymentStatus",
    o.fulfillment_method AS "fulfillmentMethod",
    o.delivery_latitude::float8 AS "deliveryLatitude",
    o.delivery_longitude::float8 AS "deliveryLongitude",
    c.full_name AS "customerName", COALESCE(o.delivery_contact_phone, c.phone) AS "customerPhone",
    o.created_at AS "createdAt", o.updated_at AS "updatedAt",
    COALESCE((
      SELECT json_agg(json_build_object(
        'medicineId', i.medicine_id::int, 'name', i.medicine_name, 'quantity', i.quantity,
        'packQuantity', i.pack_quantity_at_order, 'baseUnitQuantity', i.base_unit_quantity,
        'baseUnitName', i.base_unit_name,
        'prescriptionId', i.prescription_id::int,
        'prescriptionRequired', i.prescription_required_at_order,
        'unitPrice', i.unit_price::float8, 'discountAmount', i.discount_amount::float8,
        'taxAmount', i.tax_amount::float8, 'lineTotal', i.line_total::float8,
        'snapshot', i.medicine_snapshot
      ) ORDER BY i.id)
      FROM sales_order_items i WHERE i.order_id = o.id
    ), '[]'::json) AS items,
    COALESCE((
      SELECT json_agg(json_build_object(
        'status', e.status,
        'createdAt', e.created_at,
        'actorRole', e.actor_role,
        'actorName', e.actor_name,
        'note', e.note
      ) ORDER BY e.created_at, e.id)
      FROM order_status_events e WHERE e.order_id = o.id
    ), '[]'::json) AS events
  FROM sales_orders o
  JOIN pharmacies p ON p.id = o.pharmacy_id
  LEFT JOIN customers c ON c.id = o.customer_id
`

const orderStatusNotificationLabel = {
  pending: 'pending',
  accepted: 'accepted',
  preparing: 'being prepared',
  ready: 'ready for dispatch',
  out_for_delivery: 'out for delivery',
  delivered: 'delivered',
  declined: 'declined',
  cancelled: 'cancelled',
}

async function createOrderNotification(client, {
  eventId,
  orderId,
  orderNumber,
  pharmacyId,
  recipientRole,
  status,
  note = null,
}) {
  const recipients = recipientRole === 'pharmacy_owner'
    ? await client.query(
      `SELECT id FROM user_accounts
       WHERE role = 'pharmacy_owner' AND pharmacy_id = $1
       ORDER BY id`,
      [pharmacyId],
    )
    : await client.query(
      `SELECT c.user_account_id AS id
       FROM sales_orders o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN customer_settings s ON s.user_account_id = c.user_account_id
       WHERE o.id = $1 AND c.user_account_id IS NOT NULL
         AND COALESCE(s.order_notifications_enabled, true)`,
      [orderId],
    )
  const label = orderStatusNotificationLabel[status] ?? status.replaceAll('_', ' ')
  const type = recipientRole === 'pharmacy_owner' ? 'order_placed' : 'order_status'
  const title = recipientRole === 'pharmacy_owner' ? 'New customer order' : `Order ${label}`
  const message = recipientRole === 'pharmacy_owner'
    ? `Order ${orderNumber} is waiting for review.`
    : `Order ${orderNumber} is now ${label}.${note ? ` ${note}` : ''}`

  for (const recipient of recipients.rows) {
    await client.query(
      `INSERT INTO notifications
         (order_status_event_id, recipient_user_id, recipient_role, pharmacy_id,
          type, reference_type, reference_id, title, message)
       VALUES ($1, $2, $3, $4, $5, 'sales_order', $6, $7, $8)
       ON CONFLICT (order_status_event_id, recipient_user_id) DO NOTHING`,
      [eventId, recipient.id, recipientRole, pharmacyId, type, orderId, title, message],
    )
  }
}

const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100

function parseCheckoutRequest(body) {
  const checkoutBody = body ?? {}
  const items = checkoutBody.items
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > 30 ||
    items.some((item) =>
      !Number.isSafeInteger(item?.medicineId) ||
      item.medicineId < 1 ||
      !Number.isSafeInteger(item?.quantity) ||
      item.quantity < 1 ||
      item.quantity > 50 ||
      (item.prescriptionId !== undefined &&
        (!Number.isSafeInteger(item.prescriptionId) || item.prescriptionId < 1)) ||
      (item.pharmacy_id !== undefined &&
        (!Number.isSafeInteger(item.pharmacy_id) || item.pharmacy_id < 1)),
    ) ||
    new Set(items.map((item) => item.medicineId)).size !== items.length
  ) {
    return { error: 'Choose between 1 and 30 medicines with valid quantities.', status: 400 }
  }
  const paymentMethod = typeof checkoutBody.paymentMethod === 'string' ? checkoutBody.paymentMethod.trim() : ''
  if (!['Cash on Delivery', 'UPI Payment'].includes(paymentMethod)) {
    return { error: 'Choose a supported payment method.', status: 400 }
  }
  const fulfillmentMethod = checkoutBody.fulfillmentMethod ?? 'delivery'
  if (!['delivery', 'pickup'].includes(fulfillmentMethod)) {
    return { error: 'Choose delivery or pharmacy pickup.', status: 400 }
  }
  const addressId = checkoutBody.addressId ?? null
  if (fulfillmentMethod === 'delivery' && (!Number.isSafeInteger(addressId) || addressId < 1)) {
    return { error: 'Choose a saved address for delivery.', status: 400 }
  }
  if (checkoutBody.discountCode !== undefined && checkoutBody.discountCode !== null && typeof checkoutBody.discountCode !== 'string') {
    return { error: 'Enter a valid discount code.', status: 400 }
  }
  const discountCode = typeof checkoutBody.discountCode === 'string' ? checkoutBody.discountCode.trim().toUpperCase() || null : null
  return {
    value: {
      items: items.map(({ medicineId, quantity, pharmacy_id, prescriptionId }) => ({
        medicineId, quantity, pharmacy_id, prescriptionId,
      }))
        .sort((left, right) => left.medicineId - right.medicineId),
      paymentMethod,
      fulfillmentMethod,
      addressId: fulfillmentMethod === 'delivery' ? addressId : null,
      discountCode,
    },
  }
}

async function buildCheckoutQuote(client, userId, checkout, { lockInventory = false } = {}) {
  const customerResult = await client.query(
    'SELECT id::int AS id FROM customers WHERE user_account_id = $1',
    [userId],
  )
  if (!customerResult.rowCount) return { error: 'Customer profile was not found.', status: 404 }

  let destination = null
  if (checkout.fulfillmentMethod === 'delivery') {
    const addressResult = await client.query(
      `SELECT id::int AS id,
        NULLIF(concat_ws(', ', NULLIF(address, ''), city, state, postal_code), '') AS address,
        contact_phone AS "contactPhone", latitude::float8 AS latitude, longitude::float8 AS longitude
       FROM customer_addresses
       WHERE id = $1 AND user_account_id = $2${lockInventory ? ' FOR SHARE' : ''}`,
      [checkout.addressId, userId],
    )
    destination = addressResult.rows[0]
    if (!destination || (!destination.address &&
        (destination.latitude === null || destination.longitude === null))) {
      return { error: 'Choose a saved address with manual details or GPS coordinates.', status: 400 }
    }
  }

  const medicineIds = checkout.items.map((item) => item.medicineId)
  const medicineResult = await client.query(
    `SELECT m.id::int AS id, m.pharmacy_id::int AS "pharmacyId", p.name AS "pharmacyName",
      m.name, m.price::float8 AS price, m.gst_rate::float8 AS "taxRate",
      m.pack_quantity AS "packQuantity", m.pack_unit AS "packUnit",
      m.prescription_required AS "prescriptionRequired",
      EXISTS (SELECT 1 FROM inventory_batches ib WHERE ib.medicine_id = m.id) AS "hasBatches",
      m.stock, ${availableStockExpression}::int AS "availableQuantity"
     FROM medicines m
     JOIN pharmacies p ON p.id = m.pharmacy_id AND p.approval_status = 'approved'
     WHERE m.id = ANY($1::bigint[]) AND m.is_active
     ORDER BY m.id${lockInventory ? ' FOR UPDATE OF m' : ''}`,
    [medicineIds],
  )
  if (medicineResult.rowCount !== checkout.items.length) {
    return {
      error: 'A medicine in your cart is no longer listed by an approved pharmacy.',
      status: 409,
      corrections: checkout.items
        .filter((item) => !medicineResult.rows.some((medicine) => medicine.id === item.medicineId))
        .map((item) => ({ medicineId: item.medicineId, requestedQuantity: item.quantity, availableQuantity: 0 })),
    }
  }

  if (lockInventory) {
    await client.query(
      `SELECT id FROM inventory_batches
       WHERE medicine_id = ANY($1::bigint[])
       ORDER BY medicine_id, expiry_date ASC NULLS LAST, received_at, id
       FOR UPDATE`,
      [medicineIds],
    )
  }

  const medicineById = new Map(medicineResult.rows.map((medicine) => [medicine.id, medicine]))
  if (lockInventory) {
    const inventoryResult = await client.query(
      `SELECT m.id::int AS id,
        EXISTS (SELECT 1 FROM inventory_batches ib WHERE ib.medicine_id = m.id) AS "hasBatches",
        ${availableStockExpression}::int AS "availableQuantity"
       FROM medicines m WHERE m.id = ANY($1::bigint[])`,
      [medicineIds],
    )
    for (const inventory of inventoryResult.rows) {
      const medicine = medicineById.get(inventory.id)
      medicine.availableQuantity = inventory.availableQuantity
      medicine.hasBatches = inventory.hasBatches
    }
  }
  const pharmacyIds = new Set(medicineResult.rows.map((medicine) => medicine.pharmacyId))
  if (pharmacyIds.size !== 1) {
    return { error: 'Your cart contains medicines from multiple pharmacies. Use separate carts and orders.', status: 400 }
  }
  const claimedPharmacyIds = new Set(checkout.items
    .map((item) => item.pharmacy_id)
    .filter((pharmacyId) => pharmacyId !== undefined))
  if (claimedPharmacyIds.size > 1 || (claimedPharmacyIds.size === 1 && [...claimedPharmacyIds][0] !== [...pharmacyIds][0])) {
    return { error: 'A cart item no longer belongs to the selected pharmacy. Refresh your cart and request a new quote.', status: 409 }
  }

  for (const item of checkout.items) {
    const medicine = medicineById.get(item.medicineId)
    if (!medicine.prescriptionRequired) {
      if (item.prescriptionId !== undefined) {
        return { error: 'Remove the unrelated prescription from this item and request a new quote.', status: 400 }
      }
      continue
    }
    if (item.prescriptionId === undefined) {
      return { error: `${medicine.name} requires an approved prescription before checkout.`, status: 409 }
    }
    const prescriptionResult = await client.query(
      `SELECT p.id::int AS id, pm.approved_quantity AS "approvedQuantity",
          pm.reserved_quantity AS "reservedQuantity", p.valid_until AS "validUntil"
       FROM prescriptions p
       JOIN prescription_medicines pm
         ON pm.prescription_id = p.id AND pm.medicine_id = $4
       WHERE p.id = $1 AND p.customer_account_id = $2 AND p.pharmacy_id = $3
         AND p.status = 'approved' AND p.valid_until >= CURRENT_DATE
         AND p.storage_key IS NOT NULL AND p.document_deleted_at IS NULL
       ${lockInventory ? 'FOR UPDATE OF p, pm' : ''}`,
      [item.prescriptionId, userId, medicine.pharmacyId, item.medicineId],
    )
    const prescription = prescriptionResult.rows[0]
    if (!prescription) {
      return { error: `${medicine.name} needs a current, approved prescription for this pharmacy.`, status: 409 }
    }
    const remainingQuantity = Number(prescription.approvedQuantity) - Number(prescription.reservedQuantity)
    if (item.quantity > remainingQuantity) {
      return {
        error: `The approved prescription quantity for ${medicine.name} has been used or is insufficient.`,
        status: 409,
        corrections: [{
          medicineId: item.medicineId,
          name: medicine.name,
          requestedQuantity: item.quantity,
          availableQuantity: Math.max(0, remainingQuantity),
        }],
      }
    }
    medicine.prescriptionId = prescription.id
    medicine.prescriptionValidUntil = prescription.validUntil
  }

  const corrections = checkout.items.flatMap((item) => {
    const medicine = medicineById.get(item.medicineId)
    return item.quantity > medicine.availableQuantity
      ? [{
          medicineId: item.medicineId,
          name: medicine.name,
          requestedQuantity: item.quantity,
          availableQuantity: medicine.availableQuantity,
        }]
      : []
  })
  if (corrections.length) {
    return {
      error: 'Stock changed. Reduce the quantities shown and request a new quote.',
      status: 409,
      corrections,
    }
  }

  const pharmacyId = [...pharmacyIds][0]
  if (lockInventory) {
    const pharmacyLock = await client.query(
      'SELECT id FROM pharmacies WHERE id = $1 AND approval_status = \'approved\' FOR SHARE',
      [pharmacyId],
    )
    if (!pharmacyLock.rowCount) {
      return { error: 'This pharmacy is no longer approved to accept orders.', status: 409 }
    }
  }
  const marketplaceResult = await client.query(
    `SELECT COALESCE((setting_value->>'pickupAvailable')::boolean, true) AS "pickupAvailable",
        CASE WHEN jsonb_typeof(setting_value->'deliveryFee') = 'number'
          THEN (setting_value->>'deliveryFee')::float8 ELSE NULL END AS "deliveryFee"
     FROM pharmacy_settings WHERE setting_key = 'marketplace:' || $1::text${lockInventory ? ' FOR SHARE' : ''}`,
    [pharmacyId],
  )
  const marketplace = marketplaceResult.rows[0] ?? { pickupAvailable: true, deliveryFee: null }
  if (checkout.fulfillmentMethod === 'pickup' && !marketplace.pickupAvailable) {
    return { error: 'This pharmacy does not offer pickup. Choose delivery or another pharmacy.', status: 409 }
  }
  if (checkout.fulfillmentMethod === 'delivery' && marketplace.deliveryFee === null) {
    return { error: 'This pharmacy has not disclosed a delivery fee, so delivery is unavailable.', status: 409 }
  }

  const lines = checkout.items.map((item) => {
    const medicine = medicineById.get(item.medicineId)
    const packQuantity = medicine.packQuantity === null || !medicine.packUnit
      ? null
      : Number(medicine.packQuantity)
    return {
      medicineId: medicine.id,
      pharmacyId: medicine.pharmacyId,
      prescriptionId: medicine.prescriptionId ?? null,
      prescriptionRequired: medicine.prescriptionRequired,
      prescriptionValidUntil: medicine.prescriptionValidUntil ?? null,
      name: medicine.name,
      quantity: item.quantity,
      availableQuantity: medicine.availableQuantity,
      packQuantity,
      packUnit: packQuantity === null ? null : medicine.packUnit,
      baseUnitQuantity: packQuantity === null ? null : item.quantity * packQuantity,
      unitPrice: roundMoney(Number(medicine.price)),
      lineSubtotal: roundMoney(Number(medicine.price) * item.quantity),
      taxRate: Number(medicine.taxRate),
    }
  })
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.lineSubtotal, 0))

  let discountAmount = 0
  let discount = null
  if (checkout.discountCode) {
    const discountResult = await client.query(
      `SELECT id::int AS id, code, description, discount_type AS "discountType",
        discount_value::float8 AS "discountValue", minimum_order::float8 AS "minimumOrder"
       FROM discounts
       WHERE upper(code) = $1 AND is_active
         AND (starts_at IS NULL OR starts_at <= now())
         AND (expires_at IS NULL OR expires_at > now())${lockInventory ? ' FOR SHARE' : ''}`,
      [checkout.discountCode],
    )
    const discountRow = discountResult.rows[0]
    if (!discountRow) return { error: 'That discount code is invalid, inactive, or expired.', status: 400 }
    if (subtotal < Number(discountRow.minimumOrder)) {
      return {
        error: `This code requires a cart subtotal of at least ₹${Number(discountRow.minimumOrder).toLocaleString('en-IN')}.`,
        status: 400,
      }
    }
    discountAmount = roundMoney(Math.min(
      subtotal,
      discountRow.discountType === 'percentage'
        ? subtotal * Number(discountRow.discountValue) / 100
        : Number(discountRow.discountValue),
    ))
    discount = {
      code: discountRow.code,
      description: discountRow.description,
      type: discountRow.discountType,
      value: Number(discountRow.discountValue),
    }
  }

  let allocatedDiscountCents = 0
  const discountCents = Math.round(discountAmount * 100)
  let taxAmount = 0
  let lineTotalAmount = 0
  const pricedLines = lines.map((line, index) => {
    const lineDiscountCents = index === lines.length - 1
      ? discountCents - allocatedDiscountCents
      : Math.floor(discountCents * line.lineSubtotal / (subtotal || 1))
    allocatedDiscountCents += lineDiscountCents
    const lineDiscount = lineDiscountCents / 100
    const taxableAmount = roundMoney(line.lineSubtotal - lineDiscount)
    const lineTax = roundMoney(taxableAmount * line.taxRate / 100)
    const lineTotal = roundMoney(taxableAmount + lineTax)
    taxAmount = roundMoney(taxAmount + lineTax)
    lineTotalAmount = roundMoney(lineTotalAmount + lineTotal)
    return { ...line, discountAmount: lineDiscount, taxAmount: lineTax, lineTotal }
  })
  const deliveryFee = checkout.fulfillmentMethod === 'pickup' ? 0 : Number(marketplace.deliveryFee)
  const total = roundMoney(lineTotalAmount + deliveryFee)
  const quote = {
    pharmacyId,
    pharmacyName: medicineResult.rows[0].pharmacyName,
    items: pricedLines,
    fulfillmentMethod: checkout.fulfillmentMethod,
    addressId: destination?.id ?? null,
    deliveryAddress: destination?.address ?? null,
    deliveryLatitude: destination?.latitude ?? null,
    deliveryLongitude: destination?.longitude ?? null,
    deliveryContactPhone: destination?.contactPhone ?? null,
    paymentMethod: checkout.paymentMethod,
    discount,
    discountCode: checkout.discountCode,
    subtotal,
    discountAmount,
    taxAmount,
    deliveryFee,
    total,
  }
  return { value: { quote, customerId: customerResult.rows[0].id, medicineById } }
}

function issueCheckoutQuote(userId, checkout, quote) {
  const now = Date.now()
  for (const [quoteId, entry] of checkoutQuotes) {
    if (entry.expiresAt <= now || entry.userId === userId) checkoutQuotes.delete(quoteId)
  }
  const quoteId = randomBytes(24).toString('hex')
  const expiresAt = now + 10 * 60 * 1000
  checkoutQuotes.set(quoteId, { userId, checkout, quote, expiresAt })
  return { ...quote, quoteId, expiresAt: new Date(expiresAt).toISOString() }
}

app.post('/api/checkout/quote', requireCustomer, async (request, response, next) => {
  const parsed = parseCheckoutRequest(request.body)
  if (parsed.error) return response.status(parsed.status).json({ error: parsed.error })
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const result = await buildCheckoutQuote(client, request.user.id, parsed.value)
    if (result.error) {
      await client.query('ROLLBACK')
      return response.status(result.status).json({ error: result.error, corrections: result.corrections })
    }
    await client.query('COMMIT')
    response.json(issueCheckoutQuote(request.user.id, parsed.value, result.value.quote))
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    next(error)
  } finally {
    client?.release()
  }
})

async function placeLegacyOrder(request, response, next) {
  const items = request.body?.items
  const paymentMethod = typeof request.body?.paymentMethod === 'string' ? request.body.paymentMethod.trim() : ''
  const requestedPharmacyId = request.body?.pharmacyId
  const idempotencyKey = request.get('idempotency-key')?.trim() || ''
  if (!Array.isArray(items) || items.length < 1 || items.length > 30 ||
      items.some((item) => !Number.isSafeInteger(item?.medicineId) || item.medicineId < 1 ||
        !Number.isSafeInteger(item?.quantity) || item.quantity < 1 || item.quantity > 50 ||
        (item.unitPrice !== undefined && (typeof item.unitPrice !== 'number' || priceToCents(item.unitPrice) === null))) ||
      new Set(items.map((item) => item.medicineId)).size !== items.length) {
    return response.status(400).json({ error: 'Choose between 1 and 30 medicines with valid quantities.' })
  }
  if (!['Cash on Delivery', 'UPI Payment'].includes(paymentMethod)) {
    return response.status(400).json({ error: 'Choose a supported payment method.' })
  }
  if (!/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(idempotencyKey)) {
    return response.status(400).json({ error: 'A valid Idempotency-Key UUID is required.' })
  }
  const normalizedItems = items.map((item) => ({
    medicineId: item.medicineId,
    quantity: item.quantity,
    expectedPriceCents: item.unitPrice === undefined ? null : priceToCents(item.unitPrice),
  })).sort((left, right) => left.medicineId - right.medicineId)
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ items: normalizedItems, paymentMethod, pharmacyId: requestedPharmacyId ?? null }))
    .digest('hex')

  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const customer = await client.query(
      `SELECT c.id FROM customers c JOIN user_accounts u ON u.id = c.user_account_id
       WHERE c.user_account_id = $1 AND u.role = 'customer'`,
      [request.user.id],
    )
    if (!customer.rowCount) throw new ApiError(404, 'Customer profile was not found.')
    const customerId = customer.rows[0].id
    const claim = await client.query(
      `INSERT INTO order_idempotency_keys (customer_id, idempotency_key, request_hash)
       VALUES ($1, $2, $3) ON CONFLICT (customer_id, idempotency_key) DO NOTHING
       RETURNING customer_id`,
      [customerId, idempotencyKey, requestHash],
    )
    if (!claim.rowCount) {
      const previous = await client.query(
        `SELECT request_hash AS "requestHash", order_id::int AS "orderId"
         FROM order_idempotency_keys WHERE customer_id = $1 AND idempotency_key = $2`,
        [customerId, idempotencyKey],
      )
      if (previous.rows[0]?.requestHash !== requestHash) {
        throw new ApiError(409, 'This idempotency key was already used for a different order request.', 'IDEMPOTENCY_KEY_REUSED')
      }
      if (!previous.rows[0]?.orderId) {
        throw new ApiError(503, 'The previous order request is still being finalized. Retry with the same key.', 'ORDER_REQUEST_PENDING')
      }
      const replay = await client.query(
        `${orderSelect} WHERE o.id = $1 AND c.user_account_id = $2`,
        [previous.rows[0].orderId, request.user.id],
      )
      await client.query('COMMIT')
      return response.status(200).json({ ...replay.rows[0], idempotentReplay: true })
    }

    const address = await client.query(
      `SELECT NULLIF(concat_ws(', ', NULLIF(address, ''), city, state, postal_code), '') AS address,
         latitude, longitude
       FROM customer_addresses WHERE user_account_id = $1 AND is_default
       ORDER BY id LIMIT 1`,
      [request.user.id],
    )
    const savedAddress = address.rows[0]
    const deliveryAddress = savedAddress?.address ||
      (savedAddress?.latitude != null ? `GPS ${savedAddress.latitude}, ${savedAddress.longitude}` : '')
    if (!deliveryAddress) throw new ApiError(400, 'Add a delivery address or GPS location in your profile before ordering.')

    const medicineIds = normalizedItems.map((item) => item.medicineId)
    const medicines = await client.query(
      `SELECT m.id::int AS id, m.pharmacy_id::int AS "pharmacyId", m.name,
         m.generic_name AS "genericName", m.pack, m.sku, m.manufacturer,
         COALESCE(c.name, 'Uncategorized') AS category, m.price::text AS price,
         m.stock, m.prescription_required AS "prescriptionRequired"
       FROM medicines m LEFT JOIN categories c ON c.id = m.category_id
       WHERE m.id = ANY($1::bigint[]) AND m.is_active
       ORDER BY m.id FOR UPDATE OF m`,
      [medicineIds],
    )
    if (medicines.rowCount !== items.length) throw new ApiError(409, 'One or more medicines are no longer available.', 'MEDICINE_UNAVAILABLE')
    const pharmacyIds = new Set(medicines.rows.map((item) => item.pharmacyId))
    if (pharmacyIds.size !== 1) throw new ApiError(400, 'Place separate orders for medicines from different pharmacies.')
    const pharmacyId = [...pharmacyIds][0]
    if (requestedPharmacyId !== undefined && Number(requestedPharmacyId) !== pharmacyId) {
      throw new ApiError(409, 'The cart pharmacy changed. Refresh your cart and try again.', 'PHARMACY_CHANGED')
    }
    const medicineById = new Map(medicines.rows.map((item) => [item.id, item]))
    for (const item of normalizedItems) {
      const medicine = medicineById.get(item.medicineId)
      const currentPriceCents = priceToCents(medicine.price)
      if (item.expectedPriceCents !== null && item.expectedPriceCents !== currentPriceCents) {
        throw new ApiError(409, `The price for ${medicine.name} changed. Refresh your cart.`, 'PRICE_CHANGED')
      }
      if (medicine.prescriptionRequired) {
        throw new ApiError(403, `${medicine.name} requires a verified prescription.`, 'PRESCRIPTION_REQUIRED')
      }
      if (medicine.stock < item.quantity) throw new ApiError(409, `There is not enough stock for ${medicine.name}.`, 'INSUFFICIENT_STOCK')
    }

    const batches = await client.query(
      `SELECT id::int AS id, medicine_id::int AS "medicineId", quantity_remaining AS "quantityRemaining"
       FROM inventory_batches
       WHERE medicine_id = ANY($1::bigint[]) AND quantity_remaining > 0
         AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
       ORDER BY medicine_id, expiry_date ASC NULLS LAST, received_at ASC, id ASC
       FOR UPDATE`,
      [medicineIds],
    )
    const batchesByMedicine = new Map()
    for (const batch of batches.rows) {
      const list = batchesByMedicine.get(batch.medicineId) ?? []
      list.push(batch)
      batchesByMedicine.set(batch.medicineId, list)
    }
    for (const item of normalizedItems) {
      const available = (batchesByMedicine.get(item.medicineId) ?? []).reduce((sum, batch) => sum + batch.quantityRemaining, 0)
      if (available < item.quantity) throw new ApiError(409, 'There is not enough unexpired batch stock.', 'INSUFFICIENT_UNEXPIRED_STOCK')
    }

    const subtotalCents = normalizedItems.reduce((sum, item) =>
      sum + priceToCents(medicineById.get(item.medicineId).price) * item.quantity, 0)
    const taxCents = Math.round(subtotalCents * 0.05)
    const deliveryFeeCents = subtotalCents > 0 ? 4900 : 0
    const totalCents = subtotalCents + taxCents + deliveryFeeCents
    const orderNumber = `PH-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`
    const inserted = await client.query(
      `INSERT INTO sales_orders
       (order_number, customer_id, pharmacy_id, status, payment_method, subtotal, tax_amount,
        delivery_fee, total, delivery_address, payment_status)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, 'pending')
       RETURNING id::int AS id`,
      [orderNumber, customerId, pharmacyId, paymentMethod, subtotalCents / 100, taxCents / 100,
        deliveryFeeCents / 100, totalCents / 100, deliveryAddress],
    )
    const orderId = inserted.rows[0].id
    const deliveryCode = deriveDeliveryCode(deliveryCodeKeyRing, orderId)
    await client.query(
      `UPDATE sales_orders SET delivery_code_verifier = $2, delivery_code_key_version = $3 WHERE id = $1`,
      [orderId, createDeliveryCodeVerifier(deliveryCodeKeyRing, orderId, deliveryCode), deliveryCodeKeyRing.currentVersion],
    )
    await client.query(
      `INSERT INTO payments (order_id, amount, method, status) VALUES ($1, $2, $3, 'pending')`,
      [orderId, totalCents / 100, paymentMethod],
    )

    for (const item of normalizedItems) {
      const medicine = medicineById.get(item.medicineId)
      const unitPriceCents = priceToCents(medicine.price)
      const snapshot = { medicineId: medicine.id, name: medicine.name, genericName: medicine.genericName,
        category: medicine.category, pack: medicine.pack, sku: medicine.sku, manufacturer: medicine.manufacturer,
        unitPrice: unitPriceCents / 100 }
      const orderItem = await client.query(
        `INSERT INTO sales_order_items
         (order_id, medicine_id, medicine_name, quantity, unit_price, line_total, medicine_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id::int AS id`,
        [orderId, item.medicineId, medicine.name, item.quantity, unitPriceCents / 100,
          unitPriceCents * item.quantity / 100, JSON.stringify(snapshot)],
      )
      let remaining = item.quantity
      for (const batch of batchesByMedicine.get(item.medicineId) ?? []) {
        if (remaining === 0) break
        const quantity = Math.min(remaining, batch.quantityRemaining)
        const deduction = await client.query(
          `UPDATE inventory_batches SET quantity_remaining = quantity_remaining - $2
           WHERE id = $1 AND quantity_remaining >= $2 RETURNING id`,
          [batch.id, quantity],
        )
        if (!deduction.rowCount) throw new ApiError(409, 'Inventory changed while placing the order.', 'INVENTORY_CHANGED')
        await client.query(
          `INSERT INTO order_item_batch_allocations (order_item_id, inventory_batch_id, quantity)
           VALUES ($1, $2, $3)`,
          [orderItem.rows[0].id, batch.id, quantity],
        )
        await client.query(
          `INSERT INTO sales_order_item_batches (order_item_id, inventory_batch_id, quantity)
           VALUES ($1, $2, $3)`,
          [orderItem.rows[0].id, batch.id, quantity],
        )
        await client.query(
          `INSERT INTO stock_movements (medicine_id, inventory_batch_id, movement_type, quantity_change, note)
           VALUES ($1, $2, 'sale', $3, $4)`,
          [item.medicineId, batch.id, -quantity, `Order ${orderNumber}`],
        )
        batch.quantityRemaining -= quantity
        remaining -= quantity
      }
      if (remaining > 0) throw new ApiError(409, 'There is not enough unexpired batch stock.', 'INSUFFICIENT_UNEXPIRED_STOCK')
      const stockUpdate = await client.query(
        `UPDATE medicines SET stock = stock - $2, updated_at = now()
         WHERE id = $1 AND stock >= $2 RETURNING id`,
        [item.medicineId, item.quantity],
      )
      if (!stockUpdate.rowCount) throw new ApiError(409, 'Inventory changed while placing the order.', 'INVENTORY_CHANGED')
    }
    const pendingEvent = await client.query(
      `INSERT INTO order_status_events
       (order_id, status, actor_user_id, actor_role, actor_name)
       VALUES ($1, 'pending', $2, 'customer', $3) RETURNING id`,
      [orderId, request.user.id, request.user.fullName],
    )
    await createOrderNotification(client, {
      eventId: pendingEvent.rows[0].id, orderId, orderNumber, pharmacyId,
      recipientRole: 'pharmacy_owner', status: 'pending',
    })
    await client.query(
      `INSERT INTO audit_events (actor, action, entity_type, entity_id, details)
       VALUES ($1, 'order_created', 'sales_order', $2, $3::jsonb)`,
      [request.user.email, orderId, JSON.stringify({ toStatus: 'pending', orderNumber })],
    )
    await client.query(
      `UPDATE order_idempotency_keys SET order_id = $3
       WHERE customer_id = $1 AND idempotency_key = $2`,
      [customerId, idempotencyKey, orderId],
    )
    const order = await client.query(`${orderSelect} WHERE o.id = $1`, [orderId])
    await client.query('COMMIT')
    return response.status(201).json(order.rows[0])
  } catch (error) {
    if (client) await rollbackTransaction(client)
    if (error instanceof ApiError) {
      return response.status(error.status).json({ error: error.message, code: error.code, ...error.details })
    }
    if (error.code === '40001' || error.code === '40P01') {
      return response.status(503).json({ error: 'Inventory is busy. Retry with the same Idempotency-Key.', code: 'ORDER_RETRY' })
    }
    next(error)
  } finally {
    client?.release()
  }
}

app.post(['/api/orders', '/api/customer/orders'], requireCustomer, async (request, response, next) => {
  const quoteId = typeof request.body?.quoteId === 'string' ? request.body.quoteId : ''
  if (!quoteId) return placeLegacyOrder(request, response, next)
  const parsed = parseCheckoutRequest(request.body)
  if (parsed.error) return response.status(parsed.status).json({ error: parsed.error })
  const items = parsed.value.items
  const paymentMethod = parsed.value.paymentMethod
  const requestedPharmacyId = undefined
  const idempotencyKey = request.get('idempotency-key')?.trim() || ''
  const savedQuote = checkoutQuotes.get(quoteId)
  if (!savedQuote || savedQuote.userId !== request.user.id || savedQuote.expiresAt <= Date.now()) {
    checkoutQuotes.delete(quoteId)
    return response.status(409).json({ error: 'Your quote expired. Request a fresh quote before placing the order.' })
  }
  if (JSON.stringify(savedQuote.checkout) !== JSON.stringify(parsed.value)) {
    return response.status(409).json({ error: 'Cart or checkout options changed. Request a fresh quote before placing the order.' })
  }
  if (
    requestedPharmacyId !== undefined &&
    (!Number.isSafeInteger(requestedPharmacyId) || requestedPharmacyId < 1)
  ) {
    return response.status(400).json({ error: 'Choose a valid pharmacy for this order.' })
  }
  if (!/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(idempotencyKey)) {
    return response.status(400).json({ error: 'A valid Idempotency-Key UUID is required.' })
  }
  if (items.some((item) =>
    item.unitPrice !== undefined &&
    (typeof item.unitPrice !== 'number' || priceToCents(item.unitPrice) === null),
  )) {
    return response.status(400).json({ error: 'Medicine prices must be valid non-negative amounts.' })
  }

  const normalizedItems = items
    .map((item) => ({
      medicineId: item.medicineId,
      quantity: item.quantity,
      expectedPriceCents: item.unitPrice === undefined ? null : priceToCents(item.unitPrice),
    }))
    .sort((left, right) => left.medicineId - right.medicineId)
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ items: normalizedItems, paymentMethod, pharmacyId: requestedPharmacyId ?? null }))
    .digest('hex')
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const customerClaim = await client.query(
      `SELECT c.id FROM customers c JOIN user_accounts u ON u.id = c.user_account_id
       WHERE c.user_account_id = $1 AND u.role = 'customer'`,
      [request.user.id],
    )
    if (!customerClaim.rowCount) throw new ApiError(404, 'Customer profile was not found.')
    const customerIdForKey = customerClaim.rows[0].id
    const claim = await client.query(
      `INSERT INTO order_idempotency_keys (customer_id, idempotency_key, request_hash)
       VALUES ($1, $2, $3) ON CONFLICT (customer_id, idempotency_key) DO NOTHING
       RETURNING customer_id`,
      [customerIdForKey, idempotencyKey, requestHash],
    )
    if (!claim.rowCount) {
      const previous = await client.query(
        `SELECT request_hash AS "requestHash", order_id::int AS "orderId"
         FROM order_idempotency_keys WHERE customer_id = $1 AND idempotency_key = $2`,
        [customerIdForKey, idempotencyKey],
      )
      if (previous.rows[0]?.requestHash !== requestHash) {
        throw new ApiError(409, 'This idempotency key was already used for a different order request.', 'IDEMPOTENCY_KEY_REUSED')
      }
      if (!previous.rows[0]?.orderId) {
        throw new ApiError(503, 'The previous order request is still being finalized. Retry with the same key.', 'ORDER_REQUEST_PENDING')
      }
      const replay = await client.query(
        `${orderSelect} WHERE o.id = $1 AND c.user_account_id = $2`,
        [previous.rows[0].orderId, request.user.id],
      )
      await client.query('COMMIT')
      return response.status(200).json({ ...replay.rows[0], idempotentReplay: true })
    }
    const currentResult = await buildCheckoutQuote(client, request.user.id, parsed.value, { lockInventory: true })
    if (currentResult.error) {
      await client.query('ROLLBACK')
      checkoutQuotes.delete(quoteId)
      return response.status(409).json({
        error: currentResult.error,
        corrections: currentResult.corrections,
      })
    }
    if (JSON.stringify(currentResult.value.quote) !== JSON.stringify(savedQuote.quote)) {
      await client.query('ROLLBACK')
      checkoutQuotes.delete(quoteId)
      return response.status(409).json({
        error: 'Price, stock, tax, discount, or fees changed. Review the updated quote before confirming.',
        quote: issueCheckoutQuote(request.user.id, parsed.value, currentResult.value.quote),
      })
    }

    const { quote, customerId, medicineById } = currentResult.value
    for (const line of quote.items) {
      if (!line.prescriptionId) continue
      const reservation = await client.query(
        `UPDATE prescription_medicines
         SET reserved_quantity = reserved_quantity + $3
         WHERE prescription_id = $1 AND medicine_id = $2
           AND approved_quantity - reserved_quantity >= $3
         RETURNING prescription_id`,
        [line.prescriptionId, line.medicineId, line.quantity],
      )
      if (!reservation.rowCount) {
        await client.query('ROLLBACK')
        checkoutQuotes.delete(quoteId)
        return response.status(409).json({
          error: `The approved prescription quantity for ${line.name} is no longer available. Review your prescription and request a new quote.`,
        })
      }
    }
    const orderNumber = `PH-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`
    const inserted = await client.query(
      `INSERT INTO sales_orders
        (order_number, customer_id, pharmacy_id, status, payment_method,
         subtotal, discount_amount, discount_code, tax_amount, delivery_fee, total, delivery_address,
         fulfillment_method, delivery_latitude, delivery_longitude, delivery_contact_phone, payment_status)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'pending')
       RETURNING id::int AS id`,
      [orderNumber, customerId, quote.pharmacyId, quote.paymentMethod, quote.subtotal,
        quote.discountAmount, quote.discountCode, quote.taxAmount, quote.deliveryFee, quote.total,
        quote.deliveryAddress, quote.fulfillmentMethod, quote.deliveryLatitude, quote.deliveryLongitude,
        quote.deliveryContactPhone],
    )
    const orderId = inserted.rows[0].id
    const deliveryCode = deriveDeliveryCode(deliveryCodeKeyRing, orderId)
    await client.query(
      `UPDATE sales_orders SET delivery_code_verifier = $2, delivery_code_key_version = $3 WHERE id = $1`,
      [orderId, createDeliveryCodeVerifier(deliveryCodeKeyRing, orderId, deliveryCode), deliveryCodeKeyRing.currentVersion],
    )
    await client.query(
      `INSERT INTO payments (order_id, amount, method, status) VALUES ($1, $2, $3, 'pending')`,
      [orderId, quote.total, quote.paymentMethod],
    )
    for (const line of quote.items) {
      const medicine = medicineById.get(line.medicineId)
      const orderItem = await client.query(
        `INSERT INTO sales_order_items
          (order_id, medicine_id, medicine_name, quantity, pack_quantity_at_order,
           base_unit_quantity, base_unit_name, unit_price, discount_amount, tax_amount, line_total,
           prescription_id, prescription_required_at_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id::int AS id`,
        [orderId, line.medicineId, line.name, line.quantity, line.packQuantity,
          line.baseUnitQuantity, line.packUnit, line.unitPrice, line.discountAmount,
          line.taxAmount, line.lineTotal, line.prescriptionId, line.prescriptionRequired],
      )
      const stockUpdate = await client.query(
        `UPDATE medicines SET stock = stock - $2, updated_at = now()
         WHERE id = $1 AND stock >= $2 RETURNING id`,
        [line.medicineId, line.quantity],
      )
      if (!stockUpdate.rowCount) {
        throw new ApiError(409, `Stock for ${line.name} changed while placing the order.`, 'INVENTORY_CHANGED')
      }
      if (medicine.hasBatches) {
        const batches = await client.query(
          `SELECT id::int AS id, quantity_remaining AS quantity
           FROM inventory_batches
           WHERE medicine_id = $1 AND quantity_remaining > 0
             AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
           ORDER BY expiry_date ASC NULLS LAST, received_at, id
           FOR UPDATE`,
          [line.medicineId],
        )
        let remaining = line.quantity
        for (const batch of batches.rows) {
          if (remaining === 0) break
          const quantity = Math.min(remaining, batch.quantity)
          await client.query(
            'UPDATE inventory_batches SET quantity_remaining = quantity_remaining - $2 WHERE id = $1',
            [batch.id, quantity],
          )
          await client.query(
            `INSERT INTO sales_order_item_batches (order_item_id, inventory_batch_id, quantity)
             VALUES ($1, $2, $3)`,
            [orderItem.rows[0].id, batch.id, quantity],
          )
          await client.query(
            `INSERT INTO order_item_batch_allocations (order_item_id, inventory_batch_id, quantity)
             VALUES ($1, $2, $3)`,
            [orderItem.rows[0].id, batch.id, quantity],
          )
          remaining -= quantity
        }
        if (remaining > 0) {
          throw new Error(`Batch inventory changed while placing order for ${line.name}.`)
        }
      }
      await client.query(
        `INSERT INTO stock_movements (medicine_id, movement_type, quantity_change, note)
         VALUES ($1, 'sale', $2, $3)`,
        [line.medicineId, -line.quantity, `Order ${orderNumber}`],
      )
    }
    const pendingEvent = await client.query(
      `INSERT INTO order_status_events
        (order_id, status, actor_user_id, actor_role, actor_name)
       VALUES ($1, 'pending', $2, 'customer', $3)
       RETURNING id`,
      [orderId, request.user.id, request.user.fullName],
    )
    await createOrderNotification(client, {
      eventId: pendingEvent.rows[0].id,
      orderId,
      orderNumber,
      pharmacyId,
      recipientRole: 'pharmacy_owner',
      status: 'pending',
    })
    await client.query(
      `INSERT INTO audit_events (actor, action, entity_type, entity_id, details)
       VALUES ($1, 'order_created', 'sales_order', $2, $3::jsonb)`,
      [
        request.user.email,
        orderId,
        JSON.stringify({
          toStatus: 'pending',
          actorUserId: request.user.id,
          actorRole: 'customer',
          actorName: request.user.fullName,
          orderNumber,
        }),
      ],
    )
    await client.query(
      `UPDATE order_idempotency_keys
       SET order_id = $3
       WHERE customer_id = $1 AND idempotency_key = $2`,
      [customerId, idempotencyKey, orderId],
    )
    const order = await client.query(`${orderSelect} WHERE o.id = $1`, [orderId])
    await client.query('COMMIT')
    response.status(201).json(order.rows[0])
  } catch (error) {
    if (client) await rollbackTransaction(client)
    if (error instanceof ApiError) {
      return response.status(error.status).json({ error: error.message, code: error.code, ...error.details })
    }
    if (error.code === '40001' || error.code === '40P01') {
      return response.status(503).json({ error: 'Inventory is busy. Retry this order with the same Idempotency-Key.', code: 'ORDER_RETRY' })
    }
    next(error)
  } finally {
    client?.release()
  }
})

app.get(['/api/orders/:id', '/api/customer/orders/:id'], requireAuth, async (request, response, next) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid order ID.' })
  if (!['customer', 'pharmacy_owner'].includes(request.user.role)) {
    return response.status(403).json({ error: 'This account cannot view orders.' })
  }

  try {
    const predicate = request.user.role === 'customer'
      ? 'o.id = $1 AND c.user_account_id = $2'
      : 'o.id = $1 AND o.pharmacy_id = $2'
    const result = await pool.query(
      `${orderSelect} WHERE ${predicate}`,
      [id, request.user.role === 'customer' ? request.user.id : request.user.pharmacyId],
    )
    if (!result.rowCount) return response.status(404).json({ error: 'Order was not found.' })
    response.json(result.rows[0])
  } catch (error) {
    next(error)
  }
})

app.get('/api/me/orders/:id/delivery-code', requireCustomer, async (request, response, next) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid order ID.' })
  try {
    const result = await pool.query(
      `SELECT o.id, o.status, o.delivery_code_verifier AS verifier,
         o.delivery_code_key_version AS "keyVersion"
       FROM sales_orders o
       JOIN customers c ON c.id = o.customer_id
       WHERE o.id = $1 AND c.user_account_id = $2`,
      [id, request.user.id],
    )
    if (!result.rowCount) return response.status(404).json({ error: 'Order was not found.' })
    const order = result.rows[0]
    if (order.status !== 'out_for_delivery') {
      return response.status(409).json({ error: 'The delivery code is available only while your order is out for delivery.' })
    }
    if (!order.verifier || !order.keyVersion) {
      return response.status(503).json({ error: 'The delivery code is not available. Contact the pharmacy.' })
    }
    const code = deriveDeliveryCode(deliveryCodeKeyRing, id, order.keyVersion)
    if (!verifyDeliveryCode(deliveryCodeKeyRing, id, code, order.verifier, order.keyVersion)) {
      throw new Error(`Delivery-code verifier mismatch for order ${id}.`)
    }
    response.set('Cache-Control', 'no-store')
    response.json({ code })
  } catch (error) {
    next(error)
  }
})

app.get('/api/me/orders/:id/events', requireCustomer, async (request, response, next) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid order ID.' })

  try {
    const result = await pool.query(
      `SELECT e.status, e.created_at AS "createdAt",
         e.actor_role AS "actorRole", e.actor_name AS "actorName", e.note
       FROM sales_orders o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN order_status_events e ON e.order_id = o.id
       WHERE o.id = $1 AND c.user_account_id = $2
       ORDER BY e.created_at NULLS FIRST, e.id`,
      [id, request.user.id],
    )
    if (!result.rowCount) return response.status(404).json({ error: 'Order was not found.' })
    response.json(result.rows.filter((event) => event.status !== null))
  } catch (error) {
    next(error)
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

async function listNotifications(request, response, next, recipientRole) {
  const owner = recipientRole === 'pharmacy_owner'
  try {
    const values = owner
      ? [request.user.id, recipientRole, request.user.pharmacyId]
      : [request.user.id, recipientRole]
    const pharmacyFilter = owner ? 'AND n.pharmacy_id = $3' : ''
    const [notifications, unreadCount] = await Promise.all([
      pool.query(
        `SELECT n.id::int AS id, n.type, n.title, n.message,
           n.reference_type AS "referenceType", n.reference_id::int AS "referenceId",
           n.is_read AS "isRead", n.created_at AS "createdAt",
           e.status AS "eventStatus", COALESCE(e.created_at, n.created_at) AS "eventTime",
           o.order_number AS "orderNumber", o.status AS "currentStatus",
           m.name AS "medicineName", m.pharmacy_id::int AS "medicinePharmacyId"
         FROM notifications n
         LEFT JOIN order_status_events e ON e.id = n.order_status_event_id
         LEFT JOIN sales_orders o ON o.id = n.reference_id AND n.reference_type = 'sales_order'
         LEFT JOIN medicines m ON m.id = n.reference_id AND n.reference_type = 'medicine'
         WHERE n.recipient_user_id = $1 AND n.recipient_role = $2 ${pharmacyFilter}
         ORDER BY n.created_at DESC, n.id DESC
         LIMIT 100`,
        values,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count
         FROM notifications n
         WHERE n.recipient_user_id = $1 AND n.recipient_role = $2
           ${pharmacyFilter}`,
        values,
      ),
    ])
    response.set('Cache-Control', 'no-store')
    response.json({
      notifications: notifications.rows,
      unreadCount: unreadCount.rows[0].count,
    })
  } catch (error) {
    next(error)
  }
}

app.get('/api/me/notifications', requireCustomer, (request, response, next) => {
  void listNotifications(request, response, next, 'customer')
})
app.get('/api/owner/notifications', requireOwner, (request, response, next) => {
  void listNotifications(request, response, next, 'pharmacy_owner')
})

async function markNotificationRead(request, response, next, recipientRole) {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid notification ID.' })
  try {
    const result = await pool.query(
      `UPDATE notifications
       SET is_read = true, read_at = COALESCE(read_at, now())
       WHERE id = $1 AND recipient_user_id = $2 AND recipient_role = $3
         AND ($4::bigint IS NULL OR pharmacy_id = $4)
       RETURNING id::int AS id, is_read AS "isRead", read_at AS "readAt"`,
      [id, request.user.id, recipientRole, recipientRole === 'pharmacy_owner' ? request.user.pharmacyId : null],
    )
    if (!result.rowCount) return response.status(404).json({ error: 'Notification was not found.' })
    response.json(result.rows[0])
  } catch (error) {
    next(error)
  }
}

app.patch('/api/me/notifications/:id', requireCustomer, (request, response, next) => {
  void markNotificationRead(request, response, next, 'customer')
})
app.patch('/api/owner/notifications/:id', requireOwner, (request, response, next) => {
  void markNotificationRead(request, response, next, 'pharmacy_owner')
})

app.get('/api/me/reminders', requireCustomer, async (request, response, next) => {
  try {
    const [reminders, stockAlerts, history] = await Promise.all([
      pool.query(
        `SELECT r.id::int AS id, r.medicine_id::int AS "medicineId", m.name AS "medicineName",
           r.pharmacy_id::int AS "pharmacyId", p.name AS "pharmacyName", r.opt_in AS "optIn",
           r.next_reminder_date AS "nextReminderDate", r.interval_days AS "intervalDays",
           r.last_sent_at AS "lastSentAt", r.cancelled_at AS "cancelledAt"
         FROM medicine_reminders r
         JOIN medicines m ON m.id = r.medicine_id
         LEFT JOIN pharmacies p ON p.id = r.pharmacy_id
         WHERE r.customer_account_id = $1
         ORDER BY r.updated_at DESC, r.id DESC`,
        [request.user.id],
      ),
      pool.query(
        `SELECT s.id::int AS id, s.medicine_id::int AS "medicineId", m.name AS "medicineName",
           s.pharmacy_id::int AS "pharmacyId", p.name AS "pharmacyName", s.active,
           s.last_sent_at AS "lastSentAt", s.cancelled_at AS "cancelledAt"
         FROM stock_alert_subscriptions s
         JOIN medicines m ON m.id = s.medicine_id
         LEFT JOIN pharmacies p ON p.id = s.pharmacy_id
         WHERE s.customer_account_id = $1
         ORDER BY s.updated_at DESC, s.id DESC`,
        [request.user.id],
      ),
      pool.query(
        `SELECT id::int AS id, medicine_id::int AS "medicineId", pharmacy_id::int AS "pharmacyId",
           alert_type AS "alertType", status, reason, created_at AS "createdAt"
         FROM medicine_alert_events
         WHERE customer_account_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT 100`,
        [request.user.id],
      ),
    ])
    response.json({ reminders: reminders.rows, stockAlerts: stockAlerts.rows, history: history.rows })
  } catch (error) {
    next(error)
  }
})

app.post('/api/me/reminders', requireCustomer, async (request, response, next) => {
  const medicineId = Number(request.body?.medicineId)
  const pharmacyId = request.body?.pharmacyId === undefined ? null : Number(request.body?.pharmacyId)
  const nextReminderDate = typeof request.body?.nextReminderDate === 'string'
    ? request.body.nextReminderDate
    : ''
  const intervalDays = request.body?.intervalDays === undefined ? 30 : Number(request.body?.intervalDays)
  if (!Number.isSafeInteger(medicineId) || medicineId < 1 ||
      (pharmacyId !== null && (!Number.isSafeInteger(pharmacyId) || pharmacyId < 1)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(nextReminderDate) ||
      !Number.isSafeInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) {
    return response.status(400).json({ error: 'Choose a valid medicine, future reminder date, and 1–365 day interval.' })
  }
  const reminderDate = new Date(`${nextReminderDate}T00:00:00.000Z`)
  if (Number.isNaN(reminderDate.getTime()) || reminderDate.toISOString().slice(0, 10) !== nextReminderDate ||
      reminderDate.getTime() < Date.now()) {
    return response.status(400).json({ error: 'The refill reminder date must be today or in the future.' })
  }
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const medicine = await client.query(
      `SELECT m.id, m.pharmacy_id AS "pharmacyId"
       FROM medicines m JOIN pharmacies p ON p.id = m.pharmacy_id
       WHERE m.id = $1 AND m.is_active AND p.approval_status = 'approved'
       FOR SHARE`,
      [medicineId],
    )
    if (!medicine.rowCount ||
        (pharmacyId !== null && medicine.rows[0].pharmacyId !== pharmacyId)) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'This medicine is not available from the selected verified pharmacy.' })
    }
    const saved = await client.query(
      `INSERT INTO medicine_reminders
         (customer_account_id, medicine_id, pharmacy_id, opt_in, next_reminder_date, interval_days)
       VALUES ($1, $2, $3, true, $4, $5)
       ON CONFLICT (customer_account_id, medicine_id) DO UPDATE SET
         pharmacy_id = EXCLUDED.pharmacy_id,
         opt_in = true,
         next_reminder_date = EXCLUDED.next_reminder_date,
         interval_days = EXCLUDED.interval_days,
         cancelled_at = NULL,
         updated_at = now()
       RETURNING id::int AS id, medicine_id::int AS "medicineId",
         pharmacy_id::int AS "pharmacyId", opt_in AS "optIn",
         next_reminder_date AS "nextReminderDate", interval_days AS "intervalDays"`,
      [request.user.id, medicineId, pharmacyId ?? medicine.rows[0].pharmacyId, nextReminderDate, intervalDays],
    )
    await client.query('COMMIT')
    response.status(201).json(saved.rows[0])
  } catch (error) {
    if (client) await rollbackTransaction(client)
    next(error)
  } finally {
    client?.release()
  }
})

app.patch('/api/me/reminders/:id', requireCustomer, async (request, response, next) => {
  const id = Number(request.params.id)
  const optIn = request.body?.optIn
  const nextReminderDate = request.body?.nextReminderDate
  const intervalDays = request.body?.intervalDays
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid reminder ID.' })
  if (optIn !== undefined && typeof optIn !== 'boolean') {
    return response.status(400).json({ error: 'optIn must be true or false.' })
  }
  if (intervalDays !== undefined &&
      (!Number.isSafeInteger(intervalDays) || intervalDays < 1 || intervalDays > 365)) {
    return response.status(400).json({ error: 'Interval must be 1–365 days.' })
  }
  if (nextReminderDate !== undefined &&
      (typeof nextReminderDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(nextReminderDate))) {
    return response.status(400).json({ error: 'Choose a valid reminder date.' })
  }
  try {
    const result = await pool.query(
      `UPDATE medicine_reminders r
       SET opt_in = COALESCE($3, r.opt_in),
           next_reminder_date = COALESCE($4::date, r.next_reminder_date),
           interval_days = COALESCE($5, r.interval_days),
           cancelled_at = CASE WHEN $3 = false THEN now() ELSE NULL END,
           updated_at = now()
       WHERE r.id = $1
         AND r.customer_account_id = $2
       RETURNING r.id::int AS id, r.opt_in AS "optIn",
         r.next_reminder_date AS "nextReminderDate", r.interval_days AS "intervalDays",
         r.cancelled_at AS "cancelledAt"`,
      [id, request.user.id, optIn, nextReminderDate ?? null, intervalDays ?? null],
    )
    if (!result.rowCount) return response.status(404).json({ error: 'Reminder was not found.' })
    response.json(result.rows[0])
  } catch (error) {
    next(error)
  }
})

app.post('/api/me/stock-alerts', requireCustomer, async (request, response, next) => {
  const medicineId = Number(request.body?.medicineId)
  if (!Number.isSafeInteger(medicineId) || medicineId < 1) {
    return response.status(400).json({ error: 'Choose a valid medicine.' })
  }
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const medicine = await client.query(
      `SELECT m.id, m.pharmacy_id AS "pharmacyId"
       FROM medicines m JOIN pharmacies p ON p.id = m.pharmacy_id
       WHERE m.id = $1 AND m.is_active AND p.approval_status = 'approved'
       FOR SHARE`,
      [medicineId],
    )
    if (!medicine.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'This medicine is not available from a verified pharmacy.' })
    }
    const saved = await client.query(
      `INSERT INTO stock_alert_subscriptions
         (customer_account_id, medicine_id, pharmacy_id, active)
       VALUES ($1, $2, $3, true)
       ON CONFLICT (customer_account_id, medicine_id) DO UPDATE SET
         pharmacy_id = EXCLUDED.pharmacy_id,
         active = true,
         cancelled_at = NULL,
         updated_at = now()
       RETURNING id::int AS id, medicine_id::int AS "medicineId",
         pharmacy_id::int AS "pharmacyId", active,
         last_sent_at AS "lastSentAt"`,
      [request.user.id, medicineId, medicine.rows[0].pharmacyId],
    )
    await client.query('COMMIT')
    response.status(201).json(saved.rows[0])
  } catch (error) {
    if (client) await rollbackTransaction(client)
    next(error)
  } finally {
    client?.release()
  }
})

app.patch('/api/me/stock-alerts/:id', requireCustomer, async (request, response, next) => {
  const id = Number(request.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid stock alert ID.' })
  try {
    const result = await pool.query(
      `UPDATE stock_alert_subscriptions s
       SET active = false, cancelled_at = now(), updated_at = now()
       WHERE s.id = $1
         AND s.customer_account_id = $2
       RETURNING s.id::int AS id, s.active, s.cancelled_at AS "cancelledAt"`,
      [id, request.user.id],
    )
    if (!result.rowCount) return response.status(404).json({ error: 'Stock alert was not found.' })
    response.json(result.rows[0])
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

async function transitionOwnerOrder(request, response, next) {
  const id = Number(request.params.id)
  const nextStatus = request.body?.status
  const expectedStatus = request.body?.expectedStatus
  const rawNote = request.body?.note
  const note = typeof rawNote === 'string' ? rawNote.trim() : ''
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid order ID.' })
  if (!isOrderStatus(expectedStatus)) {
    return response.status(400).json({ error: 'A valid expectedStatus is required.' })
  }
  if (typeof rawNote !== 'undefined' && typeof rawNote !== 'string') {
    return response.status(400).json({ error: 'The transition note must be text.' })
  }
  if (note.length > 500) {
    return response.status(400).json({ error: 'The transition note must be 500 characters or fewer.' })
  }

  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const order = await client.query(
      'SELECT id, status, order_number AS "orderNumber" FROM sales_orders WHERE id = $1 AND pharmacy_id = $2 FOR UPDATE',
      [id, request.user.pharmacyId],
    )
    if (!order.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Order was not found.' })
    }
    const current = order.rows[0]
    if (current.status !== expectedStatus) {
      await client.query('ROLLBACK')
      return response.status(409).json({
        error: 'This order changed since you opened it. Refresh and try again.',
        code: 'ORDER_STATUS_CONFLICT',
        currentStatus: current.status,
      })
    }
    if (nextStatus !== 'declined') {
      const invalidPrescription = await client.query(
        `SELECT 1
         FROM sales_order_items i
         LEFT JOIN prescriptions p
           ON p.id = i.prescription_id AND p.status = 'approved'
             AND p.valid_until >= CURRENT_DATE AND p.storage_key IS NOT NULL
             AND p.document_deleted_at IS NULL
         LEFT JOIN prescription_medicines pm
           ON pm.prescription_id = i.prescription_id AND pm.medicine_id = i.medicine_id
         WHERE i.order_id = $1 AND i.prescription_required_at_order
           AND (p.id IS NULL OR pm.prescription_id IS NULL
             OR pm.approved_quantity < i.quantity OR pm.reserved_quantity < i.quantity)
         LIMIT 1`,
        [id],
      )
      if (invalidPrescription.rowCount) {
        await client.query('ROLLBACK')
        return response.status(409).json({
          error: 'This order cannot be fulfilled because its prescription is no longer approved, valid, or sufficiently authorized.',
        })
      }
    }
    if (!canTransitionOrderStatus(current.status, nextStatus)) {
      await client.query('ROLLBACK')
      return response.status(409).json({
        error: `Cannot change an order from ${current.status} to ${nextStatus}.`,
        code: 'ORDER_STATUS_CONFLICT',
        currentStatus: current.status,
      })
    }
    await client.query(
      `UPDATE sales_orders SET status = $2, updated_at = now()
       WHERE id = $1`,
      [id, nextStatus],
    )
    const statusEvent = await client.query(
      `INSERT INTO order_status_events
        (order_id, status, actor_user_id, actor_role, actor_name, note)
       VALUES ($1, $2, $3, 'pharmacy_owner', $4, $5)
       RETURNING id`,
      [id, nextStatus, request.user.id, request.user.fullName, note || null],
    )
    await createOrderNotification(client, {
      eventId: statusEvent.rows[0].id,
      orderId: id,
      orderNumber: current.orderNumber,
      pharmacyId: request.user.pharmacyId,
      recipientRole: 'customer',
      status: nextStatus,
      note: note || null,
    })
    await client.query(
      `INSERT INTO audit_events (actor, action, entity_type, entity_id, details)
       VALUES ($1, 'order_status_transition', 'sales_order', $2, $3::jsonb)`,
      [
        request.user.email,
        id,
        JSON.stringify({
          fromStatus: current.status,
          toStatus: nextStatus,
          actorUserId: request.user.id,
          actorRole: 'pharmacy_owner',
          actorName: request.user.fullName,
          note: note || null,
        }),
      ],
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
}

app.post('/api/owner/orders/:id/transition', requireOwner, transitionOwnerOrder)
app.put('/api/owner/orders/:id/status', requireOwner, transitionOwnerOrder)

async function verifyOwnerDelivery(request, response, next) {
  const id = Number(request.params.id)
  const code = typeof request.body?.code === 'string' ? request.body.code.trim() : ''
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid order ID.' })

  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const result = await client.query(
      `SELECT id, status, order_number AS "orderNumber", delivery_code_verifier AS verifier,
         delivery_code_key_version AS "keyVersion",
         delivery_failed_attempts AS "failedAttempts",
         delivery_locked_until AS "lockedUntil"
       FROM sales_orders
       WHERE id = $1 AND pharmacy_id = $2
       FOR UPDATE`,
      [id, request.user.pharmacyId],
    )
    if (!result.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Order was not found.' })
    }
    const order = result.rows[0]
    if (order.status !== 'out_for_delivery') {
      await client.query('ROLLBACK')
      return response.status(409).json({
        error: 'Only orders out for delivery can be verified.',
        code: 'ORDER_STATUS_CONFLICT',
        currentStatus: order.status,
      })
    }

    if (order.lockedUntil && new Date(order.lockedUntil).getTime() > Date.now()) {
      await client.query(
        `INSERT INTO delivery_verification_attempts
           (order_id, actor_user_id, outcome, failed_attempts, locked_until)
         VALUES ($1, $2, 'locked', $3, $4)`,
        [id, request.user.id, order.failedAttempts, order.lockedUntil],
      )
      await client.query(
        `INSERT INTO audit_events (actor, action, entity_type, entity_id, details)
         VALUES ($1, 'delivery_verification_locked', 'sales_order', $2, $3::jsonb)`,
        [request.user.email, id, JSON.stringify({ actorUserId: request.user.id, failedAttempts: order.failedAttempts })],
      )
      await client.query('COMMIT')
      return response.status(429).json({
        error: 'Delivery verification is temporarily locked after too many incorrect codes.',
        code: 'DELIVERY_CODE_LOCKED',
        lockedUntil: order.lockedUntil,
      })
    }

    const expiredLock = Boolean(order.lockedUntil)
    const previousAttempts = expiredLock ? 0 : order.failedAttempts
    const valid = order.verifier && order.keyVersion &&
      verifyDeliveryCode(deliveryCodeKeyRing, id, code, order.verifier, order.keyVersion)
    if (!valid) {
      const failedAttempts = Math.min(previousAttempts + 1, 5)
      const lockedUntil = failedAttempts === 5 ? new Date(Date.now() + 10 * 60 * 1000) : null
      await client.query(
        `UPDATE sales_orders
         SET delivery_failed_attempts = $2, delivery_locked_until = $3
         WHERE id = $1`,
        [id, failedAttempts, lockedUntil],
      )
      await client.query(
        `INSERT INTO delivery_verification_attempts
           (order_id, actor_user_id, outcome, failed_attempts, locked_until)
         VALUES ($1, $2, 'failed', $3, $4)`,
        [id, request.user.id, failedAttempts, lockedUntil],
      )
      await client.query(
        `INSERT INTO audit_events (actor, action, entity_type, entity_id, details)
         VALUES ($1, 'delivery_verification_failed', 'sales_order', $2, $3::jsonb)`,
        [request.user.email, id, JSON.stringify({
          actorUserId: request.user.id,
          failedAttempts,
          locked: Boolean(lockedUntil),
        })],
      )
      await client.query('COMMIT')
      return response.status(401).json({
        error: 'The delivery code is incorrect. Ask the customer to confirm it.',
        code: 'DELIVERY_CODE_INVALID',
        attemptsRemaining: 5 - failedAttempts,
        ...(lockedUntil ? { lockedUntil } : {}),
      })
    }

    await client.query(
      `UPDATE sales_orders
       SET status = 'delivered', delivery_otp_hash = NULL,
           delivery_code_verifier = NULL, delivery_code_key_version = NULL,
           delivery_failed_attempts = 0, delivery_locked_until = NULL,
           updated_at = now()
       WHERE id = $1`,
      [id],
    )
    await client.query(
      `INSERT INTO delivery_verification_attempts
         (order_id, actor_user_id, outcome, failed_attempts)
       VALUES ($1, $2, 'verified', $3)`,
      [id, request.user.id, previousAttempts],
    )
    const deliveredEvent = await client.query(
      `INSERT INTO order_status_events
         (order_id, status, actor_user_id, actor_role, actor_name)
       VALUES ($1, 'delivered', $2, 'pharmacy_owner', $3)
       RETURNING id`,
      [id, request.user.id, request.user.fullName],
    )
    await createOrderNotification(client, {
      eventId: deliveredEvent.rows[0].id,
      orderId: id,
      orderNumber: result.rows[0].orderNumber,
      pharmacyId: request.user.pharmacyId,
      recipientRole: 'customer',
      status: 'delivered',
    })
    await client.query(
      `INSERT INTO audit_events (actor, action, entity_type, entity_id, details)
       VALUES ($1, 'delivery_verified', 'sales_order', $2, $3::jsonb)`,
      [request.user.email, id, JSON.stringify({
        fromStatus: 'out_for_delivery',
        toStatus: 'delivered',
        actorUserId: request.user.id,
        actorRole: 'pharmacy_owner',
        actorName: request.user.fullName,
        failedAttempts: previousAttempts,
      })],
    )
    const updated = await client.query(`${orderSelect} WHERE o.id = $1`, [id])
    await client.query('COMMIT')
    response.json(updated.rows[0])
  } catch (error) {
    if (client) await rollbackTransaction(client)
    next(error)
  } finally {
    client?.release()
  }
}

app.post('/api/owner/orders/:id/verify-delivery', requireOwner, verifyOwnerDelivery)

async function declineOwnerOrder(request, response, next) {
  const id = Number(request.params.id)
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : ''
  if (!Number.isSafeInteger(id) || id < 1) return response.status(400).json({ error: 'Invalid order ID.' })
  if (!reason) return response.status(400).json({ error: 'A decline reason is required.' })
  if (reason.length > 500) return response.status(400).json({ error: 'The decline reason must be 500 characters or fewer.' })

  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const order = await client.query(
      `SELECT id, status, order_number AS "orderNumber"
       FROM sales_orders
       WHERE id = $1 AND pharmacy_id = $2
       FOR UPDATE`,
      [id, request.user.pharmacyId],
    )
    if (!order.rowCount) {
      await client.query('ROLLBACK')
      return response.status(404).json({ error: 'Order was not found.' })
    }

    if (order.rows[0].status === 'declined') {
      const previousDecline = await client.query(
        `SELECT note FROM order_status_events
         WHERE order_id = $1 AND status = 'declined'
         ORDER BY id DESC
         LIMIT 1`,
        [id],
      )
      if (previousDecline.rows[0]?.note !== reason) {
        await client.query('ROLLBACK')
        return response.status(409).json({
          error: 'This order has already been declined.',
          code: 'ORDER_ALREADY_DECLINED',
        })
      }
      const replay = await client.query(
        `${orderSelect} WHERE o.id = $1 AND o.pharmacy_id = $2`,
        [id, request.user.pharmacyId],
      )
      await client.query('COMMIT')
      return response.json({ ...replay.rows[0], idempotentReplay: true })
    }

    if (order.rows[0].status !== 'pending') {
      await client.query('ROLLBACK')
      return response.status(409).json({
        error: `Only pending orders can be declined. This order is ${order.rows[0].status}.`,
        code: 'ORDER_NOT_PENDING',
        currentStatus: order.rows[0].status,
      })
    }

    const items = await client.query(
      `SELECT id::int AS id, medicine_id::int AS "medicineId", quantity
       FROM sales_order_items
       WHERE order_id = $1
       ORDER BY medicine_id NULLS FIRST, id
       FOR UPDATE`,
      [id],
    )
    if (!items.rowCount || items.rows.some((item) => item.medicineId === null)) {
      await client.query('ROLLBACK')
      return response.status(409).json({
        error: 'The original order items cannot be matched to inventory for an exact reversal.',
        code: 'ORDER_ALLOCATION_MISMATCH',
      })
    }

    const medicineIds = [...new Set(items.rows.map((item) => item.medicineId))].sort((a, b) => a - b)
    const lockedMedicines = await client.query(
      `SELECT id FROM medicines
       WHERE id = ANY($1::bigint[])
       ORDER BY id
       FOR UPDATE`,
      [medicineIds],
    )
    if (lockedMedicines.rowCount !== medicineIds.length) {
      await client.query('ROLLBACK')
      return response.status(409).json({
        error: 'The original order medicines cannot be locked for an exact stock reversal.',
        code: 'ORDER_ALLOCATION_MISMATCH',
      })
    }

    const allocations = await client.query(
      `SELECT a.order_item_id::int AS "orderItemId",
         a.inventory_batch_id::int AS "batchId",
         i.medicine_id::int AS "medicineId",
         b.medicine_id::int AS "batchMedicineId",
         a.quantity
       FROM order_item_batch_allocations a
       JOIN sales_order_items i ON i.id = a.order_item_id
       JOIN inventory_batches b ON b.id = a.inventory_batch_id
       WHERE i.order_id = $1
       ORDER BY i.medicine_id, b.expiry_date ASC NULLS LAST, b.received_at ASC, b.id ASC
       FOR UPDATE OF a, b`,
      [id],
    )
    const allocatedByItem = new Map()
    const allocatedByMedicine = new Map()
    for (const allocation of allocations.rows) {
      if (allocation.medicineId !== allocation.batchMedicineId) {
        await client.query('ROLLBACK')
        return response.status(409).json({
          error: 'An order allocation points to a different medicine batch.',
          code: 'ORDER_ALLOCATION_MISMATCH',
        })
      }
      allocatedByItem.set(
        allocation.orderItemId,
        (allocatedByItem.get(allocation.orderItemId) ?? 0) + allocation.quantity,
      )
      allocatedByMedicine.set(
        allocation.medicineId,
        (allocatedByMedicine.get(allocation.medicineId) ?? 0) + allocation.quantity,
      )
    }
    if (items.rows.some((item) => allocatedByItem.get(item.id) !== item.quantity)) {
      await client.query('ROLLBACK')
      return response.status(409).json({
        error: 'The original batch allocations do not match the order quantities; no stock was restored.',
        code: 'ORDER_ALLOCATION_MISMATCH',
      })
    }

    for (const allocation of allocations.rows) {
      const restoredBatch = await client.query(
        `UPDATE inventory_batches
         SET quantity_remaining = quantity_remaining + $2
         WHERE id = $1
         RETURNING id`,
        [allocation.batchId, allocation.quantity],
      )
      if (!restoredBatch.rowCount) throw new Error(`Original inventory batch ${allocation.batchId} was not found.`)
      await client.query(
        `INSERT INTO stock_movements
          (medicine_id, inventory_batch_id, movement_type, quantity_change, note)
         VALUES ($1, $2, 'return', $3, $4)`,
        [allocation.medicineId, allocation.batchId, allocation.quantity, `Order ${id} declined: ${reason}`],
      )
    }
    for (const [medicineId, quantity] of allocatedByMedicine) {
      const restoredMedicine = await client.query(
        `UPDATE medicines
         SET stock = stock + $2, updated_at = now()
         WHERE id = $1
         RETURNING id`,
        [medicineId, quantity],
      )
      if (!restoredMedicine.rowCount) throw new Error(`Original medicine ${medicineId} was not found.`)
    }

    const updatedOrder = await client.query(
      `UPDATE sales_orders
       SET status = 'declined', delivery_otp_hash = NULL,
           delivery_code_verifier = NULL, delivery_code_key_version = NULL,
           delivery_failed_attempts = 0, delivery_locked_until = NULL, updated_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [id],
    )
    if (!updatedOrder.rowCount) {
      await client.query('ROLLBACK')
      return response.status(409).json({ error: 'The order is no longer pending.', code: 'ORDER_NOT_PENDING' })
    }
    const declinedEvent = await client.query(
      `INSERT INTO order_status_events
        (order_id, status, actor_user_id, actor_role, actor_name, note)
       VALUES ($1, 'declined', $2, 'pharmacy_owner', $3, $4)
       RETURNING id`,
      [id, request.user.id, request.user.fullName, reason],
    )
    await createOrderNotification(client, {
      eventId: declinedEvent.rows[0].id,
      orderId: id,
      orderNumber: order.rows[0].orderNumber,
      pharmacyId: request.user.pharmacyId,
      recipientRole: 'customer',
      status: 'declined',
      note: reason,
    })
    await client.query(
      `INSERT INTO audit_events (actor, action, entity_type, entity_id, details)
       VALUES ($1, 'order_declined', 'sales_order', $2, $3::jsonb)`,
      [
        request.user.email,
        id,
        JSON.stringify({
          fromStatus: 'pending',
          toStatus: 'declined',
          actorUserId: request.user.id,
          actorRole: 'pharmacy_owner',
          actorName: request.user.fullName,
          reason,
        }),
      ],
    )
    const result = await client.query(
      `${orderSelect} WHERE o.id = $1 AND o.pharmacy_id = $2`,
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
}

app.post('/api/owner/orders/:id/decline', requireOwner, declineOwnerOrder)

app.get('/api/catalog/medicines/:id/reviews', async (request, response, next) => {
  const medicineId = Number(request.params.id)
  if (!Number.isSafeInteger(medicineId) || medicineId < 1) return response.status(400).json({ error: 'Invalid medicine ID.' })
  try {
    const result = await pool.query(
      `SELECT r.id::int AS id, r.rating, r.comment, r.created_at AS "createdAt",
         c.full_name AS "customerName", true AS "verifiedPurchase"
       FROM product_reviews r
       JOIN customers c ON c.id = r.customer_id
       WHERE r.medicine_id = $1
         AND EXISTS (
           SELECT 1 FROM sales_orders o
           WHERE o.id = r.order_id AND o.customer_id = r.customer_id AND o.status = 'delivered'
             AND EXISTS (
               SELECT 1 FROM sales_order_items i
               WHERE i.order_id = o.id AND i.medicine_id = r.medicine_id
             )
         )
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 50`,
      [medicineId],
    )
    const summary = await pool.query(
      `SELECT COALESCE(SUM(rating * review_count)::float8 / NULLIF(SUM(review_count), 0), 0)::float8 AS rating,
         COALESCE(SUM(review_count), 0)::int AS "reviewCount",
         COALESCE(jsonb_object_agg(rating::text, review_count), '{}'::jsonb) AS "ratingDistribution"
       FROM (
         SELECT r.rating, COUNT(*)::int AS review_count
         FROM product_reviews r
         WHERE r.medicine_id = $1
           AND EXISTS (
             SELECT 1 FROM sales_orders o
             WHERE o.id = r.order_id AND o.customer_id = r.customer_id AND o.status = 'delivered'
               AND EXISTS (
                 SELECT 1 FROM sales_order_items i
                 WHERE i.order_id = o.id AND i.medicine_id = r.medicine_id
               )
           )
         GROUP BY r.rating
       ) distribution`,
      [medicineId],
    )
    response.json({ reviews: result.rows, ...summary.rows[0] })
  } catch (error) {
    next(error)
  }
})

app.get('/api/customer/medicines/:id/review-eligibility', requireCustomer, async (request, response, next) => {
  const medicineId = Number(request.params.id)
  if (!Number.isSafeInteger(medicineId) || medicineId < 1) return response.status(400).json({ error: 'Invalid medicine ID.' })
  try {
    const result = await pool.query(
      `SELECT EXISTS (SELECT 1 FROM medicines WHERE id = $2) AS "medicineExists",
         EXISTS (
           SELECT 1
           FROM customers c
           JOIN sales_orders o ON o.customer_id = c.id AND o.status = 'delivered'
           JOIN sales_order_items i ON i.order_id = o.id AND i.medicine_id = $2
           WHERE c.user_account_id = $1
         ) AS eligible,
         (
           SELECT json_build_object(
             'id', r.id::int,
             'orderId', r.order_id::int,
             'rating', r.rating,
             'comment', r.comment
           )
           FROM product_reviews r
           JOIN customers c ON c.id = r.customer_id
           WHERE c.user_account_id = $1 AND r.medicine_id = $2
         ) AS review`,
      [request.user.id, medicineId],
    )
    const eligibility = result.rows[0]
    if (!eligibility.medicineExists) return response.status(404).json({ error: 'Medicine was not found.' })
    response.json({ eligible: eligibility.eligible, review: eligibility.review })
  } catch (error) {
    next(error)
  }
})

app.post('/api/customer/medicines/:id/reviews', requireCustomer, async (request, response, next) => {
  const medicineId = Number(request.params.id)
  const rating = request.body?.rating
  const rawComment = request.body?.comment
  const comment = typeof rawComment === 'string' ? rawComment.trim() : ''
  if (!Number.isSafeInteger(medicineId) || medicineId < 1) return response.status(400).json({ error: 'Invalid medicine ID.' })
  if (typeof rawComment !== 'undefined' && typeof rawComment !== 'string') {
    return response.status(400).json({ error: 'The review comment must be text.' })
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || Array.from(comment).length > 500) {
    return response.status(400).json({ error: 'Choose a 1–5 star rating and keep comments under 500 characters.' })
  }
  try {
    const eligible = await pool.query(
      `SELECT c.id::int AS "customerId", o.id::int AS "orderId"
       FROM customers c
       JOIN sales_orders o ON o.customer_id = c.id AND o.status = 'delivered'
       JOIN sales_order_items i ON i.order_id = o.id AND i.medicine_id = $2
       WHERE c.user_account_id = $1
       ORDER BY o.created_at DESC, o.id DESC
       LIMIT 1`,
      [request.user.id, medicineId],
    )
    if (!eligible.rowCount) {
      const medicine = await pool.query('SELECT 1 FROM medicines WHERE id = $1', [medicineId])
      if (!medicine.rowCount) return response.status(404).json({ error: 'Medicine was not found.' })
      return response.status(403).json({ error: 'Product reviews are available after your order containing this medicine is delivered.' })
    }
    const result = await pool.query(
      `INSERT INTO product_reviews (medicine_id, customer_id, order_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (medicine_id, customer_id) DO UPDATE SET
         order_id = EXCLUDED.order_id, rating = EXCLUDED.rating,
         comment = EXCLUDED.comment, updated_at = now()
       RETURNING id::int AS id, order_id::int AS "orderId", rating, comment,
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [medicineId, eligible.rows[0].customerId, eligible.rows[0].orderId, rating, comment],
    )
    response.status(201).json(result.rows[0])
  } catch (error) {
    next(error)
  }
})

async function purgeExpiredPrescriptionFiles() {
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')
    const expired = await client.query(
      `SELECT id, storage_key
       FROM prescriptions
       WHERE storage_key IS NOT NULL AND retention_until <= CURRENT_DATE
       ORDER BY retention_until, id
       LIMIT 50
       FOR UPDATE SKIP LOCKED`,
    )
    for (const prescription of expired.rows) {
      try {
        await unlink(await ensurePrivatePrescriptionStorage(prescription.storage_key))
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      await client.query(
        `UPDATE prescriptions
         SET storage_key = NULL, file_sha256 = NULL, original_filename = 'deleted',
             document_deleted_at = now()
         WHERE id = $1`,
        [prescription.id],
      )
      await client.query(
        `INSERT INTO audit_events (actor, action, entity_type, entity_id, details)
         VALUES ('system', 'prescription_document_deleted', 'prescription', $1, $2)`,
        [prescription.id, JSON.stringify({ retentionPolicy: '30 days after prescription expiry or final decision' })],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    if (client) await client.query('ROLLBACK')
    throw error
  } finally {
    client?.release()
  }
}

app.use((error, _request, response, _next) => {
  console.error('Pharma Plus API error:', error)
  if (error instanceof multer.MulterError) {
    const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    return response.status(status).json({
      error: error.code === 'LIMIT_FILE_SIZE'
        ? 'Prescription files must be 5 MB or smaller.'
        : 'Upload one prescription file with a valid medicine list.',
    })
  }
  if (error.type === 'entity.too.large') {
    return response.status(413).json({ error: 'Product images must be 5 MB or smaller.' })
  }
  if (error.status === 404) {
    return response.status(404).json({ error: 'The requested product image was not found.' })
  }
  if (error.code === '23505') {
    return response.status(409).json({ error: 'That SKU or category already exists.' })
  }
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500
  response.status(status).json({
    error: status === 500
      ? 'The request could not be completed. Check the API logs for details.'
      : error.message,
  })
})

const distPath = fileURLToPath(new URL('../dist/', import.meta.url))
app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API endpoint not found.' })
})
app.use(express.static(distPath))
app.get(/.*/, (_request, response, next) => {
  response.sendFile(fileURLToPath(new URL('../dist/index.html', import.meta.url)), (error) => {
    if (error) next()
  })
})

async function prepareDeliveryCodes() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const activeOrders = await client.query(
      `SELECT id::int AS id
       FROM sales_orders
       WHERE status NOT IN ('delivered', 'declined', 'cancelled')
         AND (delivery_code_verifier IS NULL OR delivery_code_key_version IS NULL)
       ORDER BY id
       FOR UPDATE`,
    )
    for (const { id } of activeOrders.rows) {
      const code = deriveDeliveryCode(deliveryCodeKeyRing, id)
      await client.query(
        `UPDATE sales_orders
         SET delivery_code_verifier = $2, delivery_code_key_version = $3
         WHERE id = $1`,
        [id, createDeliveryCodeVerifier(deliveryCodeKeyRing, id, code), deliveryCodeKeyRing.currentVersion],
      )
    }
    await client.query(
      `UPDATE sales_orders
       SET delivery_otp_hash = NULL
       WHERE delivery_otp_hash IS NOT NULL`,
    )
    const storedVersions = await client.query(
      `SELECT DISTINCT delivery_code_key_version AS version
       FROM sales_orders
       WHERE status NOT IN ('delivered', 'declined', 'cancelled')
         AND delivery_code_key_version IS NOT NULL`,
    )
    for (const { version } of storedVersions.rows) {
      if (!deliveryCodeKeyRing.keys.has(version)) {
        throw new Error(`DELIVERY_CODE_PREVIOUS_KEYS must retain key version "${version}" for active orders.`)
      }
    }
    await client.query('COMMIT')
  } catch (error) {
    await rollbackTransaction(client)
    throw error
  } finally {
    client.release()
  }
}

async function processMedicineAlerts() {
  let client
  try {
    client = await pool.connect()
    await client.query('BEGIN')

    const reminders = await client.query(
      `SELECT r.id, r.customer_account_id AS "customerId", r.medicine_id AS "medicineId",
         r.pharmacy_id AS "pharmacyId", r.interval_days AS "intervalDays",
         m.name AS "medicineName", p.name AS "pharmacyName"
       FROM medicine_reminders r
       JOIN medicines m ON m.id = r.medicine_id
       JOIN pharmacies p ON p.id = r.pharmacy_id
       JOIN user_accounts u ON u.id = r.customer_account_id
       LEFT JOIN customer_settings cs ON cs.user_account_id = r.customer_account_id
       WHERE r.opt_in AND r.cancelled_at IS NULL
         AND r.next_reminder_date <= CURRENT_DATE
         AND COALESCE(cs.medicine_notifications_enabled, true)
         AND m.is_active AND p.approval_status = 'approved'
       ORDER BY r.next_reminder_date, r.id
       LIMIT 100
       FOR UPDATE OF r SKIP LOCKED`,
    )
    for (const reminder of reminders.rows) {
      await client.query(
        `INSERT INTO medicine_alert_events
           (customer_account_id, medicine_id, pharmacy_id, alert_type, status, reason)
         VALUES ($1, $2, $3, 'refill_reminder', 'sent',
                 'Opt-in refill reminder; no automatic order or medication advice')`,
        [reminder.customerId, reminder.medicineId, reminder.pharmacyId],
      )
      await client.query(
        `INSERT INTO notifications
           (recipient_user_id, recipient_role, pharmacy_id, type, reference_type, reference_id,
            title, message)
         VALUES ($1, 'customer', $2, 'refill_reminder', 'medicine', $3,
                 'Refill reminder',
                 $4)
         ON CONFLICT DO NOTHING`,
        [
          reminder.customerId,
          reminder.pharmacyId,
          reminder.medicineId,
          `${reminder.medicineName} at ${reminder.pharmacyName} may be due for a refill. Open the current catalog to check availability.`,
        ],
      )
      await client.query(
        `UPDATE medicine_reminders
         SET last_sent_at = now(),
             next_reminder_date = (CURRENT_DATE + make_interval(days => interval_days)),
             updated_at = now()
         WHERE id = $1`,
        [reminder.id],
      )
    }

    const stockAlerts = await client.query(
      `SELECT s.id, s.customer_account_id AS "customerId", s.medicine_id AS "medicineId",
         s.pharmacy_id AS "pharmacyId", m.name AS "medicineName", p.name AS "pharmacyName",
         ${availableStockExpression}::int AS "availableStock"
       FROM stock_alert_subscriptions s
       JOIN medicines m ON m.id = s.medicine_id
       JOIN pharmacies p ON p.id = s.pharmacy_id
       JOIN user_accounts u ON u.id = s.customer_account_id
       LEFT JOIN customer_settings cs ON cs.user_account_id = s.customer_account_id
       WHERE s.active AND s.cancelled_at IS NULL
         AND COALESCE(cs.medicine_notifications_enabled, true)
         AND m.is_active AND p.approval_status = 'approved'
       ORDER BY s.id
       LIMIT 100
       FOR UPDATE OF s SKIP LOCKED`,
    )
    for (const alert of stockAlerts.rows) {
      if (alert.availableStock < 1) continue
      await client.query(
        `INSERT INTO medicine_alert_events
           (customer_account_id, medicine_id, pharmacy_id, alert_type, status, reason)
         VALUES ($1, $2, $3, 'stock_available', 'sent',
                 'Sellable stock became available')`,
        [alert.customerId, alert.medicineId, alert.pharmacyId],
      )
      await client.query(
        `INSERT INTO notifications
           (recipient_user_id, recipient_role, pharmacy_id, type, reference_type, reference_id,
            title, message)
         VALUES ($1, 'customer', $2, 'stock_available', 'medicine', $3,
                 'Medicine available',
                 $4)
         ON CONFLICT DO NOTHING`,
        [
          alert.customerId,
          alert.pharmacyId,
          alert.medicineId,
          `${alert.medicineName} is currently in stock at ${alert.pharmacyName}. Open the catalog to recheck availability and prescription requirements.`,
        ],
      )
      await client.query(
        `UPDATE stock_alert_subscriptions
         SET active = false, last_sent_at = now(), updated_at = now()
         WHERE id = $1`,
        [alert.id],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    if (client) await rollbackTransaction(client)
    console.error('Medicine reminder/stock alert check failed:', error)
  } finally {
    client?.release()
  }
}

try {
  await ensureAdminAccount()
  await pool.query('SELECT 1')
  void purgeExpiredPrescriptionFiles().catch((error) => console.error('Prescription retention cleanup failed:', error))
  const retentionTimer = setInterval(
    () => void purgeExpiredPrescriptionFiles().catch((error) => console.error('Prescription retention cleanup failed:', error)),
    60 * 60 * 1000,
  )
  retentionTimer.unref()
  await prepareDeliveryCodes()
  const reminderTimer = setInterval(
    () => void processMedicineAlerts(),
    60 * 1000,
  )
  reminderTimer.unref()
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
