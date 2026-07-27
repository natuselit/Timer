import type { EnterpriseScheduleItem } from '../../../entities/enterprise-schedule';
import {
  calculateSalaryBreakdown,
  type CoefficientMode,
  type ISODateTimeString,
  type Shift
} from '../../../entities/shift';

export type ScheduleChartGranularity = 'day' | 'week' | 'month';

export type ScheduleChartPoint = {
  key: string;
  label: string;
  plannedHours: number;
  actualHours: number;
  expectedMoney: number;
  actualMoney: number;
};

export type ScheduleChartData = {
  granularity: ScheduleChartGranularity;
  points: ScheduleChartPoint[];
};

const MINUTE_IN_MS = 60_000;

const toDate = (date: string): Date => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const toLocalDate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;

const getRangeDayCount = (start: string, end: string): number =>
  Math.floor((toDate(end).getTime() - toDate(start).getTime()) / (24 * 60 * MINUTE_IN_MS)) + 1;

export const getScheduleChartGranularity = (
  start: string,
  end: string
): ScheduleChartGranularity => {
  const days = getRangeDayCount(start, end);
  return days <= 31 ? 'day' : days <= 92 ? 'week' : 'month';
};

const getGroup = (
  date: string,
  granularity: ScheduleChartGranularity
): { key: string; label: string } => {
  if (granularity === 'day') {
    const [, month, day] = date.split('-');
    return { key: date, label: `${day}.${month}` };
  }

  if (granularity === 'month') {
    const [year, month] = date.split('-');
    return { key: `${year}-${month}`, label: `${month}.${year.slice(2)}` };
  }

  const current = toDate(date);
  const weekday = current.getDay() || 7;
  current.setDate(current.getDate() - weekday + 1);
  const start = toLocalDate(current);
  const [, month, day] = start.split('-');
  return { key: start, label: `з ${day}.${month}` };
};

const getTimeMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

const getPlannedMinutes = (item: EnterpriseScheduleItem): number => {
  const start = getTimeMinutes(item.plannedStartTime);
  const end = getTimeMinutes(item.plannedEndTime);
  return (end - start + 24 * 60) % (24 * 60);
};

const getActualMinutes = (shift: Shift, now: ISODateTimeString): number => {
  const end = shift.endTime ?? now;
  return Math.max(
    0,
    Math.floor((new Date(end).getTime() - new Date(shift.startTime).getTime()) / MINUTE_IN_MS)
  );
};

const getExpectedMoney = (
  item: EnterpriseScheduleItem,
  shift: Shift | undefined,
  fallbackHourlyRate: number,
  coefficientMode: CoefficientMode
): number => {
  const hourlyRate = shift?.baseHourlyRateSnapshot ?? fallbackHourlyRate;
  const start = `${item.date}T${item.plannedStartTime}:00.000`;
  const endDate = toDate(item.date);

  if (item.plannedEndTime <= item.plannedStartTime) {
    endDate.setDate(endDate.getDate() + 1);
  }

  const end = `${toLocalDate(endDate)}T${item.plannedEndTime}:00.000`;

  return calculateSalaryBreakdown({
    date: item.date,
    type: item.templateId ?? item.shiftType,
    plannedStartTime: item.plannedStartTime,
    plannedEndTime: item.plannedEndTime,
    startTime: start,
    endTime: end,
    baseHourlyRateSnapshot: hourlyRate,
    coefficientMode: shift?.coefficientMode ?? coefficientMode
  }).totalAmount;
};

export const calculateScheduleChartData = ({
  start,
  end,
  scheduleItems,
  shifts,
  now,
  fallbackHourlyRate,
  coefficientMode
}: {
  start: string;
  end: string;
  scheduleItems: EnterpriseScheduleItem[];
  shifts: Shift[];
  now: ISODateTimeString;
  fallbackHourlyRate: number;
  coefficientMode: CoefficientMode;
}): ScheduleChartData => {
  const granularity = getScheduleChartGranularity(start, end);
  const shiftsByDate = new Map(shifts.map((shift) => [shift.date, shift]));
  const itemsByDate = new Map(scheduleItems.map((item) => [item.date, item]));
  const dates = [...new Set([...itemsByDate.keys(), ...shiftsByDate.keys()])].sort();
  const points = new Map<string, ScheduleChartPoint>();

  dates.forEach((date) => {
    const group = getGroup(date, granularity);
    const point = points.get(group.key) ?? {
      key: group.key,
      label: group.label,
      plannedHours: 0,
      actualHours: 0,
      expectedMoney: 0,
      actualMoney: 0
    };
    const item = itemsByDate.get(date);
    const shift = shiftsByDate.get(date);

    if (item) {
      point.plannedHours += getPlannedMinutes(item) / 60;
      point.expectedMoney += getExpectedMoney(
        item,
        shift,
        fallbackHourlyRate,
        coefficientMode
      );
    }

    if (shift && shift.date <= now.slice(0, 10)) {
      point.actualHours += getActualMinutes(shift, now) / 60;
      point.actualMoney += calculateSalaryBreakdown({
        ...shift,
        endTime: shift.endTime ?? now
      }).totalAmount;
    }

    points.set(group.key, point);
  });

  return {
    granularity,
    points: [...points.values()]
  };
};
