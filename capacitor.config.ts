import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.bamdiggity.frostfallfrontier',
  appName: 'Frostfall Frontier',
  webDir: 'dist',
  android: {
    backgroundColor: '#0e1b2a',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
