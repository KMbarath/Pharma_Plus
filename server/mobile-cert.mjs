import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { isIPv4 } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = fileURLToPath(new URL('../', import.meta.url))
const certificateDirectory = resolve(projectRoot, '.devcerts')
const androidCertificate = resolve(projectRoot, 'android/app/src/debug/res/raw/pharmaplus_dev_ca.pem')

export function detectLanIPv4() {
  const interfaces = networkInterfaces()
  const names = Object.keys(interfaces)
  const preferred = ['en0', 'en1'].filter((name) => names.includes(name))
  const orderedNames = [...preferred, ...names.filter((name) => !preferred.includes(name))]
  for (const name of orderedNames) {
    const address = interfaces[name]?.find((entry) => entry.family === 'IPv4' && !entry.internal)
    if (address && isIPv4(address.address)) return address.address
  }
  throw new Error('No active LAN IPv4 address was found. Connect the Mac and phone to the same Wi-Fi first.')
}

export function createMobileCertificate(ip) {
  if (!isIPv4(ip)) throw new Error(`Invalid mobile API IPv4 address: ${ip}`)
  mkdirSync(certificateDirectory, { recursive: true })
  mkdirSync(dirname(androidCertificate), { recursive: true })

  const caKey = resolve(certificateDirectory, 'root-ca.key')
  const caCert = resolve(certificateDirectory, 'root-ca.crt')
  const serverKey = resolve(certificateDirectory, 'server.key')
  const serverCsr = resolve(certificateDirectory, 'server.csr')
  const serverCert = resolve(certificateDirectory, 'server.crt')

  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '825',
    '-keyout', caKey, '-out', caCert, '-subj', '/CN=Pharma Plus Local Development CA',
    '-addext', 'basicConstraints=critical,CA:TRUE',
    '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
  ], { stdio: 'inherit' })
  execFileSync('openssl', [
    'req', '-new', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', serverKey, '-out', serverCsr, '-subj', `/CN=${ip}`,
    '-addext', `subjectAltName=IP:${ip},DNS:localhost`,
    '-addext', 'extendedKeyUsage=serverAuth',
  ], { stdio: 'inherit' })
  execFileSync('openssl', [
    'x509', '-req', '-in', serverCsr, '-CA', caCert, '-CAkey', caKey,
    '-CAcreateserial', '-out', serverCert, '-days', '365', '-sha256',
    '-copy_extensions', 'copy',
  ], { stdio: 'inherit' })
  copyFileSync(caCert, androidCertificate)
  return { ip, serverKey, serverCert, androidCertificate }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const ip = process.env.MOBILE_LAN_IP || detectLanIPv4()
    const certificate = createMobileCertificate(ip)
    console.log(`Created a development TLS certificate for ${ip}.`)
    console.log(`Android debug APK will trust ${certificate.androidCertificate}.`)
    console.log(`Mobile API URL: https://${ip}:3002`)
  } catch (error) {
    console.error('Could not create the mobile API certificate:', error)
    process.exitCode = 1
  }
}
