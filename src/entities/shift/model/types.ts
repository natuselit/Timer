import type { Grade, GradePercentSet } from '../../settings';

export type ShiftTemplateId = string;

/**
 * @deprecated Залишено як сумісний alias для старих backup і UI. Значенням є id шаблону.
 */
export type ShiftType = ShiftTemplateId;

export type ShiftTemplate = {
  id: ShiftTemplateId;
  name: string;
  startTime: LocalTimeString;
  endTime: LocalTimeString;
  isBuiltIn: boolean;
  enabled: boolean;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
};

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
  templateId?: ShiftTemplateId;
  templateNameSnapshot?: string;
  detectionMode: ShiftDetectionMode;
  plannedStartTime: LocalTimeString;
  plannedEndTime: LocalTimeString;
  startTime: ISODateTimeString;
  endTime: ISODateTimeString | null;
  baseHourlyRateSnapshot: number;
  hourlyRateSnapshot: number;
  gradeSnapshot: GradeSnapshot | null;
  workTickets: WorkTicket[];
  coefficientMode: CoefficientMode;
  isAutoClosed: boolean;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
};
