// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../../entities/settings';

vi.mock('../../../shared/lib/security/pinSecurity', () => ({
  createPin: vi.fn(),
  deletePinSecurity: vi.fn(),
  getPinSecurityStatus: vi.fn(() => new Promise(() => undefined)),
  setBiometricEnabled: vi.fn(),
  verifyPin: vi.fn()
}));

import { SettingsPage } from './SettingsPage';

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  employeeFirstName: 'Олена',
  employeeLastName: 'Тестова',
  onboardingCompleted: true
};

afterEach(cleanup);

describe('SettingsPage', () => {
  it('creates a custom night template and keeps built-ins read-only', async () => {
    const onSettingsChange = vi.fn().mockResolvedValue(undefined);

    render(
      <SettingsPage
        settings={settings}
        onSettingsChange={onSettingsChange}
        onLocalDataReplace={vi.fn()}
        onLocalDataChange={vi.fn()}
        onSecurityChange={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.queryByLabelText('Редагувати 1 зміна')).toBeNull();
    expect(screen.queryByLabelText('Видалити 2 зміна')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));
    fireEvent.change(screen.getByLabelText('Назва', { exact: true }), {
      target: { value: 'Нічна' }
    });
    fireEvent.change(screen.getByLabelText('Початок', { exact: true }), {
      target: { value: '22:00' }
    });
    fireEvent.change(screen.getByLabelText('Кінець', { exact: true }), {
      target: { value: '06:00' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Зберегти шаблон' }));

    await waitFor(() => expect(onSettingsChange).toHaveBeenCalledOnce());
    const nextSettings = onSettingsChange.mock.calls[0][0] as Settings;
    expect(nextSettings.shiftTemplates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Нічна',
          startTime: '22:00',
          endTime: '06:00',
          isBuiltIn: false,
          enabled: true
        })
      ])
    );
  });

  it('renders FAQ and numeric notification fields', () => {
    const { container } = render(
      <SettingsPage
        settings={settings}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
        onSecurityChange={vi.fn().mockResolvedValue(undefined)}
      />
    );

    expect(screen.getAllByRole('group')).toBeDefined();
    expect(container.querySelectorAll('details')).toHaveLength(10);
    const notificationInputs = container.querySelectorAll(
      '.settings-page__notification-minutes input'
    );

    expect(notificationInputs).toHaveLength(3);
    notificationInputs.forEach((input) => {
      expect(input.getAttribute('inputmode')).toBe('numeric');
    });
  });
});
