import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMobileCertificate, detectLanIPv4 } from './mobile-cert.mjs'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const androidDirectory = resolve(projectRoot, 'android')
const builtApk = resolve(androidDirectory, 'app/build/outputs/apk/debug/app-debug.apk')
const downloadApk = resolve(projectRoot, 'release/Pharma-Plus-mobile-debug.apk')

function run(command, args, env, cwd = projectRoot) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`)
}

try {
  const ip = process.env.MOBILE_LAN_IP || detectLanIPv4()
  createMobileCertificate(ip)
  const env = { ...process.env, VITE_API_BASE_URL: `https://${ip}:3002` }
  run('npm', ['run', 'build'], env)
  run('npx', ['cap', 'sync', 'android'], env)
  run('./gradlew', ['assembleDebug'], env, androidDirectory)
  mkdirSync(resolve(projectRoot, 'release'), { recursive: true })
  copyFileSync(builtApk, downloadApk)
  console.log(`APK ready: ${downloadApk}`)
  console.log(`Start the API with npm run api:mobile. Mobile API URL: https://${ip}:3002`)
} catch (error) {
  console.error('Could not build the mobile APK:', error)
  process.exitCode = 1
}
