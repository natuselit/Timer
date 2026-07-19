import { describe, expect, it } from 'vitest';
import type { Shift } from '../../../entities/shift';
import { calculateMonthShiftSummary } from './monthSummary';

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

describe('calculateMonthShiftSummary', () => {
  it('sums salary, completed shifts and minutes for month header', () => {
    expect(
      calculateMonthShiftSummary([
        makeShift(),
        makeShift({
          id: 'shift-2',
          date: '2026-06-24',
          coefficientMode: 'x2',
          startTime: '2026-06-24T06:30:00.000+03:00',
          endTime: '2026-06-24T07:30:00.000+03:00'
        })
      ])
    ).toEqual({
      totalAmount: 1_200,
      shiftCount: 2,
      totalMinutes: 540
    });
  });

  it('includes an active shift amount and count when current time is provided', () => {
    expect(
      calculateMonthShiftSummary(
        [
          makeShift({
            endTime: null
          })
        ],
        '2026-06-23T07:30:00.000+03:00'
      )
    ).toEqual({
      totalAmount: 120,
      shiftCount: 1,
      totalMinutes: 60
    });
  });
});
