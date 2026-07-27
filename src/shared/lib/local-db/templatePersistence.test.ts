import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../entities/settings';
import type { ShiftTemplate } from '../../../entities/shift';
import { ShifterDatabase } from './database';
import { EnterpriseScheduleRepository } from './repositories/enterpriseScheduleRepository';
import { ShiftRepository } from './repositories/shiftRepository';
import {
  createShift,
  importEnterpriseScheduleText
} from './index';

const databaseNames: string[] = [];

const createDatabase = (): ShifterDatabase => {
  const name = `template-persistence-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return new ShifterDatabase(name);
};

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map((name) => Dexie.delete(name)));
});

describe('template persistence compatibility', () => {
  it('keeps future enterprise entries as plan-only records', async () => {
    const db = createDatabase();
    const scheduleRepository = new EnterpriseScheduleRepository(db);
    const shiftRepository = new ShiftRepository(db);
    const result = await importEnterpriseScheduleText(
      scheduleRepository,
      `--01.08.2099--
In time: 06:30
Out time: 14:30
Total: 08:00`,
      '2026-07-27T12:00:00.000Z',
      {
        shiftRepository,
        settings: DEFAULT_SETTINGS
      }
    );

    expect(result.savedCount).toBe(1);
    expect(result.createdShiftCount).toBe(0);
    await expect(db.enterpriseSchedule.count()).resolves.toBe(1);
    await expect(db.shifts.count()).resolves.toBe(0);
    db.close();
  });

  it('keeps a shift snapshot after its custom template changes', async () => {
    const db = createDatabase();
    const repository = new ShiftRepository(db);
    const template: ShiftTemplate = {
      id: 'night',
      name: 'Нічна A',
      startTime: '22:00',
      endTime: '06:00',
      isBuiltIn: false,
      enabled: true,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z'
    };
    const shift = await createShift(repository, {
      startTime: '2026-07-01T22:05:00.000Z',
      hourlyRateSnapshot: 100,
      shiftTemplates: [...DEFAULT_SETTINGS.shiftTemplates, template],
      now: '2026-07-01T22:05:00.000Z'
    });

    template.name = 'Нічна B';
    template.startTime = '21:00';

    const stored = await repository.getShiftById(shift.id);
    expect(stored).toMatchObject({
      templateId: 'night',
      templateNameSnapshot: 'Нічна A',
      plannedStartTime: '22:00',
      plannedEndTime: '06:00'
    });
    db.close();
  });

  it('migrates v3 first/second records to template snapshots in v4', async () => {
    const name = `template-migration-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const legacy = new Dexie(name);
    legacy.version(3).stores({
      settings: '&id',
      shifts: '&id,&date,updatedAt,createdAt',
      enterpriseSchedule: '&id,&date,createdAt',
      appMeta: '&key'
    });
    await legacy.open();
    await legacy.table('shifts').put({
      id: 'legacy',
      date: '2026-07-01',
      type: 'second',
      detectionMode: 'auto',
      plannedStartTime: '14:30',
      plannedEndTime: '22:30',
      startTime: '2026-07-01T14:30:00.000Z',
      endTime: '2026-07-01T22:30:00.000Z',
      baseHourlyRateSnapshot: 100,
      hourlyRateSnapshot: 100,
      gradeSnapshot: null,
      workTickets: [],
      coefficientMode: 'auto',
      isAutoClosed: false,
      createdAt: '2026-07-01T14:30:00.000Z',
      updatedAt: '2026-07-01T22:30:00.000Z'
    });
    legacy.close();

    const db = new ShifterDatabase(name);
    const shift = await db.shifts.get('legacy');

    expect(shift).toMatchObject({
      type: 'second',
      templateId: 'second',
      templateNameSnapshot: '2 зміна'
    });
    db.close();
  });
});
