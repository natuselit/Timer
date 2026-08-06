import { describe, expect, it } from 'vitest';
import type { AnalyticsSummary } from './analyticsSummary';
import {
  calculateAnalyticsPeriodComparison,
  getAnalyticsComparisonRanges
} from './analyticsComparison';

const makeSummary = (overrides: Partial<AnalyticsSummary> = {}): AnalyticsSummary => ({
  currentSalary: 0,
  workSalary: 0,
  plannedSalary: 0,
  monthlyBonus: 0,
  gradeBonus: 0,
  averageSalaryPerShift: 0,
  effectiveHourlyIncome: 0,
  totalMinutes: 0,
  shiftCount: 0,
  completedShiftCount: 0,
  averageShiftMinutes: 0,
  overtimeMinutes: 0,
  overtimeIncome: 0,
  averageOvertimeMinutes: 0,
  maxOvertimeMinutes: 0,
  lateArrivalMinutes: 0,
  earlyExitMinutes: 0,
  lateArrivalShiftCount: 0,
  earlyExitShiftCount: 0,
  onScheduleShiftCount: 0,
  averageLateArrivalMinutes: 0,
  averageEarlyExitMinutes: 0,
  scheduleAdherencePercent: null,
  coefficientBreakdown: [],
  deviations: [],
  firstShift: {
    shiftCount: 0,
    salaryAmount: 0,
    totalMinutes: 0,
    overtimeMinutes: 0
  },
  secondShift: {
    shiftCount: 0,
    salaryAmount: 0,
    totalMinutes: 0,
    overtimeMinutes: 0
  },
  production: {
    ticketCount: 0,
    filledTicketCount: 0,
    unfilledTicketCount: 0,
    actualQuantity: 0,
    productiveMinutes: 0,
    downtimeMinutes: 0,
    gradeOneTarget: 0,
    currentGradeTarget: 0,
    completionPercent: null,
    averageActualPerTicket: 0,
    averageTicketsPerShift: 0,
    quantityPerProductiveHour: null,
    averageProductiveMinutesPerTicket: 0,
    averageDowntimeMinutesPerTicket: 0,
    downtimePercent: null
  },
  ...overrides
});

describe('getAnalyticsComparisonRanges', () => {
  it('compares an elapsed current-month range with the same dates one month earlier', () => {
    expect(
      getAnalyticsComparisonRanges(
        { start: '2026-08-01', end: '2026-08-31' },
        '2026-08-04'
      )
    ).toEqual({
      current: { start: '2026-08-01', end: '2026-08-04' },
      previous: { start: '2026-07-01', end: '2026-07-04' }
    });
  });

  it('uses the complete previous month for a complete past month', () => {
    expect(
      getAnalyticsComparisonRanges(
        { start: '2026-07-01', end: '2026-07-31' },
        '2026-08-04'
      )
    ).toEqual({
      current: { start: '2026-07-01', end: '2026-07-31' },
      previous: { start: '2026-06-01', end: '2026-06-30' }
    });
  });

  it('shifts both boundaries by seven days for the week preset across a year boundary', () => {
    expect(
      getAnalyticsComparisonRanges(
        { start: '2026-01-03', end: '2026-01-10' },
        '2026-02-01',
        'week'
      )
    ).toEqual({
      current: { start: '2026-01-03', end: '2026-01-10' },
      previous: { start: '2025-12-27', end: '2026-01-03' }
    });
  });

  it('shifts by two calendar months and clamps missing month-end dates', () => {
    expect(
      getAnalyticsComparisonRanges(
        { start: '2026-01-31', end: '2026-02-28' },
        '2026-03-01',
        'twoMonths'
      )
    ).toEqual({
      current: { start: '2026-01-31', end: '2026-02-28' },
      previous: { start: '2025-11-30', end: '2025-12-28' }
    });
  });

  it('trims future dates before applying week and two-month presets', () => {
    const range = { start: '2026-08-01', end: '2026-08-31' } as const;

    expect(getAnalyticsComparisonRanges(range, '2026-08-04', 'week')).toEqual({
      current: { start: '2026-08-01', end: '2026-08-04' },
      previous: { start: '2026-07-25', end: '2026-07-28' }
    });
    expect(getAnalyticsComparisonRanges(range, '2026-08-04', 'twoMonths')).toEqual({
      current: { start: '2026-08-01', end: '2026-08-04' },
      previous: { start: '2026-06-01', end: '2026-06-04' }
    });
  });

  it('compares a custom range and one day with the same dates one month earlier', () => {
    expect(
      getAnalyticsComparisonRanges(
        { start: '2026-08-10', end: '2026-08-16' },
        '2026-08-20'
      ).previous
    ).toEqual({ start: '2026-07-10', end: '2026-07-16' });
    expect(
      getAnalyticsComparisonRanges(
        { start: '2026-08-04', end: '2026-08-04' },
        '2026-08-04'
      ).previous
    ).toEqual({ start: '2026-07-04', end: '2026-07-04' });
  });

  it('clamps missing dates to the final day of the previous month', () => {
    expect(
      getAnalyticsComparisonRanges(
        { start: '2026-03-31', end: '2026-03-31' },
        '2026-04-01'
      ).previous
    ).toEqual({ start: '2026-02-28', end: '2026-02-28' });
  });

  it('shifts both boundaries of a cross-month range', () => {
    expect(
      getAnalyticsComparisonRanges(
        { start: '2026-07-31', end: '2026-08-02' },
        '2026-08-04'
      )
    ).toEqual({
      current: { start: '2026-07-31', end: '2026-08-02' },
      previous: { start: '2026-06-30', end: '2026-07-02' }
    });
  });
});

describe('calculateAnalyticsPeriodComparison', () => {
  it('calculates relative and percentage-point changes', () => {
    const current = makeSummary({
      workSalary: 1_500,
      totalMinutes: 600,
      shiftCount: 3,
      production: {
        ...makeSummary().production,
        completionPercent: 120
      }
    });
    const previous = makeSummary({
      workSalary: 1_000,
      totalMinutes: 480,
      shiftCount: 2,
      production: {
        ...makeSummary().production,
        completionPercent: 80
      }
    });

    expect(calculateAnalyticsPeriodComparison(current, previous)).toEqual({
      hasPreviousData: true,
      salaryPercentChange: 50,
      salaryAmountChange: 500,
      workedMinutesPercentChange: 25,
      workedMinutesChange: 120,
      shiftCountPercentChange: 50,
      shiftCountChange: 1,
      completionPercentChange: 50,
      completionPercentagePointChange: 40
    });
  });

  it('does not invent relative changes when the previous value is zero', () => {
    const comparison = calculateAnalyticsPeriodComparison(
      makeSummary({ workSalary: 100, totalMinutes: 60, shiftCount: 1 }),
      makeSummary()
    );

    expect(comparison).toMatchObject({
      hasPreviousData: false,
      salaryPercentChange: null,
      salaryAmountChange: 100,
      workedMinutesPercentChange: null,
      workedMinutesChange: 60,
      shiftCountPercentChange: null,
      completionPercentChange: null,
      completionPercentagePointChange: null
    });
  });

  it('keeps the salary difference consistent with rounded displayed totals', () => {
    const comparison = calculateAnalyticsPeriodComparison(
      makeSummary({ workSalary: 69_900.6, shiftCount: 1 }),
      makeSummary({ workSalary: 76_088.5, shiftCount: 1 })
    );

    expect(comparison.salaryAmountChange).toBe(-6_188);
  });
});
