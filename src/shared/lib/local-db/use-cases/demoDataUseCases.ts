import type { EnterpriseScheduleItem } from '../../../../entities/enterprise-schedule';
import {
  calculateHourlyRateFromMonthlySalary,
  createGradeSnapshot,
  type Settings
} from '../../../../entities/settings';
import {
  PLANNED_SHIFTS,
  type CoefficientMode,
  type LocalDateString,
  type Shift,
  type ShiftType,
  type WorkTicket
} from '../../../../entities/shift';
import { toLocalIsoString } from '../../date-time';
import type { ShifterDatabase } from '../database';
import type { SettingsRecord } from '../types';

export type DemoDataSet = {
  range: {
    start: LocalDateString;
    end: LocalDateString;
  };
  settings: Settings;
  shifts: Shift[];
  enterpriseSchedule: EnterpriseScheduleItem[];
};

const pad = (value: number): string => String(value).padStart(2, '0');

const toDateString = (date: Date): LocalDateString =>
  `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;

const parseDate = (value: LocalDateString): Date => {
  const [year, month, day] = value.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, day));
};

const addMinutesToLocalTime = (
  date: LocalDateString,
  time: string,
  minutes: number
): string => {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minute] = time.split(':').map(Number);
  const value = new Date(year, month - 1, day, hours, minute + minutes, 0, 0);

  return toLocalIsoString(value);
};

const getWorkdays = (start: LocalDateString, end: LocalDateString): LocalDateString[] => {
  const cursor = parseDate(start);
  const lastDate = parseDate(end);
  const dates: LocalDateString[] = [];

  while (cursor.getTime() <= lastDate.getTime()) {
    const weekday = cursor.getUTCDay();

    if (weekday >= 1 && weekday <= 5) {
      dates.push(toDateString(cursor));
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
};

const getDemoRange = (referenceDate: LocalDateString): DemoDataSet['range'] => {
  const end = parseDate(referenceDate);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));

  return {
    start: toDateString(start),
    end: referenceDate
  };
};

const getCoefficientMode = (index: number): CoefficientMode => {
  if (index > 0 && index % 16 === 0) {
    return 'x2';
  }

  if (index > 0 && index % 13 === 0) {
    return 'x1.5';
  }

  if (index > 0 && index % 11 === 0) {
    return 'x1';
  }

  return 'auto';
};

const createTickets = (
  date: LocalDateString,
  index: number,
  type: ShiftType,
  createdAt: string
): WorkTicket[] => {
  const planned = PLANNED_SHIFTS[type];
  const firstStartedAt = addMinutesToLocalTime(date, planned.start, 25);
  const firstEndedAt = addMinutesToLocalTime(date, planned.start, 225);
  const secondStartedAt = addMinutesToLocalTime(date, planned.start, 240);
  const secondEndedAt = addMinutesToLocalTime(date, planned.end, -20);

  return [
    {
      id: `demo-ticket-${date}-1`,
      normPerEightHours: 48 + (index % 5) * 6,
      startedAt: firstStartedAt,
      endedAt: firstEndedAt,
      actualQuantity: 18 + (index % 5),
      downtimeMinutes: index % 3 === 0 ? 10 : 0,
      createdAt,
      updatedAt: firstEndedAt
    },
    {
      id: `demo-ticket-${date}-2`,
      normPerEightHours: 56 + (index % 4) * 8,
      startedAt: secondStartedAt,
      endedAt: secondEndedAt,
      actualQuantity: 24 + (index % 7),
      downtimeMinutes: index % 4 === 0 ? 15 : 0,
      createdAt,
      updatedAt: secondEndedAt
    }
  ];
};

export const createDemoDataSet = (
  referenceDate: LocalDateString,
  updatedAt = toLocalIsoString(new Date())
): DemoDataSet => {
  const range = getDemoRange(referenceDate);
  const settings: Settings = {
    employeeFirstName: 'Демо',
    employeeLastName: 'Працівник',
    monthlySalary: 44_000,
    monthlyBonus: 3_500,
    currentGrade: 2,
    desiredGrade: 3,
    gradeSalaryBonusPercents: [10, 10, 15, 15],
    gradeNormPercents: [100, 120, 140, 160],
    forecastDays: 30,
    arriveHoldDelayMs: 900,
    leaveHoldDelayMs: 900,
    shiftDetectionMode: 'auto',
    themePreference: 'system',
    backupReminderIntervalDays: 14,
    overtimeLimitPercent: 10,
    overtimeStepMinutes: 30,
    overtimeStrategy: 'standard',
    overtimeSaturdayCount: 1,
    overtimeWeekdayMaxMinutes: 240,
    overtimeSaturdayMaxMinutes: 480,
    incognitoEnabled: false,
    onboardingCompleted: true,
    updatedAt
  };
  const workdays = getWorkdays(range.start, range.end);
  const enterpriseSchedule: EnterpriseScheduleItem[] = [];
  const shifts: Shift[] = [];
  const startOffsets = [-8, 0, 4, 11, -3, 0, 7];
  const endOffsets = [5, 0, -12, 18, 0, 25, -5];

  workdays.forEach((date, index) => {
    const type: ShiftType = Math.floor(index / 5) % 2 === 0 ? 'first' : 'second';
    const planned = PLANNED_SHIFTS[type];
    const startOffset = startOffsets[index % startOffsets.length];
    const endOffset = endOffsets[index % endOffsets.length];
    const actualStart = addMinutesToLocalTime(date, planned.start, startOffset);
    const actualEnd = addMinutesToLocalTime(date, planned.end, endOffset);
    const enterpriseMatchesActual = index % 3 === 0;
    const enterpriseStart = enterpriseMatchesActual
      ? actualStart.slice(11, 16)
      : planned.start;
    const enterpriseEnd = enterpriseMatchesActual ? actualEnd.slice(11, 16) : planned.end;

    enterpriseSchedule.push({
      id: `enterprise-schedule-${date}`,
      date,
      shiftType: type,
      plannedStartTime: planned.start,
      plannedEndTime: planned.end,
      enterpriseStartTime: enterpriseStart,
      enterpriseEndTime: enterpriseEnd,
      skipped: index % 19 === 10,
      sourceText: `Демо ${date}: ${enterpriseStart}-${enterpriseEnd}`,
      createdAt: updatedAt,
      updatedAt
    });

    if (index % 11 === 6) {
      return;
    }

    const baseHourlyRate = calculateHourlyRateFromMonthlySalary(
      settings.monthlySalary,
      date
    );
    const endTime = actualEnd;

    shifts.push({
      id: `demo-shift-${date}`,
      date,
      type,
      detectionMode: 'auto',
      plannedStartTime: planned.start,
      plannedEndTime: planned.end,
      startTime: actualStart,
      endTime,
      baseHourlyRateSnapshot: baseHourlyRate,
      hourlyRateSnapshot: baseHourlyRate,
      gradeSnapshot: createGradeSnapshot(settings),
      workTickets: createTickets(date, index, type, updatedAt),
      note: '',
      coefficientMode: getCoefficientMode(index),
      isAutoClosed: false,
      createdAt: updatedAt,
      updatedAt: endTime
    });
  });

  return {
    range,
    settings,
    shifts,
    enterpriseSchedule
  };
};

export const replaceLocalDataWithDemo = async (
  db: ShifterDatabase,
  referenceDate: LocalDateString,
  updatedAt = toLocalIsoString(new Date())
): Promise<DemoDataSet> => {
  const data = createDemoDataSet(referenceDate, updatedAt);
  const settingsRecord: SettingsRecord = {
    ...data.settings,
    id: 'default'
  };

  await db.transaction(
    'rw',
    db.settings,
    db.shifts,
    db.enterpriseSchedule,
    db.appMeta,
    async () => {
      await db.settings.clear();
      await db.shifts.clear();
      await db.enterpriseSchedule.clear();
      await db.appMeta.clear();
      await db.settings.put(settingsRecord);
      await db.shifts.bulkPut(data.shifts);
      await db.enterpriseSchedule.bulkPut(data.enterpriseSchedule);
      await db.appMeta.put({
        key: 'demo-data-range',
        value: `${data.range.start}/${data.range.end}`,
        updatedAt
      });
    }
  );

  return data;
};
