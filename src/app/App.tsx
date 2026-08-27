import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MainPage } from '../pages/main';
import type { OnboardingValues } from '../pages/onboarding';
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
import {
  downloadDiagnosticReport,
  recordDiagnosticBreadcrumb,
  recordDiagnosticError
} from '../shared/lib/diagnostics';

const OnboardingPage = lazy(() =>
  import('../pages/onboarding').then((module) => ({ default: module.OnboardingPage }))
);
const DataMigrationPage = lazy(() =>
  import('../pages/data-migration').then((module) => ({ default: module.DataMigrationPage }))
);
const LegacyMigrationPrompt = lazy(() =>
  import('../pages/data-migration').then((module) => ({ default: module.LegacyMigrationPrompt }))
);

const settingsRepository = new SettingsRepository(localDb);
const sitesMigrationRepository = new SitesMigrationRepository(localDb);

type AppMigrationStatus = SitesMigrationStatus | 'not-applicable';

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [migrationStatus, setMigrationStatus] = useState<AppMigrationStatus | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [isReportBusy, setIsReportBusy] = useState(false);
  const [reportError, setReportError] = useState(false);
  const [dataRefreshKey, setDataRefreshKey] = useState(0);
  const [isLegacyPromptOpen, setIsLegacyPromptOpen] = useState(false);
  const hasRegisteredLegacyLaunch = useRef(false);
  const hasLoggedReady = useRef(false);
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
      .catch((error) => {
        recordDiagnosticError('app.settings_load_failed', 'app', error);
        if (isMounted) {
          setLoadError(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isSitesHost]);

  useEffect(() => {
    if (settings && migrationStatus && !hasLoggedReady.current) {
      hasLoggedReady.current = true;
      recordDiagnosticBreadcrumb('app.ready', 'app');
    }
  }, [migrationStatus, settings]);

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

    recordDiagnosticBreadcrumb('settings.save_started', 'onboarding');

    try {
      await settingsRepository.saveSettings(nextSettings);
      setSettings(nextSettings);
      recordDiagnosticBreadcrumb('settings.save_completed', 'onboarding');
    } catch (error) {
      recordDiagnosticError('settings.save_failed', 'onboarding', error);
      throw error;
    }
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
    } catch (error) {
      recordDiagnosticError('migration.status_write_failed', 'migration', error);
      // The restored data is still valid; onboarding state prevents a repeated migration.
    }

    setMigrationStatus('completed');
    replaceLocalData(restoredSettings);
  };

  const skipSitesMigration = async () => {
    try {
      await sitesMigrationRepository.markSkipped(toLocalIsoString(new Date()));
    } catch (error) {
      recordDiagnosticError('migration.status_write_failed', 'migration', error);
      // Keep the choice for the current session even if appMeta is unavailable.
    }

    setMigrationStatus('skipped');
  };

  if (loadError) {
    return (
      <main className="app-status" role="alert">
        <div className="app-status__content">
          <h1>Не вдалося запустити застосунок</h1>
          <p>Не вдалося прочитати локальні налаштування.</p>
          <div className="app-status__actions">
            <button
              type="button"
              disabled={isReportBusy}
              onClick={() => {
                setIsReportBusy(true);
                setReportError(false);
                void downloadDiagnosticReport()
                  .catch(() => setReportError(true))
                  .finally(() => setIsReportBusy(false));
              }}
            >
              {isReportBusy ? 'Створення…' : 'Зберегти звіт'}
            </button>
            <button type="button" onClick={() => window.location.reload()}>
              Перезапустити
            </button>
          </div>
          {reportError ? <p>Не вдалося створити звіт.</p> : null}
        </div>
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
    <Suspense fallback={<AppSplash />}>
      {appContent}
      {isLegacyHost && isLegacyPromptOpen ? (
        <LegacyMigrationPrompt onDismiss={() => setIsLegacyPromptOpen(false)} />
      ) : null}
    </Suspense>
  );
}
