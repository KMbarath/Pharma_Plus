import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.pharmaplus.app',
  appName: 'Pharma Plus',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
}

export default config