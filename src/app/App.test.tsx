// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsRepository } from '../shared/lib/local-db';
import { App } from './App';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
});
