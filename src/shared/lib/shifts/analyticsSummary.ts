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
  averageSalaryPerShift: number;
  effectiveHourlyIncome: number;
  totalMinutes: number;
  shiftCount: number;
  averageShiftMinutes: number;
  overtimeMinutes: number;
  overtimeIncome: number;
  averageOvertimeMinutes: number;
  maxOvertimeMinutes: number;
  lateArrivalMinutes: number;
  earlyExitMinutes: number;
  lateArrivalShiftCount: number;
  earlyExitShiftCount: number;
  onScheduleShiftCount: number;
  averageLateArrivalMinutes: number;
  averageEarlyExitMinutes: number;
  scheduleAdherencePercent: number | null;
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
    averageTicketsPerShift: number;
    quantityPerProductiveHour: number | null;
    averageProductiveMinutesPerTicket: number;
    averageDowntimeMinutesPerTicket: number;
    downtimePercent: number | null;
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
  let lateArrivalShiftCount = 0;
  let earlyExitShiftCount = 0;
  let onScheduleShiftCount = 0;
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
    averageActualPerTicket: 0,
    averageTicketsPerShift: 0,
    quantityPerProductiveHour: null,
    averageProductiveMinutesPerTicket: 0,
    averageDowntimeMinutesPerTicket: 0,
    downtimePercent: null
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

    if (time.lateArrivalMinutes > 0) {
      lateArrivalShiftCount += 1;
    }

    if (time.earlyExitMinutes > 0) {
      earlyExitShiftCount += 1;
    }

    if (time.lateArrivalMinutes === 0 && time.earlyExitMinutes === 0) {
      onScheduleShiftCount += 1;
    }

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
  production.averageTicketsPerShift =
    completedShifts.length > 0
      ? production.ticketCount / completedShifts.length
      : 0;
  production.quantityPerProductiveHour =
    production.productiveMinutes > 0
      ? (production.actualQuantity * 60) / production.productiveMinutes
      : null;
  production.averageProductiveMinutesPerTicket =
    production.filledTicketCount > 0
      ? production.productiveMinutes / production.filledTicketCount
      : 0;
  production.averageDowntimeMinutesPerTicket =
    production.filledTicketCount > 0
      ? production.downtimeMinutes / production.filledTicketCount
      : 0;
  production.downtimePercent =
    production.productiveMinutes + production.downtimeMinutes > 0
      ? (production.downtimeMinutes /
          (production.productiveMinutes + production.downtimeMinutes)) *
        100
      : null;

  const shiftCount = completedShifts.length;

  return {
    currentSalary: workSalary,
    workSalary,
    plannedSalary,
    monthlyBonus: effectiveMonthlyBonus,
    gradeBonus,
    averageSalaryPerShift: shiftCount > 0 ? workSalary / shiftCount : 0,
    effectiveHourlyIncome: totalMinutes > 0 ? (workSalary * 60) / totalMinutes : 0,
    totalMinutes,
    shiftCount,
    averageShiftMinutes: shiftCount > 0 ? totalMinutes / shiftCount : 0,
    overtimeMinutes,
    overtimeIncome,
    averageOvertimeMinutes:
      completedShifts.length > 0 ? overtimeMinutes / completedShifts.length : 0,
    maxOvertimeMinutes,
    lateArrivalMinutes,
    earlyExitMinutes,
    lateArrivalShiftCount,
    earlyExitShiftCount,
    onScheduleShiftCount,
    averageLateArrivalMinutes:
      lateArrivalShiftCount > 0 ? lateArrivalMinutes / lateArrivalShiftCount : 0,
    averageEarlyExitMinutes:
      earlyExitShiftCount > 0 ? earlyExitMinutes / earlyExitShiftCount : 0,
    scheduleAdherencePercent:
      shiftCount > 0 ? (onScheduleShiftCount / shiftCount) * 100 : null,
    coefficientBreakdown: [...coefficientBreakdown.values()].sort(
      (left, right) => left.coefficient - right.coefficient
    ),
    deviations,
    firstShift,
    secondShift,
    production
  };
};
