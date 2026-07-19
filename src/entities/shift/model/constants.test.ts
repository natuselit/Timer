import { describe, expect, it } from 'vitest';
import {
  COEFFICIENT_MODES,
  COEFFICIENT_VALUES,
  FIRST_SHIFT_END,
  FIRST_SHIFT_START,
  PLANNED_SHIFTS,
  SECOND_SHIFT_END,
  SECOND_SHIFT_START
} from './constants';
import type { CoefficientMode, Shift, ShiftDetectionMode, ShiftType } from './types';

describe('shift domain constants', () => {
  it('keeps planned shift windows fixed', () => {
    expect(PLANNED_SHIFTS).toEqual({
      first: { start: '06:30', end: '14:30' },
      second: { start: '14:30', end: '22:30' }
    });

    expect(FIRST_SHIFT_START).toBe('06:30');
    expect(FIRST_SHIFT_END).toBe('14:30');
    expect(SECOND_SHIFT_START).toBe('14:30');
    expect(SECOND_SHIFT_END).toBe('22:30');
  });

  it('exposes supported coefficient modes and values', () => {
    expect(COEFFICIENT_MODES).toEqual(['auto', 'x1', 'x1.5', 'x2']);
    expect(COEFFICIENT_VALUES).toEqual({
      auto: null,
      x1: 1,
      'x1.5': 1.5,
      x2: 2
    });
  });
});

describe('shift domain types', () => {
  it('accepts the base shift shape', () => {
    const shift = {
      id: 'shift-1',
      date: '2026-06-23',
      type: 'first',
      detectionMode: 'auto',
      plannedStartTime: '06:30',
      plannedEndTime: '14:30',
      startTime: '2026-06-23T06:31:00.000+03:00',
      endTime: null,
      baseHourlyRateSnapshot: 100,
      hourlyRateSnapshot: 100,
      gradeSnapshot: null,
      workTickets: [],
      coefficientMode: 'auto',
      isAutoClosed: false,
      createdAt: '2026-06-23T06:31:00.000+03:00',
      updatedAt: '2026-06-23T06:31:00.000+03:00'
    } satisfies Shift;

    const shiftType: ShiftType = shift.type;
    const coefficientMode: CoefficientMode = shift.coefficientMode;
    const detectionMode: ShiftDetectionMode = shift.detectionMode;

    expect(shiftType).toBe('first');
    expect(coefficientMode).toBe('auto');
    expect(detectionMode).toBe('auto');
  });
});
