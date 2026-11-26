import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const schema = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8')
const databaseName = `pharma_order_test_${process.pid}_${Date.now()}`
const testDeliverySecret = 'order-test-delivery-secret-at-least-32-bytes'
const adminPool = new pg.Pool({
  host: process.env.PGHOST || '/tmp',
  port: Number(process.env.PGPORT || 5432),
  database: 'postgres',
  user: process.env.PGUSER || process.env.USER,
  password: process.env.PGPASSWORD || undefined,
  connectionTimeoutMillis: 3000,
})
let testPool
let apiProcess
let apiBaseUrl
let apiOutput = ''
let ownerSession
let customerSession
let secondCustomerSession

async function findAvailablePort() {
  const listener = createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const { port } = listener.address()
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
  return port
}

async function apiRequest(path, { token, method = 'GET', body, idempotencyKey } = {}) {
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey)
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { response, body: response.status === 204 ? null : await response.json() }
}

async function createSession(role, suffix) {
  const { response, body } = await apiRequest('/api/auth/signup', {
    method: 'POST',
    body: {
      role,
      email: `${role}-${suffix}@example.test`,
      password: 'order-test-password-2026',
      fullName: `Order Test ${suffix}`,
      phone: `91${String(process.pid).slice(-5)}${suffix === 'owner' ? '1' : suffix === 'customer' ? '2' : '3'}`,
      ...(role === 'pharmacy_owner' ? { pharmacyName: `Order Test Pharmacy ${suffix}` } : {
        address: '10 Test Street',
        city: 'Test City',
        state: 'Test State',
        postalCode: '600001',
      }),
    },
  })
  assert.equal(response.status, 201, body?.error)
  return body
}

async function createMedicine({
  name,
  stock,
  price = 10,
  expiry = '2035-01-01',
  prescriptionRequired = false,
  batchNumber = `B-${name.replaceAll(' ', '-')}`,
}) {
  const { response, body } = await apiRequest('/api/medicines', {
    token: ownerSession.token,
    method: 'POST',
    body: {
      name,
      category: 'Tablets',
      pack: '10 tablets',
      sku: `SKU-${name.replaceAll(' ', '-')}-${process.pid}`,
      brandName: name,
      genericName: `Generic ${name}`,
      strength: '10 mg',
      dosageForm: 'Tablet',
      packQuantity: 10,
      packUnit: 'tablets',
      price,
      stock,
      expiry,
      batchNumber,
      prescriptionRequired,
    },
  })
  assert.equal(response.status, 201, `${body?.error ?? ''}\n${apiOutput}`)
  return body
}

function orderBody(medicine, quantity = 1, unitPrice = medicine.price) {
  return {
    pharmacyId: medicine.pharmacyId,
    items: [{ medicineId: medicine.id, quantity, unitPrice }],
    paymentMethod: 'Cash on Delivery',
  }
}

async function waitForApi() {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null || apiProcess.signalCode !== null) {
      throw new Error(`Order API exited early (code ${apiProcess.exitCode}, signal ${apiProcess.signalCode}): ${apiOutput}`)
    }
    try {
      const response = await fetch(`${apiBaseUrl}/api/health`)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  throw new Error(`Order API did not become ready (pid ${apiProcess.pid}): ${apiOutput}`)
}

