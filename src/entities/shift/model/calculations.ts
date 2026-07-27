import { COEFFICIENT_VALUES, getBuiltInShiftTemplate } from './constants';
import type { CoefficientMode, ISODateTimeString, LocalDateString, Shift, ShiftType } from './types';

const MINUTE_IN_MS = 60_000;

export type PlannedShiftWindow = {
  type: ShiftType;
  date: LocalDateString;
  startTime: string;
  endTime: string;
  plannedStart: ISODateTimeString;
  plannedEnd: ISODateTimeString;
};

export type ShiftTimeBreakdown = PlannedShiftWindow & {
  actualDurationMinutes: number;
  earlyArrivalMinutes: number;
  lateArrivalMinutes: number;
  earlyExitMinutes: number;
  lateExitMinutes: number;
  overtimeBeforeShiftMinutes: number;
  overtimeAfterShiftMinutes: number;
  regularWorkMinutes: number;
  totalOvertimeMinutes: number;
};

export type SalaryBreakdownLine = {
  key: 'regular' | 'overtime-before' | 'overtime-after' | 'whole-shift';
  label: string;
  minutes: number;
  coefficient: number;
  amount: number;
};

export type SalaryBreakdown = {
  mode: CoefficientMode;
  hourlyRate: number;
  totalMinutes: number;
  totalAmount: number;
  lines: SalaryBreakdownLine[];
};

const getTimeZoneSuffix = (dateTime: ISODateTimeString): string => {
  const match = dateTime.match(/(Z|[+-]\d{2}:\d{2})$/);

  return match?.[1] ?? '';
};

const toDateTime = (
  date: LocalDateString,
  time: string,
  timeZoneSuffix: string
): ISODateTimeString => `${date}T${time}:00.000${timeZoneSuffix}`;

