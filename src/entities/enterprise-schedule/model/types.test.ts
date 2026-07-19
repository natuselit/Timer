import { describe, expect, it } from 'vitest';
import type { EnterpriseScheduleItem } from './types';

describe('enterprise schedule domain types', () => {
  it('accepts an imported planned shift item', () => {
    const item = {
      id: 'schedule-1',
      date: '2026-06-23',
      shiftType: 'second',
      plannedStartTime: '14:30',
      plannedEndTime: '22:30',
      enterpriseStartTime: '14:10',
      enterpriseEndTime: '22:45',
      skipped: false,
      sourceText: '23.06 друга зміна',
      createdAt: '2026-06-23T08:00:00.000+03:00',
      updatedAt: '2026-06-23T08:00:00.000+03:00'
    } satisfies EnterpriseScheduleItem;

    expect(item.shiftType).toBe('second');
    expect(item.plannedStartTime).toBe('14:30');
    expect(item.plannedEndTime).toBe('22:30');
    expect(item.enterpriseStartTime).toBe('14:10');
    expect(item.enterpriseEndTime).toBe('22:45');
    expect(item.skipped).toBe(false);
  });
});
