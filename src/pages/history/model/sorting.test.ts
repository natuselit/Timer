import { describe, expect, it } from 'vitest';
import type { Shift } from '../../../entities/shift';
import { sortShifts, type ShiftSortCriterion } from './sorting';

const makeShift = (overrides: Partial<Shift> = {}): Shift => ({
  id: 'shift-a',
  date: '2026-07-01',
  type: 'first',
  detectionMode: 'manual',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  startTime: '2026-07-01T06:30:00.000+03:00',
  endTime: '2026-07-01T14:30:00.000+03:00',
  baseHourlyRateSnapshot: 100,
  hourlyRateSnapshot: 100,
  gradeSnapshot: null,
  workTickets: [],
  note: '',
  coefficientMode: 'x1',
  isAutoClosed: false,
  createdAt: '2026-07-01T06:30:00.000+03:00',
  updatedAt: '2026-07-01T14:30:00.000+03:00',
  ...overrides
});

const shifts: Shift[] = [
  makeShift({
    id: 'shift-a',
    date: '2026-07-01',
    endTime: '2026-07-01T14:30:00.000+03:00',
    baseHourlyRateSnapshot: 100,
    hourlyRateSnapshot: 100,
    workTickets: [
      {
        id: 'ticket-a',
        normPerEightHours: 50,
        startedAt: '2026-07-01T06:30:00.000+03:00',
        endedAt: '2026-07-01T14:30:00.000+03:00',
        actualQuantity: 50,
        manualCompletionPercent: null,
        downtimeMinutes: 10,
        createdAt: '2026-07-01T06:30:00.000+03:00',
        updatedAt: '2026-07-01T14:30:00.000+03:00'
      }
    ]
  }),
  makeShift({
    id: 'shift-b',
    date: '2026-07-02',
    startTime: '2026-07-02T06:30:00.000+03:00',
    endTime: '2026-07-02T12:30:00.000+03:00',
    baseHourlyRateSnapshot: 200,
    hourlyRateSnapshot: 200,
    createdAt: '2026-07-02T06:30:00.000+03:00',
    updatedAt: '2026-07-02T12:30:00.000+03:00',
    workTickets: [
      {
        id: 'ticket-b1',
        normPerEightHours: 50,
        startedAt: '2026-07-02T06:30:00.000+03:00',
        endedAt: '2026-07-02T09:30:00.000+03:00',
        actualQuantity: 25,
        manualCompletionPercent: null,
        downtimeMinutes: 20,
        createdAt: '2026-07-02T06:30:00.000+03:00',
        updatedAt: '2026-07-02T09:30:00.000+03:00'
      },
      {
        id: 'ticket-b2',
        normPerEightHours: 50,
        startedAt: '2026-07-02T09:30:00.000+03:00',
        endedAt: '2026-07-02T12:30:00.000+03:00',
        actualQuantity: 25,
        manualCompletionPercent: null,
        downtimeMinutes: 20,
        createdAt: '2026-07-02T09:30:00.000+03:00',
        updatedAt: '2026-07-02T12:30:00.000+03:00'
      }
    ]
  })
];

describe('sortShifts', () => {
  const cases: Array<[ShiftSortCriterion, string, string]> = [
    ['date', 'shift-a', 'shift-b'],
    ['duration', 'shift-b', 'shift-a'],
    ['earnings', 'shift-a', 'shift-b'],
    ['hourlyRate', 'shift-a', 'shift-b'],
    ['tickets', 'shift-a', 'shift-b'],
    ['downtime', 'shift-a', 'shift-b']
  ];

  it.each(cases)('sorts by %s in both directions', (criterion, ascending, descending) => {
    expect(
      sortShifts(shifts, criterion, 'ascending', '2026-07-03T12:00:00.000+03:00').map(
        (shift) => shift.id
      )
    ).toEqual([ascending, descending]);
    expect(
      sortShifts(shifts, criterion, 'descending', '2026-07-03T12:00:00.000+03:00').map(
        (shift) => shift.id
      )
    ).toEqual([descending, ascending]);
  });

  it('uses newest date and then id as stable tie-breakers', () => {
    const tied = [
      makeShift({ id: 'shift-c', date: '2026-07-02' }),
      makeShift({ id: 'shift-b', date: '2026-07-02' }),
      makeShift({ id: 'shift-a', date: '2026-07-01' })
    ];

    expect(
      sortShifts(tied, 'hourlyRate', 'ascending', '2026-07-03T12:00:00.000+03:00').map(
        (shift) => shift.id
      )
    ).toEqual(['shift-b', 'shift-c', 'shift-a']);
  });
});
