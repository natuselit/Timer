import { describe, expect, it } from 'vitest';
import type { Shift } from '../../../entities/shift';
import {
  calculateScheduleControlSummary,
  getScheduleWarningFingerprint
} from './scheduleControl';

const makeShift = (overrides: Partial<Shift> = {}): Shift => ({
  id: 'shift-1',
  date: '2026-07-27',
  type: 'first',
  detectionMode: 'manual',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  startTime: '2026-07-27T06:30:00.000+03:00',
  endTime: '2026-07-27T14:30:00.000+03:00',
  baseHourlyRateSnapshot: 120,
  hourlyRateSnapshot: 120,
  gradeSnapshot: null,
  workTickets: [],
  coefficientMode: 'auto',
  isAutoClosed: false,
  createdAt: '2026-07-27T06:30:00.000+03:00',
  updatedAt: '2026-07-27T14:30:00.000+03:00',
  ...overrides
});

describe('calculateScheduleControlSummary', () => {
  it('creates warnings for lateness and early exit of completed shifts', () => {
    const summary = calculateScheduleControlSummary([
      makeShift({
        startTime: '2026-07-27T06:45:00.000+03:00',
        endTime: '2026-07-27T14:20:00.000+03:00'
      }),
      makeShift({
        id: 'on-time',
        date: '2026-07-28',
        startTime: '2026-07-28T06:30:00.000+03:00',
        endTime: '2026-07-28T14:30:00.000+03:00'
      })
    ]);

    expect(summary).toMatchObject({
      completedShiftCount: 2,
      onScheduleShiftCount: 1,
      lateArrivalMinutes: 15,
      earlyExitMinutes: 10,
      lateArrivalShiftCount: 1,
      earlyExitShiftCount: 1,
      scheduleAdherencePercent: 50
    });
    expect(summary.warnings).toEqual([
      expect.objectContaining({
        shiftId: 'shift-1',
        date: '2026-07-27',
        lateArrivalMinutes: 15,
        earlyExitMinutes: 10
      })
    ]);
  });

  it('ignores active shifts and returns safe empty aggregates', () => {
    expect(calculateScheduleControlSummary([makeShift({ endTime: null })])).toEqual({
      completedShiftCount: 0,
      onScheduleShiftCount: 0,
      lateArrivalMinutes: 0,
      earlyExitMinutes: 0,
      lateArrivalShiftCount: 0,
      earlyExitShiftCount: 0,
      averageLateArrivalMinutes: 0,
      averageEarlyExitMinutes: 0,
      scheduleAdherencePercent: null,
      warnings: []
    });
  });

  it('changes the fingerprint only when schedule-relevant shift data changes', () => {
    const shift = makeShift();
    const fingerprint = getScheduleWarningFingerprint(shift);
    const financiallyEditedShift: Shift = {
      ...shift,
      updatedAt: '2026-07-28T10:00:00.000+03:00',
      baseHourlyRateSnapshot: 240
    };

    expect(getScheduleWarningFingerprint(financiallyEditedShift)).toBe(
      fingerprint
    );
    expect(
      getScheduleWarningFingerprint({
        ...shift,
        endTime: '2026-07-27T14:20:00.000+03:00'
      })
    ).not.toBe(fingerprint);
  });
});
