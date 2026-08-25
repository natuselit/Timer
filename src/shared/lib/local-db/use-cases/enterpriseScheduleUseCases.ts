import {
  parseEnterpriseScheduleText,
  synchronizeShiftWithEnterpriseSchedule,
  type EnterpriseScheduleParseResult
} from '../../../../entities/enterprise-schedule';
import type { EnterpriseScheduleItem } from '../../../../entities/enterprise-schedule';
import {
  calculateHourlyRateFromMonthlySalary,
  createGradeSnapshot
} from '../../../../entities/settings';
import type { Settings } from '../../../../entities/settings';
import type { ISODateTimeString, LocalDateString, Shift } from '../../../../entities/shift';
import { combineLocalDateAndTime, toLocalIsoString } from '../../date-time';
import type { ShifterDatabase } from '../database';
import { EnterpriseScheduleRepository } from '../repositories/enterpriseScheduleRepository';
import { ShiftRepository } from '../repositories/shiftRepository';
import { buildManualShift } from './shiftUseCases';

export type EnterpriseScheduleImportResult = EnterpriseScheduleParseResult & {
  savedCount: number;
  createdShiftCount: number;
};

type EnterpriseScheduleImportOptions = {
  settings?: Pick<
    Settings,
    | 'monthlySalary'
    | 'currentGrade'
    | 'desiredGrade'
    | 'gradeSalaryBonusPercents'
    | 'gradeNormPercents'
  >;
};

const toScheduleItem = (
  item: EnterpriseScheduleParseResult['items'][number],
  createdAt: string
): EnterpriseScheduleItem => ({
  id: `enterprise-schedule-${item.date}`,
  date: item.date,
  shiftType: item.shiftType,
  plannedStartTime: item.plannedStartTime,
  plannedEndTime: item.plannedEndTime,
  enterpriseStartTime: item.inTime,
  enterpriseEndTime: item.outTime,
  skipped: false,
  sourceText: item.sourceText,
  createdAt,
  updatedAt: createdAt
});

const prepareMissingShiftsFromSchedule = async (
  shiftRepository: ShiftRepository,
  settings: NonNullable<EnterpriseScheduleImportOptions['settings']>,
  items: EnterpriseScheduleItem[],
  now: ISODateTimeString
): Promise<Shift[]> => {
  const missingShifts: Shift[] = [];

  for (const item of items) {
    const existingShift = await shiftRepository.getShiftByDate(item.date);

    if (existingShift) {
      continue;
    }

    const baseHourlyRate = calculateHourlyRateFromMonthlySalary(
      settings.monthlySalary,
      item.date
    );
    missingShifts.push(buildManualShift({
      id: `shift-${item.id}`,
      date: item.date,
      type: item.shiftType,
      startTime: combineLocalDateAndTime(item.date, item.enterpriseStartTime),
      endTime: combineLocalDateAndTime(item.date, item.enterpriseEndTime),
      baseHourlyRateSnapshot: baseHourlyRate,
      hourlyRateSnapshot: baseHourlyRate,
      gradeSnapshot: createGradeSnapshot(settings),
      coefficientMode: 'auto',
      now
    }));
  }

  return missingShifts;
};

export const importParsedEnterpriseSchedule = async (
  db: ShifterDatabase,
  parsedResult: EnterpriseScheduleParseResult,
  now = toLocalIsoString(new Date()),
  options: EnterpriseScheduleImportOptions = {}
): Promise<EnterpriseScheduleImportResult> => {
  const items = parsedResult.items.map((item) => toScheduleItem(item, now));
  let createdShiftCount = 0;

  if (items.length > 0) {
    await db.transaction('rw', db.enterpriseSchedule, db.shifts, async () => {
      const scheduleRepository = new EnterpriseScheduleRepository(db);
      const shiftRepository = new ShiftRepository(db);
      const missingShifts = options.settings
        ? await prepareMissingShiftsFromSchedule(
            shiftRepository,
            options.settings,
            items,
            now
          )
        : [];

      await scheduleRepository.importItems(items);

      for (const shift of missingShifts) {
        await shiftRepository.createShift(shift);
      }

      createdShiftCount = missingShifts.length;
    });
  }

  return {
    ...parsedResult,
    savedCount: items.length,
    createdShiftCount
  };
};

export const importEnterpriseScheduleText = async (
  db: ShifterDatabase,
  source: string,
  now = toLocalIsoString(new Date()),
  options: EnterpriseScheduleImportOptions = {}
): Promise<EnterpriseScheduleImportResult> =>
  importParsedEnterpriseSchedule(db, parseEnterpriseScheduleText(source), now, options);

export const getEnterpriseScheduleByMonth = (
  repository: EnterpriseScheduleRepository,
  year: number,
  month: number
): Promise<EnterpriseScheduleItem[]> => repository.getItemsByMonth(year, month);

export const getEnterpriseScheduleBetween = (
  repository: EnterpriseScheduleRepository,
  start: LocalDateString,
  end: LocalDateString
): Promise<EnterpriseScheduleItem[]> => repository.getItemsBetween(start, end);

export const skipEnterpriseScheduleDiscrepancy = async (
  repository: EnterpriseScheduleRepository,
  scheduleId: string,
  now = toLocalIsoString(new Date())
): Promise<EnterpriseScheduleItem> => {
  const item = await repository.getItemById(scheduleId);

  if (!item) {
    throw new Error(`Enterprise schedule item not found: ${scheduleId}`);
  }

  return repository.updateItem({
    ...item,
    skipped: true,
    updatedAt: now
  });
};

export const syncShiftWithEnterpriseSchedule = async (
  shiftRepository: ShiftRepository,
  enterpriseScheduleRepository: EnterpriseScheduleRepository,
  shiftId: string,
  scheduleId: string,
  now = toLocalIsoString(new Date())
) => {
  const [shift, scheduleItem] = await Promise.all([
    shiftRepository.getShiftById(shiftId),
    enterpriseScheduleRepository.getItemById(scheduleId)
  ]);

  if (!shift) {
    throw new Error(`Shift not found: ${shiftId}`);
  }

  if (!scheduleItem) {
    throw new Error(`Enterprise schedule item not found: ${scheduleId}`);
  }

  return shiftRepository.updateShift(
    synchronizeShiftWithEnterpriseSchedule(shift, scheduleItem, now)
  );
};
