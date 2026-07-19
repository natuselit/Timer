import type { EnterpriseScheduleItem } from '../../../entities/enterprise-schedule';
import type { Settings } from '../../../entities/settings';
import type { Shift } from '../../../entities/shift';

export type SettingsRecord = Settings & {
  id: 'default';
};

export type AppMetaRecord = {
  key: string;
  value: string;
  updatedAt: string;
};

export type LocalDatabaseSchema = {
  settings: SettingsRecord;
  shifts: Shift;
  enterpriseSchedule: EnterpriseScheduleItem;
  appMeta: AppMetaRecord;
};

