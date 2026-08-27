// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://natuselit.github.io/Timer/"}

import 'fake-indexeddb/auto';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../entities/settings';
import { SettingsRepository } from '../shared/lib/local-db';
import {
  clearDiagnosticLogs,
  flushDiagnosticLogs,
  getDiagnosticLogs
} from '../shared/lib/diagnostics';
import { App } from './App';

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  );
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute('data-app-loading');
  await clearDiagnosticLogs();
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

    expect(screen.getByRole('heading', { name: 'Не вдалося запустити застосунок' })).toBeTruthy();
    expect(screen.getByText('Не вдалося прочитати локальні налаштування.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Зберегти звіт' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Перезапустити' })).toBeTruthy();
    expect(alert).toBeTruthy();
    await flushDiagnosticLogs();
    expect((await getDiagnosticLogs()).map((record) => record.code)).toContain(
      'app.settings_load_failed'
    );
    expect(document.documentElement.hasAttribute('data-app-loading')).toBe(false);
  });

  it('shows the legacy prompt on every third app launch', async () => {
    const user = userEvent.setup();
    const renderApp = () => render(<StrictMode><App /></StrictMode>);
    vi.spyOn(SettingsRepository.prototype, 'getSettings').mockResolvedValue({
      ...DEFAULT_SETTINGS,
      onboardingCompleted: false
    });

    const firstRender = renderApp();
    await screen.findByRole('heading', {
      name: 'Відмічайте початок і кінець зміни'
    });
    expect(screen.queryByRole('dialog', { name: 'Доступна нова версія' })).toBeNull();

    firstRender.unmount();
    const secondRender = renderApp();
    await screen.findByRole('heading', {
      name: 'Відмічайте початок і кінець зміни'
    });
    expect(screen.queryByRole('dialog', { name: 'Доступна нова версія' })).toBeNull();

    secondRender.unmount();
    const thirdRender = renderApp();
    expect(await screen.findByRole('dialog', { name: 'Доступна нова версія' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Залишитися тут' }));
    expect(screen.queryByRole('dialog', { name: 'Доступна нова версія' })).toBeNull();

    thirdRender.unmount();
    renderApp();
    await screen.findByRole('heading', {
      name: 'Відмічайте початок і кінець зміни'
    });
    expect(screen.queryByRole('dialog', { name: 'Доступна нова версія' })).toBeNull();
  });
});
