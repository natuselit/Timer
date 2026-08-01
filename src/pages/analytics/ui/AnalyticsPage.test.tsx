// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../../entities/settings';
import type { CoefficientMode, Shift } from '../../../entities/shift';
import { localDb } from '../../../shared/lib/local-db';
import { AnalyticsPage } from './AnalyticsPage';

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
  backupReminderIntervalDays: 14,
  incognitoEnabled: false,
  onboardingCompleted: true,
  updatedAt: '2026-07-27T06:00:00.000+03:00'
};

const makeShift = (
  id: string,
  day: number,
  coefficientMode: CoefficientMode
): Shift => {
  const date = `2026-07-${String(day).padStart(2, '0')}` as const;

  return {
    id,
    date,
    type: 'first',
    detectionMode: 'auto',
    plannedStartTime: '06:30',
    plannedEndTime: '14:30',
    startTime: `${date}T06:30:00.000+03:00`,
    endTime: `${date}T14:30:00.000+03:00`,
    baseHourlyRateSnapshot: 280,
    hourlyRateSnapshot: 280,
    gradeSnapshot: null,
    workTickets: [],
    coefficientMode,
    isAutoClosed: false,
    createdAt: `${date}T06:30:00.000+03:00`,
    updatedAt: `${date}T14:30:00.000+03:00`
  };
};

beforeEach(async () => {
  await localDb.shifts.clear();
  await localDb.shifts.bulkPut([
    makeShift('x1', 25, 'x1'),
    makeShift('x1.5', 26, 'x1.5'),
    makeShift('x2', 27, 'x2')
  ]);
});

afterEach(async () => {
  cleanup();
  await localDb.shifts.clear();
});

describe('AnalyticsPage', () => {
  it('keeps coefficient tones identifiable and no longer renders schedule control', async () => {
    const { container } = render(
      <AnalyticsPage
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

    expect(await screen.findByRole('heading', { name: 'Відпрацьовано' })).toBeTruthy();
    expect(container.querySelector('[data-coefficient="1"]')).toBeTruthy();
    expect(container.querySelector('[data-coefficient="1.5"]')).toBeTruthy();
    expect(container.querySelector('[data-coefficient="2"]')).toBeTruthy();
    expect(container.querySelector('.analytics-page__detail-item--time-total')).toBeTruthy();
    expect(screen.queryByText('Контроль графіка')).toBeNull();
  });
});
