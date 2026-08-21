import {
  calculateHourlyRateFromMonthlySalary,
  createGradeSnapshot,
  type Settings
} from '../../../../entities/settings';
import type {
  GradeSnapshot,
  LocalDateString,
  Shift,
  WorkTicket
} from '../../../../entities/shift';
import {
  SHIFT_NOTE_MAX_LENGTH,
  validateAndSortWorkTickets
} from '../../../../entities/shift';
import type { ShifterDatabase } from '../database';

export class ShiftConstraintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShiftConstraintError';
  }
}

const isActiveShift = (shift: Pick<Shift, 'endTime'>): boolean => shift.endTime === null;

const assertNoOpenTicketInCompletedShift = (shift: Shift): void => {
  if (shift.endTime !== null && shift.workTickets.some((ticket) => ticket.endedAt === null)) {
    throw new ShiftConstraintError('Active work ticket must be completed before leaving');
  }
};

type LegacyShiftRecord = Partial<Shift> & Pick<
  Shift,
  | 'id'
  | 'date'
  | 'type'
  | 'detectionMode'
  | 'plannedStartTime'
  | 'plannedEndTime'
  | 'startTime'
  | 'endTime'
  | 'hourlyRateSnapshot'
  | 'coefficientMode'
  | 'isAutoClosed'
  | 'createdAt'
  | 'updatedAt'
>;

type GradeSettings = Pick<
  Settings,
  'currentGrade' | 'desiredGrade' | 'gradeSalaryBonusPercents' | 'gradeNormPercents'
>;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const normalizeWorkTickets = (value: unknown): WorkTicket[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((ticket): ticket is WorkTicket => {
      if (typeof ticket !== 'object' || ticket === null || Array.isArray(ticket)) {
        return false;
      }

      const candidate = ticket as Partial<WorkTicket>;

      return (
        typeof candidate.id === 'string' &&
        isFiniteNumber(candidate.normPerEightHours) &&
        candidate.normPerEightHours >= 0 &&
        typeof candidate.startedAt === 'string' &&
        (candidate.endedAt === null || typeof candidate.endedAt === 'string') &&
        typeof candidate.createdAt === 'string' &&
        typeof candidate.updatedAt === 'string'
      );
    })
    .map((ticket) => ({
      id: ticket.id,
      normPerEightHours: ticket.normPerEightHours,
      startedAt: ticket.startedAt,
      endedAt: ticket.endedAt,
      actualQuantity:
        Number.isSafeInteger(ticket.actualQuantity) && ticket.actualQuantity! >= 0
          ? ticket.actualQuantity!
          : null,
      manualCompletionPercent:
        Number.isSafeInteger(ticket.manualCompletionPercent) &&
        ticket.manualCompletionPercent! >= 0
          ? ticket.manualCompletionPercent!
          : null,
      downtimeMinutes:
        Number.isSafeInteger(ticket.downtimeMinutes) && ticket.downtimeMinutes! >= 0
          ? ticket.downtimeMinutes!
          : 0,
      createdAt: ticket.createdAt,
      updatedAt: ticket.updatedAt
    }));
};

const normalizeGradeSnapshot = (value: unknown): GradeSnapshot | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  const snapshot = value as Partial<GradeSnapshot>;

  if (
    !isFiniteNumber(snapshot.cumulativeSalaryBonusPercent) ||
    !Array.isArray(snapshot.gradeSalaryBonusPercents) ||
    !Array.isArray(snapshot.gradeNormPercents)
  ) {
    return null;
  }

  return {
    currentGrade: snapshot.currentGrade ?? 1,
    desiredGrade: snapshot.desiredGrade ?? snapshot.currentGrade ?? 1,
    gradeSalaryBonusPercents: [...snapshot.gradeSalaryBonusPercents] as GradeSnapshot['gradeSalaryBonusPercents'],
    gradeNormPercents: [...snapshot.gradeNormPercents] as GradeSnapshot['gradeNormPercents'],
    cumulativeSalaryBonusPercent: snapshot.cumulativeSalaryBonusPercent
  };
};

export const normalizeShiftRecord = (record: LegacyShiftRecord): Shift => ({
  ...record,
  baseHourlyRateSnapshot: isFiniteNumber(record.baseHourlyRateSnapshot)
    ? record.baseHourlyRateSnapshot
    : record.hourlyRateSnapshot,
  gradeSnapshot: normalizeGradeSnapshot(record.gradeSnapshot),
  workTickets: normalizeWorkTickets(record.workTickets),
  note: typeof record.note === 'string' ? record.note : ''
});

const prepareShiftForWrite = (record: Shift): Shift => {
  if (typeof record.note !== 'string' || record.note.length > SHIFT_NOTE_MAX_LENGTH) {
    throw new Error(`Нотатка має містити не більше ${SHIFT_NOTE_MAX_LENGTH} символів.`);
  }

  record.workTickets.forEach((ticket) => {
    if (!Number.isFinite(ticket.normPerEightHours) || ticket.normPerEightHours <= 0) {
      throw new Error('Норма має бути більшою за 0.');
    }

    if (
      ticket.actualQuantity !== null &&
      (!Number.isSafeInteger(ticket.actualQuantity) || ticket.actualQuantity < 0)
    ) {
      throw new Error('Фактична кількість має бути цілим невідʼємним числом.');
    }

    if (
      ticket.manualCompletionPercent !== null &&
      (!Number.isSafeInteger(ticket.manualCompletionPercent) || ticket.manualCompletionPercent < 0)
    ) {
      throw new Error('Ручний відсоток виконання має бути цілим невідʼємним числом.');
    }

    if (!Number.isSafeInteger(ticket.downtimeMinutes) || ticket.downtimeMinutes < 0) {
      throw new Error('Простій має бути цілою невідʼємною кількістю хвилин.');
    }

  });

  const shift = normalizeShiftRecord(record);

  assertNoOpenTicketInCompletedShift(shift);
  if (shift.workTickets.length > 0) {
    shift.workTickets = validateAndSortWorkTickets(shift.workTickets, {
      shiftStartTime: shift.startTime,
      effectiveShiftEndTime: shift.endTime ?? shift.updatedAt,
      allowOpenTicket: shift.endTime === null
    });
  }

  return shift;
};

