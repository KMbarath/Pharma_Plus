import assert from 'node:assert/strict'
import test from 'node:test'
import { canTransitionOrderStatus, isOrderStatus } from './order-status.mjs'

test('order fulfillment accepts only the next authorized status', () => {
  const allowed = [
    ['pending', 'accepted'],
    ['accepted', 'preparing'],
    ['preparing', 'ready'],
    ['ready', 'out_for_delivery'],
  ]

  for (const [currentStatus, nextStatus] of allowed) {
    assert.equal(canTransitionOrderStatus(currentStatus, nextStatus), true)
  }

  for (const [currentStatus, nextStatus] of [
    ['pending', 'declined'],
    ['pending', 'preparing'],
    ['accepted', 'ready'],
    ['preparing', 'out_for_delivery'],
    ['ready', 'delivered'],
    ['out_for_delivery', 'delivered'],
    ['delivered', 'delivered'],
    ['unknown', 'accepted'],
  ]) {
    assert.equal(canTransitionOrderStatus(currentStatus, nextStatus), false)
  }
  assert.equal(isOrderStatus('ready'), true)
  assert.equal(isOrderStatus('packed'), false)
})
