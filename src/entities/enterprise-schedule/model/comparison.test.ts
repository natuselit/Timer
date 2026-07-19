import { describe, expect, it } from 'vitest';
import type { Shift } from '../../shift';
import type { EnterpriseScheduleItem } from './types';
import {
  calculateEnterpriseScheduleComparison,
  synchronizeShiftWithEnterpriseSchedule
} from './comparison';

const makeShift = (overrides: Partial<Shift> = {}): Shift => ({
  id: 'shift-1',
  date: '2026-06-01',
  type: 'first',
  detectionMode: 'auto',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  startTime: '2026-06-01T06:30:00.000+03:00',
  endTime: '2026-06-01T14:30:00.000+03:00',
  baseHourlyRateSnapshot: 120,
  hourlyRateSnapshot: 120,
  gradeSnapshot: null,
  workTickets: [],
  coefficientMode: 'auto',
  isAutoClosed: false,
  createdAt: '2026-06-01T06:30:00.000+03:00',
  updatedAt: '2026-06-01T14:30:00.000+03:00',
  ...overrides
});

const makeScheduleItem = (overrides: Partial<EnterpriseScheduleItem> = {}): EnterpriseScheduleItem => ({
  id: 'enterprise-schedule-2026-06-01',
  date: '2026-06-01',
  shiftType: 'first',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  enterpriseStartTime: '05:57',
  enterpriseEndTime: '16:52',
  skipped: false,
  sourceText: '--01.06.2026--',
  createdAt: '2026-06-23T10:00:00.000+03:00',
  updatedAt: '2026-06-23T10:00:00.000+03:00',
  ...overrides
});

describe('calculateEnterpriseScheduleComparison', () => {
  it('reports duration and salary differences by date', () => {
    const comparison = calculateEnterpriseScheduleComparison([makeScheduleItem()], [makeShift()]);

    expect(comparison.discrepancies).toHaveLength(1);
    expect(comparison.discrepancies[0]).toMatchObject({
      date: '2026-06-01',
      actualDurationMinutes: 480,
      enterpriseDurationMinutes: 655,
      durationDifferenceMinutes: 175,
      actualSalaryAmount: 960,
      enterpriseSalaryAmount: 1_485,
      salaryDifferenceAmount: 525
    });
  });

  it('does not report skipped or matching schedule items', () => {
    const matchingSchedule = makeScheduleItem({
      enterpriseStartTime: '06:30',
      enterpriseEndTime: '14:30'
    });
    const skippedSchedule = makeScheduleItem({
      id: 'enterprise-schedule-2026-06-02',
      date: '2026-06-02',
      skipped: true
    });

    const comparison = calculateEnterpriseScheduleComparison(
      [matchingSchedule, skippedSchedule],
      [
        makeShift(),
        makeShift({
          id: 'shift-2',
          date: '2026-06-02',
          startTime: '2026-06-02T06:30:00.000+03:00',
          endTime: '2026-06-02T14:30:00.000+03:00'
        })
      ]
    );

    expect(comparison.discrepancies).toEqual([]);
  });
});

describe('synchronizeShiftWithEnterpriseSchedule', () => {
  it('replaces actual start and end with enterprise schedule time', () => {
    const syncedShift = synchronizeShiftWithEnterpriseSchedule(
      makeShift(),
      makeScheduleItem(),
      '2026-06-23T12:00:00.000+03:00'
    );

    expect(syncedShift).toMatchObject({
      startTime: '2026-06-01T05:57:00.000+03:00',
      endTime: '2026-06-01T16:52:00.000+03:00',
      detectionMode: 'manual',
      updatedAt: '2026-06-23T12:00:00.000+03:00'
    });
  });

  it('removes the discrepancy after synchronization', () => {
    const scheduleItem = makeScheduleItem();
    const syncedShift = synchronizeShiftWithEnterpriseSchedule(
      makeShift(),
      scheduleItem,
      '2026-06-23T12:00:00.000+03:00'
    );

    const comparison = calculateEnterpriseScheduleComparison([scheduleItem], [syncedShift]);

    expect(comparison.discrepancies).toEqual([]);
  });
});
