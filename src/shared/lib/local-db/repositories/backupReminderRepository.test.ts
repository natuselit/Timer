import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackup, serializeBackup } from '../use-cases/backupUseCases';
import { ShifterDatabase } from '../database';
import {
  BACKUP_REMINDER_ANCHOR_KEY,
  BackupReminderRepository,
  LAST_BACKUP_EXPORTED_KEY,
  calculateBackupReminderStatus
} from './backupReminderRepository';

let db: ShifterDatabase;
let repository: BackupReminderRepository;

beforeEach(() => {
  db = new ShifterDatabase(`backup-reminder-${crypto.randomUUID()}`);
  repository = new BackupReminderRepository(db);
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('backup reminder', () => {
  it.each([7, 14, 30] as const)('becomes due after %s days', (intervalDays) => {
    const anchorAt = '2026-08-01T08:00:00.000Z';
    const beforeDue = new Date(
      new Date(anchorAt).getTime() + intervalDays * 24 * 60 * 60 * 1_000 - 1
    ).toISOString();
    const dueAt = new Date(
      new Date(anchorAt).getTime() + intervalDays * 24 * 60 * 60 * 1_000
    ).toISOString();

    expect(
      calculateBackupReminderStatus({
        anchorAt,
        lastExportedAt: null,
        intervalDays,
        now: beforeDue
      }).isDue
    ).toBe(false);
    expect(
      calculateBackupReminderStatus({
        anchorAt,
        lastExportedAt: null,
        intervalDays,
        now: dueAt
      }).isDue
    ).toBe(true);
  });

  it('creates an anchor, stays due until export and starts a new interval after export', async () => {
    const anchorAt = '2026-08-01T08:00:00.000Z';

    await expect(repository.getStatus(7, anchorAt)).resolves.toMatchObject({
      anchorAt,
      lastExportedAt: null,
      isDue: false
    });
    await expect(repository.getStatus(7, '2026-08-08T08:00:00.000Z')).resolves.toMatchObject({
      isDue: true
    });

    await repository.markExported('2026-08-08T08:05:00.000Z');

    await expect(repository.getStatus(7, '2026-08-08T08:06:00.000Z')).resolves.toMatchObject({
      lastExportedAt: '2026-08-08T08:05:00.000Z',
      isDue: false
    });
  });

  it('keeps reminder metadata out of serialized backup', async () => {
    await db.appMeta.bulkPut([
      {
        key: BACKUP_REMINDER_ANCHOR_KEY,
        value: '2026-08-01T08:00:00.000Z',
        updatedAt: '2026-08-01T08:00:00.000Z'
      },
      {
        key: LAST_BACKUP_EXPORTED_KEY,
        value: '2026-08-02T08:00:00.000Z',
        updatedAt: '2026-08-02T08:00:00.000Z'
      }
    ]);

    const source = serializeBackup(
      await createBackup(db, '2026-08-03T08:00:00.000Z')
    );

    expect(source).not.toContain(BACKUP_REMINDER_ANCHOR_KEY);
    expect(source).not.toContain(LAST_BACKUP_EXPORTED_KEY);
  });
});
