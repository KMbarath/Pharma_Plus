import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDeliveryCodeKeyRing,
  createDeliveryCodeVerifier,
  deriveDeliveryCode,
  verifyDeliveryCode,
} from './delivery-code.mjs'

const originalSecret = 'original-delivery-key-with-at-least-32-bytes'
const rotatedSecret = 'rotated-delivery-key-with-at-least-32-bytes'

test('delivery codes and verifiers survive restart and key rotation', () => {
  const originalRing = createDeliveryCodeKeyRing('v1', originalSecret)
  const orderId = 382
  const code = deriveDeliveryCode(originalRing, orderId)
  const verifier = createDeliveryCodeVerifier(originalRing, orderId, code)
  const reloadedRing = createDeliveryCodeKeyRing('v1', originalSecret)

  assert.match(code, /^\d{6}$/)
  assert.equal(deriveDeliveryCode(reloadedRing, orderId), code)
  assert.equal(verifyDeliveryCode(reloadedRing, orderId, code, verifier, 'v1'), true)
  const incorrectCode = code === '000000' ? '111111' : '000000'
  assert.equal(verifyDeliveryCode(reloadedRing, orderId, incorrectCode, verifier, 'v1'), false)

  const rotatedRing = createDeliveryCodeKeyRing('v2', rotatedSecret, { v1: originalSecret })
  assert.equal(deriveDeliveryCode(rotatedRing, orderId, 'v1'), code)
  assert.equal(verifyDeliveryCode(rotatedRing, orderId, code, verifier, 'v1'), true)
  assert.match(deriveDeliveryCode(rotatedRing, orderId), /^\d{6}$/)
  assert.notEqual(deriveDeliveryCode(rotatedRing, orderId + 1), code)
})

test('delivery-code secrets and versions are validated', () => {
  assert.throws(() => createDeliveryCodeKeyRing('bad/version', originalSecret), /DELIVERY_CODE_KEY_VERSION/)
  assert.throws(() => createDeliveryCodeKeyRing('v1', 'too-short'), /at least 32 bytes/)
})
