// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalDateString } from '../../../entities/shift';
import {
  getNextHeldCalendarRange,
  shouldResetCalendarRangeOnMonthNavigation,
  type CalendarDateRange
} from '../../lib/date-time';
import { MonthCalendar } from './MonthCalendar';

const renderCalendar = ({
  onDateSelect = vi.fn(),
  onDateHold = vi.fn()
}: {
  onDateSelect?: (date: LocalDateString) => void;
  onDateHold?: (date: LocalDateString) => void;
} = {}) => {
  render(
    <MonthCalendar
      year={2026}
      month={7}
      salaryLabel="0 ₴"
      shiftCount={0}
      hoursLabel="0:00"
      shifts={[]}
      selectedRange={{ start: '2026-07-01', end: '2026-07-31' }}
      onPreviousMonth={vi.fn()}
      onNextMonth={vi.fn()}
      onDateSelect={onDateSelect}
      onDateHold={onDateHold}
      activeRangePreset="month"
      onRangePresetSelect={vi.fn()}
    />
  );

  return { onDateSelect, onDateHold };
};

function CrossMonthRangeHarness() {
  const [visibleMonth, setVisibleMonth] = useState({ year: 2026, month: 7 });
  const [selectedRange, setSelectedRange] = useState<CalendarDateRange>({
    start: '2026-07-01',
    end: '2026-07-31'
  });

  const moveToNextMonth = () => {
    setVisibleMonth({ year: 2026, month: 8 });

    if (shouldResetCalendarRangeOnMonthNavigation(null, selectedRange)) {
      setSelectedRange({ start: '2026-08-01', end: '2026-08-31' });
    }
  };

  return (
    <MonthCalendar
      year={visibleMonth.year}
      month={visibleMonth.month}
      salaryLabel="0 ₴"
      shiftCount={0}
      hoursLabel="0:00"
      shifts={[]}
      selectedRange={selectedRange}
      onPreviousMonth={vi.fn()}
      onNextMonth={moveToNextMonth}
      onDateSelect={vi.fn()}
      onDateHold={(date) => setSelectedRange(getNextHeldCalendarRange(selectedRange, date))}
      activeRangePreset={null}
      onRangePresetSelect={vi.fn()}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('MonthCalendar range selection', () => {
  it('keeps a short tap as a single-date selection', () => {
    vi.useFakeTimers();
    const { onDateSelect, onDateHold } = renderCalendar();
    const dateButton = screen.getByRole('button', { name: 'Обрати 10 число' });

    fireEvent.pointerDown(dateButton);
    act(() => vi.advanceTimersByTime(200));
    fireEvent.pointerUp(dateButton);
    fireEvent.click(dateButton);

    expect(onDateSelect).toHaveBeenCalledWith('2026-07-10');
    expect(onDateHold).not.toHaveBeenCalled();
  });

  it('confirms a range boundary only after holding and suppresses the following click', () => {
    vi.useFakeTimers();
    const { onDateSelect, onDateHold } = renderCalendar();
    const dateButton = screen.getByRole('button', { name: 'Обрати 20 число' });

    fireEvent.pointerDown(dateButton);

    expect(dateButton.getAttribute('data-holding')).toBe('true');

    act(() => vi.advanceTimersByTime(550));
    fireEvent.pointerUp(dateButton);
    fireEvent.click(dateButton);

    expect(onDateHold).toHaveBeenCalledWith('2026-07-20');
    expect(onDateSelect).not.toHaveBeenCalled();
    expect(dateButton.getAttribute('data-holding')).toBe('false');
  });

  it('explains how to select both boundaries', () => {
    renderCalendar();

    expect(
      screen.getByText('Для діапазону затисніть початкову й кінцеву дату.')
    ).toBeTruthy();
  });

  it('finishes a held range after navigating to another month', () => {
    vi.useFakeTimers();
    render(<CrossMonthRangeHarness />);

    const startButton = screen.getByRole('button', { name: 'Обрати 30 число' });
    fireEvent.pointerDown(startButton);
    act(() => vi.advanceTimersByTime(550));
    fireEvent.pointerUp(startButton);
    fireEvent.click(startButton);

    expect(screen.getByText('Затисніть кінцеву дату діапазону.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Наступний місяць' }));

    const endButton = screen.getByRole('button', { name: 'Обрати 3 число' });
    fireEvent.pointerDown(endButton);
    act(() => vi.advanceTimersByTime(550));
    fireEvent.pointerUp(endButton);
    fireEvent.click(endButton);

    expect(screen.getByText('30.07.2026 - 03.08.2026')).toBeTruthy();
  });
});
