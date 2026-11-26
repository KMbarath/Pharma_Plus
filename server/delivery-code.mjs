import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION_PATTERN = /^[A-Za-z0-9._-]{1,32}$/
const VERIFIER_PATTERN = /^[a-f0-9]{64}$/
const DEVELOPMENT_KEY_PATH = fileURLToPath(new URL('../.devcerts/delivery-code-keys.json', import.meta.url))

function validateSecret(version, secret) {
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`Invalid delivery-code key version "${version}".`)
  }
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error(`Delivery-code key "${version}" must contain at least 32 bytes.`)
  }
  return Buffer.from(secret, 'utf8')
}

export function createDeliveryCodeKeyRing(currentVersion, currentSecret, previousKeys = {}) {
  if (!VERSION_PATTERN.test(currentVersion)) {
    throw new Error('DELIVERY_CODE_KEY_VERSION must be 1–32 letters, numbers, dots, underscores or hyphens.')
  }
  const keys = new Map()
  for (const [version, secret] of Object.entries(previousKeys)) {
    keys.set(version, validateSecret(version, secret))
  }
  keys.set(currentVersion, validateSecret(currentVersion, currentSecret))
  return Object.freeze({ currentVersion, keys })
}

function parseKeyRing(value) {
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('The delivery-code key file is not valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
      typeof parsed.currentVersion !== 'string' || !parsed.keys ||
      typeof parsed.keys !== 'object' || Array.isArray(parsed.keys)) {
    throw new Error('The delivery-code key file must contain currentVersion and a keys object.')
  }
  const { currentVersion, keys } = parsed
  if (!Object.hasOwn(keys, currentVersion)) {
    throw new Error(`The active delivery-code key "${currentVersion}" is missing.`)
  }
  const keyRing = createDeliveryCodeKeyRing(currentVersion, keys[currentVersion], Object.fromEntries(
    Object.entries(keys).filter(([version]) => version !== currentVersion),
  ))
  return keyRing
}

async function loadDevelopmentKeyRing(path = DEVELOPMENT_KEY_PATH) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  try {
    const data = await readFile(path, 'utf8')
    await chmod(path, 0o600)
    return parseKeyRing(data)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  const firstKey = randomBytes(32).toString('hex')
  const data = JSON.stringify({ currentVersion: 'v1', keys: { v1: firstKey } }, null, 2)
  try {
    await writeFile(path, data, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    return parseKeyRing(data)
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const existing = await readFile(path, 'utf8')
    await chmod(path, 0o600)
    return parseKeyRing(existing)
  }
}

export async function loadDeliveryCodeKeyRing(env = process.env) {
  const currentSecret = env.DELIVERY_CODE_SECRET
  if (typeof currentSecret === 'string' && currentSecret.length > 0) {
    let previousKeys = {}
    if (env.DELIVERY_CODE_PREVIOUS_KEYS) {
      try {
        previousKeys = JSON.parse(env.DELIVERY_CODE_PREVIOUS_KEYS)
      } catch {
        throw new Error('DELIVERY_CODE_PREVIOUS_KEYS must be a JSON object of key versions to secrets.')
      }
      if (!previousKeys || typeof previousKeys !== 'object' || Array.isArray(previousKeys)) {
        throw new Error('DELIVERY_CODE_PREVIOUS_KEYS must be a JSON object of key versions to secrets.')
      }
    }
    return createDeliveryCodeKeyRing(env.DELIVERY_CODE_KEY_VERSION || 'v1', currentSecret, previousKeys)
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('DELIVERY_CODE_SECRET is required in production.')
  }
  return loadDevelopmentKeyRing()
}

function getKey(keyRing, version) {
  const key = keyRing.keys.get(version)
  if (!key) throw new Error(`Delivery-code key "${version}" is not configured.`)
  return key
}

export function deriveDeliveryCode(keyRing, orderId, version = keyRing.currentVersion) {
  const digest = createHmac('sha256', getKey(keyRing, version))
    .update(`pharma-plus/delivery-code/v1\0${version}\0${orderId}`)
    .digest()
  const offset = digest[digest.length - 1] & 0x0f
  const value = ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3]
  return String(value % 1_000_000).padStart(6, '0')
}

export function createDeliveryCodeVerifier(keyRing, orderId, code, version = keyRing.currentVersion) {
  if (!/^\d{6}$/.test(code)) throw new Error('A delivery code must contain exactly six digits.')
  return createHmac('sha256', getKey(keyRing, version))
    .update(`pharma-plus/delivery-verifier/v1\0${version}\0${orderId}\0${code}`)
    .digest('hex')
}

export function verifyDeliveryCode(keyRing, orderId, code, verifier, version) {
  if (!/^\d{6}$/.test(code) || typeof verifier !== 'string' || !VERIFIER_PATTERN.test(verifier)) {
    return false
  }
  const expected = Buffer.from(createDeliveryCodeVerifier(keyRing, orderId, code, version), 'hex')
  const stored = Buffer.from(verifier, 'hex')
  return timingSafeEqual(expected, stored)
}
