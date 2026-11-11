import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.m3athrazaq.qirtas',
  appName: 'قِرطاس',
  webDir: 'dist',
  backgroundColor: '#f4f5f2',
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_qirtas',
      iconColor: '#2a47a8',
    },
  },
}

export default config
