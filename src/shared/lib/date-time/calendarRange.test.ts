import { describe, expect, it } from 'vitest';
import {
  countWeekdaysInDateRange,
  getCalendarPresetSelection,
  getNextHeldCalendarRange,
  getSingleDateRange,
  shouldResetCalendarRangeOnMonthNavigation,
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

  it('selects and highlights the complete visible month for the month preset', () => {
    expect(
      getCalendarPresetSelection({
        preset: 'month',
        calendarMonth: { year: 2026, month: 5 },
        allTimeRange
      })
    ).toEqual({
      calendarMonth: { year: 2026, month: 5 },
      selectedRange: { start: '2026-05-01', end: '2026-05-31' }
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

  it('keeps a short date selection as a complete single-day range', () => {
    expect(getSingleDateRange('2026-07-12')).toEqual({
      start: '2026-07-12',
      end: '2026-07-12'
    });
  });

  it('builds a range only from two held dates and normalizes their order', () => {
    const pendingRange = getNextHeldCalendarRange(
      { start: '2026-07-01', end: '2026-07-31' },
      '2026-07-20'
    );

    expect(pendingRange).toEqual({ start: '2026-07-20', end: null });
    expect(getNextHeldCalendarRange(pendingRange, '2026-07-10')).toEqual({
      start: '2026-07-10',
      end: '2026-07-20'
    });
  });

  it('keeps an unfinished held range while navigating to another month', () => {
    expect(
      shouldResetCalendarRangeOnMonthNavigation(null, {
        start: '2026-07-30',
        end: null
      })
    ).toBe(false);
    expect(
      getNextHeldCalendarRange(
        { start: '2026-07-30', end: null },
        '2026-08-03'
      )
    ).toEqual({
      start: '2026-07-30',
      end: '2026-08-03'
    });
  });

  it('keeps the existing reset behavior for completed non-month selections', () => {
    expect(
      shouldResetCalendarRangeOnMonthNavigation('today', {
        start: '2026-07-20',
        end: '2026-07-20'
      })
    ).toBe(true);
    expect(
      shouldResetCalendarRangeOnMonthNavigation('month', {
        start: '2026-07-01',
        end: '2026-07-31'
      })
    ).toBe(false);
  });
});
