// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../../entities/settings';
import type { Shift } from '../../../entities/shift';
import { localDb } from '../../../shared/lib/local-db';
import { HistoryPage } from './HistoryPage';

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
  onboardingCompleted: true,
  updatedAt: '2026-07-27T06:00:00.000+03:00'
};

const makeShift = (overrides: Partial<Shift>): Shift => ({
  id: 'shift',
  date: '2026-07-27',
  type: 'first',
  detectionMode: 'auto',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  startTime: '2026-07-27T06:30:00.000+03:00',
  endTime: '2026-07-27T14:30:00.000+03:00',
  baseHourlyRateSnapshot: 280,
  hourlyRateSnapshot: 280,
  gradeSnapshot: null,
  workTickets: [],
  note: '',
  coefficientMode: 'auto',
  isAutoClosed: false,
  createdAt: '2026-07-27T06:30:00.000+03:00',
  updatedAt: '2026-07-27T14:30:00.000+03:00',
  ...overrides
});

beforeEach(async () => {
  await localDb.shifts.clear();
  await localDb.appMeta.clear();
  await localDb.shifts.bulkPut([
    makeShift({
      id: 'mixed-coefficients',
      startTime: '2026-07-27T06:20:00.000+03:00',
      note: 'Передати партію наступній зміні',
      gradeSnapshot: {
        currentGrade: 2,
        desiredGrade: 3,
        gradeSalaryBonusPercents: [10, 10, 15, 15],
        gradeNormPercents: [100, 120, 140, 160],
        cumulativeSalaryBonusPercent: 20
      },
      workTickets: [
        {
          id: 'grade-one-completion-ticket',
          normPerEightHours: 60,
          startedAt: '2026-07-27T06:55:00.000+03:00',
          endedAt: '2026-07-27T10:15:00.000+03:00',
          actualQuantity: 20,
          downtimeMinutes: 0,
          createdAt: '2026-07-27T06:55:00.000+03:00',
          updatedAt: '2026-07-27T10:15:00.000+03:00'
        }
      ]
    }),
    makeShift({
      id: 'active-single-coefficient',
      date: '2026-07-28',
      startTime: '2026-07-28T14:30:00.000+03:00',
      endTime: null,
      type: 'second',
      plannedStartTime: '14:30',
      plannedEndTime: '22:30',
      coefficientMode: 'x1',
      createdAt: '2026-07-28T14:30:00.000+03:00',
      updatedAt: '2026-07-28T14:30:00.000+03:00'
    })
  ]);
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await localDb.shifts.clear();
  await localDb.appMeta.clear();
});

describe('HistoryPage', () => {
  it('shows a saved shift note', async () => {
    render(
      <HistoryPage
        settings={settings}
        calendarMonth={{ year: 2026, month: 7 }}
        selectedRange={{ start: '2026-07-01', end: '2026-07-31' }}
        onCalendarMonthChange={vi.fn()}
        onSelectedRangeChange={vi.fn()}
        activeRangePreset="month"
        isAllTimePresetEnabled
        onRangePresetSelect={vi.fn()}
      />
    );

    expect(await screen.findByText('Передати партію наступній зміні')).toBeTruthy();
  });

  it('shows coefficient earnings only for mixed coefficients and marks the active badge', async () => {
    render(
      <HistoryPage
        settings={settings}
        calendarMonth={{ year: 2026, month: 7 }}
        selectedRange={{ start: '2026-07-01', end: '2026-07-31' }}
        onCalendarMonthChange={vi.fn()}
        onSelectedRangeChange={vi.fn()}
        activeRangePreset="month"
        isAllTimePresetEnabled
        onRangePresetSelect={vi.fn()}
      />
    );

    const activeBadge = await screen.findByText('Активна');
    const activeShiftCard = activeBadge.closest('article');

    expect(activeBadge.classList.contains('history-page__badge--active')).toBe(true);
    expect(activeShiftCard?.querySelector('.history-page__coefficients')).toBeNull();

    await waitFor(() => {
      expect(screen.getAllByLabelText('Зароблено по коефіцієнтах')).toHaveLength(1);
    });
  });

  it('calculates ticket completion against the G1 target regardless of current grade', async () => {
    render(
      <HistoryPage
        settings={settings}
        calendarMonth={{ year: 2026, month: 7 }}
        selectedRange={{ start: '2026-07-01', end: '2026-07-31' }}
        onCalendarMonthChange={vi.fn()}
        onSelectedRangeChange={vi.fn()}
        activeRangePreset="month"
        isAllTimePresetEnabled
        onRangePresetSelect={vi.fn()}
      />
    );

    const completionLabel = await screen.findByText('Виконання %');
    const completionTile = completionLabel.closest('div');

    expect(completionTile?.textContent).toContain('80%');
    expect(screen.queryByText('Виконання G2')).toBeNull();
  });
});
