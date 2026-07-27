import type { NotificationPreferences, Settings, ThemePreference } from './types';

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const;
export const DEFAULT_THEME_PREFERENCE = 'system' as const;

export const isThemePreference = (value: unknown): value is ThemePreference =>
  typeof value === 'string' && THEME_PREFERENCES.includes(value as ThemePreference);

export const GRADE_VALUES = [1, 2, 3, 4] as const;
export const DEFAULT_GRADE_SALARY_BONUS_PERCENTS = [10, 10, 10, 10] as const;
export const DEFAULT_GRADE_NORM_PERCENTS = [100, 120, 140, 160] as const;
export const NOTIFICATION_MINUTES_MIN = 1;
export const NOTIFICATION_MINUTES_MAX = 180;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: false,
  shiftStart: {
    enabled: true,
    minutes: 15
  },
  activeTicketEnd: {
    enabled: true,
    minutes: 10
  },
  unfinishedShift: {
    enabled: true,
    minutes: 15
  }
};

const DEFAULT_SHIFT_TEMPLATES: Settings['shiftTemplates'] = [
  {
    id: 'first',
    name: '1 зміна',
    startTime: '06:30',
    endTime: '14:30',
    isBuiltIn: true,
    enabled: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  },
  {
    id: 'second',
    name: '2 зміна',
    startTime: '14:30',
    endTime: '22:30',
    isBuiltIn: true,
    enabled: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  }
];

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
  coefficientMode: 'auto',
  shiftDetectionMode: 'auto',
  shiftTemplates: DEFAULT_SHIFT_TEMPLATES.map((template) => ({ ...template })),
  notificationPreferences: {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    shiftStart: { ...DEFAULT_NOTIFICATION_PREFERENCES.shiftStart },
    activeTicketEnd: { ...DEFAULT_NOTIFICATION_PREFERENCES.activeTicketEnd },
    unfinishedShift: { ...DEFAULT_NOTIFICATION_PREFERENCES.unfinishedShift }
  },
  themePreference: DEFAULT_THEME_PREFERENCE,
  incognitoEnabled: false,
  onboardingCompleted: false,
  updatedAt: new Date(0).toISOString()
};

export const HOLD_DELAY_MIN_MS = 300;
export const HOLD_DELAY_MAX_MS = 5000;
export const FORECAST_DAYS_MIN = 1;
export const FORECAST_DAYS_MAX = 366;
