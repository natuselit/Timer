// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  date: `2026-${string}`,
  coefficientMode: CoefficientMode,
  overrides: Partial<Shift> = {}
): Shift => {
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
    updatedAt: `${date}T14:30:00.000+03:00`,
    ...overrides
  };
};

beforeEach(async () => {
  await localDb.shifts.clear();
  await localDb.shifts.bulkPut([
    makeShift('previous-period', '2026-06-15', 'x1'),
    makeShift('auto-overtime', '2026-07-25', 'auto', {
      startTime: '2026-07-25T06:20:00.000+03:00',
      endTime: '2026-07-25T14:40:00.000+03:00',
      gradeSnapshot: {
        currentGrade: 2,
        desiredGrade: 3,
        gradeSalaryBonusPercents: [10, 10, 10, 10],
        gradeNormPercents: [100, 120, 140, 160],
        cumulativeSalaryBonusPercent: 20
      },
      workTickets: [
        {
          id: 'filled-ticket',
          normPerEightHours: 48,
          startedAt: '2026-07-25T07:00:00.000+03:00',
          endedAt: '2026-07-25T08:00:00.000+03:00',
          actualQuantity: 12,
          downtimeMinutes: 0,
          createdAt: '2026-07-25T07:00:00.000+03:00',
          updatedAt: '2026-07-25T08:00:00.000+03:00'
        }
      ]
    }),
    makeShift('x1.5', '2026-07-26', 'x1.5'),
    makeShift('x2', '2026-07-27', 'x2', {
      startTime: '2026-07-27T06:45:00.000+03:00',
      endTime: '2026-07-27T14:20:00.000+03:00'
    })
  ]);
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await localDb.shifts.clear();
});

describe('AnalyticsPage', () => {
  it('shows coefficients, period comparison, discipline and explicit G1 targets', async () => {
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
    expect(screen.getByRole('heading', { name: 'Порівняння' })).toBeTruthy();
    expect(screen.getByText('01.07–31.07 проти 01.06–30.06')).toBeTruthy();
    expect(screen.getAllByText('Зараз')).toHaveLength(4);
    expect(screen.getAllByText('Було')).toHaveLength(4);
    expect(screen.getAllByText('Різниця')).toHaveLength(3);
    expect(screen.getByText('Різниця, в.п.')).toBeTruthy();
    expect(screen.getByText('За перепрацювання')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Дотримання графіка' })).toBeTruthy();
    expect(screen.getByLabelText('Запізнення: 15 хв')).toBeTruthy();
    expect(screen.getByLabelText('Ранній вихід: 10 хв')).toBeTruthy();
    expect(screen.getByText('План G1')).toBeTruthy();
    expect(screen.getByText('Виконання від G1')).toBeTruthy();
  });

  it('switches comparison offsets without changing the selected calendar range', async () => {
    const user = userEvent.setup();
    const onCalendarMonthChange = vi.fn();
    const onSelectedRangeChange = vi.fn();

    render(
      <AnalyticsPage
        settings={settings}
        calendarMonth={{ year: 2026, month: 7 }}
        selectedRange={{ start: '2026-07-01', end: '2026-07-31' }}
        onCalendarMonthChange={onCalendarMonthChange}
        onSelectedRangeChange={onSelectedRangeChange}
        activeRangePreset="month"
        isAllTimePresetEnabled
        onRangePresetSelect={vi.fn()}
      />
    );

    expect(await screen.findByText('01.07–31.07 проти 01.06–30.06')).toBeTruthy();

    const presetGroup = screen.getByRole('group', { name: 'Період порівняння' });
    const weekButton = within(presetGroup).getByRole('button', { name: 'Тиждень' });
    const monthButton = within(presetGroup).getByRole('button', { name: 'Місяць' });

    expect(monthButton.getAttribute('aria-pressed')).toBe('true');
    expect(weekButton.getAttribute('aria-pressed')).toBe('false');

    await user.click(weekButton);

    expect(await screen.findByText('01.07–31.07 проти 24.06–24.07')).toBeTruthy();
    expect(screen.getByText('У попередньому періоді немає змін для порівняння.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Тиждень' }).getAttribute('aria-pressed')
    ).toBe('true');

    await user.click(screen.getByRole('button', { name: '2 місяці' }));

    expect(await screen.findByText('01.07–31.07 проти 01.05–31.05')).toBeTruthy();
    expect(onCalendarMonthChange).not.toHaveBeenCalled();
    expect(onSelectedRangeChange).not.toHaveBeenCalled();
  });

  it('masks overtime income and salary comparison in incognito mode', async () => {
    const { container } = render(
      <AnalyticsPage
        settings={{ ...settings, incognitoEnabled: true }}
        calendarMonth={{ year: 2026, month: 7 }}
        selectedRange={{ start: '2026-07-01', end: '2026-07-31' }}
        onCalendarMonthChange={vi.fn()}
        onSelectedRangeChange={vi.fn()}
        activeRangePreset="month"
        isAllTimePresetEnabled
        onRangePresetSelect={vi.fn()}
      />
    );

    expect(await screen.findByRole('heading', { name: 'Гроші' })).toBeTruthy();

    const overtimeLabel = screen.getByText('За перепрацювання');
    const comparisonGrid = container.querySelector('[aria-label="Зміни до попереднього періоду"]');
    const salaryComparison = comparisonGrid?.querySelector('article:first-child');

    expect(overtimeLabel.nextElementSibling?.textContent).toBe('••••');
    expect(salaryComparison?.textContent?.match(/••••/g)).toHaveLength(4);
  });

  it('compares only elapsed current-month days with the same dates last month', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 4, 12));
    await localDb.shifts.clear();
    await localDb.shifts.bulkPut([
      makeShift('july-1', '2026-07-01', 'x1'),
      makeShift('july-2', '2026-07-02', 'x1'),
      makeShift('july-later', '2026-07-20', 'x1'),
      makeShift('august-1', '2026-08-01', 'x1'),
      makeShift('august-2', '2026-08-02', 'x1'),
      makeShift('august-future', '2026-08-20', 'x1')
    ]);

    render(
      <AnalyticsPage
        settings={settings}
        calendarMonth={{ year: 2026, month: 8 }}
        selectedRange={{ start: '2026-08-01', end: '2026-08-31' }}
        onCalendarMonthChange={vi.fn()}
        onSelectedRangeChange={vi.fn()}
        activeRangePreset="month"
        isAllTimePresetEnabled
        onRangePresetSelect={vi.fn()}
      />
    );

    expect(await screen.findByText('01.08–04.08 проти 01.07–04.07')).toBeTruthy();

    const shiftComparison = screen.getByText('Кількість змін').closest('article');

    expect(shiftComparison).not.toBeNull();
    expect(within(shiftComparison!).getAllByText('2')).toHaveLength(2);
  });
});