async function startApiServer(deliveryCodeEnv = {}) {
  const port = await findAvailablePort()
  apiBaseUrl = `http://127.0.0.1:${port}`
  apiOutput = ''
  apiProcess = spawn(process.execPath, [fileURLToPath(new URL('./index.mjs', import.meta.url))], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PGDATABASE: databaseName,
      API_PORT: String(port),
      MOBILE_LAN: '0',
      DELIVERY_CODE_SECRET: testDeliverySecret,
      DELIVERY_CODE_KEY_VERSION: 'test-v1',
      DELIVERY_CODE_PREVIOUS_KEYS: '{}',
      ...deliveryCodeEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  apiProcess.stdout.on('data', (chunk) => { apiOutput += chunk.toString() })
  apiProcess.stderr.on('data', (chunk) => { apiOutput += chunk.toString() })
  await waitForApi()
}

before(async () => {
  await adminPool.query(`CREATE DATABASE "${databaseName}"`)
  testPool = new pg.Pool({
    host: process.env.PGHOST || '/tmp',
    port: Number(process.env.PGPORT || 5432),
    database: databaseName,
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || undefined,
  })
  await testPool.query(schema)
  await testPool.query(schema)

  await startApiServer()

  ownerSession = await createSession('pharmacy_owner', 'owner')
  customerSession = await createSession('customer', 'customer')
  secondCustomerSession = await createSession('customer', 'second')
})

after(async () => {
  if (apiProcess && apiProcess.exitCode === null && apiProcess.signalCode === null) {
    apiProcess.kill('SIGTERM')
    await Promise.race([
      once(apiProcess, 'exit'),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ])
  }
  await testPool?.end()
  await adminPool.query(
    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1',
    [databaseName],
  )
  await adminPool.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
  await adminPool.end()
})

test('concurrent customers cannot oversell and identical retries create one order', async () => {
  const scarceMedicine = await createMedicine({ name: 'Concurrent Strip', stock: 1 })
  const requests = [
    apiRequest('/api/orders', {
      token: customerSession.token,
      method: 'POST',
      body: orderBody(scarceMedicine),
      idempotencyKey: randomUUID(),
    }),
    apiRequest('/api/orders', {
      token: secondCustomerSession.token,
      method: 'POST',
      body: orderBody(scarceMedicine),
      idempotencyKey: randomUUID(),
    }),
  ]
  const competingResults = await Promise.all(requests)
  assert.deepEqual(competingResults.map(({ response }) => response.status).sort(), [201, 409])
  const winningOrder = competingResults.find(({ response }) => response.status === 201).body

  const replayMedicine = await createMedicine({ name: 'Idempotent Strip', stock: 2, price: 12.35 })
  const retryKey = randomUUID()
  const retryRequests = [1, 2].map(() => apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(replayMedicine),
    idempotencyKey: retryKey,
  }))
  const retryResults = await Promise.all(retryRequests)
  assert.deepEqual(retryResults.map(({ response }) => response.status).sort(), [200, 201])
  assert.equal(retryResults[0].body.id, retryResults[1].body.id)

  const stock = await testPool.query(
    `SELECT m.id::int AS id, m.stock, SUM(b.quantity_remaining)::int AS "batchStock",
       COUNT(DISTINCT o.id)::int AS "orderCount",
       COUNT(DISTINCT i.id)::int AS "itemCount",
       SUM(a.quantity)::int AS "allocatedQuantity"
     FROM medicines m
     JOIN inventory_batches b ON b.medicine_id = m.id
     LEFT JOIN sales_order_items i ON i.medicine_id = m.id
     LEFT JOIN sales_orders o ON o.id = i.order_id
     LEFT JOIN order_item_batch_allocations a ON a.order_item_id = i.id
     WHERE m.id = ANY($1::bigint[])
     GROUP BY m.id`,
    [[scarceMedicine.id, replayMedicine.id]],
  )
  assert.equal(stock.rowCount, 2)
  const byMedicine = new Map(stock.rows.map((row) => [row.id, row]))
  assert.equal(byMedicine.get(scarceMedicine.id).stock, 0)
  assert.equal(byMedicine.get(scarceMedicine.id).batchStock, 0)
  assert.equal(byMedicine.get(scarceMedicine.id).orderCount, 1)
  assert.equal(byMedicine.get(replayMedicine.id).stock, 1)
  assert.equal(byMedicine.get(replayMedicine.id).batchStock, 1)
  assert.equal(byMedicine.get(replayMedicine.id).orderCount, 1)
  assert.equal(byMedicine.get(replayMedicine.id).itemCount, 1)
  assert.equal(byMedicine.get(replayMedicine.id).allocatedQuantity, 1)

  const customerOrder = await apiRequest(`/api/orders/${winningOrder.id}`, { token: customerSession.token })
  assert.equal(customerOrder.response.status, 200)
  const hiddenOrder = await apiRequest(`/api/orders/${winningOrder.id}`, { token: secondCustomerSession.token })
  assert.equal(hiddenOrder.response.status, 404)
  const ownerOrder = await apiRequest(`/api/orders/${winningOrder.id}`, { token: ownerSession.token })
  assert.equal(ownerOrder.response.status, 200)

  await assert.rejects(
    testPool.query(
      'UPDATE sales_order_items SET unit_price = unit_price + 1 WHERE order_id = $1',
      [retryResults[0].body.id],
    ),
    /immutable/,
  )
})

test('order notifications are role-scoped, deduplicated, timestamped, and mark as read', async () => {
  const medicine = await createMedicine({ name: 'Notification Strip', stock: 4 })
  const idempotencyKey = randomUUID()
  const orderRequest = () => apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(medicine),
    idempotencyKey,
  })
  const placed = await orderRequest()
  assert.equal(placed.response.status, 201, placed.body?.error)
  const replay = await orderRequest()
  assert.equal(replay.response.status, 200, replay.body?.error)
  assert.equal(replay.body.id, placed.body.id)

  const orderNotifications = (result) =>
    result.body.notifications.filter((notification) => notification.referenceId === placed.body.id)
  const ownerInbox = await apiRequest('/api/owner/notifications', { token: ownerSession.token })
  assert.equal(ownerInbox.response.status, 200)
  const placedNotifications = orderNotifications(ownerInbox)
  assert.equal(placedNotifications.length, 1)
  assert.equal(placedNotifications[0].type, 'order_placed')
  assert.equal(placedNotifications[0].eventStatus, 'pending')
  assert.equal(placedNotifications[0].currentStatus, 'pending')
  assert.ok(placedNotifications[0].eventTime)
  const ownerNotificationId = placedNotifications[0].id

  const customerInboxBeforeUpdate = await apiRequest('/api/me/notifications', { token: customerSession.token })
  assert.equal(customerInboxBeforeUpdate.response.status, 200)
  assert.equal(orderNotifications(customerInboxBeforeUpdate).length, 0)
  const hiddenOwnerInbox = await apiRequest('/api/owner/notifications', { token: customerSession.token })
  assert.equal(hiddenOwnerInbox.response.status, 403)
  const hiddenRead = await apiRequest(`/api/me/notifications/${ownerNotificationId}`, {
    token: customerSession.token,
    method: 'PATCH',
  })
  assert.equal(hiddenRead.response.status, 404)

  const markOwnerRead = () => apiRequest(`/api/owner/notifications/${ownerNotificationId}`, {
    token: ownerSession.token,
    method: 'PATCH',
  })
  const markedOwnerRead = await markOwnerRead()
  assert.equal(markedOwnerRead.response.status, 200)
  assert.equal(markedOwnerRead.body.isRead, true)
  assert.equal((await markOwnerRead()).body.isRead, true)

  const accepted = await apiRequest(`/api/owner/orders/${placed.body.id}/transition`, {
    token: ownerSession.token,
    method: 'POST',
    body: { status: 'accepted', expectedStatus: 'pending' },
  })
  assert.equal(accepted.response.status, 200, accepted.body?.error)
  const customerInbox = await apiRequest('/api/me/notifications', { token: customerSession.token })
  const statusNotifications = orderNotifications(customerInbox)
  assert.equal(statusNotifications.length, 1)
  assert.equal(statusNotifications[0].eventStatus, 'accepted')
  assert.equal(statusNotifications[0].currentStatus, 'accepted')
  assert.match(statusNotifications[0].message, /now accepted/)

  const unauthorizedRead = await apiRequest(`/api/me/notifications/${statusNotifications[0].id}`, {
    token: secondCustomerSession.token,
    method: 'PATCH',
  })
  assert.equal(unauthorizedRead.response.status, 404)
  const markedCustomerRead = await apiRequest(`/api/me/notifications/${statusNotifications[0].id}`, {
    token: customerSession.token,
    method: 'PATCH',
  })
  assert.equal(markedCustomerRead.response.status, 200)
  assert.equal(markedCustomerRead.body.isRead, true)

  const staleTransition = await apiRequest(`/api/owner/orders/${placed.body.id}/transition`, {
    token: ownerSession.token,
    method: 'POST',
    body: { status: 'accepted', expectedStatus: 'pending' },
  })
  assert.equal(staleTransition.response.status, 409)
  const afterStaleTransition = await apiRequest('/api/me/notifications', { token: customerSession.token })
  assert.equal(orderNotifications(afterStaleTransition).length, 1)

  const declinedOrder = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(medicine),
    idempotencyKey: randomUUID(),
  })
  assert.equal(declinedOrder.response.status, 201, declinedOrder.body?.error)
  const decline = () => apiRequest(`/api/owner/orders/${declinedOrder.body.id}/decline`, {
    token: ownerSession.token,
    method: 'POST',
    body: { reason: 'Item is temporarily unavailable.' },
  })
  assert.equal((await decline()).response.status, 200)
  assert.equal((await decline()).body.idempotentReplay, true)
  const customerInboxAfterDecline = await apiRequest('/api/me/notifications', { token: customerSession.token })
  const declineNotifications = customerInboxAfterDecline.body.notifications.filter(
    (notification) => notification.referenceId === declinedOrder.body.id,
  )
  assert.equal(declineNotifications.length, 1)
  assert.equal(declineNotifications[0].eventStatus, 'declined')
  assert.match(declineNotifications[0].message, /temporarily unavailable/)
})

