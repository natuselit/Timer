export const LEGACY_GITHUB_PAGES_URL = 'https://natuselit.github.io/Timer/';
export const SITES_APP_URL = 'https://timer.natuselit.chatgpt.site/';
export const LEGACY_MIGRATION_PROMPT_LAUNCH_INTERVAL = 3;

const LEGACY_MIGRATION_PROMPT_LAUNCH_COUNT_KEY =
  'legacy-migration-prompt-launch-count-v1';

type LaunchCountStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const registerLegacyMigrationPromptLaunch = (
  storage: LaunchCountStorage
): boolean => {
  try {
    const storedCount = Number(storage.getItem(LEGACY_MIGRATION_PROMPT_LAUNCH_COUNT_KEY));
    const previousCount =
      Number.isSafeInteger(storedCount) && storedCount >= 0
        ? storedCount % LEGACY_MIGRATION_PROMPT_LAUNCH_INTERVAL
        : 0;
    const currentCount = previousCount + 1;
    const shouldShowPrompt =
      currentCount === LEGACY_MIGRATION_PROMPT_LAUNCH_INTERVAL;

    storage.setItem(
      LEGACY_MIGRATION_PROMPT_LAUNCH_COUNT_KEY,
      shouldShowPrompt ? '0' : String(currentCount)
    );

    return shouldShowPrompt;
  } catch {
    // Keep the migration path available when browser storage is unavailable.
    return true;
  }
};

export const isLegacyGitHubPagesHost = (hostname: string): boolean =>
  hostname === 'natuselit.github.io';

export const shouldRedirectNewLegacyUser = (
  hostname: string,
  onboardingCompleted: boolean
): boolean => isLegacyGitHubPagesHost(hostname) && !onboardingCompleted;

export const isChatGptSitesHost = (hostname: string): boolean =>
  hostname === 'chatgpt.site' || hostname.endsWith('.chatgpt.site');
