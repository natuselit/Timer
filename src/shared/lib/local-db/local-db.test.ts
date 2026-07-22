import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Settings } from '../../../entities/settings';
import {
  calculateEnterpriseScheduleComparison,
  type EnterpriseScheduleItem
} from '../../../entities/enterprise-schedule';
import type { Shift } from '../../../entities/shift';
import { ShifterDatabase } from './database';
import { EnterpriseScheduleRepository } from './repositories/enterpriseScheduleRepository';
import { normalizeSettingsRecord, SettingsRepository } from './repositories/settingsRepository';
import { ShiftConstraintError, ShiftRepository } from './repositories/shiftRepository';
import {
  BackupValidationError,
  BACKUP_SCHEMA_VERSION,
  addWorkTicketToActiveShift,
  completeWorkTicket,
  createBackup,
  createManualShift,
  createShift,
  deleteWorkTicketFromActiveShift,
  deleteShift,
  getActiveShift,
  getEnterpriseScheduleBetween,
  getEnterpriseScheduleByMonth,
  getLatestCompletedShift,
  getLocalDataDateBounds,
  getShiftsBetween,
  getSettings,
  getShiftsByMonth,
  importEnterpriseScheduleText,
  parseBackupJson,
  recalculateHourlyRateSnapshotsForAllShifts,
  replaceLocalDataWithDemo,
  restoreBackup,
  serializeBackup,
  saveSettings,
  skipEnterpriseScheduleDiscrepancy,
  startWorkTicketDowntime,
  stopWorkTicketDowntime,
  syncShiftWithEnterpriseSchedule,
  updateWorkTicketInActiveShift,
  updateShift
} from './index';

let db: ShifterDatabase;
let settingsRepository: SettingsRepository;
let shiftRepository: ShiftRepository;
let enterpriseScheduleRepository: EnterpriseScheduleRepository;

const makeDbName = (): string => `shifter-test-${crypto.randomUUID()}`;

const makeShift = (overrides: Partial<Shift> = {}): Shift => ({
  id: 'shift-1',
  date: '2026-06-10',
  type: 'first',
  detectionMode: 'auto',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  startTime: '2026-06-10T06:30:00.000Z',
  endTime: null,
  baseHourlyRateSnapshot: 120,
  hourlyRateSnapshot: 120,
  gradeSnapshot: null,
  workTickets: [],
  coefficientMode: 'auto',
  isAutoClosed: false,
  createdAt: '2026-06-10T06:30:00.000Z',
  updatedAt: '2026-06-10T06:30:00.000Z',
  ...overrides
});

const makeSettings = (overrides: Partial<Settings> = {}): Settings => ({
  employeeFirstName: 'Олег',
  employeeLastName: 'Мельник',
  monthlySalary: 31_680,
  monthlyBonus: 2500,
  currentGrade: 1,
  desiredGrade: 2,
  gradeSalaryBonusPercents: [10, 10, 10, 10],
  gradeNormPercents: [100, 120, 140, 160],
  forecastDays: 30,
  arriveHoldDelayMs: 1200,
  leaveHoldDelayMs: 1800,
  coefficientMode: 'auto',
  shiftDetectionMode: 'auto',
  themePreference: 'system',
  incognitoEnabled: false,
  onboardingCompleted: true,
  updatedAt: '2026-06-23T10:00:00.000Z',
  ...overrides
});

const makeScheduleItem = (
  overrides: Partial<EnterpriseScheduleItem> = {}
): EnterpriseScheduleItem => ({
  id: 'enterprise-schedule-2026-06-10',
  date: '2026-06-10',
  shiftType: 'first',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  enterpriseStartTime: '06:20',
  enterpriseEndTime: '14:40',
  skipped: false,
  sourceText: '--10.06.2026--\nIn time: 06:20\nOut time: 14:40\nTotal: 08:20',
  createdAt: '2026-06-23T10:00:00.000Z',
  updatedAt: '2026-06-23T10:00:00.000Z',
  ...overrides
});

