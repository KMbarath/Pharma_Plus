import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const apiPath = fileURLToPath(new URL('./index.mjs', import.meta.url))
const vitePath = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
// Keep the dev shell alive when an already-running API owns port 3001.
// Vite can still serve the UI through that API, so API startup failure does
// not tear down the frontend process.
const api = spawn(process.execPath, [apiPath], { stdio: 'inherit' })
const vite = spawn(process.execPath, [vitePath], { stdio: 'inherit' })
let stopping = false

function stop(code) {
  if (stopping) return
  stopping = true
  if (code !== undefined) process.exitCode = code
  for (const child of [api, vite]) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
}

api.on('error', (error) => console.error('Could not start the Pharma Plus API:', error.message))
api.on('exit', (code) => {
  if (!stopping && code) console.error(`Pharma Plus API stopped with code ${code}. The frontend will remain available.`)
})
vite.on('error', (error) => {
  console.error('Could not start the Vite frontend:', error.message)
  stop(1)
})
vite.on('exit', (code) => {
  if (!stopping) stop(code ?? 0)
})

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
