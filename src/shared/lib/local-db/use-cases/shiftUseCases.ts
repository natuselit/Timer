import {
  detectShiftType,
  getPlannedShiftWindow,
  SHIFT_NOTE_MAX_LENGTH,
  validateAndSortWorkTickets,
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

type GradeSettings = Pick<
  Settings,
  'currentGrade' | 'desiredGrade' | 'gradeSalaryBonusPercents' | 'gradeNormPercents'
>;

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

const assertActualQuantity = (actualQuantity: number): void => {
  if (!Number.isSafeInteger(actualQuantity) || actualQuantity < 0) {
    throw new Error('Фактична кількість має бути цілим невідʼємним числом.');
  }
};

const assertDowntimeMinutes = (downtimeMinutes: number): void => {
  if (!Number.isSafeInteger(downtimeMinutes) || downtimeMinutes < 0) {
    throw new Error('Простій має бути цілою невідʼємною кількістю хвилин.');
  }
};

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
    note: '',
    coefficientMode: 'auto',
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
    note: '',
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

export const updateActiveShiftNote = async (
  repository: ShiftRepository,
  input: {
    shiftId: string;
    note: string;
    updatedAt: ISODateTimeString;
  }
): Promise<Shift> => {
  const note = input.note.trim();

  if (note.length > SHIFT_NOTE_MAX_LENGTH) {
    throw new Error(`Нотатка має містити не більше ${SHIFT_NOTE_MAX_LENGTH} символів.`);
  }

  const shift = await repository.getShiftById(input.shiftId);

  if (!shift || shift.endTime !== null) {
    throw new Error('Активну зміну не знайдено.');
  }

  return repository.updateShift({
    ...shift,
    note,
    updatedAt: input.updatedAt
  });
};

export const recalculateHourlyRateSnapshotsForPeriod = (
  repository: ShiftRepository,
  monthlySalary: number,
  gradeSettings: GradeSettings,
  period: { start: LocalDateString; end: LocalDateString },
  updatedAt: ISODateTimeString
): Promise<number> => {
  if (!period.start || !period.end || period.start > period.end) {
    throw new Error('Некоректний період перерахунку.');
  }

  return repository.recalculateHourlyRateSnapshotsForPeriod(
    monthlySalary,
    gradeSettings,
    period,
    updatedAt
  );
};

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

  if (shift.workTickets.some((ticket) => ticket.endedAt === null)) {
    throw new Error('Спершу завершіть активний тікет.');
  }

  const ticket: WorkTicket = {
    id: input.id ?? createId(),
    normPerEightHours: input.normPerEightHours,
    startedAt: input.startedAt,
    endedAt: null,
    actualQuantity: null,
    downtimeMinutes: 0,
    createdAt: input.startedAt,
    updatedAt: input.startedAt
  };

  const workTickets = validateAndSortWorkTickets(
    [...shift.workTickets, ticket],
    {
      shiftStartTime: shift.startTime,
      effectiveShiftEndTime: input.startedAt,
      allowOpenTicket: true
    }
  );

  return repository.updateShift({
    ...shift,
    workTickets,
    updatedAt: input.startedAt
  });
};

const getActiveTicket = (shift: Shift): WorkTicket => {
  const ticket = shift.workTickets.find((item) => item.endedAt === null);

  if (!ticket) {
    throw new Error('Активний тікет не знайдено.');
  }

  return ticket;
};

