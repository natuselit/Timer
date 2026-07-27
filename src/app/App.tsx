import { useEffect, useLayoutEffect, useState } from 'react';
import { MainPage } from '../pages/main';
import { OnboardingPage, type OnboardingValues } from '../pages/onboarding';
import type { Settings } from '../entities/settings';
import { localDb, SettingsRepository } from '../shared/lib/local-db';
import { synchronizeTheme } from '../shared/lib/theme';
import { AppSplash } from './AppSplash';

const settingsRepository = new SettingsRepository(localDb);

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);

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

  if (loadError) {
    return (
      <main className="app-status" role="alert">
        Не вдалося прочитати локальні налаштування.
      </main>
    );
  }

  if (!settings) {
    return <AppSplash />;
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
    />
  );
}
