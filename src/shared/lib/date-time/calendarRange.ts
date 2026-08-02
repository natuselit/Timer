import type { LocalDateString } from '../../../entities/shift';

export type CalendarMonth = {
  year: number;
  month: number;
};

export type CalendarDateRange = {
  start: LocalDateString;
  end: LocalDateString | null;
};

export type CalendarRangePreset = 'today' | 'month' | 'all';

type CalendarPresetSelection = {
  calendarMonth: CalendarMonth;
  selectedRange: CalendarDateRange | null;
};

const toDateKey = (year: number, month: number, day: number): LocalDateString =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

export const getLocalDateKey = (date: Date): LocalDateString =>
  toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());

export const getCalendarMonthRange = ({
  year,
  month
}: CalendarMonth): CalendarDateRange => ({
  start: toDateKey(year, month, 1),
  end: toDateKey(year, month, new Date(year, month, 0).getDate())
});

export const getSingleDateRange = (date: LocalDateString): CalendarDateRange => ({
  start: date,
  end: date
});

export const getNextHeldCalendarRange = (
  current: CalendarDateRange | null,
  date: LocalDateString
): CalendarDateRange => {
  if (!current || current.end !== null) {
    return {
      start: date,
      end: null
    };
  }

  return date < current.start
    ? {
        start: date,
        end: current.start
      }
    : {
        start: current.start,
        end: date
      };
};

export const getCalendarPresetSelection = ({
  preset,
  calendarMonth,
  allTimeRange,
  now = new Date()
}: {
  preset: CalendarRangePreset;
  calendarMonth: CalendarMonth;
  allTimeRange: CalendarDateRange | null;
  now?: Date;
}): CalendarPresetSelection => {
  if (preset === 'month') {
    return {
      calendarMonth,
      selectedRange: getCalendarMonthRange(calendarMonth)
    };
  }

  if (preset === 'all') {
    return {
      calendarMonth,
      selectedRange: allTimeRange
    };
  }

  const today = getLocalDateKey(now);

  return {
    calendarMonth: {
      year: now.getFullYear(),
      month: now.getMonth() + 1
    },
    selectedRange: {
      start: today,
      end: today
    }
  };
};

export const countWeekdaysInDateRange = (
  start: LocalDateString,
  end: LocalDateString
): number => {
  const normalizedStart = start <= end ? start : end;
  const normalizedEnd = start <= end ? end : start;
  const cursor = new Date(`${normalizedStart}T12:00:00`);
  const lastDate = new Date(`${normalizedEnd}T12:00:00`);
  let workdays = 0;

  while (cursor <= lastDate) {
    const weekday = cursor.getDay();

    if (weekday >= 1 && weekday <= 5) {
      workdays += 1;
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  return workdays;
};
