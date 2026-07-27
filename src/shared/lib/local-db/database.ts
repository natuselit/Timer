import Dexie, { type Table } from 'dexie';
import type { AppMetaRecord, SettingsRecord } from './types';
import type { EnterpriseScheduleItem } from '../../../entities/enterprise-schedule';
import {
  BUILT_IN_SHIFT_TEMPLATES,
  getBuiltInShiftTemplate,
  type Shift,
  type WorkTicket
} from '../../../entities/shift';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type Settings
} from '../../../entities/settings';

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
          .table<Shift, string>('shifts')
          .toCollection()
          .modify((shift) => {
            const templateId = shift.templateId ?? shift.type;
            const builtIn = getBuiltInShiftTemplate(templateId);

            shift.type = templateId;
            shift.templateId = templateId;
            shift.templateNameSnapshot =
              shift.templateNameSnapshot ?? builtIn?.name ?? 'Власна зміна';
          });

        await transaction
          .table<EnterpriseScheduleItem, string>('enterpriseSchedule')
          .toCollection()
          .modify((item) => {
            const templateId = item.templateId ?? item.shiftType;
            const builtIn = getBuiltInShiftTemplate(templateId);

            item.shiftType = templateId;
            item.templateId = templateId;
            item.templateNameSnapshot =
              item.templateNameSnapshot ?? builtIn?.name ?? 'Власна зміна';
          });

        await transaction
          .table<Settings & { id: 'default' }, 'default'>('settings')
          .toCollection()
          .modify((settings) => {
            settings.shiftTemplates = Array.isArray(settings.shiftTemplates)
              ? settings.shiftTemplates
              : BUILT_IN_SHIFT_TEMPLATES.map((template) => ({ ...template }));
            settings.notificationPreferences =
              settings.notificationPreferences ?? {
                ...DEFAULT_NOTIFICATION_PREFERENCES,
                shiftStart: { ...DEFAULT_NOTIFICATION_PREFERENCES.shiftStart },
                activeTicketEnd: { ...DEFAULT_NOTIFICATION_PREFERENCES.activeTicketEnd },
                unfinishedShift: { ...DEFAULT_NOTIFICATION_PREFERENCES.unfinishedShift }
              };
          });
      });
  }
}

export const localDb = new ShifterDatabase();
