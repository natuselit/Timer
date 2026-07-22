import {
  calculateSalaryBreakdown,
  calculateShiftTimeBreakdown,
  calculateTicketProductionSummary,
  COEFFICIENT_VALUES,
  type ISODateTimeString,
  type LocalDateString,
  type Shift,
  type ShiftType
} from '../../../entities/shift';
import {
  calculateGradeMonthlyBonus,
  calculateMonthlySalaryFromHourlyRate
} from '../../../entities/settings';

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
  gradeBonus: number;
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
  production: {
    ticketCount: number;
    filledTicketCount: number;
    unfilledTicketCount: number;
    actualQuantity: number;
    productiveMinutes: number;
    downtimeMinutes: number;
    currentGradeTarget: number;
    completionPercent: number | null;
    averageActualPerTicket: number;
  };
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

  return (shift.baseHourlyRateSnapshot / 60) * overtimeMinutes * coefficient;
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
  const production: AnalyticsSummary['production'] = {
    ticketCount: 0,
    filledTicketCount: 0,
    unfilledTicketCount: 0,
    actualQuantity: 0,
    productiveMinutes: 0,
    downtimeMinutes: 0,
    currentGradeTarget: 0,
    completionPercent: null,
    averageActualPerTicket: 0
  };

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

    shift.workTickets
      .filter((ticket) => ticket.endedAt !== null)
      .forEach((ticket) => {
        production.ticketCount += 1;

        if (ticket.actualQuantity === null || !shift.gradeSnapshot) {
          production.unfilledTicketCount += 1;
          return;
        }

        const ticketSummary = calculateTicketProductionSummary({
          ticket,
          effectiveEndTime: ticket.endedAt!,
          currentGrade: shift.gradeSnapshot.currentGrade,
          gradeNormPercents: shift.gradeSnapshot.gradeNormPercents
        });

        production.filledTicketCount += 1;
        production.actualQuantity += ticket.actualQuantity;
        production.productiveMinutes += ticketSummary.productiveMinutes;
        production.downtimeMinutes += ticketSummary.downtimeMinutes;
        production.currentGradeTarget += ticketSummary.currentTarget;
      });
  });

  const effectiveMonthlyBonus = includeMonthlyBonus ? monthlyBonus : 0;
  const latestGradeShift = [...completedShifts]
    .filter((shift) => shift.gradeSnapshot !== null)
    .sort((left, right) => right.date.localeCompare(left.date))[0];
  const gradeBonus =
    includeMonthlyBonus && latestGradeShift?.gradeSnapshot
      ? calculateGradeMonthlyBonus(
          calculateMonthlySalaryFromHourlyRate(
            latestGradeShift.baseHourlyRateSnapshot,
            latestGradeShift.date
          ),
          latestGradeShift.gradeSnapshot.cumulativeSalaryBonusPercent
        )
      : 0;
  const plannedSalary = workSalary + effectiveMonthlyBonus + gradeBonus;

  production.completionPercent =
    production.currentGradeTarget > 0
      ? (production.actualQuantity / production.currentGradeTarget) * 100
      : null;
  production.averageActualPerTicket =
    production.filledTicketCount > 0
      ? production.actualQuantity / production.filledTicketCount
      : 0;

  return {
    currentSalary: workSalary,
    workSalary,
    plannedSalary,
    monthlyBonus: effectiveMonthlyBonus,
    gradeBonus,
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
    secondShift,
    production
  };
};
