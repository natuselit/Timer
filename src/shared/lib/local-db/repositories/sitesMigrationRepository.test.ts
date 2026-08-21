import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShifterDatabase } from '../database';
import {
  SITES_MIGRATION_STATUS_KEY,
  SitesMigrationRepository
} from './sitesMigrationRepository';

let db: ShifterDatabase;
let repository: SitesMigrationRepository;

beforeEach(() => {
  db = new ShifterDatabase(`sites-migration-${crypto.randomUUID()}`);
  repository = new SitesMigrationRepository(db);
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('Sites migration repository', () => {
  it('starts pending and persists an explicit choice locally', async () => {
    await expect(repository.getStatus()).resolves.toBe('pending');

    await repository.markSkipped('2026-08-15T09:00:00.000Z');
    await expect(repository.getStatus()).resolves.toBe('skipped');
    await expect(db.appMeta.get(SITES_MIGRATION_STATUS_KEY)).resolves.toMatchObject({
      value: 'skipped'
    });

    await repository.markCompleted('2026-08-15T09:05:00.000Z');
    await expect(repository.getStatus()).resolves.toBe('completed');
  });
});
