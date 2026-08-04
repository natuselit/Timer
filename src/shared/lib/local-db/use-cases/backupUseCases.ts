import {
  DEFAULT_SETTINGS,
  BACKUP_REMINDER_INTERVAL_DAYS,
  FORECAST_DAYS_MAX,
  FORECAST_DAYS_MIN,
  GRADE_VALUES,
  HOLD_DELAY_MAX_MS,
  HOLD_DELAY_MIN_MS,
  calculateMonthlySalaryFromHourlyRate,
  isThemePreference,
  type BackupReminderIntervalDays,
  type Grade,
  type GradePercentSet,
  type Settings
} from '../../../../entities/settings';
import type { EnterpriseScheduleItem } from '../../../../entities/enterprise-schedule';
import type {
  CoefficientMode,
  GradeSnapshot,
  LocalDateString,
  Shift,
  ShiftDetectionMode,
  ShiftType,
  WorkTicket
} from '../../../../entities/shift';
import {
  PLANNED_SHIFTS,
  validateAndSortWorkTickets
} from '../../../../entities/shift';
import { toLocalIsoString } from '../../date-time';
import type { ShifterDatabase } from '../database';
import { CALENDAR_TUTORIAL_SEEN_KEY } from '../repositories/calendarTutorialRepository';
import {
  SCHEDULE_WARNING_REVIEW_PREFIX,
  ScheduleWarningReviewRepository,
  toScheduleWarningReviewRecord
} from '../repositories/scheduleWarningReviewRepository';
import { normalizeSettingsRecord } from '../repositories/settingsRepository';
import { normalizeShiftRecord } from '../repositories/shiftRepository';
import type {
  ReviewedScheduleWarning,
  SettingsRecord
} from '../types';

export const LEGACY_BACKUP_SCHEMA_VERSION = 1;
const GRADE_AND_TICKETS_BACKUP_SCHEMA_VERSION = 3;
const THEME_BACKUP_SCHEMA_VERSION = 4;
const TICKET_PRODUCTION_BACKUP_SCHEMA_VERSION = 5;
const MANUAL_DOWNTIME_BACKUP_SCHEMA_VERSION = 6;
const REVIEWED_SCHEDULE_WARNINGS_BACKUP_SCHEMA_VERSION = 7;
const BACKUP_REMINDER_BACKUP_SCHEMA_VERSION = 8;
export const BACKUP_SCHEMA_VERSION = BACKUP_REMINDER_BACKUP_SCHEMA_VERSION;
const SUPPORTED_BACKUP_SCHEMA_VERSIONS = new Set<number>([
  LEGACY_BACKUP_SCHEMA_VERSION,
  2,
  GRADE_AND_TICKETS_BACKUP_SCHEMA_VERSION,
  THEME_BACKUP_SCHEMA_VERSION,
  TICKET_PRODUCTION_BACKUP_SCHEMA_VERSION,
  MANUAL_DOWNTIME_BACKUP_SCHEMA_VERSION,
  REVIEWED_SCHEDULE_WARNINGS_BACKUP_SCHEMA_VERSION,
  BACKUP_SCHEMA_VERSION
]);

type BackupSchemaVersion = typeof BACKUP_SCHEMA_VERSION;

export type ShifterBackup = {
  schemaVersion: BackupSchemaVersion;
  exportedAt: string;
  settings: Settings;
  shifts: Shift[];
  enterpriseSchedule: EnterpriseScheduleItem[];
  reviewedScheduleWarnings: ReviewedScheduleWarning[];
};

export type ParsedBackupImport =
  | {
      kind: 'shifter';
      backup: ShifterBackup;
    }
  | {
      kind: 'legacy';
      exportedAt: string;
      shifts: Shift[];
    };

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupValidationError';
  }
}

const SETTINGS_ID: SettingsRecord['id'] = 'default';
const SHIFT_TYPES = new Set<ShiftType>(['first', 'second']);
const COEFFICIENT_MODES = new Set<CoefficientMode>(['auto', 'x1', 'x1.5', 'x2']);
const DETECTION_MODES = new Set<ShiftDetectionMode>(['auto', 'manual']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isGrade = (value: unknown): value is Grade =>
  typeof value === 'number' && GRADE_VALUES.includes(value as Grade);

const isIsoLikeDateTime = (value: unknown): value is string =>
  isString(value) && value.length > 0 && !Number.isNaN(new Date(value).getTime());

const isLocalDate = (value: unknown): value is LocalDateString => {
  if (!isString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

const isLocalTime = (value: unknown): value is string =>
  isString(value) && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

const readString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];

  if (!isString(value)) {
    throw new BackupValidationError(`Поле ${key} має бути рядком.`);
  }

  return value;
};

const readOptionalString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key];

  if (value === undefined) {
    return '';
  }

  if (!isString(value)) {
    throw new BackupValidationError(`Поле ${key} має бути рядком.`);
  }

  return value;
};

