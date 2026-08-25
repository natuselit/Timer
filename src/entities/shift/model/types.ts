import type {
  GradeSnapshot,
  ISODateTimeString,
  LocalDateString,
  LocalTimeString,
  ShiftDetectionMode
} from '../../../shared/model';

export type {
  Grade,
  GradePercentSet,
  GradeSnapshot,
  ISODateTimeString,
  LocalDateString,
  LocalTimeString,
  ShiftDetectionMode
} from '../../../shared/model';

export type ShiftType = 'first' | 'second';

export type CoefficientMode = 'auto' | 'x1' | 'x1.5' | 'x2';

export type WorkTicket = {
  id: string;
  normPerEightHours: number;
  startedAt: ISODateTimeString;
  endedAt: ISODateTimeString | null;
  actualQuantity: number | null;
  manualCompletionPercent: number | null;
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
