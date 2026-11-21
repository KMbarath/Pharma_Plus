import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const apiPath = fileURLToPath(new URL('./index.mjs', import.meta.url))
const vitePath = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const children = [
  spawn(process.execPath, [apiPath], { stdio: 'inherit' }),
  spawn(process.execPath, [vitePath], { stdio: 'inherit' }),
]
let stopping = false

function stop(code) {
  if (stopping) return
  stopping = true
  if (code !== undefined) process.exitCode = code
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
}

for (const child of children) {
  child.on('error', (error) => {
    console.error('Could not start a development service:', error)
    stop(1)
  })
  child.on('exit', (code) => {
    if (!stopping) stop(code ?? 1)
  })
}

process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