export const adjustWorkTicketDowntime = async (
  repository: ShiftRepository,
  input: {
    shiftId: string;
    deltaMinutes: number;
    updatedAt: ISODateTimeString;
  }
): Promise<Shift> => {
  if (!Number.isSafeInteger(input.deltaMinutes) || input.deltaMinutes === 0) {
    throw new Error('Коригування простою має бути цілою ненульовою кількістю хвилин.');
  }

  const shift = await repository.getShiftById(input.shiftId);

  if (!shift || shift.endTime !== null) {
    throw new Error('Активну зміну не знайдено.');
  }

  const activeTicket = getActiveTicket(shift);
  const nextDowntimeMinutes = activeTicket.downtimeMinutes + input.deltaMinutes;

  if (nextDowntimeMinutes < 0) {
    throw new Error('Загальний простій не може бути відʼємним.');
  }

  const elapsedMinutes = Math.floor(
    (new Date(input.updatedAt).getTime() - new Date(activeTicket.startedAt).getTime()) / 60_000
  );

  if (nextDowntimeMinutes > elapsedMinutes) {
    throw new Error('Простій не може бути довшим за тікет.');
  }

  const workTickets = shift.workTickets.map((ticket) =>
    ticket.id === activeTicket.id
      ? {
          ...ticket,
          downtimeMinutes: nextDowntimeMinutes,
          updatedAt: input.updatedAt
        }
      : ticket
  );

  const sortedWorkTickets = validateAndSortWorkTickets(workTickets, {
    shiftStartTime: shift.startTime,
    effectiveShiftEndTime: input.updatedAt,
    allowOpenTicket: true
  });

  return repository.updateShift({
    ...shift,
    workTickets: sortedWorkTickets,
    updatedAt: input.updatedAt
  });
};

export const completeWorkTicket = async (
  repository: ShiftRepository,
  input: {
    shiftId: string;
    endedAt: ISODateTimeString;
    actualQuantity: number;
  }
): Promise<Shift> => {
  assertActualQuantity(input.actualQuantity);
  const shift = await repository.getShiftById(input.shiftId);

  if (!shift || shift.endTime !== null) {
    throw new Error('Активну зміну не знайдено.');
  }

  const activeTicket = getActiveTicket(shift);
  const workTickets = shift.workTickets.map((ticket) => {
    if (ticket.id !== activeTicket.id) {
      return ticket;
    }

    return {
      ...ticket,
      endedAt: input.endedAt,
      actualQuantity: input.actualQuantity,
      updatedAt: input.endedAt
    };
  });
  const sortedWorkTickets = validateAndSortWorkTickets(workTickets, {
    shiftStartTime: shift.startTime,
    effectiveShiftEndTime: input.endedAt,
    allowOpenTicket: true
  });

  return repository.updateShift({
    ...shift,
    workTickets: sortedWorkTickets,
    updatedAt: input.endedAt
  });
};

export const updateWorkTicketInActiveShift = async (
  repository: ShiftRepository,
  input: {
    shiftId: string;
    ticketId: string;
    normPerEightHours: number;
    startedAt: ISODateTimeString;
    endedAt: ISODateTimeString | null;
    actualQuantity?: number | null;
    downtimeMinutes?: number;
    updatedAt: ISODateTimeString;
  }
): Promise<Shift> => {
  assertTicketNorm(input.normPerEightHours);
  if (input.actualQuantity !== undefined && input.actualQuantity !== null) {
    assertActualQuantity(input.actualQuantity);
  }
  if (input.downtimeMinutes !== undefined) {
    assertDowntimeMinutes(input.downtimeMinutes);
  }

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

    if (ticket.endedAt !== null && input.endedAt === null) {
      throw new Error('Завершений тікет не можна знову зробити активним.');
    }

    if (
      ticket.endedAt === null &&
      input.endedAt !== null &&
      (input.actualQuantity === undefined || input.actualQuantity === null)
    ) {
      throw new Error('Для завершення тікета обовʼязково вкажіть фактичну кількість.');
    }

    return {
      ...ticket,
      normPerEightHours: input.normPerEightHours,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      actualQuantity:
        input.endedAt === null
          ? null
          : input.actualQuantity === undefined
            ? ticket.actualQuantity
            : input.actualQuantity,
      downtimeMinutes: input.downtimeMinutes ?? ticket.downtimeMinutes,
      updatedAt: input.updatedAt
    };
  });

  if (!didUpdateTicket) {
    throw new Error(`Work ticket not found: ${input.ticketId}`);
  }

  const sortedWorkTickets = validateAndSortWorkTickets(workTickets, {
    shiftStartTime: shift.startTime,
    effectiveShiftEndTime: input.updatedAt,
    allowOpenTicket: true
  });

  return repository.updateShift({
    ...shift,
    workTickets: sortedWorkTickets,
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
