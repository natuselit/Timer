import { describe, expect, it } from 'vitest';
import type { Shift } from '../../../entities/shift';
import { calculateAnalyticsSummary } from './analyticsSummary';

const makeShift = (overrides: Partial<Shift> = {}): Shift => ({
  id: 'shift-1',
  date: '2026-06-23',
  type: 'first',
  detectionMode: 'manual',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  startTime: '2026-06-23T06:30:00.000+03:00',
  endTime: '2026-06-23T14:30:00.000+03:00',
  baseHourlyRateSnapshot: 120,
  hourlyRateSnapshot: 120,
  gradeSnapshot: null,
  workTickets: [],
  coefficientMode: 'auto',
  isAutoClosed: false,
  createdAt: '2026-06-23T06:30:00.000+03:00',
  updatedAt: '2026-06-23T14:30:00.000+03:00',
  ...overrides
});

describe('calculateAnalyticsSummary', () => {
  it('aggregates salary, time, discipline, overtime and shift type statistics for current month', () => {
    const summary = calculateAnalyticsSummary({
      now: '2026-06-23T20:00:00.000+03:00',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      monthlyBonus: 2_000,
      includeMonthlyBonus: true,
      shifts: [
        makeShift({
          id: 'first-overtime',
          date: '2026-06-10',
          startTime: '2026-06-10T06:20:00.000+03:00',
          endTime: '2026-06-10T14:40:00.000+03:00'
        }),
        makeShift({
          id: 'second-short',
          date: '2026-06-11',
          type: 'second',
          plannedStartTime: '14:30',
          plannedEndTime: '22:30',
          startTime: '2026-06-11T14:45:00.000+03:00',
          endTime: '2026-06-11T22:20:00.000+03:00'
        }),
        makeShift({
          id: 'previous-month',
          date: '2026-05-31',
          startTime: '2026-05-31T06:30:00.000+03:00',
          endTime: '2026-05-31T14:30:00.000+03:00'
        })
      ]
    });

    expect(summary).toMatchObject({
      workSalary: 1_930,
      currentSalary: 1_930,
      totalMinutes: 955,
      shiftCount: 2,
      overtimeMinutes: 20,
      overtimeIncome: 60,
      averageOvertimeMinutes: 10,
      maxOvertimeMinutes: 20,
      lateArrivalMinutes: 15,
      earlyExitMinutes: 10,
      coefficientBreakdown: [
        {
          coefficient: 1,
          minutes: 935,
          amount: 1_870
        },
        {
          coefficient: 1.5,
          minutes: 20,
          amount: 60
        }
      ],
      deviations: [
        {
          date: '2026-06-11',
          lateArrivalMinutes: 15,
          earlyExitMinutes: 10
        }
      ],
      firstShift: {
        shiftCount: 1,
        salaryAmount: 1_020,
        totalMinutes: 500,
        overtimeMinutes: 20
      },
      secondShift: {
        shiftCount: 1,
        salaryAmount: 910,
        totalMinutes: 455,
        overtimeMinutes: 0
      },
      monthlyBonus: 2_000
    });
  });

  it('uses current time for active shifts in aggregates', () => {
    const summary = calculateAnalyticsSummary({
      now: '2026-06-23T07:30:00.000+03:00',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      monthlyBonus: 0,
      includeMonthlyBonus: true,
      shifts: [
        makeShift({
          endTime: null
        })
      ]
    });

    expect(summary.workSalary).toBe(120);
    expect(summary.currentSalary).toBe(120);
    expect(summary.totalMinutes).toBe(60);
  });

  it('aggregates the selected period instead of the current month', () => {
    const summary = calculateAnalyticsSummary({
      now: '2026-06-23T20:00:00.000+03:00',
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      monthlyBonus: 0,
      includeMonthlyBonus: false,
      shifts: [
        makeShift({
          id: 'may-shift',
          date: '2026-05-21',
          startTime: '2026-05-21T06:30:00.000+03:00',
          endTime: '2026-05-21T14:30:00.000+03:00'
        }),
        makeShift({
          id: 'june-shift',
          date: '2026-06-21',
          startTime: '2026-06-21T06:30:00.000+03:00',
          endTime: '2026-06-21T14:30:00.000+03:00'
        })
      ]
    });

    expect(summary.shiftCount).toBe(1);
    expect(summary.workSalary).toBe(960);
    expect(summary.plannedSalary).toBe(960);
  });

  it('does not add monthly bonus for a selected partial range', () => {
    const summary = calculateAnalyticsSummary({
      now: '2026-06-10T20:00:00.000+03:00',
      periodStart: '2026-06-10',
      periodEnd: '2026-06-10',
      monthlyBonus: 2_000,
      includeMonthlyBonus: false,
      shifts: [
        makeShift({
          id: 'selected-day',
          date: '2026-06-10',
          startTime: '2026-06-10T06:30:00.000+03:00',
          endTime: '2026-06-10T14:30:00.000+03:00'
        })
      ]
    });

    expect(summary.workSalary).toBe(960);
    expect(summary.monthlyBonus).toBe(0);
    expect(summary.plannedSalary).toBe(960);
  });

  it('adds monthly bonus for a full month period', () => {
    const summary = calculateAnalyticsSummary({
      now: '2026-06-30T20:00:00.000+03:00',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      monthlyBonus: 2_000,
      includeMonthlyBonus: true,
      shifts: [
        makeShift({
          id: 'full-month-shift',
          date: '2026-06-10',
          startTime: '2026-06-10T06:30:00.000+03:00',
          endTime: '2026-06-10T14:30:00.000+03:00'
        })
      ]
    });

    expect(summary.workSalary).toBe(960);
    expect(summary.monthlyBonus).toBe(2_000);
    expect(summary.plannedSalary).toBe(2_960);
  });

  it('adds monthly bonus without projecting future shifts for a past period', () => {
    const summary = calculateAnalyticsSummary({
      now: '2026-06-23T20:00:00.000+03:00',
      periodStart: '2026-05-01',
      periodEnd: '2026-05-31',
      monthlyBonus: 2_000,
      includeMonthlyBonus: true,
      shifts: [
        makeShift({
          id: 'past-window',
          date: '2026-05-21',
          startTime: '2026-05-21T06:30:00.000+03:00',
          endTime: '2026-05-21T14:30:00.000+03:00'
        })
      ]
    });

    expect(summary.plannedSalary).toBe(2_960);
  });

  it('aggregates manual coefficient shifts into their selected coefficients', () => {
    const summary = calculateAnalyticsSummary({
      now: '2026-06-23T20:00:00.000+03:00',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      monthlyBonus: 0,
      includeMonthlyBonus: false,
      shifts: [
        makeShift({
          id: 'manual-x1-5',
          date: '2026-06-10',
          coefficientMode: 'x1.5',
          startTime: '2026-06-10T06:30:00.000+03:00',
          endTime: '2026-06-10T14:30:00.000+03:00'
        }),
        makeShift({
          id: 'manual-x2',
          date: '2026-06-11',
          coefficientMode: 'x2',
          startTime: '2026-06-11T06:30:00.000+03:00',
          endTime: '2026-06-11T14:30:00.000+03:00'
        })
      ]
    });

    expect(summary.coefficientBreakdown).toEqual([
      {
        coefficient: 1.5,
        minutes: 480,
        amount: 1_440
      },
      {
        coefficient: 2,
        minutes: 480,
        amount: 1_920
      }
    ]);
  });
});
