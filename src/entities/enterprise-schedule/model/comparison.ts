import {
  calculateSalaryBreakdown,
  getPlannedShiftWindow,
  type ISODateTimeString,
  type Shift
} from '../../shift';
import type { EnterpriseScheduleItem } from './types';

export type EnterpriseScheduleDiscrepancy = {
  id: string;
  date: string;
  shiftId: string;
  scheduleId: string;
  actualStartTime: ISODateTimeString;
  actualEndTime: ISODateTimeString;
  enterpriseStartTime: ISODateTimeString;
  enterpriseEndTime: ISODateTimeString;
  actualDurationMinutes: number;
  enterpriseDurationMinutes: number;
  durationDifferenceMinutes: number;
  actualSalaryAmount: number;
  enterpriseSalaryAmount: number;
  salaryDifferenceAmount: number;
};

export type EnterpriseScheduleComparisonSummary = {
  discrepancies: EnterpriseScheduleDiscrepancy[];
};

const MONEY_EPSILON = 0.005;
const MINUTE_IN_MS = 60_000;

const padTimePart = (value: number): string => String(value).padStart(2, '0');

const getTimeZoneSuffix = (date: Date): string => {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);

  return `${sign}${padTimePart(Math.floor(absoluteOffset / 60))}:${padTimePart(absoluteOffset % 60)}`;
};

const toLocalIsoString = (date: Date): ISODateTimeString =>
  `${date.getFullYear()}-${padTimePart(date.getMonth() + 1)}-${padTimePart(date.getDate())}T${padTimePart(
    date.getHours()
  )}:${padTimePart(date.getMinutes())}:00.000${getTimeZoneSuffix(date)}`;

const combineLocalDateAndTime = (date: string, time: string): ISODateTimeString => {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);

  return toLocalIsoString(new Date(year, month - 1, day, hours, minutes, 0, 0));
};

const getDurationMinutes = (startTime: ISODateTimeString, endTime: ISODateTimeString): number =>
  Math.max(0, Math.floor((new Date(endTime).getTime() - new Date(startTime).getTime()) / MINUTE_IN_MS));

const getEnterpriseStartTime = (scheduleItem: EnterpriseScheduleItem): string =>
  scheduleItem.enterpriseStartTime ?? scheduleItem.plannedStartTime;

const getEnterpriseEndTime = (scheduleItem: EnterpriseScheduleItem): string =>
  scheduleItem.enterpriseEndTime ?? scheduleItem.plannedEndTime;

const createEnterpriseShift = (scheduleItem: EnterpriseScheduleItem, shift: Shift): Shift => {
  const startTime = combineLocalDateAndTime(scheduleItem.date, getEnterpriseStartTime(scheduleItem));
  const endTime = combineLocalDateAndTime(scheduleItem.date, getEnterpriseEndTime(scheduleItem));
  const plannedWindow = getPlannedShiftWindow(scheduleItem.date, scheduleItem.shiftType, startTime);

  return {
    ...shift,
    date: scheduleItem.date,
    type: scheduleItem.shiftType,
    plannedStartTime: plannedWindow.startTime,
    plannedEndTime: plannedWindow.endTime,
    startTime,
    endTime,
    isAutoClosed: false
  };
};

const hasTimeMismatch = (
  shift: Pick<Shift, 'startTime' | 'endTime'>,
  enterpriseStartTime: ISODateTimeString,
  enterpriseEndTime: ISODateTimeString
): boolean => shift.startTime !== enterpriseStartTime || shift.endTime !== enterpriseEndTime;

export const calculateEnterpriseScheduleComparison = (
  scheduleItems: EnterpriseScheduleItem[],
  shifts: Shift[]
): EnterpriseScheduleComparisonSummary => {
  const shiftsByDate = new Map(shifts.map((shift) => [shift.date, shift]));
  const discrepancies: EnterpriseScheduleDiscrepancy[] = [];

  scheduleItems.forEach((scheduleItem) => {
    if (scheduleItem.skipped) {
      return;
    }

    const shift = shiftsByDate.get(scheduleItem.date);

    if (!shift?.endTime) {
      return;
    }

    const actualEndTime = shift.endTime;
    const enterpriseShift = createEnterpriseShift(scheduleItem, shift);
    const enterpriseEndTime = enterpriseShift.endTime;

    if (!enterpriseEndTime) {
      return;
    }

    const actualSalary = calculateSalaryBreakdown(shift).totalAmount;
    const enterpriseSalary = calculateSalaryBreakdown(enterpriseShift).totalAmount;
    const actualDuration = getDurationMinutes(shift.startTime, actualEndTime);
    const enterpriseDuration = getDurationMinutes(
      enterpriseShift.startTime,
      enterpriseEndTime
    );
    const salaryDifference = enterpriseSalary - actualSalary;

    if (
      !hasTimeMismatch(
        { startTime: shift.startTime, endTime: actualEndTime },
        enterpriseShift.startTime,
        enterpriseEndTime
      ) &&
      Math.abs(salaryDifference) < MONEY_EPSILON
    ) {
      return;
    }

    discrepancies.push({
      id: `${scheduleItem.date}-${shift.id}`,
      date: scheduleItem.date,
      shiftId: shift.id,
      scheduleId: scheduleItem.id,
      actualStartTime: shift.startTime,
      actualEndTime,
      enterpriseStartTime: enterpriseShift.startTime,
      enterpriseEndTime,
      actualDurationMinutes: actualDuration,
      enterpriseDurationMinutes: enterpriseDuration,
      durationDifferenceMinutes: enterpriseDuration - actualDuration,
      actualSalaryAmount: actualSalary,
      enterpriseSalaryAmount: enterpriseSalary,
      salaryDifferenceAmount: salaryDifference
    });
  });

  return {
    discrepancies
  };
};

export const synchronizeShiftWithEnterpriseSchedule = (
  shift: Shift,
  scheduleItem: EnterpriseScheduleItem,
  updatedAt: ISODateTimeString
): Shift => ({
  ...createEnterpriseShift(scheduleItem, shift),
  detectionMode: 'manual',
  updatedAt
});
