import {
  detectShiftType,
  getPlannedShiftWindow,
  type CoefficientMode,
  type GradeSnapshot,
  type ISODateTimeString,
  type LocalDateString,
  type ShiftType,
  type Shift,
  type WorkTicket
} from '../../../../entities/shift';
import type { Settings } from '../../../../entities/settings';
import type { ShiftRepository } from '../repositories/shiftRepository';

export type CreateShiftInput = {
  startTime: ISODateTimeString;
  baseHourlyRateSnapshot?: number;
  hourlyRateSnapshot: number;
  gradeSnapshot?: GradeSnapshot | null;
  workTickets?: WorkTicket[];
  coefficientMode?: CoefficientMode;
  id?: string;
  now?: ISODateTimeString;
};

export type CreateManualShiftInput = {
  date: LocalDateString;
  type: ShiftType;
  startTime: ISODateTimeString;
  endTime: ISODateTimeString;
  baseHourlyRateSnapshot?: number;
  hourlyRateSnapshot: number;
  gradeSnapshot?: GradeSnapshot | null;
  workTickets?: WorkTicket[];
  coefficientMode: CoefficientMode;
  id?: string;
  now?: ISODateTimeString;
};

export type AutoCloseActiveShiftInput = {
  now: ISODateTimeString;
  onAutoCloseDue?: (shift: Shift) => void;
};

type GradeSettings = Pick<
  Settings,
  'currentGrade' | 'desiredGrade' | 'gradeSalaryBonusPercents' | 'gradeNormPercents'
>;

const AUTO_CLOSE_DELAY_MS = 60 * 60 * 1000;

const getDateFromDateTime = (dateTime: ISODateTimeString): LocalDateString => {
  const [date] = dateTime.split('T');

  if (!date) {
    throw new Error(`Invalid date time: ${dateTime}`);
  }

  return date;
};

