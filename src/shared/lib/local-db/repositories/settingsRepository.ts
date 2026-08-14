import {
  calculateMonthlySalaryFromHourlyRate,
  DEFAULT_SETTINGS,
  GRADE_VALUES,
  isBackupReminderIntervalDays,
  isOvertimeDailyMaxMinutes,
  isOvertimeStepMinutes,
  isOvertimeStrategy,
  isOvertimeUnavailableDates,
  isThemePreference,
  type Grade,
  type GradePercentSet,
  type OvertimeStrategy,
  type Settings
} from '../../../../entities/settings';
import type { ShifterDatabase } from '../database';
import type { SettingsRecord } from '../types';

const SETTINGS_ID: SettingsRecord['id'] = 'default';

type LegacySettingsRecord = Omit<Partial<SettingsRecord>, 'overtimeStrategy'> & {
  hourlyRate?: unknown;
  overtimeStrategy?: unknown;
  coefficientMode?: unknown;
  overtimeUnavailableDates?: unknown;
  overtimeSaturdayCount?: unknown;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isGrade = (value: unknown): value is Grade =>
  typeof value === 'number' && GRADE_VALUES.includes(value as Grade);

export const normalizeOvertimeStrategy = (
  value: unknown,
  legacySaturdayCount: unknown
): OvertimeStrategy => {
  if (isOvertimeStrategy(value)) {
    return value;
  }

  if (value === 'saturdays') {
    return 'standard-plus-plus';
  }

  if (value === 'custom' && Number.isSafeInteger(legacySaturdayCount)) {
    if ((legacySaturdayCount as number) >= 4 && (legacySaturdayCount as number) <= 5) {
      return 'standard-plus-plus';
    }

    if (legacySaturdayCount === 3) {
      return 'standard-plus';
    }
  }

  return DEFAULT_SETTINGS.overtimeStrategy;
};

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

export const normalizeSettingsRecord = (
  record: LegacySettingsRecord,
  migrationDate = new Date()
): Settings => {
  const {
    id: _id,
    hourlyRate: legacyHourlyRate,
    coefficientMode: _legacyCoefficientMode,
    overtimeSaturdayCount: legacyOvertimeSaturdayCount,
    ...storedSettings
  } = record;
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
    themePreference: isThemePreference(storedSettings.themePreference)
      ? storedSettings.themePreference
      : DEFAULT_SETTINGS.themePreference,
    backupReminderIntervalDays: isBackupReminderIntervalDays(
      storedSettings.backupReminderIntervalDays
    )
      ? storedSettings.backupReminderIntervalDays
      : DEFAULT_SETTINGS.backupReminderIntervalDays,
    overtimeLimitPercent:
      isFiniteNumber(storedSettings.overtimeLimitPercent) &&
      storedSettings.overtimeLimitPercent >= 0 &&
      storedSettings.overtimeLimitPercent <= 100
        ? storedSettings.overtimeLimitPercent
        : DEFAULT_SETTINGS.overtimeLimitPercent,
    overtimeStepMinutes: isOvertimeStepMinutes(storedSettings.overtimeStepMinutes)
      ? storedSettings.overtimeStepMinutes
      : DEFAULT_SETTINGS.overtimeStepMinutes,
    overtimeStrategy: normalizeOvertimeStrategy(
      storedSettings.overtimeStrategy,
      legacyOvertimeSaturdayCount
    ),
    overtimeWeekdayMaxMinutes: isOvertimeDailyMaxMinutes(
      storedSettings.overtimeWeekdayMaxMinutes
    )
      ? storedSettings.overtimeWeekdayMaxMinutes
      : DEFAULT_SETTINGS.overtimeWeekdayMaxMinutes,
    overtimeSaturdayMaxMinutes: isOvertimeDailyMaxMinutes(
      storedSettings.overtimeSaturdayMaxMinutes
    )
      ? storedSettings.overtimeSaturdayMaxMinutes
      : DEFAULT_SETTINGS.overtimeSaturdayMaxMinutes,
    overtimeUnavailableDates: isOvertimeUnavailableDates(
      storedSettings.overtimeUnavailableDates
    )
      ? [...storedSettings.overtimeUnavailableDates].sort()
      : DEFAULT_SETTINGS.overtimeUnavailableDates
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
