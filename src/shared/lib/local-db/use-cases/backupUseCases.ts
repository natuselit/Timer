import {
  DEFAULT_SETTINGS,
  DEFAULT_NOTIFICATION_PREFERENCES,
  FORECAST_DAYS_MAX,
  FORECAST_DAYS_MIN,
  GRADE_VALUES,
  HOLD_DELAY_MAX_MS,
  HOLD_DELAY_MIN_MS,
  calculateMonthlySalaryFromHourlyRate,
  isThemePreference,
  type Grade,
  type GradePercentSet,
  type NotificationPreferences,
  type Settings
} from '../../../../entities/settings';
import type { EnterpriseScheduleItem } from '../../../../entities/enterprise-schedule';
import {
  getBuiltInShiftTemplate,
  normalizeShiftTemplates,
  validateAndSortWorkTickets,
  validateShiftTemplates,
  type CoefficientMode,
  type GradeSnapshot,
  type LocalDateString,
  type Shift,
  type ShiftDetectionMode,
  type ShiftTemplate,
  type ShiftType,
  type WorkTicket
} from '../../../../entities/shift';
import type { ShifterDatabase } from '../database';
import { normalizeSettingsRecord } from '../repositories/settingsRepository';
import { normalizeShiftRecord } from '../repositories/shiftRepository';
import type { SettingsRecord } from '../types';

export const LEGACY_BACKUP_SCHEMA_VERSION = 1;
const GRADE_AND_TICKETS_BACKUP_SCHEMA_VERSION = 3;
const THEME_BACKUP_SCHEMA_VERSION = 4;
const TICKET_PRODUCTION_BACKUP_SCHEMA_VERSION = 5;
const MANUAL_DOWNTIME_BACKUP_SCHEMA_VERSION = 6;
const SHIFT_TEMPLATES_BACKUP_SCHEMA_VERSION = 7;
export const BACKUP_SCHEMA_VERSION = SHIFT_TEMPLATES_BACKUP_SCHEMA_VERSION;
const SUPPORTED_BACKUP_SCHEMA_VERSIONS = new Set<number>([
  LEGACY_BACKUP_SCHEMA_VERSION,
  2,
  GRADE_AND_TICKETS_BACKUP_SCHEMA_VERSION,
  THEME_BACKUP_SCHEMA_VERSION,
  TICKET_PRODUCTION_BACKUP_SCHEMA_VERSION,
  MANUAL_DOWNTIME_BACKUP_SCHEMA_VERSION,
  SHIFT_TEMPLATES_BACKUP_SCHEMA_VERSION
]);

type BackupSchemaVersion = typeof BACKUP_SCHEMA_VERSION;