const getMonthRange = (
  year: number,
  month: number
): {
  start: LocalDateString;
  end: LocalDateString;
} => {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  return { start, end };
};

export class ShiftRepository {
  constructor(private readonly db: ShifterDatabase) {}

  async createShift(shift: Shift): Promise<Shift> {
    const normalizedShift = prepareShiftForWrite(shift);

    await this.db.transaction('rw', this.db.shifts, async () => {
      await this.assertNoShiftForDate(normalizedShift.date);

      if (isActiveShift(normalizedShift)) {
        await this.assertNoOtherActiveShift();
      }

      await this.db.shifts.add(normalizedShift);
    });

    return normalizedShift;
  }

  async updateShift(shift: Shift): Promise<Shift> {
    const normalizedShift = prepareShiftForWrite(shift);

    await this.db.transaction('rw', this.db.shifts, async () => {
      const existing = await this.db.shifts.get(normalizedShift.id);

      if (!existing) {
        throw new Error(`Shift not found: ${normalizedShift.id}`);
      }

      if (existing.date !== normalizedShift.date) {
        await this.assertNoShiftForDate(normalizedShift.date, normalizedShift.id);
      }

      if (isActiveShift(normalizedShift)) {
        await this.assertNoOtherActiveShift(normalizedShift.id);
      }

      await this.db.shifts.put(normalizedShift);
    });

    return normalizedShift;
  }

  async deleteShift(id: string): Promise<void> {
    await this.db.shifts.delete(id);
  }

  async recalculateHourlyRateSnapshotsForPeriod(
    monthlySalary: number,
    gradeSettings: GradeSettings,
    period: { start: LocalDateString; end: LocalDateString },
    updatedAt: string
  ): Promise<number> {
    const gradeSnapshot = createGradeSnapshot(gradeSettings);

    return this.db.shifts
      .where('date')
      .between(period.start, period.end, true, true)
      .modify((shift) => {
        const baseHourlyRate = calculateHourlyRateFromMonthlySalary(
          monthlySalary,
          shift.date
        );

        shift.baseHourlyRateSnapshot = baseHourlyRate;
        shift.hourlyRateSnapshot = baseHourlyRate;
        shift.gradeSnapshot = gradeSnapshot;
        shift.workTickets = normalizeWorkTickets(shift.workTickets);
        shift.updatedAt = updatedAt;
      });
  }

  async getShiftsByMonth(year: number, month: number): Promise<Shift[]> {
    const { start, end } = getMonthRange(year, month);

    const shifts = await this.db.shifts.where('date').between(start, end, true, true).sortBy('date');

    return shifts.map(normalizeShiftRecord);
  }

  async getShiftsBetween(start: LocalDateString, end: LocalDateString): Promise<Shift[]> {
    const shifts = await this.db.shifts.where('date').between(start, end, true, true).sortBy('date');

    return shifts.map(normalizeShiftRecord);
  }

  async getDateBounds(): Promise<{ start: LocalDateString; end: LocalDateString } | null> {
    const [firstShift, lastShift] = await Promise.all([
      this.db.shifts.orderBy('date').first(),
      this.db.shifts.orderBy('date').last()
    ]);

    return firstShift && lastShift
      ? {
          start: firstShift.date,
          end: lastShift.date
        }
      : null;
  }

  async getActiveShift(): Promise<Shift | null> {
    const shifts = (await this.db.shifts.toArray()).map(normalizeShiftRecord);
    return shifts.find(isActiveShift) ?? null;
  }

  async getLatestCompletedShift(): Promise<Shift | null> {
    const shifts = (await this.db.shifts.toArray()).map(normalizeShiftRecord);
    const completedShifts = shifts.filter((shift) => shift.endTime !== null);

    completedShifts.sort((left, right) => {
      const dateDiff = right.date.localeCompare(left.date);

      if (dateDiff !== 0) {
        return dateDiff;
      }

      return new Date(right.endTime ?? right.startTime).getTime() -
        new Date(left.endTime ?? left.startTime).getTime();
    });

    return completedShifts[0] ?? null;
  }

  async getShiftById(id: string): Promise<Shift | null> {
    const shift = await this.db.shifts.get(id);

    return shift ? normalizeShiftRecord(shift) : null;
  }

  async getShiftByDate(date: LocalDateString): Promise<Shift | null> {
    const shift = await this.db.shifts.where('date').equals(date).first();

    return shift ? normalizeShiftRecord(shift) : null;
  }

  private async assertNoShiftForDate(date: LocalDateString, ignoredShiftId?: string): Promise<void> {
    const existing = await this.db.shifts.where('date').equals(date).first();

    if (existing && existing.id !== ignoredShiftId) {
      throw new ShiftConstraintError(`Shift already exists for ${date}`);
    }
  }

  private async assertNoOtherActiveShift(ignoredShiftId?: string): Promise<void> {
    const shifts = await this.db.shifts.toArray();
    const existing = shifts.find((shift) => shift.id !== ignoredShiftId && isActiveShift(shift));

    if (existing) {
      throw new ShiftConstraintError('Active shift already exists');
    }
  }
}
