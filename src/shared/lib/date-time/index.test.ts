import { describe, expect, it } from 'vitest';
import { formatDurationClock, formatDurationMinutes, formatShortNumericDate } from '.';

describe('date-time formatters', () => {
  it('formats full Ukrainian duration text', () => {
    expect(formatDurationMinutes(10_560)).toBe('176 год 00 хв');
  });

  it('formats compact duration clock for calendar summaries', () => {
    expect(formatDurationClock(10_560)).toBe('176:00');
    expect(formatDurationClock(75)).toBe('1:15');
  });

  it('formats short numeric dates without month text', () => {
    expect(formatShortNumericDate('2026-06-03')).toBe('03.06');
  });
});
