import { describe, expect, it } from 'vitest';
import { isThemePreference, normalizeThemePreference, resolveTheme } from './index';

describe('theme helpers', () => {
  it('resolves the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('keeps an explicit preference regardless of the system theme', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('recognizes supported preferences and normalizes invalid values', () => {
    expect(isThemePreference('system')).toBe(true);
    expect(isThemePreference('dark')).toBe(true);
    expect(isThemePreference('contrast')).toBe(false);
    expect(normalizeThemePreference('contrast')).toBe('system');
    expect(normalizeThemePreference(undefined)).toBe('system');
  });
});