const readFiniteNumber = (record: Record<string, unknown>, key: string): number => {
  const value = record[key];

  if (!isFiniteNumber(value)) {
    throw new BackupValidationError(`Поле ${key} має бути числом.`);
  }

  return value;
};

const readNonNegativeNumber = (record: Record<string, unknown>, key: string): number => {
  const value = readFiniteNumber(record, key);

  if (value < 0) {
    throw new BackupValidationError(`Поле ${key} не може бути відʼємним.`);
  }

  return value;
};

const readGrade = (record: Record<string, unknown>, key: string): Grade => {
  const value = record[key];

  if (!isGrade(value)) {
    throw new BackupValidationError(`Поле ${key} має бути рівнем від 1 до 4.`);
  }

  return value;
};

const readPercentSet = (record: Record<string, unknown>, key: string): GradePercentSet => {
  const value = record[key];

  if (!Array.isArray(value) || value.length !== 4) {
    throw new BackupValidationError(`Поле ${key} має містити 4 відсотки.`);
  }

  const percents = value.map((item) => {
    if (!isFiniteNumber(item) || item < 0) {
      throw new BackupValidationError(`Поле ${key} має містити невідʼємні числа.`);
    }

    return item;
  });

  return percents as GradePercentSet;
};

const readIntegerInRange = (
  record: Record<string, unknown>,
  key: string,
  min: number,
  max: number
): number => {
  const value = readFiniteNumber(record, key);

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new BackupValidationError(`Поле ${key} має бути цілим числом від ${min} до ${max}.`);
  }

  return value;
};

const readBoolean = (record: Record<string, unknown>, key: string): boolean => {
  const value = record[key];

  if (!isBoolean(value)) {
    throw new BackupValidationError(`Поле ${key} має бути boolean.`);
  }

  return value;
};

const readBackupReminderIntervalDays = (
  record: Record<string, unknown>,
  key: string
): BackupReminderIntervalDays => {
  const value = readFiniteNumber(record, key);

  if (!BACKUP_REMINDER_INTERVAL_DAYS.includes(value as BackupReminderIntervalDays)) {
    throw new BackupValidationError('Періодичність backup має бути 7, 14 або 30 днів.');
  }

  return value as BackupReminderIntervalDays;
};

const parseJsonRecord = (source: string): Record<string, unknown> => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(source);
  } catch {
    throw new BackupValidationError('Файл не є валідним JSON.');
  }

  if (!isRecord(parsed)) {
    throw new BackupValidationError('Backup має бути JSON-обʼєктом.');
  }

  return parsed;
};

