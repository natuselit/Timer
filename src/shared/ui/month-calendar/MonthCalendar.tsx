import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { LocalDateString } from '../../../entities/shift';
import './MonthCalendar.css';

export type CalendarShiftMarker = {
  id: string;
  date: LocalDateString;
};

export type CalendarDateRange = {
  start: LocalDateString;
  end: LocalDateString | null;
};

type MonthCalendarProps = {
  year: number;
  month: number;
  salaryLabel: string;
  salaryTitle?: string;
  shiftCount: string | number;
  shiftCountTitle?: string;
  hoursLabel: string;
  hoursTitle?: string;
  shifts: CalendarShiftMarker[];
  selectedRange: CalendarDateRange | null;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onDateSelect: (date: LocalDateString) => void;
  onRangeReset?: () => void;
  titleId?: string;
  hideSummary?: boolean;
  isCompact?: boolean;
  selectionMode?: 'range' | 'single';
  hideNavigation?: boolean;
};

const weekdayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

const toDateKey = (year: number, month: number, day: number): LocalDateString =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const formatFullRangeDate = (date: LocalDateString): string => {
  const [year, month, day] = date.split('-');

  return `${day}.${month}.${year}`;
};

const toTodayKey = (): LocalDateString => {
  const today = new Date();

  return toDateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());
};

type CalendarCell = {
  key: string;
  day: number;
  dateKey: LocalDateString;
  isCurrentMonth: boolean;
};

const getCalendarRange = (
  year: number,
  month: number,
  selectedRange: CalendarDateRange | null
): {
  title: string;
  ariaLabel: string;
} => {
  if (!selectedRange) {
    const start = toDateKey(year, month, 1);
    const end = toDateKey(year, month, new Date(year, month, 0).getDate());

    return {
      title: `${formatFullRangeDate(start)} - ${formatFullRangeDate(end)}`,
      ariaLabel: `Період ${formatFullRangeDate(start)} - ${formatFullRangeDate(end)}`
    };
  }

  const end = selectedRange.end ?? selectedRange.start;

  if (selectedRange.start === end) {
    return {
      title: formatFullRangeDate(selectedRange.start),
      ariaLabel: `Обрана дата ${formatFullRangeDate(selectedRange.start)}`
    };
  }

  return {
    title: `${formatFullRangeDate(selectedRange.start)} - ${formatFullRangeDate(end)}`,
    ariaLabel: `Обраний період ${formatFullRangeDate(selectedRange.start)} - ${formatFullRangeDate(end)}`
  };
};

