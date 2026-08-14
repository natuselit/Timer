import { describe, expect, it } from 'vitest';
import {
  calculateSalaryBreakdown,
  calculateShiftTimeBreakdown,
  getEffectiveCoefficient,
  getPlannedShiftWindow
} from './calculations';
import type { Shift } from './types';

const createShift = (override: Partial<Shift> = {}): Shift => ({
  id: 'shift-1',
  date: '2026-06-23',
  type: 'first',
  detectionMode: 'auto',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  startTime: '2026-06-23T06:30:00.000+03:00',
  endTime: '2026-06-23T14:30:00.000+03:00',
  baseHourlyRateSnapshot: 120,
  hourlyRateSnapshot: 120,
  gradeSnapshot: null,
  workTickets: [],
  note: '',
  coefficientMode: 'auto',
  isAutoClosed: false,
  createdAt: '2026-06-23T06:30:00.000+03:00',
  updatedAt: '2026-06-23T14:30:00.000+03:00',
  ...override
});

describe('getPlannedShiftWindow', () => {
  it('returns planned first shift start and end by type', () => {
    expect(
      getPlannedShiftWindow('2026-06-23', 'first', '2026-06-23T06:32:00.000+03:00')
    ).toEqual({
      type: 'first',
      date: '2026-06-23',
      startTime: '06:30',
      endTime: '14:30',
      plannedStart: '2026-06-23T06:30:00.000+03:00',
      plannedEnd: '2026-06-23T14:30:00.000+03:00'
    });
  });

  it('returns planned second shift start and end by type', () => {
    expect(
      getPlannedShiftWindow('2026-06-23', 'second', '2026-06-23T14:29:00.000+03:00')
    ).toMatchObject({
      type: 'second',
      startTime: '14:30',
      endTime: '22:30',
      plannedStart: '2026-06-23T14:30:00.000+03:00',
      plannedEnd: '2026-06-23T22:30:00.000+03:00'
    });
  });
});

describe('calculateShiftTimeBreakdown', () => {
  it('calculates exact planned shift duration without deviations', () => {
    expect(calculateShiftTimeBreakdown(createShift())).toMatchObject({
      actualDurationMinutes: 480,
      earlyArrivalMinutes: 0,
      lateArrivalMinutes: 0,
      earlyExitMinutes: 0,
      lateExitMinutes: 0,
      overtimeBeforeShiftMinutes: 0,
      overtimeAfterShiftMinutes: 0,
      regularWorkMinutes: 480,
      totalOvertimeMinutes: 0
    });
  });

  it('calculates early arrival and overtime before planned start', () => {
    expect(
      calculateShiftTimeBreakdown(
        createShift({
          startTime: '2026-06-23T06:15:00.000+03:00'
        })
      )
    ).toMatchObject({
      actualDurationMinutes: 495,
      earlyArrivalMinutes: 15,
      overtimeBeforeShiftMinutes: 15,
      totalOvertimeMinutes: 15
    });
  });

  it('calculates lateness and early exit', () => {
    expect(
      calculateShiftTimeBreakdown(
        createShift({
          startTime: '2026-06-23T06:45:00.000+03:00',
          endTime: '2026-06-23T14:20:00.000+03:00'
        })
      )
    ).toMatchObject({
      actualDurationMinutes: 455,
      lateArrivalMinutes: 15,
      earlyExitMinutes: 10,
      regularWorkMinutes: 455,
      totalOvertimeMinutes: 0
    });
  });

  it('counts one minute of late exit as overtime after planned end', () => {
    expect(
      calculateShiftTimeBreakdown(
        createShift({
          endTime: '2026-06-23T14:31:00.000+03:00'
        })
      )
    ).toMatchObject({
      actualDurationMinutes: 481,
      lateExitMinutes: 1,
      overtimeAfterShiftMinutes: 1,
      totalOvertimeMinutes: 1
    });
  });
});

describe('getEffectiveCoefficient', () => {
  it.each([
    ['до планового початку', '2026-06-23T06:29:00.000+03:00', 1.5],
    ['рівно на плановому початку', '2026-06-23T06:30:00.000+03:00', 1],
    ['у межах планового часу', '2026-06-23T10:00:00.000+03:00', 1],
    ['рівно на плановому завершенні', '2026-06-23T14:30:00.000+03:00', 1.5],
    ['після планового завершення', '2026-06-23T14:31:00.000+03:00', 1.5]
  ])('returns the auto coefficient %s', (_label, at, expected) => {
    expect(getEffectiveCoefficient(createShift(), at)).toBe(expected);
  });

  it.each([
    ['x1', 1],
    ['x1.5', 1.5],
    ['x2', 2]
  ] as const)('keeps manual mode %s for the whole shift', (coefficientMode, expected) => {
    expect(
      getEffectiveCoefficient(
        createShift({
          coefficientMode
        }),
        '2026-06-23T23:00:00.000+03:00'
      )
    ).toBe(expected);
  });

  it('uses x1.5 for auto mode throughout Saturday and Sunday', () => {
    expect(
      getEffectiveCoefficient(
        createShift({
          date: '2026-06-20',
          startTime: '2026-06-20T06:30:00.000+03:00'
        }),
        '2026-06-20T10:00:00.000+03:00'
      )
    ).toBe(1.5);
    expect(
      getEffectiveCoefficient(
        createShift({
          date: '2026-06-21',
          startTime: '2026-06-21T06:30:00.000+03:00'
        }),
        '2026-06-21T10:00:00.000+03:00'
      )
    ).toBe(1.5);
  });

  it('keeps a manual weekend override instead of applying automatic x1.5', () => {
    expect(
      getEffectiveCoefficient(
        createShift({
          date: '2026-06-20',
          startTime: '2026-06-20T06:30:00.000+03:00',
          coefficientMode: 'x1'
        }),
        '2026-06-20T10:00:00.000+03:00'
      )
    ).toBe(1);
  });
});