const parseSettings = (
  value: unknown,
  schemaVersion: number,
  exportedAt: string
): Settings => {
  if (!isRecord(value)) {
    throw new BackupValidationError('settings має бути обʼєктом.');
  }

  const coefficientMode = value.coefficientMode;
  const shiftDetectionMode = value.shiftDetectionMode;
  const updatedAt = value.updatedAt;

  if (!COEFFICIENT_MODES.has(coefficientMode as CoefficientMode)) {
    throw new BackupValidationError('settings.coefficientMode має несумісне значення.');
  }

  if (!DETECTION_MODES.has(shiftDetectionMode as ShiftDetectionMode)) {
    throw new BackupValidationError('settings.shiftDetectionMode має несумісне значення.');
  }

  if (!isIsoLikeDateTime(updatedAt)) {
    throw new BackupValidationError('settings.updatedAt має бути валідною датою.');
  }

  const currentGrade =
    schemaVersion >= GRADE_AND_TICKETS_BACKUP_SCHEMA_VERSION
      ? readGrade(value, 'currentGrade')
      : DEFAULT_SETTINGS.currentGrade;
  const desiredGrade =
    schemaVersion >= GRADE_AND_TICKETS_BACKUP_SCHEMA_VERSION
      ? readGrade(value, 'desiredGrade')
      : DEFAULT_SETTINGS.desiredGrade;
  const themePreference = value.themePreference;

  if (
    schemaVersion >= THEME_BACKUP_SCHEMA_VERSION &&
    !isThemePreference(themePreference)
  ) {
    throw new BackupValidationError(
      'settings.themePreference має бути system, light або dark.'
    );
  }

  if (desiredGrade < currentGrade) {
    throw new BackupValidationError('settings.desiredGrade не може бути меншим за currentGrade.');
  }

  return {
    employeeFirstName: readOptionalString(value, 'employeeFirstName'),
    employeeLastName: readString(value, 'employeeLastName'),
    monthlySalary:
      schemaVersion === LEGACY_BACKUP_SCHEMA_VERSION
        ? calculateMonthlySalaryFromHourlyRate(
            readNonNegativeNumber(value, 'hourlyRate'),
            exportedAt.slice(0, 10)
          )
        : readNonNegativeNumber(value, 'monthlySalary'),
    monthlyBonus: readNonNegativeNumber(value, 'monthlyBonus'),
    currentGrade,
    desiredGrade,
    gradeSalaryBonusPercents:
      schemaVersion >= BACKUP_REMINDER_BACKUP_SCHEMA_VERSION
        ? readPercentSet(value, 'gradeSalaryBonusPercents')
        : DEFAULT_SETTINGS.gradeSalaryBonusPercents,
    gradeNormPercents:
      schemaVersion >= GRADE_AND_TICKETS_BACKUP_SCHEMA_VERSION
        ? readPercentSet(value, 'gradeNormPercents')
        : DEFAULT_SETTINGS.gradeNormPercents,
    forecastDays: readIntegerInRange(value, 'forecastDays', FORECAST_DAYS_MIN, FORECAST_DAYS_MAX),
    arriveHoldDelayMs: readIntegerInRange(
      value,
      'arriveHoldDelayMs',
      HOLD_DELAY_MIN_MS,
      HOLD_DELAY_MAX_MS
    ),
    leaveHoldDelayMs: readIntegerInRange(
      value,
      'leaveHoldDelayMs',
      HOLD_DELAY_MIN_MS,
      HOLD_DELAY_MAX_MS
    ),
    coefficientMode: coefficientMode as CoefficientMode,
    shiftDetectionMode: shiftDetectionMode as ShiftDetectionMode,
    themePreference:
      schemaVersion >= THEME_BACKUP_SCHEMA_VERSION
        ? (themePreference as Settings['themePreference'])
        : DEFAULT_SETTINGS.themePreference,
    backupReminderIntervalDays:
      schemaVersion >= BACKUP_REMINDER_BACKUP_SCHEMA_VERSION
        ? readBackupReminderIntervalDays(value, 'backupReminderIntervalDays')
        : DEFAULT_SETTINGS.backupReminderIntervalDays,
    incognitoEnabled: readBoolean(value, 'incognitoEnabled'),
    onboardingCompleted: readBoolean(value, 'onboardingCompleted'),
    updatedAt
  };
};

const parseGradeSnapshot = (value: unknown): GradeSnapshot | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new BackupValidationError('shift.gradeSnapshot має бути обʼєктом або null.');
  }

  const currentGrade = readGrade(value, 'currentGrade');
  const desiredGrade = readGrade(value, 'desiredGrade');

  if (desiredGrade < currentGrade) {
    throw new BackupValidationError('shift.gradeSnapshot.desiredGrade не може бути меншим за currentGrade.');
  }

  return {
    currentGrade,
    desiredGrade,
    gradeSalaryBonusPercents: readPercentSet(value, 'gradeSalaryBonusPercents'),
    gradeNormPercents: readPercentSet(value, 'gradeNormPercents'),
    cumulativeSalaryBonusPercent: readNonNegativeNumber(value, 'cumulativeSalaryBonusPercent')
  };
};

type LegacyDowntimeInterval = {
  id: string;
  startedAt: string;
  endedAt: string | null;
};

const parseDowntimeIntervals = (value: unknown): LegacyDowntimeInterval[] => {
  if (!Array.isArray(value)) {
    throw new BackupValidationError('ticket.downtimeIntervals має бути масивом.');
  }

  return value.map((item) => {
    if (!isRecord(item)) {
      throw new BackupValidationError('Кожен інтервал простою має бути обʼєктом.');
    }

    const endedAt = item.endedAt;
    const interval = {
      id: readString(item, 'id'),
      startedAt: readString(item, 'startedAt'),
      endedAt: endedAt === null ? null : readString(item, 'endedAt')
    };

    if (
      !isIsoLikeDateTime(interval.startedAt) ||
      (interval.endedAt !== null && !isIsoLikeDateTime(interval.endedAt))
    ) {
      throw new BackupValidationError('Інтервал простою містить невалідний час.');
    }

    return interval;
  });
};

