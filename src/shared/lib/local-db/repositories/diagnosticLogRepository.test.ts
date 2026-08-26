import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKUP_SCHEMA_VERSION, createBackup, restoreBackup } from '../use-cases/backupUseCases';
import { ShifterDatabase } from '../database';
import { DiagnosticLogRepository } from './diagnosticLogRepository';
import type { DiagnosticLogRecord } from '../../diagnostics/types';

const makeDbName = (): string => `shifter-diagnostics-${crypto.randomUUID()}`;

const makeRecord = (
  id: string,
  timestamp: string,
  kind: DiagnosticLogRecord['kind'] = 'breadcrumb'
): DiagnosticLogRecord => ({
  id,
  timestamp,
  kind,
  screen: 'app',
  code: kind === 'error' ? 'app.global_error' : 'app.launch',
  ...(kind === 'error'
    ? { error: { name: 'Error', message: 'Технічна помилка.' } }
    : {})
});

let databases: ShifterDatabase[] = [];

afterEach(async () => {
  await Promise.all(
    databases.map(async (db) => {
      db.close();
      await db.delete();
    })
  );
  databases = [];
});

describe('DiagnosticLogRepository', () => {
  it('stores every record until an explicit clear and returns chronological order', async () => {
    const db = new ShifterDatabase(makeDbName());
    databases.push(db);
    const repository = new DiagnosticLogRepository(db);

    await repository.add(makeRecord('record-b', '2026-08-26T10:02:00.000Z'));
    await repository.add(makeRecord('record-a', '2026-08-26T10:01:00.000Z', 'error'));

    expect(await repository.count()).toBe(2);
    expect((await repository.getAll()).map((record) => record.id)).toEqual([
      'record-a',
      'record-b'
    ]);

    await repository.clear();
    expect(await repository.count()).toBe(0);
  });

  it('does not rotate the journal after 200 records', async () => {
    const db = new ShifterDatabase(makeDbName());
    databases.push(db);
    const repository = new DiagnosticLogRepository(db);
    const startedAt = Date.parse('2026-08-26T10:00:00.000Z');

    await Promise.all(
      Array.from({ length: 205 }, (_, index) =>
        repository.add(
          makeRecord(
            `record-${String(index).padStart(3, '0')}`,
            new Date(startedAt + index * 1_000).toISOString()
          )
        )
      )
    );

    expect(await repository.count()).toBe(205);
  });

  it('migrates a version 7 database without changing existing application data', async () => {
    const databaseName = makeDbName();
    const legacyDatabase = new Dexie(databaseName);
    legacyDatabase.version(7).stores({
      settings: '&id',
      shifts: '&id,&date,activeKey,updatedAt,createdAt',
      enterpriseSchedule: '&id,&date,createdAt',
      appMeta: '&key'
    });
    await legacyDatabase.table('appMeta').put({
      key: 'existing-marker',
      value: 'kept',
      updatedAt: '2026-08-26T10:00:00.000Z'
    });
    legacyDatabase.close();

    const migratedDatabase = new ShifterDatabase(databaseName);
    databases.push(migratedDatabase);

    expect((await migratedDatabase.appMeta.get('existing-marker'))?.value).toBe('kept');
    expect(migratedDatabase.tables.map((table) => table.name)).toContain('diagnosticLogs');
    await migratedDatabase.diagnosticLogs.add(
      makeRecord('new-record', '2026-08-26T10:03:00.000Z')
    );
    expect(await migratedDatabase.diagnosticLogs.count()).toBe(1);
  });

  it('keeps diagnostics outside schema 16 backup and preserves them during restore', async () => {
    const db = new ShifterDatabase(makeDbName());
    databases.push(db);
    const record = makeRecord('preserved-record', '2026-08-26T10:04:00.000Z');
    await db.diagnosticLogs.put(record);

    const backup = await createBackup(db, '2026-08-26T10:05:00.000Z');
    expect(backup.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(backup).not.toHaveProperty('diagnosticLogs');

    await restoreBackup(db, backup);
    expect(await db.diagnosticLogs.get(record.id)).toEqual(record);
  });
});
