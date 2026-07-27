import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shifter.worktime',
  appName: 'Shifter',
  webDir: 'dist',
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_shifter',
      iconColor: '#315EFB'
    }
  }
};

export default config;
