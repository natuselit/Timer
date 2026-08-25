import { describe, expect, it } from 'vitest';
import type { Shift } from '../../../entities/shift';
import {
  calculateMonthlyOvertimePlan,
  calculateShiftLimitOvertimeMinutes
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
    monthlyBonus: 0,
    currentGrade: 1,
    gradeSalaryBonusPercents: [0, 0, 0, 0],
    overtimeLimitPercent: 10,
    overtimeStepMinutes: 30,
    overtimeStrategy: 'standard',
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

  it('adds manual coefficient extras from completed and active shifts to the maximum', () => {
    const plan = calculatePlan({
      monthlyBonus: 1_000,
      currentGrade: 2,
      gradeSalaryBonusPercents: [5, 10, 10, 10],
      shifts: [
        makeShift({
          endTime: '2026-08-10T07:30:00.000+03:00',
          coefficientMode: 'x2'
        }),
        makeShift({
          id: 'active-shift',
          date: '2026-08-11',
          startTime: '2026-08-11T06:30:00.000+03:00',
          endTime: null,
          coefficientMode: 'x1.5'
        })
      ]
    });

    expect(plan.earnedAmount).toBeCloseTo(510);
    expect(plan.workedMinutes).toBe(150);
    expect(plan.baseSalaryAmount).toBe(22_400);
    expect(plan.overtimeMaximumAmount).toBeCloseTo(3_360);
    expect(plan.monthlyBonusAmount).toBe(1_000);
    expect(plan.gradeBonusAmount).toBe(3_360);
    expect(plan.coefficientExtraAmount).toBeCloseTo(210);
    expect(plan.maximumAmount).toBeCloseTo(30_330);
  });

  it('does not add automatic overtime to the coefficient extra twice', () => {
    const plan = calculatePlan({
      shifts: [
        makeShift({
          startTime: '2026-08-10T06:00:00.000+03:00',
          endTime: '2026-08-10T15:00:00.000+03:00',
          coefficientMode: 'auto'
        })
      ]
    });

    expect(plan.coefficientExtraAmount).toBe(0);
    expect(plan.maximumAmount).toBeCloseTo(25_760);
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
      overtimeSaturdayMaxMinutes: 60,
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
      kind: 'weekday',
      shiftType: 'second'
    });
    expect(new Date(plan.recommendation.recommendedStartAt!).getTime()).toBe(
      new Date('2026-08-12T13:30:00.000+03:00').getTime()
    );
    expect(new Date(plan.recommendation.recommendedEndAt!).getTime()).toBe(
      new Date('2026-08-12T22:30:00.000+03:00').getTime()
    );
    expect(plan.recommendation.totalMinutes).toBe(480 + plan.recommendation.minutes);
  });

  it('keeps the current-day recommendation for an active shift', () => {
    const plan = calculatePlan({
      now: '2026-08-11T15:00:00.000+03:00',
      overtimeSaturdayMaxMinutes: 60,
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
      overtimeSaturdayMaxMinutes: 60,
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

  it('moves all weekday overtime before the second shift and ends at 22:30', () => {
    const plan = calculatePlan({
      preferredShiftType: 'second',
      overtimeSaturdayMaxMinutes: 60
    });

    expect(plan.recommendation.shiftType).toBe('second');
    expect(plan.recommendation.kind).toBe('weekday');
    expect(new Date(plan.recommendation.recommendedEndAt!).getTime()).toBe(
      new Date(`${plan.recommendation.date}T22:30:00.000+03:00`).getTime()
    );
    expect(
      (new Date(`${plan.recommendation.date}T14:30:00.000+03:00`).getTime() -
        new Date(plan.recommendation.recommendedStartAt!).getTime()) /
        60_000
    ).toBe(plan.recommendation.minutes);
    expect(plan.recommendation.totalMinutes).toBe(480 + plan.recommendation.minutes);
  });

  it('keeps a long Saturday second-shift recommendation within 22:30', () => {
    const plan = calculatePlan({
      now: '2026-08-01T05:00:00.000+03:00',
      preferredShiftType: 'second',
      overtimeLimitPercent: 20,
      overtimeSaturdayMaxMinutes: 720,
      overtimeStrategy: 'standard'
    });

    expect(plan.recommendation.kind).toBe('saturday');
    expect(plan.recommendation.minutes).toBe(720);
    expect(new Date(plan.recommendation.recommendedStartAt!).getTime()).toBe(
      new Date('2026-08-01T10:30:00.000+03:00').getTime()
    );
    expect(new Date(plan.recommendation.recommendedEndAt!).getTime()).toBe(
      new Date('2026-08-01T22:30:00.000+03:00').getTime()
    );
  });

  it('moves the remaining recommendation forward after a second shift starts', () => {
    const plan = calculatePlan({
      now: '2026-08-11T14:00:00.000+03:00',
      overtimeSaturdayMaxMinutes: 60,
      shifts: [
        makeShift({
          date: '2026-08-11',
          type: 'second',
          plannedStartTime: '14:30',
          plannedEndTime: '22:30',
          startTime: '2026-08-11T13:30:00.000+03:00',
          endTime: null
        })
      ]
    });

    expect(plan.recommendation.shiftType).toBe('second');
    expect(plan.recommendation.date).toBe('2026-08-12');
    expect(new Date(plan.recommendation.recommendedEndAt!).getTime()).toBe(
      new Date('2026-08-12T22:30:00.000+03:00').getTime()
    );
  });

  it('distributes weekday recommendations in the configured step without exceeding the limit', () => {
    const stepMinutes = 15;
    const plan = calculatePlan({
      overtimeStepMinutes: stepMinutes,
      overtimeSaturdayMaxMinutes: 60
    });
    const scenario = plan.selectedScenario;

    expect(
      scenario.weekdayMinutes + scenario.saturdayMinutes + scenario.unallocatedMinutes
    ).toBe(plan.remainingMinutes);
    expect(scenario.unallocatedMinutes).toBeLessThan(stepMinutes);
    expect(
      scenario.allocations.every(
        ({ minutes }) => minutes % stepMinutes === 0
      )
    ).toBe(true);
  });

  it('returns exactly the three fixed strategies', () => {
    const plan = calculatePlan();

    expect(plan.scenarios.map(({ strategy }) => strategy)).toEqual([
      'standard',
      'standard-plus',
      'standard-plus-plus'
    ]);
  });

  it('uses up to two, three or four Saturdays before distributing the rest to weekdays', () => {
    const plan = calculatePlan({
      now: '2026-08-01T05:00:00.000+03:00',
      overtimeLimitPercent: 20
    });
    const saturdayCounts = Object.fromEntries(
      plan.scenarios.map((scenario) => [
        scenario.strategy,
        scenario.allocations.filter(({ kind }) => kind === 'saturday').length
      ])
    );

    expect(saturdayCounts).toEqual({
      standard: 2,
      'standard-plus': 3,
      'standard-plus-plus': 4
    });
    expect(plan.scenarios.every(({ weekdayMinutes }) => weekdayMinutes > 0)).toBe(true);
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

  it('uses fewer Saturdays when the remaining limit fits into one', () => {
    const plan = calculatePlan({
      now: '2026-08-01T05:00:00.000+03:00',
      overtimeLimitPercent: 3,
      overtimeStrategy: 'standard-plus-plus'
    });

    expect(
      plan.selectedScenario.allocations.filter(({ kind }) => kind === 'saturday')
    ).toHaveLength(1);
    expect(plan.selectedScenario.saturdayMinutes).toBeLessThanOrEqual(plan.remainingMinutes);
  });

  it('uses only the Saturdays still available in the current month', () => {
    const plan = calculatePlan({
      now: '2026-08-20T08:00:00.000+03:00',
      overtimeLimitPercent: 20,
      overtimeStrategy: 'standard-plus-plus'
    });

    expect(
      plan.selectedScenario.allocations.filter(({ kind }) => kind === 'saturday')
    ).toHaveLength(2);
  });

  it('respects configurable weekday and Saturday daily maximums', () => {
    const weekdayPlan = calculatePlan({
      overtimeLimitPercent: 50,
      overtimeStrategy: 'standard',
      overtimeSaturdayMaxMinutes: 60,
      overtimeWeekdayMaxMinutes: 60
    });
    const saturdayPlan = calculatePlan({
      overtimeLimitPercent: 50,
      overtimeStrategy: 'standard-plus-plus',
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
      overtimeStrategy: 'standard-plus-plus',
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

  it('excludes unavailable dates from every strategy and advances the recommendation', () => {
    const initialPlan = calculatePlan();
    const initialDate = initialPlan.recommendation.date;
    expect(initialDate).not.toBeNull();

    const updatedPlan = calculatePlan({
      overtimeUnavailableDates: [initialDate!]
    });

    expect(updatedPlan.recommendation.date).not.toBe(initialDate);
    expect(
      updatedPlan.scenarios.every((scenario) =>
        scenario.allocations.every(({ date }) => date !== initialDate)
      )
    ).toBe(true);
  });

  it('reports no recommendation when every remaining date is unavailable', () => {
    const plan = calculatePlan({
      overtimeUnavailableDates: Array.from(
        { length: 21 },
        (_, index) => `2026-08-${String(index + 11).padStart(2, '0')}`
      )
    });

    expect(plan.scenarios.every(({ allocations }) => allocations.length === 0)).toBe(true);
    expect(plan.recommendation).toMatchObject({ date: null, kind: 'rest' });
  });

  it('calculates an exact forecast with the x1.5 overtime coefficient', () => {
    const plan = calculatePlan({ overtimeLimitPercent: 3 });

    expect(plan.selectedScenario.projectedIncomeMin).toBe(
      plan.selectedScenario.projectedIncomeMax
    );
  });

});