beforeEach(() => {
  db = new ShifterDatabase(makeDbName());
  settingsRepository = new SettingsRepository(db);
  shiftRepository = new ShiftRepository(db);
  enterpriseScheduleRepository = new EnterpriseScheduleRepository(db);
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('database migrations', () => {
  it('normalizes legacy ticket production fields and hourly snapshots in IndexedDB', async () => {
    const databaseName = makeDbName();
    const legacyDatabase = new Dexie(databaseName);
    legacyDatabase.version(1).stores({
      settings: '&id',
      shifts: '&id,&date,updatedAt,createdAt',
      enterpriseSchedule: '&id,&date,createdAt',
      appMeta: '&key'
    });
    const legacyShift = {
      ...makeShift({
        id: 'legacy-indexed-db-shift',
        endTime: '2026-06-10T14:30:00.000Z',
        baseHourlyRateSnapshot: 100,
        hourlyRateSnapshot: 125
      }),
      workTickets: [
        {
          id: 'legacy-ticket',
          normPerEightHours: 80,
          startedAt: '2026-06-10T07:00:00.000Z',
          endedAt: '2026-06-10T08:00:00.000Z',
          createdAt: '2026-06-10T07:00:00.000Z',
          updatedAt: '2026-06-10T08:00:00.000Z'
        }
      ]
    } as unknown as Shift;

    await legacyDatabase.table<Shift, string>('shifts').put(legacyShift);
    legacyDatabase.close();

    const migratedDatabase = new ShifterDatabase(databaseName);

    try {
      await expect(migratedDatabase.shifts.get(legacyShift.id)).resolves.toMatchObject({
        hourlyRateSnapshot: 100,
        workTickets: [
          {
            id: 'legacy-ticket',
            actualQuantity: null,
            downtimeMinutes: 0,
            downtimeIntervals: []
          }
        ]
      });
    } finally {
      migratedDatabase.close();
      await migratedDatabase.delete();
    }
  });
});

describe('settings repository use-cases', () => {
  it('returns default settings before first save', async () => {
    await expect(getSettings(settingsRepository)).resolves.toEqual({
      employeeFirstName: '',
      employeeLastName: '',
      monthlySalary: 0,
      monthlyBonus: 2000,
      currentGrade: 1,
      desiredGrade: 2,
      gradeSalaryBonusPercents: [10, 10, 10, 10],
      gradeNormPercents: [100, 120, 140, 160],
      forecastDays: 30,
      arriveHoldDelayMs: 1500,
      leaveHoldDelayMs: 1500,
      coefficientMode: 'auto',
      shiftDetectionMode: 'auto',
      themePreference: 'system',
      incognitoEnabled: false,
      onboardingCompleted: false,
      updatedAt: new Date(0).toISOString()
    });
  });

  it('saves and reads settings', async () => {
    const settings: Settings = {
      employeeFirstName: 'Олег',
      employeeLastName: 'Мельник',
      monthlySalary: 31_680,
      monthlyBonus: 2500,
      currentGrade: 2,
      desiredGrade: 3,
      gradeSalaryBonusPercents: [10, 10, 10, 10],
      gradeNormPercents: [100, 120, 140, 160],
      forecastDays: 30,
      arriveHoldDelayMs: 1200,
      leaveHoldDelayMs: 1800,
      coefficientMode: 'x1.5',
      shiftDetectionMode: 'manual',
      themePreference: 'dark',
      incognitoEnabled: true,
      onboardingCompleted: true,
      updatedAt: '2026-06-23T10:00:00.000Z'
    };

    await saveSettings(settingsRepository, settings);

    await expect(getSettings(settingsRepository)).resolves.toEqual(settings);
  });

  it('migrates legacy local hourly rate settings to monthly salary on read', () => {
    const migrated = normalizeSettingsRecord(
      {
        id: 'default',
        employeeFirstName: 'Олег',
        employeeLastName: 'Мельник',
        hourlyRate: 100,
        monthlyBonus: 2500,
        forecastDays: 30,
        arriveHoldDelayMs: 1200,
        leaveHoldDelayMs: 1800,
        coefficientMode: 'auto',
        shiftDetectionMode: 'auto',
        incognitoEnabled: false,
        onboardingCompleted: true,
        updatedAt: '2026-06-23T10:00:00.000Z'
      } as never,
      new Date('2026-06-24T10:00:00.000Z')
    );

    expect(migrated.monthlySalary).toBe(17_600);
    expect(migrated.themePreference).toBe('system');
  });

  it('normalizes an invalid stored theme preference to system', () => {
    const normalized = normalizeSettingsRecord({
      ...makeSettings(),
      id: 'default',
      themePreference: 'contrast'
    } as never);

    expect(normalized.themePreference).toBe('system');
  });
});

describe('demo data use-cases', () => {
  it('transactionally replaces all local data with two calendar months of valid demo data', async () => {
    const oldShift = makeShift({
      id: 'old-shift',
      date: '2026-05-29',
      startTime: '2026-05-29T06:30:00.000+03:00',
      endTime: '2026-05-29T14:30:00.000+03:00'
    });
    const oldSchedule = makeScheduleItem({
      id: 'old-schedule',
      date: '2026-05-29'
    });

    await settingsRepository.saveSettings(makeSettings({ employeeFirstName: 'Старі' }));
    await shiftRepository.createShift(oldShift);
    await enterpriseScheduleRepository.importItems([oldSchedule]);

    const demoData = await replaceLocalDataWithDemo(
      db,
      '2026-07-12',
      '2026-07-12T12:00:00.000+03:00'
    );
    const [storedSettings, juneShifts, julyShifts, schedule] = await Promise.all([
      settingsRepository.getSettings(),
      shiftRepository.getShiftsByMonth(2026, 6),
      shiftRepository.getShiftsByMonth(2026, 7),
      enterpriseScheduleRepository.getItemsBetween('2026-06-01', '2026-07-12')
    ]);
    const shifts = [...juneShifts, ...julyShifts];

    expect(demoData.range).toEqual({ start: '2026-06-01', end: '2026-07-12' });
    expect(storedSettings).toMatchObject({
      employeeFirstName: 'Демо',
      employeeLastName: 'Працівник',
      monthlySalary: 44_000,
      monthlyBonus: 3_500,
      currentGrade: 2,
      desiredGrade: 3,
      onboardingCompleted: true
    });
    expect(shifts).toHaveLength(27);
    expect(schedule).toHaveLength(30);
    expect(new Set(shifts.map((shift) => shift.date)).size).toBe(shifts.length);
    expect(shifts.every((shift) => shift.endTime !== null)).toBe(true);
    expect(shifts.every((shift) => shift.workTickets.length === 2)).toBe(true);
    expect(
      shifts.every((shift) => shift.workTickets.every((ticket) => ticket.endedAt !== null))
    ).toBe(true);
    expect(shifts.some((shift) => shift.coefficientMode === 'x1.5')).toBe(true);
    expect(shifts.some((shift) => shift.coefficientMode === 'x2')).toBe(true);
    expect(shifts.every((shift) => !shift.isAutoClosed)).toBe(true);
    expect(calculateEnterpriseScheduleComparison(schedule, shifts).discrepancies.length).toBeGreaterThan(0);
    await expect(shiftRepository.getShiftById('old-shift')).resolves.toBeNull();
    await expect(enterpriseScheduleRepository.getItemById('old-schedule')).resolves.toBeNull();
    await expect(db.appMeta.get('demo-data-range')).resolves.toMatchObject({
      value: '2026-06-01/2026-07-12'
    });
  });
});

describe('shift repository use-cases', () => {
  it('creates an active shift with detected type and planned window', async () => {
    const shift = await createShift(shiftRepository, {
      id: 'created-shift',
      startTime: '2026-06-10T14:25:00.000Z',
      baseHourlyRateSnapshot: 200,
      hourlyRateSnapshot: 200,
      gradeSnapshot: {
        currentGrade: 1,
        desiredGrade: 2,
        gradeSalaryBonusPercents: [10, 10, 10, 10],
        gradeNormPercents: [100, 120, 140, 160],
        cumulativeSalaryBonusPercent: 10
      },
      now: '2026-06-10T14:25:00.000Z'
    });

    expect(shift).toMatchObject({
      id: 'created-shift',
      date: '2026-06-10',
      type: 'second',
      plannedStartTime: '14:30',
      plannedEndTime: '22:30',
      endTime: null,
      baseHourlyRateSnapshot: 200,
      hourlyRateSnapshot: 200,
      gradeSnapshot: expect.objectContaining({
        currentGrade: 1,
        desiredGrade: 2,
        cumulativeSalaryBonusPercent: 10
      }),
      workTickets: []
    });
    await expect(getActiveShift(shiftRepository)).resolves.toEqual(shift);
  });

  it('requires each ticket to be completed with fact before starting the next one', async () => {
    const shift = await createShift(shiftRepository, {
      id: 'ticket-shift',
      startTime: '2026-06-10T06:30:00.000Z',
      hourlyRateSnapshot: 120,
      now: '2026-06-10T06:30:00.000Z'
    });

    await addWorkTicketToActiveShift(shiftRepository, {
      shiftId: shift.id,
      id: 'ticket-1',
      normPerEightHours: 50,
      startedAt: '2026-06-10T07:00:00.000Z'
    });
    await expect(addWorkTicketToActiveShift(shiftRepository, {
      shiftId: shift.id,
      id: 'ticket-2',
      normPerEightHours: 20,
      startedAt: '2026-06-10T09:00:00.000Z'
    })).rejects.toThrow('Спершу завершіть активний тікет.');
    await completeWorkTicket(shiftRepository, {
      shiftId: shift.id,
      endedAt: '2026-06-10T09:00:00.000Z',
      actualQuantity: 17,
      downtimeMinutes: 10
    });
    const updatedShift = await addWorkTicketToActiveShift(shiftRepository, {
      shiftId: shift.id,
      id: 'ticket-2',
      normPerEightHours: 20,
      startedAt: '2026-06-10T09:00:00.000Z'
    });
    await completeWorkTicket(shiftRepository, {
      shiftId: shift.id,
      endedAt: '2026-06-10T10:00:00.000Z',
      actualQuantity: 5,
      downtimeMinutes: 0
    });
    const finalShift = await addWorkTicketToActiveShift(shiftRepository, {
      shiftId: shift.id,
      id: 'ticket-3',
      normPerEightHours: 30,
      startedAt: '2026-06-10T10:00:00.000Z'
    });

    expect(updatedShift.workTickets).toHaveLength(2);
    expect(finalShift.workTickets).toEqual([
      expect.objectContaining({
        id: 'ticket-1',
        normPerEightHours: 50,
        endedAt: '2026-06-10T09:00:00.000Z',
        actualQuantity: 17,
        downtimeMinutes: 10
      }),
      expect.objectContaining({
        id: 'ticket-2',
        normPerEightHours: 20,
        endedAt: '2026-06-10T10:00:00.000Z',
        actualQuantity: 5
      }),
      expect.objectContaining({
        id: 'ticket-3',
        normPerEightHours: 30,
        endedAt: null
      })
    ]);
  });

  it('updates a work ticket norm in an active shift', async () => {
    const shift = await createShift(shiftRepository, {
      id: 'editable-ticket-shift',
      startTime: '2026-06-10T06:30:00.000Z',
      hourlyRateSnapshot: 120,
      now: '2026-06-10T06:30:00.000Z'
    });
    await addWorkTicketToActiveShift(shiftRepository, {
      shiftId: shift.id,
      id: 'editable-ticket',
      normPerEightHours: 50,
      startedAt: '2026-06-10T07:00:00.000Z'
    });

    const updatedShift = await updateWorkTicketInActiveShift(shiftRepository, {
      shiftId: shift.id,
      ticketId: 'editable-ticket',
      normPerEightHours: 75,
      startedAt: '2026-06-10T06:45:00.000Z',
      endedAt: null,
      updatedAt: '2026-06-10T07:30:00.000Z'
    });

    expect(updatedShift.workTickets).toEqual([
      expect.objectContaining({
        id: 'editable-ticket',
        normPerEightHours: 75,
        startedAt: '2026-06-10T06:45:00.000Z',
        endedAt: null,
        updatedAt: '2026-06-10T07:30:00.000Z'
      })
    ]);
  });

  it('persists downtime intervals, auto-closes an open interval and accepts zero fact', async () => {
    const shift = await createShift(shiftRepository, {
      id: 'downtime-ticket-shift',
      startTime: '2026-06-10T06:30:00.000Z',
      hourlyRateSnapshot: 120,
      now: '2026-06-10T06:30:00.000Z'
    });
    await addWorkTicketToActiveShift(shiftRepository, {
      shiftId: shift.id,
      id: 'downtime-ticket',
      normPerEightHours: 50,
      startedAt: '2026-06-10T07:00:00.000Z'
    });
    await startWorkTicketDowntime(shiftRepository, {
      shiftId: shift.id,
      id: 'downtime-1',
      startedAt: '2026-06-10T07:30:00.000Z'
    });
    await stopWorkTicketDowntime(shiftRepository, {
      shiftId: shift.id,
      endedAt: '2026-06-10T07:45:00.000Z'
    });
    await startWorkTicketDowntime(shiftRepository, {
      shiftId: shift.id,
      id: 'downtime-2',
      startedAt: '2026-06-10T08:00:00.000Z'
    });

    const reloaded = await getActiveShift(shiftRepository);
    expect(reloaded?.workTickets[0].downtimeIntervals[1].endedAt).toBeNull();

    const completed = await completeWorkTicket(shiftRepository, {
      shiftId: shift.id,
      endedAt: '2026-06-10T08:30:00.000Z',
      actualQuantity: 0,
      downtimeMinutes: 45
    });

    expect(completed.workTickets[0]).toMatchObject({
      actualQuantity: 0,
      downtimeMinutes: 45,
      downtimeIntervals: [
        { id: 'downtime-1', endedAt: '2026-06-10T07:45:00.000Z' },
        { id: 'downtime-2', endedAt: '2026-06-10T08:30:00.000Z' }
      ]
    });
  });

  it('rejects leaving a shift while its ticket is still active', async () => {
    const shift = await createShift(shiftRepository, {
      id: 'blocked-leave-shift',
      startTime: '2026-06-10T06:30:00.000Z',
      hourlyRateSnapshot: 120,
      now: '2026-06-10T06:30:00.000Z'
    });
    const withTicket = await addWorkTicketToActiveShift(shiftRepository, {
      shiftId: shift.id,
      id: 'blocking-ticket',
      normPerEightHours: 50,
      startedAt: '2026-06-10T07:00:00.000Z'
    });

    await expect(
      updateShift(shiftRepository, {
        ...withTicket,
        endTime: '2026-06-10T14:30:00.000Z'
      })
    ).rejects.toThrow('Active work ticket must be completed');
  });

  it('manually finishes an active ticket and keeps the shift active', async () => {
    const shift = await createShift(shiftRepository, {
      id: 'finish-ticket-shift',
      startTime: '2026-06-10T06:30:00.000Z',
      hourlyRateSnapshot: 120,
      now: '2026-06-10T06:30:00.000Z'
    });
    await addWorkTicketToActiveShift(shiftRepository, {
      shiftId: shift.id,
      id: 'finished-ticket',
      normPerEightHours: 50,
      startedAt: '2026-06-10T07:00:00.000Z'
    });

    await expect(
      updateWorkTicketInActiveShift(shiftRepository, {
        shiftId: shift.id,
        ticketId: 'finished-ticket',
        normPerEightHours: 50,
        startedAt: '2026-06-10T07:05:00.000Z',
        endedAt: '2026-06-10T08:15:00.000Z',
        updatedAt: '2026-06-10T09:00:00.000Z'
      })
    ).rejects.toThrow('обовʼязково вкажіть фактичну кількість');

    const updatedShift = await updateWorkTicketInActiveShift(shiftRepository, {
      shiftId: shift.id,
      ticketId: 'finished-ticket',
      normPerEightHours: 50,
      startedAt: '2026-06-10T07:05:00.000Z',
      endedAt: '2026-06-10T08:15:00.000Z',
      actualQuantity: 0,
      updatedAt: '2026-06-10T09:00:00.000Z'
    });

    expect(updatedShift).toMatchObject({
      id: shift.id,
      endTime: null,
      workTickets: [
        expect.objectContaining({
          id: 'finished-ticket',
          startedAt: '2026-06-10T07:05:00.000Z',
          endedAt: '2026-06-10T08:15:00.000Z',
          actualQuantity: 0
        })
      ]
    });
    await expect(getActiveShift(shiftRepository)).resolves.toEqual(updatedShift);
  });

  it('rejects overlapping ticket edits and reopening a completed ticket', async () => {
    const shift = await createShift(shiftRepository, {
      id: 'invalid-ticket-edit-shift',
      startTime: '2026-06-10T06:30:00.000Z',
      hourlyRateSnapshot: 120,
      now: '2026-06-10T06:30:00.000Z'
    });
    await addWorkTicketToActiveShift(shiftRepository, {
      shiftId: shift.id,
      id: 'ticket-1',
      normPerEightHours: 50,
      startedAt: '2026-06-10T07:00:00.000Z'
    });
    await completeWorkTicket(shiftRepository, {
      shiftId: shift.id,
      endedAt: '2026-06-10T09:00:00.000Z',
      actualQuantity: 20,
      downtimeMinutes: 0
    });
    await addWorkTicketToActiveShift(shiftRepository, {
      shiftId: shift.id,
      id: 'ticket-2',
      normPerEightHours: 40,
      startedAt: '2026-06-10T09:00:00.000Z'
    });

    await expect(
      updateWorkTicketInActiveShift(shiftRepository, {
        shiftId: shift.id,
        ticketId: 'ticket-1',
        normPerEightHours: 50,
        startedAt: '2026-06-10T07:00:00.000Z',
        endedAt: '2026-06-10T09:30:00.000Z',
        updatedAt: '2026-06-10T10:00:00.000Z'
      })
    ).rejects.toThrow('Час тікетів не може накладатися.');

    await expect(
      updateWorkTicketInActiveShift(shiftRepository, {
        shiftId: shift.id,
        ticketId: 'ticket-1',
        normPerEightHours: 50,
        startedAt: '2026-06-10T07:00:00.000Z',
        endedAt: null,
        updatedAt: '2026-06-10T10:00:00.000Z'
      })
    ).rejects.toThrow('Завершений тікет не можна знову зробити активним.');
  });

  it('deletes a work ticket from an active shift', async () => {
    const shift = await createShift(shiftRepository, {
      id: 'delete-ticket-shift',
      startTime: '2026-06-10T06:30:00.000Z',
      hourlyRateSnapshot: 120,
      now: '2026-06-10T06:30:00.000Z'
    });
    await addWorkTicketToActiveShift(shiftRepository, {
      shiftId: shift.id,
      id: 'deleted-ticket-1',
      normPerEightHours: 50,
      startedAt: '2026-06-10T07:00:00.000Z'
    });
    await completeWorkTicket(shiftRepository, {
      shiftId: shift.id,
      endedAt: '2026-06-10T09:00:00.000Z',
      actualQuantity: 20,
      downtimeMinutes: 0
    });
    await addWorkTicketToActiveShift(shiftRepository, {
      shiftId: shift.id,
      id: 'deleted-ticket-2',
      normPerEightHours: 20,
      startedAt: '2026-06-10T09:00:00.000Z'
    });

    const updatedShift = await deleteWorkTicketFromActiveShift(shiftRepository, {
      shiftId: shift.id,
      ticketId: 'deleted-ticket-1',
      updatedAt: '2026-06-10T10:00:00.000Z'
    });

    expect(updatedShift.workTickets).toEqual([
      expect.objectContaining({
        id: 'deleted-ticket-2',
        normPerEightHours: 20,
        endedAt: null
      })
    ]);
    expect(updatedShift.updatedAt).toBe('2026-06-10T10:00:00.000Z');
  });

  it('updates work tickets in a completed shift through shift editing', async () => {
    const shift = await createManualShift(shiftRepository, {
      id: 'completed-ticket-shift',
      date: '2026-06-11',
      type: 'first',
      startTime: '2026-06-11T06:30:00.000Z',
      endTime: '2026-06-11T14:30:00.000Z',
      hourlyRateSnapshot: 120,
      coefficientMode: 'auto',
      workTickets: [
        {
          id: 'completed-ticket-1',
          normPerEightHours: 50,
          startedAt: '2026-06-11T07:00:00.000Z',
          endedAt: '2026-06-11T10:00:00.000Z',
          actualQuantity: 20,
          downtimeMinutes: 0,
          downtimeIntervals: [],
          createdAt: '2026-06-11T07:00:00.000Z',
          updatedAt: '2026-06-11T07:00:00.000Z'
        },
        {
          id: 'completed-ticket-2',
          normPerEightHours: 25,
          startedAt: '2026-06-11T10:00:00.000Z',
          endedAt: '2026-06-11T14:30:00.000Z',
          actualQuantity: 15,
          downtimeMinutes: 0,
          downtimeIntervals: [],
          createdAt: '2026-06-11T10:00:00.000Z',
          updatedAt: '2026-06-11T10:00:00.000Z'
        }
      ],
      now: '2026-06-11T14:30:00.000Z'
    });

    const updatedShift = await updateShift(shiftRepository, {
      ...shift,
      workTickets: [
        {
          ...shift.workTickets[0],
          normPerEightHours: 75,
          updatedAt: '2026-06-12T09:00:00.000Z'
        }
      ],
      updatedAt: '2026-06-12T09:00:00.000Z'
    });

    expect(updatedShift.workTickets).toEqual([
      expect.objectContaining({
        id: 'completed-ticket-1',
        normPerEightHours: 75,
        startedAt: '2026-06-11T07:00:00.000Z',
        endedAt: '2026-06-11T10:00:00.000Z',
        updatedAt: '2026-06-12T09:00:00.000Z'
      })
    ]);
    await expect(shiftRepository.getShiftById('completed-ticket-shift')).resolves.toMatchObject({
      workTickets: [
        expect.objectContaining({
          id: 'completed-ticket-1',
          normPerEightHours: 75
        })
      ]
    });
  });

  it('rejects invalid production values on repository writes', async () => {
    await expect(
      shiftRepository.createShift(
        makeShift({
          id: 'invalid-production-write',
          endTime: '2026-06-10T14:30:00.000Z',
          workTickets: [
            {
              id: 'invalid-fact-ticket',
              normPerEightHours: 50,
              startedAt: '2026-06-10T07:00:00.000Z',
              endedAt: '2026-06-10T08:00:00.000Z',
              actualQuantity: 1.5,
              downtimeMinutes: 0,
              downtimeIntervals: [],
              createdAt: '2026-06-10T07:00:00.000Z',
              updatedAt: '2026-06-10T08:00:00.000Z'
            }
          ]
        })
      )
    ).rejects.toThrow('Фактична кількість');
  });

  it('creates a completed manual shift with selected type and planned window', async () => {
    const shift = await createManualShift(shiftRepository, {
      id: 'manual-shift',
      date: '2026-06-12',
      type: 'second',
      startTime: '2026-06-12T14:30:00.000Z',
      endTime: '2026-06-12T22:30:00.000Z',
      hourlyRateSnapshot: 180,
      coefficientMode: 'x1.5',
      now: '2026-06-12T22:30:00.000Z'
    });

    expect(shift).toMatchObject({
      id: 'manual-shift',
      date: '2026-06-12',
      type: 'second',
      detectionMode: 'manual',
      plannedStartTime: '14:30',
      plannedEndTime: '22:30',
      hourlyRateSnapshot: 180,
      coefficientMode: 'x1.5'
    });
    await expect(getActiveShift(shiftRepository)).resolves.toBeNull();
  });

  it('rejects a second active shift', async () => {
    await shiftRepository.createShift(makeShift({ id: 'active-1' }));

    await expect(
      shiftRepository.createShift(
        makeShift({
          id: 'active-2',
          date: '2026-06-11',
          startTime: '2026-06-11T06:30:00.000Z'
        })
      )
    ).rejects.toBeInstanceOf(ShiftConstraintError);
  });

  it('rejects a second shift for the same day', async () => {
    await shiftRepository.createShift(
      makeShift({
        id: 'completed-1',
        endTime: '2026-06-10T14:30:00.000Z'
      })
    );

    await expect(
      shiftRepository.createShift(
        makeShift({
          id: 'completed-2',
          startTime: '2026-06-10T14:30:00.000Z',
          endTime: '2026-06-10T22:30:00.000Z',
          type: 'second',
          plannedStartTime: '14:30',
          plannedEndTime: '22:30'
        })
      )
    ).rejects.toBeInstanceOf(ShiftConstraintError);
  });

  it('updates a shift and keeps active shift uniqueness', async () => {
    await shiftRepository.createShift(
      makeShift({
        id: 'completed-1',
        endTime: '2026-06-10T14:30:00.000Z'
      })
    );
    await shiftRepository.createShift(
      makeShift({
        id: 'active-1',
        date: '2026-06-11',
        startTime: '2026-06-11T06:30:00.000Z'
      })
    );

    await expect(
      updateShift(
        shiftRepository,
        makeShift({
          id: 'completed-1',
          endTime: null,
          updatedAt: '2026-06-10T14:35:00.000Z'
        })
      )
    ).rejects.toBeInstanceOf(ShiftConstraintError);
  });

  it('keeps an overdue active shift open after repeated reads', async () => {
    const activeShift = makeShift({
      id: 'active-overdue',
      startTime: '2026-06-10T06:35:00.000Z',
      updatedAt: '2026-06-10T06:35:00.000Z'
    });

    await shiftRepository.createShift(activeShift);

    await expect(getActiveShift(shiftRepository)).resolves.toEqual(activeShift);
    await expect(getActiveShift(shiftRepository)).resolves.toEqual(activeShift);
  });

  it('returns shifts for the requested month sorted by date', async () => {
    await shiftRepository.createShift(
      makeShift({
        id: 'may',
        date: '2026-05-31',
        startTime: '2026-05-31T06:30:00.000Z',
        endTime: '2026-05-31T14:30:00.000Z'
      })
    );
    await shiftRepository.createShift(
      makeShift({
        id: 'june-2',
        date: '2026-06-20',
        startTime: '2026-06-20T06:30:00.000Z',
        endTime: '2026-06-20T14:30:00.000Z'
      })
    );
    await shiftRepository.createShift(
      makeShift({
        id: 'june-1',
        date: '2026-06-01',
        startTime: '2026-06-01T06:30:00.000Z',
        endTime: '2026-06-01T14:30:00.000Z'
      })
    );

    await expect(getShiftsByMonth(shiftRepository, 2026, 6)).resolves.toEqual([
      expect.objectContaining({ id: 'june-1' }),
      expect.objectContaining({ id: 'june-2' })
    ]);
  });

  it('normalizes legacy stored shifts without grade and ticket fields on read', async () => {
    await db.shifts.add({
      id: 'legacy-stored-shift',
      date: '2026-06-10',
      type: 'first',
      detectionMode: 'auto',
      plannedStartTime: '06:30',
      plannedEndTime: '14:30',
      startTime: '2026-06-10T06:30:00.000Z',
      endTime: '2026-06-10T14:30:00.000Z',
      hourlyRateSnapshot: 120,
      coefficientMode: 'auto',
      isAutoClosed: false,
      createdAt: '2026-06-10T06:30:00.000Z',
      updatedAt: '2026-06-10T14:30:00.000Z'
    } as Shift);

    await expect(getShiftsByMonth(shiftRepository, 2026, 6)).resolves.toEqual([
      expect.objectContaining({
        id: 'legacy-stored-shift',
        baseHourlyRateSnapshot: 120,
        hourlyRateSnapshot: 120,
        gradeSnapshot: null,
        workTickets: []
      })
    ]);
  });

  it('returns shifts for a date range sorted by date', async () => {
    await shiftRepository.createShift(
      makeShift({
        id: 'outside-before',
        date: '2026-06-09',
        startTime: '2026-06-09T06:30:00.000Z',
        endTime: '2026-06-09T14:30:00.000Z'
      })
    );
    await shiftRepository.createShift(
      makeShift({
        id: 'inside-2',
        date: '2026-06-12',
        startTime: '2026-06-12T06:30:00.000Z',
        endTime: '2026-06-12T14:30:00.000Z'
      })
    );
    await shiftRepository.createShift(
      makeShift({
        id: 'inside-1',
        date: '2026-06-10',
        startTime: '2026-06-10T06:30:00.000Z',
        endTime: '2026-06-10T14:30:00.000Z'
      })
    );

    await expect(getShiftsBetween(shiftRepository, '2026-06-10', '2026-06-12')).resolves.toEqual([
      expect.objectContaining({ id: 'inside-1' }),
      expect.objectContaining({ id: 'inside-2' })
    ]);
  });

  it('returns the latest completed shift and ignores active shifts', async () => {
    const olderCompletedShift = makeShift({
      id: 'older-completed',
      date: '2026-06-09',
      startTime: '2026-06-09T06:30:00.000Z',
      endTime: '2026-06-09T14:30:00.000Z'
    });
    const latestCompletedShift = makeShift({
      id: 'latest-completed',
      date: '2026-06-11',
      startTime: '2026-06-11T06:30:00.000Z',
      endTime: '2026-06-11T14:30:00.000Z'
    });
    const activeShift = makeShift({
      id: 'active-later',
      date: '2026-06-12',
      startTime: '2026-06-12T06:30:00.000Z',
      endTime: null
    });

    await shiftRepository.createShift(olderCompletedShift);
    await shiftRepository.createShift(latestCompletedShift);
    await shiftRepository.createShift(activeShift);

    await expect(getLatestCompletedShift(shiftRepository)).resolves.toEqual(latestCompletedShift);
  });

  it('deletes shifts', async () => {
    await shiftRepository.createShift(makeShift({ id: 'removed' }));

    await deleteShift(shiftRepository, 'removed');

    await expect(getActiveShift(shiftRepository)).resolves.toBeNull();
  });

  it('recalculates hourly rate snapshots for existing shifts by each shift month', async () => {
    await shiftRepository.createShift(
      makeShift({
        id: 'completed-1',
        endTime: '2026-06-10T14:30:00.000Z',
        hourlyRateSnapshot: 120
      })
    );
    await shiftRepository.createShift(
      makeShift({
        id: 'completed-2',
        date: '2026-07-01',
        startTime: '2026-07-01T14:30:00.000Z',
        endTime: '2026-07-01T22:30:00.000Z',
        type: 'second',
        plannedStartTime: '14:30',
        plannedEndTime: '22:30',
        hourlyRateSnapshot: 160
      })
    );

    await expect(
      recalculateHourlyRateSnapshotsForAllShifts(
        shiftRepository,
        17_600,
        {
          currentGrade: 1,
          desiredGrade: 2,
          gradeSalaryBonusPercents: [10, 10, 10, 10],
          gradeNormPercents: [100, 120, 140, 160]
        },
        '2026-07-31T12:00:00.000Z'
      )
    ).resolves.toBe(2);

    const updatedShifts = await getShiftsBetween(shiftRepository, '2026-06-01', '2026-07-31');

    expect(updatedShifts[0]).toMatchObject({
      id: 'completed-1',
      baseHourlyRateSnapshot: 100,
      gradeSnapshot: expect.objectContaining({
        currentGrade: 1,
        desiredGrade: 2,
        cumulativeSalaryBonusPercent: 10
      }),
      updatedAt: '2026-07-31T12:00:00.000Z'
    });
    expect(updatedShifts[0].hourlyRateSnapshot).toBeCloseTo(100, 6);
    expect(updatedShifts[1]).toMatchObject({
      id: 'completed-2',
      updatedAt: '2026-07-31T12:00:00.000Z'
    });
    expect(updatedShifts[1].baseHourlyRateSnapshot).toBeCloseTo(95.652_173_913, 6);
    expect(updatedShifts[1].hourlyRateSnapshot).toBeCloseTo(95.652_173_913, 6);
  });
});

describe('enterprise schedule repository use-cases', () => {
  it('imports valid schedule items and keeps invalid blocks out of storage', async () => {
    const result = await importEnterpriseScheduleText(
      enterpriseScheduleRepository,
      `--01.06.2026--
In time: 05:57
Out time: 16:52
Total: 10:55
--02.06.2026--
In time: 06:30
Out time: 15:50
Total: 09:10`,
      '2026-06-23T10:00:00.000+03:00'
    );

    expect(result.savedCount).toBe(1);
    expect(result.createdShiftCount).toBe(0);
    expect(result.errors).toHaveLength(1);
    await expect(getEnterpriseScheduleByMonth(enterpriseScheduleRepository, 2026, 6)).resolves.toEqual([
      {
        id: 'enterprise-schedule-2026-06-01',
        date: '2026-06-01',
        shiftType: 'first',
        plannedStartTime: '06:30',
        plannedEndTime: '14:30',
        enterpriseStartTime: '05:57',
        enterpriseEndTime: '16:52',
        skipped: false,
        sourceText: '--01.06.2026--\nIn time: 05:57\nOut time: 16:52\nTotal: 10:55',
        createdAt: '2026-06-23T10:00:00.000+03:00',
        updatedAt: '2026-06-23T10:00:00.000+03:00'
      }
    ]);
  });

  it('creates completed shifts for imported schedule dates that do not have shifts yet', async () => {
    const existingShift = makeShift({
      id: 'existing-shift',
      date: '2026-06-02',
      startTime: '2026-06-02T06:30:00.000+03:00',
      endTime: '2026-06-02T14:30:00.000+03:00'
    });

    await shiftRepository.createShift(existingShift);

    const result = await importEnterpriseScheduleText(
      enterpriseScheduleRepository,
      `--01.06.2026--
In time: 05:57
Out time: 16:52
Total: 10:55
--02.06.2026--
In time: 06:30
Out time: 14:30
Total: 08:00`,
      '2026-06-23T10:00:00.000+03:00',
      {
        shiftRepository,
        settings: makeSettings({ monthlySalary: 36_960, coefficientMode: 'x1.5' })
      }
    );

    expect(result.savedCount).toBe(2);
    expect(result.createdShiftCount).toBe(1);
    const createdShifts = await getShiftsByMonth(shiftRepository, 2026, 6);

    expect(createdShifts[0]).toMatchObject({
      id: 'shift-enterprise-schedule-2026-06-01',
      date: '2026-06-01',
      type: 'first',
      detectionMode: 'manual',
      startTime: '2026-06-01T05:57:00.000+03:00',
      endTime: '2026-06-01T16:52:00.000+03:00',
      baseHourlyRateSnapshot: 210,
      gradeSnapshot: expect.objectContaining({
        currentGrade: 1,
        desiredGrade: 2,
        cumulativeSalaryBonusPercent: 10
      }),
      coefficientMode: 'x1.5'
    });
    expect(createdShifts[0].hourlyRateSnapshot).toBeCloseTo(210, 6);
    expect(createdShifts[1]).toEqual(existingShift);
  });

  it('loads enterprise schedule items by date range', async () => {
    await importEnterpriseScheduleText(
      enterpriseScheduleRepository,
      `--30.06.2026--
In time: 06:30
Out time: 14:30
Total: 08:00
--01.07.2026--
In time: 14:30
Out time: 22:30
Total: 08:00
--05.07.2026--
In time: 06:30
Out time: 14:30
Total: 08:00`,
      '2026-06-23T10:00:00.000+03:00'
    );

    await expect(
      getEnterpriseScheduleBetween(
        enterpriseScheduleRepository,
        '2026-06-30',
        '2026-07-01'
      )
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'enterprise-schedule-2026-06-30',
        date: '2026-06-30'
      }),
      expect.objectContaining({
        id: 'enterprise-schedule-2026-07-01',
        date: '2026-07-01'
      })
    ]);
  });

  it('marks an enterprise schedule discrepancy as skipped', async () => {
    await importEnterpriseScheduleText(
      enterpriseScheduleRepository,
      `--01.06.2026--
In time: 05:57
Out time: 16:52
Total: 10:55`,
      '2026-06-23T10:00:00.000+03:00'
    );

    await skipEnterpriseScheduleDiscrepancy(
      enterpriseScheduleRepository,
      'enterprise-schedule-2026-06-01',
      '2026-06-23T11:00:00.000+03:00'
    );

    await expect(getEnterpriseScheduleByMonth(enterpriseScheduleRepository, 2026, 6)).resolves.toEqual([
      expect.objectContaining({
        id: 'enterprise-schedule-2026-06-01',
        skipped: true,
        updatedAt: '2026-06-23T11:00:00.000+03:00'
      })
    ]);
  });

  it('syncs a shift with enterprise schedule time', async () => {
    await shiftRepository.createShift(
      makeShift({
        id: 'sync-shift',
        date: '2026-06-01',
        startTime: '2026-06-01T06:30:00.000+03:00',
        endTime: '2026-06-01T14:30:00.000+03:00'
      })
    );
    await importEnterpriseScheduleText(
      enterpriseScheduleRepository,
      `--01.06.2026--
In time: 05:57
Out time: 16:52
Total: 10:55`,
      '2026-06-23T10:00:00.000+03:00'
    );

    await syncShiftWithEnterpriseSchedule(
      shiftRepository,
      enterpriseScheduleRepository,
      'sync-shift',
      'enterprise-schedule-2026-06-01',
      '2026-06-23T11:00:00.000+03:00'
    );

    await expect(getShiftsByMonth(shiftRepository, 2026, 6)).resolves.toEqual([
      expect.objectContaining({
        id: 'sync-shift',
        startTime: '2026-06-01T05:57:00.000+03:00',
        endTime: '2026-06-01T16:52:00.000+03:00',
        updatedAt: '2026-06-23T11:00:00.000+03:00'
      })
    ]);
  });
});

