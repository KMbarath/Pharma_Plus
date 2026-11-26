export const ORDER_STATUS_TRANSITIONS = Object.freeze({
  pending: Object.freeze(['accepted']),
  accepted: Object.freeze(['preparing']),
  preparing: Object.freeze(['ready']),
  ready: Object.freeze(['out_for_delivery']),
  out_for_delivery: Object.freeze([]),
  delivered: Object.freeze([]),
  declined: Object.freeze([]),
  cancelled: Object.freeze([]),
})

export function isOrderStatus(status) {
  return Object.hasOwn(ORDER_STATUS_TRANSITIONS, status)
}

export function canTransitionOrderStatus(currentStatus, nextStatus) {
  return isOrderStatus(currentStatus) && ORDER_STATUS_TRANSITIONS[currentStatus].includes(nextStatus)
}
