import { describe, expect, it } from 'vitest';
import {
  calculateCumulativeGradePercent,
  calculateGradeMonthlyBonus,
  calculateGradeProductionTarget,
  calculateHourlyRateFromMonthlySalary,
  calculateMonthlySalaryFromHourlyRate,
  getNextDesiredGrade,
  countWeekdayWorkdaysInMonth,
  WORK_HOURS_PER_DAY
} from './salary';
import type { Settings } from './types';

describe('settings domain types', () => {
  it('accepts salary, coefficient, detection and incognito settings', () => {
    const settings = {
      employeeFirstName: 'Тарас',
      employeeLastName: 'Шевченко',
      monthlySalary: 17_600,
      monthlyBonus: 2000,
      currentGrade: 1,
      desiredGrade: 2,
      gradeSalaryBonusPercents: [10, 10, 10, 10],
      gradeNormPercents: [100, 120, 140, 160],
      forecastDays: 30,
      arriveHoldDelayMs: 1500,
      leaveHoldDelayMs: 1500,
      coefficientMode: 'auto',
      shiftDetectionMode: 'auto',
      themePreference: 'system',
      backupReminderIntervalDays: 14,
      overtimeLimitPercent: 0,
      overtimeStepMinutes: 30,
      overtimeStrategy: 'standard',
      overtimeSaturdayCount: 1,
      overtimeWeekdayMaxMinutes: 240,
      overtimeSaturdayMaxMinutes: 480,
      overtimeUnavailableDates: [],
      incognitoEnabled: false,
      onboardingCompleted: true,
      updatedAt: '2026-06-23T08:00:00.000+03:00'
    } satisfies Settings;

    expect(settings.employeeFirstName).toBe('Тарас');
    expect(settings.employeeLastName).toBe('Шевченко');
    expect(settings.coefficientMode).toBe('auto');
    expect(settings.shiftDetectionMode).toBe('auto');
    expect(settings.themePreference).toBe('system');
    expect(settings.overtimeLimitPercent).toBe(0);
    expect(settings.overtimeStepMinutes).toBe(30);
    expect(settings.overtimeStrategy).toBe('standard');
    expect(settings.overtimeSaturdayCount).toBe(1);
    expect(settings.overtimeWeekdayMaxMinutes).toBe(240);
    expect(settings.overtimeSaturdayMaxMinutes).toBe(480);
    expect(settings.overtimeUnavailableDates).toEqual([]);
    expect(settings.incognitoEnabled).toBe(false);
    expect(settings.onboardingCompleted).toBe(true);
  });

  it('calculates hourly rate from monthly salary for weekday 5/2 schedule', () => {
    expect(WORK_HOURS_PER_DAY).toBe(8);
    expect(countWeekdayWorkdaysInMonth(2026, 6)).toBe(22);
    expect(calculateHourlyRateFromMonthlySalary(17_600, '2026-06-15')).toBe(100);
  });

  it('calculates monthly salary from old hourly rate for migration', () => {
    expect(calculateMonthlySalaryFromHourlyRate(100, '2026-06-24')).toBe(17_600);
  });

  it('calculates cumulative grade salary bonus', () => {
    expect(calculateCumulativeGradePercent(1, [10, 10, 15, 15])).toBe(10);
    expect(calculateCumulativeGradePercent(2, [10, 10, 15, 15])).toBe(20);
    expect(calculateCumulativeGradePercent(3, [10, 10, 15, 15])).toBe(35);
    expect(calculateCumulativeGradePercent(4, [10, 10, 15, 15])).toBe(50);
  });

  it('selects the next desired grade for current grade changes', () => {
    expect(getNextDesiredGrade(1)).toBe(2);
    expect(getNextDesiredGrade(2)).toBe(3);
    expect(getNextDesiredGrade(3)).toBe(4);
    expect(getNextDesiredGrade(4)).toBe(4);
  });

  it('calculates a separate cumulative grade monthly bonus', () => {
    expect(calculateGradeMonthlyBonus(20_000, 20)).toBe(4_000);
  });

  it('calculates grade production target for elapsed ticket time', () => {
    expect(
      calculateGradeProductionTarget({
        normPerEightHours: 50,
        gradeNormPercent: 120,
        elapsedMinutes: 120
      })
    ).toBe(15);
    expect(
      calculateGradeProductionTarget({
        normPerEightHours: 50,
        gradeNormPercent: 120,
        elapsedMinutes: 121
      })
    ).toBe(16);
  });
});
