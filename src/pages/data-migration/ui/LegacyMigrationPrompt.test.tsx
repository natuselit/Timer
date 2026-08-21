// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SITES_APP_URL } from '../../../shared/config/sitesMigration';
import {
  LAST_BACKUP_EXPORTED_KEY,
  localDb
} from '../../../shared/lib/local-db';
import { LegacyMigrationPrompt } from './LegacyMigrationPrompt';

beforeEach(async () => {
  await localDb.settings.clear();
  await localDb.shifts.clear();
  await localDb.enterpriseSchedule.clear();
  await localDb.appMeta.clear();
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn(() => 'blob:legacy-migration-backup'),
    revokeObjectURL: vi.fn()
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await localDb.settings.clear();
  await localDb.shifts.clear();
  await localDb.enterpriseSchedule.clear();
  await localDb.appMeta.clear();
});

describe('LegacyMigrationPrompt', () => {
  it('shows the safe migration steps and the public Sites link', () => {
    render(<LegacyMigrationPrompt onDismiss={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'Доступна нова версія' })).toBeTruthy();
    expect(screen.getByText(/Створіть і збережіть backup/)).toBeTruthy();
    expect(screen.getByText(/Виберіть JSON-файл/)).toBeTruthy();
    expect(screen.getByText(/Старі дані та завантажений файл не видаляються/)).toBeTruthy();

    const sitesLink = screen.getByRole('link', {
      name: 'Відкрити нову версію'
    }) as HTMLAnchorElement;
    expect(sitesLink.href).toBe(SITES_APP_URL);
  });

  it('creates a JSON backup and marks the backup reminder as exported', async () => {
    const user = userEvent.setup();
    render(<LegacyMigrationPrompt onDismiss={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Створити backup' }));

    expect((await screen.findByRole('status')).textContent).toContain('Backup створено');
    await waitFor(async () => {
      await expect(localDb.appMeta.get(LAST_BACKUP_EXPORTED_KEY)).resolves.toMatchObject({
        value: expect.any(String)
      });
    });
  });

  it('keeps the prompt open and shows an error when export fails', async () => {
    const user = userEvent.setup();
    vi.mocked(URL.createObjectURL).mockImplementation(() => {
      throw new Error('download unavailable');
    });

    render(<LegacyMigrationPrompt onDismiss={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Створити backup' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Не вдалося створити JSON backup. Спробуйте ще раз.'
    );
    expect(screen.getByRole('dialog', { name: 'Доступна нова версія' })).toBeTruthy();
  });

  it('dismisses the prompt only through the current component state', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<LegacyMigrationPrompt onDismiss={onDismiss} />);

    await user.click(screen.getByRole('button', { name: 'Залишитися тут' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
