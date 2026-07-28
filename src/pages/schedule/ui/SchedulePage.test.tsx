// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EnterpriseScheduleItem } from '../../../entities/enterprise-schedule';
import type { Settings } from '../../../entities/settings';
import type { Shift } from '../../../entities/shift';
import {
  EnterpriseScheduleRepository,
  localDb,
  ScheduleWarningReviewRepository
} from '../../../shared/lib/local-db';
import { SchedulePage } from './SchedulePage';

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

const completedShift: Shift = {
  id: 'completed-shift',
  date: '2026-07-27',
  type: 'first',
  detectionMode: 'auto',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  startTime: '2026-07-27T06:40:00.000+03:00',
  endTime: '2026-07-27T14:20:00.000+03:00',
  baseHourlyRateSnapshot: 280,
  hourlyRateSnapshot: 280,
  gradeSnapshot: null,
  workTickets: [],
  coefficientMode: 'auto',
  isAutoClosed: false,
  createdAt: '2026-07-27T06:40:00.000+03:00',
  updatedAt: '2026-07-27T14:20:00.000+03:00'
};

const scheduleItem: EnterpriseScheduleItem = {
  id: 'enterprise-schedule-2026-07-27',
  date: '2026-07-27',
  shiftType: 'first',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  enterpriseStartTime: '06:30',
  enterpriseEndTime: '14:30',
  skipped: false,
  sourceText: '27.07.2026 In time 06:30 Out time 14:30 Total 08:00',
  createdAt: '2026-07-27T06:00:00.000+03:00',
  updatedAt: '2026-07-27T06:00:00.000+03:00'
};

const enterpriseScheduleRepository = new EnterpriseScheduleRepository(localDb);
const reviewRepository = new ScheduleWarningReviewRepository(localDb);

beforeEach(async () => {
  await localDb.shifts.clear();
  await localDb.enterpriseSchedule.clear();
  await localDb.appMeta.clear();
  await localDb.shifts.put(completedShift);
  await enterpriseScheduleRepository.importItems([scheduleItem]);
});

afterEach(async () => {
  cleanup();
  await localDb.shifts.clear();
  await localDb.enterpriseSchedule.clear();
  await localDb.appMeta.clear();
});

describe('SchedulePage', () => {
  it('shows schedule control, collapses records and persists reviewed warnings', async () => {
    const user = userEvent.setup();

    render(
      <SchedulePage
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

    expect(await screen.findByRole('heading', { name: 'Попередження' })).toBeTruthy();
    expect(screen.getByLabelText('Ставка за обраний місяць')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Розбіжності' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Місяць' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(screen.getByRole('button', { name: 'Обрати 1 число' }).getAttribute('aria-pressed')).toBe(
      'true'
    );

    const scheduleDetails = screen
      .getAllByRole('heading', { name: 'Графік підприємства' })[0]
      .closest('details');

    expect(scheduleDetails?.open).toBe(false);
    await user.click(screen.getByText('Записи'));
    expect(scheduleDetails?.open).toBe(true);
    expect(screen.getByText('06:30-14:30')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Переглянуто' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Попередження' })).toBeNull();
    });
    await expect(reviewRepository.getAll()).resolves.toMatchObject([
      {
        shiftId: completedShift.id
      }
    ]);
  });

  it('does not render an empty schedule-control block', async () => {
    await localDb.shifts.clear();

    render(
      <SchedulePage
        settings={settings}
        calendarMonth={{ year: 2026, month: 7 }}
        selectedRange={null}
        onCalendarMonthChange={vi.fn()}
        onSelectedRangeChange={vi.fn()}
        activeRangePreset={null}
        isAllTimePresetEnabled={false}
        onRangePresetSelect={vi.fn()}
      />
    );

    await screen.findAllByRole('heading', { name: 'Графік підприємства' });
    expect(screen.queryByRole('heading', { name: 'Попередження' })).toBeNull();
  });
});
