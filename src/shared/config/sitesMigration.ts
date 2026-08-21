export const LEGACY_GITHUB_PAGES_URL = 'https://natuselit.github.io/Timer/';
export const SITES_APP_URL =
  'https://oblik-robochoho-chasu.natuselit.chatgpt.site/';

export const isLegacyGitHubPagesHost = (hostname: string): boolean =>
  hostname === 'natuselit.github.io';

export const isChatGptSitesHost = (hostname: string): boolean =>
  hostname === 'chatgpt.site' || hostname.endsWith('.chatgpt.site');
