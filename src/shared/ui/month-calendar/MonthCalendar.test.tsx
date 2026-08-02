// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocalDateString } from '../../../entities/shift';
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
});
