import Dexie, { type Table } from 'dexie';
import type { AppMetaRecord, SettingsRecord } from './types';
import type { EnterpriseScheduleItem } from '../../../entities/enterprise-schedule';
import type { Shift, WorkTicket } from '../../../entities/shift';
import { DEFAULT_GRADE_SALARY_BONUS_PERCENTS } from '../../../entities/settings';

type LegacyDowntimeInterval = {
  id: string;
  startedAt: string;
  endedAt: string | null;
};

type LegacyWorkTicket = Partial<WorkTicket> & {
  downtimeIntervals?: LegacyDowntimeInterval[];
};

type LegacyShift = Omit<Shift, 'workTickets'> & {
  workTickets?: LegacyWorkTicket[];
};

type SettingsWithRemovedDefaults = SettingsRecord & {
  coefficientMode?: unknown;
  overtimeUnavailableDates?: unknown;
};

const getLegacyOpenDowntimeMinutes = (
  ticket: LegacyWorkTicket,
  shift: LegacyShift,
  migrationTimestamp: number
): number => {
  const activeInterval = Array.isArray(ticket.downtimeIntervals)
    ? ticket.downtimeIntervals.find((interval) => interval.endedAt === null)
    : undefined;

  if (!activeInterval) {
    return 0;
  }

  const startedAt = new Date(activeInterval.startedAt).getTime();
  const effectiveEnd = ticket.endedAt ?? shift.endTime;
  const endedAt = effectiveEnd ? new Date(effectiveEnd).getTime() : migrationTimestamp;

  if (Number.isNaN(startedAt) || Number.isNaN(endedAt) || endedAt <= startedAt) {
    return 0;
  }

  return Math.floor((endedAt - startedAt) / 60_000);
};

export class ShifterDatabase extends Dexie {
  settings!: Table<SettingsRecord, 'default'>;
  shifts!: Table<Shift, string>;
  enterpriseSchedule!: Table<EnterpriseScheduleItem, string>;
  appMeta!: Table<AppMetaRecord, string>;

  constructor(name = 'shifter-local-db') {
    super(name);

    this.version(1).stores({
      settings: '&id',
      shifts: '&id,&date,updatedAt,createdAt',
      enterpriseSchedule: '&id,&date,createdAt',
      appMeta: '&key'
    });

    this.version(2)
      .stores({
        settings: '&id',
        shifts: '&id,&date,updatedAt,createdAt',
        enterpriseSchedule: '&id,&date,createdAt',
        appMeta: '&key'
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<LegacyShift, string>('shifts')
          .toCollection()
          .modify((shift) => {
            shift.hourlyRateSnapshot = Number.isFinite(shift.baseHourlyRateSnapshot)
              ? shift.baseHourlyRateSnapshot
              : shift.hourlyRateSnapshot;
            shift.workTickets = Array.isArray(shift.workTickets)
              ? shift.workTickets.map((ticket) => ({
                  ...ticket,
                  actualQuantity:
                    Number.isSafeInteger(ticket.actualQuantity) && ticket.actualQuantity! >= 0
                      ? ticket.actualQuantity!
                      : null,
                  downtimeMinutes:
                    Number.isSafeInteger(ticket.downtimeMinutes) && ticket.downtimeMinutes! >= 0
                      ? ticket.downtimeMinutes!
                      : 0,
                  downtimeIntervals: Array.isArray(ticket.downtimeIntervals)
                    ? ticket.downtimeIntervals
                    : []
                }))
              : [];
          });
      });

    this.version(3)
      .stores({
        settings: '&id',
        shifts: '&id,&date,updatedAt,createdAt',
        enterpriseSchedule: '&id,&date,createdAt',
        appMeta: '&key'
      })
      .upgrade(async (transaction) => {
        const migrationTimestamp = Date.now();

        await transaction
          .table<LegacyShift, string>('shifts')
          .toCollection()
          .modify((shift) => {
            shift.workTickets = Array.isArray(shift.workTickets)
              ? shift.workTickets.map((ticket) => {
                  const currentDowntime =
                    Number.isSafeInteger(ticket.downtimeMinutes) && ticket.downtimeMinutes! >= 0
                      ? ticket.downtimeMinutes!
                      : 0;
                  const openDowntime = getLegacyOpenDowntimeMinutes(
                    ticket,
                    shift,
                    migrationTimestamp
                  );
                  const { downtimeIntervals: _legacyIntervals, ...currentTicket } = ticket;

                  return {
                    ...currentTicket,
                    downtimeMinutes: currentDowntime + openDowntime
                  };
                })
              : [];
          });
      });

    this.version(4)
      .stores({
        settings: '&id',
        shifts: '&id,&date,updatedAt,createdAt',
        enterpriseSchedule: '&id,&date,createdAt',
        appMeta: '&key'
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<SettingsRecord, 'default'>('settings')
          .toCollection()
          .modify((settings) => {
            settings.gradeSalaryBonusPercents = [
              ...DEFAULT_GRADE_SALARY_BONUS_PERCENTS
            ];
          });
      });

    this.version(5)
      .stores({
        settings: '&id',
        shifts: '&id,&date,updatedAt,createdAt',
        enterpriseSchedule: '&id,&date,createdAt',
        appMeta: '&key'
      })
      .upgrade(async (transaction) => {
        await transaction
          .table<SettingsWithRemovedDefaults, 'default'>('settings')
          .toCollection()
          .modify((settings) => {
            delete settings.coefficientMode;
          });
      });
  }
}

export const localDb = new ShifterDatabase();
