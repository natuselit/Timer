import type { CoefficientMode, ShiftType } from './types';

export const FIRST_SHIFT_START = '06:30';
export const FIRST_SHIFT_END = '14:30';
export const SECOND_SHIFT_START = '14:30';
export const SECOND_SHIFT_END = '22:30';
export const SHIFT_NOTE_MAX_LENGTH = 500;

export const PLANNED_SHIFTS: Record<
  ShiftType,
  {
    start: string;
    end: string;
  }
> = {
  first: {
    start: FIRST_SHIFT_START,
    end: FIRST_SHIFT_END
  },
  second: {
    start: SECOND_SHIFT_START,
    end: SECOND_SHIFT_END
  }
};

export const COEFFICIENT_VALUES: Record<CoefficientMode, number | null> = {
  auto: null,
  x1: 1,
  'x1.5': 1.5,
  x2: 2
};

export const COEFFICIENT_MODES = Object.keys(
  COEFFICIENT_VALUES
) as CoefficientMode[];