describe('local data date bounds', () => {
  it('returns null for an empty database', async () => {
    await expect(
      getLocalDataDateBounds(shiftRepository, enterpriseScheduleRepository)
    ).resolves.toBeNull();
  });

  it('uses the earliest and latest shift dates when only shifts exist', async () => {
    await shiftRepository.createShift(
      makeShift({
        id: 'later-shift',
        date: '2026-07-22',
        endTime: '2026-07-22T14:30:00.000Z'
      })
    );
    await shiftRepository.createShift(
      makeShift({
        id: 'earlier-shift',
        date: '2026-05-10',
        startTime: '2026-05-10T06:30:00.000Z',
        endTime: '2026-05-10T14:30:00.000Z'
      })
    );

    await expect(
      getLocalDataDateBounds(shiftRepository, enterpriseScheduleRepository)
    ).resolves.toEqual({ start: '2026-05-10', end: '2026-07-22' });
  });

  it('uses enterprise schedule dates when only schedule records exist', async () => {
    await enterpriseScheduleRepository.importItems([
      makeScheduleItem({ id: 'schedule-later', date: '2026-08-01' }),
      makeScheduleItem({ id: 'schedule-earlier', date: '2026-04-30' })
    ]);

    await expect(
      getLocalDataDateBounds(shiftRepository, enterpriseScheduleRepository)
    ).resolves.toEqual({ start: '2026-04-30', end: '2026-08-01' });
  });

  it('combines shift and enterprise schedule bounds', async () => {
    await shiftRepository.createShift(
      makeShift({
        id: 'middle-shift',
        date: '2026-06-10',
        endTime: '2026-06-10T14:30:00.000Z'
      })
    );
    await enterpriseScheduleRepository.importItems([
      makeScheduleItem({ id: 'schedule-first', date: '2026-03-01' }),
      makeScheduleItem({ id: 'schedule-last', date: '2026-09-30' })
    ]);

    await expect(
      getLocalDataDateBounds(shiftRepository, enterpriseScheduleRepository)
    ).resolves.toEqual({ start: '2026-03-01', end: '2026-09-30' });
  });
});

