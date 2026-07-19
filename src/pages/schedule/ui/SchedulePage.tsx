import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, RefreshCw, SkipForward, Upload, X } from 'lucide-react';
import {
  calculateEnterpriseScheduleComparison,
  parseEnterpriseScheduleText
} from '../../../entities/enterprise-schedule';
import type {
  EnterpriseScheduleDiscrepancy,
  EnterpriseScheduleItem
} from '../../../entities/enterprise-schedule';
import {
  calculateHourlyRateFromMonthlySalary,
  calculateMonthlySalaryFromHourlyRate,
  countWeekdayWorkdaysInMonth,
  type Settings
} from '../../../entities/settings';
import type { LocalDateString, Shift, ShiftType } from '../../../entities/shift';
import {
  EnterpriseScheduleRepository,
  getEnterpriseScheduleBetween,
  getShiftsBetween,
  importEnterpriseScheduleText,
  localDb,
  ShiftRepository,
  skipEnterpriseScheduleDiscrepancy,
  syncShiftWithEnterpriseSchedule
} from '../../../shared/lib/local-db';
import {
  formatDate,
  formatDurationClock,
  formatDurationMinutes,
  formatTime,
  toLocalIsoString
} from '../../../shared/lib/date-time';
import { formatHourlyRate, formatMoney } from '../../../shared/lib/format';
import { MonthCalendar, type CalendarDateRange } from '../../../shared/ui/month-calendar';
import './SchedulePage.css';

const enterpriseScheduleRepository = new EnterpriseScheduleRepository(localDb);
const shiftRepository = new ShiftRepository(localDb);

type SchedulePageProps = {
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

type DiscrepancyModalState = {
  month: CalendarMonth;
  discrepancies: EnterpriseScheduleDiscrepancy[];
  selectedDate: LocalDateString;
};

const shiftTypeLabels: Record<ShiftType, string> = {
  first: '1 зміна',
  second: '2 зміна'
};

const formatDurationDifference = (minutes: number): string => {
  const sign = minutes > 0 ? '+' : minutes < 0 ? '-' : '';
  const absoluteMinutes = Math.abs(minutes);

  return absoluteMinutes < 60
    ? `${sign}${absoluteMinutes} хв`
    : `${sign}${formatDurationMinutes(absoluteMinutes)}`;
};

const getScheduleStartTime = (item: EnterpriseScheduleItem): string =>
  item.enterpriseStartTime ?? item.plannedStartTime;

const getScheduleEndTime = (item: EnterpriseScheduleItem): string =>
  item.enterpriseEndTime ?? item.plannedEndTime;

const toDateKey = (year: number, month: number, day: number): LocalDateString =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const getMonthRange = (
  year: number,
  month: number
): { start: LocalDateString; end: LocalDateString } => ({
  start: toDateKey(year, month, 1),
  end: toDateKey(year, month, new Date(year, month, 0).getDate())
});

const getSelectedRangeBounds = (
  range: CalendarDateRange
): { start: LocalDateString; end: LocalDateString } => ({
  start: range.start,
  end: range.end ?? range.start
});

const getMonthFromDate = (date: LocalDateString): { year: number; month: number } => {
  const [year, month] = date.split('-').map(Number);

  return { year, month };
};

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

const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);

  return hours * 60 + minutes;
};

const getScheduleDurationMinutes = (item: EnterpriseScheduleItem): number => {
  const start = timeToMinutes(getScheduleStartTime(item));
  const end = timeToMinutes(getScheduleEndTime(item));

  return Math.max(0, end - start);
};

const getActualShiftDurationMinutes = (shift: Shift): number => {
  if (!shift.endTime) {
    return 0;
  }

  return Math.max(
    0,
    Math.round((new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) / 60_000)
  );
};

