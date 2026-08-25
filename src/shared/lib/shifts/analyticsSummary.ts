import {
  calculateSalaryBreakdown,
  calculateShiftTimeBreakdown,
  calculateTicketProductionSummary,
  COEFFICIENT_VALUES,
  type ISODateTimeString,
  type LocalDateString,
  type Shift
} from '../../../entities/shift';
import {
  calculateGradeMonthlyBonus,
  calculateMonthlySalaryFromHourlyRate
} from '../../../entities/settings';
import { calculateScheduleControlSummary } from './scheduleControl';

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
  completedShiftCount: number;
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
    gradeOneTarget: number;
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
  fallbackGradeBonusSnapshot?: {
    monthlySalarySnapshot: number;
    cumulativeSalaryBonusPercent: number;
  };
};

const toLocalDateString = (date: Date): LocalDateString =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;

const isWeekendDate = (date: LocalDateString): boolean => {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return weekday === 0 || weekday === 6;
};

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
      .filter((line) => line.coefficient === 1.5)
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
  includeMonthlyBonus,
  fallbackGradeBonusSnapshot
}: CalculateAnalyticsSummaryInput): AnalyticsSummary => {
  const nowDate = new Date(now);
  const today = toLocalDateString(nowDate);
  const normalizedPeriodStart = periodStart <= periodEnd ? periodStart : periodEnd;
  const normalizedPeriodEnd = periodStart <= periodEnd ? periodEnd : periodStart;

  const periodShifts = shifts.filter(
    (shift) =>
      shift.date >= normalizedPeriodStart &&
      shift.date <= normalizedPeriodEnd &&
      shift.date <= today
  );
  const scheduleControl = calculateScheduleControlSummary(periodShifts);
  const completedShifts = periodShifts
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
  const coefficientBreakdown = new Map<number, { coefficient: number; minutes: number; amount: number }>();
  const production: AnalyticsSummary['production'] = {
    ticketCount: 0,
    filledTicketCount: 0,
    unfilledTicketCount: 0,
    actualQuantity: 0,
    productiveMinutes: 0,
    downtimeMinutes: 0,
    gradeOneTarget: 0,
    currentGradeTarget: 0,
    completionPercent: null,
    averageActualPerTicket: 0,
    averageTicketsPerShift: 0,
    quantityPerProductiveHour: null,
    averageProductiveMinutesPerTicket: 0,
    averageDowntimeMinutesPerTicket: 0,
    downtimePercent: null
  };
  let gradeOneTarget = 0;
  let completionEquivalentQuantity = 0;

  completedShifts.forEach((shift) => {
    const salary = calculateSalaryBreakdown(shift);
    const time = calculateShiftTimeBreakdown(shift);
    const shiftOvertimeMinutes =
      shift.coefficientMode === 'auto' && isWeekendDate(shift.date)
        ? time.actualDurationMinutes
        : time.totalOvertimeMinutes;
    const typeSummary = shift.type === 'first' ? firstShift : secondShift;

    workSalary += salary.totalAmount;
    totalMinutes += time.actualDurationMinutes;
    overtimeMinutes += shiftOvertimeMinutes;
    overtimeIncome += calculateOvertimeIncome(shift, shiftOvertimeMinutes);
    maxOvertimeMinutes = Math.max(maxOvertimeMinutes, shiftOvertimeMinutes);
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

    typeSummary.shiftCount += 1;
    typeSummary.salaryAmount += salary.totalAmount;
    typeSummary.totalMinutes += time.actualDurationMinutes;
    typeSummary.overtimeMinutes += shiftOvertimeMinutes;

    shift.workTickets
      .filter((ticket) => ticket.endedAt !== null)
      .forEach((ticket) => {
        production.ticketCount += 1;

        if (!shift.gradeSnapshot) {
          production.unfilledTicketCount += 1;
          return;
        }

        const ticketSummary = calculateTicketProductionSummary({
          ticket,
          effectiveEndTime: ticket.endedAt!,
          currentGrade: shift.gradeSnapshot.currentGrade,
          gradeNormPercents: shift.gradeSnapshot.gradeNormPercents
        });
        const ticketGradeOneTarget = ticketSummary.targets[0]?.quantity ?? 0;

        if (ticketSummary.completionPercent !== null && ticketGradeOneTarget > 0) {
          gradeOneTarget += ticketGradeOneTarget;
          completionEquivalentQuantity +=
            ticketGradeOneTarget * (ticketSummary.completionPercent / 100);
        }

        if (ticket.actualQuantity === null) {
          production.unfilledTicketCount += 1;
          return;
        }

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
  const gradeBonusSnapshot = latestGradeShift?.gradeSnapshot
    ? {
        monthlySalarySnapshot: calculateMonthlySalaryFromHourlyRate(
          latestGradeShift.baseHourlyRateSnapshot,
          latestGradeShift.date
        ),
        cumulativeSalaryBonusPercent:
          latestGradeShift.gradeSnapshot.cumulativeSalaryBonusPercent
      }
    : fallbackGradeBonusSnapshot;
  const gradeBonus =
    includeMonthlyBonus && gradeBonusSnapshot
      ? calculateGradeMonthlyBonus(
          gradeBonusSnapshot.monthlySalarySnapshot,
          gradeBonusSnapshot.cumulativeSalaryBonusPercent
        )
      : 0;
  const plannedSalary = workSalary + effectiveMonthlyBonus + gradeBonus;

  production.completionPercent =
    gradeOneTarget > 0
      ? (completionEquivalentQuantity / gradeOneTarget) * 100
      : null;
  production.gradeOneTarget = gradeOneTarget;
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
    completedShiftCount: scheduleControl.completedShiftCount,
    averageShiftMinutes: shiftCount > 0 ? totalMinutes / shiftCount : 0,
    overtimeMinutes,
    overtimeIncome,
    averageOvertimeMinutes:
      completedShifts.length > 0 ? overtimeMinutes / completedShifts.length : 0,
    maxOvertimeMinutes,
    lateArrivalMinutes: scheduleControl.lateArrivalMinutes,
    earlyExitMinutes: scheduleControl.earlyExitMinutes,
    lateArrivalShiftCount: scheduleControl.lateArrivalShiftCount,
    earlyExitShiftCount: scheduleControl.earlyExitShiftCount,
    onScheduleShiftCount: scheduleControl.onScheduleShiftCount,
    averageLateArrivalMinutes: scheduleControl.averageLateArrivalMinutes,
    averageEarlyExitMinutes: scheduleControl.averageEarlyExitMinutes,
    scheduleAdherencePercent: scheduleControl.scheduleAdherencePercent,
    coefficientBreakdown: [...coefficientBreakdown.values()].sort(
      (left, right) => left.coefficient - right.coefficient
    ),
    deviations: scheduleControl.warnings.map((warning) => ({
      date: warning.date,
      lateArrivalMinutes: warning.lateArrivalMinutes,
      earlyExitMinutes: warning.earlyExitMinutes
    })),
    firstShift,
    secondShift,
    production
  };
};
