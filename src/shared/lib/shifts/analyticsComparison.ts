import type { LocalDateString } from '../../../entities/shift';
import type { AnalyticsSummary } from './analyticsSummary';

export type AnalyticsDateRange = {
  start: LocalDateString;
  end: LocalDateString;
};

export type AnalyticsComparisonPreset = 'week' | 'month' | 'twoMonths';

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
  completionPercentChange: number | null;
  completionPercentagePointChange: number | null;
};

const normalizeRange = ({ start, end }: AnalyticsDateRange): AnalyticsDateRange =>
  start <= end ? { start, end } : { start: end, end: start };

const toLocalDateKey = (date: Date): LocalDateString =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;

const shiftByDays = (date: LocalDateString, days: number): LocalDateString => {
  const [year, month, day] = date.split('-').map(Number);
  const shiftedDate = new Date(Date.UTC(year, month - 1, day + days));

  return `${shiftedDate.getUTCFullYear()}-${String(shiftedDate.getUTCMonth() + 1).padStart(
    2,
    '0'
  )}-${String(shiftedDate.getUTCDate()).padStart(2, '0')}`;
};

const shiftByCalendarMonths = (date: LocalDateString, months: number): LocalDateString => {
  const [year, month, day] = date.split('-').map(Number);
  const targetMonth = new Date(Date.UTC(year, month - 1 + months, 1));
  const targetMonthLastDay = new Date(
    Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)
  ).getUTCDate();

  return `${targetMonth.getUTCFullYear()}-${String(
    targetMonth.getUTCMonth() + 1
  ).padStart(2, '0')}-${String(Math.min(day, targetMonthLastDay)).padStart(2, '0')}`;
};

const shiftToComparisonPeriod = (
  date: LocalDateString,
  preset: AnalyticsComparisonPreset
): LocalDateString => {
  if (preset === 'week') {
    return shiftByDays(date, -7);
  }

  return shiftByCalendarMonths(date, preset === 'twoMonths' ? -2 : -1);
};

export const getAnalyticsComparisonRanges = (
  range: AnalyticsDateRange,
  today: LocalDateString = toLocalDateKey(new Date()),
  preset: AnalyticsComparisonPreset = 'month'
): AnalyticsComparisonRanges => {
  const normalizedRange = normalizeRange(range);
  const current =
    normalizedRange.start <= today && today < normalizedRange.end
      ? { ...normalizedRange, end: today }
      : normalizedRange;

  return {
    current,
    previous: {
      start: shiftToComparisonPeriod(current.start, preset),
      end: shiftToComparisonPeriod(current.end, preset)
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
  completionPercentChange:
    current.production.completionPercent === null || previous.production.completionPercent === null
      ? null
      : calculateRelativeChange(
          current.production.completionPercent,
          previous.production.completionPercent
        ),
  completionPercentagePointChange:
    current.production.completionPercent === null || previous.production.completionPercent === null
      ? null
      : current.production.completionPercent - previous.production.completionPercent
});
