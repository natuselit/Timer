import {
  DEFAULT_THEME_PREFERENCE,
  isThemePreference,
  type ThemePreference
} from '../../../entities/settings';

export type ResolvedTheme = 'light' | 'dark';

export const THEME_PREFERENCE_STORAGE_KEY = 'shifter-theme-preference';

const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#eef2f6',
  dark: '#0b0f14'
};

export { isThemePreference };

export const resolveTheme = (
  preference: ThemePreference,
  systemPrefersDark: boolean
): ResolvedTheme => {
  if (preference === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }

  return preference;
};

export const normalizeThemePreference = (value: unknown): ThemePreference =>
  isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;

const cacheThemePreference = (preference: ThemePreference): void => {
  try {
    window.localStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // IndexedDB remains the source of truth if localStorage is unavailable.
  }
};

export const applyTheme = (
  preference: ThemePreference,
  systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
): ResolvedTheme => {
  const theme = resolveTheme(preference, systemPrefersDark);
  const root = document.documentElement;
  const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const statusBarStyle = document.querySelector<HTMLMetaElement>(
    'meta[name="apple-mobile-web-app-status-bar-style"]'
  );

  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.style.backgroundColor = THEME_COLORS[theme];
  themeColor?.setAttribute('content', THEME_COLORS[theme]);
  statusBarStyle?.setAttribute('content', theme === 'dark' ? 'black' : 'default');

  return theme;
};

export const synchronizeTheme = (preference: ThemePreference): (() => void) => {
  const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
  const updateTheme = () => applyTheme(preference, colorScheme.matches);

  cacheThemePreference(preference);
  updateTheme();

  if (preference === 'system') {
    colorScheme.addEventListener('change', updateTheme);
  }

  return () => {
    colorScheme.removeEventListener('change', updateTheme);
  };
};
