import { describe, expect, it } from 'vitest';
import type { WorkTicket } from './types';
import {
  calculateTicketProductionSummary,
  validateAndSortWorkTickets
} from './workTickets';

const makeTicket = (overrides: Partial<WorkTicket> = {}): WorkTicket => ({
  id: 'ticket-1',
  normPerEightHours: 50,
  startedAt: '2026-06-10T07:00:00.000Z',
  endedAt: '2026-06-10T08:00:00.000Z',
  actualQuantity: 12,
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
    expect(below.achievedGrade).toBeNull();
    expect(zeroFact).toMatchObject({ achievedGrade: null, completionPercent: 0 });
    expect(noProductiveTime).toMatchObject({
      productiveMinutes: 0,
      currentTarget: 0,
      completionPercent: null,
      achievedGrade: null
    });
  });
});
