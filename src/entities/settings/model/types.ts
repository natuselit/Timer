import type { CoefficientMode, ShiftDetectionMode } from '../../shift';

export type Grade = 1 | 2 | 3 | 4;

export type GradePercentSet = [number, number, number, number];

export type ThemePreference = 'system' | 'light' | 'dark';

export type BackupReminderIntervalDays = 7 | 14 | 30;

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
  themePreference: ThemePreference;
  backupReminderIntervalDays: BackupReminderIntervalDays;
  incognitoEnabled: boolean;
  onboardingCompleted: boolean;
  updatedAt: string;
};
