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
  user: process.env.PGUSER || process.env.USER || process.env.USERNAME,
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
      phone: `91${String(process.pid).slice(-5)}${suffix === 'owner' ? '1' : suffix === 'customer' ? '2' : suffix === 'second' ? '3' : '4'}`,
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
  const { response, body } = await apiRequest('/api/owner/medicines', {
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
      pharmacyId: 999999,
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

async function deliverOrder(orderId) {
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
  const code = await apiRequest(`/api/me/orders/${orderId}/delivery-code`, { token: customerSession.token })
  assert.equal(code.response.status, 200, code.body?.error)
  const delivered = await apiRequest(`/api/owner/orders/${orderId}/verify-delivery`, {
    token: ownerSession.token,
    method: 'POST',
    body: { code: code.body.code },
  })
  assert.equal(delivered.response.status, 200, delivered.body?.error)
  return delivered.body
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
    user: process.env.PGUSER || process.env.USER || process.env.USERNAME,
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

test('customers can cancel pending orders once and cannot cancel after pharmacy acceptance', async () => {
  const medicine = await createMedicine({ name: 'Customer Cancellation', stock: 4 })
  const placed = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(medicine, 2),
    idempotencyKey: randomUUID(),
  })
  assert.equal(placed.response.status, 201, placed.body?.error)

  const hidden = await apiRequest(`/api/me/orders/${placed.body.id}/cancel`, {
    token: secondCustomerSession.token,
    method: 'POST',
    body: { reason: 'Changed my mind' },
  })
  assert.equal(hidden.response.status, 404)

  const missingReason = await apiRequest(`/api/me/orders/${placed.body.id}/cancel`, {
    token: customerSession.token,
    method: 'POST',
    body: { reason: ' ' },
  })
  assert.equal(missingReason.response.status, 400)

  const reason = 'I no longer need this order.'
  const cancelled = await apiRequest(`/api/me/orders/${placed.body.id}/cancel`, {
    token: customerSession.token,
    method: 'POST',
    body: { reason },
  })
  assert.equal(cancelled.response.status, 200, cancelled.body?.error)
  assert.equal(cancelled.body.status, 'cancelled')
  assert.equal(cancelled.body.returnRequests[0].type, 'cancellation')
  assert.equal(cancelled.body.returnRequests[0].refundStatus, 'not_required')

  const replay = await apiRequest(`/api/me/orders/${placed.body.id}/cancel`, {
    token: customerSession.token,
    method: 'POST',
    body: { reason },
  })
  assert.equal(replay.response.status, 200, replay.body?.error)
  assert.equal(replay.body.idempotentReplay, true)
  const restored = await testPool.query(
    `SELECT m.stock, b.quantity_remaining AS "batchQuantity",
       (SELECT COUNT(*)::int FROM stock_movements sm
        WHERE sm.medicine_id = m.id AND sm.movement_type = 'return') AS "returnMovements"
     FROM medicines m JOIN inventory_batches b ON b.medicine_id = m.id
     WHERE m.id = $1`,
    [medicine.id],
  )
  assert.deepEqual(restored.rows[0], { stock: 4, batchQuantity: 4, returnMovements: 1 })

  const acceptedMedicine = await createMedicine({ name: 'Accepted Cancellation', stock: 2 })
  const acceptedOrder = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(acceptedMedicine),
    idempotencyKey: randomUUID(),
  })
  assert.equal(acceptedOrder.response.status, 201, acceptedOrder.body?.error)
  const accepted = await apiRequest(`/api/owner/orders/${acceptedOrder.body.id}/transition`, {
    token: ownerSession.token,
    method: 'POST',
    body: { status: 'accepted', expectedStatus: 'pending' },
  })
  assert.equal(accepted.response.status, 200, accepted.body?.error)
  const tooLate = await apiRequest(`/api/me/orders/${acceptedOrder.body.id}/cancel`, {
    token: customerSession.token,
    method: 'POST',
    body: { reason: 'Please cancel this order.' },
  })
  assert.equal(tooLate.response.status, 409)
  assert.equal(tooLate.body.code, 'ORDER_NOT_CANCELLABLE')
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

test('delivered orders allow partial returns with isolated review, blocked stock, and pending refund reconciliation', async () => {
  const medicine = await createMedicine({ name: 'Return Review Strip', stock: 5, price: 12 })
  const placed = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(medicine, 2),
    idempotencyKey: randomUUID(),
  })
  assert.equal(placed.response.status, 201, placed.body?.error)
  await testPool.query(`UPDATE sales_orders SET payment_status = 'paid' WHERE id = $1`, [placed.body.id])
  await testPool.query(`UPDATE payments SET status = 'paid' WHERE order_id = $1`, [placed.body.id])
  const delivered = await deliverOrder(placed.body.id)
  const orderItemId = delivered.items[0].orderItemId

  await testPool.query(
    `UPDATE order_status_events SET created_at = now() - interval '25 hours'
     WHERE order_id = $1 AND status = 'delivered'`,
    [placed.body.id],
  )
  const expiredWindowRequest = await apiRequest('/api/me/returns', {
    token: customerSession.token,
    method: 'POST',
    body: { orderId: placed.body.id, reason: 'Item not wanted', items: [{ orderItemId, quantity: 1 }] },
  })
  assert.equal(expiredWindowRequest.response.status, 409)
  await testPool.query(
    `UPDATE order_status_events SET created_at = now()
     WHERE order_id = $1 AND status = 'delivered'`,
    [placed.body.id],
  )
  const tooManyItems = await apiRequest('/api/me/returns', {
    token: customerSession.token,
    method: 'POST',
    body: { orderId: placed.body.id, reason: 'Too many items', items: [{ orderItemId, quantity: 3 }] },
  })
  assert.equal(tooManyItems.response.status, 400)
  const notOwnerCustomer = await apiRequest('/api/me/returns', {
    token: secondCustomerSession.token,
    method: 'POST',
    body: { orderId: placed.body.id, reason: 'Wrong account', items: [{ orderItemId, quantity: 1 }] },
  })
  assert.equal(notOwnerCustomer.response.status, 404)
  const notDelivered = await apiRequest('/api/me/returns', {
    token: customerSession.token,
    method: 'POST',
    body: { orderId: placed.body.id, reason: 'Item not wanted', items: [{ orderItemId, quantity: 1 }] },
  })
  assert.equal(notDelivered.response.status, 201, notDelivered.body?.error)

  const returnRequestId = notDelivered.body.returnRequests[0].id
  const returnItemId = notDelivered.body.returnRequests[0].items[0].id
  const secondOwner = await createSession('pharmacy_owner', 'second-owner')
  const isolated = await apiRequest(`/api/owner/returns/${returnRequestId}/decision`, {
    token: secondOwner.token,
    method: 'POST',
    body: { decision: 'rejected', reason: 'Other pharmacy' },
  })
  assert.equal(isolated.response.status, 404)

  const invalidQuantity = await apiRequest('/api/me/returns', {
    token: secondCustomerSession.token,
    method: 'POST',
    body: { orderId: placed.body.id, reason: 'Wrong account', items: [{ orderItemId, quantity: 1 }] },
  })
  assert.equal(invalidQuantity.response.status, 404)

  const invalidRestock = await apiRequest(`/api/owner/returns/${returnRequestId}/decision`, {
    token: ownerSession.token,
    method: 'POST',
    body: {
      decision: 'approved',
      reason: 'Inspection completed',
      items: [{
        returnItemId: returnItemId,
        receivedQuantity: 1,
        disposition: 'inspected',
        restockSellable: true,
        lawfulRestockConfirmed: false,
      }],
    },
  })
  assert.equal(invalidRestock.response.status, 400)

  const approved = await apiRequest(`/api/owner/returns/${returnRequestId}/decision`, {
    token: ownerSession.token,
    method: 'POST',
    body: {
      decision: 'approved',
      reason: 'Received and held for inspection',
      items: [{
        returnItemId,
        receivedQuantity: 1,
        disposition: 'quarantine',
        restockSellable: false,
        lawfulRestockConfirmed: false,
      }],
    },
  })
  assert.equal(approved.response.status, 200, approved.body?.error)
  assert.equal(approved.body.returnRequests[0].items[0].receivedQuantity, 1)
  assert.equal(approved.body.returnRequests[0].items[0].restockSellable, false)
  assert.equal(approved.body.returnRequests[0].refundStatus, 'pending_reconciliation')
  assert.equal(approved.body.paymentStatus, 'paid')

  const inventory = await testPool.query(
    `SELECT m.stock, b.quantity_remaining AS "batchQuantity",
       b.quantity_blocked AS "blockedQuantity",
       (b.quantity_remaining - b.quantity_blocked)::int AS "sellableQuantity"
     FROM medicines m JOIN inventory_batches b ON b.medicine_id = m.id
     WHERE m.id = $1`,
    [medicine.id],
  )
  assert.deepEqual(inventory.rows[0], {
    stock: 4,
    batchQuantity: 4,
    blockedQuantity: 1,
    sellableQuantity: 3,
  })
  const reconciliation = await testPool.query(
    `SELECT refund_amount::float8 AS amount, refund_status AS status
     FROM customer_returns WHERE id = $1`,
    [returnRequestId],
  )
  assert.equal(reconciliation.rows[0].status, 'pending_reconciliation')
  assert.equal(reconciliation.rows[0].amount, Math.round(placed.body.items[0].lineTotal / 2 * 100) / 100)
  const audits = await testPool.query(
    `SELECT system_quantity AS "systemQuantity", counted_quantity AS "countedQuantity",
       system_sellable_quantity AS "systemSellable", counted_sellable_quantity AS "countedSellable",
       authorizer_user_id::int AS "authorizerId"
     FROM inventory_audits WHERE reason LIKE $1`,
    [`Authorized customer return ${returnRequestId};%`],
  )
  assert.deepEqual(audits.rows, [{
    systemQuantity: 3,
    countedQuantity: 4,
    systemSellable: 3,
    countedSellable: 3,
    authorizerId: ownerSession.user.id,
  }])

  const replay = await apiRequest(`/api/owner/returns/${returnRequestId}/decision`, {
    token: ownerSession.token,
    method: 'POST',
    body: {
      decision: 'approved',
      reason: 'Received and held for inspection',
      items: [{
        returnItemId,
        receivedQuantity: 1,
        disposition: 'quarantine',
        restockSellable: false,
        lawfulRestockConfirmed: false,
      }],
    },
  })
  assert.equal(replay.response.status, 200, replay.body?.error)
  assert.equal(replay.body.idempotentReplay, true)

  const inspectedOrder = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(medicine),
    idempotencyKey: randomUUID(),
  })
  assert.equal(inspectedOrder.response.status, 201, inspectedOrder.body?.error)
  const deliveredInspected = await deliverOrder(inspectedOrder.body.id)
  const requestedInspected = await apiRequest('/api/me/returns', {
    token: customerSession.token,
    method: 'POST',
    body: {
      orderId: inspectedOrder.body.id,
      reason: 'Package intact',
      items: [{ orderItemId: deliveredInspected.items[0].orderItemId, quantity: 1 }],
    },
  })
  assert.equal(requestedInspected.response.status, 201, requestedInspected.body?.error)
  const inspectedReturn = requestedInspected.body.returnRequests[0]
  const sellableRestock = await apiRequest(`/api/owner/returns/${inspectedReturn.id}/decision`, {
    token: ownerSession.token,
    method: 'POST',
    body: {
      decision: 'approved',
      reason: 'Inspected; policy permits restock',
      items: [{
        returnItemId: inspectedReturn.items[0].id,
        receivedQuantity: 1,
        disposition: 'inspected',
        restockSellable: true,
        lawfulRestockConfirmed: true,
      }],
    },
  })
  assert.equal(sellableRestock.response.status, 200, sellableRestock.body?.error)
  const afterInspection = await testPool.query(
    `SELECT quantity_remaining AS "batchQuantity", quantity_blocked AS "blockedQuantity"
     FROM inventory_batches WHERE medicine_id = $1`,
    [medicine.id],
  )
  assert.deepEqual(afterInspection.rows[0], { batchQuantity: 4, blockedQuantity: 1 })
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