test('order creation rejects changed prices, expired batches and Rx-only products', async () => {
  const cases = [
    {
      medicine: await createMedicine({ name: 'Changed Price', stock: 3, price: 15 }),
      expectedPrice: 14,
      status: 409,
      code: 'PRICE_CHANGED',
    },
    {
      medicine: await createMedicine({ name: 'Expired Batch', stock: 3, expiry: '2020-01-01' }),
      expectedPrice: 10,
      status: 409,
      code: 'INSUFFICIENT_UNEXPIRED_STOCK',
    },
    {
      medicine: await createMedicine({ name: 'Prescription Gate', stock: 3, prescriptionRequired: true }),
      expectedPrice: 10,
      status: 403,
      code: 'PRESCRIPTION_REQUIRED',
    },
  ]

  for (const { medicine, expectedPrice, status, code } of cases) {
    const { response, body } = await apiRequest('/api/orders', {
      token: customerSession.token,
      method: 'POST',
      body: orderBody(medicine, 1, expectedPrice),
      idempotencyKey: randomUUID(),
    })
    assert.equal(response.status, status, body?.error)
    assert.equal(body.code, code)
    const unchanged = await testPool.query(
      `SELECT m.stock, SUM(b.quantity_remaining)::int AS "batchStock"
       FROM medicines m JOIN inventory_batches b ON b.medicine_id = m.id
       WHERE m.id = $1 GROUP BY m.id`,
      [medicine.id],
    )
    assert.equal(unchanged.rows[0].stock, 3)
    assert.equal(unchanged.rows[0].batchStock, 3)
  }
})

