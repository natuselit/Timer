import { useEffect, useLayoutEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { MainPage } from '../pages/main';
import { OnboardingPage, type OnboardingValues } from '../pages/onboarding';
import { DEFAULT_SETTINGS, type Settings } from '../entities/settings';
import { localDb, SettingsRepository } from '../shared/lib/local-db';
import { synchronizeTheme } from '../shared/lib/theme';
import { AppSplash } from './AppSplash';
import { LockScreen } from '../shared/ui/lock-screen';
import {
  deletePinSecurity,
  getPinSecurityStatus,
  type PinSecurityStatus
} from '../shared/lib/security/pinSecurity';
import { clearAllNotifications } from '../shared/lib/native/notifications';

const settingsRepository = new SettingsRepository(localDb);

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);
  const [securityStatus, setSecurityStatus] = useState<PinSecurityStatus | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    let isMounted = true;

    settingsRepository
      .getSettings()
      .then((storedSettings) => {
        if (isMounted) {
          setSettings(storedSettings);
        }
      })
      .catch(() => {
        if (isMounted) {
          setLoadError(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const refreshSecurityStatus = async () => {
    const nextStatus = await getPinSecurityStatus();
    setSecurityStatus(nextStatus);
    return nextStatus;
  };

  useEffect(() => {
    void refreshSecurityStatus().then((status) => {
      if (status.enabled) {
        setIsLocked(true);
      }
    }).catch(() => {
      setSecurityStatus({
        enabled: false,
        native: false,
        biometricAvailable: false,
        biometricEnabled: false,
        failedAttempts: 0,
        lockoutUntil: 0
      });
    });
  }, []);

  useEffect(() => {
    let backgroundStartedAt: number | null = null;
    let appListener: { remove: () => Promise<void> } | null = null;

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        backgroundStartedAt = Date.now();
      } else if (
        backgroundStartedAt !== null &&
        Date.now() - backgroundStartedAt >= 60_000 &&
        securityStatus?.enabled
      ) {
        setIsLocked(true);
        backgroundStartedAt = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        backgroundStartedAt = Date.now();
      } else if (
        backgroundStartedAt !== null &&
        Date.now() - backgroundStartedAt >= 60_000 &&
        securityStatus?.enabled
      ) {
        setIsLocked(true);
        backgroundStartedAt = null;
      }
    }).then((listener) => {
      appListener = listener;
    });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      void appListener?.remove();
    };
  }, [securityStatus?.enabled]);

  useLayoutEffect(() => {
    if (!settings) {
      return;
    }

    const stopThemeSynchronization = synchronizeTheme(settings.themePreference);
    document.documentElement.removeAttribute('data-app-loading');

    return stopThemeSynchronization;
  }, [settings?.themePreference]);

  useLayoutEffect(() => {
    if (loadError) {
      document.documentElement.removeAttribute('data-app-loading');
    }
  }, [loadError]);

  const completeOnboarding = async (values: OnboardingValues) => {
    if (!settings) {
      return;
    }

    const nextSettings: Settings = {
      ...settings,
      ...values,
      onboardingCompleted: true,
      updatedAt: new Date().toISOString()
    };

    await settingsRepository.saveSettings(nextSettings);
    setSettings(nextSettings);
  };

  const updateSettings = async (nextSettings: Settings) => {
    await settingsRepository.saveSettings(nextSettings);
    setSettings(nextSettings);
  };

  const replaceLocalData = (nextSettings: Settings) => {
    setSettings(nextSettings);
    setDataRefreshKey((current) => current + 1);
  };

  const resetAllLocalData = async () => {
    await clearAllNotifications();
    await deletePinSecurity();
    await localDb.transaction(
      'rw',
      localDb.settings,
      localDb.shifts,
      localDb.enterpriseSchedule,
      localDb.appMeta,
      async () => {
        await localDb.settings.clear();
        await localDb.shifts.clear();
        await localDb.enterpriseSchedule.clear();
        await localDb.appMeta.clear();
      }
    );
    const nextSettings: Settings = {
      ...DEFAULT_SETTINGS,
      updatedAt: new Date().toISOString()
    };
    await settingsRepository.saveSettings(nextSettings);
    setSettings(nextSettings);
    setSecurityStatus(await getPinSecurityStatus());
    setIsLocked(false);
    setDataRefreshKey((current) => current + 1);
  };

  if (loadError) {
    return (
      <main className="app-status" role="alert">
        Не вдалося прочитати локальні налаштування.
      </main>
    );
  }

  if (!settings || !securityStatus) {
    return <AppSplash />;
  }

  if (isLocked && securityStatus.enabled) {
    return (
      <LockScreen
        status={securityStatus}
        onUnlock={() => setIsLocked(false)}
        onFullReset={resetAllLocalData}
      />
    );
  }

  if (!settings.onboardingCompleted) {
    return <OnboardingPage onComplete={completeOnboarding} />;
  }

  return (
    <MainPage
      settings={settings}
      dataVersion={dataRefreshKey}
      onSettingsChange={updateSettings}
      onLocalDataReplace={replaceLocalData}
      onSecurityChange={refreshSecurityStatus}
    />
  );
}
