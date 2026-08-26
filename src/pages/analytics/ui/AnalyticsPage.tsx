import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck2,
  ChartNoAxesColumnIncreasing,
  Clock3,
  Coins,
  MoonStar,
  SunMedium,
  TrendingUp,
  type LucideIcon
} from 'lucide-react';
import {
  calculateCumulativeGradePercent,
  type Settings
} from '../../../entities/settings';
import type { LocalDateString, Shift, ShiftType } from '../../../entities/shift';
import { getShiftsBetween, localDb, ShiftRepository } from '../../../shared/lib/local-db';
import {
  formatDurationMinutes,
  formatShortMinuteDuration,
  formatShortNumericDate,
  closeCalendarDateRange,
  getCalendarMonthRange,
  getDateFromDateTime,
  getNextHeldCalendarRange,
  getSingleDateRange,
  isCalendarRangeWithin,
  isFullCalendarMonthRange,
  shouldResetCalendarRangeOnMonthNavigation,
  toLocalIsoString
} from '../../../shared/lib/date-time';
import {
  formatHourlyRate,
  formatMoney,
  INCOGNITO_FINANCIAL_MASK
} from '../../../shared/lib/format';
import {
  calculateAnalyticsPeriodComparison,
  getAnalyticsComparisonRanges,
  type AnalyticsComparisonPreset
} from '../../../shared/lib/shifts/analyticsComparison';
import {
  calculateAnalyticsSummary,
  type ShiftTypeAnalytics
} from '../../../shared/lib/shifts/analyticsSummary';
import {
  MonthCalendar,
  type CalendarDateRange,
  type CalendarRangePreset
} from '../../../shared/ui/month-calendar';
import { recordDiagnosticError } from '../../../shared/lib/diagnostics';
import './AnalyticsPage.css';

type AnalyticsPageProps = {
  settings: Settings;
  calendarMonth: CalendarMonth;
  selectedRange: CalendarDateRange | null;
  onCalendarMonthChange: (month: CalendarMonth) => void;
  onSelectedRangeChange: (range: CalendarDateRange | null) => void;
  activeRangePreset: CalendarRangePreset | null;
  isAllTimePresetEnabled: boolean;
  onRangePresetSelect: (preset: CalendarRangePreset) => void;
  dataRevision?: number;
};

type CalendarMonth = {
  year: number;
  month: number;
};

const shiftRepository = new ShiftRepository(localDb);

const getShiftCountLabel = (value: number): string => {
  const lastTwoDigits = value % 100;
  const lastDigit = value % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return 'змін';
  }

  if (lastDigit === 1) {
    return 'зміна';
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return 'зміни';
  }

  return 'змін';
};

const formatShiftCountWithLabel = (value: number): string => `${value} ${getShiftCountLabel(value)}`;

const getDayCountLabel = (value: number): string => {
  const lastTwoDigits = value % 100;
  const lastDigit = value % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return 'днів';
  }

  if (lastDigit === 1) {
    return 'день';
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return 'дні';
  }

  return 'днів';
};

const formatPercent = (value: number | null): string =>
  value === null ? '—' : `${Math.round(value)}%`;

const formatDecimal = (value: number | null, suffix = ''): string =>
  value === null
    ? '—'
    : `${value.toLocaleString('uk-UA', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      })}${suffix}`;

