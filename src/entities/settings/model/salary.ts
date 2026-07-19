import type { LocalDateString } from '../../shift';
import type { GradeSnapshot } from '../../shift';
import type { Grade, GradePercentSet, Settings } from './types';

export const WORK_HOURS_PER_DAY = 8;
export const WORK_MINUTES_PER_DAY = WORK_HOURS_PER_DAY * 60;

const getMonthParts = (date: LocalDateString): { year: number; month: number } => {
  const [year, month] = date.slice(0, 10).split('-').map(Number);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid local date: ${date}`);
  }

  return { year, month };
};

export const countWeekdayWorkdaysInMonth = (year: number, month: number): number => {
  const lastDay = new Date(year, month, 0).getDate();
  let workdays = 0;

  for (let day = 1; day <= lastDay; day += 1) {
    const weekday = new Date(year, month - 1, day).getDay();

    if (weekday >= 1 && weekday <= 5) {
      workdays += 1;
    }
  }

  return workdays;
};

export const calculateHourlyRateFromMonthlySalary = (
  monthlySalary: number,
  date: LocalDateString
): number => {
  const { year, month } = getMonthParts(date);
  const workdays = countWeekdayWorkdaysInMonth(year, month);

  return monthlySalary / workdays / WORK_HOURS_PER_DAY;
};

export const calculateMonthlySalaryFromHourlyRate = (
  hourlyRate: number,
  date: LocalDateString
): number => {
  const { year, month } = getMonthParts(date);
  const workdays = countWeekdayWorkdaysInMonth(year, month);

  return hourlyRate * workdays * WORK_HOURS_PER_DAY;
};

export const getGradeIndex = (grade: Grade): number => grade - 1;

export const getNextDesiredGrade = (currentGrade: Grade): Grade =>
  currentGrade === 4 ? 4 : ((currentGrade + 1) as Grade);

export const calculateCumulativeGradePercent = (
  grade: Grade,
  percents: GradePercentSet
): number =>
  percents
    .slice(0, grade)
    .reduce((total, percent) => total + percent, 0);

export const calculateEffectiveHourlyRate = (
  baseHourlyRate: number,
  cumulativeGradePercent: number
): number => baseHourlyRate * (1 + cumulativeGradePercent / 100);

export const calculateGradeHourlyRateFromMonthlySalary = (
  monthlySalary: number,
  date: LocalDateString,
  settings: Pick<Settings, 'currentGrade' | 'gradeSalaryBonusPercents'>
): {
  baseHourlyRate: number;
  effectiveHourlyRate: number;
  cumulativeSalaryBonusPercent: number;
} => {
  const baseHourlyRate = calculateHourlyRateFromMonthlySalary(monthlySalary, date);
  const cumulativeSalaryBonusPercent = calculateCumulativeGradePercent(
    settings.currentGrade,
    settings.gradeSalaryBonusPercents
  );

  return {
    baseHourlyRate,
    effectiveHourlyRate: calculateEffectiveHourlyRate(
      baseHourlyRate,
      cumulativeSalaryBonusPercent
    ),
    cumulativeSalaryBonusPercent
  };
};

export const createGradeSnapshot = (
  settings: Pick<
    Settings,
    'currentGrade' | 'desiredGrade' | 'gradeSalaryBonusPercents' | 'gradeNormPercents'
  >
): GradeSnapshot => ({
  currentGrade: settings.currentGrade,
  desiredGrade: settings.desiredGrade,
  gradeSalaryBonusPercents: [...settings.gradeSalaryBonusPercents] as GradePercentSet,
  gradeNormPercents: [...settings.gradeNormPercents] as GradePercentSet,
  cumulativeSalaryBonusPercent: calculateCumulativeGradePercent(
    settings.currentGrade,
    settings.gradeSalaryBonusPercents
  )
});

export const calculateGradeProductionTarget = ({
  normPerEightHours,
  gradeNormPercent,
  elapsedMinutes
}: {
  normPerEightHours: number;
  gradeNormPercent: number;
  elapsedMinutes: number;
}): number =>
  Math.max(0, normPerEightHours) *
  (Math.max(0, gradeNormPercent) / 100) *
  (Math.max(0, elapsedMinutes) / WORK_MINUTES_PER_DAY);

export const formatProductionTarget = (value: number): number => Math.ceil(Math.max(0, value));