describe('backup use-cases', () => {
  it('creates and parses a valid backup', async () => {
    const settings = makeSettings({
      employeeLastName: 'Іваненко',
      monthlySalary: 36_960,
      themePreference: 'dark'
    });
    const shift = makeShift({
      id: 'backup-shift',
      endTime: '2026-06-10T14:30:00.000Z'
    });
    const scheduleItem = makeScheduleItem();

    await settingsRepository.saveSettings(settings);
    await shiftRepository.createShift(shift);
    await enterpriseScheduleRepository.importItems([scheduleItem]);

    const backup = await createBackup(db, '2026-06-24T12:00:00.000Z');
    const parsed = parseBackupJson(serializeBackup(backup));

    expect(parsed).toEqual({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings,
      shifts: [shift],
      enterpriseSchedule: [scheduleItem]
    });
  });

  it('round-trips schema v5 ticket fact and downtime data', () => {
    const shift = makeShift({
      id: 'production-backup-shift',
      endTime: '2026-06-10T14:30:00.000Z',
      workTickets: [
        {
          id: 'production-ticket',
          normPerEightHours: 80,
          startedAt: '2026-06-10T07:00:00.000Z',
          endedAt: '2026-06-10T08:00:00.000Z',
          actualQuantity: 9,
          downtimeMinutes: 6,
          downtimeIntervals: [
            {
              id: 'downtime-1',
              startedAt: '2026-06-10T07:20:00.000Z',
              endedAt: '2026-06-10T07:26:00.000Z'
            }
          ],
          createdAt: '2026-06-10T07:00:00.000Z',
          updatedAt: '2026-06-10T08:00:00.000Z'
        }
      ]
    });
    const source = serializeBackup({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings(),
      shifts: [shift],
      enterpriseSchedule: []
    });

    expect(parseBackupJson(source).shifts[0]).toEqual(shift);
  });

  it('parses older backups without employee first name', () => {
    const source = serializeBackup({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings(),
      shifts: [],
      enterpriseSchedule: []
    }).replace('  "employeeFirstName": "Олег",\n', '');

    const parsed = parseBackupJson(source);

    expect(parsed.settings.employeeFirstName).toBe('');
    expect(parsed.settings.employeeLastName).toBe('Мельник');
  });

  it('migrates schema v1 hourly rate settings to monthly salary and keeps shift snapshots', () => {
    const legacyShift = makeShift({
      id: 'legacy-shift',
      endTime: '2026-06-10T14:30:00.000Z',
      hourlyRateSnapshot: 120
    });
    const source = JSON.stringify({
      schemaVersion: 1,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: {
        employeeLastName: 'Мельник',
        hourlyRate: 100,
        monthlyBonus: 2500,
        forecastDays: 30,
        arriveHoldDelayMs: 1200,
        leaveHoldDelayMs: 1800,
        coefficientMode: 'auto',
        shiftDetectionMode: 'auto',
        incognitoEnabled: false,
        onboardingCompleted: true,
        updatedAt: '2026-06-23T10:00:00.000Z'
      },
      shifts: [legacyShift],
      enterpriseSchedule: []
    });

    const parsed = parseBackupJson(source);

    expect(parsed.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(parsed.settings.monthlySalary).toBe(17_600);
    expect(parsed.settings.themePreference).toBe('system');
    expect(parsed.shifts[0].hourlyRateSnapshot).toBe(120);
  });

  it('migrates schema v2 backup to default grades and empty shift tickets', () => {
    const source = JSON.stringify({
      schemaVersion: 2,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: {
        employeeFirstName: 'Олег',
        employeeLastName: 'Мельник',
        monthlySalary: 31_680,
        monthlyBonus: 2500,
        forecastDays: 30,
        arriveHoldDelayMs: 1200,
        leaveHoldDelayMs: 1800,
        coefficientMode: 'auto',
        shiftDetectionMode: 'auto',
        incognitoEnabled: false,
        onboardingCompleted: true,
        updatedAt: '2026-06-23T10:00:00.000Z'
      },
      shifts: [
        {
          id: 'legacy-v2-shift',
          date: '2026-06-10',
          type: 'first',
          detectionMode: 'auto',
          plannedStartTime: '06:30',
          plannedEndTime: '14:30',
          startTime: '2026-06-10T06:30:00.000Z',
          endTime: '2026-06-10T14:30:00.000Z',
          hourlyRateSnapshot: 120,
          coefficientMode: 'auto',
          isAutoClosed: false,
          createdAt: '2026-06-10T06:30:00.000Z',
          updatedAt: '2026-06-10T14:30:00.000Z'
        }
      ],
      enterpriseSchedule: []
    });

    const parsed = parseBackupJson(source);

    expect(parsed.settings).toMatchObject({
      currentGrade: 1,
      desiredGrade: 2,
      gradeSalaryBonusPercents: [10, 10, 10, 10],
      gradeNormPercents: [100, 120, 140, 160],
      themePreference: 'system'
    });
    expect(parsed.shifts[0]).toMatchObject({
      id: 'legacy-v2-shift',
      baseHourlyRateSnapshot: 120,
      gradeSnapshot: null,
      workTickets: []
    });
  });

  it('migrates schema v3 theme to system and keeps grade and ticket data', () => {
    const { themePreference: _themePreference, ...legacySettings } = makeSettings();
    const legacyShift = makeShift({
      id: 'legacy-v3-shift',
      endTime: '2026-06-10T14:30:00.000Z',
      baseHourlyRateSnapshot: 100,
      hourlyRateSnapshot: 110,
      gradeSnapshot: {
        currentGrade: 1,
        desiredGrade: 2,
        gradeSalaryBonusPercents: [10, 10, 10, 10],
        gradeNormPercents: [100, 120, 140, 160],
        cumulativeSalaryBonusPercent: 10
      },
      workTickets: []
    });
    const source = JSON.stringify({
      schemaVersion: 3,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: legacySettings,
      shifts: [legacyShift],
      enterpriseSchedule: []
    });

    const parsed = parseBackupJson(source);

    expect(parsed.settings.themePreference).toBe('system');
    expect(parsed.shifts[0]).toMatchObject({
      baseHourlyRateSnapshot: 100,
      hourlyRateSnapshot: 100,
      gradeSnapshot: legacyShift.gradeSnapshot,
      workTickets: []
    });
  });

  it('rejects an invalid backup and keeps current data untouched', async () => {
    const currentShift = makeShift({
      id: 'current-shift',
      endTime: '2026-06-10T14:30:00.000Z'
    });

    await shiftRepository.createShift(currentShift);

    expect(() => parseBackupJson('{')).toThrow(BackupValidationError);
    await expect(getShiftsByMonth(shiftRepository, 2026, 6)).resolves.toEqual([currentShift]);
  });

  it('rejects an incompatible schemaVersion', () => {
    const source = serializeBackup({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings(),
      shifts: [],
      enterpriseSchedule: []
    }).replace(`"schemaVersion": ${BACKUP_SCHEMA_VERSION}`, '"schemaVersion": 999');

    expect(() => parseBackupJson(source)).toThrow(BackupValidationError);
    expect(() => parseBackupJson(source)).toThrow('Версія backup несумісна');
  });

  it('rejects backup with invalid financial and settings values', () => {
    const source = serializeBackup({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings({ monthlySalary: -1 }),
      shifts: [],
      enterpriseSchedule: []
    });

    expect(() => parseBackupJson(source)).toThrow(BackupValidationError);
    expect(() => parseBackupJson(source)).toThrow('Поле monthlySalary не може бути відʼємним.');
  });

  it('rejects schema v4 backup with invalid theme preference', () => {
    const source = serializeBackup({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings(),
      shifts: [],
      enterpriseSchedule: []
    }).replace('"themePreference": "system"', '"themePreference": "contrast"');

    expect(() => parseBackupJson(source)).toThrow(BackupValidationError);
    expect(() => parseBackupJson(source)).toThrow('settings.themePreference');
  });

  it('rejects backup with invalid grade settings', () => {
    const source = serializeBackup({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings({
        currentGrade: 3,
        desiredGrade: 2,
        gradeSalaryBonusPercents: [10, -1, 10, 10]
      }),
      shifts: [],
      enterpriseSchedule: []
    });

    expect(() => parseBackupJson(source)).toThrow(BackupValidationError);
  });

  it('rejects backup with invalid ticket time', () => {
    const source = serializeBackup({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings(),
      shifts: [
        makeShift({
          id: 'invalid-ticket-shift',
          endTime: null,
          workTickets: [
            {
              id: 'invalid-ticket',
              normPerEightHours: 50,
              startedAt: '2026-06-10T09:00:00.000Z',
              endedAt: '2026-06-10T08:00:00.000Z',
              actualQuantity: 0,
              downtimeMinutes: 0,
              downtimeIntervals: [],
              createdAt: '2026-06-10T09:00:00.000Z',
              updatedAt: '2026-06-10T08:00:00.000Z'
            }
          ]
        })
      ],
      enterpriseSchedule: []
    });

    expect(() => parseBackupJson(source)).toThrow(BackupValidationError);
    expect(() => parseBackupJson(source)).toThrow('Тікет не може завершуватись раніше старту.');
  });

  it.each([
    ['нецілий факт', { actualQuantity: 1.5, downtimeMinutes: 0 }],
    ['простій довший за тікет', { actualQuantity: 1, downtimeMinutes: 61 }]
  ])('rejects ticket with %s', (_label, invalidValues) => {
    const source = serializeBackup({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings(),
      shifts: [
        makeShift({
          id: 'invalid-production-shift',
          endTime: '2026-06-10T14:30:00.000Z',
          workTickets: [
            {
              id: 'invalid-production-ticket',
              normPerEightHours: 80,
              startedAt: '2026-06-10T07:00:00.000Z',
              endedAt: '2026-06-10T08:00:00.000Z',
              actualQuantity: invalidValues.actualQuantity,
              downtimeMinutes: invalidValues.downtimeMinutes,
              downtimeIntervals: [],
              createdAt: '2026-06-10T07:00:00.000Z',
              updatedAt: '2026-06-10T08:00:00.000Z'
            }
          ]
        })
      ],
      enterpriseSchedule: []
    });

    expect(() => parseBackupJson(source)).toThrow(BackupValidationError);
  });

  it('rejects calendar-invalid dates and a shift ending before arrival', () => {
    const invalidDateSource = serializeBackup({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings(),
      shifts: [],
      enterpriseSchedule: [makeScheduleItem({ date: '2026-02-30' })]
    });
    const reversedShiftSource = serializeBackup({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings(),
      shifts: [
        makeShift({
          startTime: '2026-06-10T14:30:00.000Z',
          endTime: '2026-06-10T06:30:00.000Z'
        })
      ],
      enterpriseSchedule: []
    });

    expect(() => parseBackupJson(invalidDateSource)).toThrow('невалідні дату або час');
    expect(() => parseBackupJson(reversedShiftSource)).toThrow(
      'Зміна не може завершуватись раніше приходу.'
    );
  });

  it('rejects duplicate record identifiers before Dexie can overwrite data', () => {
    const source = serializeBackup({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings(),
      shifts: [
        makeShift({ id: 'duplicate-id', endTime: '2026-06-10T14:30:00.000Z' }),
        makeShift({
          id: 'duplicate-id',
          date: '2026-06-11',
          startTime: '2026-06-11T06:30:00.000Z',
          endTime: '2026-06-11T14:30:00.000Z'
        })
      ],
      enterpriseSchedule: []
    });

    expect(() => parseBackupJson(source)).toThrow('Backup містить дубль ID зміни duplicate-id.');
  });

  it('fully restores backup data and clears previous local data atomically', async () => {
    const oldSettings = makeSettings({
      employeeLastName: 'Старі',
      monthlySalary: 17_600
    });
    const oldShift = makeShift({
      id: 'old-shift',
      date: '2026-06-09',
      startTime: '2026-06-09T06:30:00.000Z',
      endTime: '2026-06-09T14:30:00.000Z'
    });
    const oldScheduleItem = makeScheduleItem({
      id: 'enterprise-schedule-2026-06-09',
      date: '2026-06-09'
    });
    const restoredSettings = makeSettings({
      employeeLastName: 'Нові',
      monthlySalary: 42_240,
      incognitoEnabled: true
    });
    const restoredShift = makeShift({
      id: 'restored-shift',
      date: '2026-06-11',
      startTime: '2026-06-11T06:30:00.000Z',
      endTime: '2026-06-11T14:30:00.000Z',
      hourlyRateSnapshot: 240
    });
    const restoredScheduleItem = makeScheduleItem({
      id: 'enterprise-schedule-2026-06-11',
      date: '2026-06-11'
    });

    await settingsRepository.saveSettings(oldSettings);
    await shiftRepository.createShift(oldShift);
    await enterpriseScheduleRepository.importItems([oldScheduleItem]);
    await db.appMeta.put({
      key: 'stale',
      value: 'true',
      updatedAt: '2026-06-23T10:00:00.000Z'
    });

    await restoreBackup(db, {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: restoredSettings,
      shifts: [restoredShift],
      enterpriseSchedule: [restoredScheduleItem]
    });

    await expect(settingsRepository.getSettings()).resolves.toEqual(restoredSettings);
    await expect(getShiftsByMonth(shiftRepository, 2026, 6)).resolves.toEqual([restoredShift]);
    await expect(getEnterpriseScheduleByMonth(enterpriseScheduleRepository, 2026, 6)).resolves.toEqual([
      restoredScheduleItem
    ]);
    await expect(db.appMeta.toArray()).resolves.toEqual([]);

    await expect(
      restoreBackup(db, {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: '2026-06-24T12:30:00.000Z',
        settings: makeSettings({ employeeLastName: 'Зламані' }),
        shifts: [
          makeShift({
            id: 'duplicate-date-1',
            date: '2026-06-12',
            startTime: '2026-06-12T06:30:00.000Z',
            endTime: '2026-06-12T14:30:00.000Z'
          }),
          makeShift({
            id: 'duplicate-date-2',
            date: '2026-06-12',
            startTime: '2026-06-12T14:30:00.000Z',
            endTime: '2026-06-12T22:30:00.000Z',
            type: 'second',
            plannedStartTime: '14:30',
            plannedEndTime: '22:30'
          })
        ],
        enterpriseSchedule: []
      })
    ).rejects.toThrow();

    await expect(settingsRepository.getSettings()).resolves.toEqual(restoredSettings);
    await expect(getShiftsByMonth(shiftRepository, 2026, 6)).resolves.toEqual([restoredShift]);
  });

  it('rejects direct restore with more than one active shift before replacing data', async () => {
    const currentShift = makeShift({
      id: 'current-shift',
      endTime: '2026-06-10T14:30:00.000Z'
    });

    await shiftRepository.createShift(currentShift);

    await expect(
      restoreBackup(db, {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: '2026-06-24T12:30:00.000Z',
        settings: makeSettings(),
        shifts: [
          makeShift({
            id: 'active-1',
            date: '2026-06-11',
            startTime: '2026-06-11T06:30:00.000Z'
          }),
          makeShift({
            id: 'active-2',
            date: '2026-06-12',
            startTime: '2026-06-12T14:30:00.000Z',
            type: 'second',
            plannedStartTime: '14:30',
            plannedEndTime: '22:30'
          })
        ],
        enterpriseSchedule: []
      })
    ).rejects.toThrow('Backup містить більше однієї активної зміни.');

    await expect(getShiftsByMonth(shiftRepository, 2026, 6)).resolves.toEqual([currentShift]);
  });
});
