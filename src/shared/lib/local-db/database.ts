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
  }
}

export const localDb = new ShifterDatabase();

