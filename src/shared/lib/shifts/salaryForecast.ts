import type { EnterpriseScheduleItem } from '../../../entities/enterprise-schedule';
import {
  calculateSalaryBreakdown,
  type ISODateTimeString,
  type Shift
} from '../../../entities/shift';
import {
  calculateCumulativeGradePercent,
  calculateGradeMonthlyBonus,
  type Settings
} from '../../../entities/settings';

export const SALARY_FORECAST_SHIFT_THRESHOLD = 31;

export type SalaryForecast = {
  eligible: boolean;
  completedShiftCount: number;
  requiredShiftCount: number;
  historicalAverage: number;
  futureShiftCount: number;
  futureSource: 'enterprise-schedule' | 'weekdays';
  earnedThisMonth: number;
  activeShiftAmount: number;
  futureAmount: number;
  fixedBonus: number;
  gradeBonus: number;
  totalAmount: number | null;
};

const toLocalDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;

const getCurrentMonthRange = (now: Date): { start: string; end: string } => ({
  start: toLocalDate(new Date(now.getFullYear(), now.getMonth(), 1)),
  end: toLocalDate(new Date(now.getFullYear(), now.getMonth() + 1, 0))
});

const getWeekdayDates = (startExclusive: string, endInclusive: string): string[] => {
  const [year, month, day] = startExclusive.split('-').map(Number);
  const end = new Date(`${endInclusive}T23:59:59`);
  const current = new Date(year, month - 1, day + 1);
  const dates: string[] = [];

  while (current <= end) {
    const weekday = current.getDay();

    if (weekday >= 1 && weekday <= 5) {
      dates.push(toLocalDate(current));
    }

    current.setDate(current.getDate() + 1);
  }

  return dates;
};

export const calculateSalaryForecast = ({
  shifts,
  enterpriseSchedule,
  settings,
  now
}: {
  shifts: Shift[];
  enterpriseSchedule: EnterpriseScheduleItem[];
  settings: Pick<
    Settings,
    | 'monthlySalary'
    | 'monthlyBonus'
    | 'currentGrade'
    | 'gradeSalaryBonusPercents'
  >;
  now: ISODateTimeString;
}): SalaryForecast => {
  const nowDate = new Date(now);
  const today = toLocalDate(nowDate);
  const month = getCurrentMonthRange(nowDate);
  const completed = shifts
    .filter((shift) => shift.endTime !== null && shift.date <= today)
    .sort((left, right) =>
      (right.endTime ?? right.startTime).localeCompare(left.endTime ?? left.startTime)
    );
  const sample = completed.slice(0, SALARY_FORECAST_SHIFT_THRESHOLD);
  const historicalAverage =
    sample.length === SALARY_FORECAST_SHIFT_THRESHOLD
      ? sample.reduce(
          (total, shift) => total + calculateSalaryBreakdown(shift).totalAmount,
          0
        ) / SALARY_FORECAST_SHIFT_THRESHOLD
      : 0;
  const monthShifts = shifts.filter(
    (shift) => shift.date >= month.start && shift.date <= month.end
  );
  const earnedThisMonth = monthShifts
    .filter((shift) => shift.endTime !== null)
    .reduce((total, shift) => total + calculateSalaryBreakdown(shift).totalAmount, 0);
  const activeShift = monthShifts.find((shift) => shift.endTime === null);
  const activeShiftAmount = activeShift
    ? calculateSalaryBreakdown({ ...activeShift, endTime: now }).totalAmount
    : 0;
  const occupiedDates = new Set(monthShifts.map((shift) => shift.date));
  const scheduleDates = [
    ...new Set(
      enterpriseSchedule
        .filter(
          (item) =>
            item.date > today &&
            item.date <= month.end &&
            !occupiedDates.has(item.date)
        )
        .map((item) => item.date)
    )
  ];
  const futureSource =
    scheduleDates.length > 0 ? 'enterprise-schedule' : 'weekdays';
  const futureDates =
    scheduleDates.length > 0
      ? scheduleDates
      : getWeekdayDates(today, month.end).filter((date) => !occupiedDates.has(date));
  const eligible = completed.length >= SALARY_FORECAST_SHIFT_THRESHOLD;
  const futureAmount = eligible ? historicalAverage * futureDates.length : 0;
  const fixedBonus = settings.monthlyBonus;
  const gradeBonus = calculateGradeMonthlyBonus(
    settings.monthlySalary,
    calculateCumulativeGradePercent(
      settings.currentGrade,
      settings.gradeSalaryBonusPercents
    )
  );

  return {
    eligible,
    completedShiftCount: completed.length,
    requiredShiftCount: SALARY_FORECAST_SHIFT_THRESHOLD,
    historicalAverage,
    futureShiftCount: futureDates.length,
    futureSource,
    earnedThisMonth,
    activeShiftAmount,
    futureAmount,
    fixedBonus,
    gradeBonus,
    totalAmount:
      eligible
        ? earnedThisMonth +
          activeShiftAmount +
          futureAmount +
          fixedBonus +
          gradeBonus
        : null
  };
};
