// Keep the mobile API command portable across PowerShell, cmd, macOS, and Linux.
process.env.MOBILE_LAN = '1'
await import('./index.mjs')