test('owner transitions enforce gates and record authorized timeline and audit events', async () => {
  const medicine = await createMedicine({ name: 'Transition Strip', stock: 3 })
  const placed = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(medicine),
    idempotencyKey: randomUUID(),
  })
  assert.equal(placed.response.status, 201, placed.body?.error)
  const { id } = placed.body
  assert.equal(Object.hasOwn(placed.body, 'deliveryOtp'), false)

  const getEvents = (token) => apiRequest(`/api/me/orders/${id}/events`, { token })
  const transition = (status, expectedStatus, note = '') => apiRequest(`/api/owner/orders/${id}/transition`, {
    token: ownerSession.token,
    method: 'POST',
    body: { status, expectedStatus, note },
  })

  const hiddenEvents = await getEvents(secondCustomerSession.token)
  assert.equal(hiddenEvents.response.status, 404)
  const hiddenCode = await apiRequest(`/api/me/orders/${id}/delivery-code`, { token: secondCustomerSession.token })
  assert.equal(hiddenCode.response.status, 404)

  const skipped = await transition('preparing', 'pending')
  assert.equal(skipped.response.status, 409)
  assert.equal(skipped.body.code, 'ORDER_STATUS_CONFLICT')

  const accepted = await transition('accepted', 'pending', 'Stock confirmed')
  assert.equal(accepted.response.status, 200, accepted.body?.error)
  const stale = await transition('accepted', 'pending')
  assert.equal(stale.response.status, 409)
  assert.equal(stale.body.currentStatus, 'accepted')

  for (const [status, expectedStatus] of [
    ['preparing', 'accepted'],
    ['ready', 'preparing'],
    ['out_for_delivery', 'ready'],
  ]) {
    const result = await transition(status, expectedStatus)
    assert.equal(result.response.status, 200, result.body?.error)
  }

  const unavailableCode = await apiRequest(`/api/me/orders/${id}/delivery-code`, { token: customerSession.token })
  assert.equal(unavailableCode.response.status, 200)
  const reloadedCode = await apiRequest(`/api/me/orders/${id}/delivery-code`, { token: customerSession.token })
  assert.equal(reloadedCode.body.code, unavailableCode.body.code)
  const ownerOrders = await apiRequest('/api/owner/orders', { token: ownerSession.token })
  assert.equal(ownerOrders.response.status, 200)
  assert.equal(JSON.stringify(ownerOrders.body).includes(unavailableCode.body.code), false)
  assert.equal(JSON.stringify(ownerOrders.body).includes('delivery_code_verifier'), false)

  const withoutCode = await apiRequest(`/api/owner/orders/${id}/transition`, {
    token: ownerSession.token,
    method: 'POST',
    body: { status: 'delivered', expectedStatus: 'out_for_delivery' },
  })
  assert.equal(withoutCode.response.status, 409)

  const previousServer = apiProcess
  const serverStopped = once(previousServer, 'exit')
  previousServer.kill('SIGTERM')
  await serverStopped
  await startApiServer({
    DELIVERY_CODE_SECRET: 'rotated-test-delivery-secret-at-least-32-bytes',
    DELIVERY_CODE_KEY_VERSION: 'test-v2',
    DELIVERY_CODE_PREVIOUS_KEYS: JSON.stringify({ 'test-v1': testDeliverySecret }),
  })
  const freshLogin = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: {
      email: 'customer-customer@example.test',
      password: 'order-test-password-2026',
      role: 'customer',
    },
  })
  assert.equal(freshLogin.response.status, 200)
  customerSession = freshLogin.body
  const afterReloginCode = await apiRequest(`/api/me/orders/${id}/delivery-code`, { token: freshLogin.body.token })
  assert.equal(afterReloginCode.body.code, unavailableCode.body.code)
  const secondCustomerLogin = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: {
      email: 'customer-second@example.test',
      password: 'order-test-password-2026',
      role: 'customer',
    },
  })
  assert.equal(secondCustomerLogin.response.status, 200)
  secondCustomerSession = secondCustomerLogin.body
  const freshOwnerLogin = await apiRequest('/api/auth/login', {
    method: 'POST',
    body: {
      email: 'pharmacy_owner-owner@example.test',
      password: 'order-test-password-2026',
      role: 'pharmacy_owner',
    },
  })
  assert.equal(freshOwnerLogin.response.status, 200)
  ownerSession = freshOwnerLogin.body

  const delivered = await apiRequest(`/api/owner/orders/${id}/verify-delivery`, {
    token: ownerSession.token,
    method: 'POST',
    body: { code: unavailableCode.body.code },
  })
  assert.equal(delivered.response.status, 200, delivered.body?.error)
  const customerNotifications = await apiRequest('/api/me/notifications', { token: customerSession.token })
  const orderNotifications = customerNotifications.body.notifications.filter((notification) => notification.referenceId === id)
  assert.deepEqual(orderNotifications.map((notification) => notification.eventStatus), [
    'delivered', 'out_for_delivery', 'ready', 'preparing', 'accepted',
  ])
  assert.ok(orderNotifications.every((notification) => notification.currentStatus === 'delivered'))

  const events = await getEvents(customerSession.token)
  assert.equal(events.response.status, 200)
  assert.deepEqual(events.body.map((event) => event.status), [
    'pending', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'delivered',
  ])
  assert.equal(events.body[0].actorRole, 'customer')
  assert.equal(events.body[0].actorName, customerSession.user.fullName)
  assert.equal(events.body[1].actorRole, 'pharmacy_owner')
  assert.equal(events.body[1].actorName, ownerSession.user.fullName)
  assert.equal(events.body[1].note, 'Stock confirmed')
  assert.ok(events.body.every((event) => event.createdAt))

  const audit = await testPool.query(
    `SELECT actor, action, entity_type, entity_id, details
     FROM audit_events
     WHERE entity_type = 'sales_order' AND entity_id = $1 AND action = 'order_status_transition'
     ORDER BY id`,
    [id],
  )
  assert.equal(audit.rowCount, 4)
  assert.ok(audit.rows.every((event) => event.action === 'order_status_transition'))
  assert.equal(audit.rows[0].actor, ownerSession.user.email)
  assert.equal(audit.rows[0].details.fromStatus, 'pending')
  assert.equal(audit.rows[0].details.toStatus, 'accepted')
})

test('delivery verification limits wrong codes, locks attempts, and records no supplied code', async () => {
  const medicine = await createMedicine({ name: 'Delivery Lockout Strip', stock: 2 })
  const placed = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(medicine),
    idempotencyKey: randomUUID(),
  })
  assert.equal(placed.response.status, 201, placed.body?.error)
  const { id } = placed.body
  for (const [status, expectedStatus] of [
    ['accepted', 'pending'],
    ['preparing', 'accepted'],
    ['ready', 'preparing'],
    ['out_for_delivery', 'ready'],
  ]) {
    const transition = await apiRequest(`/api/owner/orders/${id}/transition`, {
      token: ownerSession.token,
      method: 'POST',
      body: { status, expectedStatus },
    })
    assert.equal(transition.response.status, 200, transition.body?.error)
  }
  const customerCode = await apiRequest(`/api/me/orders/${id}/delivery-code`, { token: customerSession.token })
  assert.equal(customerCode.response.status, 200)

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const invalid = await apiRequest(`/api/owner/orders/${id}/verify-delivery`, {
      token: ownerSession.token,
      method: 'POST',
      body: { code: customerCode.body.code === '000000' ? '999999' : '000000' },
    })
    assert.equal(invalid.response.status, 401)
    assert.equal(invalid.body.attemptsRemaining, 5 - attempt)
  }
  const locked = await apiRequest(`/api/owner/orders/${id}/verify-delivery`, {
    token: ownerSession.token,
    method: 'POST',
    body: { code: customerCode.body.code },
  })
  assert.equal(locked.response.status, 429)
  assert.equal(locked.body.code, 'DELIVERY_CODE_LOCKED')

  const audit = await testPool.query(
    `SELECT action, details::text AS details
     FROM audit_events
     WHERE entity_type = 'sales_order' AND entity_id = $1
       AND action IN ('delivery_verification_failed', 'delivery_verification_locked')`,
    [id],
  )
  assert.equal(audit.rowCount, 6)
  assert.equal(JSON.stringify(audit.rows).includes(customerCode.body.code), false)
  const attempts = await testPool.query(
    `SELECT outcome, failed_attempts AS "failedAttempts"
     FROM delivery_verification_attempts WHERE order_id = $1 ORDER BY id`,
    [id],
  )
  assert.deepEqual(attempts.rows.map((attempt) => attempt.outcome), [
    'failed', 'failed', 'failed', 'failed', 'failed', 'locked',
  ])
  assert.equal(attempts.rows[4].failedAttempts, 5)

  await testPool.query(
    `UPDATE sales_orders
     SET delivery_locked_until = now() - interval '1 second'
     WHERE id = $1`,
    [id],
  )
  const delivered = await apiRequest(`/api/owner/orders/${id}/verify-delivery`, {
    token: ownerSession.token,
    method: 'POST',
    body: { code: customerCode.body.code },
  })
  assert.equal(delivered.response.status, 200, delivered.body?.error)
  assert.equal(delivered.body.status, 'delivered')
  const secrets = await testPool.query(
    `SELECT delivery_otp_hash, delivery_code_verifier, delivery_code_key_version
     FROM sales_orders WHERE id = $1`,
    [id],
  )
  assert.deepEqual(secrets.rows[0], {
    delivery_otp_hash: null,
    delivery_code_verifier: null,
    delivery_code_key_version: null,
  })
})

