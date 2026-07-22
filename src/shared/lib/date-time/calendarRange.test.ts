import { describe, expect, it } from 'vitest';
import {
  countWeekdaysInDateRange,
  getCalendarPresetSelection,
  type CalendarDateRange
} from './calendarRange';

const allTimeRange: CalendarDateRange = {
  start: '2026-05-15',
  end: '2026-07-22'
};

describe('calendar range presets', () => {
  it('selects today and moves the visible calendar to the current month', () => {
    expect(
      getCalendarPresetSelection({
        preset: 'today',
        calendarMonth: { year: 2026, month: 5 },
        allTimeRange,
        now: new Date(2026, 6, 22, 12)
      })
    ).toEqual({
      calendarMonth: { year: 2026, month: 7 },
      selectedRange: { start: '2026-07-22', end: '2026-07-22' }
    });
  });

  it('keeps the visible month and clears a custom range for the month preset', () => {
    expect(
      getCalendarPresetSelection({
        preset: 'month',
        calendarMonth: { year: 2026, month: 5 },
        allTimeRange
      })
    ).toEqual({
      calendarMonth: { year: 2026, month: 5 },
      selectedRange: null
    });
  });

  it('uses the complete local-data range', () => {
    const selection = getCalendarPresetSelection({
      preset: 'all',
      calendarMonth: { year: 2026, month: 7 },
      allTimeRange
    });

    expect(selection.selectedRange).toEqual(allTimeRange);
    expect(selection.calendarMonth).toEqual({ year: 2026, month: 7 });
  });

  it('does not create an all-time range when local data is empty', () => {
    expect(
      getCalendarPresetSelection({
        preset: 'all',
        calendarMonth: { year: 2026, month: 7 },
        allTimeRange: null
      }).selectedRange
    ).toBeNull();
  });

  it('counts weekdays inclusively for forward and reversed ranges', () => {
    expect(countWeekdaysInDateRange('2026-07-20', '2026-07-26')).toBe(5);
    expect(countWeekdaysInDateRange('2026-07-26', '2026-07-20')).toBe(5);
  });
});
