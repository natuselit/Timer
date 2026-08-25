export type Grade = 1 | 2 | 3 | 4;

export type GradePercentSet = [number, number, number, number];

export type LocalDateString = string;

export type LocalTimeString = string;

export type ISODateTimeString = string;

export type ShiftDetectionMode = 'auto' | 'manual';

export type GradeSnapshot = {
  currentGrade: Grade;
  desiredGrade: Grade;
  gradeSalaryBonusPercents: GradePercentSet;
  gradeNormPercents: GradePercentSet;
  cumulativeSalaryBonusPercent: number;
};