const getLegacyOpenDowntimeMinutes = (
  intervals: LegacyDowntimeInterval[],
  effectiveEndTime: string
): number => {
  const openIntervals = intervals.filter((interval) => interval.endedAt === null);

  if (openIntervals.length > 1) {
    throw new BackupValidationError('Тікет містить більше одного активного простою.');
  }

  const activeInterval = openIntervals[0];

  if (!activeInterval) {
    return 0;
  }

  const startedAt = new Date(activeInterval.startedAt).getTime();
  const endedAt = new Date(effectiveEndTime).getTime();

  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt < startedAt) {
    throw new BackupValidationError('Активний простій містить невалідний час.');
  }

  return Math.floor((endedAt - startedAt) / 60_000);
};

const parseWorkTicket = (
  value: unknown,
  schemaVersion: number,
  fallbackEndTime: string
): WorkTicket => {
  if (!isRecord(value)) {
    throw new BackupValidationError('Кожен тікет має бути обʼєктом.');
  }

  const endedAt = value.endedAt;
  const actualQuantity = value.actualQuantity;
  const parsedEndedAt = endedAt === null ? null : readString(value, 'endedAt');
  const legacyIntervals =
    schemaVersion === TICKET_PRODUCTION_BACKUP_SCHEMA_VERSION
      ? parseDowntimeIntervals(value.downtimeIntervals)
      : [];
  const baseDowntimeMinutes =
    schemaVersion < TICKET_PRODUCTION_BACKUP_SCHEMA_VERSION
      ? 0
      : readNonNegativeNumber(value, 'downtimeMinutes');
  const ticket: WorkTicket = {
    id: readString(value, 'id'),
    normPerEightHours: readNonNegativeNumber(value, 'normPerEightHours'),
    startedAt: readString(value, 'startedAt'),
    endedAt: parsedEndedAt,
    actualQuantity:
      schemaVersion < TICKET_PRODUCTION_BACKUP_SCHEMA_VERSION
        ? null
        : actualQuantity === null
          ? null
          : readFiniteNumber(value, 'actualQuantity'),
    downtimeMinutes:
      baseDowntimeMinutes +
      getLegacyOpenDowntimeMinutes(legacyIntervals, parsedEndedAt ?? fallbackEndTime),
    createdAt: readString(value, 'createdAt'),
    updatedAt: readString(value, 'updatedAt')
  };

  if (
    ticket.normPerEightHours <= 0 ||
    (ticket.actualQuantity !== null &&
      (!Number.isSafeInteger(ticket.actualQuantity) || ticket.actualQuantity < 0)) ||
    !Number.isSafeInteger(ticket.downtimeMinutes) ||
    !isIsoLikeDateTime(ticket.startedAt) ||
    (ticket.endedAt !== null && !isIsoLikeDateTime(ticket.endedAt)) ||
    !isIsoLikeDateTime(ticket.createdAt) ||
    !isIsoLikeDateTime(ticket.updatedAt)
  ) {
    throw new BackupValidationError('Тікет містить невалідну норму або час.');
  }

  if (ticket.endedAt !== null && new Date(ticket.endedAt).getTime() < new Date(ticket.startedAt).getTime()) {
    throw new BackupValidationError('Тікет не може завершуватись раніше старту.');
  }

  return ticket;
};

const parseWorkTickets = (
  value: unknown,
  schemaVersion: number,
  fallbackEndTime: string
): WorkTicket[] => {
  if (schemaVersion < GRADE_AND_TICKETS_BACKUP_SCHEMA_VERSION && value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new BackupValidationError('shift.workTickets має бути масивом.');
  }

  const tickets = value.map((ticket) =>
    parseWorkTicket(ticket, schemaVersion, fallbackEndTime)
  );
  const activeTicketCount = tickets.filter((ticket) => ticket.endedAt === null).length;

  if (activeTicketCount > 1) {
    throw new BackupValidationError('Зміна містить більше одного активного тікета.');
  }

  return tickets;
};