const formatSignedValue = (
  value: number | null,
  suffix: string,
  maximumFractionDigits = 0
): string => {
  if (value === null) {
    return '—';
  }

  const formattedValue = Math.abs(value).toLocaleString('uk-UA', {
    maximumFractionDigits
  });

  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formattedValue}${suffix}`;
};

const formatSignedMoney = (value: number, incognitoEnabled: boolean): string => {
  if (incognitoEnabled) {
    return INCOGNITO_FINANCIAL_MASK;
  }

  const sign = value > 0 ? '+' : value < 0 ? '−' : '';

  return `${sign}${formatMoney(Math.abs(value), false)}`;
};

const formatSignedDuration = (value: number): string => {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';

  return `${sign}${formatDurationMinutes(Math.abs(value))}`;
};

const getChangeTone = (value: number | null): 'positive' | 'negative' | 'neutral' =>
  value === null || value === 0 ? 'neutral' : value > 0 ? 'positive' : 'negative';

const formatAnalyticsRange = ({
  start,
  end
}: {
  start: LocalDateString;
  end: LocalDateString;
}): string =>
  start === end
    ? formatShortNumericDate(start)
    : `${formatShortNumericDate(start)}–${formatShortNumericDate(end)}`;

const getDeviationFacts = ({
  lateArrivalMinutes,
  earlyExitMinutes
}: {
  lateArrivalMinutes: number;
  earlyExitMinutes: number;
}): Array<{ key: 'late' | 'early'; label: string; value: string }> => [
  ...(lateArrivalMinutes > 0
    ? [
        {
          key: 'late' as const,
          label: 'Запізнення',
          value: formatShortMinuteDuration(lateArrivalMinutes)
        }
      ]
    : []),
  ...(earlyExitMinutes > 0
    ? [
        {
          key: 'early' as const,
          label: 'Ранній вихід',
          value: formatShortMinuteDuration(earlyExitMinutes)
        }
      ]
    : [])
];

const shiftTypeRows: Array<{
  key: ShiftType;
  label: string;
  icon: LucideIcon;
  getSummary: (summary: ReturnType<typeof calculateAnalyticsSummary>) => ShiftTypeAnalytics;
}> = [
  {
    key: 'first',
    label: 'Перша зміна',
    icon: SunMedium,
    getSummary: (summary) => summary.firstShift
  },
  {
    key: 'second',
    label: 'Друга зміна',
    icon: MoonStar,
    getSummary: (summary) => summary.secondShift
  }
];

const comparisonPresets: Array<{
  value: AnalyticsComparisonPreset;
  label: string;
}> = [
  { value: 'week', label: 'Тиждень' },
  { value: 'month', label: 'Місяць' },
  { value: 'twoMonths', label: '2 місяці' }
];

export function AnalyticsPage({
  settings,
  calendarMonth,
  selectedRange,
  onCalendarMonthChange,
  onSelectedRangeChange,
  activeRangePreset,
  isAllTimePresetEnabled,
  onRangePresetSelect,
  dataRevision = 0
}: AnalyticsPageProps) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [previousShifts, setPreviousShifts] = useState<Shift[]>([]);
  const [calendarShifts, setCalendarShifts] = useState<Shift[]>([]);
  const [now, setNow] = useState(() => toLocalIsoString(new Date()));
  const [isLoading, setIsLoading] = useState(true);
  const [isComparisonLoading, setIsComparisonLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [comparisonPreset, setComparisonPreset] =
    useState<AnalyticsComparisonPreset>('month');
  const loadRequestSequenceRef = useRef(0);
  const calendarMonthRange = useMemo(
    () => getCalendarMonthRange(calendarMonth),
    [calendarMonth]
  );
  const loadedDateRange = useMemo(
    () =>
      selectedRange
        ? closeCalendarDateRange(selectedRange)
        : calendarMonthRange,
    [selectedRange, calendarMonthRange]
  );
  const today = getDateFromDateTime(now);
  const comparisonRanges = useMemo(
    () => getAnalyticsComparisonRanges(loadedDateRange, today, comparisonPreset),
    [comparisonPreset, loadedDateRange, today]
  );
  const previousDateRange = comparisonRanges.previous;
  const previousPeriodNow = useMemo(
    () => toLocalIsoString(new Date()),
    [previousDateRange.end, previousDateRange.start]
  );

  const loadAnalytics = useCallback(async () => {
    const requestSequence = ++loadRequestSequenceRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const currentDate = new Date();

      setNow(toLocalIsoString(currentDate));
      const nextCalendarShifts = await getShiftsBetween(
        shiftRepository,
        calendarMonthRange.start,
        calendarMonthRange.end
      );
      const nextShifts = isCalendarRangeWithin(loadedDateRange, calendarMonthRange)
        ? nextCalendarShifts.filter(
            (shift) => shift.date >= loadedDateRange.start && shift.date <= loadedDateRange.end
          )
        : await getShiftsBetween(
            shiftRepository,
            loadedDateRange.start,
            loadedDateRange.end
          );

      if (requestSequence !== loadRequestSequenceRef.current) {
        return;
      }

      setShifts(nextShifts);
      setCalendarShifts(nextCalendarShifts);
    } catch (error) {
      recordDiagnosticError('analytics.load_failed', 'analytics', error);
      if (requestSequence === loadRequestSequenceRef.current) {
        setError('Не вдалося завантажити аналітику.');
      }
    } finally {
      if (requestSequence === loadRequestSequenceRef.current) {
        setIsLoading(false);
      }
    }
  }, [calendarMonthRange, dataRevision, loadedDateRange]);

  useEffect(() => {
    void loadAnalytics();

    return () => {
      loadRequestSequenceRef.current += 1;
    };
  }, [loadAnalytics]);

  useEffect(() => {
    let isCurrentRequest = true;

    setIsComparisonLoading(true);
    setComparisonError(null);

    getShiftsBetween(shiftRepository, previousDateRange.start, previousDateRange.end)
      .then((nextPreviousShifts) => {
        if (isCurrentRequest) {
          setPreviousShifts(nextPreviousShifts);
        }
      })
      .catch((error) => {
        recordDiagnosticError('analytics.load_failed', 'analytics', error);
        if (isCurrentRequest) {
          setComparisonError('Не вдалося завантажити порівняння.');
        }
      })
      .finally(() => {
        if (isCurrentRequest) {
          setIsComparisonLoading(false);
        }
      });

    return () => {
      isCurrentRequest = false;
    };
  }, [dataRevision, previousDateRange.end, previousDateRange.start]);

  useEffect(() => {
    if (!shifts.some((shift) => shift.endTime === null)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(toLocalIsoString(new Date()));
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [shifts]);

  const summary = useMemo(
    () =>
      calculateAnalyticsSummary({
        shifts,
        now,
        periodStart: loadedDateRange.start,
        periodEnd: loadedDateRange.end,
        monthlyBonus: settings.monthlyBonus,
        includeMonthlyBonus: isFullCalendarMonthRange(loadedDateRange),
        fallbackGradeBonusSnapshot: {
          monthlySalarySnapshot: settings.monthlySalary,
          cumulativeSalaryBonusPercent: calculateCumulativeGradePercent(
            settings.currentGrade,
            settings.gradeSalaryBonusPercents
          )
        }
      }),
    [
      shifts,
      now,
      loadedDateRange,
      settings.monthlyBonus,
      settings.monthlySalary,
      settings.currentGrade,
      settings.gradeSalaryBonusPercents
    ]
  );
  const comparisonCurrentShifts = useMemo(
    () =>
      shifts.filter(
        (shift) =>
          shift.date >= comparisonRanges.current.start &&
          shift.date <= comparisonRanges.current.end
      ),
    [comparisonRanges.current, shifts]
  );
  const comparisonCurrentSummary = useMemo(
    () =>
      calculateAnalyticsSummary({
        shifts: comparisonCurrentShifts,
        now: previousPeriodNow,
        periodStart: comparisonRanges.current.start,
        periodEnd: comparisonRanges.current.end,
        monthlyBonus: 0,
        includeMonthlyBonus: false
      }),
    [comparisonCurrentShifts, comparisonRanges.current, previousPeriodNow]
  );
  const previousSummary = useMemo(
    () =>
      calculateAnalyticsSummary({
        shifts: previousShifts,
        now: previousPeriodNow,
        periodStart: previousDateRange.start,
        periodEnd: previousDateRange.end,
        monthlyBonus: 0,
        includeMonthlyBonus: false
      }),
    [previousDateRange, previousPeriodNow, previousShifts]
  );
  const periodComparison = useMemo(
    () => calculateAnalyticsPeriodComparison(comparisonCurrentSummary, previousSummary),
    [comparisonCurrentSummary, previousSummary]
  );
  const calendarShiftMarkers = useMemo(
    () => calendarShifts.map((shift) => ({ id: shift.id, date: shift.date })),
    [calendarShifts]
  );
  const moveMonth = (direction: -1 | 1) => {
    const next = new Date(calendarMonth.year, calendarMonth.month - 1 + direction, 1);

    onCalendarMonthChange({
      year: next.getFullYear(),
      month: next.getMonth() + 1
    });

    if (
      shouldResetCalendarRangeOnMonthNavigation(activeRangePreset, selectedRange)
    ) {
      onSelectedRangeChange(null);
    }
  };

  const syncCalendarMonthToDate = (date: LocalDateString) => {
    const [year, month] = date.split('-').map(Number);
    const isOutsideVisibleMonth = year !== calendarMonth.year || month !== calendarMonth.month;

    if (isOutsideVisibleMonth) {
      onCalendarMonthChange({ year, month });
    }
  };

  const selectDate = (date: LocalDateString) => {
    syncCalendarMonthToDate(date);
    onSelectedRangeChange(getSingleDateRange(date));
  };

  const holdDate = (date: LocalDateString) => {
    syncCalendarMonthToDate(date);
    onSelectedRangeChange(getNextHeldCalendarRange(selectedRange, date));
  };
  const hasAnalyticsData = summary.shiftCount > 0;
  const visibleCoefficientBreakdown = summary.coefficientBreakdown.filter((item) => item.minutes > 0);

  return (
    <div className="analytics-page">
      <MonthCalendar
        year={calendarMonth.year}
        month={calendarMonth.month}
        salaryLabel={formatMoney(summary.plannedSalary, settings.incognitoEnabled)}
        salaryTitle="Очікується"
        shiftCount={summary.shiftCount}
        shiftCountTitle="Змін"
        hoursLabel={formatMoney(summary.currentSalary, settings.incognitoEnabled)}
        hoursTitle="Зароблено"
        shifts={calendarShiftMarkers}
        selectedRange={selectedRange}
        onPreviousMonth={() => moveMonth(-1)}
        onNextMonth={() => moveMonth(1)}
        onDateSelect={selectDate}
        onDateHold={holdDate}
        activeRangePreset={activeRangePreset}
        isAllTimePresetEnabled={isAllTimePresetEnabled}
        onRangePresetSelect={onRangePresetSelect}
      />

      {error ? (
        <p className="analytics-page__error" role="alert">
          {error}
        </p>
      ) : null}

      {isLoading ? (
        <p className="analytics-page__empty">Завантаження аналітики...</p>
      ) : !hasAnalyticsData ? (
        <p className="analytics-page__empty">
          У цьому періоді ще немає відпрацьованих змін. Оберіть інший період або додайте зміну в історії.
        </p>
      ) : (
        <>
          <section className="analytics-page__panel analytics-page__summary-panel" aria-labelledby="analytics-summary-title">
            <header className="analytics-page__panel-header">
              <div>
                <p className="analytics-page__eyebrow">Підсумок періоду</p>
                <h3 id="analytics-summary-title">Гроші</h3>
              </div>
              <Coins aria-hidden="true" size={24} />
            </header>

            <div className="analytics-page__money-grid" aria-label="Фінансовий підсумок">
              <article className="analytics-page__money-card analytics-page__money-card--primary">
                <span>Базовий заробіток</span>
                <strong>{formatMoney(summary.currentSalary, settings.incognitoEnabled)}</strong>
              </article>
              <article className="analytics-page__money-card">
                <span>Очікується</span>
                <strong>{formatMoney(summary.plannedSalary, settings.incognitoEnabled)}</strong>
              </article>
              <article className="analytics-page__money-card">
                <span>Фіксована премія</span>
                <strong>{formatMoney(summary.monthlyBonus, settings.incognitoEnabled)}</strong>
              </article>
              <article className="analytics-page__money-card">
                <span>Премія за рівень</span>
                <strong>{formatMoney(summary.gradeBonus, settings.incognitoEnabled)}</strong>
              </article>
              <article className="analytics-page__money-card">
                <span>За перепрацювання</span>
                <strong>{formatMoney(summary.overtimeIncome, settings.incognitoEnabled)}</strong>
              </article>
              <article className="analytics-page__money-card analytics-page__money-card--count">
                <span>Змін</span>
                <strong>{summary.shiftCount}</strong>
              </article>
              <article className="analytics-page__money-card">
                <span>Середньо за зміну</span>
                <strong>{formatMoney(summary.averageSalaryPerShift, settings.incognitoEnabled)}</strong>
              </article>
              <article className="analytics-page__money-card">
                <span>Ефективно за годину</span>
                <strong>{formatHourlyRate(summary.effectiveHourlyIncome, settings.incognitoEnabled)}</strong>
              </article>
            </div>
          </section>

          <section className="analytics-page__panel" aria-labelledby="analytics-comparison-title">
            <header className="analytics-page__panel-header">
              <div>
                <p className="analytics-page__eyebrow">
                  {formatAnalyticsRange(comparisonRanges.current)} проти{' '}
                  {formatAnalyticsRange(previousDateRange)}
                </p>
                <h3 id="analytics-comparison-title">Порівняння</h3>
              </div>
              <TrendingUp aria-hidden="true" size={24} />
            </header>

            <div
              className="analytics-page__comparison-presets"
              role="group"
              aria-label="Період порівняння"
            >
              {comparisonPresets.map((preset) => (
                <button
                  type="button"
                  aria-pressed={comparisonPreset === preset.value}
                  key={preset.value}
                  onClick={() => setComparisonPreset(preset.value)}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {isComparisonLoading ? (
              <p className="analytics-page__comparison-empty" aria-live="polite">
                Завантаження порівняння...
              </p>
            ) : comparisonError ? (
              <p className="analytics-page__error" role="alert">
                {comparisonError}
              </p>
            ) : periodComparison.hasPreviousData ? (
              <div className="analytics-page__comparison-grid" aria-label="Зміни до попереднього періоду">
                <article
                  data-tone={
                    settings.incognitoEnabled
                      ? 'neutral'
                      : getChangeTone(periodComparison.salaryPercentChange)
                  }
                >
                  <header>
                    <span>Базовий заробіток</span>
                    <strong>
                      {settings.incognitoEnabled
                        ? INCOGNITO_FINANCIAL_MASK
                        : formatSignedValue(periodComparison.salaryPercentChange, '%')}
                    </strong>
                  </header>
                  <div className="analytics-page__comparison-values">
                    <span>
                      <small>Зараз</small>
                      <strong>
                        {formatMoney(
                          comparisonCurrentSummary.workSalary,
                          settings.incognitoEnabled
                        )}
                      </strong>
                    </span>
                    <span>
                      <small>Було</small>
                      <strong>{formatMoney(previousSummary.workSalary, settings.incognitoEnabled)}</strong>
                    </span>
                  </div>
                  <footer>
                    <span>Різниця</span>
                    <strong>
                      {formatSignedMoney(
                        periodComparison.salaryAmountChange,
                        settings.incognitoEnabled
                      )}
                    </strong>
                  </footer>
                </article>
                <article data-tone={getChangeTone(periodComparison.workedMinutesPercentChange)}>
                  <header>
                    <span>Відпрацьований час</span>
                    <strong>{formatSignedValue(periodComparison.workedMinutesPercentChange, '%')}</strong>
                  </header>
                  <div className="analytics-page__comparison-values">
                    <span>
                      <small>Зараз</small>
                      <strong>{formatDurationMinutes(comparisonCurrentSummary.totalMinutes)}</strong>
                    </span>
                    <span>
                      <small>Було</small>
                      <strong>{formatDurationMinutes(previousSummary.totalMinutes)}</strong>
                    </span>
                  </div>
                  <footer>
                    <span>Різниця</span>
                    <strong>{formatSignedDuration(periodComparison.workedMinutesChange)}</strong>
                  </footer>
                </article>
                <article data-tone={getChangeTone(periodComparison.shiftCountChange)}>
                  <header>
                    <span>Кількість змін</span>
                    <strong>{formatSignedValue(periodComparison.shiftCountPercentChange, '%')}</strong>
                  </header>
                  <div className="analytics-page__comparison-values">
                    <span>
                      <small>Зараз</small>
                      <strong>{comparisonCurrentSummary.shiftCount}</strong>
                    </span>
                    <span>
                      <small>Було</small>
                      <strong>{previousSummary.shiftCount}</strong>
                    </span>
                  </div>
                  <footer>
                    <span>Різниця</span>
                    <strong>{formatSignedValue(periodComparison.shiftCountChange, '')}</strong>
                  </footer>
                </article>
                <article data-tone={getChangeTone(periodComparison.completionPercentChange)}>
                  <header>
                    <span>Виконання %</span>
                    <strong>
                      {formatSignedValue(
                        periodComparison.completionPercentChange,
                        '%',
                        1
                      )}
                    </strong>
                  </header>
                  <div className="analytics-page__comparison-values">
                    <span>
                      <small>Зараз</small>
                      <strong>
                        {formatPercent(comparisonCurrentSummary.production.completionPercent)}
                      </strong>
                    </span>
                    <span>
                      <small>Було</small>
                      <strong>{formatPercent(previousSummary.production.completionPercent)}</strong>
                    </span>
                  </div>
                  <footer>
                    <span>Різниця, в.п.</span>
                    <strong>
                      {formatSignedValue(
                        periodComparison.completionPercentagePointChange,
                        ' в.п.',
                        1
                      )}
                    </strong>
                  </footer>
                </article>
              </div>
            ) : (
              <p className="analytics-page__comparison-empty">
                У попередньому періоді немає змін для порівняння.
              </p>
            )}
          </section>

          <section className="analytics-page__panel" aria-labelledby="analytics-time-title">
            <header className="analytics-page__panel-header">
              <div>
                <p className="analytics-page__eyebrow">Час</p>
                <h3 id="analytics-time-title">Відпрацьовано</h3>
              </div>
              <Clock3 aria-hidden="true" size={24} />
            </header>

            <dl className="analytics-page__detail-list" aria-label="Показники часу">
              <div className="analytics-page__detail-item--wide analytics-page__detail-item--time-total">
                <dt>Загалом</dt>
                <dd>{formatDurationMinutes(summary.totalMinutes)}</dd>
              </div>
              <div className="analytics-page__detail-item--wide">
                <dt>Перепрацювання</dt>
                <dd>{formatDurationMinutes(summary.overtimeMinutes)}</dd>
              </div>
              <div>
                <dt>Сер. тривалість зміни</dt>
                <dd>{formatDurationMinutes(Math.round(summary.averageShiftMinutes))}</dd>
              </div>
              <div>
                <dt>Сер. перепрацювання</dt>
                <dd>{formatDurationMinutes(Math.round(summary.averageOvertimeMinutes))}</dd>
              </div>
              <div>
                <dt>Макс. перепрацювання</dt>
                <dd>{formatDurationMinutes(summary.maxOvertimeMinutes)}</dd>
              </div>
            </dl>

            {visibleCoefficientBreakdown.length > 0 ? (
              <div className="analytics-page__coefficient-section" aria-label="По коефіцієнтах">
                <h4>По коефіцієнтах</h4>
                <dl>
                  {visibleCoefficientBreakdown.map((item) => (
                    <div data-coefficient={item.coefficient} key={item.coefficient}>
                      <dt>x{item.coefficient}</dt>
                      <dd>
                        <span>{formatDurationMinutes(item.minutes)}</span>
                        <strong>{formatMoney(item.amount, settings.incognitoEnabled)}</strong>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}
          </section>

          <section
            className="analytics-page__panel analytics-page__discipline"
            data-has-deviations={summary.deviations.length > 0}
            aria-labelledby="analytics-discipline-title"
          >
            <header className="analytics-page__deviation-header">
              <div className="analytics-page__deviation-title-row">
                <span className="analytics-page__deviation-icon" aria-hidden="true">
                  <CalendarCheck2 size={20} />
                </span>
                <div>
                  <p className="analytics-page__eyebrow">Дисципліна</p>
                  <h3 id="analytics-discipline-title">Дотримання графіка</h3>
                </div>
                <strong className="analytics-page__deviation-count">
                  {summary.deviations.length} {getDayCountLabel(summary.deviations.length)}
                </strong>
              </div>

              <div className="analytics-page__deviation-totals" aria-label="Підсумок дисципліни">
                <article data-tone="success">
                  <span>Без відхилень</span>
                  <strong>
                    {summary.onScheduleShiftCount}/{summary.completedShiftCount} ·{' '}
                    {formatPercent(summary.scheduleAdherencePercent)}
                  </strong>
                </article>
                <article data-tone="late">
                  <span>Запізнення</span>
                  <strong>{formatShortMinuteDuration(summary.lateArrivalMinutes)}</strong>
                  <small>
                    {formatShiftCountWithLabel(summary.lateArrivalShiftCount)} · сер.{' '}
                    {formatShortMinuteDuration(Math.round(summary.averageLateArrivalMinutes))}
                  </small>
                </article>
                <article data-tone="early">
                  <span>Ранній вихід</span>
                  <strong>{formatShortMinuteDuration(summary.earlyExitMinutes)}</strong>
                  <small>
                    {formatShiftCountWithLabel(summary.earlyExitShiftCount)} · сер.{' '}
                    {formatShortMinuteDuration(Math.round(summary.averageEarlyExitMinutes))}
                  </small>
                </article>
              </div>
            </header>

            {summary.deviations.length > 0 ? (
              <div className="analytics-page__deviation-list" aria-label="Відхилення за днями">
                {summary.deviations.map((item) => {
                  const facts = getDeviationFacts(item);

                  return (
                    <article className="analytics-page__deviation" key={item.date}>
                      <time dateTime={item.date}>{formatShortNumericDate(item.date)}</time>
                      <div className="analytics-page__deviation-facts">
                        {facts.map((fact) => (
                          <span
                            className="analytics-page__deviation-fact"
                            data-tone={fact.key}
                            aria-label={`${fact.label}: ${fact.value}`}
                            key={fact.key}
                          >
                            <small>{fact.label}</small>
                            <strong>{fact.value}</strong>
                          </span>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>

          <section className="analytics-page__panel" aria-labelledby="analytics-production-title">
            <header className="analytics-page__panel-header">
              <div>
                <p className="analytics-page__eyebrow">Тікети</p>
                <h3 id="analytics-production-title">Виробіток</h3>
              </div>
              <ChartNoAxesColumnIncreasing aria-hidden="true" size={24} />
            </header>

            <dl className="analytics-page__detail-list" aria-label="Показники виробітку">
              <div className="analytics-page__detail-item--featured">
                <dt>Факт</dt>
                <dd>{summary.production.actualQuantity} шт</dd>
              </div>
              <div className="analytics-page__detail-item--wide">
                <dt>План G1</dt>
                <dd>{summary.production.gradeOneTarget} шт</dd>
              </div>
              <div>
                <dt>План поточного G</dt>
                <dd>{summary.production.currentGradeTarget} шт</dd>
              </div>
              <div>
                <dt>Виконання %</dt>
                <dd>{formatPercent(summary.production.completionPercent)}</dd>
              </div>
              <div>
                <dt>Середній факт</dt>
                <dd>{summary.production.averageActualPerTicket.toFixed(1)} шт</dd>
              </div>
              <div>
                <dt>Продуктивний час</dt>
                <dd>{formatDurationMinutes(summary.production.productiveMinutes)}</dd>
              </div>
              <div>
                <dt>Простій</dt>
                <dd>{formatDurationMinutes(summary.production.downtimeMinutes)}</dd>
              </div>
              <div>
                <dt>Заповнено</dt>
                <dd>{summary.production.filledTicketCount}/{summary.production.ticketCount}</dd>
              </div>
              <div>
                <dt>Незаповнені</dt>
                <dd>{summary.production.unfilledTicketCount}</dd>
              </div>
              <div>
                <dt>Сер. тікетів / зміну</dt>
                <dd>{formatDecimal(summary.production.averageTicketsPerShift)}</dd>
              </div>
              <div>
                <dt>Темп виробітку</dt>
                <dd>{formatDecimal(summary.production.quantityPerProductiveHour, ' шт/год')}</dd>
              </div>
              <div>
                <dt>Сер. продуктивно / тікет</dt>
                <dd>{formatDurationMinutes(Math.round(summary.production.averageProductiveMinutesPerTicket))}</dd>
              </div>
              <div>
                <dt>Сер. простій / тікет</dt>
                <dd>{formatDurationMinutes(Math.round(summary.production.averageDowntimeMinutesPerTicket))}</dd>
              </div>
              <div>
                <dt>Частка простою</dt>
                <dd>{formatPercent(summary.production.downtimePercent)}</dd>
              </div>
            </dl>
          </section>

          <section className="analytics-page__panel" aria-labelledby="analytics-shifts-title">
            <header className="analytics-page__panel-header">
              <div>
                <p className="analytics-page__eyebrow">Зміни</p>
                <h3 id="analytics-shifts-title">Розподіл</h3>
              </div>
              <ChartNoAxesColumnIncreasing aria-hidden="true" size={24} />
            </header>

            <div className="analytics-page__shift-types">
              {shiftTypeRows.map((row) => {
                const item = row.getSummary(summary);
                const ShiftIcon = row.icon;
                const countLabel = formatShiftCountWithLabel(item.shiftCount);

                return (
                  <article
                    className="analytics-page__shift-type"
                    data-shift-type={row.key}
                    aria-label={`${row.label}, ${countLabel}`}
                    key={row.key}
                  >
                    <div className="analytics-page__shift-type-header">
                      <div className="analytics-page__shift-type-identity">
                        <span className="analytics-page__shift-type-icon" aria-hidden="true">
                          <ShiftIcon size={18} />
                        </span>
                        <strong>{row.label}</strong>
                      </div>
                      <span className="analytics-page__shift-type-count">{countLabel}</span>
                    </div>

                    <div className="analytics-page__shift-type-salary">
                      <span>Зароблено</span>
                      <strong>{formatMoney(item.salaryAmount, settings.incognitoEnabled)}</strong>
                    </div>

                    <dl>
                      <div>
                        <dt>Відпрацьовано</dt>
                        <dd>{formatDurationMinutes(item.totalMinutes)}</dd>
                      </div>
                      <div>
                        <dt>Понад норму</dt>
                        <dd>{formatDurationMinutes(item.overtimeMinutes)}</dd>
                      </div>
                    </dl>
                  </article>
                );
              })}
            </div>
          </section>

          {settings.incognitoEnabled ? (
            <section className="analytics-page__note" aria-label="Інкогніто">
              <AlertTriangle aria-hidden="true" size={20} />
              <span>Фінансові значення приховані.</span>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
