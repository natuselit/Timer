import { describe, expect, it } from 'vitest';
import type { Shift } from '../../../entities/shift';
import {
  calculateMonthlyOvertimePlan,
  calculateShiftLimitOvertimeMinutes,
  getCoefficientModeForNewShift
} from './overtimePlanner';

const makeShift = (overrides: Partial<Shift> = {}): Shift => ({
  id: 'shift-1',
  date: '2026-08-10',
  type: 'first',
  detectionMode: 'auto',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  startTime: '2026-08-10T06:30:00.000+03:00',
  endTime: '2026-08-10T15:30:00.000+03:00',
  baseHourlyRateSnapshot: 120,
  hourlyRateSnapshot: 120,
  gradeSnapshot: null,
  workTickets: [],
  note: '',
  coefficientMode: 'auto',
  isAutoClosed: false,
  createdAt: '2026-08-10T06:30:00.000+03:00',
  updatedAt: '2026-08-10T15:30:00.000+03:00',
  ...overrides
});

const calculatePlan = (
  overrides: Partial<Parameters<typeof calculateMonthlyOvertimePlan>[0]> = {}
) =>
  calculateMonthlyOvertimePlan({
    shifts: [],
    now: '2026-08-11T08:00:00.000+03:00',
    monthlySalary: 22_400,
    overtimeLimitPercent: 10,
    overtimeStepMinutes: 30,
    overtimeStrategy: 'standard',
    overtimeSaturdayCount: 1,
    overtimeWeekdayMaxMinutes: 240,
    overtimeSaturdayMaxMinutes: 480,
    overtimeUnavailableDates: [],
    ...overrides
  });