export function MonthCalendar({
  year,
  month,
  salaryLabel,
  salaryTitle = 'Зарплата',
  shiftCount,
  shiftCountTitle = 'Змін',
  hoursLabel,
  hoursTitle = 'Години',
  shifts,
  selectedRange,
  onPreviousMonth,
  onNextMonth,
  onDateSelect,
  onRangeReset,
  titleId = 'month-calendar-title',
  hideSummary = false,
  isCompact = false,
  selectionMode = 'range',
  hideNavigation = false
}: MonthCalendarProps) {
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysInPreviousMonth = new Date(year, month - 1, 0).getDate();
  const leadingEmptyDays = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((leadingEmptyDays + daysInMonth) / 7) * 7;
  const trailingDays = totalCells - leadingEmptyDays - daysInMonth;
  const markedDates = new Set(shifts.map((shift) => shift.date));
  const todayKey = toTodayKey();
  const rangeStart = selectedRange?.start ?? null;
  const rangeEnd = selectedRange?.end ?? selectedRange?.start ?? null;
  const previousMonth = new Date(year, month - 2, 1);
  const nextMonth = new Date(year, month, 1);
  const calendarRange = getCalendarRange(year, month, selectedRange);
  const canResetRange = Boolean(
    selectedRange && selectionMode === 'range' && onRangeReset
  );
  const cells: CalendarCell[] = [
    ...Array.from({ length: leadingEmptyDays }, (_, index) => {
      const day = daysInPreviousMonth - leadingEmptyDays + index + 1;

      return {
        key: `previous-${day}`,
        day,
        dateKey: toDateKey(previousMonth.getFullYear(), previousMonth.getMonth() + 1, day),
        isCurrentMonth: false
      };
    }),
    ...Array.from({ length: daysInMonth }, (_, index) => ({
      key: `current-${index + 1}`,
      day: index + 1,
      dateKey: toDateKey(year, month, index + 1),
      isCurrentMonth: true
    })),
    ...Array.from({ length: trailingDays }, (_, index) => ({
      key: `next-${index + 1}`,
      day: index + 1,
      dateKey: toDateKey(nextMonth.getFullYear(), nextMonth.getMonth() + 1, index + 1),
      isCurrentMonth: false
    }))
  ];

  return (
    <section
      className="month-calendar"
      data-compact={isCompact ? 'true' : 'false'}
      data-selection-mode={selectionMode}
      aria-labelledby={titleId}
    >
      <header className="month-calendar__header">
        {hideNavigation ? (
          <span className="month-calendar__nav-placeholder" aria-hidden="true" />
        ) : (
          <button
            className="month-calendar__nav-button"
            type="button"
            aria-label="Попередній місяць"
            onClick={onPreviousMonth}
          >
            <ChevronLeft size={20} />
          </button>
        )}
        <div className="month-calendar__title-block">
          <h2
            className="month-calendar__title"
            id={titleId}
            aria-label={calendarRange.ariaLabel}
            aria-live="polite"
          >
            {calendarRange.title}
          </h2>
        </div>
        {hideNavigation ? (
          <span className="month-calendar__nav-placeholder" aria-hidden="true" />
        ) : (
          <button
            className="month-calendar__nav-button"
            type="button"
            aria-label="Наступний місяць"
            onClick={onNextMonth}
          >
            <ChevronRight size={20} />
          </button>
        )}
      </header>

      {canResetRange ? (
        <button
          className="month-calendar__reset-button"
          type="button"
          aria-label="Скинути обраний діапазон"
          onClick={onRangeReset}
        >
          <X aria-hidden="true" size={16} />
          <span>Скинути діапазон</span>
        </button>
      ) : null}

      {!hideSummary ? (
        <div className="month-calendar__summary" aria-label="Підсумок місяця">
          <article>
            <span>{salaryTitle}</span>
            <strong>{salaryLabel}</strong>
          </article>
          <article>
            <span>{shiftCountTitle}</span>
            <strong>{shiftCount}</strong>
          </article>
          <article>
            <span>{hoursTitle}</span>
            <strong>{hoursLabel}</strong>
          </article>
        </div>
      ) : null}

      <div className="month-calendar__weekdays" aria-hidden="true">
        {weekdayLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>

      <div className="month-calendar__grid">
        {cells.map((cell) => {
          const hasShift = markedDates.has(cell.dateKey);
          const isRangeStart = rangeStart === cell.dateKey;
          const isRangeEnd = rangeEnd === cell.dateKey;
          const isInRange = Boolean(
            rangeStart &&
              rangeEnd &&
              cell.dateKey >= rangeStart &&
              cell.dateKey <= rangeEnd
          );

          return (
            <button
              className="month-calendar__day"
              data-current-month={cell.isCurrentMonth ? 'true' : 'false'}
              data-has-shift={hasShift ? 'true' : 'false'}
              data-in-range={isInRange ? 'true' : 'false'}
              data-range-start={isRangeStart ? 'true' : 'false'}
              data-range-end={isRangeEnd ? 'true' : 'false'}
              data-today={cell.dateKey === todayKey ? 'true' : 'false'}
              type="button"
              aria-label={
                cell.isCurrentMonth
                  ? `Обрати ${cell.day} число`
                  : `Перейти до ${cell.day} числа іншого місяця`
              }
              aria-pressed={isInRange}
              key={cell.key}
              onClick={() => onDateSelect(cell.dateKey)}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
    </section>
  );
}
