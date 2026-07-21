import { useCallback, useEffect, useMemo, useState } from 'react';
import { Edit3, Plus, Tickets, Trash2, X } from 'lucide-react';
import type {
  CoefficientMode,
  ISODateTimeString,
  LocalDateString,
  LocalTimeString,
  Shift,
  ShiftType,
  WorkTicket
} from '../../../entities/shift';
import {
  COEFFICIENT_MODES,
  getPlannedShiftWindow,
  validateAndSortWorkTickets
} from '../../../entities/shift';
import {
  calculateHourlyRateFromMonthlySalary,
  calculateEffectiveHourlyRate,
  calculateGradeHourlyRateFromMonthlySalary,
  calculateMonthlySalaryFromHourlyRate,
  createGradeSnapshot,
  type GradePercentSet,
  type Settings
} from '../../../entities/settings';
import { MonthCalendar, type CalendarDateRange } from '../../../shared/ui/month-calendar';
import {
  createManualShift,
  deleteShift,
  getShiftsBetween,
  localDb,
  ShiftConstraintError,
  ShiftRepository,
  updateShift
} from '../../../shared/lib/local-db';
import {
  combineLocalDateAndTime,
  formatDate,
  formatDurationClock,
  formatDurationMinutes,
  formatTimeInputDraft,
  formatTime,
  getDurationMinutes,
  getTimeInputValue,
  normalizeTimeInput,
  toLocalIsoString
} from '../../../shared/lib/date-time';
import { INCOGNITO_FINANCIAL_MASK, formatHourlyRate, formatMoney } from '../../../shared/lib/format';
import { calculateSalaryBreakdown } from '../../../entities/shift';
import { calculateMonthShiftSummary } from '../../../shared/lib/shifts/monthSummary';
import './HistoryPage.css';

type HistoryPageProps = {
  settings: Settings;
  calendarMonth: CalendarMonth;
  selectedRange: CalendarDateRange | null;
  onCalendarMonthChange: (month: CalendarMonth) => void;
  onSelectedRangeChange: (range: CalendarDateRange | null) => void;
  onDataChange?: () => void;
};

type CalendarMonth = {
  year: number;
  month: number;
};

type ShiftFormValues = {
  date: LocalDateString;
  type: ShiftType;
  startTime: LocalTimeString;
  endTime: LocalTimeString;
  hourlyRateSnapshot: string;
  hourlyRateSnapshotValue: number;
  hourlyRateSnapshotEdited: boolean;
  coefficientMode: CoefficientMode;
  workTickets: TicketFormValue[];
};

type TicketFormValue = Omit<
  WorkTicket,
  'normPerEightHours' | 'startedAt' | 'endedAt'
> & {
  normPerEightHours: string;
  startedAt: string;
  endedAt: string;
  originalNormPerEightHours: number;
  originalStartedAt: ISODateTimeString;
  originalEndedAt: ISODateTimeString | null;
};

type EditorState =
  | {
      mode: 'create';
      shift: null;
      values: ShiftFormValues;
    }
  | {
      mode: 'edit';
      shift: Shift;
      values: ShiftFormValues;
    };

const shiftRepository = new ShiftRepository(localDb);

const shiftTypeBadgeLabels: Record<ShiftType, string> = {
  first: '1 зміна',
  second: '2 зміна'
};

const coefficientLabels: Record<CoefficientMode, string> = {
  auto: 'Авто',
  x1: 'x1',
  'x1.5': 'x1.5',
  x2: 'x2'
};

const getMonthlySalaryInputValue = (value: number): string => String(Math.floor(value));

const formatCoefficientLabel = (coefficient: number): string => `x${coefficient}`;

const normalizeTicketNormDraft = (value: string): string => {
  const digits = value.replace(/\D/g, '');

  return digits === '' ? '' : String(Math.min(Number(digits), 999));
};

const toTicketFormValues = (workTickets: WorkTicket[]): TicketFormValue[] =>
  workTickets.map((ticket) => ({
    id: ticket.id,
    normPerEightHours: String(ticket.normPerEightHours),
    startedAt: getTimeInputValue(ticket.startedAt),
    endedAt: ticket.endedAt ? getTimeInputValue(ticket.endedAt) : '',
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    originalNormPerEightHours: ticket.normPerEightHours,
    originalStartedAt: ticket.startedAt,
    originalEndedAt: ticket.endedAt
  }));