test('orders allocate FEFO across batches and decline restores those same batches', async () => {
  const medicine = await createMedicine({ name: 'FEFO Strip', stock: 4, price: 8 })
  await testPool.query(
    `UPDATE inventory_batches
     SET quantity_received = 0, quantity_remaining = 0
     WHERE medicine_id = $1`,
    [medicine.id],
  )
  await testPool.query('UPDATE medicines SET stock = 4 WHERE id = $1', [medicine.id])
  await testPool.query(
    `INSERT INTO inventory_batches
      (medicine_id, batch_number, quantity_received, quantity_remaining, expiry_date)
     VALUES ($1, 'FEFO-EARLY', 2, 2, '2030-01-01'),
            ($1, 'FEFO-LATE', 2, 2, '2032-01-01')`,
    [medicine.id],
  )

  const { response, body } = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(medicine, 3),
    idempotencyKey: randomUUID(),
  })
  assert.equal(response.status, 201, body?.error)
  const allocations = await testPool.query(
    `SELECT b.batch_number AS "batchNumber", a.quantity
     FROM order_item_batch_allocations a
     JOIN inventory_batches b ON b.id = a.inventory_batch_id
     JOIN sales_order_items i ON i.id = a.order_item_id
     WHERE i.order_id = $1
     ORDER BY b.expiry_date`,
    [body.id],
  )
  assert.deepEqual(allocations.rows, [
    { batchNumber: 'FEFO-EARLY', quantity: 2 },
    { batchNumber: 'FEFO-LATE', quantity: 1 },
  ])
  const missingReason = await apiRequest(`/api/owner/orders/${body.id}/decline`, {
    token: ownerSession.token,
    method: 'POST',
    body: {},
  })
  assert.equal(missingReason.response.status, 400)

  const reason = 'Unable to fulfill this order today.'
  const declines = await Promise.all([1, 2].map(() => apiRequest(`/api/owner/orders/${body.id}/decline`, {
    token: ownerSession.token,
    method: 'POST',
    body: { reason },
  })))
  assert.deepEqual(declines.map(({ response }) => response.status), [200, 200])
  assert.equal(declines.filter(({ body: result }) => result.idempotentReplay).length, 1)
  const restored = await testPool.query(
    `SELECT m.stock, b.batch_number AS "batchNumber", b.quantity_remaining AS "quantityRemaining"
     FROM medicines m JOIN inventory_batches b ON b.medicine_id = m.id
     WHERE m.id = $1 ORDER BY b.batch_number`,
    [medicine.id],
  )
  const quantities = new Map(restored.rows.map((row) => [row.batchNumber, row.quantityRemaining]))
  assert.equal(restored.rows[0].stock, 4)
  assert.equal(quantities.get('FEFO-EARLY'), 2)
  assert.equal(quantities.get('FEFO-LATE'), 2)
  const movement = await testPool.query(
    `SELECT movement_type AS type, SUM(quantity_change)::int AS quantity
     FROM stock_movements WHERE medicine_id = $1
     GROUP BY movement_type`,
    [medicine.id],
  )
  const movementTotals = new Map(movement.rows.map((row) => [row.type, row.quantity]))
  assert.equal(movementTotals.get('sale'), -3)
  assert.equal(movementTotals.get('return'), 3)
  const returnMovements = await testPool.query(
    `SELECT b.batch_number AS "batchNumber", sm.quantity_change AS quantity, sm.note
     FROM stock_movements sm
     JOIN inventory_batches b ON b.id = sm.inventory_batch_id
     WHERE sm.movement_type = 'return' AND sm.note = $1
     ORDER BY b.expiry_date`,
    [`Order ${body.id} declined: ${reason}`],
  )
  assert.deepEqual(returnMovements.rows, [
    { batchNumber: 'FEFO-EARLY', quantity: 2, note: `Order ${body.id} declined: ${reason}` },
    { batchNumber: 'FEFO-LATE', quantity: 1, note: `Order ${body.id} declined: ${reason}` },
  ])
  const declineEvents = await testPool.query(
    `SELECT status, note, actor_role AS "actorRole"
     FROM order_status_events
     WHERE order_id = $1 AND status = 'declined'`,
    [body.id],
  )
  assert.deepEqual(declineEvents.rows, [{
    status: 'declined',
    note: reason,
    actorRole: 'pharmacy_owner',
  }])
})

