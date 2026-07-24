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
      averageSalaryPerShift: 965,
      effectiveHourlyIncome: 1_930 * 60 / 955,
      averageShiftMinutes: 477.5,
      averageOvertimeMinutes: 10,
      maxOvertimeMinutes: 20,
      lateArrivalMinutes: 15,
      earlyExitMinutes: 10,
      lateArrivalShiftCount: 1,
      earlyExitShiftCount: 1,
      onScheduleShiftCount: 1,
      averageLateArrivalMinutes: 15,
      averageEarlyExitMinutes: 10,
      scheduleAdherencePercent: 50,
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

  it('returns safe empty averages when the selected period has no shifts', () => {
    const summary = calculateAnalyticsSummary({
      now: '2026-06-23T20:00:00.000+03:00',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      monthlyBonus: 2_000,
      includeMonthlyBonus: false,
      shifts: []
    });

    expect(summary).toMatchObject({
      shiftCount: 0,
      averageSalaryPerShift: 0,
      effectiveHourlyIncome: 0,
      averageShiftMinutes: 0,
      averageLateArrivalMinutes: 0,
      averageEarlyExitMinutes: 0,
      scheduleAdherencePercent: null,
      production: {
        averageTicketsPerShift: 0,
        quantityPerProductiveHour: null,
        averageProductiveMinutesPerTicket: 0,
        averageDowntimeMinutesPerTicket: 0,
        downtimePercent: null
      }
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
          endTime: '2026-06-10T14:30:00.000+03:00',
          gradeSnapshot: {
            currentGrade: 2,
            desiredGrade: 3,
            gradeSalaryBonusPercents: [10, 10, 10, 10],
            gradeNormPercents: [100, 120, 140, 160],
            cumulativeSalaryBonusPercent: 20
          }
        })
      ]
    });

    expect(summary.workSalary).toBe(960);
    expect(summary.monthlyBonus).toBe(0);
    expect(summary.gradeBonus).toBe(0);
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

  it('uses the latest historical monthly grade snapshot and weights mixed ticket targets', () => {
    const summary = calculateAnalyticsSummary({
      now: '2026-07-15T20:00:00.000+03:00',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      monthlyBonus: 2_000,
      includeMonthlyBonus: true,
      shifts: [
        makeShift({
          id: 'earlier-grade-shift',
          date: '2026-06-10',
          startTime: '2026-06-10T06:30:00.000+03:00',
          endTime: '2026-06-10T14:30:00.000+03:00',
          baseHourlyRateSnapshot: 100,
          hourlyRateSnapshot: 110,
          gradeSnapshot: {
            currentGrade: 1,
            desiredGrade: 2,
            gradeSalaryBonusPercents: [10, 10, 10, 10],
            gradeNormPercents: [100, 120, 140, 160],
            cumulativeSalaryBonusPercent: 10
          },
          workTickets: [
            {
              id: 'different-norm-ticket',
              normPerEightHours: 80,
              startedAt: '2026-06-10T07:00:00.000+03:00',
              endedAt: '2026-06-10T08:00:00.000+03:00',
              actualQuantity: 10,
              downtimeMinutes: 0,
              createdAt: '2026-06-10T07:00:00.000+03:00',
              updatedAt: '2026-06-10T08:00:00.000+03:00'
            }
          ]
        }),
        makeShift({
          id: 'latest-grade-shift',
          date: '2026-06-20',
          startTime: '2026-06-20T06:30:00.000+03:00',
          endTime: '2026-06-20T14:30:00.000+03:00',
          baseHourlyRateSnapshot: 100,
          hourlyRateSnapshot: 120,
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
              startedAt: '2026-06-20T07:00:00.000+03:00',
              endedAt: '2026-06-20T09:00:00.000+03:00',
              actualQuantity: 15,
              downtimeMinutes: 20,
              createdAt: '2026-06-20T07:00:00.000+03:00',
              updatedAt: '2026-06-20T09:00:00.000+03:00'
            },
            {
              id: 'legacy-ticket',
              normPerEightHours: 48,
              startedAt: '2026-06-20T09:00:00.000+03:00',
              endedAt: '2026-06-20T10:00:00.000+03:00',
              actualQuantity: null,
              downtimeMinutes: 0,
              createdAt: '2026-06-20T09:00:00.000+03:00',
              updatedAt: '2026-06-20T10:00:00.000+03:00'
            }
          ]
        })
      ]
    });

    expect(summary).toMatchObject({
      workSalary: 1_600,
      monthlyBonus: 2_000,
      gradeBonus: 3_520,
      plannedSalary: 7_120,
      production: {
        ticketCount: 3,
        filledTicketCount: 2,
        unfilledTicketCount: 1,
        actualQuantity: 25,
        productiveMinutes: 160,
        downtimeMinutes: 20,
        currentGradeTarget: 22,
        completionPercent: 25 / 22 * 100,
        averageActualPerTicket: 12.5,
        averageTicketsPerShift: 1.5,
        quantityPerProductiveHour: 25 * 60 / 160,
        averageProductiveMinutesPerTicket: 80,
        averageDowntimeMinutesPerTicket: 10,
        downtimePercent: 20 / 180 * 100
      }
    });
  });
});
