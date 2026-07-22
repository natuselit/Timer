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
import type { ISODateTimeString, LocalDateString } from '../../../../entities/shift';
import { combineLocalDateAndTime, toLocalIsoString } from '../../date-time';
import type { EnterpriseScheduleRepository } from '../repositories/enterpriseScheduleRepository';
import type { ShiftRepository } from '../repositories/shiftRepository';
import { createManualShift } from './shiftUseCases';

export type EnterpriseScheduleImportResult = EnterpriseScheduleParseResult & {
  savedCount: number;
  createdShiftCount: number;
};

type EnterpriseScheduleImportOptions = {
  shiftRepository?: ShiftRepository;
  settings?: Pick<
    Settings,
    | 'monthlySalary'
    | 'coefficientMode'
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

const createMissingShiftsFromSchedule = async (
  shiftRepository: ShiftRepository,
  settings: NonNullable<EnterpriseScheduleImportOptions['settings']>,
  items: EnterpriseScheduleItem[],
  now: ISODateTimeString
): Promise<number> => {
  let createdCount = 0;

  for (const item of items) {
    const existingShift = await shiftRepository.getShiftByDate(item.date);

    if (existingShift) {
      continue;
    }

    const baseHourlyRate = calculateHourlyRateFromMonthlySalary(
      settings.monthlySalary,
      item.date
    );

    await createManualShift(shiftRepository, {
      id: `shift-${item.id}`,
      date: item.date,
      type: item.shiftType,
      startTime: combineLocalDateAndTime(item.date, item.enterpriseStartTime),
      endTime: combineLocalDateAndTime(item.date, item.enterpriseEndTime),
      baseHourlyRateSnapshot: baseHourlyRate,
      hourlyRateSnapshot: baseHourlyRate,
      gradeSnapshot: createGradeSnapshot(settings),
      coefficientMode: settings.coefficientMode,
      now
    });
    createdCount += 1;
  }

  return createdCount;
};

export const importEnterpriseScheduleText = async (
  repository: EnterpriseScheduleRepository,
  source: string,
  now = toLocalIsoString(new Date()),
  options: EnterpriseScheduleImportOptions = {}
): Promise<EnterpriseScheduleImportResult> => {
  const result = parseEnterpriseScheduleText(source);
  const items = result.items.map((item) => toScheduleItem(item, now));
  let createdShiftCount = 0;

  if (items.length > 0) {
    await repository.importItems(items);

    if (options.shiftRepository && options.settings) {
      createdShiftCount = await createMissingShiftsFromSchedule(
        options.shiftRepository,
        options.settings,
        items,
        now
      );
    }
  }

  return {
    ...result,
    savedCount: items.length,
    createdShiftCount
  };
};

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