test('decline refuses incomplete allocations and orders already dispatched', async () => {
  const medicine = await createMedicine({ name: 'Missing Allocation', stock: 3 })
  const placed = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(medicine, 1),
    idempotencyKey: randomUUID(),
  })
  assert.equal(placed.response.status, 201, placed.body?.error)
  await testPool.query(
    `DELETE FROM order_item_batch_allocations
     WHERE order_item_id IN (SELECT id FROM sales_order_items WHERE order_id = $1)`,
    [placed.body.id],
  )
  const incompleteDecline = await apiRequest(`/api/owner/orders/${placed.body.id}/decline`, {
    token: ownerSession.token,
    method: 'POST',
    body: { reason: 'Missing batch ledger' },
  })
  assert.equal(incompleteDecline.response.status, 409)
  assert.equal(incompleteDecline.body.code, 'ORDER_ALLOCATION_MISMATCH')
  const unchanged = await testPool.query(
    `SELECT o.status, m.stock, SUM(b.quantity_remaining)::int AS "batchStock",
       COUNT(sm.id)::int AS "returnMovements"
     FROM sales_orders o
     JOIN sales_order_items i ON i.order_id = o.id
     JOIN medicines m ON m.id = i.medicine_id
     JOIN inventory_batches b ON b.medicine_id = m.id
     LEFT JOIN stock_movements sm ON sm.medicine_id = m.id AND sm.movement_type = 'return'
     WHERE o.id = $1
     GROUP BY o.status, m.stock`,
    [placed.body.id],
  )
  assert.equal(unchanged.rows[0].status, 'pending')
  assert.equal(unchanged.rows[0].stock, 2)
  assert.equal(unchanged.rows[0].batchStock, 2)
  assert.equal(unchanged.rows[0].returnMovements, 0)

  const dispatchedMedicine = await createMedicine({ name: 'Dispatched Order', stock: 3 })
  const dispatched = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(dispatchedMedicine, 1),
    idempotencyKey: randomUUID(),
  })
  assert.equal(dispatched.response.status, 201, dispatched.body?.error)
  for (const [status, expectedStatus] of [
    ['accepted', 'pending'],
    ['preparing', 'accepted'],
    ['ready', 'preparing'],
    ['out_for_delivery', 'ready'],
  ]) {
    const transition = await apiRequest(`/api/owner/orders/${dispatched.body.id}/transition`, {
      token: ownerSession.token,
      method: 'POST',
      body: { status, expectedStatus },
    })
    assert.equal(transition.response.status, 200, transition.body?.error)
  }
  const afterDispatch = await apiRequest(`/api/owner/orders/${dispatched.body.id}/decline`, {
    token: ownerSession.token,
    method: 'POST',
    body: { reason: 'Cannot decline after dispatch' },
  })
  assert.equal(afterDispatch.response.status, 409)
  assert.equal(afterDispatch.body.code, 'ORDER_NOT_PENDING')
  const stillDeducted = await testPool.query(
    `SELECT o.status, m.stock, SUM(b.quantity_remaining)::int AS "batchStock"
     FROM sales_orders o
     JOIN sales_order_items i ON i.order_id = o.id
     JOIN medicines m ON m.id = i.medicine_id
     JOIN inventory_batches b ON b.medicine_id = m.id
     WHERE o.id = $1
     GROUP BY o.status, m.stock`,
    [dispatched.body.id],
  )
  assert.equal(stillDeducted.rows[0].status, 'out_for_delivery')
  assert.equal(stillDeducted.rows[0].stock, 2)
  assert.equal(stillDeducted.rows[0].batchStock, 2)
})

test('owner stock edits keep the medicine aggregate and batch balance aligned', async () => {
  const medicine = await createMedicine({ name: 'Owner Stock Edit', stock: 2, price: 9 })
  const updateStock = async (stock) => apiRequest(`/api/medicines/${medicine.id}`, {
    token: ownerSession.token,
    method: 'PUT',
    body: {
      name: medicine.name,
      category: 'Tablets',
      pack: medicine.pack,
      brandName: medicine.brandName,
      genericName: medicine.genericName,
      strength: medicine.strength,
      dosageForm: medicine.dosageForm,
      packQuantity: medicine.packQuantity,
      packUnit: medicine.packUnit,
      price: medicine.price,
      stock,
      reorderLevel: medicine.reorderLevel,
      expiry: medicine.expiry,
      batchNumber: medicine.batchNumber,
      gstRate: 0,
      prescriptionRequired: false,
    },
  })

  const increased = await updateStock(5)
  assert.equal(increased.response.status, 200, increased.body?.error)
  const decreased = await updateStock(1)
  assert.equal(decreased.response.status, 200, decreased.body?.error)
  const result = await testPool.query(
    `SELECT m.stock, SUM(b.quantity_remaining)::int AS "batchStock"
     FROM medicines m JOIN inventory_batches b ON b.medicine_id = m.id
     WHERE m.id = $1 GROUP BY m.id`,
    [medicine.id],
  )
  assert.equal(result.rows[0].stock, 1)
  assert.equal(result.rows[0].batchStock, 1)
})