const parseShift = (
  value: unknown,
  schemaVersion: number,
  exportedAt: string
): Shift => {
  if (!isRecord(value)) {
    throw new BackupValidationError('Кожна зміна має бути обʼєктом.');
  }

  const type = value.type;
  const detectionMode = value.detectionMode;
  const coefficientMode = value.coefficientMode;
  const endTime = value.endTime;

  if (!SHIFT_TYPES.has(type as ShiftType)) {
    throw new BackupValidationError('shift.type має несумісне значення.');
  }

  if (!DETECTION_MODES.has(detectionMode as ShiftDetectionMode)) {
    throw new BackupValidationError('shift.detectionMode має несумісне значення.');
  }

  if (!COEFFICIENT_MODES.has(coefficientMode as CoefficientMode)) {
    throw new BackupValidationError('shift.coefficientMode має несумісне значення.');
  }

  if (endTime !== null && !isIsoLikeDateTime(endTime)) {
    throw new BackupValidationError('shift.endTime має бути датою або null.');
  }

  const baseHourlyRateSnapshot =
    schemaVersion >= GRADE_AND_TICKETS_BACKUP_SCHEMA_VERSION
      ? readNonNegativeNumber(value, 'baseHourlyRateSnapshot')
      : readNonNegativeNumber(value, 'hourlyRateSnapshot');
  const shift: Shift = {
    id: readString(value, 'id'),
    date: readString(value, 'date'),
    type: type as ShiftType,
    detectionMode: detectionMode as ShiftDetectionMode,
    plannedStartTime: readString(value, 'plannedStartTime'),
    plannedEndTime: readString(value, 'plannedEndTime'),
    startTime: readString(value, 'startTime'),
    endTime,
    baseHourlyRateSnapshot,
    hourlyRateSnapshot: baseHourlyRateSnapshot,
    gradeSnapshot:
      schemaVersion >= GRADE_AND_TICKETS_BACKUP_SCHEMA_VERSION
        ? parseGradeSnapshot(value.gradeSnapshot)
        : null,
    workTickets: parseWorkTickets(value.workTickets, schemaVersion, endTime ?? exportedAt),
    coefficientMode: coefficientMode as CoefficientMode,
    isAutoClosed: readBoolean(value, 'isAutoClosed'),
    createdAt: readString(value, 'createdAt'),
    updatedAt: readString(value, 'updatedAt')
  };

  if (
    !isLocalDate(shift.date) ||
    !isLocalTime(shift.plannedStartTime) ||
    !isLocalTime(shift.plannedEndTime) ||
    !isIsoLikeDateTime(shift.startTime) ||
    !isIsoLikeDateTime(shift.createdAt) ||
    !isIsoLikeDateTime(shift.updatedAt)
  ) {
    throw new BackupValidationError('Зміна містить невалідні дату або час.');
  }

  if (shift.startTime.slice(0, 10) !== shift.date) {
    throw new BackupValidationError('Дата зміни має збігатися з датою приходу.');
  }

  if (
    shift.endTime !== null &&
    new Date(shift.endTime).getTime() < new Date(shift.startTime).getTime()
  ) {
    throw new BackupValidationError('Зміна не може завершуватись раніше приходу.');
  }

  if (shift.endTime !== null && shift.workTickets.some((ticket) => ticket.endedAt === null)) {
    throw new BackupValidationError('Завершена зміна не може містити активний тікет.');
  }

  try {
    shift.workTickets = validateAndSortWorkTickets(shift.workTickets, {
      shiftStartTime: shift.startTime,
      effectiveShiftEndTime: shift.endTime ?? exportedAt,
      allowOpenTicket: shift.endTime === null
    });
  } catch (error) {
    throw new BackupValidationError(
      error instanceof Error ? error.message : 'Тікети містять невалідні дані.'
    );
  }

  return normalizeShiftRecord(shift);
};

const parseEnterpriseScheduleItem = (value: unknown): EnterpriseScheduleItem => {
  if (!isRecord(value)) {
    throw new BackupValidationError('Кожен запис графіка має бути обʼєктом.');
  }

  const shiftType = value.shiftType;

  if (!SHIFT_TYPES.has(shiftType as ShiftType)) {
    throw new BackupValidationError('enterpriseSchedule.shiftType має несумісне значення.');
  }

  const item: EnterpriseScheduleItem = {
    id: readString(value, 'id'),
    date: readString(value, 'date'),
    shiftType: shiftType as ShiftType,
    plannedStartTime: readString(value, 'plannedStartTime'),
    plannedEndTime: readString(value, 'plannedEndTime'),
    enterpriseStartTime: readString(value, 'enterpriseStartTime'),
    enterpriseEndTime: readString(value, 'enterpriseEndTime'),
    skipped: readBoolean(value, 'skipped'),
    sourceText: readString(value, 'sourceText'),
    createdAt: readString(value, 'createdAt'),
    updatedAt: readString(value, 'updatedAt')
  };

  if (
    !isLocalDate(item.date) ||
    !isLocalTime(item.plannedStartTime) ||
    !isLocalTime(item.plannedEndTime) ||
    !isLocalTime(item.enterpriseStartTime) ||
    !isLocalTime(item.enterpriseEndTime) ||
    !isIsoLikeDateTime(item.createdAt) ||
    !isIsoLikeDateTime(item.updatedAt)
  ) {
    throw new BackupValidationError('Графік підприємства містить невалідні дату або час.');
  }

  return item;
};

