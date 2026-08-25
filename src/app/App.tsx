import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MainPage } from '../pages/main';
import { OnboardingPage, type OnboardingValues } from '../pages/onboarding';
import {
  DataMigrationPage,
  LegacyMigrationPrompt
} from '../pages/data-migration';
import type { Settings } from '../entities/settings';
import {
  localDb,
  SettingsRepository,
  SitesMigrationRepository,
  type SitesMigrationStatus
} from '../shared/lib/local-db';
import {
  isChatGptSitesHost,
  isLegacyGitHubPagesHost,
  registerLegacyMigrationPromptLaunch
} from '../shared/config/sitesMigration';
import { toLocalIsoString } from '../shared/lib/date-time';
import { synchronizeTheme } from '../shared/lib/theme';
import { AppSplash } from './AppSplash';

const settingsRepository = new SettingsRepository(localDb);
const sitesMigrationRepository = new SitesMigrationRepository(localDb);

type AppMigrationStatus = SitesMigrationStatus | 'not-applicable';

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [migrationStatus, setMigrationStatus] = useState<AppMigrationStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);
  const [isLegacyPromptOpen, setIsLegacyPromptOpen] = useState(false);
  const hasRegisteredLegacyLaunch = useRef(false);
  const isSitesHost =
    typeof window !== 'undefined' && isChatGptSitesHost(window.location.hostname);
  const isLegacyHost =
    typeof window !== 'undefined' &&
    isLegacyGitHubPagesHost(window.location.hostname);

  useEffect(() => {
    let isMounted = true;

    Promise.all([
      settingsRepository.getSettings(),
      isSitesHost
        ? sitesMigrationRepository.getStatus()
        : Promise.resolve<AppMigrationStatus>('not-applicable')
    ])
      .then(([storedSettings, storedMigrationStatus]) => {
        if (isMounted) {
          setSettings(storedSettings);
          setMigrationStatus(storedMigrationStatus);
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
  }, [isSitesHost]);

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

  useEffect(() => {
    if (
      !isLegacyHost ||
      !settings ||
      !migrationStatus ||
      hasRegisteredLegacyLaunch.current
    ) {
      return;
    }

    hasRegisteredLegacyLaunch.current = true;
    setIsLegacyPromptOpen(registerLegacyMigrationPromptLaunch(window.localStorage));
  }, [isLegacyHost, migrationStatus, settings]);

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

  const completeSitesMigration = async (restoredSettings: Settings) => {
    try {
      await sitesMigrationRepository.markCompleted(toLocalIsoString(new Date()));
    } catch {
      // The restored data is still valid; onboarding state prevents a repeated migration.
    }

    setMigrationStatus('completed');
    replaceLocalData(restoredSettings);
  };

  const skipSitesMigration = async () => {
    try {
      await sitesMigrationRepository.markSkipped(toLocalIsoString(new Date()));
    } catch {
      // Keep the choice for the current session even if appMeta is unavailable.
    }

    setMigrationStatus('skipped');
  };

  if (loadError) {
    return (
      <main className="app-status" role="alert">
        Не вдалося прочитати локальні налаштування.
      </main>
    );
  }

  if (!settings || !migrationStatus) {
    return <AppSplash />;
  }

  let appContent;

  if (
    isSitesHost &&
    !settings.onboardingCompleted &&
    migrationStatus === 'pending'
  ) {
    appContent = (
      <DataMigrationPage
        currentSettings={settings}
        onComplete={completeSitesMigration}
        onSkip={skipSitesMigration}
      />
    );
  } else if (!settings.onboardingCompleted) {
    appContent = <OnboardingPage onComplete={completeOnboarding} />;
  } else {
    appContent = (
      <MainPage
        settings={settings}
        dataVersion={dataRefreshKey}
        onSettingsChange={updateSettings}
        onLocalDataReplace={replaceLocalData}
      />
    );
  }

  return (
    <>
      {appContent}
      {isLegacyHost && isLegacyPromptOpen ? (
        <LegacyMigrationPrompt onDismiss={() => setIsLegacyPromptOpen(false)} />
      ) : null}
    </>
  );
}
