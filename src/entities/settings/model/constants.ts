import type {
  BackupReminderIntervalDays,
  OvertimeStrategy,
  Settings,
  ThemePreference
} from './types';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export const DEFAULT_THEME_PREFERENCE = 'system' as const;

export const isThemePreference = (value: unknown): value is ThemePreference =>
  typeof value === 'string' && THEME_PREFERENCES.includes(value as ThemePreference);

export const GRADE_VALUES = [1, 2, 3, 4] as const;
export const DEFAULT_GRADE_SALARY_BONUS_PERCENTS = [10, 10, 15, 15] as const;
export const DEFAULT_GRADE_NORM_PERCENTS = [100, 120, 140, 160] as const;
export const BACKUP_REMINDER_INTERVAL_DAYS = [7, 14, 30] as const;
export const DEFAULT_BACKUP_REMINDER_INTERVAL_DAYS: BackupReminderIntervalDays = 14;
export const OVERTIME_STRATEGIES = [
  'standard',
  'standard-plus',
  'standard-plus-plus'
] as const;
export const DEFAULT_OVERTIME_STRATEGY: OvertimeStrategy = 'standard';
export const OVERTIME_STEP_MINUTES_MIN = 5;
export const OVERTIME_STEP_MINUTES_MAX = 480;
export const DEFAULT_OVERTIME_STEP_MINUTES = 30;
export const OVERTIME_DAILY_MAX_MINUTES_MIN = 5;
export const OVERTIME_DAILY_MAX_MINUTES_MAX = 12 * 60;
export const DEFAULT_OVERTIME_WEEKDAY_MAX_MINUTES = 4 * 60;
export const DEFAULT_OVERTIME_SATURDAY_MAX_MINUTES = 8 * 60;

export const isBackupReminderIntervalDays = (
  value: unknown
): value is BackupReminderIntervalDays =>
  typeof value === 'number' &&
  BACKUP_REMINDER_INTERVAL_DAYS.includes(value as BackupReminderIntervalDays);

export const isOvertimeStrategy = (value: unknown): value is OvertimeStrategy =>
  typeof value === 'string' && OVERTIME_STRATEGIES.includes(value as OvertimeStrategy);

export const isOvertimeStepMinutes = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= OVERTIME_STEP_MINUTES_MIN &&
  value <= OVERTIME_STEP_MINUTES_MAX &&
  value % 5 === 0;

export const isOvertimeDailyMaxMinutes = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= OVERTIME_DAILY_MAX_MINUTES_MIN &&
  value <= OVERTIME_DAILY_MAX_MINUTES_MAX &&
  value % 5 === 0;

export const DEFAULT_SETTINGS: Settings = {
  employeeFirstName: '',
  employeeLastName: '',
  monthlySalary: 0,
  monthlyBonus: 2000,
  currentGrade: 1,
  desiredGrade: 2,
  gradeSalaryBonusPercents: [...DEFAULT_GRADE_SALARY_BONUS_PERCENTS],
  gradeNormPercents: [...DEFAULT_GRADE_NORM_PERCENTS],
  forecastDays: 30,
  arriveHoldDelayMs: 1500,
  leaveHoldDelayMs: 1500,
  shiftDetectionMode: 'auto',
  themePreference: DEFAULT_THEME_PREFERENCE,
  backupReminderIntervalDays: DEFAULT_BACKUP_REMINDER_INTERVAL_DAYS,
  overtimeLimitPercent: 0,
  overtimeStepMinutes: DEFAULT_OVERTIME_STEP_MINUTES,
  overtimeStrategy: DEFAULT_OVERTIME_STRATEGY,
  overtimeWeekdayMaxMinutes: DEFAULT_OVERTIME_WEEKDAY_MAX_MINUTES,
  overtimeSaturdayMaxMinutes: DEFAULT_OVERTIME_SATURDAY_MAX_MINUTES,
  incognitoEnabled: false,
  onboardingCompleted: false,
  updatedAt: new Date(0).toISOString()
};

export const HOLD_DELAY_MIN_MS = 300;
export const HOLD_DELAY_MAX_MS = 5000;
export const FORECAST_DAYS_MIN = 1;
export const FORECAST_DAYS_MAX = 366;
export const OVERTIME_LIMIT_PERCENT_MIN = 0;
export const OVERTIME_LIMIT_PERCENT_MAX = 100;
