import { describe, expect, it } from 'vitest';
import { detectShiftType } from './detection';
import type { Shift, ShiftDetectionMode, ShiftType } from './types';

describe('detectShiftType', () => {
  it('detects first shift at the planned first shift start', () => {
    expect(detectShiftType('2026-06-23T06:30:00.000+03:00')).toBe('first');
  });

  it('detects second shift at the planned second shift start', () => {
    expect(detectShiftType('2026-06-23T14:30:00.000+03:00')).toBe('second');
  });

  it('detects first shift before the midpoint between planned starts', () => {
    expect(detectShiftType('2026-06-23T10:29:00.000+03:00')).toBe('first');
  });

  it('keeps the exact midpoint between planned starts on first shift', () => {
    expect(detectShiftType('2026-06-23T10:30:00.000+03:00')).toBe('first');
  });

  it('detects second shift after the midpoint between planned starts', () => {
    expect(detectShiftType('2026-06-23T10:31:00.000+03:00')).toBe('second');
  });

  it('detects second shift for early arrival near the second shift start', () => {
    expect(detectShiftType('2026-06-23T14:29:00.000+03:00')).toBe('second');
  });

  it('detects first shift when arrival is before the first planned start', () => {
    expect(detectShiftType('2026-06-23T05:50:00.000+03:00')).toBe('first');
  });

  it('detects second shift when arrival is after the second planned start', () => {
    expect(detectShiftType('2026-06-23T22:30:00.000+03:00')).toBe('second');
  });

  it('throws for invalid date time values', () => {
    expect(() => detectShiftType('2026-06-23 06:30' as string)).toThrow(
      'Invalid date time: 2026-06-23 06:30'
    );
  });
});

describe('manual shift type override support', () => {
  it('allows persisted shifts to mark a manually overridden type', () => {
    const shift = {
      id: 'shift-1',
      date: '2026-06-23',
      type: 'second',
      detectionMode: 'manual',
      plannedStartTime: '14:30',
      plannedEndTime: '22:30',
      startTime: '2026-06-23T10:30:00.000+03:00',
      endTime: null,
      baseHourlyRateSnapshot: 100,
      hourlyRateSnapshot: 100,
      gradeSnapshot: null,
      workTickets: [],
      note: '',
      coefficientMode: 'auto',
      isAutoClosed: false,
      createdAt: '2026-06-23T10:30:00.000+03:00',
      updatedAt: '2026-06-23T10:35:00.000+03:00'
    } satisfies Shift;

    const shiftType: ShiftType = shift.type;
    const detectionMode: ShiftDetectionMode = shift.detectionMode;

    expect(detectShiftType(shift.startTime)).toBe('first');
    expect(shiftType).toBe('second');
    expect(detectionMode).toBe('manual');
  });
});