const getVisibleMonthlySalary = (settings: Settings, shifts: Shift[]): number => {
  const latestShift = [...shifts].sort((left, right) => right.date.localeCompare(left.date))[0];

  return latestShift
    ? calculateMonthlySalaryFromHourlyRate(latestShift.baseHourlyRateSnapshot, latestShift.date)
    : settings.monthlySalary;
};

const getMonthDate = ({ year, month }: CalendarMonth): LocalDateString =>
  `${year}-${String(month).padStart(2, '0')}-01`;

export function SchedulePage({
  settings,
  calendarMonth,
  selectedRange,
  onCalendarMonthChange,
  onSelectedRangeChange,
  onDataChange
}: SchedulePageProps) {
  const [importText, setImportText] = useState('');
  const [scheduleItems, setScheduleItems] = useState<EnterpriseScheduleItem[]>([]);
  const [calendarScheduleItems, setCalendarScheduleItems] = useState<EnterpriseScheduleItem[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [calendarShifts, setCalendarShifts] = useState<Shift[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [discrepancyModal, setDiscrepancyModal] = useState<DiscrepancyModalState | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parseResult = useMemo(() => parseEnterpriseScheduleText(importText), [importText]);
  const canImport = importText.trim().length > 0 && parseResult.items.length > 0 && !isImporting;
  const comparison = useMemo(
    () => calculateEnterpriseScheduleComparison(scheduleItems, shifts),
    [scheduleItems, shifts]
  );
  const calendarMonthRange = useMemo(
    () => getMonthRange(calendarMonth.year, calendarMonth.month),
    [calendarMonth]
  );
  const loadedDateRange = useMemo(
    () =>
      selectedRange
        ? getSelectedRangeBounds(selectedRange)
        : calendarMonthRange,
    [selectedRange, calendarMonthRange]
  );
  const workedMinutes = useMemo(
    () => calendarShifts.reduce((total, shift) => total + getActualShiftDurationMinutes(shift), 0),
    [calendarShifts]
  );
  const monthlyNormMinutes = useMemo(
    () => countWeekdayWorkdaysInMonth(calendarMonth.year, calendarMonth.month) * 8 * 60,
    [calendarMonth]
  );
  const visibleMonthlySalary = useMemo(
    () => getVisibleMonthlySalary(settings, calendarShifts),
    [settings, calendarShifts]
  );
  const visibleHourlyRate = useMemo(
    () => calculateHourlyRateFromMonthlySalary(visibleMonthlySalary, getMonthDate(calendarMonth)),
    [calendarMonth, visibleMonthlySalary]
  );

  const loadSchedule = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [nextScheduleItems, nextShifts, nextCalendarScheduleItems, nextCalendarShifts] =
        await Promise.all([
        getEnterpriseScheduleBetween(
          enterpriseScheduleRepository,
          loadedDateRange.start,
          loadedDateRange.end
        ),
        getShiftsBetween(shiftRepository, loadedDateRange.start, loadedDateRange.end),
        getEnterpriseScheduleBetween(
          enterpriseScheduleRepository,
          calendarMonthRange.start,
          calendarMonthRange.end
        ),
        getShiftsBetween(shiftRepository, calendarMonthRange.start, calendarMonthRange.end)
      ]);

      setScheduleItems(nextScheduleItems);
      setShifts(nextShifts);
      setCalendarScheduleItems(nextCalendarScheduleItems);
      setCalendarShifts(nextCalendarShifts);
    } catch {
      setError('Не вдалося завантажити графік.');
    } finally {
      setIsLoading(false);
    }
  }, [calendarMonthRange, loadedDateRange]);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    if (!message) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setMessage(null);
    }, 3_500);

    return () => window.clearTimeout(timeoutId);
  }, [message]);

  const moveMonth = (direction: -1 | 1) => {
    const next = new Date(calendarMonth.year, calendarMonth.month - 1 + direction, 1);

    onCalendarMonthChange({
      year: next.getFullYear(),
      month: next.getMonth() + 1
    });
    onSelectedRangeChange(null);
  };

  const selectDate = (date: LocalDateString) => {
    const [year, month] = date.split('-').map(Number);
    const isOutsideVisibleMonth = year !== calendarMonth.year || month !== calendarMonth.month;

    if (isOutsideVisibleMonth) {
      onCalendarMonthChange({ year, month });
    }

    onSelectedRangeChange(getNextSelectedRange(selectedRange, date));
  };

  const getComparisonForMonth = async (month: CalendarMonth) => {
    const monthRange = getMonthRange(month.year, month.month);
    const [monthScheduleItems, monthShifts] = await Promise.all([
      getEnterpriseScheduleBetween(
        enterpriseScheduleRepository,
        monthRange.start,
        monthRange.end
      ),
      getShiftsBetween(shiftRepository, monthRange.start, monthRange.end)
    ]);

    return calculateEnterpriseScheduleComparison(monthScheduleItems, monthShifts);
  };

  const openDiscrepancyModal = (
    month: CalendarMonth,
    discrepancies: EnterpriseScheduleDiscrepancy[]
  ) => {
    const selectedDate = discrepancies[0]?.date;

    if (!selectedDate) {
      return;
    }

    setDiscrepancyModal({
      month,
      discrepancies,
      selectedDate
    });
  };

  const refreshDiscrepancyModal = async (month: CalendarMonth) => {
    const nextComparison = await getComparisonForMonth(month);

    if (nextComparison.discrepancies.length === 0) {
      setDiscrepancyModal(null);
      setMessage('Усі розбіжності графіка опрацьовано.');
      return;
    }

    setDiscrepancyModal((current) => {
      const selectedDateStillExists = nextComparison.discrepancies.some(
        (discrepancy) => discrepancy.date === current?.selectedDate
      );

      return {
        month,
        discrepancies: nextComparison.discrepancies,
        selectedDate: selectedDateStillExists
          ? current?.selectedDate ?? nextComparison.discrepancies[0].date
          : nextComparison.discrepancies[0].date
      };
    });
  };

  const importSchedule = async () => {
    if (!canImport) {
      return;
    }

    const confirmed = window.confirm(
      `Зберегти ${parseResult.items.length} валідних записів графіка? Записи з тими самими датами буде оновлено, а відсутні зміни буде створено.`
    );

    if (!confirmed) {
      return;
    }

    setIsImporting(true);
    setMessage(null);
    setError(null);

    try {
      const result = await importEnterpriseScheduleText(
        enterpriseScheduleRepository,
        importText,
        toLocalIsoString(new Date()),
        {
          shiftRepository,
          settings
        }
      );

      const importedMonth = getMonthFromDate(result.items[0].date);
      const importedComparison = await getComparisonForMonth(importedMonth);

      if (importedComparison.discrepancies.length > 0) {
        openDiscrepancyModal(importedMonth, importedComparison.discrepancies);
      } else {
        setMessage(
          `Збережено записів: ${result.savedCount}. Створено змін: ${result.createdShiftCount}. Помилок: ${result.errors.length}.`
        );
      }

      onDataChange?.();
      onSelectedRangeChange(null);
      onCalendarMonthChange(importedMonth);
      await loadSchedule();
    } catch {
      setError('Не вдалося зберегти графік.');
    } finally {
      setIsImporting(false);
    }
  };

  const syncDiscrepancy = async (discrepancyId: string, shiftId: string, scheduleId: string) => {
    setPendingActionId(discrepancyId);
    setMessage(null);
    setError(null);

    try {
      await syncShiftWithEnterpriseSchedule(
        shiftRepository,
        enterpriseScheduleRepository,
        shiftId,
        scheduleId
      );
      setMessage('Зміну синхронізовано з графіком підприємства.');
      await loadSchedule();
      if (discrepancyModal) {
        await refreshDiscrepancyModal(discrepancyModal.month);
      }
    } catch {
      setError('Не вдалося синхронізувати зміну.');
    } finally {
      setPendingActionId(null);
    }
  };

  const skipDiscrepancy = async (discrepancyId: string, scheduleId: string) => {
    setPendingActionId(discrepancyId);
    setMessage(null);
    setError(null);

    try {
      await skipEnterpriseScheduleDiscrepancy(enterpriseScheduleRepository, scheduleId);
      setMessage('Розбіжність позначено як пропущену.');
      await loadSchedule();
      if (discrepancyModal) {
        await refreshDiscrepancyModal(discrepancyModal.month);
      }
    } catch {
      setError('Не вдалося пропустити розбіжність.');
    } finally {
      setPendingActionId(null);
    }
  };

  const selectedModalDiscrepancy = discrepancyModal
    ? discrepancyModal.discrepancies.find(
      (discrepancy) => discrepancy.date === discrepancyModal.selectedDate
    ) ?? null
    : null;

  return (
    <>
      <MonthCalendar
        year={calendarMonth.year}
        month={calendarMonth.month}
        salaryLabel={String(calendarShifts.length)}
        salaryTitle="Змін"
        shiftCount={formatDurationClock(workedMinutes)}
        shiftCountTitle="Відробив"
        hoursLabel={formatDurationClock(monthlyNormMinutes)}
        hoursTitle="Норма"
        shifts={calendarScheduleItems.map((item) => ({ id: item.id, date: item.date }))}
        selectedRange={selectedRange}
        onPreviousMonth={() => moveMonth(-1)}
        onNextMonth={() => moveMonth(1)}
        onDateSelect={selectDate}
        onRangeReset={() => onSelectedRangeChange(null)}
      />

      <section className="schedule-page__rate-card" aria-label="Ставка за обраний місяць">
        <span>Ставка за обраний місяць</span>
        <strong>{formatHourlyRate(visibleHourlyRate, settings.incognitoEnabled)}</strong>
      </section>

      <section className="schedule-page__list" aria-labelledby="schedule-list-title">
        <div>
          <p className="schedule-page__label">Записи</p>
          <h2 id="schedule-list-title">Графік підприємства</h2>
        </div>

        {isLoading ? (
          <p className="schedule-page__muted">Завантаження графіка...</p>
        ) : scheduleItems.length === 0 ? (
          <p className="schedule-page__muted">
            {selectedRange ? 'У вибраному діапазоні записів немає.' : 'За цей місяць записів немає.'}
          </p>
        ) : (
          <div className="schedule-page__items">
            {scheduleItems.map((item) => (
              <article className="schedule-page__item" key={item.id}>
                <time dateTime={item.date}>{formatDate(item.date)}</time>
                <span className="schedule-page__chip">{shiftTypeLabels[item.shiftType]}</span>
                <strong>
                  {getScheduleStartTime(item)}-{getScheduleEndTime(item)}
                </strong>
                <small>{formatDurationMinutes(getScheduleDurationMinutes(item))}</small>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="schedule-page__comparison" aria-labelledby="schedule-comparison-title">
        <div className="schedule-page__comparison-heading">
          <div>
            <p className="schedule-page__label">Порівняння</p>
            <h2 id="schedule-comparison-title">Розбіжності</h2>
          </div>
        </div>

        {isLoading ? (
          <p className="schedule-page__muted">Завантаження порівняння...</p>
        ) : comparison.discrepancies.length === 0 ? (
          <p className="schedule-page__muted">Немає розбіжностей із фактичними змінами.</p>
        ) : (
          <div className="schedule-page__discrepancies">
            {comparison.discrepancies.map((discrepancy) => {
              const isPending = pendingActionId === discrepancy.id;

              return (
                <article className="schedule-page__discrepancy" key={discrepancy.id}>
                  <div className="schedule-page__discrepancy-title">
                    <div>
                      <small>Розбіжність</small>
                      <strong>{formatDate(discrepancy.date)}</strong>
                    </div>
                    <span className="schedule-page__discrepancy-amount">
                      <small>Різниця</small>
                      <strong>
                        {formatMoney(
                          discrepancy.salaryDifferenceAmount,
                          settings.incognitoEnabled
                        )}
                      </strong>
                    </span>
                  </div>

                  <div className="schedule-page__time-comparison">
                    <article data-source="actual">
                      <span>Факт</span>
                      <strong>
                        {formatTime(discrepancy.actualStartTime)}-{formatTime(discrepancy.actualEndTime)}
                      </strong>
                    </article>
                    <ArrowRight className="schedule-page__time-arrow" aria-hidden="true" size={18} />
                    <article data-source="enterprise">
                      <span>Підприємство</span>
                      <strong>
                        {formatTime(discrepancy.enterpriseStartTime)}-
                        {formatTime(discrepancy.enterpriseEndTime)}
                      </strong>
                    </article>
                  </div>

                  <dl className="schedule-page__impact-grid">
                    <div>
                      <dt>Різниця тривалості</dt>
                      <dd>{formatDurationDifference(discrepancy.durationDifferenceMinutes)}</dd>
                    </div>
                  </dl>

                  <div className="schedule-page__actions">
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() =>
                        void syncDiscrepancy(
                          discrepancy.id,
                          discrepancy.shiftId,
                          discrepancy.scheduleId
                        )
                      }
                    >
                      <RefreshCw aria-hidden="true" size={18} />
                      <span>{isPending ? 'Збереження...' : 'Синхронізувати'}</span>
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => void skipDiscrepancy(discrepancy.id, discrepancy.scheduleId)}
                    >
                      <SkipForward aria-hidden="true" size={18} />
                      <span>Пропустити</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="schedule-page__import" aria-labelledby="schedule-import-title">
        <div>
          <p className="schedule-page__label">Імпорт</p>
          <h2 id="schedule-import-title">Графік підприємства</h2>
        </div>

        <textarea
          className="schedule-page__textarea"
          data-has-errors={parseResult.errors.length > 0 ? 'true' : 'false'}
          value={importText}
          rows={5}
          placeholder="--01.06.2026--&#10;In time: 05:57&#10;Out time: 16:52&#10;Total: 10:55"
          onChange={(event) => {
            setImportText(event.target.value);
            setMessage(null);
            setError(null);
          }}
        />

        <div className="schedule-page__summary-row" aria-live="polite">
          <span data-status="success">Валідні: {parseResult.items.length}</span>
          <span data-status={parseResult.errors.length > 0 ? 'error' : 'neutral'}>
            Помилки: {parseResult.errors.length}
          </span>
        </div>

        {parseResult.errors.length > 0 ? (
          <div className="schedule-page__errors" role="alert">
            {parseResult.errors.map((parseError) => (
              <article key={`${parseError.line}-${parseError.message}`}>
                <strong>Рядок {parseError.line}</strong>
                <p>{parseError.message}</p>
              </article>
            ))}
          </div>
        ) : null}

        <button
          className="schedule-page__primary-button"
          type="button"
          disabled={!canImport}
          onClick={importSchedule}
        >
          <Upload aria-hidden="true" size={20} />
          <span>{isImporting ? 'Збереження...' : 'Імпортувати'}</span>
        </button>

        {error ? (
          <p className="schedule-page__error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {discrepancyModal ? (
        <div className="schedule-page__modal" role="dialog" aria-modal="true" aria-labelledby="schedule-discrepancy-modal-title">
          <section className="schedule-page__modal-panel">
            <header className="schedule-page__modal-header">
              <div>
                <p className="schedule-page__label">Опрацювання</p>
                <h2 id="schedule-discrepancy-modal-title">Розбіжності графіка</h2>
              </div>
              <button
                className="schedule-page__modal-close"
                type="button"
                aria-label="Закрити модальне вікно"
                onClick={() => setDiscrepancyModal(null)}
              >
                <X aria-hidden="true" size={20} />
              </button>
            </header>

            <MonthCalendar
              year={discrepancyModal.month.year}
              month={discrepancyModal.month.month}
              salaryLabel=""
              shiftCount=""
              hoursLabel=""
              shifts={discrepancyModal.discrepancies.map((discrepancy) => ({
                id: discrepancy.id,
                date: discrepancy.date
              }))}
              selectedRange={{ start: discrepancyModal.selectedDate, end: null }}
              onPreviousMonth={() => undefined}
              onNextMonth={() => undefined}
              onDateSelect={(date) =>
                setDiscrepancyModal((current) =>
                  current
                    ? {
                        ...current,
                        selectedDate: date
                      }
                    : current
                )
              }
              titleId="schedule-discrepancy-calendar-title"
              hideSummary
              hideNavigation
              isCompact
              selectionMode="single"
            />

            <section className="schedule-page__modal-detail" aria-label="Деталі розбіжності">
              {selectedModalDiscrepancy ? (
                <>
                  <div className="schedule-page__modal-detail-title">
                    <strong>{formatDate(selectedModalDiscrepancy.date)}</strong>
                    <span>
                      {formatMoney(
                        selectedModalDiscrepancy.salaryDifferenceAmount,
                        settings.incognitoEnabled
                      )}
                    </span>
                  </div>

                  <dl className="schedule-page__diff-grid">
                    <div>
                      <dt>Фактичний час</dt>
                      <dd>
                        {formatTime(selectedModalDiscrepancy.actualStartTime)}-
                        {formatTime(selectedModalDiscrepancy.actualEndTime)}
                      </dd>
                    </div>
                    <div>
                      <dt>Час підприємства</dt>
                      <dd>
                        {formatTime(selectedModalDiscrepancy.enterpriseStartTime)}-
                        {formatTime(selectedModalDiscrepancy.enterpriseEndTime)}
                      </dd>
                    </div>
                    <div>
                      <dt>Різниця тривалості</dt>
                      <dd>{formatDurationDifference(selectedModalDiscrepancy.durationDifferenceMinutes)}</dd>
                    </div>
                    <div>
                      <dt>Різниця зарплати</dt>
                      <dd>
                        {formatMoney(
                          selectedModalDiscrepancy.salaryDifferenceAmount,
                          settings.incognitoEnabled
                        )}
                      </dd>
                    </div>
                  </dl>

                  <div className="schedule-page__actions">
                    <button
                      type="button"
                      disabled={pendingActionId === selectedModalDiscrepancy.id}
                      onClick={() =>
                        void syncDiscrepancy(
                          selectedModalDiscrepancy.id,
                          selectedModalDiscrepancy.shiftId,
                          selectedModalDiscrepancy.scheduleId
                        )
                      }
                    >
                      <RefreshCw aria-hidden="true" size={18} />
                      <span>
                        {pendingActionId === selectedModalDiscrepancy.id
                          ? 'Збереження...'
                          : 'Синхронізувати'}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={pendingActionId === selectedModalDiscrepancy.id}
                      onClick={() =>
                        void skipDiscrepancy(
                          selectedModalDiscrepancy.id,
                          selectedModalDiscrepancy.scheduleId
                        )
                      }
                    >
                      <SkipForward aria-hidden="true" size={18} />
                      <span>Пропустити</span>
                    </button>
                  </div>
                </>
              ) : (
                <p className="schedule-page__muted">Оберіть дату з крапкою, щоб переглянути деталі.</p>
              )}
            </section>
          </section>
        </div>
      ) : null}

      {message ? (
        <div className="schedule-page__toast" role="status" aria-live="polite">
          {message}
        </div>
      ) : null}
    </>
  );
}
