import { describe, expect, it } from 'vitest';
import type { WorkTicket } from './types';
import {
  calculateShiftProductionSummary,
  calculateTicketProductionSummary,
  validateAndSortWorkTickets
} from './workTickets';

const makeTicket = (overrides: Partial<WorkTicket> = {}): WorkTicket => ({
  id: 'ticket-1',
  normPerEightHours: 50,
  startedAt: '2026-06-10T07:00:00.000Z',
  endedAt: '2026-06-10T08:00:00.000Z',
  actualQuantity: 12,
  manualCompletionPercent: null,
  downtimeMinutes: 0,
  createdAt: '2026-06-10T07:00:00.000Z',
  updatedAt: '2026-06-10T08:00:00.000Z',
  ...overrides
});

const completedBounds = {
  shiftStartTime: '2026-06-10T06:30:00.000Z',
  effectiveShiftEndTime: '2026-06-10T14:30:00.000Z',
  allowOpenTicket: false
} as const;

describe('validateAndSortWorkTickets', () => {
  it('sorts tickets chronologically and allows gaps', () => {
    const result = validateAndSortWorkTickets(
      [
        makeTicket({
          id: 'ticket-2',
          startedAt: '2026-06-10T10:00:00.000Z',
          endedAt: '2026-06-10T11:00:00.000Z'
        }),
        makeTicket({ id: 'ticket-1' })
      ],
      completedBounds
    );

    expect(result.map((ticket) => ticket.id)).toEqual(['ticket-1', 'ticket-2']);
  });

  it('allows adjacent ticket boundaries', () => {
    expect(() =>
      validateAndSortWorkTickets(
        [
          makeTicket({ id: 'ticket-1' }),
          makeTicket({
            id: 'ticket-2',
            startedAt: '2026-06-10T08:00:00.000Z',
            endedAt: '2026-06-10T09:00:00.000Z'
          })
        ],
        completedBounds
      )
    ).not.toThrow();
  });

  it('rejects overlaps and times outside the shift', () => {
    expect(() =>
      validateAndSortWorkTickets(
        [
          makeTicket({ id: 'ticket-1' }),
          makeTicket({
            id: 'ticket-2',
            startedAt: '2026-06-10T07:59:00.000Z',
            endedAt: '2026-06-10T09:00:00.000Z'
          })
        ],
        completedBounds
      )
    ).toThrow('Час тікетів не може накладатися.');

    expect(() =>
      validateAndSortWorkTickets(
        [makeTicket({ startedAt: '2026-06-10T06:29:00.000Z' })],
        completedBounds
      )
    ).toThrow('Тікет не може починатися раніше зміни.');

    expect(() =>
      validateAndSortWorkTickets(
        [makeTicket({ endedAt: '2026-06-10T14:31:00.000Z' })],
        completedBounds
      )
    ).toThrow('Тікет не може завершуватися пізніше зміни.');
  });

  it('rejects an end that is not later than the start', () => {
    expect(() =>
      validateAndSortWorkTickets(
        [makeTicket({ endedAt: '2026-06-10T07:00:00.000Z' })],
        completedBounds
      )
    ).toThrow('Завершення тікета має бути пізніше його початку.');
  });

  it('allows one final open ticket only in an active shift', () => {
    const activeBounds = {
      ...completedBounds,
      effectiveShiftEndTime: '2026-06-10T12:00:00.000Z',
      allowOpenTicket: true
    };

    expect(() =>
      validateAndSortWorkTickets(
        [
          makeTicket({ id: 'ticket-1' }),
          makeTicket({
            id: 'ticket-2',
            startedAt: '2026-06-10T09:00:00.000Z',
            endedAt: null,
            actualQuantity: null
          })
        ],
        activeBounds
      )
    ).not.toThrow();

    expect(() =>
      validateAndSortWorkTickets(
        [
          makeTicket({ id: 'ticket-1', endedAt: null, actualQuantity: null }),
          makeTicket({
            id: 'ticket-2',
            startedAt: '2026-06-10T09:00:00.000Z',
            endedAt: '2026-06-10T10:00:00.000Z'
          })
        ],
        activeBounds
      )
    ).toThrow('Незавершений тікет може бути лише один і останній.');
  });

  it('rejects invalid actual quantity and excessive downtime', () => {
    expect(() =>
      validateAndSortWorkTickets(
        [makeTicket({ actualQuantity: -1 })],
        completedBounds
      )
    ).toThrow('Фактична кількість');

    expect(() =>
      validateAndSortWorkTickets(
        [makeTicket({ downtimeMinutes: 61 })],
        completedBounds
      )
    ).toThrow('Простій не може бути довшим за тікет.');

    expect(() =>
      validateAndSortWorkTickets(
        [makeTicket({ manualCompletionPercent: -1 })],
        completedBounds
      )
    ).toThrow('Ручний відсоток');

    expect(() =>
      validateAndSortWorkTickets(
        [makeTicket({ manualCompletionPercent: 99.5 })],
        completedBounds
      )
    ).toThrow('Ручний відсоток');
  });

  it('accepts the maximum norm and rejects larger or non-finite values', () => {
    expect(() =>
      validateAndSortWorkTickets(
        [makeTicket({ normPerEightHours: 999 })],
        completedBounds
      )
    ).not.toThrow();

    for (const normPerEightHours of [1_000, Number.POSITIVE_INFINITY]) {
      expect(() =>
        validateAndSortWorkTickets(
          [makeTicket({ normPerEightHours })],
          completedBounds
        )
      ).toThrow('не більшою за 999');
    }
  });
});

