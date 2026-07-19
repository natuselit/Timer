import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChartNoAxesColumnIncreasing,
  Clock3,
  Coins,
  MoonStar,
  SunMedium,
  type LucideIcon
} from 'lucide-react';
import type { Settings } from '../../../entities/settings';
import type { LocalDateString, Shift, ShiftType } from '../../../entities/shift';
import { getShiftsBetween, localDb, ShiftRepository } from '../../../shared/lib/local-db';
import {
  formatDurationMinutes,
  formatShortNumericDate,
  padTimePart,
  toLocalIsoString
} from '../../../shared/lib/date-time';
import { formatMoney } from '../../../shared/lib/format';
import {
  calculateAnalyticsSummary,
  type ShiftTypeAnalytics
} from '../../../shared/lib/shifts/analyticsSummary';
import { MonthCalendar, type CalendarDateRange } from '../../../shared/ui/month-calendar';
import './AnalyticsPage.css';

type AnalyticsPageProps = {
  settings: Settings;
  calendarMonth: CalendarMonth;
  selectedRange: CalendarDateRange | null;
  onCalendarMonthChange: (month: CalendarMonth) => void;
  onSelectedRangeChange: (range: CalendarDateRange | null) => void;
};

type CalendarMonth = {
  year: number;
  month: number;
};

const shiftRepository = new ShiftRepository(localDb);

const toLocalDateString = (date: Date): LocalDateString =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;

const getMonthRange = (
  year: number,
  month: number
): { start: LocalDateString; end: LocalDateString } => ({
  start: toLocalDateString(new Date(year, month - 1, 1)),
  end: toLocalDateString(new Date(year, month, 0))
});

const getSelectedRangeBounds = (
  range: CalendarDateRange
): { start: LocalDateString; end: LocalDateString } => ({
  start: range.start,
  end: range.end ?? range.start
});

const isFullMonthRange = ({ start, end }: { start: LocalDateString; end: LocalDateString }): boolean => {
  const [year, month, day] = start.split('-').map(Number);

  if (day !== 1) {
    return false;
  }

  const lastDay = new Date(year, month, 0).getDate();

  return end === `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
};

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

const formatDeviationDuration = (minutes: number): string => {
  const safeMinutes = Math.max(0, minutes);
  const hours = Math.floor(safeMinutes / 60);
  const remainingMinutes = safeMinutes % 60;

  if (hours === 0) {
    return `${remainingMinutes} хв`;
  }

  return `${hours} год ${padTimePart(remainingMinutes)} хв`;
};

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
          value: formatDeviationDuration(lateArrivalMinutes)
        }
      ]
    : []),
  ...(earlyExitMinutes > 0
    ? [
        {
          key: 'early' as const,
          label: 'Ранній вихід',
          value: formatDeviationDuration(earlyExitMinutes)
        }
      ]
    : [])
];

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

export function AnalyticsPage({
  settings,
  calendarMonth,
  selectedRange,
  onCalendarMonthChange,
  onSelectedRangeChange
}: AnalyticsPageProps) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [calendarShifts, setCalendarShifts] = useState<Shift[]>([]);
  const [now, setNow] = useState(() => toLocalIsoString(new Date()));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  const loadAnalytics = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const currentDate = new Date();

      setNow(toLocalIsoString(currentDate));
      const [nextShifts, nextCalendarShifts] = await Promise.all([
        getShiftsBetween(shiftRepository, loadedDateRange.start, loadedDateRange.end),
        getShiftsBetween(shiftRepository, calendarMonthRange.start, calendarMonthRange.end)
      ]);

      setShifts(nextShifts);
      setCalendarShifts(nextCalendarShifts);
    } catch {
      setError('Не вдалося завантажити аналітику.');
    } finally {
      setIsLoading(false);
    }
  }, [calendarMonthRange, loadedDateRange]);

  useEffect(() => {
    void loadAnalytics();
  }, [loadAnalytics]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(toLocalIsoString(new Date()));
    }, 15_000);

    return () => window.clearInterval(intervalId);
  }, []);

  const summary = useMemo(
    () =>
      calculateAnalyticsSummary({
        shifts,
        now,
        periodStart: loadedDateRange.start,
        periodEnd: loadedDateRange.end,
        monthlyBonus: settings.monthlyBonus,
        includeMonthlyBonus: isFullMonthRange(loadedDateRange)
      }),
    [shifts, now, loadedDateRange, settings.monthlyBonus]
  );
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
  const hasAnalyticsData = summary.shiftCount > 0;
  const visibleCoefficientBreakdown = summary.coefficientBreakdown.filter((item) => item.minutes > 0);
  const hasDeviations = summary.deviations.length > 0;

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
        shifts={calendarShifts.map((shift) => ({ id: shift.id, date: shift.date }))}
        selectedRange={selectedRange}
        onPreviousMonth={() => moveMonth(-1)}
        onNextMonth={() => moveMonth(1)}
        onDateSelect={selectDate}
        onRangeReset={() => onSelectedRangeChange(null)}
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
                <span>Зароблено</span>
                <strong>{formatMoney(summary.currentSalary, settings.incognitoEnabled)}</strong>
              </article>
              <article className="analytics-page__money-card">
                <span>Очікується</span>
                <strong>{formatMoney(summary.plannedSalary, settings.incognitoEnabled)}</strong>
              </article>
              <article className="analytics-page__money-card analytics-page__money-card--count">
                <span>Змін</span>
                <strong>{summary.shiftCount}</strong>
              </article>
            </div>
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
              <div>
                <dt>Години</dt>
                <dd>{formatDurationMinutes(summary.totalMinutes)}</dd>
              </div>
              <div>
                <dt>Перепрацювання</dt>
                <dd>{formatDurationMinutes(summary.overtimeMinutes)}</dd>
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
                    <div key={item.coefficient}>
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

          {hasDeviations ? (
            <section className="analytics-page__panel analytics-page__deviations" aria-labelledby="analytics-deviations-title">
              <header className="analytics-page__deviation-header">
                <div className="analytics-page__deviation-title-row">
                  <span className="analytics-page__deviation-icon" aria-hidden="true">
                    <AlertTriangle size={20} />
                  </span>
                  <div>
                    <p className="analytics-page__eyebrow">Контроль графіка</p>
                    <h3 id="analytics-deviations-title">Відхилення</h3>
                  </div>
                  <strong className="analytics-page__deviation-count">
                    {summary.deviations.length} {getDayCountLabel(summary.deviations.length)}
                  </strong>
                </div>

                <div className="analytics-page__deviation-totals" aria-label="Підсумок відхилень">
                  {getDeviationFacts({
                    lateArrivalMinutes: summary.lateArrivalMinutes,
                    earlyExitMinutes: summary.earlyExitMinutes
                  }).map((fact) => (
                    <article data-tone={fact.key} key={fact.key}>
                      <span>{fact.label}</span>
                      <strong>{fact.value}</strong>
                    </article>
                  ))}
                </div>
              </header>

              <div className="analytics-page__deviation-list">
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
            </section>
          ) : null}

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
