// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../../entities/settings';
import type { Shift } from '../../../entities/shift';
import { localDb } from '../../../shared/lib/local-db';
import { MainPage } from './MainPage';

const settings: Settings = {
  employeeFirstName: 'Артем',
  employeeLastName: 'Кухарчук',
  monthlySalary: 50_800,
  monthlyBonus: 2_000,
  currentGrade: 1,
  desiredGrade: 2,
  gradeSalaryBonusPercents: [10, 10, 10, 10],
  gradeNormPercents: [100, 120, 140, 160],
  forecastDays: 30,
  arriveHoldDelayMs: 1_500,
  leaveHoldDelayMs: 1_500,
  coefficientMode: 'auto',
  shiftDetectionMode: 'auto',
  themePreference: 'system',
  incognitoEnabled: false,
  onboardingCompleted: true,
  updatedAt: '2026-07-27T06:00:00.000+03:00'
};

const activeShift: Shift = {
  id: 'active-shift',
  date: '2026-07-27',
  type: 'first',
  detectionMode: 'auto',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  startTime: '2026-07-27T06:15:00.000+03:00',
  endTime: null,
  baseHourlyRateSnapshot: 280,
  hourlyRateSnapshot: 280,
  gradeSnapshot: null,
  workTickets: [
    {
      id: 'active-ticket',
      normPerEightHours: 80,
      startedAt: '2026-07-27T06:15:00.000+03:00',
      endedAt: null,
      actualQuantity: null,
      downtimeMinutes: 5,
      createdAt: '2026-07-27T06:15:00.000+03:00',
      updatedAt: '2026-07-27T06:15:00.000+03:00'
    }
  ],
  coefficientMode: 'x2',
  isAutoClosed: false,
  createdAt: '2026-07-27T06:15:00.000+03:00',
  updatedAt: '2026-07-27T06:15:00.000+03:00'
};

beforeEach(async () => {
  vi.stubGlobal('scrollTo', vi.fn());
  await localDb.shifts.clear();
  await localDb.enterpriseSchedule.clear();
  await localDb.appMeta.clear();
  await localDb.settings.clear();
  await localDb.shifts.put(activeShift);
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await localDb.shifts.clear();
});

describe('MainPage active shift', () => {
  it('shows the effective coefficient and keeps signed downtime on the text keyboard', async () => {
    render(
      <MainPage
        settings={settings}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    expect(await screen.findByLabelText('Поточний коефіцієнт: x2')).toBeTruthy();
    expect(screen.queryByText('Коефіцієнт зараз')).toBeNull();
    expect(screen.queryByText('Потрібно для G1')).toBeNull();
    expect(screen.queryByText(/Додайте або відніміть/)).toBeNull();
    expect(screen.getByLabelText('Редагувати активний тікет')).toBeTruthy();
    expect(screen.getByLabelText('Видалити активний тікет')).toBeTruthy();
    expect(screen.getByLabelText('Загальний простій: 0:05')).toBeTruthy();

    const downtimeAdjustment = screen.getByLabelText(
      'Коригування, хв'
    ) as HTMLInputElement;
    const actualQuantity = screen.getByLabelText(
      'Фактично зроблено, шт'
    ) as HTMLInputElement;

    expect(downtimeAdjustment.inputMode).toBe('text');
    expect(downtimeAdjustment.pattern).toBe('[+-]?[0-9]*');
    expect(actualQuantity.inputMode).toBe('numeric');
    expect(actualQuantity.pattern).toBe('[0-9]*');
  });

  it('masks the compact coefficient badge in incognito mode', async () => {
    render(
      <MainPage
        settings={{ ...settings, incognitoEnabled: true }}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    expect(await screen.findByLabelText('Поточний коефіцієнт: ••••')).toBeTruthy();
    expect(screen.queryByLabelText('Поточний коефіцієнт: x2')).toBeNull();
  });
});
