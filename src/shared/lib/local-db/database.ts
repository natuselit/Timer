import Dexie, { type Table } from 'dexie';
import type { AppMetaRecord, SettingsRecord } from './types';
import type { EnterpriseScheduleItem } from '../../../entities/enterprise-schedule';
import type { Shift } from '../../../entities/shift';

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
          .table<Shift, string>('shifts')
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
  }
}

export const localDb = new ShifterDatabase();
