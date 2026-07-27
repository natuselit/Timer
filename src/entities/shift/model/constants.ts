import type { CoefficientMode, ShiftTemplate, ShiftType } from './types';

export const FIRST_SHIFT_START = '06:30';
export const FIRST_SHIFT_END = '14:30';
export const SECOND_SHIFT_START = '14:30';
export const SECOND_SHIFT_END = '22:30';
export const FIRST_SHIFT_TEMPLATE_ID = 'first';
export const SECOND_SHIFT_TEMPLATE_ID = 'second';

const BUILT_IN_TIMESTAMP = new Date(0).toISOString();

export const BUILT_IN_SHIFT_TEMPLATES: readonly ShiftTemplate[] = [
  {
    id: FIRST_SHIFT_TEMPLATE_ID,
    name: '1 зміна',
    startTime: FIRST_SHIFT_START,
    endTime: FIRST_SHIFT_END,
    isBuiltIn: true,
    enabled: true,
    createdAt: BUILT_IN_TIMESTAMP,
    updatedAt: BUILT_IN_TIMESTAMP
  },
  {
    id: SECOND_SHIFT_TEMPLATE_ID,
    name: '2 зміна',
    startTime: SECOND_SHIFT_START,
    endTime: SECOND_SHIFT_END,
    isBuiltIn: true,
    enabled: true,
    createdAt: BUILT_IN_TIMESTAMP,
    updatedAt: BUILT_IN_TIMESTAMP
  }
] as const;

export const PLANNED_SHIFTS: Record<
  'first' | 'second',
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

export const getBuiltInShiftTemplate = (id: ShiftType): ShiftTemplate | undefined =>
  BUILT_IN_SHIFT_TEMPLATES.find((template) => template.id === id);