export type ShifterBackup = {
  schemaVersion: BackupSchemaVersion;
  exportedAt: string;
  settings: Settings;
  shifts: Shift[];
  enterpriseSchedule: EnterpriseScheduleItem[];
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
    throw new BackupValidationError(`Поле ${key} має бути грейдом від 1 до 4.`);
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

const parseNotificationPreferenceItem = (
  value: unknown,
  field: string
): NotificationPreferences['shiftStart'] => {
  if (!isRecord(value)) {
    throw new BackupValidationError(`${field} має бути обʼєктом.`);
  }

  return {
    enabled: readBoolean(value, 'enabled'),
    minutes: readIntegerInRange(value, 'minutes', 1, 180)
  };
};

const parseNotificationPreferences = (value: unknown): NotificationPreferences => {
  if (!isRecord(value)) {
    throw new BackupValidationError('settings.notificationPreferences має бути обʼєктом.');
  }

  return {
    enabled: readBoolean(value, 'enabled'),
    shiftStart: parseNotificationPreferenceItem(
      value.shiftStart,
      'settings.notificationPreferences.shiftStart'
    ),
    activeTicketEnd: parseNotificationPreferenceItem(
      value.activeTicketEnd,
      'settings.notificationPreferences.activeTicketEnd'
    ),
    unfinishedShift: parseNotificationPreferenceItem(
      value.unfinishedShift,
      'settings.notificationPreferences.unfinishedShift'
    )
  };
};

const parseShiftTemplates = (value: unknown): ShiftTemplate[] => {
  if (!Array.isArray(value)) {
    throw new BackupValidationError('settings.shiftTemplates має бути масивом.');
  }

  const templates = value.map((item) => {
    if (!isRecord(item)) {
      throw new BackupValidationError('Кожен шаблон зміни має бути обʼєктом.');
    }

    const template: ShiftTemplate = {
      id: readString(item, 'id'),
      name: readString(item, 'name'),
      startTime: readString(item, 'startTime'),
      endTime: readString(item, 'endTime'),
      isBuiltIn: readBoolean(item, 'isBuiltIn'),
      enabled: readBoolean(item, 'enabled'),
      createdAt: readString(item, 'createdAt'),
      updatedAt: readString(item, 'updatedAt')
    };

    if (
      !isLocalTime(template.startTime) ||
      !isLocalTime(template.endTime) ||
      !isIsoLikeDateTime(template.createdAt) ||
      !isIsoLikeDateTime(template.updatedAt)
    ) {
      throw new BackupValidationError('Шаблон зміни містить невалідний час.');
    }

    return template;
  });

  try {
    validateShiftTemplates(templates);
    const normalized = normalizeShiftTemplates(templates);
    validateShiftTemplates(normalized);
    return normalized;
  } catch (error) {
    throw new BackupValidationError(
      error instanceof Error ? error.message : 'Шаблони змін невалідні.'
    );
  }
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
      schemaVersion >= GRADE_AND_TICKETS_BACKUP_SCHEMA_VERSION
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
    shiftTemplates:
      schemaVersion >= SHIFT_TEMPLATES_BACKUP_SCHEMA_VERSION
        ? parseShiftTemplates(value.shiftTemplates)
        : DEFAULT_SETTINGS.shiftTemplates.map((template) => ({ ...template })),
    notificationPreferences:
      schemaVersion >= SHIFT_TEMPLATES_BACKUP_SCHEMA_VERSION
        ? parseNotificationPreferences(value.notificationPreferences)
        : {
            ...DEFAULT_NOTIFICATION_PREFERENCES,
            shiftStart: { ...DEFAULT_NOTIFICATION_PREFERENCES.shiftStart },
            activeTicketEnd: { ...DEFAULT_NOTIFICATION_PREFERENCES.activeTicketEnd },
            unfinishedShift: { ...DEFAULT_NOTIFICATION_PREFERENCES.unfinishedShift }
          },
    themePreference:
      schemaVersion >= THEME_BACKUP_SCHEMA_VERSION
        ? (themePreference as Settings['themePreference'])
        : DEFAULT_SETTINGS.themePreference,
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

  if (
    !isString(type) ||
    (schemaVersion < SHIFT_TEMPLATES_BACKUP_SCHEMA_VERSION &&
      !SHIFT_TYPES.has(type as ShiftType))
  ) {
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
    templateId:
      schemaVersion >= SHIFT_TEMPLATES_BACKUP_SCHEMA_VERSION &&
      isString(value.templateId)
        ? readString(value, 'templateId')
        : (type as ShiftType),
    templateNameSnapshot:
      schemaVersion >= SHIFT_TEMPLATES_BACKUP_SCHEMA_VERSION &&
      isString(value.templateNameSnapshot)
        ? readString(value, 'templateNameSnapshot')
        : getBuiltInShiftTemplate(type as ShiftType)?.name ?? 'Власна зміна',
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

const parseEnterpriseScheduleItem = (
  value: unknown,
  schemaVersion: number
): EnterpriseScheduleItem => {
  if (!isRecord(value)) {
    throw new BackupValidationError('Кожен запис графіка має бути обʼєктом.');
  }

  const shiftType = value.shiftType;

  if (
    !isString(shiftType) ||
    (schemaVersion < SHIFT_TEMPLATES_BACKUP_SCHEMA_VERSION &&
      !SHIFT_TYPES.has(shiftType as ShiftType))
  ) {
    throw new BackupValidationError('enterpriseSchedule.shiftType має несумісне значення.');
  }

  const item: EnterpriseScheduleItem = {
    id: readString(value, 'id'),
    date: readString(value, 'date'),
    shiftType: shiftType as ShiftType,
    templateId:
      schemaVersion >= SHIFT_TEMPLATES_BACKUP_SCHEMA_VERSION &&
      isString(value.templateId)
        ? readString(value, 'templateId')
        : (shiftType as ShiftType),
    templateNameSnapshot:
      schemaVersion >= SHIFT_TEMPLATES_BACKUP_SCHEMA_VERSION &&
      isString(value.templateNameSnapshot)
        ? readString(value, 'templateNameSnapshot')
        : getBuiltInShiftTemplate(shiftType as ShiftType)?.name ?? 'Власна зміна',
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

const validateDomainInvariants = (
  shifts: Shift[],
  enterpriseSchedule: EnterpriseScheduleItem[]
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
};

export const parseBackupJson = (source: string): ShifterBackup => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(source);
  } catch {
    throw new BackupValidationError('Файл не є валідним JSON.');
  }

  if (!isRecord(parsed)) {
    throw new BackupValidationError('Backup має бути JSON-обʼєктом.');
  }

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

  const backup: ShifterBackup = {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: parsed.exportedAt,
    settings: parseSettings(parsed.settings, sourceSchemaVersion, parsed.exportedAt),
    shifts: parsed.shifts.map((shift) =>
      parseShift(shift, sourceSchemaVersion, parsed.exportedAt as string)
    ),
    enterpriseSchedule: parsed.enterpriseSchedule.map((item) =>
      parseEnterpriseScheduleItem(item, sourceSchemaVersion)
    )
  };

  validateDomainInvariants(backup.shifts, backup.enterpriseSchedule);

  return backup;
};

export const createBackup = async (
  db: ShifterDatabase,
  exportedAt = new Date().toISOString()
): Promise<ShifterBackup> => {
  const [settingsRecord, shifts, enterpriseSchedule] = await Promise.all([
    db.settings.get(SETTINGS_ID),
    db.shifts.toArray(),
    db.enterpriseSchedule.toArray()
  ]);

  const settings = settingsRecord
    ? normalizeSettingsRecord(settingsRecord, new Date(exportedAt))
    : DEFAULT_SETTINGS;

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt,
    settings,
    shifts: shifts.map(normalizeShiftRecord),
    enterpriseSchedule
  };
};

export const serializeBackup = (backup: ShifterBackup): string =>
  `${JSON.stringify(backup, null, 2)}\n`;

export const restoreBackup = async (
  db: ShifterDatabase,
  backup: ShifterBackup
): Promise<Settings> => {
  const normalizedShifts = backup.shifts.map(normalizeShiftRecord);

  validateDomainInvariants(normalizedShifts, backup.enterpriseSchedule);

  const settingsRecord: SettingsRecord = {
    ...backup.settings,
    id: SETTINGS_ID
  };
  const securityMetaRecords = (
    await db.appMeta.where('key').startsWith('security-').toArray()
  );

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

      if (securityMetaRecords.length > 0) {
        await db.appMeta.bulkPut(securityMetaRecords);
      }

      if (normalizedShifts.length > 0) {
        await db.shifts.bulkPut(normalizedShifts);
      }

      if (backup.enterpriseSchedule.length > 0) {
        await db.enterpriseSchedule.bulkPut(backup.enterpriseSchedule);
      }
    }
  );

  return backup.settings;
};