const createId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `shift-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const closeActiveWorkTickets = (
  workTickets: WorkTicket[],
  endedAt: ISODateTimeString
): WorkTicket[] =>
  workTickets.map((ticket) =>
    ticket.endedAt === null
      ? {
          ...ticket,
          endedAt,
          updatedAt: endedAt
        }
      : ticket
  );

export const closeShiftWorkTickets = (
  shift: Shift,
  endedAt: ISODateTimeString
): Shift => ({
  ...shift,
  workTickets: closeActiveWorkTickets(shift.workTickets, endedAt)
});

const assertTicketNorm = (normPerEightHours: number): void => {
  if (!Number.isFinite(normPerEightHours) || normPerEightHours <= 0) {
    throw new Error('Норма має бути більшою за 0.');
  }

  if (normPerEightHours > 999) {
    throw new Error('Норма має бути не більшою за 999.');
  }
};

export const createShift = (
  repository: ShiftRepository,
  input: CreateShiftInput
): Promise<Shift> => {
  const type = detectShiftType(input.startTime);
  const date = getDateFromDateTime(input.startTime);
  const plannedWindow = getPlannedShiftWindow(date, type, input.startTime);
  const now = input.now ?? new Date().toISOString();

  return repository.createShift({
    id: input.id ?? createId(),
    date,
    type,
    detectionMode: 'auto',
    plannedStartTime: plannedWindow.startTime,
    plannedEndTime: plannedWindow.endTime,
    startTime: input.startTime,
    endTime: null,
    baseHourlyRateSnapshot: input.baseHourlyRateSnapshot ?? input.hourlyRateSnapshot,
    hourlyRateSnapshot: input.hourlyRateSnapshot,
    gradeSnapshot: input.gradeSnapshot ?? null,
    workTickets: input.workTickets ?? [],
    coefficientMode: input.coefficientMode ?? 'auto',
    isAutoClosed: false,
    createdAt: now,
    updatedAt: now
  });
};

export const createManualShift = (
  repository: ShiftRepository,
  input: CreateManualShiftInput
): Promise<Shift> => {
  const plannedWindow = getPlannedShiftWindow(input.date, input.type, input.startTime);
  const now = input.now ?? new Date().toISOString();

  return repository.createShift({
    id: input.id ?? createId(),
    date: input.date,
    type: input.type,
    detectionMode: 'manual',
    plannedStartTime: plannedWindow.startTime,
    plannedEndTime: plannedWindow.endTime,
    startTime: input.startTime,
    endTime: input.endTime,
    baseHourlyRateSnapshot: input.baseHourlyRateSnapshot ?? input.hourlyRateSnapshot,
    hourlyRateSnapshot: input.hourlyRateSnapshot,
    gradeSnapshot: input.gradeSnapshot ?? null,
    workTickets: input.workTickets ?? [],
    coefficientMode: input.coefficientMode,
    isAutoClosed: false,
    createdAt: now,
    updatedAt: now
  });
};

export const updateShift = (
  repository: ShiftRepository,
  shift: Shift
): Promise<Shift> => repository.updateShift(shift);

export const recalculateHourlyRateSnapshotsForAllShifts = (
  repository: ShiftRepository,
  monthlySalary: number,
  gradeSettings: GradeSettings,
  updatedAt: ISODateTimeString
): Promise<number> =>
  repository.recalculateHourlyRateSnapshotsForAllShifts(monthlySalary, gradeSettings, updatedAt);

export const deleteShift = (repository: ShiftRepository, id: string): Promise<void> =>
  repository.deleteShift(id);

export const getShiftsByMonth = (
  repository: ShiftRepository,
  year: number,
  month: number
): Promise<Shift[]> => repository.getShiftsByMonth(year, month);

export const getShiftsBetween = (
  repository: ShiftRepository,
  start: LocalDateString,
  end: LocalDateString
): Promise<Shift[]> => repository.getShiftsBetween(start, end);

export const getActiveShift = (repository: ShiftRepository): Promise<Shift | null> =>
  repository.getActiveShift();

export const getLatestCompletedShift = (repository: ShiftRepository): Promise<Shift | null> =>
  repository.getLatestCompletedShift();

export const addWorkTicketToActiveShift = async (
  repository: ShiftRepository,
  input: {
    shiftId: string;
    normPerEightHours: number;
    startedAt: ISODateTimeString;
    id?: string;
  }
): Promise<Shift> => {
  assertTicketNorm(input.normPerEightHours);

  const shift = await repository.getShiftById(input.shiftId);

  if (!shift) {
    throw new Error(`Shift not found: ${input.shiftId}`);
  }

  if (shift.endTime !== null) {
    throw new Error('Не можна додати тікет до завершеної зміни.');
  }

  const ticket: WorkTicket = {
    id: input.id ?? createId(),
    normPerEightHours: input.normPerEightHours,
    startedAt: input.startedAt,
    endedAt: null,
    createdAt: input.startedAt,
    updatedAt: input.startedAt
  };

  return repository.updateShift({
    ...shift,
    workTickets: [...closeActiveWorkTickets(shift.workTickets, input.startedAt), ticket],
    updatedAt: input.startedAt
  });
};

export const updateWorkTicketInActiveShift = async (
  repository: ShiftRepository,
  input: {
    shiftId: string;
    ticketId: string;
    normPerEightHours: number;
    updatedAt: ISODateTimeString;
  }
): Promise<Shift> => {
  assertTicketNorm(input.normPerEightHours);

  const shift = await repository.getShiftById(input.shiftId);

  if (!shift) {
    throw new Error(`Shift not found: ${input.shiftId}`);
  }

  if (shift.endTime !== null) {
    throw new Error('Не можна редагувати тікет завершеної зміни.');
  }

  let didUpdateTicket = false;
  const workTickets = shift.workTickets.map((ticket) => {
    if (ticket.id !== input.ticketId) {
      return ticket;
    }

    didUpdateTicket = true;

    return {
      ...ticket,
      normPerEightHours: input.normPerEightHours,
      updatedAt: input.updatedAt
    };
  });

  if (!didUpdateTicket) {
    throw new Error(`Work ticket not found: ${input.ticketId}`);
  }

  return repository.updateShift({
    ...shift,
    workTickets,
    updatedAt: input.updatedAt
  });
};

export const deleteWorkTicketFromActiveShift = async (
  repository: ShiftRepository,
  input: {
    shiftId: string;
    ticketId: string;
    updatedAt: ISODateTimeString;
  }
): Promise<Shift> => {
  const shift = await repository.getShiftById(input.shiftId);

  if (!shift) {
    throw new Error(`Shift not found: ${input.shiftId}`);
  }

  if (shift.endTime !== null) {
    throw new Error('Не можна видалити тікет завершеної зміни.');
  }

  const workTickets = shift.workTickets.filter((ticket) => ticket.id !== input.ticketId);

  if (workTickets.length === shift.workTickets.length) {
    throw new Error(`Work ticket not found: ${input.ticketId}`);
  }

  return repository.updateShift({
    ...shift,
    workTickets,
    updatedAt: input.updatedAt
  });
};

export const closeOverdueActiveShift = async (
  repository: ShiftRepository,
  input: AutoCloseActiveShiftInput
): Promise<Shift | null> => {
  const activeShift = await repository.getActiveShift();

  if (!activeShift) {
    return null;
  }

  const plannedWindow = getPlannedShiftWindow(
    activeShift.date,
    activeShift.type,
    activeShift.startTime
  );
  const autoCloseAt = new Date(plannedWindow.plannedEnd).getTime() + AUTO_CLOSE_DELAY_MS;
  const now = new Date(input.now).getTime();

  if (Number.isNaN(now) || now < autoCloseAt) {
    return activeShift;
  }

  const closedShift: Shift = {
    ...closeShiftWorkTickets(activeShift, plannedWindow.plannedEnd),
    endTime: plannedWindow.plannedEnd,
    isAutoClosed: true,
    updatedAt: input.now
  };

  input.onAutoCloseDue?.(closedShift);

  return repository.updateShift(closedShift);
};