describe('calculateTicketProductionSummary', () => {
  it('recalculates grade targets when downtime increases or decreases', () => {
    const calculateTarget = (downtimeMinutes: number) =>
      calculateTicketProductionSummary({
        ticket: makeTicket({ endedAt: null, actualQuantity: null, downtimeMinutes }),
        effectiveEndTime: '2026-06-10T10:00:00.000Z',
        currentGrade: 2,
        gradeNormPercents: [100, 120, 140, 160]
      });

    expect(calculateTarget(0).currentTarget).toBe(23);
    expect(calculateTarget(60).currentTarget).toBe(15);
    expect(calculateTarget(30).currentTarget).toBe(19);
    expect(calculateTarget(180)).toMatchObject({
      productiveMinutes: 0,
      currentTarget: 0
    });
  });

  it('subtracts accumulated downtime and returns all grade targets', () => {
    const ticket = makeTicket({
      endedAt: null,
      actualQuantity: null,
      downtimeMinutes: 75
    });
    const atTen = calculateTicketProductionSummary({
      ticket,
      effectiveEndTime: '2026-06-10T10:00:30.000Z',
      currentGrade: 2,
      gradeNormPercents: [100, 120, 140, 160]
    });
    const atEleven = calculateTicketProductionSummary({
      ticket,
      effectiveEndTime: '2026-06-10T11:00:30.000Z',
      currentGrade: 2,
      gradeNormPercents: [100, 120, 140, 160]
    });

    expect(atTen).toMatchObject({
      elapsedMinutes: 180,
      downtimeMinutes: 75,
      productiveMinutes: 105,
      currentTarget: 14
    });
    expect(atTen.targets).toEqual([
      { grade: 1, quantity: 11 },
      { grade: 2, quantity: 14 },
      { grade: 3, quantity: 16 },
      { grade: 4, quantity: 18 }
    ]);
    expect(atEleven).toMatchObject({
      elapsedMinutes: 240,
      downtimeMinutes: 75,
      productiveMinutes: 165,
      currentTarget: 21
    });
    expect(atEleven.targets).toEqual([
      { grade: 1, quantity: 18 },
      { grade: 2, quantity: 21 },
      { grade: 3, quantity: 25 },
      { grade: 4, quantity: 28 }
    ]);
  });

  it('finds the highest achieved grade and reports below grade one', () => {
    const achieved = calculateTicketProductionSummary({
      ticket: makeTicket({ actualQuantity: 9, downtimeMinutes: 0 }),
      effectiveEndTime: '2026-06-10T08:00:00.000Z',
      currentGrade: 2,
      gradeNormPercents: [100, 120, 140, 160]
    });
    const below = calculateTicketProductionSummary({
      ticket: makeTicket({ actualQuantity: 5, downtimeMinutes: 0 }),
      effectiveEndTime: '2026-06-10T08:00:00.000Z',
      currentGrade: 2,
      gradeNormPercents: [100, 120, 140, 160]
    });
    const zeroFact = calculateTicketProductionSummary({
      ticket: makeTicket({ actualQuantity: 0, downtimeMinutes: 0 }),
      effectiveEndTime: '2026-06-10T08:00:00.000Z',
      currentGrade: 2,
      gradeNormPercents: [100, 120, 140, 160]
    });
    const noProductiveTime = calculateTicketProductionSummary({
      ticket: makeTicket({ actualQuantity: 0, downtimeMinutes: 60 }),
      effectiveEndTime: '2026-06-10T08:00:00.000Z',
      currentGrade: 2,
      gradeNormPercents: [100, 120, 140, 160]
    });

    expect(achieved.achievedGrade).toBe(3);
    expect(achieved.completionPercent).toBe(9 / 7 * 100);
    expect(below.achievedGrade).toBeNull();
    expect(zeroFact).toMatchObject({ achievedGrade: null, completionPercent: 0 });
    expect(noProductiveTime).toMatchObject({
      productiveMinutes: 0,
      currentTarget: 0,
      completionPercent: null,
      achievedGrade: null
    });
  });

  it('uses a manual company percent without changing the achieved grade', () => {
    const automatic = calculateTicketProductionSummary({
      ticket: makeTicket({ actualQuantity: 9 }),
      effectiveEndTime: '2026-06-10T08:00:00.000Z',
      currentGrade: 2,
      gradeNormPercents: [100, 120, 140, 160]
    });
    const manual = calculateTicketProductionSummary({
      ticket: makeTicket({ actualQuantity: 9, manualCompletionPercent: 87 }),
      effectiveEndTime: '2026-06-10T08:00:00.000Z',
      currentGrade: 2,
      gradeNormPercents: [100, 120, 140, 160]
    });

    expect(automatic.completionPercent).toBe(9 / 7 * 100);
    expect(manual.completionPercent).toBe(87);
    expect(manual.achievedGrade).toBe(automatic.achievedGrade);
  });
});

