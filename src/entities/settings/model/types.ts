import type { CoefficientMode, ShiftDetectionMode, ShiftTemplate } from '../../shift';

export type Grade = 1 | 2 | 3 | 4;

export type GradePercentSet = [number, number, number, number];

export type ThemePreference = 'system' | 'light' | 'dark';

export type NotificationPreferenceItem = {
  enabled: boolean;
  minutes: number;
};

export type NotificationPreferences = {
  enabled: boolean;
  shiftStart: NotificationPreferenceItem;
  activeTicketEnd: NotificationPreferenceItem;
  unfinishedShift: NotificationPreferenceItem;
};

export type Settings = {
  employeeFirstName: string;
  employeeLastName: string;
  monthlySalary: number;
  monthlyBonus: number;
  currentGrade: Grade;
  desiredGrade: Grade;
  gradeSalaryBonusPercents: GradePercentSet;
  gradeNormPercents: GradePercentSet;
  forecastDays: number;
  arriveHoldDelayMs: number;
  leaveHoldDelayMs: number;
  coefficientMode: CoefficientMode;
  shiftDetectionMode: ShiftDetectionMode;
  shiftTemplates: ShiftTemplate[];
  notificationPreferences: NotificationPreferences;
  themePreference: ThemePreference;
  incognitoEnabled: boolean;
  onboardingCompleted: boolean;
  updatedAt: string;
};
