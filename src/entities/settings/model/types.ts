import type { Grade, GradePercentSet, ShiftDetectionMode } from '../../../shared/model';

export type { Grade, GradePercentSet, ShiftDetectionMode } from '../../../shared/model';

export type ThemePreference = 'system' | 'light' | 'dark';

export type BackupReminderIntervalDays = 7 | 14 | 30;

export type OvertimeStrategy = 'standard' | 'standard-plus' | 'standard-plus-plus';

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
  shiftDetectionMode: ShiftDetectionMode;
  themePreference: ThemePreference;
  backupReminderIntervalDays: BackupReminderIntervalDays;
  overtimeLimitPercent: number;
  overtimeStepMinutes: number;
  overtimeStrategy: OvertimeStrategy;
  overtimeWeekdayMaxMinutes: number;
  overtimeSaturdayMaxMinutes: number;
  overtimeUnavailableDates: string[];
  incognitoEnabled: boolean;
  onboardingCompleted: boolean;
  updatedAt: string;
};
