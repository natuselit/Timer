import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ShifterDatabase } from '../database';
import { createBackup, serializeBackup } from '../use-cases/backupUseCases';
import {
  CALENDAR_TUTORIAL_SEEN_KEY,
  CalendarTutorialRepository
} from './calendarTutorialRepository';

let db: ShifterDatabase;
let repository: CalendarTutorialRepository;

beforeEach(() => {
  db = new ShifterDatabase(`calendar-tutorial-${crypto.randomUUID()}`);
  repository = new CalendarTutorialRepository(db);
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('CalendarTutorialRepository', () => {
  it('persists the versioned seen marker locally', async () => {
    await expect(repository.hasSeen()).resolves.toBe(false);

    await repository.markSeen('2026-08-04T10:00:00.000Z');

    await expect(repository.hasSeen()).resolves.toBe(true);
    await expect(db.appMeta.get(CALENDAR_TUTORIAL_SEEN_KEY)).resolves.toEqual({
      key: CALENDAR_TUTORIAL_SEEN_KEY,
      value: 'true',
      updatedAt: '2026-08-04T10:00:00.000Z'
    });
  });

  it('keeps the marker out of JSON backup', async () => {
    await repository.markSeen('2026-08-04T10:00:00.000Z');

    const source = serializeBackup(
      await createBackup(db, '2026-08-04T11:00:00.000Z')
    );

    expect(source).not.toContain(CALENDAR_TUTORIAL_SEEN_KEY);
  });
});