test('orders allocate FEFO across valid batches and decline restores those same batches', async () => {
  const medicine = await createMedicine({ name: 'FEFO Strip', stock: 6, price: 8 })
  await testPool.query(
    `UPDATE inventory_batches
     SET quantity_received = 0, quantity_remaining = 0
     WHERE medicine_id = $1`,
    [medicine.id],
  )
  await testPool.query('UPDATE medicines SET stock = 6 WHERE id = $1', [medicine.id])
  await testPool.query(
    `INSERT INTO inventory_batches
      (medicine_id, batch_number, quantity_received, quantity_remaining, expiry_date)
     VALUES ($1, 'FEFO-EXPIRED', 2, 2, CURRENT_DATE - 1),
            ($1, 'FEFO-EARLY', 2, 2, '2030-01-01'),
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
  await testPool.query(`UPDATE sales_orders SET payment_status = 'paid' WHERE id = $1`, [body.id])
  await testPool.query(`UPDATE payments SET status = 'paid' WHERE order_id = $1`, [body.id])
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
  assert.equal(declines[0].body.returnRequests[0].type, 'cancellation')
  assert.equal(declines[0].body.returnRequests[0].refundStatus, 'pending_reconciliation')
  assert.equal(declines[0].body.returnRequests[0].refundAmount, body.total)
  const paymentState = await testPool.query(
    `SELECT payment_status AS "orderPaymentStatus" FROM sales_orders WHERE id = $1`,
    [body.id],
  )
  assert.equal(paymentState.rows[0].orderPaymentStatus, 'paid')
  const restored = await testPool.query(
    `SELECT m.stock, b.batch_number AS "batchNumber", b.quantity_remaining AS "quantityRemaining"
     FROM medicines m JOIN inventory_batches b ON b.medicine_id = m.id
     WHERE m.id = $1 ORDER BY b.batch_number`,
    [medicine.id],
  )
  const quantities = new Map(restored.rows.map((row) => [row.batchNumber, row.quantityRemaining]))
  assert.equal(restored.rows[0].stock, 6)
  assert.equal(quantities.get('FEFO-EXPIRED'), 2)
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
  const updateStock = async (stock) => apiRequest(`/api/owner/medicines/${medicine.id}`, {
    token: ownerSession.token,
    method: 'PATCH',
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

test('owner receipts record supplier cost, reconcile stock, and keep expired lots unsellable', async () => {
  const medicine = await createMedicine({ name: 'Receipt Stock Test', stock: 0, price: 8 })
  const expiryDate = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10)
  const receipt = (batchNumber, quantityReceived, expiry) => apiRequest('/api/owner/stock/receipts', {
    token: ownerSession.token,
    method: 'POST',
    body: {
      medicineId: medicine.id,
      supplierName: 'Reliable Medical Supply',
      batchNumber,
      quantityReceived,
      purchasePrice: 13.25,
      expiryDate: expiry,
      pharmacyId: 999999,
    },
  })

  const expiredReceipt = await receipt('RCPT-EXPIRED', 4, expiryDate(-2))
  assert.equal(expiredReceipt.response.status, 201, expiredReceipt.body?.error)
  assert.equal(expiredReceipt.body.stock, 4)
  const validReceipt = await receipt('RCPT-VALID', 3, expiryDate(365))
  assert.equal(validReceipt.response.status, 201, validReceipt.body?.error)
  assert.equal(validReceipt.body.stock, 7)
  const duplicate = await receipt('RCPT-VALID', 5, expiryDate(365))
  assert.equal(duplicate.response.status, 409)

  const batches = await apiRequest(`/api/owner/medicines/${medicine.id}/batches`, {
    token: ownerSession.token,
  })
  assert.equal(batches.response.status, 200)
  assert.equal(batches.body.length, 2)
  assert.equal(batches.body[0].batchNumber, 'RCPT-EXPIRED')
  assert.equal(batches.body[0].supplierName, 'Reliable Medical Supply')
  assert.equal(batches.body[0].purchasePrice, 13.25)
  assert.equal(batches.body[0].isExpired, true)
  assert.equal(batches.body[0].isSellable, false)
  assert.equal(batches.body[1].isSellable, true)

  const audit = await testPool.query(
    `SELECT action, details->>'purchasePrice' AS "purchasePrice"
     FROM audit_events
     WHERE entity_type = 'inventory_batch' AND entity_id = $1`,
    [validReceipt.body.batchId],
  )
  assert.deepEqual(audit.rows, [{ action: 'stock_received', purchasePrice: '13.25' }])
  const purchaseMovement = await testPool.query(
    `SELECT movement_type AS type, quantity_change AS quantity, note
     FROM stock_movements WHERE inventory_batch_id = $1`,
    [validReceipt.body.batchId],
  )
  assert.equal(purchaseMovement.rows[0].type, 'purchase')
  assert.equal(purchaseMovement.rows[0].quantity, 3)
  assert.match(purchaseMovement.rows[0].note, /purchase price 13\.25/)

  const otherOwner = await apiRequest('/api/auth/signup', {
    method: 'POST',
    body: {
      role: 'pharmacy_owner',
      email: `receipt-owner-${process.pid}@example.test`,
      password: 'order-test-password-2026',
      fullName: 'Receipt Test Owner',
      phone: '919876543210',
      pharmacyName: 'Other Receipt Pharmacy',
    },
  })
  assert.equal(otherOwner.response.status, 201, otherOwner.body?.error)
  const crossPharmacyBatches = await apiRequest(`/api/owner/medicines/${medicine.id}/batches`, {
    token: otherOwner.body.token,
  })
  assert.equal(crossPharmacyBatches.response.status, 404)
  const crossPharmacyReceipt = await apiRequest('/api/owner/stock/receipts', {
    token: otherOwner.body.token,
    method: 'POST',
    body: {
      medicineId: medicine.id,
      supplierName: 'Other Supplier',
      batchNumber: 'OTHER-LOT',
      quantityReceived: 1,
      purchasePrice: 1,
      expiryDate: expiryDate(365),
    },
  })
  assert.equal(crossPharmacyReceipt.response.status, 404)

  const unavailable = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(medicine, 4),
    idempotencyKey: randomUUID(),
  })
  assert.equal(unavailable.response.status, 409)
  const placed = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(medicine, 3),
    idempotencyKey: randomUUID(),
  })
  assert.equal(placed.response.status, 201, placed.body?.error)
  const allocations = await testPool.query(
    `SELECT b.batch_number AS "batchNumber", a.quantity
     FROM order_item_batch_allocations a
     JOIN inventory_batches b ON b.id = a.inventory_batch_id
     JOIN sales_order_items i ON i.id = a.order_item_id
     WHERE i.order_id = $1`,
    [placed.body.id],
  )
  assert.deepEqual(allocations.rows, [{ batchNumber: 'RCPT-VALID', quantity: 3 }])
  const reconciledStock = await testPool.query(
    `SELECT m.stock, SUM(b.quantity_remaining)::int AS "batchStock"
     FROM medicines m JOIN inventory_batches b ON b.medicine_id = m.id
     WHERE m.id = $1 GROUP BY m.id`,
    [medicine.id],
  )
  assert.equal(reconciledStock.rows[0].stock, 4)
  assert.equal(reconciledStock.rows[0].batchStock, 4)
})

test('owner medicine routes scope edits, audit price changes, and deactivate without losing snapshots', async () => {
  const medicine = await createMedicine({ name: 'Owner Scoped Product', stock: 3, price: 10 })
  assert.equal(medicine.pharmacyId, ownerSession.user.pharmacyId)
  await testPool.query(
    `UPDATE pharmacies SET approval_status = 'approved' WHERE id = $1`,
    [ownerSession.user.pharmacyId],
  )

  const otherOwner = await apiRequest('/api/auth/signup', {
    method: 'POST',
    body: {
      role: 'pharmacy_owner',
      email: `product-owner-${process.pid}@example.test`,
      password: 'order-test-password-2026',
      fullName: 'Product Test Owner',
      phone: '918812345678',
      pharmacyName: 'Other Product Pharmacy',
    },
  })
  assert.equal(otherOwner.response.status, 201, otherOwner.body?.error)
  const crossPharmacyEdit = await apiRequest(`/api/owner/medicines/${medicine.id}`, {
    token: otherOwner.body.token,
    method: 'PATCH',
    body: { ...medicine, price: 99 },
  })
  assert.equal(crossPharmacyEdit.response.status, 404)

  const invalidIdentifier = await apiRequest('/api/owner/medicines/1e0', {
    token: ownerSession.token,
    method: 'PATCH',
    body: { ...medicine },
  })
  assert.equal(invalidIdentifier.response.status, 400)
  const invalidPrice = await apiRequest(`/api/owner/medicines/${medicine.id}`, {
    token: ownerSession.token,
    method: 'PATCH',
    body: { ...medicine, price: 10.001 },
  })
  assert.equal(invalidPrice.response.status, 400)
  const invalidReorderLevel = await apiRequest(`/api/owner/medicines/${medicine.id}`, {
    token: ownerSession.token,
    method: 'PATCH',
    body: { ...medicine, reorderLevel: 1.5 },
  })
  assert.equal(invalidReorderLevel.response.status, 400)
  const invalidSku = await apiRequest('/api/owner/medicines', {
    token: ownerSession.token,
    method: 'POST',
    body: {
      ...medicine,
      name: 'Malformed SKU Product',
      sku: 'bad sku!',
    },
  })
  assert.equal(invalidSku.response.status, 400)

  const edited = await apiRequest(`/api/owner/medicines/${medicine.id}`, {
    token: ownerSession.token,
    method: 'PATCH',
    body: { ...medicine, price: 12.75 },
  })
  assert.equal(edited.response.status, 200, edited.body?.error)
  assert.equal(edited.body.price, 12.75)
  const priceAudit = await testPool.query(
    `SELECT action, details->>'fromPrice' AS "fromPrice", details->>'toPrice' AS "toPrice"
     FROM audit_events
     WHERE entity_type = 'medicine' AND entity_id = $1 AND action = 'medicine_price_changed'`,
    [medicine.id],
  )
  assert.equal(priceAudit.rowCount, 1)
  assert.equal(priceAudit.rows[0].fromPrice, '10')
  assert.equal(priceAudit.rows[0].toPrice, '12.75')

  const placed = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(edited.body),
    idempotencyKey: randomUUID(),
  })
  assert.equal(placed.response.status, 201, placed.body?.error)
  const catalogBeforeDeactivate = await apiRequest(
    `/api/catalog/medicines?pharmacyId=${medicine.pharmacyId}&q=${encodeURIComponent(medicine.name)}`,
  )
  assert.equal(catalogBeforeDeactivate.body.some((item) => item.id === medicine.id), true)

  const deactivated = await apiRequest(`/api/owner/medicines/${medicine.id}/deactivate`, {
    token: ownerSession.token,
    method: 'POST',
  })
  assert.equal(deactivated.response.status, 204)
  const catalogAfterDeactivate = await apiRequest(
    `/api/catalog/medicines?pharmacyId=${medicine.pharmacyId}&q=${encodeURIComponent(medicine.name)}`,
  )
  assert.equal(catalogAfterDeactivate.body.some((item) => item.id === medicine.id), false)
  const history = await testPool.query(
    `SELECT i.medicine_name, i.unit_price::float8 AS "unitPrice",
       i.medicine_snapshot->>'sku' AS sku, m.is_active
     FROM sales_orders o
     JOIN sales_order_items i ON i.order_id = o.id
     JOIN medicines m ON m.id = i.medicine_id
     WHERE o.id = $1 AND i.medicine_id = $2`,
    [placed.body.id, medicine.id],
  )
  assert.equal(history.rowCount, 1)
  assert.equal(history.rows[0].medicine_name, medicine.name)
  assert.equal(history.rows[0].unitPrice, 12.75)
  assert.equal(history.rows[0].sku, medicine.sku)
  assert.equal(history.rows[0].is_active, false)
})

test('approved product comparison and customer refill reminders work from catalog IDs', async () => {
  await testPool.query(
    `UPDATE pharmacies SET approval_status = 'approved' WHERE id = $1`,
    [ownerSession.user.pharmacyId],
  )
  const medicine = await createMedicine({ name: 'Catalog Reminder Demo', stock: 4 })
  const medicineDetails = await apiRequest(`/api/medicines/${medicine.id}`)
  assert.equal(medicineDetails.response.status, 200, medicineDetails.body?.error)
  assert.equal(medicineDetails.body.medicine.expiryDate, '2035-01-01')
  const comparison = await apiRequest(`/api/catalog/compare?productKey=${medicine.id}`)
  assert.equal(comparison.response.status, 200, comparison.body?.error)
  assert.equal(comparison.body.product.id, medicine.id)
  assert.ok(comparison.body.listings.some((listing) => listing.medicineId === medicine.id))

  const reminder = await apiRequest('/api/me/reminders', {
    token: customerSession.token,
    method: 'POST',
    body: {
      medicineId: medicine.id,
      pharmacyId: medicine.pharmacyId,
      nextReminderDate: '2099-12-31',
      intervalDays: 30,
    },
  })
  assert.equal(reminder.response.status, 201, reminder.body?.error)
  assert.equal(reminder.body.pharmacyId, medicine.pharmacyId)
  assert.equal(reminder.body.nextReminderDate, '2099-12-31')
  assert.equal(reminder.body.optIn, true)

  const saved = await apiRequest('/api/me/reminders', { token: customerSession.token })
  assert.equal(saved.response.status, 200)
  assert.equal(saved.body.reminders.find((item) => item.id === reminder.body.id)?.nextReminderDate, '2099-12-31')

  const cancelled = await apiRequest(`/api/me/reminders/${reminder.body.id}`, {
    token: customerSession.token,
    method: 'PATCH',
    body: { optIn: false },
  })
  assert.equal(cancelled.response.status, 200, cancelled.body?.error)
  assert.equal(cancelled.body.optIn, false)
})

test('confirmed checkout quotes can be placed as orders', async () => {
  await testPool.query(
    `UPDATE pharmacies SET approval_status = 'approved' WHERE id = $1`,
    [ownerSession.user.pharmacyId],
  )
  const medicine = await createMedicine({ name: 'Confirmed Checkout Demo', stock: 3, price: 12 })
  const checkout = {
    items: [{ medicineId: medicine.id, pharmacy_id: medicine.pharmacyId, quantity: 1 }],
    paymentMethod: 'Cash on Delivery',
    fulfillmentMethod: 'pickup',
    discountCode: null,
  }
  const quote = await apiRequest('/api/checkout/quote', {
    token: customerSession.token,
    method: 'POST',
    body: checkout,
  })
  assert.equal(quote.response.status, 200, quote.body?.error)
  assert.equal(quote.body.pharmacyId, medicine.pharmacyId)

  const placed = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: { ...checkout, quoteId: quote.body.quoteId },
    idempotencyKey: randomUUID(),
  })
  assert.equal(placed.response.status, 201, placed.body?.error)
  assert.equal(placed.body.status, 'pending')
  assert.equal(placed.body.fulfillmentMethod, 'pickup')
  const stock = await testPool.query('SELECT stock FROM medicines WHERE id = $1', [medicine.id])
  assert.equal(stock.rows[0].stock, 2)
})

test('owner dashboard aggregates batch stock, expiry, pending orders, and collected payments', async () => {
  const medicine = await createMedicine({ name: 'Owner Dashboard Batch', stock: 4, price: 37.5 })
  await testPool.query(
    `UPDATE medicines SET reorder_level = 5 WHERE id = $1`,
    [medicine.id],
  )
  await testPool.query(
    `UPDATE inventory_batches SET expiry_date = (now() AT TIME ZONE 'UTC')::date + 5
     WHERE medicine_id = $1`,
    [medicine.id],
  )

  const placed = await apiRequest('/api/orders', {
    token: customerSession.token,
    method: 'POST',
    body: orderBody(medicine),
    idempotencyKey: randomUUID(),
  })
  assert.equal(placed.response.status, 201, placed.body?.error)
  const order = await testPool.query(
    `SELECT id, total FROM sales_orders WHERE pharmacy_id = $1 ORDER BY id DESC LIMIT 1`,
    [ownerSession.user.pharmacyId],
  )
  await testPool.query(`UPDATE payments SET status = 'paid' WHERE order_id = $1`, [order.rows[0].id])

  const [dashboard, alerts, rawTotals] = await Promise.all([
    apiRequest('/api/owner/dashboard?range=week', { token: ownerSession.token }),
    apiRequest('/api/owner/alerts', { token: ownerSession.token }),
    testPool.query(
      `WITH medicine_stock AS (
         SELECT m.id, m.reorder_level,
           CASE
             WHEN m.expiry_date IS NOT NULL AND m.expiry_date < (now() AT TIME ZONE 'UTC')::date THEN 0
             WHEN EXISTS (SELECT 1 FROM inventory_batches ib WHERE ib.medicine_id = m.id)
               THEN LEAST(m.stock, COALESCE((
                 SELECT SUM(ib.quantity_remaining - ib.quantity_blocked)::int
                 FROM inventory_batches ib
                 WHERE ib.medicine_id = m.id AND ib.quantity_remaining > ib.quantity_blocked
                   AND (ib.expiry_date IS NULL OR ib.expiry_date >= (now() AT TIME ZONE 'UTC')::date)
               ), 0))
             ELSE m.stock
           END AS sellable_stock
         FROM medicines m WHERE m.pharmacy_id = $1 AND m.is_active
       )
       SELECT
         (SELECT COUNT(*)::int FROM medicine_stock) AS "activeMedicines",
         (SELECT COALESCE(SUM(sellable_stock), 0)::int FROM medicine_stock) AS "sellableUnits",
         (SELECT COUNT(*)::int FROM medicine_stock
          WHERE sellable_stock > 0 AND sellable_stock <= reorder_level) AS "lowStock",
         (SELECT COUNT(*)::int FROM medicine_stock WHERE sellable_stock = 0) AS "outOfStock",
         (SELECT COUNT(*)::int FROM sales_orders WHERE pharmacy_id = $1 AND status = 'pending') AS pending,
         (SELECT COUNT(*)::int FROM inventory_batches ib JOIN medicines m ON m.id = ib.medicine_id
          WHERE m.pharmacy_id = $1 AND m.is_active AND ib.quantity_remaining > ib.quantity_blocked
            AND ib.expiry_date >= (now() AT TIME ZONE 'UTC')::date
            AND ib.expiry_date <= (now() AT TIME ZONE 'UTC')::date + 7) AS "batches7Days",
         (SELECT COALESCE(SUM(ib.quantity_remaining - ib.quantity_blocked), 0)::int FROM inventory_batches ib JOIN medicines m ON m.id = ib.medicine_id
          WHERE m.pharmacy_id = $1 AND m.is_active AND ib.quantity_remaining > ib.quantity_blocked
            AND ib.expiry_date >= (now() AT TIME ZONE 'UTC')::date
            AND ib.expiry_date <= (now() AT TIME ZONE 'UTC')::date + 7) AS "units7Days",
         (SELECT COALESCE(SUM(total), 0)::float8 FROM sales_orders
          WHERE pharmacy_id = $1 AND created_at >= date_trunc('day', now()) - INTERVAL '6 days'
            AND status NOT IN ('cancelled', 'declined')) AS gross,
         (SELECT COALESCE(SUM(p.amount), 0)::float8 FROM payments p
          JOIN sales_orders o ON o.id = p.order_id
          WHERE o.pharmacy_id = $1 AND p.status = 'paid'
            AND p.created_at >= date_trunc('day', now()) - INTERVAL '6 days') AS collected`,
      [ownerSession.user.pharmacyId],
    ),
  ])
  assert.equal(dashboard.response.status, 200, dashboard.body?.error)
  assert.equal(alerts.response.status, 200, alerts.body?.error)
  assert.equal(dashboard.body.kpis.activeMedicines, rawTotals.rows[0].activeMedicines)
  assert.equal(dashboard.body.kpis.sellableUnits, rawTotals.rows[0].sellableUnits)
  assert.equal(dashboard.body.kpis.lowStock, rawTotals.rows[0].lowStock)
  assert.equal(dashboard.body.kpis.outOfStock, rawTotals.rows[0].outOfStock)
  assert.equal(dashboard.body.kpis.pendingOrders, rawTotals.rows[0].pending)
  assert.equal(dashboard.body.kpis.batches7Days, rawTotals.rows[0].batches7Days)
  assert.equal(dashboard.body.kpis.units7Days, rawTotals.rows[0].units7Days)
  assert.ok(Math.abs(dashboard.body.sales.reduce((sum, point) => sum + point.grossSales, 0) - rawTotals.rows[0].gross) < 0.005)
  assert.ok(Math.abs(dashboard.body.sales.reduce((sum, point) => sum + point.collectedPayments, 0) - rawTotals.rows[0].collected) < 0.005)
  assert.equal(alerts.body.lowStock.some((item) => item.medicineId === medicine.id), true)
  assert.equal(alerts.body.expiringBatches.some((batch) => batch.medicineId === medicine.id), true)

  for (const range of ['today', 'month']) {
    const rangedDashboard = await apiRequest(`/api/owner/dashboard?range=${range}`, { token: ownerSession.token })
    assert.equal(rangedDashboard.response.status, 200, rangedDashboard.body?.error)
    assert.equal(rangedDashboard.body.range, range)
    assert.ok(rangedDashboard.body.sales.length > 0)
  }

  const secondOwner = await apiRequest('/api/auth/signup', {
    method: 'POST',
    body: {
      role: 'pharmacy_owner',
      email: `isolated-owner-${process.pid}@example.test`,
      password: 'order-test-password-2026',
      fullName: 'Isolated Dashboard Owner',
      phone: '919876543210',
      pharmacyName: 'Isolated Dashboard Pharmacy',
    },
  })
  assert.equal(secondOwner.response.status, 201, secondOwner.body?.error)
  const isolatedDashboard = await apiRequest('/api/owner/dashboard', { token: secondOwner.body.token })
  assert.equal(isolatedDashboard.response.status, 200, isolatedDashboard.body?.error)
  assert.equal(isolatedDashboard.body.kpis.activeMedicines, 0)
  assert.equal(isolatedDashboard.body.kpis.sellableUnits, 0)
  assert.equal(isolatedDashboard.body.kpis.pendingOrders, 0)
  assert.equal(isolatedDashboard.body.recentStockMovements.length, 0)
  assert.equal(isolatedDashboard.body.recentOrderEvents.length, 0)

  const invalidRange = await apiRequest('/api/owner/dashboard?range=year', { token: ownerSession.token })
  assert.equal(invalidRange.response.status, 400)
})

test('owner expiry risk uses UTC cutoffs and inventory counts are authorized and atomic', async () => {
  const timezoneCheck = await testPool.connect()
  let utcDateInKiritimati
  let utcDateInAdak
  try {
    await timezoneCheck.query('BEGIN')
    await timezoneCheck.query("SET LOCAL TIME ZONE 'Pacific/Kiritimati'")
    utcDateInKiritimati = (await timezoneCheck.query(
      `SELECT (now() AT TIME ZONE 'UTC')::date::text AS utc_date`,
    )).rows[0].utc_date
    await timezoneCheck.query("SET LOCAL TIME ZONE 'America/Adak'")
    utcDateInAdak = (await timezoneCheck.query(
      `SELECT (now() AT TIME ZONE 'UTC')::date::text AS utc_date`,
    )).rows[0].utc_date
    await timezoneCheck.query('ROLLBACK')
  } finally {
    timezoneCheck.release()
  }
  assert.equal(utcDateInKiritimati, utcDateInAdak)

  const medicine = await createMedicine({ name: 'Audited Expiry Batch', stock: 10 })
  await testPool.query('UPDATE medicines SET reorder_level = 9 WHERE id = $1', [medicine.id])
  const batchResult = await testPool.query(
    `UPDATE inventory_batches
     SET expiry_date = (now() AT TIME ZONE 'UTC')::date + 7, purchase_price = 2.50
     WHERE medicine_id = $1
     RETURNING id::int AS id`,
    [medicine.id],
  )
  const batchId = batchResult.rows[0].id

  const unauthorized = await apiRequest('/api/owner/expiry')
  assert.equal(unauthorized.response.status, 401)

  const expiry = await apiRequest('/api/owner/expiry', { token: ownerSession.token })
  assert.equal(expiry.response.status, 200, expiry.body?.error)
  const expiringBatch = expiry.body.batches.find((batch) => batch.batchId === batchId)
  assert.ok(expiringBatch)
  assert.equal(expiringBatch.daysUntilExpiry, 7)
  assert.equal(expiringBatch.sellableQuantity, 10)
  assert.equal(expiringBatch.purchaseCostAtRisk, 25)
  assert.ok(expiry.body.summary.batches7Days >= 1)

  const counted = await apiRequest('/api/owner/inventory-audits', {
    token: ownerSession.token,
    method: 'POST',
    body: {
      reason: 'Physical count found two additional units',
      authorizerUserId: 999999,
      items: [{ medicineId: medicine.id, batchId, countedQuantity: 12, countedSellableQuantity: 9 }],
    },
  })
  assert.equal(counted.response.status, 201, counted.body?.error)
  assert.equal(counted.body.authorizer, ownerSession.user.fullName)
  assert.equal(counted.body.adjustments[0].quantityChange, 2)
  assert.equal(counted.body.adjustments[0].sellableQuantityChange, -1)

  const databaseState = await testPool.query(
    `SELECT m.stock, b.quantity_remaining, b.quantity_blocked,
       a.system_quantity, a.counted_quantity, a.system_sellable_quantity,
       a.counted_sellable_quantity, a.authorizer_user_id::int AS authorizer_user_id, a.authorizer_name
     FROM medicines m
     JOIN inventory_batches b ON b.medicine_id = m.id
     JOIN inventory_audits a ON a.inventory_batch_id = b.id
     WHERE b.id = $1`,
    [batchId],
  )
  assert.equal(databaseState.rows[0].stock, 12)
  assert.equal(databaseState.rows[0].quantity_remaining, 12)
  assert.equal(databaseState.rows[0].quantity_blocked, 3)
  assert.equal(databaseState.rows[0].system_quantity, 10)
  assert.equal(databaseState.rows[0].counted_quantity, 12)
  assert.equal(databaseState.rows[0].system_sellable_quantity, 10)
  assert.equal(databaseState.rows[0].counted_sellable_quantity, 9)
  assert.equal(databaseState.rows[0].authorizer_user_id, ownerSession.user.id)
  assert.equal(databaseState.rows[0].authorizer_name, ownerSession.user.fullName)

  const lowStock = await apiRequest('/api/owner/low-stock', { token: ownerSession.token })
  assert.equal(lowStock.response.status, 200, lowStock.body?.error)
  assert.equal(lowStock.body.lowStock.some((item) => item.medicineId === medicine.id && item.sellableStock === 9), true)

  const updatedExpiry = await apiRequest('/api/owner/expiry', { token: ownerSession.token })
  const updatedBatch = updatedExpiry.body.batches.find((batch) => batch.batchId === batchId)
  assert.equal(updatedBatch.sellableQuantity, 9)
  assert.equal(updatedBatch.purchaseCostAtRisk, 22.5)

  await testPool.query(
    `UPDATE inventory_batches SET expiry_date = (now() AT TIME ZONE 'UTC')::date - 1 WHERE id = $1`,
    [batchId],
  )
  const expiredCount = await apiRequest('/api/owner/inventory-audits', {
    token: ownerSession.token,
    method: 'POST',
    body: {
      reason: 'Attempt to mark expired units sellable',
      items: [{ medicineId: medicine.id, batchId, countedQuantity: 12, countedSellableQuantity: 1 }],
    },
  })
  assert.equal(expiredCount.response.status, 400)
  assert.match(expiredCount.body.error, /Expired inventory cannot be marked sellable/)
  const unchanged = await testPool.query(
    `SELECT quantity_remaining, quantity_blocked, (SELECT COUNT(*)::int FROM inventory_audits WHERE inventory_batch_id = $1) AS audit_count
     FROM inventory_batches WHERE id = $1`,
    [batchId],
  )
  assert.equal(unchanged.rows[0].quantity_remaining, 12)
  assert.equal(unchanged.rows[0].quantity_blocked, 3)
  assert.equal(unchanged.rows[0].audit_count, 1)
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
