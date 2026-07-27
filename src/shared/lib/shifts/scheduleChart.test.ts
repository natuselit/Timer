import { describe, expect, it } from 'vitest';
import {
  calculateScheduleChartData,
  getScheduleChartGranularity
} from './scheduleChart';

describe('schedule chart grouping', () => {
  it('groups up to 31 days daily, 32–92 weekly and longer ranges monthly', () => {
    expect(getScheduleChartGranularity('2026-07-01', '2026-07-31')).toBe('day');
    expect(getScheduleChartGranularity('2026-07-01', '2026-08-01')).toBe('week');
    expect(getScheduleChartGranularity('2026-07-01', '2026-10-01')).toBe('month');
  });

  it('counts an overnight planned shift across midnight', () => {
    const data = calculateScheduleChartData({
      start: '2026-07-01',
      end: '2026-07-01',
      scheduleItems: [
        {
          id: 'night',
          date: '2026-07-01',
          shiftType: 'night',
          templateId: 'night',
          templateNameSnapshot: 'Нічна',
          plannedStartTime: '22:00',
          plannedEndTime: '06:00',
          enterpriseStartTime: '22:00',
          enterpriseEndTime: '06:00',
          skipped: false,
          sourceText: '',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z'
        }
      ],
      shifts: [],
      now: '2026-07-01T12:00:00.000Z',
      fallbackHourlyRate: 100,
      coefficientMode: 'auto'
    });

    expect(data.points).toHaveLength(1);
    expect(data.points[0].plannedHours).toBe(8);
    expect(data.points[0].expectedMoney).toBe(800);
  });
});
