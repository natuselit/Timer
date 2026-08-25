import type { Settings } from '../../../entities/settings';
import type { Shift } from '../../../entities/shift';

export type SettingsRecord = Settings & {
  id: 'default';
};

export type StoredShift = Shift & {
  activeKey?: 1;
};

export type AppMetaRecord = {
  key: string;
  value: string;
  updatedAt: string;
};

export type ReviewedScheduleWarning = {
  shiftId: string;
  fingerprint: string;
  reviewedAt: string;
};

export type ConfirmedSaturdayDoubleRateMonth = {
  month: string;
  confirmedAt: string;
};
