import {
  calculateShiftTimeBreakdown,
  detectShiftType,
  getPlannedShiftWindow,
  type ISODateTimeString,
  type LocalDateString,
  type Shift
} from '../../../entities/shift';
import {
  calculateHourlyRateFromMonthlySalary,
  countWeekdayWorkdaysInMonth,
  DEFAULT_OVERTIME_SATURDAY_MAX_MINUTES,
  DEFAULT_OVERTIME_STEP_MINUTES,
  DEFAULT_OVERTIME_WEEKDAY_MAX_MINUTES,
  isOvertimeDailyMaxMinutes,
  isOvertimeStepMinutes,
  type OvertimeStrategy
} from '../../../entities/settings';

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
  selectedScenario: OvertimeScenario;
  scenarios: OvertimeScenario[];
  recommendation: TodayOvertimeRecommendation;
};

export type CalculateMonthlyOvertimePlanInput = {
  shifts: Shift[];
  now: ISODateTimeString;
  monthlySalary: number;
  overtimeLimitPercent: number;
  overtimeStepMinutes: number;
  overtimeStrategy: OvertimeStrategy;
  overtimeWeekdayMaxMinutes: number;
  overtimeSaturdayMaxMinutes: number;
};

type DateCapacity = {
  date: LocalDateString;
  capacityMinutes: number;
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
  deferToNextDate: boolean
): TodayOvertimeRecommendation => {
  const allocation = scenario.allocations.find(({ date }) =>
    deferToNextDate ? date > today : date >= today
  );

  if (!allocation) {
    return {
      date: null,
      isToday: !deferToNextDate,
      kind: 'rest',
      minutes: 0,
      recommendedStartAt: null,
      recommendedEndAt: null,
      totalMinutes: 0
    };
  }

  const shiftType = activeShift?.type ?? referenceShift?.type ?? detectShiftType(now);
  const timeZoneSource = activeShift?.startTime ?? referenceShift?.startTime ?? now;
  const plannedWindow = getPlannedShiftWindow(
    allocation.date,
    shiftType,
    timeZoneSource
  );

  if (allocation.kind === 'saturday') {
    const recommendedStartAt = activeShift?.startTime
      ?? (shiftType === 'first'
        ? addMinutes(plannedWindow.plannedStart, -FIRST_SHIFT_MAX_EARLY_START_MINUTES)
        : plannedWindow.plannedStart);
    const recommendedEndAt = activeShift
      ? addMinutes(now, allocation.minutes)
      : addMinutes(recommendedStartAt, allocation.minutes);

    return {
      date: allocation.date,
      isToday: allocation.date === today,
      kind: 'saturday',
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

  const recommendationBase =
    activeShift && new Date(now).getTime() > new Date(plannedWindow.plannedEnd).getTime()
      ? now
      : plannedWindow.plannedEnd;
  const recommendedEarlyStartMinutes =
    !activeShift && shiftType === 'first'
      ? Math.min(FIRST_SHIFT_MAX_EARLY_START_MINUTES, allocation.minutes)
      : 0;
  const recommendedStartAt = activeShift?.startTime
    ?? addMinutes(plannedWindow.plannedStart, -recommendedEarlyStartMinutes);
  const recommendedEndAt = addMinutes(
    recommendationBase,
    allocation.minutes - recommendedEarlyStartMinutes
  );

  return {
    date: allocation.date,
    isToday: allocation.date === today,
    kind: 'weekday',
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
  overtimeLimitPercent,
  overtimeStepMinutes,
  overtimeStrategy,
  overtimeWeekdayMaxMinutes,
  overtimeSaturdayMaxMinutes
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
    if (date < today) {
      return false;
    }

    const shift = shiftsByDate.get(date);
    return !shift || shift.endTime === null;
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
  const hourlyRate = calculateHourlyRateFromMonthlySalary(monthlySalary, today);
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
    selectedScenario,
    scenarios,
    recommendation: getRecommendation(
      selectedScenario,
      today,
      now,
      activeShift,
      referenceShift,
      Boolean(todayShift?.endTime)
    )
  };
};