const parseTicketNormValue = (value: string): number => {
  const normPerEightHours = Number(value);

  if (!Number.isFinite(normPerEightHours) || normPerEightHours <= 0) {
    throw new Error('Норма має бути більшою за 0.');
  }

  if (normPerEightHours > 999) {
    throw new Error('Норма має бути не більшою за 999.');
  }

  return normPerEightHours;
};

const createWorkTicketsFromFormValues = (
  tickets: TicketFormValue[],
  date: LocalDateString,
  shiftStartTime: ISODateTimeString,
  shiftEndTime: ISODateTimeString | null,
  updatedAt: ISODateTimeString
): WorkTicket[] => {
  const workTickets = tickets.map((ticket) => {
    const normPerEightHours = parseTicketNormValue(ticket.normPerEightHours);

    if (!ticket.startedAt.trim()) {
      throw new Error('Вкажіть час взяття тікета.');
    }

    const startedAt = combineLocalDateAndTime(date, normalizeTimeInput(ticket.startedAt));
    const endedAt = ticket.endedAt.trim()
      ? combineLocalDateAndTime(date, normalizeTimeInput(ticket.endedAt))
      : null;

    if (ticket.originalEndedAt !== null && endedAt === null) {
      throw new Error('Завершений тікет не можна знову зробити активним.');
    }

    const didChange =
      normPerEightHours !== ticket.originalNormPerEightHours ||
      startedAt !== ticket.originalStartedAt ||
      endedAt !== ticket.originalEndedAt;

    return {
      id: ticket.id,
      normPerEightHours,
      startedAt,
      endedAt,
      createdAt: ticket.createdAt,
      updatedAt: didChange ? updatedAt : ticket.updatedAt
    };
  });

  return validateAndSortWorkTickets(workTickets, {
    shiftStartTime,
    effectiveShiftEndTime: shiftEndTime ?? updatedAt,
    allowOpenTicket: shiftEndTime === null
  });
};

const getCoefficientEarnings = (
  lines: ReturnType<typeof calculateSalaryBreakdown>['lines']
): Array<{
  coefficient: number;
  amount: number;
}> => {
  const earnings = new Map<
    number,
    {
      coefficient: number;
      amount: number;
    }
  >();

  lines.forEach((line) => {
    if (line.minutes <= 0) {
      return;
    }

    const current = earnings.get(line.coefficient);

    earnings.set(line.coefficient, {
      coefficient: line.coefficient,
      amount: (current?.amount ?? 0) + line.amount
    });
  });

  const result = [...earnings.values()].sort((left, right) => left.coefficient - right.coefficient);

  return result.length > 0 ? result : [{ coefficient: 1, amount: 0 }];
};

const createDefaultFormValues = (
  settings: Settings,
  selectedDate?: LocalDateString
): ShiftFormValues => {
  const now = new Date();
  const date =
    selectedDate ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;

  const hourlyRateSnapshot = calculateHourlyRateFromMonthlySalary(settings.monthlySalary, date);

  return {
    date,
    type: 'first',
    startTime: '06:30',
    endTime: '14:30',
    hourlyRateSnapshot: getMonthlySalaryInputValue(settings.monthlySalary),
    hourlyRateSnapshotValue: hourlyRateSnapshot,
    hourlyRateSnapshotEdited: false,
    coefficientMode: settings.coefficientMode,
    workTickets: []
  };
};

const createEditFormValues = (shift: Shift): ShiftFormValues => ({
  date: shift.date,
  type: shift.type,
  startTime: getTimeInputValue(shift.startTime),
  endTime: shift.endTime ? getTimeInputValue(shift.endTime) : shift.plannedEndTime,
  hourlyRateSnapshot: getMonthlySalaryInputValue(
    calculateMonthlySalaryFromHourlyRate(shift.baseHourlyRateSnapshot, shift.date)
  ),
  hourlyRateSnapshotValue: shift.baseHourlyRateSnapshot,
  hourlyRateSnapshotEdited: false,
  coefficientMode: shift.coefficientMode,
  workTickets: toTicketFormValues(shift.workTickets)
});

