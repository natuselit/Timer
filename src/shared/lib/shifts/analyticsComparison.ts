import type { LocalDateString } from '../../../entities/shift';
import type { AnalyticsSummary } from './analyticsSummary';

export type AnalyticsDateRange = {
  start: LocalDateString;
  end: LocalDateString;
};

export type AnalyticsComparisonRanges = {
  current: AnalyticsDateRange;
  previous: AnalyticsDateRange;
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

const normalizeRange = ({ start, end }: AnalyticsDateRange): AnalyticsDateRange =>
  start <= end ? { start, end } : { start: end, end: start };

const toLocalDateKey = (date: Date): LocalDateString =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;

const shiftToPreviousCalendarMonth = (date: LocalDateString): LocalDateString => {
  const [year, month, day] = date.split('-').map(Number);
  const previousMonth = new Date(Date.UTC(year, month - 2, 1));
  const previousMonthLastDay = new Date(
    Date.UTC(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1, 0)
  ).getUTCDate();

  return `${previousMonth.getUTCFullYear()}-${String(
    previousMonth.getUTCMonth() + 1
  ).padStart(2, '0')}-${String(Math.min(day, previousMonthLastDay)).padStart(2, '0')}`;
};

export const getAnalyticsComparisonRanges = (
  range: AnalyticsDateRange,
  today: LocalDateString = toLocalDateKey(new Date())
): AnalyticsComparisonRanges => {
  const normalizedRange = normalizeRange(range);
  const current =
    normalizedRange.start <= today && today < normalizedRange.end
      ? { ...normalizedRange, end: today }
      : normalizedRange;

  return {
    current,
    previous: {
      start: shiftToPreviousCalendarMonth(current.start),
      end: shiftToPreviousCalendarMonth(current.end)
    }
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