const addDays = (date: LocalDateString, days: number): LocalDateString => {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));

  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, '0')}-${String(
    result.getUTCDate()
  ).padStart(2, '0')}`;
};

const toTime = (dateTime: ISODateTimeString): number => {
  const time = new Date(dateTime).getTime();

  if (Number.isNaN(time)) {
    throw new Error(`Invalid date time: ${dateTime}`);
  }

  return time;
};

const minutesBetween = (start: number, end: number): number =>
  Math.max(0, Math.floor((end - start) / MINUTE_IN_MS));

const overlapMinutes = (
  start: number,
  end: number,
  windowStart: number,
  windowEnd: number
): number => minutesBetween(Math.max(start, windowStart), Math.min(end, windowEnd));

const calculateAmount = (hourlyRate: number, minutes: number, coefficient: number): number =>
  (hourlyRate / 60) * minutes * coefficient;

export const getPlannedShiftWindow = (
  date: LocalDateString,
  type: ShiftType,
  timeZoneSource: ISODateTimeString,
  plannedTimes?: {
    startTime: string;
    endTime: string;
  }
): PlannedShiftWindow => {
  const builtInTemplate = getBuiltInShiftTemplate(type);
  const plannedShift = plannedTimes ?? (
    builtInTemplate
      ? { startTime: builtInTemplate.startTime, endTime: builtInTemplate.endTime }
      : undefined
  );

  if (!plannedShift) {
    throw new Error(`Немає snapshot планового часу для шаблону ${type}.`);
  }

  const timeZoneSuffix = getTimeZoneSuffix(timeZoneSource);
  const endDate =
    plannedShift.endTime <= plannedShift.startTime ? addDays(date, 1) : date;

  return {
    type,
    date,
    startTime: plannedShift.startTime,
    endTime: plannedShift.endTime,
    plannedStart: toDateTime(date, plannedShift.startTime, timeZoneSuffix),
    plannedEnd: toDateTime(endDate, plannedShift.endTime, timeZoneSuffix)
  };
};

export const calculateShiftTimeBreakdown = (
  shift: Pick<
    Shift,
    'date' | 'type' | 'plannedStartTime' | 'plannedEndTime' | 'startTime' | 'endTime'
  >
): ShiftTimeBreakdown => {
  if (!shift.endTime) {
    throw new Error('Cannot calculate completed shift breakdown without endTime');
  }

  const plannedWindow = getPlannedShiftWindow(shift.date, shift.type, shift.startTime, {
    startTime: shift.plannedStartTime,
    endTime: shift.plannedEndTime
  });
  const actualStart = toTime(shift.startTime);
  const actualEnd = toTime(shift.endTime);
  const plannedStart = toTime(plannedWindow.plannedStart);
  const plannedEnd = toTime(plannedWindow.plannedEnd);

  const actualDurationMinutes = minutesBetween(actualStart, actualEnd);
  const regularWorkMinutes = overlapMinutes(actualStart, actualEnd, plannedStart, plannedEnd);
  const overtimeBeforeShiftMinutes = overlapMinutes(
    actualStart,
    actualEnd,
    Number.NEGATIVE_INFINITY,
    plannedStart
  );
  const overtimeAfterShiftMinutes = overlapMinutes(
    actualStart,
    actualEnd,
    plannedEnd,
    Number.POSITIVE_INFINITY
  );

  return {
    ...plannedWindow,
    actualDurationMinutes,
    earlyArrivalMinutes: minutesBetween(actualStart, plannedStart),
    lateArrivalMinutes: minutesBetween(plannedStart, actualStart),
    earlyExitMinutes: minutesBetween(actualEnd, plannedEnd),
    lateExitMinutes: minutesBetween(plannedEnd, actualEnd),
    overtimeBeforeShiftMinutes,
    overtimeAfterShiftMinutes,
    regularWorkMinutes,
    totalOvertimeMinutes: overtimeBeforeShiftMinutes + overtimeAfterShiftMinutes
  };
};

export const calculateSalaryBreakdown = (
  shift: Pick<
    Shift,
    | 'date'
    | 'type'
    | 'startTime'
    | 'endTime'
    | 'plannedStartTime'
    | 'plannedEndTime'
    | 'baseHourlyRateSnapshot'
    | 'coefficientMode'
  >
): SalaryBreakdown => {
  const timeBreakdown = calculateShiftTimeBreakdown(shift);
  const hourlyRate = shift.baseHourlyRateSnapshot;

  if (shift.coefficientMode !== 'auto') {
    const coefficient = COEFFICIENT_VALUES[shift.coefficientMode];

    if (coefficient === null) {
      throw new Error(`Unsupported coefficient mode: ${shift.coefficientMode}`);
    }

    const amount = calculateAmount(hourlyRate, timeBreakdown.actualDurationMinutes, coefficient);

    return {
      mode: shift.coefficientMode,
      hourlyRate,
      totalMinutes: timeBreakdown.actualDurationMinutes,
      totalAmount: amount,
      lines: [
        {
          key: 'whole-shift',
          label: `Уся зміна x${coefficient}`,
          minutes: timeBreakdown.actualDurationMinutes,
          coefficient,
          amount
        }
      ]
    };
  }

  const lines: SalaryBreakdownLine[] = [
    {
      key: 'regular',
      label: 'Основний час x1',
      minutes: timeBreakdown.regularWorkMinutes,
      coefficient: 1,
      amount: calculateAmount(hourlyRate, timeBreakdown.regularWorkMinutes, 1)
    },
    {
      key: 'overtime-before',
      label: 'Перепрацювання до початку x1.5',
      minutes: timeBreakdown.overtimeBeforeShiftMinutes,
      coefficient: 1.5,
      amount: calculateAmount(hourlyRate, timeBreakdown.overtimeBeforeShiftMinutes, 1.5)
    },
    {
      key: 'overtime-after',
      label: 'Перепрацювання після кінця x1.5',
      minutes: timeBreakdown.overtimeAfterShiftMinutes,
      coefficient: 1.5,
      amount: calculateAmount(hourlyRate, timeBreakdown.overtimeAfterShiftMinutes, 1.5)
    }
  ];

  return {
    mode: 'auto',
    hourlyRate,
    totalMinutes: timeBreakdown.actualDurationMinutes,
    totalAmount: lines.reduce((total, line) => total + line.amount, 0),
    lines
  };
};

export const getCurrentShiftCoefficient = (
  shift: Pick<
    Shift,
    | 'date'
    | 'type'
    | 'plannedStartTime'
    | 'plannedEndTime'
    | 'startTime'
    | 'coefficientMode'
  >,
  at: ISODateTimeString
): number => {
  if (shift.coefficientMode !== 'auto') {
    return COEFFICIENT_VALUES[shift.coefficientMode] ?? 1;
  }

  const plannedWindow = getPlannedShiftWindow(shift.date, shift.type, shift.startTime, {
    startTime: shift.plannedStartTime,
    endTime: shift.plannedEndTime
  });
  const timestamp = toTime(at);

  return timestamp >= toTime(plannedWindow.plannedStart) &&
    timestamp < toTime(plannedWindow.plannedEnd)
    ? 1
    : 1.5;
};
