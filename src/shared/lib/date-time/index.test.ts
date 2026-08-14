import { describe, expect, it } from 'vitest';
import {
  addMinutesToLocalTime,
  formatDurationClock,
  formatDurationMinutes,
  formatShortMinuteDuration,
  formatShortNumericDate
} from '.';

describe('date-time formatters', () => {
  it('formats durations as hours and minutes without wrapping after 24 hours', () => {
    expect(formatDurationMinutes(0)).toBe('0:00');
    expect(formatDurationMinutes(75)).toBe('1:15');
    expect(formatDurationMinutes(10_560)).toBe('176:00');
  });

  it('formats compact duration clock for calendar summaries', () => {
    expect(formatDurationClock(10_560)).toBe('176:00');
    expect(formatDurationClock(75)).toBe('1:15');
  });

  it('keeps a minute suffix only for short standalone durations', () => {
    expect(formatShortMinuteDuration(48)).toBe('48 хв');
    expect(formatShortMinuteDuration(65)).toBe('1:05');
  });

  it('formats short numeric dates without month text', () => {
    expect(formatShortNumericDate('2026-06-03')).toBe('03.06');
  });

  it('adds minutes to a local time and reports crossing midnight', () => {
    expect(addMinutesToLocalTime('14:30', 240)).toEqual({
      time: '18:30',
      dayOffset: 0
    });
    expect(addMinutesToLocalTime('14:30', 720)).toEqual({
      time: '02:30',
      dayOffset: 1
    });
    expect(addMinutesToLocalTime('06:00', 480)).toEqual({
      time: '14:00',
      dayOffset: 0
    });
  });
});
