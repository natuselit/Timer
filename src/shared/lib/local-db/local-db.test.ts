import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../../entities/settings';
import {
  calculateEnterpriseScheduleComparison,
  parseEnterpriseScheduleText,
  type EnterpriseScheduleItem
} from '../../../entities/enterprise-schedule';
import type { Shift } from '../../../entities/shift';
import { ShifterDatabase } from './database';
import { EnterpriseScheduleRepository } from './repositories/enterpriseScheduleRepository';
import { OvertimeCoefficientRepository } from './repositories/overtimeCoefficientRepository';
import { ScheduleWarningReviewRepository } from './repositories/scheduleWarningReviewRepository';
import { normalizeSettingsRecord, SettingsRepository } from './repositories/settingsRepository';
import { ShiftConstraintError, ShiftRepository } from './repositories/shiftRepository';
import {
  BackupValidationError,
  BACKUP_SCHEMA_VERSION,
  CALENDAR_TUTORIAL_SEEN_KEY,
  adjustWorkTicketDowntime,
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
  importParsedEnterpriseSchedule,
  parseBackupJson,
  parseBackupImportJson,
  recalculateHourlyRateSnapshotsForPeriod,
  replaceShiftsFromLegacyBackup,
  replaceLocalDataWithDemo,
  restoreBackup,
  serializeBackup,
  saveSettings,
  skipEnterpriseScheduleDiscrepancy,
  syncShiftWithEnterpriseSchedule,
  updateActiveShiftNote,
  updateWorkTicketInActiveShift,
  updateShift
} from './index';

let db: ShifterDatabase;
let settingsRepository: SettingsRepository;
let shiftRepository: ShiftRepository;
let enterpriseScheduleRepository: EnterpriseScheduleRepository;
let scheduleWarningReviewRepository: ScheduleWarningReviewRepository;
let overtimeCoefficientRepository: OvertimeCoefficientRepository;

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
  note: '',
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
  shiftDetectionMode: 'auto',
  themePreference: 'system',
  backupReminderIntervalDays: 14,
  overtimeLimitPercent: 0,
  overtimeStepMinutes: 30,
  overtimeStrategy: 'standard',
  overtimeWeekdayMaxMinutes: 240,
  overtimeSaturdayMaxMinutes: 480,
  overtimeUnavailableDates: [],
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
  scheduleWarningReviewRepository = new ScheduleWarningReviewRepository(db);
  overtimeCoefficientRepository = new OvertimeCoefficientRepository(db);
});

