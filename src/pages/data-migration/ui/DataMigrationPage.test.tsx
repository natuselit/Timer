// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../../entities/settings';
import type { Shift } from '../../../entities/shift';
import {
  BACKUP_SCHEMA_VERSION,
  localDb,
  serializeBackup,
  SettingsRepository
} from '../../../shared/lib/local-db';
import { LEGACY_GITHUB_PAGES_URL } from '../../../shared/config/sitesMigration';
import { DataMigrationPage } from './DataMigrationPage';

const currentSettings: Settings = {
  employeeFirstName: '',
  employeeLastName: '',
  monthlySalary: 0,
  monthlyBonus: 0,
  currentGrade: 1,
  desiredGrade: 2,
  gradeSalaryBonusPercents: [10, 10, 15, 15],
  gradeNormPercents: [100, 120, 140, 160],
  forecastDays: 30,
  arriveHoldDelayMs: 1500,
  leaveHoldDelayMs: 1500,
  shiftDetectionMode: 'auto',
  themePreference: 'system',
  backupReminderIntervalDays: 14,
  overtimeLimitPercent: 0,
  overtimeStepMinutes: 30,
  overtimeStrategy: 'standard',
  overtimeWeekdayMaxMinutes: 240,
  overtimeSaturdayMaxMinutes: 480,
  overtimeUnavailableDates: [],
  incognitoEnabled: false,
  onboardingCompleted: false,
  updatedAt: '2026-08-15T09:00:00.000Z'
};

const restoredSettings: Settings = {
  ...currentSettings,
  employeeFirstName: 'Артем',
  employeeLastName: 'Кухарчук',
  monthlySalary: 50_800,
  onboardingCompleted: true,
  updatedAt: '2026-08-14T20:00:00.000Z'
};

const restoredShift: Shift = {
  id: 'restored-shift',
  date: '2026-08-14',
  type: 'first',
  detectionMode: 'auto',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  startTime: '2026-08-14T06:30:00.000+03:00',
  endTime: '2026-08-14T14:30:00.000+03:00',
  baseHourlyRateSnapshot: 300,
  hourlyRateSnapshot: 300,
  gradeSnapshot: null,
  workTickets: [],
  note: '',
  coefficientMode: 'auto',
  isAutoClosed: false,
  createdAt: '2026-08-14T06:30:00.000+03:00',
  updatedAt: '2026-08-14T14:30:00.000+03:00'
};

const makeBackupSource = (): string =>
  serializeBackup({
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: '2026-08-14T20:00:00.000Z',
    settings: restoredSettings,
    shifts: [restoredShift],
    enterpriseSchedule: [],
    reviewedScheduleWarnings: [],
    confirmedSaturdayDoubleRateMonths: []
  });

const selectBackupSource = (container: HTMLElement, source: string) => {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = { text: vi.fn().mockResolvedValue(source) };

  fireEvent.change(input, { target: { files: [file] } });
};

beforeEach(async () => {
  await localDb.settings.clear();
  await localDb.shifts.clear();
  await localDb.enterpriseSchedule.clear();
  await localDb.appMeta.clear();
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await localDb.settings.clear();
  await localDb.shifts.clear();
  await localDb.enterpriseSchedule.clear();
  await localDb.appMeta.clear();
});

describe('DataMigrationPage', () => {
  it('shows a safe three-step path back to GitHub Pages', () => {
    render(
      <DataMigrationPage
        currentSettings={currentSettings}
        onComplete={vi.fn().mockResolvedValue(undefined)}
        onSkip={vi.fn().mockResolvedValue(undefined)}
      />
    );

    const legacyLink = screen.getByRole('link', {
      name: 'Відкрити стару версію'
    }) as HTMLAnchorElement;

    expect(legacyLink.href).toBe(LEGACY_GITHUB_PAGES_URL);
    expect(screen.getByText(/«Дані та backup»/)).toBeTruthy();
    expect(screen.getByText(/Імпорт можна виконати пізніше/)).toBeTruthy();
  });

  it('restores a validated backup before opening the Sites app', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { container } = render(
      <DataMigrationPage
        currentSettings={currentSettings}
        onComplete={onComplete}
        onSkip={vi.fn().mockResolvedValue(undefined)}
      />
    );

    selectBackupSource(container, makeBackupSource());

    expect(await screen.findByRole('heading', { name: 'Дані відновлено' })).toBeTruthy();
    expect(screen.getByText(/Відновлено змін: 1, записів графіка: 0/)).toBeTruthy();
    await expect(new SettingsRepository(localDb).getSettings()).resolves.toEqual(
      restoredSettings
    );
    await expect(localDb.shifts.get(restoredShift.id)).resolves.toEqual(restoredShift);

    await user.click(screen.getByRole('button', { name: 'Відкрити застосунок' }));
    expect(onComplete).toHaveBeenCalledWith(restoredSettings);
  });

  it('keeps current Sites data untouched when the JSON is invalid', async () => {
    await localDb.shifts.put(restoredShift);
    const { container } = render(
      <DataMigrationPage
        currentSettings={currentSettings}
        onComplete={vi.fn().mockResolvedValue(undefined)}
        onSkip={vi.fn().mockResolvedValue(undefined)}
      />
    );

    selectBackupSource(container, '{');

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Файл не є валідним JSON.'
    );
    await waitFor(async () => {
      await expect(localDb.shifts.get(restoredShift.id)).resolves.toEqual(restoredShift);
    });
  });

  it('allows starting clean without deleting the legacy origin', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <DataMigrationPage
        currentSettings={currentSettings}
        onComplete={vi.fn().mockResolvedValue(undefined)}
        onSkip={onSkip}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Почати без перенесення' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