describe('calculateSalaryBreakdown', () => {
  it('calculates auto salary with regular time x1 and overtime x1.5', () => {
    const salary = calculateSalaryBreakdown(
      createShift({
        startTime: '2026-06-23T06:20:00.000+03:00',
        endTime: '2026-06-23T14:40:00.000+03:00'
      })
    );

    expect(salary).toMatchObject({
      mode: 'auto',
      hourlyRate: 120,
      totalMinutes: 500,
      totalAmount: 1_020
    });
    expect(salary.lines).toEqual([
      {
        key: 'regular',
        label: 'Основний час x1',
        minutes: 480,
        coefficient: 1,
        amount: 960
      },
      {
        key: 'overtime-before',
        label: 'Перепрацювання до початку x1.5',
        minutes: 10,
        coefficient: 1.5,
        amount: 30
      },
      {
        key: 'overtime-after',
        label: 'Перепрацювання після кінця x1.5',
        minutes: 10,
        coefficient: 1.5,
        amount: 30
      }
    ]);
  });

  it('ignores the legacy grade-inflated rate and pays all time from the base rate', () => {
    const salary = calculateSalaryBreakdown(
      createShift({
        baseHourlyRateSnapshot: 100,
        hourlyRateSnapshot: 110,
        startTime: '2026-06-23T06:20:00.000+03:00',
        endTime: '2026-06-23T14:40:00.000+03:00'
      })
    );

    expect(salary).toMatchObject({
      mode: 'auto',
      hourlyRate: 100,
      totalMinutes: 500,
      totalAmount: 850
    });
    expect(salary.lines).toEqual([
      {
        key: 'regular',
        label: 'Основний час x1',
        minutes: 480,
        coefficient: 1,
        amount: 800
      },
      {
        key: 'overtime-before',
        label: 'Перепрацювання до початку x1.5',
        minutes: 10,
        coefficient: 1.5,
        amount: 25
      },
      {
        key: 'overtime-after',
        label: 'Перепрацювання після кінця x1.5',
        minutes: 10,
        coefficient: 1.5,
        amount: 25
      }
    ]);
  });

  it('calculates x1 salary for the whole actual shift', () => {
    expect(calculateSalaryBreakdown(createShift({
      coefficientMode: 'x1',
      baseHourlyRateSnapshot: 100,
      hourlyRateSnapshot: 140
    }))).toMatchObject({
      mode: 'x1',
      totalMinutes: 480,
      totalAmount: 800,
      lines: [
        {
          key: 'whole-shift',
          label: 'Уся зміна x1',
          minutes: 480,
          coefficient: 1,
          amount: 800
        }
      ]
    });
  });

  it('pays the whole auto weekend shift at x1.5', () => {
    expect(
      calculateSalaryBreakdown(
        createShift({
          date: '2026-06-20',
          startTime: '2026-06-20T06:30:00.000+03:00',
          endTime: '2026-06-20T14:30:00.000+03:00',
          baseHourlyRateSnapshot: 100
        })
      )
    ).toMatchObject({
      mode: 'auto',
      totalMinutes: 480,
      totalAmount: 1_200,
      lines: [
        {
          key: 'whole-shift',
          label: 'Вихідний день x1.5',
          minutes: 480,
          coefficient: 1.5,
          amount: 1_200
        }
      ]
    });
  });

  it('calculates x1.5 salary for the whole actual shift', () => {
    expect(calculateSalaryBreakdown(createShift({
      coefficientMode: 'x1.5',
      baseHourlyRateSnapshot: 100,
      hourlyRateSnapshot: 140
    }))).toMatchObject({
      mode: 'x1.5',
      totalMinutes: 480,
      totalAmount: 1_200,
      lines: [
        {
          key: 'whole-shift',
          label: 'Уся зміна x1.5',
          minutes: 480,
          coefficient: 1.5,
          amount: 1_200
        }
      ]
    });
  });

  it('calculates x2 salary for the whole actual shift', () => {
    expect(calculateSalaryBreakdown(createShift({
      coefficientMode: 'x2',
      baseHourlyRateSnapshot: 100,
      hourlyRateSnapshot: 140
    }))).toMatchObject({
      mode: 'x2',
      totalMinutes: 480,
      totalAmount: 1_600,
      lines: [
        {
          key: 'whole-shift',
          label: 'Уся зміна x2',
          minutes: 480,
          coefficient: 2,
          amount: 1_600
        }
      ]
    });
  });
});