describe('calculateShiftProductionSummary', () => {
  it('aggregates filled tickets and keeps unfilled tickets out of numeric totals', () => {
    const summary = calculateShiftProductionSummary({
      shift: {
        gradeSnapshot: {
          currentGrade: 2,
          desiredGrade: 3,
          gradeSalaryBonusPercents: [10, 10, 15, 15],
          gradeNormPercents: [100, 120, 140, 160],
          cumulativeSalaryBonusPercent: 20
        },
        workTickets: [
          makeTicket({ normPerEightHours: 80, actualQuantity: 10 }),
          makeTicket({
            id: 'ticket-2',
            normPerEightHours: 80,
            startedAt: '2026-06-10T08:00:00.000Z',
            endedAt: '2026-06-10T10:00:00.000Z',
            actualQuantity: 20,
            downtimeMinutes: 30
          }),
          makeTicket({
            id: 'ticket-3',
            startedAt: '2026-06-10T10:00:00.000Z',
            endedAt: '2026-06-10T11:00:00.000Z',
            actualQuantity: null,
            downtimeMinutes: 10
          })
        ]
      },
      fallbackCurrentGrade: 1,
      fallbackGradeNormPercents: [100, 120, 140, 160]
    });

    expect(summary).toEqual({
      ticketCount: 3,
      filledTicketCount: 2,
      unfilledTicketCount: 1,
      actualQuantity: 30,
      currentGradeTarget: 30,
      completionPercent: 120,
      productiveMinutes: 150,
      downtimeMinutes: 30
    });
  });

  it('uses fallback grade settings for legacy shifts and handles a zero target', () => {
    const summary = calculateShiftProductionSummary({
      shift: {
        gradeSnapshot: null,
        workTickets: [makeTicket({ actualQuantity: 0, downtimeMinutes: 60 })]
      },
      fallbackCurrentGrade: 3,
      fallbackGradeNormPercents: [100, 120, 140, 160]
    });

    expect(summary).toMatchObject({
      ticketCount: 1,
      filledTicketCount: 1,
      actualQuantity: 0,
      currentGradeTarget: 0,
      completionPercent: null,
      productiveMinutes: 0,
      downtimeMinutes: 60
    });
  });

  it('weights manual and automatic completion by each ticket G1 target', () => {
    const summary = calculateShiftProductionSummary({
      shift: {
        gradeSnapshot: null,
        workTickets: [
          makeTicket({
            normPerEightHours: 80,
            actualQuantity: 12,
            manualCompletionPercent: 200
          }),
          makeTicket({
            id: 'ticket-2',
            normPerEightHours: 80,
            startedAt: '2026-06-10T08:00:00.000Z',
            endedAt: '2026-06-10T10:00:00.000Z',
            actualQuantity: 10
          })
        ]
      },
      fallbackCurrentGrade: 1,
      fallbackGradeNormPercents: [100, 120, 140, 160]
    });

    expect(summary.actualQuantity).toBe(22);
    expect(summary.completionPercent).toBe(100);
  });
});