const parseReviewedScheduleWarning = (
  value: unknown
): ReviewedScheduleWarning => {
  if (!isRecord(value)) {
    throw new BackupValidationError(
      'Кожна позначка переглянутого попередження має бути обʼєктом.'
    );
  }

  const review: ReviewedScheduleWarning = {
    shiftId: readString(value, 'shiftId'),
    fingerprint: readString(value, 'fingerprint'),
    reviewedAt: readString(value, 'reviewedAt')
  };

  if (review.shiftId.trim() === '' || review.fingerprint.trim() === '') {
    throw new BackupValidationError(
      'Переглянуте попередження має містити shiftId і fingerprint.'
    );
  }

  if (!isIsoLikeDateTime(review.reviewedAt)) {
    throw new BackupValidationError(
      'reviewedScheduleWarnings.reviewedAt має бути валідною датою.'
    );
  }

  return review;
};

const validateDomainInvariants = (
  shifts: Shift[],
  enterpriseSchedule: EnterpriseScheduleItem[],
  reviewedScheduleWarnings: ReviewedScheduleWarning[] = []
): void => {
  const shiftDates = new Set<string>();
  const shiftIds = new Set<string>();
  const ticketIds = new Set<string>();
  let activeShiftCount = 0;

  for (const shift of shifts) {
    if (shiftIds.has(shift.id)) {
      throw new BackupValidationError(`Backup містить дубль ID зміни ${shift.id}.`);
    }

    shiftIds.add(shift.id);

    if (shiftDates.has(shift.date)) {
      throw new BackupValidationError(`Backup містить дві зміни за ${shift.date}.`);
    }

    shiftDates.add(shift.date);

    if (shift.endTime === null) {
      activeShiftCount += 1;
    }

    const activeTicketCount = shift.workTickets.filter((ticket) => ticket.endedAt === null).length;

    for (const ticket of shift.workTickets) {
      if (ticketIds.has(ticket.id)) {
        throw new BackupValidationError(`Backup містить дубль ID тікета ${ticket.id}.`);
      }

      ticketIds.add(ticket.id);
    }

    if (activeTicketCount > 1) {
      throw new BackupValidationError(`Зміна за ${shift.date} містить більше одного активного тікета.`);
    }

    if (shift.endTime !== null && activeTicketCount > 0) {
      throw new BackupValidationError(`Завершена зміна за ${shift.date} містить активний тікет.`);
    }
  }

  if (activeShiftCount > 1) {
    throw new BackupValidationError('Backup містить більше однієї активної зміни.');
  }

  const scheduleDates = new Set<string>();
  const scheduleIds = new Set<string>();

  for (const item of enterpriseSchedule) {
    if (scheduleIds.has(item.id)) {
      throw new BackupValidationError(`Backup містить дубль ID запису графіка ${item.id}.`);
    }

    scheduleIds.add(item.id);

    if (scheduleDates.has(item.date)) {
      throw new BackupValidationError(`Backup містить два записи графіка за ${item.date}.`);
    }

    scheduleDates.add(item.date);
  }

  const reviewedShiftIds = new Set<string>();

  for (const review of reviewedScheduleWarnings) {
    if (!shiftIds.has(review.shiftId)) {
      throw new BackupValidationError(
        `Переглянуте попередження посилається на відсутню зміну ${review.shiftId}.`
      );
    }

    if (reviewedShiftIds.has(review.shiftId)) {
      throw new BackupValidationError(
        `Backup містить дві позначки попередження для зміни ${review.shiftId}.`
      );
    }

    reviewedShiftIds.add(review.shiftId);
  }
};