test('only delivered buyers can create one order-linked review per medicine', async () => {
  const medicine = await createMedicine({ name: 'Verified Review Strip', stock: 3 })
  const placed = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(medicine),
    idempotencyKey: randomUUID(),
  })
  assert.equal(placed.response.status, 201, placed.body?.error)
  const orderId = placed.body.id
  const reviewPath = `/api/customer/medicines/${medicine.id}/reviews`

  const invalidStars = await apiRequest(reviewPath, {
    token: customerSession.token,
    method: 'POST',
    body: { rating: 6, comment: '' },
  })
  assert.equal(invalidStars.response.status, 400)
  const longComment = await apiRequest(reviewPath, {
    token: customerSession.token,
    method: 'POST',
    body: { rating: 4, comment: '💊'.repeat(501) },
  })
  assert.equal(longComment.response.status, 400)
  const invalidComment = await apiRequest(reviewPath, {
    token: customerSession.token,
    method: 'POST',
    body: { rating: 4, comment: { text: 'not a string' } },
  })
  assert.equal(invalidComment.response.status, 400)
  const beforeDelivery = await apiRequest(reviewPath, {
    token: customerSession.token,
    method: 'POST',
    body: { rating: 4, comment: 'Delivered-buyer review' },
  })
  assert.equal(beforeDelivery.response.status, 403)
  const eligibilityBeforeDelivery = await apiRequest(`/api/customer/medicines/${medicine.id}/review-eligibility`, {
    token: customerSession.token,
  })
  assert.equal(eligibilityBeforeDelivery.response.status, 200)
  assert.equal(eligibilityBeforeDelivery.body.eligible, false)

  for (const [status, expectedStatus] of [
    ['accepted', 'pending'],
    ['preparing', 'accepted'],
    ['ready', 'preparing'],
    ['out_for_delivery', 'ready'],
  ]) {
    const transition = await apiRequest(`/api/owner/orders/${orderId}/transition`, {
      token: ownerSession.token,
      method: 'POST',
      body: { status, expectedStatus },
    })
    assert.equal(transition.response.status, 200, transition.body?.error)
  }
  const deliveryCode = await apiRequest(`/api/me/orders/${orderId}/delivery-code`, { token: customerSession.token })
  assert.equal(deliveryCode.response.status, 200)
  const delivered = await apiRequest(`/api/owner/orders/${orderId}/verify-delivery`, {
    token: ownerSession.token,
    method: 'POST',
    body: { code: deliveryCode.body.code },
  })
  assert.equal(delivered.response.status, 200, delivered.body?.error)

  const nonBuyer = await apiRequest(reviewPath, {
    token: secondCustomerSession.token,
    method: 'POST',
    body: { rating: 5, comment: 'Not purchased' },
  })
  assert.equal(nonBuyer.response.status, 403)
  const eligibility = await apiRequest(`/api/customer/medicines/${medicine.id}/review-eligibility`, {
    token: customerSession.token,
  })
  assert.equal(eligibility.response.status, 200)
  assert.equal(eligibility.body.eligible, true)
  assert.equal(eligibility.body.review, null)

  const comment = '💊'.repeat(500)
  const review = await apiRequest(reviewPath, {
    token: customerSession.token,
    method: 'POST',
    body: { rating: 4, comment },
  })
  assert.equal(review.response.status, 201, review.body?.error)
  assert.equal(review.body.orderId, orderId)
  assert.equal(review.body.comment, comment)
  const reviewImmediatelyVisible = await apiRequest(`/api/catalog/medicines/${medicine.id}/reviews`)
  assert.equal(reviewImmediatelyVisible.body.reviews[0].comment, comment)
  const duplicate = await apiRequest(reviewPath, {
    token: customerSession.token,
    method: 'POST',
    body: { rating: 3, comment: 'Updated review' },
  })
  assert.equal(duplicate.response.status, 201, duplicate.body?.error)

  const reviewRows = await testPool.query(
    `SELECT medicine_id::int AS "medicineId", customer_id::int AS "customerId",
       order_id::int AS "orderId", rating, comment
     FROM product_reviews WHERE medicine_id = $1 AND order_id = $2`,
    [medicine.id, orderId],
  )
  assert.equal(reviewRows.rowCount, 1)
  assert.equal(reviewRows.rows[0].rating, 3)
  assert.equal(reviewRows.rows[0].comment, 'Updated review')

  const nonBuyerCustomer = await testPool.query(
    'SELECT id FROM customers WHERE user_account_id = $1',
    [secondCustomerSession.user.id],
  )
  await testPool.query(
    `INSERT INTO product_reviews (medicine_id, customer_id, rating, comment)
     VALUES ($1, $2, 5, 'Legacy unverified review')`,
    [medicine.id, nonBuyerCustomer.rows[0].id],
  )
  const publicReviews = await apiRequest(`/api/catalog/medicines/${medicine.id}/reviews`)
  assert.equal(publicReviews.response.status, 200)
  assert.equal(publicReviews.body.rating, 3)
  assert.equal(publicReviews.body.reviewCount, 1)
  assert.deepEqual(publicReviews.body.ratingDistribution, { '3': 1 })
  assert.equal(publicReviews.body.reviews.length, 1)
  assert.equal(publicReviews.body.reviews[0].verifiedPurchase, true)
  assert.equal(publicReviews.body.reviews[0].comment, 'Updated review')
  const catalog = await apiRequest('/api/catalog/medicines')
  const catalogMedicine = catalog.body.find((entry) => entry.id === medicine.id)
  assert.equal(catalogMedicine.rating, 3)
  assert.equal(catalogMedicine.reviewCount, 1)
  const updatedEligibility = await apiRequest(`/api/customer/medicines/${medicine.id}/review-eligibility`, {
    token: customerSession.token,
  })
  assert.equal(updatedEligibility.body.review.orderId, orderId)
  assert.equal(updatedEligibility.body.review.rating, 3)
})

