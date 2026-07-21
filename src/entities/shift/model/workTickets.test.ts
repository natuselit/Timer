import { describe, expect, it } from 'vitest';
import type { WorkTicket } from './types';
import { validateAndSortWorkTickets } from './workTickets';

const makeTicket = (overrides: Partial<WorkTicket> = {}): WorkTicket => ({
  id: 'ticket-1',
  normPerEightHours: 50,
  startedAt: '2026-06-10T07:00:00.000Z',
  endedAt: '2026-06-10T08:00:00.000Z',
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
            endedAt: null
          })
        ],
        activeBounds
      )
    ).not.toThrow();

    expect(() =>
      validateAndSortWorkTickets(
        [
          makeTicket({ id: 'ticket-1', endedAt: null }),
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
});
