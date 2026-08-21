import {
  calculateSalaryBreakdown,
  calculateShiftTimeBreakdown,
  detectShiftType,
  getPlannedShiftWindow,
  type ISODateTimeString,
  type LocalDateString,
  type Shift,
  type ShiftType
} from '../../../entities/shift';
import {
  calculateCumulativeGradePercent,
  calculateGradeMonthlyBonus,
  calculateHourlyRateFromMonthlySalary,
  countWeekdayWorkdaysInMonth,
  DEFAULT_OVERTIME_SATURDAY_MAX_MINUTES,
  DEFAULT_OVERTIME_STEP_MINUTES,
  DEFAULT_OVERTIME_WEEKDAY_MAX_MINUTES,
  isOvertimeDailyMaxMinutes,
  isOvertimeStepMinutes,
  isOvertimeUnavailableDates,
  type Grade,
  type GradePercentSet,
  type OvertimeStrategy
} from '../../../entities/settings';
import { calculateMonthShiftSummary } from './monthSummary';

const MINUTES_PER_SHIFT = 8 * 60;
const MINUTE_IN_MS = 60_000;
const FIRST_SHIFT_MAX_EARLY_START_MINUTES = 30;
const OVERTIME_STRATEGY_SATURDAY_COUNTS: Record<OvertimeStrategy, number> = {
  standard: 2,
  'standard-plus': 3,
  'standard-plus-plus': 4
};

export const OVERTIME_STRATEGY_LABELS: Record<OvertimeStrategy, string> = {
  standard: 'Стандарт',
  'standard-plus': 'Стандарт+',
  'standard-plus-plus': 'Стандарт++'
};

export type OvertimeAllocation = {
  date: LocalDateString;
  kind: 'weekday' | 'saturday';
  minutes: number;
};

export type OvertimeScenario = {
  strategy: OvertimeStrategy;
  allocations: OvertimeAllocation[];
  weekdayMinutes: number;
  saturdayMinutes: number;
  unallocatedMinutes: number;
  projectedIncomeMin: number;
  projectedIncomeMax: number;
};

export type TodayOvertimeRecommendation = {
  date: LocalDateString | null;
  isToday: boolean;
  kind: 'weekday' | 'saturday' | 'rest';
  shiftType: ShiftType;
  minutes: number;
  recommendedStartAt: ISODateTimeString | null;
  recommendedEndAt: ISODateTimeString | null;
  totalMinutes: number;
};

export type MonthlyOvertimePlan = {
  month: string;
  plannedMinutes: number;
  limitMinutes: number;
  usedMinutes: number;
  remainingMinutes: number;
  exceededMinutes: number;
  earnedAmount: number;
  baseSalaryAmount: number;
  overtimeMaximumAmount: number;
  monthlyBonusAmount: number;
  gradeBonusAmount: number;
  coefficientExtraAmount: number;
  maximumAmount: number;
  selectedScenario: OvertimeScenario;
  scenarios: OvertimeScenario[];
  recommendation: TodayOvertimeRecommendation;
};

export type CalculateMonthlyOvertimePlanInput = {
  shifts: Shift[];
  now: ISODateTimeString;
  monthlySalary: number;
  monthlyBonus: number;
  currentGrade: Grade;
  gradeSalaryBonusPercents: GradePercentSet;
  overtimeLimitPercent: number;
  overtimeStepMinutes: number;
  overtimeStrategy: OvertimeStrategy;
  overtimeWeekdayMaxMinutes: number;
  overtimeSaturdayMaxMinutes: number;
  overtimeUnavailableDates: string[];
  preferredShiftType?: ShiftType;
};

type DateCapacity = {
  date: LocalDateString;
  capacityMinutes: number;
};

const calculateManualCoefficientExtraAmount = (
  shift: Shift,
  now: ISODateTimeString
): number => {
  if (shift.coefficientMode === 'auto' || shift.coefficientMode === 'x1') {
    return 0;
  }

  const salary = calculateSalaryBreakdown({
    ...shift,
    endTime: shift.endTime ?? now
  });
  const amountAtX1 = (salary.hourlyRate / 60) * salary.totalMinutes;

  return Math.max(0, salary.totalAmount - amountAtX1);
};

