import {
  calculateMonthlySalaryFromHourlyRate,
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_SETTINGS,
  GRADE_VALUES,
  isThemePreference,
  type Grade,
  type GradePercentSet,
  type Settings
} from '../../../../entities/settings';
import {
  normalizeShiftTemplates,
  type ShiftTemplate
} from '../../../../entities/shift';
import type { ShifterDatabase } from '../database';
import type { SettingsRecord } from '../types';

const SETTINGS_ID: SettingsRecord['id'] = 'default';

type LegacySettingsRecord = Partial<SettingsRecord> & {
  hourlyRate?: unknown;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isGrade = (value: unknown): value is Grade =>
  typeof value === 'number' && GRADE_VALUES.includes(value as Grade);

const normalizePercentSet = (
  value: unknown,
  fallback: GradePercentSet
): GradePercentSet => {
  if (!Array.isArray(value) || value.length !== fallback.length) {
    return [...fallback] as GradePercentSet;
  }

  const percents = value.map((item, index) =>
    isFiniteNumber(item) && item >= 0 ? item : fallback[index]
  );

  return percents as GradePercentSet;
};

const toLocalDateString = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
  date.getDate()
  ).padStart(2, '0')}`;

const normalizeNotificationItem = (
  value: unknown,
  fallback: Settings['notificationPreferences']['shiftStart']
): Settings['notificationPreferences']['shiftStart'] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...fallback };
  }

  const candidate = value as Partial<Settings['notificationPreferences']['shiftStart']>;

  return {
    enabled:
      typeof candidate.enabled === 'boolean' ? candidate.enabled : fallback.enabled,
    minutes:
      Number.isSafeInteger(candidate.minutes) &&
      candidate.minutes! >= 1 &&
      candidate.minutes! <= 180
        ? candidate.minutes!
        : fallback.minutes
  };
};

const normalizeNotificationPreferences = (
  value: unknown
): Settings['notificationPreferences'] => {
  const candidate =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Partial<Settings['notificationPreferences']>)
      : {};

  return {
    enabled:
      typeof candidate.enabled === 'boolean'
        ? candidate.enabled
        : DEFAULT_NOTIFICATION_PREFERENCES.enabled,
    shiftStart: normalizeNotificationItem(
      candidate.shiftStart,
      DEFAULT_NOTIFICATION_PREFERENCES.shiftStart
    ),
    activeTicketEnd: normalizeNotificationItem(
      candidate.activeTicketEnd,
      DEFAULT_NOTIFICATION_PREFERENCES.activeTicketEnd
    ),
    unfinishedShift: normalizeNotificationItem(
      candidate.unfinishedShift,
      DEFAULT_NOTIFICATION_PREFERENCES.unfinishedShift
    )
  };
};

export const normalizeSettingsRecord = (
  record: LegacySettingsRecord,
  migrationDate = new Date()
): Settings => {
  const { id: _id, hourlyRate: legacyHourlyRate, ...storedSettings } = record;
  const monthlySalary = isFiniteNumber(storedSettings.monthlySalary)
    ? storedSettings.monthlySalary
    : isFiniteNumber(legacyHourlyRate)
      ? calculateMonthlySalaryFromHourlyRate(legacyHourlyRate, toLocalDateString(migrationDate))
      : DEFAULT_SETTINGS.monthlySalary;
  const currentGrade = isGrade(storedSettings.currentGrade)
    ? storedSettings.currentGrade
    : DEFAULT_SETTINGS.currentGrade;
  const desiredGrade = isGrade(storedSettings.desiredGrade)
    ? storedSettings.desiredGrade
    : DEFAULT_SETTINGS.desiredGrade;

  return {
    ...DEFAULT_SETTINGS,
    ...storedSettings,
    monthlySalary,
    currentGrade,
    desiredGrade: desiredGrade < currentGrade ? currentGrade : desiredGrade,
    gradeSalaryBonusPercents: normalizePercentSet(
      storedSettings.gradeSalaryBonusPercents,
      DEFAULT_SETTINGS.gradeSalaryBonusPercents
    ),
    gradeNormPercents: normalizePercentSet(
      storedSettings.gradeNormPercents,
      DEFAULT_SETTINGS.gradeNormPercents
    ),
    shiftTemplates: normalizeShiftTemplates(
      storedSettings.shiftTemplates as ShiftTemplate[] | undefined
    ),
    notificationPreferences: normalizeNotificationPreferences(
      storedSettings.notificationPreferences
    ),
    themePreference: isThemePreference(storedSettings.themePreference)
      ? storedSettings.themePreference
      : DEFAULT_SETTINGS.themePreference
  };
};

export class SettingsRepository {
  constructor(private readonly db: ShifterDatabase) {}

  async getSettings(): Promise<Settings> {
    const settings = await this.db.settings.get(SETTINGS_ID);

    if (!settings) {
      return DEFAULT_SETTINGS;
    }

    return normalizeSettingsRecord(settings);
  }

  async saveSettings(settings: Settings): Promise<Settings> {
    const record: SettingsRecord = {
      ...settings,
      id: SETTINGS_ID
    };

    await this.db.settings.put(record);

    return settings;
  }
}