test('family profiles require authorization, remain account-private, and record revocation and removal', async () => {
  const missingAuthorization = await apiRequest('/api/me/family', {
    token: customerSession.token,
    method: 'POST',
    body: { displayName: 'Adult Family Member', relationship: 'parent', memberType: 'adult' },
  })
  assert.equal(missingAuthorization.response.status, 400)
  const rejectedSensitiveData = await apiRequest('/api/me/family', {
    token: customerSession.token,
    method: 'POST',
    body: {
      displayName: 'Adult Family Member',
      relationship: 'parent',
      memberType: 'adult',
      authorizationConfirmed: true,
      prescriptionDetails: 'must not be accepted',
    },
  })
  assert.equal(rejectedSensitiveData.response.status, 400)

  const adult = await apiRequest('/api/me/family', {
    token: customerSession.token,
    method: 'POST',
    body: {
      displayName: 'Adult Family Member',
      relationship: 'parent',
      memberType: 'adult',
      authorizationConfirmed: true,
    },
  })
  assert.equal(adult.response.status, 201, adult.body?.error)
  assert.equal(adult.body.displayName, 'Adult Family Member')
  assert.equal(adult.body.authorizationType, 'adult_consent')
  assert.equal(adult.body.authorizationVersion, 'v1')
  assert.ok(adult.body.authorizationConfirmedAt)
  assert.equal(adult.body.status, 'active')

  const minor = await apiRequest('/api/me/family', {
    token: customerSession.token,
    method: 'POST',
    body: {
      displayName: 'Minor Family Member',
      relationship: 'child',
      memberType: 'minor',
      authorizationConfirmed: true,
    },
  })
  assert.equal(minor.response.status, 201, minor.body?.error)
  assert.equal(minor.body.authorizationType, 'guardian_authorization')

  const list = await apiRequest('/api/me/family', { token: customerSession.token })
  assert.deepEqual(list.body.familyProfiles.map(({ id }) => id), [adult.body.id, minor.body.id])
  const privateList = await apiRequest('/api/me/family', { token: secondCustomerSession.token })
  assert.deepEqual(privateList.body.familyProfiles, [])

  const unauthorizedEdit = await apiRequest(`/api/me/family/${adult.body.id}`, {
    token: secondCustomerSession.token,
    method: 'PATCH',
    body: { displayName: 'Changed by another account' },
  })
  assert.equal(unauthorizedEdit.response.status, 404)

  const edited = await apiRequest(`/api/me/family/${adult.body.id}`, {
    token: customerSession.token,
    method: 'PATCH',
    body: { displayName: 'Updated Family Member', relationship: 'parent' },
  })
  assert.equal(edited.response.status, 200, edited.body?.error)
  assert.equal(edited.body.displayName, 'Updated Family Member')

  const revoked = await apiRequest(`/api/me/family/${adult.body.id}/revoke`, {
    token: customerSession.token,
    method: 'POST',
  })
  assert.equal(revoked.response.status, 200, revoked.body?.error)
  assert.equal(revoked.body.status, 'revoked')
  const editAfterRevocation = await apiRequest(`/api/me/family/${adult.body.id}`, {
    token: customerSession.token,
    method: 'PATCH',
    body: { displayName: 'Should not save' },
  })
  assert.equal(editAfterRevocation.response.status, 409)

  const removed = await apiRequest(`/api/me/family/${minor.body.id}`, {
    token: customerSession.token,
    method: 'DELETE',
  })
  assert.equal(removed.response.status, 200, removed.body?.error)
  assert.equal(removed.body.status, 'removed')
  assert.equal(removed.body.displayName, 'Removed profile')

  const history = await testPool.query(
    `SELECT action FROM family_profile_audit_events
     WHERE family_profile_id = $1 AND actor_user_id = $2 ORDER BY id`,
    [adult.body.id, customerSession.user.id],
  )
  assert.deepEqual(history.rows.map(({ action }) => action), ['created', 'updated', 'authorization_revoked'])
  const removedHistory = await testPool.query(
    `SELECT action FROM family_profile_audit_events
     WHERE family_profile_id = $1 AND actor_user_id = $2 ORDER BY id`,
    [minor.body.id, customerSession.user.id],
  )
  assert.deepEqual(removedHistory.rows.map(({ action }) => action), ['created', 'removed'])
})

test('customer settings persist per account and notification preferences are honored', async () => {
  const defaults = await apiRequest('/api/me/settings', { token: customerSession.token })
  assert.equal(defaults.response.status, 200, defaults.body?.error)
  assert.equal(defaults.body.settings.language, 'en')
  assert.equal(defaults.body.settings.theme, 'system')
  assert.equal(defaults.body.settings.textScale, 1)

  const saved = await apiRequest('/api/me/settings', {
    token: customerSession.token,
    method: 'PATCH',
    body: {
      theme: 'dark',
      textScale: 1.15,
      orderNotificationsEnabled: false,
      medicineNotificationsEnabled: false,
    },
  })
  assert.equal(saved.response.status, 200, `${saved.body?.error ?? ''}\n${apiOutput}`)
  assert.equal(saved.body.settings.theme, 'dark')
  assert.equal(saved.body.settings.textScale, 1.15)
  assert.equal(saved.body.settings.orderNotificationsEnabled, false)
  assert.equal(saved.body.settings.medicineNotificationsEnabled, false)

  const unsupportedLanguage = await apiRequest('/api/me/settings', {
    token: customerSession.token,
    method: 'PATCH',
    body: { language: 'ta' },
  })
  assert.equal(unsupportedLanguage.response.status, 400)

  const otherDefaults = await apiRequest('/api/me/settings', { token: secondCustomerSession.token })
  assert.equal(otherDefaults.body.settings.language, 'en')
  assert.equal(otherDefaults.body.settings.orderNotificationsEnabled, true)

  const medicine = await createMedicine({ name: 'Customer Notifications Disabled', stock: 1 })
  const order = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(medicine),
    idempotencyKey: randomUUID(),
  })
  assert.equal(order.response.status, 201, `${order.body?.error ?? ''}\n${apiOutput}`)
  const notifications = await apiRequest('/api/me/notifications', { token: customerSession.token })
  assert.equal(notifications.body.notifications.some((item) => item.referenceId === order.body.id), false)
})
