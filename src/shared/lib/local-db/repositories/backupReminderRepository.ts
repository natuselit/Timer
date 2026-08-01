import type { BackupReminderIntervalDays } from '../../../../entities/settings';
import type { ShifterDatabase } from '../database';

export const BACKUP_REMINDER_ANCHOR_KEY = 'backup-reminder-anchor-at';
export const LAST_BACKUP_EXPORTED_KEY = 'last-backup-exported-at';

export type BackupReminderState = {
  anchorAt: string;
  lastExportedAt: string | null;
};

export type BackupReminderStatus = BackupReminderState & {
  dueAt: string;
  isDue: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const isValidDateTime = (value: unknown): value is string =>
  typeof value === 'string' && !Number.isNaN(new Date(value).getTime());

export const calculateBackupReminderStatus = ({
  anchorAt,
  lastExportedAt,
  intervalDays,
  now
}: BackupReminderState & {
  intervalDays: BackupReminderIntervalDays;
  now: string;
}): BackupReminderStatus => {
  const baseAt = lastExportedAt ?? anchorAt;
  const dueTimestamp = new Date(baseAt).getTime() + intervalDays * DAY_MS;

  return {
    anchorAt,
    lastExportedAt,
    dueAt: new Date(dueTimestamp).toISOString(),
    isDue: new Date(now).getTime() >= dueTimestamp
  };
};

export class BackupReminderRepository {
  constructor(private readonly db: ShifterDatabase) {}

  async getOrCreateState(now: string): Promise<BackupReminderState> {
    const [anchorRecord, exportedRecord] = await Promise.all([
      this.db.appMeta.get(BACKUP_REMINDER_ANCHOR_KEY),
      this.db.appMeta.get(LAST_BACKUP_EXPORTED_KEY)
    ]);
    const anchorAt = isValidDateTime(anchorRecord?.value) ? anchorRecord.value : now;
    const lastExportedAt = isValidDateTime(exportedRecord?.value)
      ? exportedRecord.value
      : null;

    if (anchorAt !== anchorRecord?.value) {
      await this.db.appMeta.put({
        key: BACKUP_REMINDER_ANCHOR_KEY,
        value: anchorAt,
        updatedAt: now
      });
    }

    return { anchorAt, lastExportedAt };
  }

  async getStatus(
    intervalDays: BackupReminderIntervalDays,
    now: string
  ): Promise<BackupReminderStatus> {
    const state = await this.getOrCreateState(now);

    return calculateBackupReminderStatus({ ...state, intervalDays, now });
  }

  async markExported(exportedAt: string): Promise<void> {
    await this.db.appMeta.bulkPut([
      {
        key: BACKUP_REMINDER_ANCHOR_KEY,
        value: exportedAt,
        updatedAt: exportedAt
      },
      {
        key: LAST_BACKUP_EXPORTED_KEY,
        value: exportedAt,
        updatedAt: exportedAt
      }
    ]);
  }

  async resetAnchor(anchorAt: string): Promise<void> {
    await this.db.transaction('rw', this.db.appMeta, async () => {
      await this.db.appMeta.delete(LAST_BACKUP_EXPORTED_KEY);
      await this.db.appMeta.put({
        key: BACKUP_REMINDER_ANCHOR_KEY,
        value: anchorAt,
        updatedAt: anchorAt
      });
    });
  }
}
