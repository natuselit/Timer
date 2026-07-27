import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_SHIFT_TEMPLATES,
  detectShiftTemplate,
  getCurrentShiftCoefficient,
  getPlannedShiftWindow,
  getShiftTemplateDurationMinutes,
  validateShiftTemplates,
  type ShiftTemplate
} from './index';

const customTemplate = (
  overrides: Partial<ShiftTemplate> = {}
): ShiftTemplate => ({
  id: 'night',
  name: 'Нічна',
  startTime: '22:00',
  endTime: '06:00',
  isBuiltIn: false,
  enabled: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...overrides
});

describe('shift templates', () => {
  it('supports a night template shorter than 24 hours', () => {
    const template = customTemplate();

    expect(getShiftTemplateDurationMinutes(template)).toBe(480);
    expect(() =>
      validateShiftTemplates([...BUILT_IN_SHIFT_TEMPLATES, template])
    ).not.toThrow();
  });

  it('rejects zero duration and duplicate active starts', () => {
    expect(() =>
      validateShiftTemplates([
        ...BUILT_IN_SHIFT_TEMPLATES,
        customTemplate({ startTime: '22:00', endTime: '22:00' })
      ])
    ).toThrow('від 1 до 1439');

    expect(() =>
      validateShiftTemplates([
        ...BUILT_IN_SHIFT_TEMPLATES,
        customTemplate({ startTime: '06:30' })
      ])
    ).toThrow('однаковий час початку');
  });

  it('uses template order when cyclic distances are equal', () => {
    const templates = [
      customTemplate({ id: 'left', startTime: '23:00', endTime: '05:00' }),
      customTemplate({ id: 'right', startTime: '01:00', endTime: '07:00' })
    ];

    expect(detectShiftTemplate('2026-07-01T00:00:00.000Z', templates)).toBe('left');
  });

  it('builds the planned end on the next date for a night shift', () => {
    const window = getPlannedShiftWindow(
      '2026-07-01',
      'night',
      '2026-07-01T22:00:00.000Z',
      { startTime: '22:00', endTime: '06:00' }
    );

    expect(window.plannedStart).toBe('2026-07-01T22:00:00.000Z');
    expect(window.plannedEnd).toBe('2026-07-02T06:00:00.000Z');
  });

  it('switches auto coefficient exactly on planned boundaries', () => {
    const shift = {
      date: '2026-07-01',
      type: 'night',
      plannedStartTime: '22:00',
      plannedEndTime: '06:00',
      startTime: '2026-07-01T21:30:00.000Z',
      coefficientMode: 'auto' as const
    };

    expect(getCurrentShiftCoefficient(shift, '2026-07-01T21:59:59.000Z')).toBe(1.5);
    expect(getCurrentShiftCoefficient(shift, '2026-07-01T22:00:00.000Z')).toBe(1);
    expect(getCurrentShiftCoefficient(shift, '2026-07-02T05:59:59.000Z')).toBe(1);
    expect(getCurrentShiftCoefficient(shift, '2026-07-02T06:00:00.000Z')).toBe(1.5);
  });
});