afterEach(async () => {
  vi.restoreAllMocks();
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
      const migratedShift = await migratedDatabase.shifts.get(legacyShift.id);

      expect(migratedShift).toMatchObject({
        hourlyRateSnapshot: 100,
        workTickets: [
          {
            id: 'legacy-ticket',
            actualQuantity: null,
            manualCompletionPercent: null,
            downtimeMinutes: 0
          }
        ]
      });
      expect(migratedShift?.workTickets[0]).not.toHaveProperty('downtimeIntervals');
    } finally {
      migratedDatabase.close();
      await migratedDatabase.delete();
    }
  });

  it('converts an open legacy downtime interval to accumulated minutes', async () => {
    const databaseName = makeDbName();
    const legacyDatabase = new Dexie(databaseName);
    legacyDatabase.version(2).stores({
      settings: '&id',
      shifts: '&id,&date,updatedAt,createdAt',
      enterpriseSchedule: '&id,&date,createdAt',
      appMeta: '&key'
    });
    const migrationStartedAt = Date.now();
    const ticketStartedAt = new Date(migrationStartedAt - 60 * 60_000).toISOString();
    const downtimeStartedAt = new Date(migrationStartedAt - 10 * 60_000).toISOString();
    const legacyShift = {
      ...makeShift({
        id: 'legacy-open-downtime-shift',
        date: ticketStartedAt.slice(0, 10),
        startTime: ticketStartedAt,
        updatedAt: downtimeStartedAt
      }),
      workTickets: [
        {
          id: 'legacy-open-downtime-ticket',
          normPerEightHours: 80,
          startedAt: ticketStartedAt,
          endedAt: null,
          actualQuantity: null,
          downtimeMinutes: 5,
          downtimeIntervals: [
            {
              id: 'legacy-open-downtime',
              startedAt: downtimeStartedAt,
              endedAt: null
            }
          ],
          createdAt: ticketStartedAt,
          updatedAt: downtimeStartedAt
        }
      ]
    };

    await legacyDatabase.table('shifts').put(legacyShift);
    legacyDatabase.close();

    const migratedDatabase = new ShifterDatabase(databaseName);

    try {
      const migratedShift = await migratedDatabase.shifts.get(legacyShift.id);
      const migratedTicket = migratedShift?.workTickets[0];

      expect(migratedTicket?.downtimeMinutes).toBeGreaterThanOrEqual(15);
      expect(migratedTicket?.downtimeMinutes).toBeLessThanOrEqual(16);
      expect(migratedTicket).not.toHaveProperty('downtimeIntervals');
    } finally {
      migratedDatabase.close();
      await migratedDatabase.delete();
    }
  });

  it('forces the new grade preset without rewriting historical shift snapshots', async () => {
    const databaseName = makeDbName();
    const legacyDatabase = new Dexie(databaseName);
    legacyDatabase.version(3).stores({
      settings: '&id',
      shifts: '&id,&date,updatedAt,createdAt',
      enterpriseSchedule: '&id,&date,createdAt',
      appMeta: '&key'
    });
    const { backupReminderIntervalDays: _interval, ...legacySettings } = makeSettings({
      gradeSalaryBonusPercents: [1, 2, 3, 4]
    });
    const legacyShift = makeShift({
      endTime: '2026-06-10T14:30:00.000Z',
      gradeSnapshot: {
        currentGrade: 3,
        desiredGrade: 4,
        gradeSalaryBonusPercents: [1, 2, 3, 4],
        gradeNormPercents: [100, 120, 140, 160],
        cumulativeSalaryBonusPercent: 6
      }
    });

    await legacyDatabase.table('settings').put({ ...legacySettings, id: 'default' });
    await legacyDatabase.table('shifts').put(legacyShift);
    legacyDatabase.close();

    const migratedDatabase = new ShifterDatabase(databaseName);

    try {
      await expect(migratedDatabase.settings.get('default')).resolves.toMatchObject({
        gradeSalaryBonusPercents: [10, 10, 15, 15]
      });
      await expect(migratedDatabase.shifts.get(legacyShift.id)).resolves.toMatchObject({
        gradeSnapshot: {
          gradeSalaryBonusPercents: [1, 2, 3, 4],
          cumulativeSalaryBonusPercent: 6
        }
      });
    } finally {
      migratedDatabase.close();
      await migratedDatabase.delete();
    }
  });

  it('removes the legacy coefficient default and preserves unavailable dates', async () => {
    const databaseName = makeDbName();
    const legacyDatabase = new Dexie(databaseName);
    legacyDatabase.version(4).stores({
      settings: '&id',
      shifts: '&id,&date,updatedAt,createdAt',
      enterpriseSchedule: '&id,&date,createdAt',
      appMeta: '&key'
    });
    const legacyShift = makeShift({ coefficientMode: 'x2' });

    await legacyDatabase.table('settings').put({
      ...makeSettings(),
      id: 'default',
      coefficientMode: 'x1.5',
      overtimeUnavailableDates: ['2026-06-20']
    });
    await legacyDatabase.table('shifts').put(legacyShift);
    legacyDatabase.close();

    const migratedDatabase = new ShifterDatabase(databaseName);

    try {
      const migratedSettings = await migratedDatabase.settings.get('default');
      const migratedShift = await migratedDatabase.shifts.get(legacyShift.id);

      expect(migratedSettings).not.toHaveProperty('coefficientMode');
      expect(migratedSettings?.overtimeUnavailableDates).toEqual(['2026-06-20']);
      expect(migratedShift?.coefficientMode).toBe('x2');
    } finally {
      migratedDatabase.close();
      await migratedDatabase.delete();
    }
  });

  it('adds a null manual completion percent to tickets from IndexedDB schema v5', async () => {
    const databaseName = makeDbName();
    const legacyDatabase = new Dexie(databaseName);
    legacyDatabase.version(5).stores({
      settings: '&id',
      shifts: '&id,&date,updatedAt,createdAt',
      enterpriseSchedule: '&id,&date,createdAt',
      appMeta: '&key'
    });
    const legacyShift = {
      ...makeShift({
        id: 'legacy-manual-completion-shift',
        endTime: '2026-06-10T14:30:00.000Z'
      }),
      workTickets: [
        {
          id: 'legacy-manual-completion-ticket',
          normPerEightHours: 80,
          startedAt: '2026-06-10T07:00:00.000Z',
          endedAt: '2026-06-10T08:00:00.000Z',
          actualQuantity: 9,
          downtimeMinutes: 0,
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
        workTickets: [
          {
            id: 'legacy-manual-completion-ticket',
            manualCompletionPercent: null
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
      gradeSalaryBonusPercents: [10, 10, 15, 15],
      gradeNormPercents: [100, 120, 140, 160],
      forecastDays: 30,
      arriveHoldDelayMs: 1500,
      leaveHoldDelayMs: 1500,
      shiftDetectionMode: 'auto',
      themePreference: 'system',
      backupReminderIntervalDays: 14,
      overtimeLimitPercent: 0,
      overtimeStepMinutes: 30,
      overtimeStrategy: 'standard',
      overtimeWeekdayMaxMinutes: 240,
      overtimeSaturdayMaxMinutes: 480,
      overtimeUnavailableDates: [],
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
      gradeSalaryBonusPercents: [10, 10, 15, 15],
      gradeNormPercents: [100, 120, 140, 160],
      forecastDays: 30,
      arriveHoldDelayMs: 1200,
      leaveHoldDelayMs: 1800,
      shiftDetectionMode: 'manual',
      themePreference: 'dark',
      backupReminderIntervalDays: 30,
      overtimeLimitPercent: 12.5,
      overtimeStepMinutes: 15,
      overtimeStrategy: 'standard-plus',
      overtimeWeekdayMaxMinutes: 300,
      overtimeSaturdayMaxMinutes: 600,
      overtimeUnavailableDates: ['2026-06-27'],
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

  it('normalizes invalid overtime planning details and drops removed defaults', () => {
    const normalized = normalizeSettingsRecord({
      ...makeSettings(),
      id: 'default',
      coefficientMode: 'x2',
      overtimeStepMinutes: 17,
      overtimeSaturdayCount: 9,
      overtimeWeekdayMaxMinutes: 17,
      overtimeSaturdayMaxMinutes: 900,
      overtimeUnavailableDates: ['not-a-date']
    } as never);

    expect(normalized.overtimeStepMinutes).toBe(30);
    expect(normalized.overtimeWeekdayMaxMinutes).toBe(240);
    expect(normalized.overtimeSaturdayMaxMinutes).toBe(480);
    expect('coefficientMode' in normalized).toBe(false);
    expect(normalized.overtimeUnavailableDates).toEqual([]);
    expect('overtimeSaturdayCount' in normalized).toBe(false);
  });

  it('keeps valid unavailable dates sorted in normalized settings', () => {
    const normalized = normalizeSettingsRecord({
      ...makeSettings(),
      id: 'default',
      overtimeUnavailableDates: ['2026-06-27', '2026-06-20']
    });

    expect(normalized.overtimeUnavailableDates).toEqual([
      '2026-06-20',
      '2026-06-27'
    ]);
  });

  it.each([
    ['balanced', undefined, 'standard'],
    ['weekdays', undefined, 'standard'],
    ['automatic', undefined, 'standard'],
    ['custom', 2, 'standard'],
    ['custom', 3, 'standard-plus'],
    ['custom', 4, 'standard-plus-plus'],
    ['custom', 5, 'standard-plus-plus'],
    ['saturdays', undefined, 'standard-plus-plus']
  ])('migrates stored strategy %s with %s Saturdays to %s', (legacyStrategy, saturdayCount, expected) => {
    const normalized = normalizeSettingsRecord({
      ...makeSettings(),
      id: 'default',
      overtimeStrategy: legacyStrategy,
      overtimeSaturdayCount: saturdayCount
    } as never);

    expect(normalized.overtimeStrategy).toBe(expected);
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
      workTickets: [],
      note: '',
      coefficientMode: 'auto'
    });
    await expect(getActiveShift(shiftRepository)).resolves.toEqual(shift);
  });

  it('creates an active shift with an explicitly selected type', async () => {
    const shift = await createShift(shiftRepository, {
      id: 'selected-second-shift',
      startTime: '2026-06-10T06:00:00.000Z',
      type: 'second',
      hourlyRateSnapshot: 200,
      now: '2026-06-10T06:00:00.000Z'
    });

    expect(shift).toMatchObject({
      type: 'second',
      detectionMode: 'manual',
      plannedStartTime: '14:30',
      plannedEndTime: '22:30'
    });
  });

  it('updates a note only for an active shift and enforces its limit', async () => {
    const activeShift = await createShift(shiftRepository, {
      id: 'shift-with-note',
      startTime: '2026-06-10T06:30:00.000Z',
      hourlyRateSnapshot: 120,
      now: '2026-06-10T06:30:00.000Z'
    });

    const updatedShift = await updateActiveShiftNote(shiftRepository, {
      shiftId: activeShift.id,
      note: '  Перевірити партію №42  ',
      updatedAt: '2026-06-10T07:00:00.000Z'
    });

    expect(updatedShift.note).toBe('Перевірити партію №42');
    await expect(shiftRepository.getShiftById(activeShift.id)).resolves.toMatchObject({
      note: 'Перевірити партію №42',
      updatedAt: '2026-06-10T07:00:00.000Z'
    });

    await expect(
      updateActiveShiftNote(shiftRepository, {
        shiftId: activeShift.id,
        note: 'а'.repeat(501),
        updatedAt: '2026-06-10T07:05:00.000Z'
      })
    ).rejects.toThrow('не більше 500 символів');

    await updateShift(shiftRepository, {
      ...updatedShift,
      endTime: '2026-06-10T14:30:00.000Z',
      updatedAt: '2026-06-10T14:30:00.000Z'
    });

    await expect(
      updateActiveShiftNote(shiftRepository, {
        shiftId: activeShift.id,
        note: 'Пізнє редагування',
        updatedAt: '2026-06-10T14:31:00.000Z'
      })
    ).rejects.toThrow('Активну зміну не знайдено');
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
    await adjustWorkTicketDowntime(shiftRepository, {
      shiftId: shift.id,
      deltaMinutes: 10,
      updatedAt: '2026-06-10T08:00:00.000Z'
    });
    await completeWorkTicket(shiftRepository, {
      shiftId: shift.id,
      endedAt: '2026-06-10T09:00:00.000Z',
      actualQuantity: 17
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
      actualQuantity: 5
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

  it('accumulates signed downtime corrections and accepts zero fact', async () => {
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
    await adjustWorkTicketDowntime(shiftRepository, {
      shiftId: shift.id,
      deltaMinutes: 15,
      updatedAt: '2026-06-10T07:30:00.000Z'
    });
    await adjustWorkTicketDowntime(shiftRepository, {
      shiftId: shift.id,
      deltaMinutes: 10,
      updatedAt: '2026-06-10T07:45:00.000Z'
    });
    await adjustWorkTicketDowntime(shiftRepository, {
      shiftId: shift.id,
      deltaMinutes: -5,
      updatedAt: '2026-06-10T08:00:00.000Z'
    });

    const reloaded = await getActiveShift(shiftRepository);
    expect(reloaded?.workTickets[0].downtimeMinutes).toBe(20);

    await expect(
      adjustWorkTicketDowntime(shiftRepository, {
        shiftId: shift.id,
        deltaMinutes: 0,
        updatedAt: '2026-06-10T08:30:00.000Z'
      })
    ).rejects.toThrow('цілою ненульовою');
    await expect(
      adjustWorkTicketDowntime(shiftRepository, {
        shiftId: shift.id,
        deltaMinutes: 1.5,
        updatedAt: '2026-06-10T08:30:00.000Z'
      })
    ).rejects.toThrow('цілою ненульовою');
    await expect(
      adjustWorkTicketDowntime(shiftRepository, {
        shiftId: shift.id,
        deltaMinutes: -21,
        updatedAt: '2026-06-10T08:30:00.000Z'
      })
    ).rejects.toThrow('не може бути відʼємним');
    await expect(
      adjustWorkTicketDowntime(shiftRepository, {
        shiftId: shift.id,
        deltaMinutes: 71,
        updatedAt: '2026-06-10T08:30:00.000Z'
      })
    ).rejects.toThrow('не може бути довшим');

    const completed = await completeWorkTicket(shiftRepository, {
      shiftId: shift.id,
      endedAt: '2026-06-10T08:30:00.000Z',
      actualQuantity: 0
    });

    expect(completed.workTickets[0]).toMatchObject({
      actualQuantity: 0,
      downtimeMinutes: 20
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
      actualQuantity: 20
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
      actualQuantity: 20
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
          manualCompletionPercent: null,
          downtimeMinutes: 0,
          createdAt: '2026-06-11T07:00:00.000Z',
          updatedAt: '2026-06-11T07:00:00.000Z'
        },
        {
          id: 'completed-ticket-2',
          normPerEightHours: 25,
          startedAt: '2026-06-11T10:00:00.000Z',
          endedAt: '2026-06-11T14:30:00.000Z',
          actualQuantity: 15,
          manualCompletionPercent: null,
          downtimeMinutes: 0,
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
              manualCompletionPercent: null,
              downtimeMinutes: 0,
              createdAt: '2026-06-10T07:00:00.000Z',
              updatedAt: '2026-06-10T08:00:00.000Z'
            }
          ]
        })
      )
    ).rejects.toThrow('Фактична кількість');

    await expect(
      shiftRepository.createShift(
        makeShift({
          id: 'invalid-manual-completion-write',
          endTime: '2026-06-10T14:30:00.000Z',
          workTickets: [
            {
              id: 'invalid-manual-completion-ticket',
              normPerEightHours: 50,
              startedAt: '2026-06-10T07:00:00.000Z',
              endedAt: '2026-06-10T08:00:00.000Z',
              actualQuantity: 1,
              manualCompletionPercent: -1,
              downtimeMinutes: 0,
              createdAt: '2026-06-10T07:00:00.000Z',
              updatedAt: '2026-06-10T08:00:00.000Z'
            }
          ]
        })
      )
    ).rejects.toThrow('Ручний відсоток');
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

  it('keeps auto as the weekend default and preserves an explicit manual override', async () => {
    const saturday = await createManualShift(shiftRepository, {
      id: 'manual-saturday',
      date: '2026-06-13',
      type: 'first',
      startTime: '2026-06-13T06:30:00.000Z',
      endTime: '2026-06-13T14:30:00.000Z',
      hourlyRateSnapshot: 180,
      coefficientMode: 'auto',
      now: '2026-06-13T14:30:00.000Z'
    });
    const sunday = await createManualShift(shiftRepository, {
      id: 'manual-sunday',
      date: '2026-06-14',
      type: 'first',
      startTime: '2026-06-14T06:30:00.000Z',
      endTime: '2026-06-14T14:30:00.000Z',
      hourlyRateSnapshot: 180,
      coefficientMode: 'x2',
      now: '2026-06-14T14:30:00.000Z'
    });
    const secondSaturday = await createManualShift(shiftRepository, {
      id: 'manual-second-saturday',
      date: '2026-06-20',
      type: 'first',
      startTime: '2026-06-20T06:30:00.000Z',
      endTime: '2026-06-20T14:30:00.000Z',
      hourlyRateSnapshot: 180,
      coefficientMode: 'auto',
      now: '2026-06-20T14:30:00.000Z'
    });

    expect(saturday.coefficientMode).toBe('auto');
    expect(sunday.coefficientMode).toBe('x2');
    expect(secondSaturday.coefficientMode).toBe('auto');
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

  it('recalculates snapshots only inside an inclusive date period', async () => {
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
        baseHourlyRateSnapshot: 160,
        hourlyRateSnapshot: 160
      })
    );

    await expect(
      recalculateHourlyRateSnapshotsForPeriod(
        shiftRepository,
        17_600,
        {
          currentGrade: 1,
          desiredGrade: 2,
          gradeSalaryBonusPercents: [10, 10, 10, 10],
          gradeNormPercents: [100, 120, 140, 160]
        },
        { start: '2026-06-10', end: '2026-06-10' },
        '2026-07-31T12:00:00.000Z'
      )
    ).resolves.toBe(1);

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
      baseHourlyRateSnapshot: 160,
      hourlyRateSnapshot: 160
    });
  });
});

describe('enterprise schedule repository use-cases', () => {
  it('imports an already parsed multi-month schedule and preserves existing shifts', async () => {
    const existingShift = makeShift({
      id: 'existing-june-shift',
      date: '2026-06-02',
      startTime: '2026-06-02T06:30:00.000+03:00',
      endTime: '2026-06-02T14:30:00.000+03:00'
    });
    const parsedResult = parseEnterpriseScheduleText(`--30.05.2026--
In time: 06:00
Out time: 15:29
Total: 09:29
--31.05.2026--
In time:
Out time:
Total: :
--01.06.2026--
In time: 05:57
Out time: 16:52
Total: 10:55
--02.06.2026--
In time: 06:30
Out time: 14:30
Total: 08:00`);

    await shiftRepository.createShift(existingShift);

    const result = await importParsedEnterpriseSchedule(
      enterpriseScheduleRepository,
      parsedResult,
      '2026-06-23T10:00:00.000+03:00',
      {
        shiftRepository,
        settings: makeSettings({ monthlySalary: 36_960 })
      }
    );

    expect(result.savedCount).toBe(3);
    expect(result.createdShiftCount).toBe(2);
    expect(result.skippedEmptyCount).toBe(1);
    await expect(
      getEnterpriseScheduleBetween(
        enterpriseScheduleRepository,
        '2026-05-01',
        '2026-06-30'
      )
    ).resolves.toHaveLength(3);
    await expect(shiftRepository.getShiftById(existingShift.id)).resolves.toEqual(existingShift);
  });

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
        settings: makeSettings({ monthlySalary: 36_960 })
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
      coefficientMode: 'auto'
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
        endTime: '2026-06-01T14:30:00.000+03:00',
        coefficientMode: 'x2'
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
        coefficientMode: 'x2',
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

describe('schedule warning review repository', () => {
  it('marks, reads, replaces and clears reviewed warnings', async () => {
    const firstReview = {
      shiftId: 'shift-1',
      fingerprint: 'first-fingerprint',
      reviewedAt: '2026-06-24T12:00:00.000Z'
    };
    const updatedReview = {
      ...firstReview,
      fingerprint: 'updated-fingerprint',
      reviewedAt: '2026-06-24T12:30:00.000Z'
    };

    await scheduleWarningReviewRepository.markReviewed(firstReview);
    await expect(
      scheduleWarningReviewRepository.getByShiftIds(['shift-1', 'missing'])
    ).resolves.toEqual([firstReview]);

    await scheduleWarningReviewRepository.markReviewed(updatedReview);
    await expect(scheduleWarningReviewRepository.getAll()).resolves.toEqual([
      updatedReview
    ]);

    await scheduleWarningReviewRepository.deleteByShiftId('shift-1');
    await expect(scheduleWarningReviewRepository.getAll()).resolves.toEqual([]);

    await scheduleWarningReviewRepository.markReviewed(firstReview);
    await scheduleWarningReviewRepository.clearAll();
    await expect(scheduleWarningReviewRepository.getAll()).resolves.toEqual([]);
  });
});

describe('Saturday double-rate persistence', () => {
  it('confirms a month transactionally and updates only Saturday x1.5 shifts', async () => {
    const saturday = makeShift({
      id: 'saturday-x1-5',
      date: '2026-06-06',
      startTime: '2026-06-06T06:30:00.000Z',
      endTime: '2026-06-06T14:30:00.000Z',
      coefficientMode: 'x1.5'
    });
    const oldSaturday = makeShift({
      id: 'saturday-auto',
      date: '2026-06-13',
      startTime: '2026-06-13T06:30:00.000Z',
      endTime: '2026-06-13T14:30:00.000Z',
      coefficientMode: 'auto'
    });
    const sunday = makeShift({
      id: 'sunday-x1-5',
      date: '2026-06-07',
      startTime: '2026-06-07T06:30:00.000Z',
      endTime: '2026-06-07T14:30:00.000Z',
      coefficientMode: 'x1.5'
    });
    const weekday = makeShift({
      id: 'weekday-x1-5',
      date: '2026-06-08',
      startTime: '2026-06-08T06:30:00.000Z',
      endTime: '2026-06-08T14:30:00.000Z',
      coefficientMode: 'x1.5'
    });

    await db.shifts.bulkPut([saturday, oldSaturday, sunday, weekday]);

    const result = await overtimeCoefficientRepository.confirmDoubleRate(
      '2026-06',
      '2026-07-01T08:00:00.000Z'
    );

    expect(result.updatedShiftCount).toBe(1);
    await expect(overtimeCoefficientRepository.isDoubleRateConfirmed('2026-06')).resolves.toBe(true);
    await expect(db.shifts.get(saturday.id)).resolves.toMatchObject({ coefficientMode: 'x2' });
    await expect(db.shifts.get(oldSaturday.id)).resolves.toMatchObject({ coefficientMode: 'auto' });
    await expect(db.shifts.get(sunday.id)).resolves.toMatchObject({ coefficientMode: 'x1.5' });
    await expect(db.shifts.get(weekday.id)).resolves.toMatchObject({ coefficientMode: 'x1.5' });
  });

  it('rolls back shift changes if the confirmation marker cannot be saved', async () => {
    const saturday = makeShift({
      id: 'rollback-saturday',
      date: '2026-06-06',
      startTime: '2026-06-06T06:30:00.000Z',
      endTime: '2026-06-06T14:30:00.000Z',
      coefficientMode: 'x1.5'
    });
    await db.shifts.put(saturday);
    vi.spyOn(db.appMeta, 'put').mockRejectedValueOnce(new Error('write failed'));

    await expect(
      overtimeCoefficientRepository.confirmDoubleRate(
        '2026-06',
        '2026-07-01T08:00:00.000Z'
      )
    ).rejects.toThrow('write failed');
    await expect(db.shifts.get(saturday.id)).resolves.toMatchObject({ coefficientMode: 'x1.5' });
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
    await scheduleWarningReviewRepository.markReviewed({
      shiftId: shift.id,
      fingerprint: 'backup-fingerprint',
      reviewedAt: '2026-06-24T11:00:00.000Z'
    });
    await overtimeCoefficientRepository.confirmDoubleRate(
      '2026-06',
      '2026-06-24T11:30:00.000Z'
    );

    const backup = await createBackup(db, '2026-06-24T12:00:00.000Z');
    const parsed = parseBackupJson(serializeBackup(backup));

    expect(parsed).toEqual({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings,
      shifts: [shift],
      enterpriseSchedule: [scheduleItem],
      reviewedScheduleWarnings: [
        {
          shiftId: shift.id,
          fingerprint: 'backup-fingerprint',
          reviewedAt: '2026-06-24T11:00:00.000Z'
        }
      ],
      confirmedSaturdayDoubleRateMonths: [
        {
          month: '2026-06',
          confirmedAt: '2026-06-24T11:30:00.000Z'
        }
      ]
    });
  });

  it('round-trips schema v16 with unavailable dates and preserves shift coefficients', () => {
    const shift = makeShift({
      id: 'production-backup-shift',
      endTime: '2026-06-10T14:30:00.000Z',
      coefficientMode: 'x2',
      note: 'Передати партію наступній зміні',
      workTickets: [
        {
          id: 'production-ticket',
          normPerEightHours: 80,
          startedAt: '2026-06-10T07:00:00.000Z',
          endedAt: '2026-06-10T08:00:00.000Z',
          actualQuantity: 9,
          manualCompletionPercent: 137,
          downtimeMinutes: 6,
          createdAt: '2026-06-10T07:00:00.000Z',
          updatedAt: '2026-06-10T08:00:00.000Z'
        }
      ]
    });
    const source = serializeBackup({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings({
        overtimeStrategy: 'standard-plus',
        overtimeUnavailableDates: ['2026-06-27']
      }),
      shifts: [shift],
      enterpriseSchedule: [],
      reviewedScheduleWarnings: [
        {
          shiftId: shift.id,
          fingerprint: 'round-trip-fingerprint',
          reviewedAt: '2026-06-24T11:00:00.000Z'
        }
      ],
      confirmedSaturdayDoubleRateMonths: [
        {
          month: '2026-06',
          confirmedAt: '2026-06-24T11:30:00.000Z'
        }
      ]
    });

    const parsed = parseBackupJson(source);

    expect(BACKUP_SCHEMA_VERSION).toBe(16);
    expect(parsed).toMatchObject({
      settings: {
        overtimeStepMinutes: 30,
        overtimeStrategy: 'standard-plus',
        overtimeWeekdayMaxMinutes: 240,
        overtimeSaturdayMaxMinutes: 480,
        overtimeUnavailableDates: ['2026-06-27']
      },
      shifts: [shift],
      reviewedScheduleWarnings: [
        {
          shiftId: shift.id,
          fingerprint: 'round-trip-fingerprint',
          reviewedAt: '2026-06-24T11:00:00.000Z'
        }
      ]
    });
    expect(parsed.shifts[0]?.coefficientMode).toBe('x2');
    expect(parsed.shifts[0]?.workTickets[0]?.manualCompletionPercent).toBe(137);
    expect(parsed.settings).not.toHaveProperty('coefficientMode');
    expect(parsed.settings).not.toHaveProperty('overtimeSaturdayCount');
  });

  it('imports schema v15 tickets without a manual completion percent as automatic', () => {
    const legacyBackup = JSON.parse(
      serializeBackup({
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: '2026-06-24T12:00:00.000Z',
        settings: makeSettings(),
        shifts: [
          makeShift({
            id: 'legacy-v15-production-shift',
            endTime: '2026-06-10T14:30:00.000Z',
            workTickets: [
              {
                id: 'legacy-v15-production-ticket',
                normPerEightHours: 80,
                startedAt: '2026-06-10T07:00:00.000Z',
                endedAt: '2026-06-10T08:00:00.000Z',
                actualQuantity: 9,
                manualCompletionPercent: null,
                downtimeMinutes: 0,
                createdAt: '2026-06-10T07:00:00.000Z',
                updatedAt: '2026-06-10T08:00:00.000Z'
              }
            ]
          })
        ],
        enterpriseSchedule: [],
        reviewedScheduleWarnings: [],
        confirmedSaturdayDoubleRateMonths: []
      })
    );
    legacyBackup.schemaVersion = 15;
    delete legacyBackup.shifts[0].workTickets[0].manualCompletionPercent;

    const parsed = parseBackupJson(JSON.stringify(legacyBackup));

    expect(parsed.schemaVersion).toBe(16);
    expect(parsed.shifts[0]?.workTickets[0]?.manualCompletionPercent).toBeNull();
  });

  it('imports schema v12 while restoring unavailable dates and preserving shift mode', () => {
    const shift = makeShift({
      id: 'legacy-v12-shift',
      endTime: '2026-06-10T14:30:00.000Z',
      coefficientMode: 'x1'
    });
    const source = JSON.stringify({
      schemaVersion: 12,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: {
        ...makeSettings(),
        coefficientMode: 'x2',
        overtimeSaturdayCount: 1,
        overtimeUnavailableDates: ['2026-06-20']
      },
      shifts: [shift],
      enterpriseSchedule: [],
      reviewedScheduleWarnings: [],
      confirmedSaturdayDoubleRateMonths: []
    });

    const parsed = parseBackupJson(source);

    expect(parsed.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
    expect(parsed.settings).not.toHaveProperty('coefficientMode');
    expect(parsed.settings.overtimeUnavailableDates).toEqual(['2026-06-20']);
    expect(parsed.shifts[0]?.coefficientMode).toBe('x1');
  });

  it('imports schema v14 with an empty unavailable-date list', () => {
    const { overtimeUnavailableDates: _unavailableDates, ...legacySettings } = makeSettings();
    const source = JSON.stringify({
      schemaVersion: 14,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: legacySettings,
      shifts: [],
      enterpriseSchedule: [],
      reviewedScheduleWarnings: [],
      confirmedSaturdayDoubleRateMonths: []
    });

    expect(parseBackupJson(source).settings.overtimeUnavailableDates).toEqual([]);
  });

  it.each([
    ['standard', 1, 'standard'],
    ['weekdays', 1, 'standard'],
    ['automatic', 1, 'standard'],
    ['custom', 2, 'standard'],
    ['custom', 3, 'standard-plus'],
    ['custom', 4, 'standard-plus-plus'],
    ['custom', 5, 'standard-plus-plus'],
    ['saturdays', 1, 'standard-plus-plus']
  ])(
    'migrates schema v13 strategy %s with %s Saturdays to %s',
    (legacyStrategy, saturdayCount, expected) => {
      const source = JSON.stringify({
        schemaVersion: 13,
        exportedAt: '2026-06-24T12:00:00.000Z',
        settings: {
          ...makeSettings(),
          overtimeStrategy: legacyStrategy,
          overtimeSaturdayCount: saturdayCount
        },
        shifts: [],
        enterpriseSchedule: [],
        reviewedScheduleWarnings: [],
        confirmedSaturdayDoubleRateMonths: []
      });

      const parsed = parseBackupJson(source);

      expect(parsed.settings.overtimeStrategy).toBe(expected);
      expect(parsed.settings).not.toHaveProperty('overtimeSaturdayCount');
    }
  );

  it('migrates schema v10 to the default recommendation step and fixed strategy', () => {
    const { overtimeStepMinutes: _step, ...legacySettings } = makeSettings();
    const source = JSON.stringify({
      schemaVersion: 10,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: {
        ...legacySettings,
        overtimeStrategy: 'saturdays'
      },
      shifts: [],
      enterpriseSchedule: [],
      reviewedScheduleWarnings: [],
      confirmedSaturdayDoubleRateMonths: []
    });

    expect(parseBackupJson(source).settings).toMatchObject({
      overtimeStepMinutes: 30,
      overtimeStrategy: 'standard-plus-plus',
      overtimeWeekdayMaxMinutes: 240,
      overtimeSaturdayMaxMinutes: 480
    });
  });

  it('migrates schema v11 balanced strategy and availability defaults', () => {
    const {
      overtimeWeekdayMaxMinutes: _weekdayMax,
      overtimeSaturdayMaxMinutes: _saturdayMax,
      ...legacySettings
    } = makeSettings();
    const source = JSON.stringify({
      schemaVersion: 11,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: {
        ...legacySettings,
        overtimeStrategy: 'balanced',
        overtimeSaturdayCount: 1
      },
      shifts: [],
      enterpriseSchedule: [],
      reviewedScheduleWarnings: [],
      confirmedSaturdayDoubleRateMonths: []
    });

    expect(parseBackupJson(source).settings).toMatchObject({
      overtimeStrategy: 'standard',
      overtimeWeekdayMaxMinutes: 240,
      overtimeSaturdayMaxMinutes: 480
    });
  });

  it('migrates schema v8 shifts with an empty note', () => {
    const { note: _note, ...legacyShift } = makeShift({
      id: 'schema-v8-shift',
      endTime: '2026-06-10T14:30:00.000Z'
    });
    const source = JSON.stringify({
      schemaVersion: 8,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings(),
      shifts: [legacyShift],
      enterpriseSchedule: [],
      reviewedScheduleWarnings: [],
      confirmedSaturdayDoubleRateMonths: []
    });

    const parsed = parseBackupJson(source);

    expect(parsed.shifts[0].note).toBe('');
    expect(parsed.settings).toMatchObject({
      overtimeLimitPercent: 0,
      overtimeStepMinutes: 30,
      overtimeStrategy: 'standard'
    });
    expect(parsed.confirmedSaturdayDoubleRateMonths).toEqual([]);
  });

  it('migrates schema v7 to the required grade preset and default reminder interval', () => {
    const {
      backupReminderIntervalDays: _interval,
      ...legacySettings
    } = makeSettings({ gradeSalaryBonusPercents: [1, 2, 3, 4] });
    const source = JSON.stringify({
      schemaVersion: 7,
      exportedAt: '2026-08-01T08:00:00.000Z',
      settings: legacySettings,
      shifts: [],
      enterpriseSchedule: [],
      reviewedScheduleWarnings: [],
      confirmedSaturdayDoubleRateMonths: []
    });

    expect(parseBackupJson(source).settings).toMatchObject({
      gradeSalaryBonusPercents: [10, 10, 15, 15],
      backupReminderIntervalDays: 14
    });
  });

  it('converts an open downtime interval while importing schema v5', () => {
    const legacyShift = {
      ...makeShift({
        id: 'legacy-production-backup-shift',
        endTime: null,
        updatedAt: '2026-06-10T08:00:00.000Z'
      }),
      workTickets: [
        {
          id: 'legacy-production-ticket',
          normPerEightHours: 80,
          startedAt: '2026-06-10T07:00:00.000Z',
          endedAt: null,
          actualQuantity: null,
          downtimeMinutes: 5,
          downtimeIntervals: [
            {
              id: 'legacy-open-downtime',
              startedAt: '2026-06-10T08:00:00.000Z',
              endedAt: null
            }
          ],
          createdAt: '2026-06-10T07:00:00.000Z',
          updatedAt: '2026-06-10T08:00:00.000Z'
        }
      ]
    };
    const source = JSON.stringify({
      schemaVersion: 5,
      exportedAt: '2026-06-10T09:00:00.000Z',
      settings: makeSettings(),
      shifts: [legacyShift],
      enterpriseSchedule: []
    });

    const parsed = parseBackupJson(source);
    const parsedTicket = parsed.shifts[0].workTickets[0];

    expect(parsedTicket.downtimeMinutes).toBe(65);
    expect(parsedTicket).not.toHaveProperty('downtimeIntervals');
    expect(parsed.reviewedScheduleWarnings).toEqual([]);
  });

  it('parses older backups without employee first name', () => {
    const source = serializeBackup({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings(),
      shifts: [],
      enterpriseSchedule: [],
      reviewedScheduleWarnings: [],
      confirmedSaturdayDoubleRateMonths: []
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
    expect(parsed.reviewedScheduleWarnings).toEqual([]);
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
      gradeSalaryBonusPercents: [10, 10, 15, 15],
      gradeNormPercents: [100, 120, 140, 160],
      themePreference: 'system',
      backupReminderIntervalDays: 14
    });
    expect(parsed.shifts[0]).toMatchObject({
      id: 'legacy-v2-shift',
      baseHourlyRateSnapshot: 120,
      gradeSnapshot: null,
      workTickets: []
    });
    expect(parsed.reviewedScheduleWarnings).toEqual([]);
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
    expect(parsed.reviewedScheduleWarnings).toEqual([]);
  });

  it.each([4, 6])(
    'imports schema v%s without reviewed warnings as an empty review list',
    (schemaVersion) => {
      const source = JSON.stringify({
        schemaVersion,
        exportedAt: '2026-06-24T12:00:00.000Z',
        settings: makeSettings(),
        shifts: [],
        enterpriseSchedule: []
      });

      expect(parseBackupJson(source).reviewedScheduleWarnings).toEqual([]);
    }
  );

  it('rejects missing, invalid, duplicate and orphaned schema v7 warning reviews', () => {
    const shift = makeShift({
      id: 'reviewed-shift',
      endTime: '2026-06-10T14:30:00.000Z'
    });
    const baseBackup = {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings(),
      shifts: [shift],
      enterpriseSchedule: [],
      confirmedSaturdayDoubleRateMonths: []
    };

    expect(() => parseBackupJson(JSON.stringify(baseBackup))).toThrow(
      'reviewedScheduleWarnings має бути масивом.'
    );
    expect(() =>
      parseBackupJson(
        JSON.stringify({
          ...baseBackup,
          reviewedScheduleWarnings: [
            {
              shiftId: shift.id,
              fingerprint: '',
              reviewedAt: '2026-06-24T11:00:00.000Z'
            }
          ]
        })
      )
    ).toThrow(BackupValidationError);
    expect(() =>
      parseBackupJson(
        JSON.stringify({
          ...baseBackup,
          reviewedScheduleWarnings: [
            {
              shiftId: shift.id,
              fingerprint: 'same',
              reviewedAt: '2026-06-24T11:00:00.000Z'
            },
            {
              shiftId: shift.id,
              fingerprint: 'same',
              reviewedAt: '2026-06-24T11:01:00.000Z'
            }
          ]
        })
      )
    ).toThrow(`дві позначки попередження для зміни ${shift.id}`);
    expect(() =>
      parseBackupJson(
        JSON.stringify({
          ...baseBackup,
          reviewedScheduleWarnings: [
            {
              shiftId: 'missing-shift',
              fingerprint: 'orphan',
              reviewedAt: '2026-06-24T11:00:00.000Z'
            }
          ]
        })
      )
    ).toThrow('посилається на відсутню зміну missing-shift');
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
      enterpriseSchedule: [],
      reviewedScheduleWarnings: [],
      confirmedSaturdayDoubleRateMonths: []
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
      enterpriseSchedule: [],
      reviewedScheduleWarnings: [],
      confirmedSaturdayDoubleRateMonths: []
    });

    expect(() => parseBackupJson(source)).toThrow(BackupValidationError);
    expect(() => parseBackupJson(source)).toThrow('Поле monthlySalary не може бути відʼємним.');
  });

  it('rejects an unsupported backup reminder interval in the current schema', () => {
    const parsed = JSON.parse(
      serializeBackup({
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: '2026-08-01T08:00:00.000Z',
        settings: makeSettings(),
        shifts: [],
        enterpriseSchedule: [],
        reviewedScheduleWarnings: [],
        confirmedSaturdayDoubleRateMonths: []
      })
    );
    parsed.settings.backupReminderIntervalDays = 10;

    expect(() => parseBackupJson(JSON.stringify(parsed))).toThrow(
      'Періодичність backup має бути 7, 14 або 30 днів.'
    );
  });

  it('rejects invalid overtime maximums and validates unavailable dates in schemas v12 and v15', () => {
    const parsed = JSON.parse(
      serializeBackup({
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: '2026-08-01T08:00:00.000Z',
        settings: makeSettings(),
        shifts: [],
        enterpriseSchedule: [],
        reviewedScheduleWarnings: [],
        confirmedSaturdayDoubleRateMonths: []
      })
    );
    parsed.settings.overtimeWeekdayMaxMinutes = 17;

    expect(() => parseBackupJson(JSON.stringify(parsed))).toThrow(
      'settings.overtimeWeekdayMaxMinutes'
    );

    parsed.settings.overtimeWeekdayMaxMinutes = 240;
    delete parsed.settings.overtimeUnavailableDates;
    expect(() => parseBackupJson(JSON.stringify(parsed))).toThrow(
      'settings.overtimeUnavailableDates'
    );

    parsed.settings.overtimeUnavailableDates = ['2026-08-12', '2026-08-12'];
    expect(() => parseBackupJson(JSON.stringify(parsed))).toThrow(
      'settings.overtimeUnavailableDates'
    );

    const legacyV12 = structuredClone(parsed);
    legacyV12.schemaVersion = 12;
    legacyV12.settings.overtimeWeekdayMaxMinutes = 240;
    legacyV12.settings.coefficientMode = 'auto';
    legacyV12.settings.overtimeUnavailableDates = ['2026-08-12', '2026-08-12'];

    expect(() => parseBackupJson(JSON.stringify(legacyV12))).toThrow(
      'settings.overtimeUnavailableDates'
    );
  });

  it('rejects schema v4 backup with invalid theme preference', () => {
    const source = serializeBackup({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings(),
      shifts: [],
      enterpriseSchedule: [],
      reviewedScheduleWarnings: [],
      confirmedSaturdayDoubleRateMonths: []
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
      enterpriseSchedule: [],
      reviewedScheduleWarnings: [],
      confirmedSaturdayDoubleRateMonths: []
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
              manualCompletionPercent: null,
              downtimeMinutes: 0,
              createdAt: '2026-06-10T09:00:00.000Z',
              updatedAt: '2026-06-10T08:00:00.000Z'
            }
          ]
        })
      ],
      enterpriseSchedule: [],
      reviewedScheduleWarnings: [],
      confirmedSaturdayDoubleRateMonths: []
    });

    expect(() => parseBackupJson(source)).toThrow(BackupValidationError);
    expect(() => parseBackupJson(source)).toThrow('Тікет не може завершуватись раніше старту.');
  });

  it.each([
    ['відʼємний', -1],
    ['нецілий', 99.5]
  ])('rejects a %s manual completion percent in schema v16', (_label, invalidPercent) => {
    const parsed = JSON.parse(
      serializeBackup({
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: '2026-06-24T12:00:00.000Z',
        settings: makeSettings(),
        shifts: [
          makeShift({
            id: 'invalid-manual-completion-shift',
            endTime: '2026-06-10T14:30:00.000Z',
            workTickets: [
              {
                id: 'invalid-manual-completion-ticket',
                normPerEightHours: 80,
                startedAt: '2026-06-10T07:00:00.000Z',
                endedAt: '2026-06-10T08:00:00.000Z',
                actualQuantity: 9,
                manualCompletionPercent: null,
                downtimeMinutes: 0,
                createdAt: '2026-06-10T07:00:00.000Z',
                updatedAt: '2026-06-10T08:00:00.000Z'
              }
            ]
          })
        ],
        enterpriseSchedule: [],
        reviewedScheduleWarnings: [],
        confirmedSaturdayDoubleRateMonths: []
      })
    );
    parsed.shifts[0].workTickets[0].manualCompletionPercent = invalidPercent;

    expect(() => parseBackupJson(JSON.stringify(parsed))).toThrow(BackupValidationError);
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
              manualCompletionPercent: null,
              downtimeMinutes: invalidValues.downtimeMinutes,
              createdAt: '2026-06-10T07:00:00.000Z',
              updatedAt: '2026-06-10T08:00:00.000Z'
            }
          ]
        })
      ],
      enterpriseSchedule: [],
      reviewedScheduleWarnings: [],
      confirmedSaturdayDoubleRateMonths: []
    });

    expect(() => parseBackupJson(source)).toThrow(BackupValidationError);
  });

  it('rejects calendar-invalid dates and a shift ending before arrival', () => {
    const invalidDateSource = serializeBackup({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: makeSettings(),
      shifts: [],
      enterpriseSchedule: [makeScheduleItem({ date: '2026-02-30' })],
      reviewedScheduleWarnings: [],
      confirmedSaturdayDoubleRateMonths: []
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
      enterpriseSchedule: [],
      reviewedScheduleWarnings: [],
      confirmedSaturdayDoubleRateMonths: []
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
      enterpriseSchedule: [],
      reviewedScheduleWarnings: [],
      confirmedSaturdayDoubleRateMonths: []
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
    await db.appMeta.bulkPut([
      {
        key: 'stale',
        value: 'true',
        updatedAt: '2026-06-23T10:00:00.000Z'
      },
      {
        key: CALENDAR_TUTORIAL_SEEN_KEY,
        value: 'true',
        updatedAt: '2026-06-23T11:00:00.000Z'
      }
    ]);

    await restoreBackup(db, {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-06-24T12:00:00.000Z',
      settings: restoredSettings,
      shifts: [restoredShift],
      enterpriseSchedule: [restoredScheduleItem],
      reviewedScheduleWarnings: [
        {
          shiftId: restoredShift.id,
          fingerprint: 'restored-fingerprint',
          reviewedAt: '2026-06-24T11:00:00.000Z'
        }
      ],
      confirmedSaturdayDoubleRateMonths: [
        {
          month: '2026-06',
          confirmedAt: '2026-06-24T11:30:00.000Z'
        }
      ]
    });

    await expect(settingsRepository.getSettings()).resolves.toEqual(restoredSettings);
    await expect(getShiftsByMonth(shiftRepository, 2026, 6)).resolves.toEqual([restoredShift]);
    await expect(getEnterpriseScheduleByMonth(enterpriseScheduleRepository, 2026, 6)).resolves.toEqual([
      restoredScheduleItem
    ]);
    await expect(scheduleWarningReviewRepository.getAll()).resolves.toEqual([
      {
        shiftId: restoredShift.id,
        fingerprint: 'restored-fingerprint',
        reviewedAt: '2026-06-24T11:00:00.000Z'
      }
    ]);
    await expect(overtimeCoefficientRepository.isDoubleRateConfirmed('2026-06')).resolves.toBe(
      true
    );
    await expect(db.appMeta.get(CALENDAR_TUTORIAL_SEEN_KEY)).resolves.toMatchObject({
      value: 'true'
    });
    await expect(db.appMeta.get('stale')).resolves.toBeUndefined();

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
        enterpriseSchedule: [],
        reviewedScheduleWarnings: [],
        confirmedSaturdayDoubleRateMonths: []
      })
    ).rejects.toThrow();

    await expect(settingsRepository.getSettings()).resolves.toEqual(restoredSettings);
    await expect(getShiftsByMonth(shiftRepository, 2026, 6)).resolves.toEqual([restoredShift]);
    await expect(scheduleWarningReviewRepository.getAll()).resolves.toHaveLength(1);
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
        enterpriseSchedule: [],
        reviewedScheduleWarnings: [],
        confirmedSaturdayDoubleRateMonths: []
      })
    ).rejects.toThrow('Backup містить більше однієї активної зміни.');

    await expect(getShiftsByMonth(shiftRepository, 2026, 6)).resolves.toEqual([currentShift]);
  });

  it('detects the old app format and preserves historical shift snapshots', () => {
    const firstStartedAt = new Date('2026-07-27T06:00:27.000+03:00').getTime();
    const firstEndedAt = new Date('2026-07-27T16:48:13.000+03:00').getTime();
    const secondStartedAt = new Date('2026-07-28T14:26:00.000+03:00').getTime();
    const secondEndedAt = new Date('2026-07-28T22:31:00.000+03:00').getTime();
    const parsed = parseBackupImportJson(
      JSON.stringify({
        version: 1,
        exportedAt: '2026-07-28T20:00:00.000Z',
        settings: {
          rate: 280,
          surname: 'Кухарчук',
          accentColor: 'yellow'
        },
        shifts: [
          {
            id: 'legacy-first',
            startedAt: firstStartedAt,
            endedAt: firstEndedAt,
            rate: 280,
            shiftType: '1 зміна',
            rateMultiplier: 1.5,
            doubleRate: false
          },
          {
            id: 'legacy-second',
            startedAt: secondStartedAt,
            endedAt: secondEndedAt,
            rate: 234.995,
            shiftType: '2 зміна',
            doubleRate: true
          }
        ],
        lastShift: {
          id: 'legacy-second'
        }
      })
    );

    expect(parsed.kind).toBe('legacy');

    if (parsed.kind !== 'legacy') {
      throw new Error('Expected legacy backup');
    }

    expect(parsed.shifts).toHaveLength(2);
    expect(parsed.shifts[0]).toMatchObject({
      id: 'legacy-first',
      date: '2026-07-27',
      type: 'first',
      detectionMode: 'manual',
      plannedStartTime: '06:30',
      plannedEndTime: '14:30',
      baseHourlyRateSnapshot: 280,
      hourlyRateSnapshot: 280,
      gradeSnapshot: null,
      workTickets: [],
      coefficientMode: 'x1.5',
      isAutoClosed: false
    });
    expect(new Date(parsed.shifts[0].startTime).getTime()).toBe(firstStartedAt);
    expect(new Date(parsed.shifts[0].endTime!).getTime()).toBe(firstEndedAt);
    expect(parsed.shifts[1]).toMatchObject({
      id: 'legacy-second',
      type: 'second',
      plannedStartTime: '14:30',
      plannedEndTime: '22:30',
      baseHourlyRateSnapshot: 234.995,
      coefficientMode: 'x2'
    });
  });

  it('replaces only shifts from the old app and preserves other local data', async () => {
    const currentSettings = makeSettings({
      employeeFirstName: 'Артем',
      employeeLastName: 'Чинні'
    });
    const currentShift = makeShift({
      id: 'current-shift',
      endTime: '2026-06-10T14:30:00.000Z'
    });
    const scheduleItem = makeScheduleItem();
    const importedShift = makeShift({
      id: 'legacy-imported',
      date: '2026-07-27',
      startTime: '2026-07-27T06:00:00.000+03:00',
      endTime: '2026-07-27T14:30:00.000+03:00',
      baseHourlyRateSnapshot: 280,
      hourlyRateSnapshot: 280,
      coefficientMode: 'x1'
    });

    await settingsRepository.saveSettings(currentSettings);
    await shiftRepository.createShift(currentShift);
    await enterpriseScheduleRepository.importItems([scheduleItem]);
    await db.appMeta.put({
      key: 'keep-me',
      value: 'true',
      updatedAt: '2026-07-27T12:00:00.000Z'
    });
    await scheduleWarningReviewRepository.markReviewed({
      shiftId: currentShift.id,
      fingerprint: 'stale-review',
      reviewedAt: '2026-07-27T12:00:00.000Z'
    });

    await replaceShiftsFromLegacyBackup(db, [importedShift]);

    await expect(settingsRepository.getSettings()).resolves.toEqual(currentSettings);
    await expect(db.shifts.toArray()).resolves.toEqual([importedShift]);
    await expect(db.enterpriseSchedule.toArray()).resolves.toEqual([scheduleItem]);
    await expect(db.appMeta.toArray()).resolves.toEqual([
      {
        key: 'keep-me',
        value: 'true',
        updatedAt: '2026-07-27T12:00:00.000Z'
      }
    ]);
  });

  it('rolls back the old history when writing imported shifts fails', async () => {
    const currentShift = makeShift({
      id: 'current-shift',
      endTime: '2026-06-10T14:30:00.000Z'
    });
    const importedShift = makeShift({
      id: 'legacy-imported',
      date: '2026-07-27',
      startTime: '2026-07-27T06:00:00.000+03:00',
      endTime: '2026-07-27T14:30:00.000+03:00'
    });

    await shiftRepository.createShift(currentShift);
    vi.spyOn(db.shifts, 'bulkPut').mockRejectedValueOnce(new Error('write failed'));

    await expect(
      replaceShiftsFromLegacyBackup(db, [importedShift])
    ).rejects.toThrow('write failed');
    await expect(db.shifts.toArray()).resolves.toEqual([currentShift]);
  });

  it('rejects invalid old shifts before replacing the current history', async () => {
    const currentShift = makeShift({
      id: 'current-shift',
      endTime: '2026-06-10T14:30:00.000Z'
    });
    const startedAt = new Date('2026-07-27T06:00:00.000+03:00').getTime();
    const invalidSource = JSON.stringify({
      version: 1,
      exportedAt: '2026-07-27T17:05:00.764Z',
      shifts: [
        {
          id: 'invalid-legacy',
          startedAt,
          endedAt: startedAt + 60_000,
          rate: 280,
          shiftType: '1 зміна',
          rateMultiplier: 3,
          doubleRate: false
        }
      ]
    });

    await shiftRepository.createShift(currentShift);

    expect(() => parseBackupImportJson(invalidSource)).toThrow(
      'rateMultiplier старої зміни має дорівнювати 1, 1.5 або 2.'
    );
    await expect(db.shifts.toArray()).resolves.toEqual([currentShift]);
  });
});
