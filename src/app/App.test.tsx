// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://natuselit.github.io/Timer/"}

import 'fake-indexeddb/auto';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../entities/settings';
import { SettingsRepository } from '../shared/lib/local-db';
import { App } from './App';

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-app-loading');
});

describe('App launch state', () => {
  it('replaces the splash with a local database error and restores the page theme', async () => {
    vi.spyOn(SettingsRepository.prototype, 'getSettings').mockRejectedValue(
      new Error('IndexedDB is unavailable')
    );
    document.documentElement.dataset.appLoading = 'true';

    render(<App />);

    expect(screen.getByRole('status', { name: 'Завантаження' })).toBeTruthy();
    const alert = await screen.findByRole('alert');

    expect(alert.textContent).toBe('Не вдалося прочитати локальні налаштування.');
    expect(document.documentElement.hasAttribute('data-app-loading')).toBe(false);
  });

  it('shows the legacy prompt again after the app is remounted', async () => {
    const user = userEvent.setup();
    vi.spyOn(SettingsRepository.prototype, 'getSettings').mockResolvedValue({
      ...DEFAULT_SETTINGS,
      onboardingCompleted: false
    });

    const firstRender = render(<App />);
    expect(await screen.findByRole('dialog', { name: 'Доступна нова версія' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Залишитися тут' }));
    expect(screen.queryByRole('dialog', { name: 'Доступна нова версія' })).toBeNull();

    firstRender.unmount();
    render(<App />);

    expect(await screen.findByRole('dialog', { name: 'Доступна нова версія' })).toBeTruthy();
  });
});
