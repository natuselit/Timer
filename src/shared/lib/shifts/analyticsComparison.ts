import type { LocalDateString } from '../../../entities/shift';
import type { AnalyticsSummary } from './analyticsSummary';

export type AnalyticsDateRange = {
  start: LocalDateString;
  end: LocalDateString;
};

export type AnalyticsPeriodComparison = {
  hasPreviousData: boolean;
  salaryPercentChange: number | null;
  salaryAmountChange: number;
  workedMinutesPercentChange: number | null;
  workedMinutesChange: number;
  shiftCountPercentChange: number | null;
  shiftCountChange: number;
  completionPercentagePointChange: number | null;
};

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;

const toUtcTimestamp = (date: LocalDateString): number => {
  const [year, month, day] = date.split('-').map(Number);

  return Date.UTC(year, month - 1, day);
};

const fromUtcTimestamp = (timestamp: number): LocalDateString => {
  const date = new Date(timestamp);

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(
    date.getUTCDate()
  ).padStart(2, '0')}`;
};

const normalizeRange = ({ start, end }: AnalyticsDateRange): AnalyticsDateRange =>
  start <= end ? { start, end } : { start: end, end: start };

const isFullCalendarMonth = ({ start, end }: AnalyticsDateRange): boolean => {
  const [year, month, day] = start.split('-').map(Number);

  if (day !== 1) {
    return false;
  }

  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return end === `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
};

export const getPreviousAnalyticsRange = (range: AnalyticsDateRange): AnalyticsDateRange => {
  const normalizedRange = normalizeRange(range);

  if (isFullCalendarMonth(normalizedRange)) {
    const [year, month] = normalizedRange.start.split('-').map(Number);
    const previousMonthStart = new Date(Date.UTC(year, month - 2, 1));
    const previousMonthEnd = new Date(Date.UTC(year, month - 1, 0));

    return {
      start: fromUtcTimestamp(previousMonthStart.getTime()),
      end: fromUtcTimestamp(previousMonthEnd.getTime())
    };
  }

  const currentStart = toUtcTimestamp(normalizedRange.start);
  const currentEnd = toUtcTimestamp(normalizedRange.end);
  const durationDays = Math.round((currentEnd - currentStart) / DAY_IN_MILLISECONDS) + 1;
  const previousEnd = currentStart - DAY_IN_MILLISECONDS;
  const previousStart = previousEnd - (durationDays - 1) * DAY_IN_MILLISECONDS;

  return {
    start: fromUtcTimestamp(previousStart),
    end: fromUtcTimestamp(previousEnd)
  };
};

const calculateRelativeChange = (current: number, previous: number): number | null =>
  previous === 0 ? null : ((current - previous) / previous) * 100;

export const calculateAnalyticsPeriodComparison = (
  current: AnalyticsSummary,
  previous: AnalyticsSummary
): AnalyticsPeriodComparison => ({
  hasPreviousData: previous.shiftCount > 0,
  salaryPercentChange: calculateRelativeChange(current.workSalary, previous.workSalary),
  salaryAmountChange: Math.round(current.workSalary) - Math.round(previous.workSalary),
  workedMinutesPercentChange: calculateRelativeChange(current.totalMinutes, previous.totalMinutes),
  workedMinutesChange: current.totalMinutes - previous.totalMinutes,
  shiftCountPercentChange: calculateRelativeChange(current.shiftCount, previous.shiftCount),
  shiftCountChange: current.shiftCount - previous.shiftCount,
  completionPercentagePointChange:
    current.production.completionPercent === null || previous.production.completionPercent === null
      ? null
      : current.production.completionPercent - previous.production.completionPercent
});
