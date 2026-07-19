import {
  calculateSalaryBreakdown,
  calculateShiftTimeBreakdown,
  COEFFICIENT_VALUES,
  type ISODateTimeString,
  type LocalDateString,
  type Shift,
  type ShiftType
} from '../../../entities/shift';

export type ShiftTypeAnalytics = {
  shiftCount: number;
  salaryAmount: number;
  totalMinutes: number;
  overtimeMinutes: number;
};

export type AnalyticsSummary = {
  currentSalary: number;
  workSalary: number;
  plannedSalary: number;
  monthlyBonus: number;
  totalMinutes: number;
  shiftCount: number;
  overtimeMinutes: number;
  overtimeIncome: number;
  averageOvertimeMinutes: number;
  maxOvertimeMinutes: number;
  lateArrivalMinutes: number;
  earlyExitMinutes: number;
  coefficientBreakdown: Array<{
    coefficient: number;
    minutes: number;
    amount: number;
  }>;
  deviations: Array<{
    date: LocalDateString;
    lateArrivalMinutes: number;
    earlyExitMinutes: number;
  }>;
  firstShift: ShiftTypeAnalytics;
  secondShift: ShiftTypeAnalytics;
};

export type CalculateAnalyticsSummaryInput = {
  shifts: Shift[];
  now: ISODateTimeString;
  periodStart: LocalDateString;
  periodEnd: LocalDateString;
  monthlyBonus: number;
  includeMonthlyBonus: boolean;
};

const toLocalDateString = (date: Date): LocalDateString =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;

const createShiftTypeAnalytics = (): ShiftTypeAnalytics => ({
  shiftCount: 0,
  salaryAmount: 0,
  totalMinutes: 0,
  overtimeMinutes: 0
});

const calculateOvertimeIncome = (shift: Shift, overtimeMinutes: number): number => {
  if (shift.coefficientMode === 'auto') {
    const salary = calculateSalaryBreakdown(shift);

    return salary.lines
      .filter((line) => line.key === 'overtime-before' || line.key === 'overtime-after')
      .reduce((total, line) => total + line.amount, 0);
  }

  const coefficient = COEFFICIENT_VALUES[shift.coefficientMode] ?? 1;

  return (shift.hourlyRateSnapshot / 60) * overtimeMinutes * coefficient;
};

export const calculateAnalyticsSummary = ({
  shifts,
  now,
  periodStart,
  periodEnd,
  monthlyBonus,
  includeMonthlyBonus
}: CalculateAnalyticsSummaryInput): AnalyticsSummary => {
  const nowDate = new Date(now);
  const today = toLocalDateString(nowDate);
  const normalizedPeriodStart = periodStart <= periodEnd ? periodStart : periodEnd;
  const normalizedPeriodEnd = periodStart <= periodEnd ? periodEnd : periodStart;

  const completedShifts = shifts
    .filter(
      (shift) =>
        shift.date >= normalizedPeriodStart &&
        shift.date <= normalizedPeriodEnd &&
        shift.date <= today
    )
    .map((shift) => ({
      ...shift,
      endTime: shift.endTime ?? now
    }));

  const firstShift = createShiftTypeAnalytics();
  const secondShift = createShiftTypeAnalytics();

  let workSalary = 0;
  let totalMinutes = 0;
  let overtimeMinutes = 0;
  let overtimeIncome = 0;
  let maxOvertimeMinutes = 0;
  let lateArrivalMinutes = 0;
  let earlyExitMinutes = 0;
  const coefficientBreakdown = new Map<number, { coefficient: number; minutes: number; amount: number }>();
  const deviations: AnalyticsSummary['deviations'] = [];

  completedShifts.forEach((shift) => {
    const salary = calculateSalaryBreakdown(shift);
    const time = calculateShiftTimeBreakdown(shift);
    const typeSummary = shift.type === 'first' ? firstShift : secondShift;

    workSalary += salary.totalAmount;
    totalMinutes += time.actualDurationMinutes;
    overtimeMinutes += time.totalOvertimeMinutes;
    overtimeIncome += calculateOvertimeIncome(shift, time.totalOvertimeMinutes);
    maxOvertimeMinutes = Math.max(maxOvertimeMinutes, time.totalOvertimeMinutes);
    lateArrivalMinutes += time.lateArrivalMinutes;
    earlyExitMinutes += time.earlyExitMinutes;

    salary.lines.forEach((line) => {
      if (line.minutes <= 0) {
        return;
      }

      const current = coefficientBreakdown.get(line.coefficient) ?? {
        coefficient: line.coefficient,
        minutes: 0,
        amount: 0
      };

      current.minutes += line.minutes;
      current.amount += line.amount;
      coefficientBreakdown.set(line.coefficient, current);
    });

    if (time.lateArrivalMinutes > 0 || time.earlyExitMinutes > 0) {
      deviations.push({
        date: shift.date,
        lateArrivalMinutes: time.lateArrivalMinutes,
        earlyExitMinutes: time.earlyExitMinutes
      });
    }

    typeSummary.shiftCount += 1;
    typeSummary.salaryAmount += salary.totalAmount;
    typeSummary.totalMinutes += time.actualDurationMinutes;
    typeSummary.overtimeMinutes += time.totalOvertimeMinutes;
  });

  const effectiveMonthlyBonus = includeMonthlyBonus ? monthlyBonus : 0;
  const plannedSalary = workSalary + effectiveMonthlyBonus;

  return {
    currentSalary: workSalary,
    workSalary,
    plannedSalary,
    monthlyBonus: effectiveMonthlyBonus,
    totalMinutes,
    shiftCount: completedShifts.length,
    overtimeMinutes,
    overtimeIncome,
    averageOvertimeMinutes:
      completedShifts.length > 0 ? overtimeMinutes / completedShifts.length : 0,
    maxOvertimeMinutes,
    lateArrivalMinutes,
    earlyExitMinutes,
    coefficientBreakdown: [...coefficientBreakdown.values()].sort(
      (left, right) => left.coefficient - right.coefficient
    ),
    deviations,
    firstShift,
    secondShift
  };
};