describe('monthly overtime planner', () => {
  it('calculates the 5/2 plan and floors the percentage limit to whole minutes', () => {
    const plan = calculatePlan({ overtimeLimitPercent: 7.333 });

    expect(plan.plannedMinutes).toBe(21 * 8 * 60);
    expect(plan.limitMinutes).toBe(Math.floor(21 * 8 * 60 * 0.07333));
  });

  it('counts only early arrival and late exit on weekdays', () => {
    expect(
      calculateShiftLimitOvertimeMinutes(
        makeShift({
          startTime: '2026-08-10T06:15:00.000+03:00',
          endTime: '2026-08-10T15:00:00.000+03:00'
        }),
        '2026-08-11T08:00:00.000+03:00'
      )
    ).toBe(45);
  });

  it('counts the whole duration of Saturday, Sunday and an active weekend shift', () => {
    expect(
      calculateShiftLimitOvertimeMinutes(
        makeShift({
          date: '2026-08-08',
          startTime: '2026-08-08T07:00:00.000+03:00',
          endTime: '2026-08-08T12:30:00.000+03:00'
        }),
        '2026-08-11T08:00:00.000+03:00'
      )
    ).toBe(330);

    expect(
      calculateShiftLimitOvertimeMinutes(
        makeShift({
          date: '2026-08-09',
          startTime: '2026-08-09T08:00:00.000+03:00',
          endTime: null
        }),
        '2026-08-09T10:15:00.000+03:00'
      )
    ).toBe(135);
  });

  it('subtracts used overtime and reports a limit overrun', () => {
    const plan = calculatePlan({
      overtimeLimitPercent: 1,
      shifts: [makeShift({ endTime: '2026-08-10T17:30:00.000+03:00' })]
    });

    expect(plan.usedMinutes).toBe(180);
    expect(plan.remainingMinutes).toBe(0);
    expect(plan.exceededMinutes).toBe(80);
  });

  it('moves the recommendation to the next available date after today is completed', () => {
    const plan = calculatePlan({
      now: '2026-08-11T16:00:00.000+03:00',
      overtimeStrategy: 'weekdays',
      shifts: [
        makeShift({
          date: '2026-08-11',
          type: 'second',
          plannedStartTime: '14:30',
          plannedEndTime: '22:30',
          startTime: '2026-08-11T14:30:00.000+03:00',
          endTime: '2026-08-11T23:30:00.000+03:00'
        })
      ]
    });

    expect(plan.recommendation).toMatchObject({
      date: '2026-08-12',
      isToday: false,
      kind: 'weekday'
    });
    expect(new Date(plan.recommendation.recommendedStartAt!).getTime()).toBe(
      new Date('2026-08-12T14:30:00.000+03:00').getTime()
    );
    expect(plan.recommendation.recommendedEndAt).not.toBeNull();
    expect(plan.recommendation.totalMinutes).toBe(480 + plan.recommendation.minutes);
  });

  it('keeps the current-day recommendation for an active shift', () => {
    const plan = calculatePlan({
      now: '2026-08-11T15:00:00.000+03:00',
      overtimeStrategy: 'weekdays',
      shifts: [
        makeShift({
          date: '2026-08-11',
          startTime: '2026-08-11T06:10:00.000+03:00',
          endTime: null
        })
      ]
    });

    expect(plan.recommendation.date).toBe('2026-08-11');
    expect(plan.recommendation.isToday).toBe(true);
    expect(plan.recommendation.recommendedStartAt).toBe(
      '2026-08-11T06:10:00.000+03:00'
    );
    expect(plan.recommendation.recommendedEndAt).not.toBeNull();
    expect(plan.recommendation.totalMinutes).toBeGreaterThan(480);
  });

  it('starts a future first-shift recommendation as early as 06:00', () => {
    const plan = calculatePlan({
      now: '2026-08-11T16:00:00.000+03:00',
      overtimeStrategy: 'weekdays',
      shifts: [
        makeShift({
          date: '2026-08-11',
          startTime: '2026-08-11T06:30:00.000+03:00',
          endTime: '2026-08-11T14:30:00.000+03:00'
        })
      ]
    });

    expect(new Date(plan.recommendation.recommendedStartAt!).getTime()).toBe(
      new Date('2026-08-12T06:00:00.000+03:00').getTime()
    );
    expect(plan.recommendation.totalMinutes).toBe(480 + plan.recommendation.minutes);
    expect(
      (new Date(plan.recommendation.recommendedEndAt!).getTime() -
        new Date('2026-08-12T14:30:00.000+03:00').getTime()) /
        60_000
    ).toBe(plan.recommendation.minutes - 30);
  });

  it('distributes weekday recommendations in the configured step without exceeding the limit', () => {
    const stepMinutes = 15;
    const plan = calculatePlan({
      overtimeStrategy: 'weekdays',
      overtimeStepMinutes: stepMinutes
    });
    const scenario = plan.selectedScenario;

    expect(scenario.saturdayMinutes).toBe(0);
    expect(scenario.weekdayMinutes + scenario.unallocatedMinutes).toBe(plan.remainingMinutes);
    expect(scenario.unallocatedMinutes).toBeLessThan(stepMinutes);
    expect(scenario.allocations.every(({ kind }) => kind === 'weekday')).toBe(true);
    expect(
      scenario.allocations.every(
        ({ minutes }) => minutes % stepMinutes === 0
      )
    ).toBe(true);
  });

  it('uses two Saturdays and distributes the rest between weekdays for standard', () => {
    const plan = calculatePlan({ overtimeLimitPercent: 20 });

    expect(
      plan.selectedScenario.allocations.filter(({ kind }) => kind === 'saturday')
    ).toHaveLength(2);
    expect(plan.selectedScenario.saturdayMinutes).toBe(960);
    expect(plan.selectedScenario.weekdayMinutes).toBeGreaterThan(0);
  });

  it('distributes time between every available Saturday', () => {
    const plan = calculatePlan({
      overtimeLimitPercent: 12,
      overtimeStrategy: 'saturdays'
    });
    const saturdayAllocations = plan.selectedScenario.allocations.filter(
      ({ kind }) => kind === 'saturday'
    );

    expect(saturdayAllocations).toHaveLength(3);
    expect(saturdayAllocations.map(({ minutes }) => minutes)).toEqual([420, 390, 390]);
    expect(
      plan.selectedScenario.saturdayMinutes +
        plan.selectedScenario.weekdayMinutes +
        plan.selectedScenario.unallocatedMinutes
    ).toBe(plan.remainingMinutes);
    expect(
      plan.selectedScenario.allocations.every(
        ({ minutes }) => minutes % 30 === 0
      )
    ).toBe(true);
  });

  it('keeps automatic weekdays within two hours and adds only required Saturdays', () => {
    const plan = calculatePlan({
      overtimeLimitPercent: 20,
      overtimeStrategy: 'automatic'
    });
    const weekdayAllocations = plan.selectedScenario.allocations.filter(
      ({ kind }) => kind === 'weekday'
    );
    const saturdayAllocations = plan.selectedScenario.allocations.filter(
      ({ kind }) => kind === 'saturday'
    );

    expect(weekdayAllocations.every(({ minutes }) => minutes <= 120)).toBe(true);
    expect(saturdayAllocations).toHaveLength(1);
    expect(
      plan.selectedScenario.weekdayMinutes +
        plan.selectedScenario.saturdayMinutes +
        plan.selectedScenario.unallocatedMinutes
    ).toBe(plan.remainingMinutes);
  });

  it('keeps a future recommended interval on configured step boundaries', () => {
    const plan = calculatePlan({
      overtimeLimitPercent: 50,
      overtimeStepMinutes: 15,
      overtimeStrategy: 'standard'
    });

    expect(plan.recommendation.recommendedStartAt).not.toBeNull();
    expect(plan.recommendation.recommendedEndAt).not.toBeNull();
    expect(plan.recommendation.minutes % 15).toBe(0);
    expect(
      [0, 15, 30, 45].includes(
        new Date(plan.recommendation.recommendedStartAt!).getUTCMinutes()
      )
    ).toBe(true);
    expect(
      [0, 15, 30, 45].includes(
        new Date(plan.recommendation.recommendedEndAt!).getUTCMinutes()
      )
    ).toBe(true);
  });

  it('uses exactly the configured number of Saturdays for the custom strategy', () => {
    const plan = calculatePlan({
      overtimeLimitPercent: 20,
      overtimeStrategy: 'custom',
      overtimeSaturdayCount: 2
    });

    expect(
      plan.selectedScenario.allocations.filter(({ kind }) => kind === 'saturday')
    ).toHaveLength(2);
    expect(plan.selectedScenario.weekdayMinutes).toBeGreaterThan(0);
  });

  it('excludes unavailable dates from every recommendation', () => {
    const plan = calculatePlan({
      overtimeStrategy: 'weekdays',
      overtimeUnavailableDates: ['2026-08-11', '2026-08-12']
    });

    expect(plan.recommendation.date).toBe('2026-08-13');
    expect(
      plan.selectedScenario.allocations.some(
        ({ date }) => date === '2026-08-11' || date === '2026-08-12'
      )
    ).toBe(false);
  });

  it('respects configurable weekday and Saturday daily maximums', () => {
    const weekdayPlan = calculatePlan({
      overtimeLimitPercent: 50,
      overtimeStrategy: 'weekdays',
      overtimeWeekdayMaxMinutes: 60
    });
    const saturdayPlan = calculatePlan({
      overtimeLimitPercent: 50,
      overtimeStrategy: 'saturdays',
      overtimeSaturdayMaxMinutes: 600
    });

    expect(
      weekdayPlan.selectedScenario.allocations.every(({ minutes }) => minutes <= 60)
    ).toBe(true);
    expect(weekdayPlan.selectedScenario.unallocatedMinutes).toBeGreaterThan(0);
    expect(
      saturdayPlan.selectedScenario.allocations
        .filter(({ kind }) => kind === 'saturday')
        .every(({ minutes }) => minutes <= 600)
    ).toBe(true);
  });

  it('reports an unallocated remainder when no eligible dates remain', () => {
    const plan = calculatePlan({
      now: '2026-08-31T23:00:00.000+03:00',
      overtimeStrategy: 'saturdays',
      shifts: [
        makeShift({
          date: '2026-08-31',
          startTime: '2026-08-31T06:30:00.000+03:00',
          endTime: '2026-08-31T14:30:00.000+03:00'
        })
      ]
    });

    expect(plan.selectedScenario.allocations).toEqual([]);
    expect(plan.selectedScenario.unallocatedMinutes).toBe(plan.remainingMinutes);
    expect(plan.recommendation).toMatchObject({ date: null, isToday: false, kind: 'rest' });
  });

  it('calculates an exact forecast with the x1.5 overtime coefficient', () => {
    const plan = calculatePlan({ overtimeLimitPercent: 3 });

    expect(plan.selectedScenario.projectedIncomeMin).toBe(
      plan.selectedScenario.projectedIncomeMax
    );
  });

  it('sets coefficients only for newly created weekend shifts', () => {
    expect(
      getCoefficientModeForNewShift({
        date: '2026-08-08',
        defaultMode: 'auto'
      })
    ).toBe('x1.5');
    expect(
      getCoefficientModeForNewShift({
        date: '2026-08-09',
        defaultMode: 'auto'
      })
    ).toBe('x1.5');
    expect(
      getCoefficientModeForNewShift({
        date: '2026-08-10',
        defaultMode: 'x1'
      })
    ).toBe('x1');
  });
});
