import { describe, expect, it } from 'vitest';
import {
  isChatGptSitesHost,
  isLegacyGitHubPagesHost,
  LEGACY_GITHUB_PAGES_URL,
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
});