const parseLocalDate = (date: LocalDateString): { year: number; month: number; day: number } => {
  const [year, month, day] = date.split('-').map(Number);

  if (!year || !month || !day) {
    throw new Error(`Invalid local date: ${date}`);
  }

  return { year, month, day };
};

const formatLocalDate = (year: number, month: number, day: number): LocalDateString =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const getWeekday = (date: LocalDateString): number => {
  const { year, month, day } = parseLocalDate(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
};

export const isWeekendDate = (date: LocalDateString): boolean => {
  const weekday = getWeekday(date);
  return weekday === 0 || weekday === 6;
};

const getActualDurationMinutes = (
  shift: Shift,
  now: ISODateTimeString
): number => {
  const endTime = shift.endTime ?? now;

  return Math.max(
    0,
    Math.floor((new Date(endTime).getTime() - new Date(shift.startTime).getTime()) / MINUTE_IN_MS)
  );
};

export const calculateShiftLimitOvertimeMinutes = (
  shift: Shift,
  now: ISODateTimeString
): number => {
  const endTime = shift.endTime ?? now;

  if (isWeekendDate(shift.date)) {
    return getActualDurationMinutes(shift, now);
  }

  return calculateShiftTimeBreakdown({ ...shift, endTime }).totalOvertimeMinutes;
};

const getMonthDates = (year: number, month: number): LocalDateString[] => {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return Array.from({ length: lastDay }, (_, index) => formatLocalDate(year, month, index + 1));
};

const distributeAcrossWeekdays = (
  minutes: number,
  dateCapacities: DateCapacity[],
  stepMinutes: number
): { allocations: OvertimeAllocation[]; unallocatedMinutes: number } => {
  if (minutes <= 0) {
    return { allocations: [], unallocatedMinutes: 0 };
  }

  if (dateCapacities.length === 0) {
    return { allocations: [], unallocatedMinutes: minutes };
  }

  let availableSteps = Math.floor(minutes / stepMinutes);
  const capacitySteps = dateCapacities.map(({ capacityMinutes }) =>
    Math.floor(capacityMinutes / stepMinutes)
  );
  const allocatedSteps = dateCapacities.map(() => 0);
  let madeProgress = true;

  while (availableSteps > 0 && madeProgress) {
    madeProgress = false;

    for (let index = 0; index < dateCapacities.length && availableSteps > 0; index += 1) {
      if (allocatedSteps[index]! >= capacitySteps[index]!) {
        continue;
      }

      allocatedSteps[index]! += 1;
      availableSteps -= 1;
      madeProgress = true;
    }
  }

  const allocations = dateCapacities
    .map(({ date }, index) => ({
      date,
      kind: 'weekday' as const,
      minutes: allocatedSteps[index]! * stepMinutes
    }))
    .filter(({ minutes: allocationMinutes }) => allocationMinutes > 0);
  const allocatedMinutes = allocations.reduce(
    (total, allocation) => total + allocation.minutes,
    0
  );

  return {
    allocations,
    unallocatedMinutes: minutes - allocatedMinutes
  };
};

const allocateSaturdays = (
  minutes: number,
  saturdayCapacities: DateCapacity[],
  maximumSaturdayCount: number,
  stepMinutes: number
): { allocations: OvertimeAllocation[]; remainingMinutes: number } => {
  const allocations: OvertimeAllocation[] = [];
  let remainingMinutes = minutes;

  for (const saturday of saturdayCapacities.slice(0, maximumSaturdayCount)) {
    if (remainingMinutes <= 0) {
      break;
    }

    const allocatedMinutes =
      Math.floor(
        Math.min(remainingMinutes, saturday.capacityMinutes) /
          stepMinutes
      ) * stepMinutes;

    if (allocatedMinutes > 0) {
      allocations.push({
        date: saturday.date,
        kind: 'saturday',
        minutes: allocatedMinutes
      });
      remainingMinutes -= allocatedMinutes;
    }
  }

  return { allocations, remainingMinutes };
};

const createScenario = ({
  strategy,
  remainingMinutes,
  weekdayCapacities,
  saturdayCapacities,
  hourlyRate,
  stepMinutes
}: {
  strategy: OvertimeStrategy;
  remainingMinutes: number;
  weekdayCapacities: DateCapacity[];
  saturdayCapacities: DateCapacity[];
  hourlyRate: number;
  stepMinutes: number;
}): OvertimeScenario => {
  const saturdayResult = allocateSaturdays(
    remainingMinutes,
    saturdayCapacities,
    OVERTIME_STRATEGY_SATURDAY_COUNTS[strategy],
    stepMinutes
  );

  const weekdayResult = distributeAcrossWeekdays(
    saturdayResult.remainingMinutes,
    weekdayCapacities,
    stepMinutes
  );
  const allocations = [...saturdayResult.allocations, ...weekdayResult.allocations].sort(
    (left, right) => left.date.localeCompare(right.date)
  );
  const weekdayMinutes = allocations
    .filter(({ kind }) => kind === 'weekday')
    .reduce((total, allocation) => total + allocation.minutes, 0);
  const saturdayMinutes = allocations
    .filter(({ kind }) => kind === 'saturday')
    .reduce((total, allocation) => total + allocation.minutes, 0);
  const projectedIncomeMin =
    (hourlyRate / 60) *
    (weekdayMinutes * 1.5 + saturdayMinutes * 1.5);
  const projectedIncomeMax = projectedIncomeMin;

  return {
    strategy,
    allocations,
    weekdayMinutes,
    saturdayMinutes,
    unallocatedMinutes: weekdayResult.unallocatedMinutes,
    projectedIncomeMin,
    projectedIncomeMax
  };
};

const addMinutes = (dateTime: ISODateTimeString, minutes: number): ISODateTimeString =>
  new Date(new Date(dateTime).getTime() + minutes * MINUTE_IN_MS).toISOString();

const getRecommendation = (
  scenario: OvertimeScenario,
  today: LocalDateString,
  now: ISODateTimeString,
  activeShift: Shift | null,
  referenceShift: Shift | null,
  preferredShiftType: ShiftType | undefined,
  deferToNextDate: boolean
): TodayOvertimeRecommendation => {
  const shiftType =
    activeShift?.type ?? preferredShiftType ?? referenceShift?.type ?? detectShiftType(now);
  const allocation = scenario.allocations.find(({ date }) =>
    deferToNextDate ? date > today : date >= today
  );

  if (!allocation) {
    return {
      date: null,
      isToday: !deferToNextDate,
      kind: 'rest',
      shiftType,
      minutes: 0,
      recommendedStartAt: null,
      recommendedEndAt: null,
      totalMinutes: 0
    };
  }

  const timeZoneSource = activeShift?.startTime ?? referenceShift?.startTime ?? now;
  const plannedWindow = getPlannedShiftWindow(
    allocation.date,
    shiftType,
    timeZoneSource
  );
  const activeShiftForDate = activeShift?.date === allocation.date ? activeShift : null;

  if (allocation.kind === 'saturday') {
    let recommendedStartAt: ISODateTimeString;
    let recommendedEndAt: ISODateTimeString;

    if (shiftType === 'second') {
      const endFromPlannedStart = addMinutes(plannedWindow.plannedStart, allocation.minutes);

      if (
        new Date(endFromPlannedStart).getTime() <=
        new Date(plannedWindow.plannedEnd).getTime()
      ) {
        recommendedStartAt = plannedWindow.plannedStart;
        recommendedEndAt = endFromPlannedStart;
      } else {
        recommendedEndAt = plannedWindow.plannedEnd;
        recommendedStartAt = addMinutes(recommendedEndAt, -allocation.minutes);
      }
    } else {
      recommendedStartAt =
        activeShiftForDate?.startTime ??
        addMinutes(plannedWindow.plannedStart, -FIRST_SHIFT_MAX_EARLY_START_MINUTES);
      recommendedEndAt = activeShiftForDate
        ? addMinutes(now, allocation.minutes)
        : addMinutes(recommendedStartAt, allocation.minutes);
    }

    return {
      date: allocation.date,
      isToday: allocation.date === today,
      kind: 'saturday',
      shiftType,
      minutes: allocation.minutes,
      recommendedStartAt,
      recommendedEndAt,
      totalMinutes: Math.max(
        0,
        Math.floor(
          (new Date(recommendedEndAt).getTime() -
            new Date(recommendedStartAt).getTime()) /
            MINUTE_IN_MS
        )
      )
    };
  }

  if (shiftType === 'second') {
    const recommendedEndAt = plannedWindow.plannedEnd;
    const recommendedStartAt = addMinutes(
      plannedWindow.plannedStart,
      -allocation.minutes
    );

    return {
      date: allocation.date,
      isToday: allocation.date === today,
      kind: 'weekday',
      shiftType,
      minutes: allocation.minutes,
      recommendedStartAt,
      recommendedEndAt,
      totalMinutes: MINUTES_PER_SHIFT + allocation.minutes
    };
  }

  const recommendationBase =
    activeShiftForDate && new Date(now).getTime() > new Date(plannedWindow.plannedEnd).getTime()
      ? now
      : plannedWindow.plannedEnd;
  const recommendedEarlyStartMinutes =
    !activeShiftForDate && shiftType === 'first'
      ? Math.min(FIRST_SHIFT_MAX_EARLY_START_MINUTES, allocation.minutes)
      : 0;
  const recommendedStartAt = activeShiftForDate?.startTime
    ?? addMinutes(plannedWindow.plannedStart, -recommendedEarlyStartMinutes);
  const recommendedEndAt = addMinutes(
    recommendationBase,
    allocation.minutes - recommendedEarlyStartMinutes
  );

  return {
    date: allocation.date,
    isToday: allocation.date === today,
    kind: 'weekday',
    shiftType,
    minutes: allocation.minutes,
    recommendedStartAt,
    recommendedEndAt,
    totalMinutes: Math.max(
      0,
      Math.floor(
        (new Date(recommendedEndAt).getTime() -
          new Date(recommendedStartAt).getTime()) /
          MINUTE_IN_MS
      )
    )
  };
};

export const calculateMonthlyOvertimePlan = ({
  shifts,
  now,
  monthlySalary,
  monthlyBonus,
  currentGrade,
  gradeSalaryBonusPercents,
  overtimeLimitPercent,
  overtimeStepMinutes,
  overtimeStrategy,
  overtimeWeekdayMaxMinutes,
  overtimeSaturdayMaxMinutes,
  overtimeUnavailableDates,
  preferredShiftType
}: CalculateMonthlyOvertimePlanInput): MonthlyOvertimePlan => {
  const today = now.slice(0, 10);
  const { year, month } = parseLocalDate(today);
  const monthKey = today.slice(0, 7);
  const monthShifts = shifts.filter((shift) => shift.date.slice(0, 7) === monthKey);
  const plannedMinutes = countWeekdayWorkdaysInMonth(year, month) * MINUTES_PER_SHIFT;
  const safeLimitPercent = Math.min(100, Math.max(0, overtimeLimitPercent));
  const safeStepMinutes = isOvertimeStepMinutes(overtimeStepMinutes)
    ? overtimeStepMinutes
    : DEFAULT_OVERTIME_STEP_MINUTES;
  const safeWeekdayMaxMinutes = isOvertimeDailyMaxMinutes(overtimeWeekdayMaxMinutes)
    ? overtimeWeekdayMaxMinutes
    : DEFAULT_OVERTIME_WEEKDAY_MAX_MINUTES;
  const safeSaturdayMaxMinutes = isOvertimeDailyMaxMinutes(overtimeSaturdayMaxMinutes)
    ? overtimeSaturdayMaxMinutes
    : DEFAULT_OVERTIME_SATURDAY_MAX_MINUTES;
  const unavailableDates = new Set(
    isOvertimeUnavailableDates(overtimeUnavailableDates)
      ? overtimeUnavailableDates
      : []
  );
  const baseSalaryAmount = Math.max(0, monthlySalary);
  const limitMinutes = Math.floor(plannedMinutes * (safeLimitPercent / 100));
  const usedMinutes = monthShifts.reduce(
    (total, shift) => total + calculateShiftLimitOvertimeMinutes(shift, now),
    0
  );
  const remainingMinutes = Math.max(0, limitMinutes - usedMinutes);
  const exceededMinutes = Math.max(0, usedMinutes - limitMinutes);
  const shiftsByDate = new Map(monthShifts.map((shift) => [shift.date, shift]));
  const activeShift = monthShifts.find((shift) => shift.endTime === null) ?? null;
  const todayShift = shiftsByDate.get(today);
  const referenceShift =
    activeShift ??
    todayShift ??
    [...monthShifts]
      .filter((shift) => shift.date < today)
      .sort((left, right) => right.date.localeCompare(left.date))[0] ??
    null;
  const availableDates = getMonthDates(year, month).filter((date) => {
    if (date < today || unavailableDates.has(date)) {
      return false;
    }

    const shift = shiftsByDate.get(date);
    return (
      !shift ||
      (shift.endTime === null && !(shift.type === 'second' && shift.date === today))
    );
  });
  const weekdayCapacities = availableDates
    .filter((date) => {
      const weekday = getWeekday(date);
      return weekday >= 1 && weekday <= 5;
    })
    .map((date) => {
      const shift = shiftsByDate.get(date);
      const alreadyWorkedMinutes = shift
        ? calculateShiftLimitOvertimeMinutes(shift, now)
        : 0;

      return {
        date,
        capacityMinutes: Math.max(0, safeWeekdayMaxMinutes - alreadyWorkedMinutes)
      };
    })
    .filter(({ capacityMinutes }) => capacityMinutes > 0);
  const saturdayCapacities = availableDates
    .filter((date) => getWeekday(date) === 6)
    .map((date) => {
      const shift = shiftsByDate.get(date);
      const alreadyWorkedMinutes = shift ? getActualDurationMinutes(shift, now) : 0;

      return {
        date,
        capacityMinutes: Math.max(0, safeSaturdayMaxMinutes - alreadyWorkedMinutes)
      };
    })
    .filter(({ capacityMinutes }) => capacityMinutes > 0);
  const hourlyRate = calculateHourlyRateFromMonthlySalary(baseSalaryAmount, today);
  const earnedAmount = calculateMonthShiftSummary(monthShifts, now).totalAmount;
  const overtimeMaximumAmount = (hourlyRate / 60) * limitMinutes * 1.5;
  const monthlyBonusAmount = Math.max(0, monthlyBonus);
  const gradeBonusAmount = calculateGradeMonthlyBonus(
    baseSalaryAmount,
    calculateCumulativeGradePercent(currentGrade, gradeSalaryBonusPercents)
  );
  const coefficientExtraAmount = monthShifts.reduce(
    (total, shift) => total + calculateManualCoefficientExtraAmount(shift, now),
    0
  );
  const maximumAmount =
    baseSalaryAmount +
    overtimeMaximumAmount +
    monthlyBonusAmount +
    gradeBonusAmount +
    coefficientExtraAmount;
  const strategies: OvertimeStrategy[] = [
    'standard',
    'standard-plus',
    'standard-plus-plus'
  ];
  const scenarios = strategies.map((strategy) =>
    createScenario({
      strategy,
      remainingMinutes,
      weekdayCapacities,
      saturdayCapacities,
      hourlyRate,
      stepMinutes: safeStepMinutes
    })
  );
  const selectedScenario =
    scenarios.find(({ strategy }) => strategy === overtimeStrategy) ?? scenarios[0]!;

  return {
    month: monthKey,
    plannedMinutes,
    limitMinutes,
    usedMinutes,
    remainingMinutes,
    exceededMinutes,
    earnedAmount,
    baseSalaryAmount,
    overtimeMaximumAmount,
    monthlyBonusAmount,
    gradeBonusAmount,
    coefficientExtraAmount,
    maximumAmount,
    selectedScenario,
    scenarios,
    recommendation: getRecommendation(
      selectedScenario,
      today,
      now,
      activeShift,
      referenceShift,
      preferredShiftType,
      Boolean(todayShift?.endTime)
    )
  };
};
