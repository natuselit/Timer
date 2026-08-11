import type { Grade, GradePercentSet } from '../../settings';

export type ShiftType = 'first' | 'second';

export type CoefficientMode = 'auto' | 'x1' | 'x1.5' | 'x2';

export type ShiftDetectionMode = 'auto' | 'manual';

export type LocalDateString = string;

export type LocalTimeString = string;

export type ISODateTimeString = string;

export type GradeSnapshot = {
  currentGrade: Grade;
  desiredGrade: Grade;
  gradeSalaryBonusPercents: GradePercentSet;
  gradeNormPercents: GradePercentSet;
  cumulativeSalaryBonusPercent: number;
};

export type WorkTicket = {
  id: string;
  normPerEightHours: number;
  startedAt: ISODateTimeString;
  endedAt: ISODateTimeString | null;
  actualQuantity: number | null;
  downtimeMinutes: number;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
};

export type Shift = {
  id: string;
  date: LocalDateString;
  type: ShiftType;
  detectionMode: ShiftDetectionMode;
  plannedStartTime: LocalTimeString;
  plannedEndTime: LocalTimeString;
  startTime: ISODateTimeString;
  endTime: ISODateTimeString | null;
  baseHourlyRateSnapshot: number;
  hourlyRateSnapshot: number;
  gradeSnapshot: GradeSnapshot | null;
  workTickets: WorkTicket[];
  note: string;
  coefficientMode: CoefficientMode;
  isAutoClosed: boolean;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
};