const getEditorErrorMessage = (error: unknown): string => {
  if (error instanceof ShiftConstraintError && error.message.includes('Shift already exists')) {
    return 'За цей день уже є зміна.';
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return 'Не вдалося зберегти зміну.';
};

const isDateInRange = (date: LocalDateString, range: CalendarDateRange | null): boolean => {
  if (!range) {
    return true;
  }

  const end = range.end ?? range.start;

  return date >= range.start && date <= end;
};

const getMonthRange = (
  year: number,
  month: number
): {
  start: LocalDateString;
  end: LocalDateString;
} => {
  const lastDay = new Date(year, month, 0).getDate();

  return {
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  };
};

const getMonthFromDate = (date: LocalDateString): CalendarMonth => {
  const [year, month] = date.split('-').map(Number);

  return { year, month };
};

const getShiftTypeLabel = (type: ShiftType): string =>
  type === 'first' ? '1 зміна' : '2 зміна';

const getSelectedRangeBounds = (
  range: CalendarDateRange
): {
  start: LocalDateString;
  end: LocalDateString;
} => ({
  start: range.start,
  end: range.end ?? range.start
});

const getNextSelectedRange = (
  current: CalendarDateRange | null,
  date: LocalDateString
): CalendarDateRange => {
  if (!current || current.end) {
    return {
      start: date,
      end: null
    };
  }

  if (date < current.start) {
    return {
      start: date,
      end: current.start
    };
  }

  return {
    start: current.start,
    end: date
  };
};

export function HistoryPage({
  settings,
  calendarMonth,
  selectedRange,
  onCalendarMonthChange,
  onSelectedRangeChange,
  onDataChange
}: HistoryPageProps) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorCalendarMonth, setEditorCalendarMonth] = useState<CalendarMonth | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const now = useMemo(() => toLocalIsoString(new Date()), []);
  const loadedDateRange = useMemo(
    () =>
      selectedRange
        ? getSelectedRangeBounds(selectedRange)
        : getMonthRange(calendarMonth.year, calendarMonth.month),
    [selectedRange, calendarMonth]
  );

  const loadShifts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      setShifts(await getShiftsBetween(shiftRepository, loadedDateRange.start, loadedDateRange.end));
    } catch {
      setError('Не вдалося завантажити історію.');
    } finally {
      setIsLoading(false);
    }
  }, [loadedDateRange]);

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isSaving) {
        setEditor(null);
      }
    };

    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [editor, isSaving]);

  const visibleShifts = useMemo(
    () => shifts.filter((shift) => isDateInRange(shift.date, selectedRange)),
    [selectedRange, shifts]
  );
  const monthSummary = useMemo(
    () => calculateMonthShiftSummary(visibleShifts, now),
    [visibleShifts, now]
  );

  const selectDate = (date: LocalDateString) => {
    const [year, month] = date.split('-').map(Number);
    const isOutsideVisibleMonth = year !== calendarMonth.year || month !== calendarMonth.month;

    if (isOutsideVisibleMonth) {
      onCalendarMonthChange({ year, month });
    }

    onSelectedRangeChange(getNextSelectedRange(selectedRange, date));
  };

  const openCreateEditor = () => {
    const values = createDefaultFormValues(settings, selectedRange?.start);

    setError(null);
    setEditorCalendarMonth(getMonthFromDate(values.date));
    setEditor({
      mode: 'create',
      shift: null,
      values
    });
  };

  const openEditEditor = (shift: Shift) => {
    const values = createEditFormValues(shift);

    setError(null);
    setEditorCalendarMonth(getMonthFromDate(values.date));
    setEditor({
      mode: 'edit',
      shift,
      values
    });
  };

  const changeEditorValue = <Key extends keyof ShiftFormValues>(
    key: Key,
    value: ShiftFormValues[Key]
  ) => {
    setEditor((current) =>
      current
        ? {
            ...current,
            values: {
              ...current.values,
              [key]: value
            }
          }
        : current
    );
  };

  const moveMonth = (direction: -1 | 1) => {
    onSelectedRangeChange(null);
    const next = new Date(calendarMonth.year, calendarMonth.month - 1 + direction, 1);

    onCalendarMonthChange({
      year: next.getFullYear(),
      month: next.getMonth() + 1
    });
  };

  const moveEditorMonth = (direction: -1 | 1) => {
    const currentMonth = editorCalendarMonth ?? (editor ? getMonthFromDate(editor.values.date) : null);

    if (!currentMonth) {
      return;
    }

    const next = new Date(currentMonth.year, currentMonth.month - 1 + direction, 1);

    setEditorCalendarMonth({
      year: next.getFullYear(),
      month: next.getMonth() + 1
    });
  };

  const selectEditorDate = (date: LocalDateString) => {
    setEditorCalendarMonth(getMonthFromDate(date));
    setEditor((current) => {
      if (!current) {
        return current;
      }

      const shouldRecalculateRate =
        current.mode === 'create' && !settings.incognitoEnabled && !current.values.hourlyRateSnapshotEdited;
      const hourlyRateSnapshotValue = shouldRecalculateRate
        ? calculateHourlyRateFromMonthlySalary(settings.monthlySalary, date)
        : current.values.hourlyRateSnapshotValue;

      return {
        ...current,
        values: {
          ...current.values,
          date,
          hourlyRateSnapshot: shouldRecalculateRate
            ? getMonthlySalaryInputValue(settings.monthlySalary)
            : current.values.hourlyRateSnapshot,
          hourlyRateSnapshotValue
        }
      };
    });
  };

  const changeEditorTimeValue = (key: 'startTime' | 'endTime', value: string) => {
    changeEditorValue(key, formatTimeInputDraft(value));
  };

  const completeEditorTimeValue = (key: 'startTime' | 'endTime', value: string) => {
    changeEditorValue(key, normalizeTimeInput(value));
  };

  const changeEditorRateValue = (value: string) => {
    setEditor((current) =>
      current
        ? {
            ...current,
            values: {
              ...current.values,
              hourlyRateSnapshot: value,
              hourlyRateSnapshotEdited: true
            }
          }
        : current
    );
  };

  const changeEditorTicketNorm = (ticketId: string, value: string) => {
    setEditor((current) =>
      current?.mode === 'edit'
        ? {
            ...current,
            values: {
              ...current.values,
              workTickets: current.values.workTickets.map((ticket) =>
                ticket.id === ticketId
                  ? {
                      ...ticket,
                      normPerEightHours: normalizeTicketNormDraft(value)
                    }
                  : ticket
              )
            }
          }
        : current
    );
  };

  const changeEditorTicketTime = (
    ticketId: string,
    key: 'startedAt' | 'endedAt',
    value: string
  ) => {
    setEditor((current) =>
      current?.mode === 'edit'
        ? {
            ...current,
            values: {
              ...current.values,
              workTickets: current.values.workTickets.map((ticket) =>
                ticket.id === ticketId
                  ? {
                      ...ticket,
                      [key]: formatTimeInputDraft(value)
                    }
                  : ticket
              )
            }
          }
        : current
    );
  };

  const completeEditorTicketTime = (ticketId: string, key: 'startedAt' | 'endedAt') => {
    setEditor((current) =>
      current?.mode === 'edit'
        ? {
            ...current,
            values: {
              ...current.values,
              workTickets: current.values.workTickets.map((ticket) =>
                ticket.id === ticketId
                  ? {
                      ...ticket,
                      [key]: ticket[key].trim() ? normalizeTimeInput(ticket[key]) : ''
                    }
                  : ticket
              )
            }
          }
        : current
    );
  };

  const removeEditorTicket = (ticketId: string) => {
    if (!window.confirm('Прибрати цей тікет зі зміни? Зміни застосуються після збереження.')) {
      return;
    }

    setEditor((current) =>
      current?.mode === 'edit'
        ? {
            ...current,
            values: {
              ...current.values,
              workTickets: current.values.workTickets.filter((ticket) => ticket.id !== ticketId)
            }
          }
        : current
    );
  };

  const saveEditor = async () => {
    if (!editor) {
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const isEditingActiveShift = editor.mode === 'edit' && editor.shift.endTime === null;
      const normalizedValues = {
        ...editor.values,
        startTime: normalizeTimeInput(editor.values.startTime),
        endTime: isEditingActiveShift ? editor.values.endTime : normalizeTimeInput(editor.values.endTime),
        workTickets: editor.values.workTickets.map((ticket) => ({
          ...ticket,
          normPerEightHours: normalizeTicketNormDraft(ticket.normPerEightHours),
          startedAt: ticket.startedAt.trim() ? normalizeTimeInput(ticket.startedAt) : '',
          endedAt: ticket.endedAt.trim() ? normalizeTimeInput(ticket.endedAt) : ''
        }))
      };
      const startTime = combineLocalDateAndTime(normalizedValues.date, normalizedValues.startTime);
      const endTime = isEditingActiveShift
        ? null
        : combineLocalDateAndTime(normalizedValues.date, normalizedValues.endTime);
      const monthlySalary = Number(normalizedValues.hourlyRateSnapshot);
      const savedAt = toLocalIsoString(new Date());

      setEditor((current) =>
        current
          ? {
              ...current,
              values: normalizedValues
            }
          : current
      );

      if (endTime !== null && new Date(endTime).getTime() <= new Date(startTime).getTime()) {
        throw new Error('Вихід має бути пізніше приходу.');
      }

      if (
        !settings.incognitoEnabled &&
        normalizedValues.hourlyRateSnapshotEdited &&
        (!Number.isFinite(monthlySalary) || monthlySalary < 0)
      ) {
        throw new Error('Ставка за місяць не може бути відʼємною.');
      }

      const newShiftHourlyRates = calculateGradeHourlyRateFromMonthlySalary(
        settings.monthlySalary,
        normalizedValues.date,
        settings
      );
      const editedBaseHourlyRateSnapshot = normalizedValues.hourlyRateSnapshotEdited
        ? calculateHourlyRateFromMonthlySalary(monthlySalary, normalizedValues.date)
        : normalizedValues.hourlyRateSnapshotValue;
      const editedGradeSnapshot = createGradeSnapshot(settings);
      const editedHourlyRateSnapshot = calculateEffectiveHourlyRate(
        editedBaseHourlyRateSnapshot,
        editedGradeSnapshot.cumulativeSalaryBonusPercent
      );
      const workTickets = createWorkTicketsFromFormValues(
        normalizedValues.workTickets,
        normalizedValues.date,
        startTime,
        endTime,
        savedAt
      );

      if (editor.mode === 'create') {
        await createManualShift(shiftRepository, {
          date: normalizedValues.date,
          type: normalizedValues.type,
          startTime,
          endTime: endTime ?? startTime,
          baseHourlyRateSnapshot: settings.incognitoEnabled
            ? newShiftHourlyRates.baseHourlyRate
            : normalizedValues.hourlyRateSnapshotEdited
              ? editedBaseHourlyRateSnapshot
              : newShiftHourlyRates.baseHourlyRate,
          hourlyRateSnapshot: settings.incognitoEnabled
            ? newShiftHourlyRates.effectiveHourlyRate
            : normalizedValues.hourlyRateSnapshotEdited
              ? editedHourlyRateSnapshot
              : newShiftHourlyRates.effectiveHourlyRate,
          gradeSnapshot: createGradeSnapshot(settings),
          coefficientMode: normalizedValues.coefficientMode,
          now: savedAt
        });
      } else {
        const plannedWindow = getPlannedShiftWindow(
          normalizedValues.date,
          normalizedValues.type,
          startTime
        );

        await updateShift(shiftRepository, {
          ...editor.shift,
          date: normalizedValues.date,
          type: normalizedValues.type,
          detectionMode: 'manual',
          plannedStartTime: plannedWindow.startTime,
          plannedEndTime: plannedWindow.endTime,
          startTime,
          endTime,
          baseHourlyRateSnapshot:
            settings.incognitoEnabled || !normalizedValues.hourlyRateSnapshotEdited
              ? editor.shift.baseHourlyRateSnapshot
              : editedBaseHourlyRateSnapshot,
          hourlyRateSnapshot:
            settings.incognitoEnabled || !normalizedValues.hourlyRateSnapshotEdited
              ? editor.shift.hourlyRateSnapshot
              : editedHourlyRateSnapshot,
          gradeSnapshot:
            settings.incognitoEnabled || !normalizedValues.hourlyRateSnapshotEdited
              ? editor.shift.gradeSnapshot
              : editedGradeSnapshot,
          workTickets,
          coefficientMode: normalizedValues.coefficientMode,
          isAutoClosed: false,
          updatedAt: savedAt
        });
      }

      setEditor(null);
      await loadShifts();
      onDataChange?.();
    } catch (saveError) {
      setError(getEditorErrorMessage(saveError));
    } finally {
      setIsSaving(false);
    }
  };

  const removeShift = async (shift: Shift) => {
    if (!window.confirm(`Видалити зміну за ${formatDate(shift.date)}?`)) {
      return;
    }

    setError(null);

    try {
      await deleteShift(shiftRepository, shift.id);
      await loadShifts();
      onDataChange?.();
    } catch {
      setError('Не вдалося видалити зміну.');
    }
  };

  return (
    <div className="history-page">
      <MonthCalendar
        year={calendarMonth.year}
        month={calendarMonth.month}
        salaryLabel={formatMoney(monthSummary.totalAmount, settings.incognitoEnabled)}
        shiftCount={monthSummary.shiftCount}
        hoursLabel={formatDurationClock(monthSummary.totalMinutes)}
        shifts={shifts}
        selectedRange={selectedRange}
        onPreviousMonth={() => moveMonth(-1)}
        onNextMonth={() => moveMonth(1)}
        onDateSelect={selectDate}
        onRangeReset={() => onSelectedRangeChange(null)}
      />

      <section className="history-page__panel" aria-labelledby="history-list-title">
        <header className="history-page__panel-header">
          <div>
            <p className="history-page__eyebrow">Зміни</p>
            <h2 id="history-list-title">Список змін</h2>
          </div>
          <button className="history-page__primary-button" type="button" onClick={openCreateEditor}>
            <Plus size={18} />
            <span>Додати</span>
          </button>
        </header>

        {error ? (
          <p className="history-page__error" role="alert">
            {error}
          </p>
        ) : null}

        {isLoading ? (
          <p className="history-page__empty">Завантаження історії...</p>
        ) : visibleShifts.length === 0 ? (
          <p className="history-page__empty">
            {selectedRange ? 'У вибраному діапазоні змін немає.' : 'За цей місяць змін ще немає.'}
          </p>
        ) : (
          <div className="history-page__list">
            {visibleShifts.map((shift) => {
              const effectiveEndTime = shift.endTime ?? now;
              const salary = calculateSalaryBreakdown({
                ...shift,
                endTime: effectiveEndTime
              });
              const coefficientEarnings = getCoefficientEarnings(salary.lines);
              const shiftDateLabel = formatDate(shift.date);

              return (
                <article className="history-page__shift" key={shift.id}>
                  <div className="history-page__shift-header">
                    <div className="history-page__shift-meta">
                      <time dateTime={shift.date}>{shiftDateLabel}</time>
                      <div className="history-page__badges" aria-label="Тип і стан зміни">
                        <span className="history-page__badge history-page__badge--shift">
                          {shiftTypeBadgeLabels[shift.type]}
                        </span>
                        <span
                          className={
                            shift.endTime
                              ? 'history-page__badge history-page__badge--completed'
                              : 'history-page__badge history-page__badge--active'
                          }
                        >
                          {shift.endTime ? 'Завершена' : 'Активна'}
                        </span>
                      </div>
                    </div>
                    <div className="history-page__actions" aria-label="Дії зі зміною">
                      <button
                        className="history-page__action-button"
                        type="button"
                        aria-label={`Редагувати зміну за ${shiftDateLabel}`}
                        title="Редагувати"
                        onClick={() => openEditEditor(shift)}
                      >
                        <Edit3 size={16} />
                      </button>
                      <button
                        className="history-page__action-button history-page__action-button--danger"
                        type="button"
                        aria-label={`Видалити зміну за ${shiftDateLabel}`}
                        title="Видалити"
                        onClick={() => void removeShift(shift)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <dl className="history-page__details">
                    <div className="history-page__detail history-page__detail--money">
                      <dt>Зароблено</dt>
                      <dd>{formatMoney(salary.totalAmount, settings.incognitoEnabled)}</dd>
                    </div>
                    <div className="history-page__detail">
                      <dt>Час зміни</dt>
                      <dd>
                        {formatTime(shift.startTime)}
                        <span aria-hidden="true">-</span>
                        {shift.endTime ? formatTime(shift.endTime) : 'триває'}
                      </dd>
                    </div>
                    <div className="history-page__detail">
                      <dt>Тривалість</dt>
                      <dd>{formatDurationMinutes(getDurationMinutes(shift.startTime, effectiveEndTime))}</dd>
                    </div>
                    <div className="history-page__detail history-page__detail--muted">
                      <dt>Ставка</dt>
                      <dd>{formatHourlyRate(shift.hourlyRateSnapshot, settings.incognitoEnabled)}</dd>
                    </div>
                    <div className="history-page__detail history-page__detail--muted history-page__detail--tickets">
                      <dt>
                        <Tickets aria-hidden="true" size={16} />
                        <span>Тікети</span>
                      </dt>
                      <dd className="history-page__ticket-summary">
                        {shift.workTickets.length > 0 ? (
                          <>
                            <strong>{shift.workTickets.length}</strong>
                            <span>
                              Ост. норма{' '}
                              {shift.workTickets[shift.workTickets.length - 1].normPerEightHours}
                            </span>
                          </>
                        ) : (
                          <span>Немає</span>
                        )}
                      </dd>
                    </div>
                  </dl>

                  <ul className="history-page__coefficients" aria-label="Зароблено по коефіцієнтах">
                    {coefficientEarnings.map((earning) => (
                      <li data-coefficient={earning.coefficient} key={earning.coefficient}>
                        <span>{formatCoefficientLabel(earning.coefficient)}</span>
                        <strong>{formatMoney(earning.amount, settings.incognitoEnabled)}</strong>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {editor ? (
        <div className="history-page__editor-overlay">
          <section
            className="history-page__editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-editor-title"
          >
            <header className="history-page__panel-header history-page__editor-header">
              <h2 id="history-editor-title">
                {editor.mode === 'create' ? 'Нова зміна' : 'Редагування зміни'}
              </h2>
              <button
                className="history-page__icon-button"
                type="button"
                aria-label="Закрити редактор"
                disabled={isSaving}
                onClick={() => setEditor(null)}
              >
                <X size={20} />
              </button>
            </header>

            <div className="history-page__form">
              <section className="history-page__editor-section history-page__editor-section--date">
                <div className="history-page__form-field history-page__form-field--full history-page__form-field--date">
                  <span>Дата</span>
                  <MonthCalendar
                    year={(editorCalendarMonth ?? getMonthFromDate(editor.values.date)).year}
                    month={(editorCalendarMonth ?? getMonthFromDate(editor.values.date)).month}
                    salaryLabel=""
                    shiftCount={0}
                    hoursLabel=""
                    shifts={shifts}
                    selectedRange={{ start: editor.values.date, end: null }}
                    onPreviousMonth={() => moveEditorMonth(-1)}
                    onNextMonth={() => moveEditorMonth(1)}
                    onDateSelect={selectEditorDate}
                    titleId="history-editor-calendar-title"
                    hideSummary
                    isCompact
                    selectionMode="single"
                  />
                </div>
              </section>

              <section className="history-page__editor-section">
                <div className="history-page__form-field history-page__form-field--full history-page__shift-type-field">
                  <span>Тип зміни</span>
                  <div className="history-page__segmented" role="group" aria-label="Тип зміни">
                    {(['first', 'second'] as ShiftType[]).map((type) => (
                      <button
                        type="button"
                        aria-pressed={editor.values.type === type}
                        key={type}
                        onClick={() => changeEditorValue('type', type)}
                      >
                        {getShiftTypeLabel(type)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="history-page__editor-time-grid">
                  <label className="history-page__time-field">
                    <span>Прихід</span>
                    <input
                      className="history-page__time-input"
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={5}
                      placeholder="00:00"
                      value={editor.values.startTime}
                      onBlur={(event) => completeEditorTimeValue('startTime', event.currentTarget.value)}
                      onChange={(event) => changeEditorTimeValue('startTime', event.target.value)}
                    />
                  </label>
                  {editor.mode === 'create' || editor.shift.endTime !== null ? (
                    <>
                      <span className="history-page__time-separator" aria-hidden="true">→</span>
                      <label className="history-page__time-field">
                        <span>Вихід</span>
                        <input
                          className="history-page__time-input"
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          maxLength={5}
                          placeholder="00:00"
                          value={editor.values.endTime}
                          onBlur={(event) => completeEditorTimeValue('endTime', event.currentTarget.value)}
                          onChange={(event) => changeEditorTimeValue('endTime', event.target.value)}
                        />
                      </label>
                    </>
                  ) : null}
                </div>
              </section>

              <section className="history-page__editor-section">
                <label className="history-page__rate-field">
                  <span>Ставка за місяць, ₴</span>
                  <input
                    type="number"
                    min="0"
                    inputMode="decimal"
                    value={settings.incognitoEnabled ? '' : editor.values.hourlyRateSnapshot}
                    placeholder={settings.incognitoEnabled ? INCOGNITO_FINANCIAL_MASK : undefined}
                    disabled={settings.incognitoEnabled}
                    onChange={(event) => changeEditorRateValue(event.target.value)}
                  />
                </label>
                <div className="history-page__form-field history-page__form-field--full">
                  <span>Коефіцієнт</span>
                  <div className="history-page__segmented" role="group" aria-label="Коефіцієнт">
                    {COEFFICIENT_MODES.map((mode) => (
                      <button
                        type="button"
                        aria-pressed={editor.values.coefficientMode === mode}
                        key={mode}
                        onClick={() => changeEditorValue('coefficientMode', mode)}
                      >
                        {coefficientLabels[mode]}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              {editor.mode === 'edit' ? (
                <section className="history-page__editor-section history-page__form-field history-page__form-field--full history-page__ticket-editor">
                  <div className="history-page__ticket-editor-header">
                    <div className="history-page__ticket-editor-title">
                      <span>Тікети зміни</span>
                      <strong aria-label={`Кількість тікетів: ${editor.values.workTickets.length}`}>
                        {editor.values.workTickets.length}
                      </strong>
                    </div>
                    <small>Редагування застосується після збереження.</small>
                  </div>
                  {editor.values.workTickets.length > 0 ? (
                    <div className="history-page__ticket-list">
                      {editor.values.workTickets.map((ticket, index) => (
                        <div className="history-page__ticket-row" key={ticket.id}>
                          <div className="history-page__ticket-row-header">
                            <span className="history-page__ticket-index">
                              <span>Тікет</span>
                              <strong>{String(index + 1).padStart(2, '0')}</strong>
                            </span>
                            <button
                              className="history-page__action-button history-page__action-button--danger history-page__ticket-delete-button"
                              type="button"
                              aria-label={`Видалити тікет ${ticket.startedAt}`}
                              title="Видалити тікет"
                              disabled={isSaving}
                              onClick={() => removeEditorTicket(ticket.id)}
                            >
                              <Trash2 size={17} />
                            </button>
                          </div>
                          <div className="history-page__ticket-fields">
                            <div className="history-page__ticket-time-fields">
                              <label>
                                <span>Взято</span>
                                <input
                                  className="history-page__time-input"
                                  type="text"
                                  inputMode="numeric"
                                  autoComplete="off"
                                  maxLength={5}
                                  placeholder="00:00"
                                  value={ticket.startedAt}
                                  onBlur={() =>
                                    completeEditorTicketTime(ticket.id, 'startedAt')
                                  }
                                  onChange={(event) =>
                                    changeEditorTicketTime(
                                      ticket.id,
                                      'startedAt',
                                      event.target.value
                                    )
                                  }
                                />
                              </label>
                              <label>
                                <span>Завершено</span>
                                <input
                                  className="history-page__time-input"
                                  type="text"
                                  inputMode="numeric"
                                  autoComplete="off"
                                  maxLength={5}
                                  placeholder="Триває"
                                  value={ticket.endedAt}
                                  onBlur={() => completeEditorTicketTime(ticket.id, 'endedAt')}
                                  onChange={(event) =>
                                    changeEditorTicketTime(
                                      ticket.id,
                                      'endedAt',
                                      event.target.value
                                    )
                                  }
                                />
                              </label>
                            </div>
                            <label className="history-page__ticket-norm">
                              <span>Норма</span>
                              <span className="history-page__ticket-norm-control">
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  maxLength={3}
                                  pattern="[0-9]*"
                                  value={ticket.normPerEightHours}
                                  onChange={(event) =>
                                    changeEditorTicketNorm(ticket.id, event.target.value)
                                  }
                                />
                                <span aria-hidden="true">шт</span>
                              </span>
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="history-page__ticket-empty">У цій зміні тікетів немає.</p>
                  )}
                </section>
              ) : null}
            </div>

            {error ? (
              <p className="history-page__error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="history-page__editor-actions">
              <button type="button" disabled={isSaving} onClick={() => setEditor(null)}>
                Скасувати
              </button>
              <button type="button" disabled={isSaving} onClick={() => void saveEditor()}>
                {isSaving ? 'Збереження...' : 'Зберегти'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