export const parseBackupJson = (source: string): ShifterBackup => {
  const parsed = parseJsonRecord(source);

  const schemaVersion = parsed.schemaVersion;

  if (!SUPPORTED_BACKUP_SCHEMA_VERSIONS.has(schemaVersion as number)) {
    throw new BackupValidationError('Версія backup несумісна з цією версією додатку.');
  }

  const sourceSchemaVersion = schemaVersion as number;

  if (!isIsoLikeDateTime(parsed.exportedAt)) {
    throw new BackupValidationError('exportedAt має бути валідною датою.');
  }

  if (!Array.isArray(parsed.shifts)) {
    throw new BackupValidationError('shifts має бути масивом.');
  }

  if (!Array.isArray(parsed.enterpriseSchedule)) {
    throw new BackupValidationError('enterpriseSchedule має бути масивом.');
  }

  if (
    sourceSchemaVersion >= REVIEWED_SCHEDULE_WARNINGS_BACKUP_SCHEMA_VERSION &&
    !Array.isArray(parsed.reviewedScheduleWarnings)
  ) {
    throw new BackupValidationError(
      'reviewedScheduleWarnings має бути масивом.'
    );
  }

  const backup: ShifterBackup = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: parsed.exportedAt,
    settings: parseSettings(parsed.settings, sourceSchemaVersion, parsed.exportedAt),
    shifts: parsed.shifts.map((shift) =>
      parseShift(shift, sourceSchemaVersion, parsed.exportedAt as string)
    ),
    enterpriseSchedule: parsed.enterpriseSchedule.map(parseEnterpriseScheduleItem),
    reviewedScheduleWarnings:
      sourceSchemaVersion >= REVIEWED_SCHEDULE_WARNINGS_BACKUP_SCHEMA_VERSION
        ? (parsed.reviewedScheduleWarnings as unknown[]).map(
            parseReviewedScheduleWarning
          )
        : []
  };

  validateDomainInvariants(
    backup.shifts,
    backup.enterpriseSchedule,
    backup.reviewedScheduleWarnings
  );

  return backup;
};

const parseLegacyTimestamp = (
  value: unknown,
  fieldName: 'startedAt' | 'endedAt'
): string => {
  if (!isFiniteNumber(value) || !Number.isSafeInteger(value) || value < 0) {
    throw new BackupValidationError(`Поле ${fieldName} старої зміни має бути timestamp.`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new BackupValidationError(`Поле ${fieldName} старої зміни містить невалідний час.`);
  }

  return toLocalIsoString(date);
};

const parseLegacyCoefficientMode = (
  value: unknown,
  doubleRate: unknown
): Exclude<CoefficientMode, 'auto'> => {
  if (value === undefined) {
    if (!isBoolean(doubleRate)) {
      throw new BackupValidationError(
        'Стара зміна має містити rateMultiplier або doubleRate.'
      );
    }

    return doubleRate ? 'x2' : 'x1';
  }

  if (value === 1) {
    return 'x1';
  }

  if (value === 1.5) {
    return 'x1.5';
  }

  if (value === 2) {
    return 'x2';
  }

  throw new BackupValidationError(
    'rateMultiplier старої зміни має дорівнювати 1, 1.5 або 2.'
  );
};

const parseLegacyShift = (
  value: unknown,
  exportedAt: string
): Shift => {
  if (!isRecord(value)) {
    throw new BackupValidationError('Кожна стара зміна має бути обʼєктом.');
  }

  const id = readString(value, 'id');
  const type: ShiftType =
    value.shiftType === '1 зміна'
      ? 'first'
      : value.shiftType === '2 зміна'
        ? 'second'
        : (() => {
            throw new BackupValidationError(
              'shiftType старої зміни має бути «1 зміна» або «2 зміна».'
            );
          })();
  const startTime = parseLegacyTimestamp(value.startedAt, 'startedAt');
  const endTime =
    value.endedAt === null
      ? null
      : parseLegacyTimestamp(value.endedAt, 'endedAt');
  const baseHourlyRateSnapshot = readNonNegativeNumber(value, 'rate');
  const coefficientMode = parseLegacyCoefficientMode(
    value.rateMultiplier,
    value.doubleRate
  );

  if (id.trim() === '') {
    throw new BackupValidationError('ID старої зміни не може бути порожнім.');
  }

  if (
    endTime !== null &&
    new Date(endTime).getTime() < new Date(startTime).getTime()
  ) {
    throw new BackupValidationError(
      'Стара зміна не може завершуватись раніше приходу.'
    );
  }

  const shift: Shift = {
    id,
    date: startTime.slice(0, 10),
    type,
    detectionMode: 'manual',
    plannedStartTime: PLANNED_SHIFTS[type].start,
    plannedEndTime: PLANNED_SHIFTS[type].end,
    startTime,
    endTime,
    baseHourlyRateSnapshot,
    hourlyRateSnapshot: baseHourlyRateSnapshot,
    gradeSnapshot: null,
    workTickets: [],
    coefficientMode,
    isAutoClosed: false,
    createdAt: startTime,
    updatedAt: endTime ?? exportedAt
  };

  return normalizeShiftRecord(shift);
};

export const parseBackupImportJson = (source: string): ParsedBackupImport => {
  const parsed = parseJsonRecord(source);

  if (Object.hasOwn(parsed, 'schemaVersion')) {
    return {
      kind: 'shifter',
      backup: parseBackupJson(source)
    };
  }

  if (parsed.version !== 1) {
    throw new BackupValidationError('Версія backup несумісна з цією версією додатку.');
  }

  if (!isIsoLikeDateTime(parsed.exportedAt)) {
    throw new BackupValidationError('exportedAt старого backup має бути валідною датою.');
  }

  if (!Array.isArray(parsed.shifts)) {
    throw new BackupValidationError('shifts старого backup має бути масивом.');
  }

  const shifts = parsed.shifts.map((shift) =>
    parseLegacyShift(shift, parsed.exportedAt as string)
  );

  validateDomainInvariants(shifts, []);

  return {
    kind: 'legacy',
    exportedAt: parsed.exportedAt,
    shifts
  };
};

export const createBackup = async (
  db: ShifterDatabase,
  exportedAt = new Date().toISOString()
): Promise<ShifterBackup> => {
  const reviewRepository = new ScheduleWarningReviewRepository(db);
  const [settingsRecord, shifts, enterpriseSchedule, reviewedScheduleWarnings] =
    await Promise.all([
      db.settings.get(SETTINGS_ID),
      db.shifts.toArray(),
      db.enterpriseSchedule.toArray(),
      reviewRepository.getAll()
    ]);

  const settings = settingsRecord
    ? normalizeSettingsRecord(settingsRecord, new Date(exportedAt))
    : DEFAULT_SETTINGS;

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    settings,
    shifts: shifts.map(normalizeShiftRecord),
    enterpriseSchedule,
    reviewedScheduleWarnings
  };
};

