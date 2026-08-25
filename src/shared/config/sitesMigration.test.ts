import { describe, expect, it } from 'vitest';
import {
  isChatGptSitesHost,
  isLegacyGitHubPagesHost,
  LEGACY_MIGRATION_PROMPT_LAUNCH_INTERVAL,
  LEGACY_GITHUB_PAGES_URL,
  registerLegacyMigrationPromptLaunch,
  SITES_APP_URL
} from './sitesMigration';

describe('Sites migration config', () => {
  it('recognizes ChatGPT Sites hosts only', () => {
    expect(isChatGptSitesHost('timer.natuselit.chatgpt.site')).toBe(true);
    expect(isChatGptSitesHost('chatgpt.site')).toBe(true);
    expect(isChatGptSitesHost('natuselit.github.io')).toBe(false);
    expect(isChatGptSitesHost('localhost')).toBe(false);
  });

  it('keeps the legacy GitHub Pages URL explicit', () => {
    expect(LEGACY_GITHUB_PAGES_URL).toBe('https://natuselit.github.io/Timer/');
  });

  it('recognizes the legacy GitHub Pages host only', () => {
    expect(isLegacyGitHubPagesHost('natuselit.github.io')).toBe(true);
    expect(isLegacyGitHubPagesHost('timer.natuselit.chatgpt.site')).toBe(false);
    expect(isLegacyGitHubPagesHost('localhost')).toBe(false);
  });

  it('keeps the public Sites URL explicit', () => {
    expect(SITES_APP_URL).toBe('https://timer.natuselit.chatgpt.site/');
  });

  it('shows the legacy migration prompt on every third launch', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };

    expect(LEGACY_MIGRATION_PROMPT_LAUNCH_INTERVAL).toBe(3);
    expect(registerLegacyMigrationPromptLaunch(storage)).toBe(false);
    expect(registerLegacyMigrationPromptLaunch(storage)).toBe(false);
    expect(registerLegacyMigrationPromptLaunch(storage)).toBe(true);
    expect(registerLegacyMigrationPromptLaunch(storage)).toBe(false);
    expect(registerLegacyMigrationPromptLaunch(storage)).toBe(false);
    expect(registerLegacyMigrationPromptLaunch(storage)).toBe(true);
  });

  it('keeps the prompt available when local storage cannot be used', () => {
    const unavailableStorage = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => undefined
    };

    expect(registerLegacyMigrationPromptLaunch(unavailableStorage)).toBe(true);
  });
});