export const serializeBackup = (backup: ShifterBackup): string =>
  `${JSON.stringify(
    {
      ...backup,
      reviewedScheduleWarnings: backup.reviewedScheduleWarnings
    },
    null,
    2
  )}\n`;

export const restoreBackup = async (
  db: ShifterDatabase,
  backup: ShifterBackup
): Promise<Settings> => {
  const normalizedShifts = backup.shifts.map(normalizeShiftRecord);
  const calendarTutorialSeenRecord = await db.appMeta.get(CALENDAR_TUTORIAL_SEEN_KEY);

  validateDomainInvariants(
    normalizedShifts,
    backup.enterpriseSchedule,
    backup.reviewedScheduleWarnings
  );

  const settingsRecord: SettingsRecord = {
    ...backup.settings,
    id: SETTINGS_ID
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

      if (calendarTutorialSeenRecord?.value === 'true') {
        await db.appMeta.put(calendarTutorialSeenRecord);
      }

      if (normalizedShifts.length > 0) {
        await db.shifts.bulkPut(normalizedShifts);
      }

      if (backup.enterpriseSchedule.length > 0) {
        await db.enterpriseSchedule.bulkPut(backup.enterpriseSchedule);
      }

      if (backup.reviewedScheduleWarnings.length > 0) {
        await db.appMeta.bulkPut(
          backup.reviewedScheduleWarnings.map(toScheduleWarningReviewRecord)
        );
      }
    }
  );

  return backup.settings;
};

export const replaceShiftsFromLegacyBackup = async (
  db: ShifterDatabase,
  shifts: Shift[]
): Promise<Shift[]> => {
  const normalizedShifts = shifts.map(normalizeShiftRecord);

  validateDomainInvariants(normalizedShifts, []);

  await db.transaction('rw', db.shifts, db.appMeta, async () => {
    await db.shifts.clear();
    await db.appMeta
      .where('key')
      .startsWith(SCHEDULE_WARNING_REVIEW_PREFIX)
      .delete();

    if (normalizedShifts.length > 0) {
      await db.shifts.bulkPut(normalizedShifts);
    }
  });

  return normalizedShifts;
};
