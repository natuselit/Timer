// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  EnterpriseScheduleItem,
  EnterpriseSchedulePdfParseResult
} from '../../../entities/enterprise-schedule';
import type { Settings } from '../../../entities/settings';
import type { Shift } from '../../../entities/shift';
import {
  EnterpriseScheduleRepository,
  localDb,
  ScheduleWarningReviewRepository
} from '../../../shared/lib/local-db';
import { SchedulePage } from './SchedulePage';

const { parseEnterpriseSchedulePdfMock, syncShiftWithEnterpriseScheduleMock } = vi.hoisted(() => ({
  parseEnterpriseSchedulePdfMock: vi.fn(),
  syncShiftWithEnterpriseScheduleMock: vi.fn()
}));

vi.mock('../../../entities/enterprise-schedule', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../entities/enterprise-schedule')>()),
  parseEnterpriseSchedulePdf: parseEnterpriseSchedulePdfMock
}));

vi.mock('../../../shared/lib/local-db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../shared/lib/local-db')>()),
  syncShiftWithEnterpriseSchedule: syncShiftWithEnterpriseScheduleMock
}));

const settings: Settings = {
  employeeFirstName: 'Артем',
  employeeLastName: 'Кухарчук',
  monthlySalary: 50_800,
  monthlyBonus: 2_000,
  currentGrade: 1,
  desiredGrade: 2,
  gradeSalaryBonusPercents: [10, 10, 10, 10],
  gradeNormPercents: [100, 120, 140, 160],
  forecastDays: 30,
  arriveHoldDelayMs: 1_500,
  leaveHoldDelayMs: 1_500,
  shiftDetectionMode: 'auto',
  themePreference: 'system',
  backupReminderIntervalDays: 14,
  overtimeLimitPercent: 0,
  overtimeStepMinutes: 30,
  overtimeStrategy: 'standard',
  overtimeSaturdayCount: 1,
  overtimeWeekdayMaxMinutes: 240,
  overtimeSaturdayMaxMinutes: 480,
  incognitoEnabled: false,
  onboardingCompleted: true,
  updatedAt: '2026-07-27T06:00:00.000+03:00'
};

const completedShift: Shift = {
  id: 'completed-shift',
  date: '2026-07-27',
  type: 'first',
  detectionMode: 'auto',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  startTime: '2026-07-27T06:40:00.000+03:00',
  endTime: '2026-07-27T14:20:00.000+03:00',
  baseHourlyRateSnapshot: 280,
  hourlyRateSnapshot: 280,
  gradeSnapshot: null,
  workTickets: [],
  note: '',
  coefficientMode: 'auto',
  isAutoClosed: false,
  createdAt: '2026-07-27T06:40:00.000+03:00',
  updatedAt: '2026-07-27T14:20:00.000+03:00'
};

const scheduleItem: EnterpriseScheduleItem = {
  id: 'enterprise-schedule-2026-07-27',
  date: '2026-07-27',
  shiftType: 'first',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  enterpriseStartTime: '06:30',
  enterpriseEndTime: '14:30',
  skipped: false,
  sourceText: '27.07.2026 In time 06:30 Out time 14:30 Total 08:00',
  createdAt: '2026-07-27T06:00:00.000+03:00',
  updatedAt: '2026-07-27T06:00:00.000+03:00'
};

const enterpriseScheduleRepository = new EnterpriseScheduleRepository(localDb);
const reviewRepository = new ScheduleWarningReviewRepository(localDb);

const parsedPdfResult: EnterpriseSchedulePdfParseResult = {
  fileName: 'табель-липень.pdf',
  pageCount: 2,
  skippedEmptyCount: 3,
  errors: [],
  items: [
    {
      date: '2026-08-01',
      shiftType: 'first',
      plannedStartTime: '06:30',
      plannedEndTime: '14:30',
      inTime: '06:01',
      outTime: '14:30',
      total: '08:29',
      sourceText:
        '01.08.2026 In time 06:01\n01.08.2026 Out time 14:30\n01.08.2026 Total 08:29'
    }
  ]
};

beforeEach(async () => {
  await localDb.shifts.clear();
  await localDb.enterpriseSchedule.clear();
  await localDb.appMeta.clear();
  await localDb.shifts.put(completedShift);
  await enterpriseScheduleRepository.importItems([scheduleItem]);
  parseEnterpriseSchedulePdfMock.mockReset();
  syncShiftWithEnterpriseScheduleMock.mockReset();
});

afterEach(async () => {
  cleanup();
  await localDb.shifts.clear();
  await localDb.enterpriseSchedule.clear();
  await localDb.appMeta.clear();
  vi.restoreAllMocks();
});

describe('SchedulePage', () => {
  it('shows schedule control, collapses records and persists reviewed warnings', async () => {
    const user = userEvent.setup();

    render(
      <SchedulePage
        settings={settings}
        calendarMonth={{ year: 2026, month: 7 }}
        selectedRange={{ start: '2026-07-01', end: '2026-07-31' }}
        onCalendarMonthChange={vi.fn()}
        onSelectedRangeChange={vi.fn()}
        activeRangePreset="month"
        isAllTimePresetEnabled
        onRangePresetSelect={vi.fn()}
      />
    );

    expect(await screen.findByRole('heading', { name: 'Попередження' })).toBeTruthy();
    expect(screen.getByLabelText('Ставка за обраний місяць')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Розбіжності' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Місяць' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(screen.getByRole('button', { name: 'Обрати 1 число' }).getAttribute('aria-pressed')).toBe(
      'true'
    );

    const scheduleDetails = screen
      .getAllByRole('heading', { name: 'Графік підприємства' })[0]
      .closest('details');

    expect(scheduleDetails?.open).toBe(false);
    await user.click(screen.getByText('Записи'));
    expect(scheduleDetails?.open).toBe(true);
    expect(screen.getByText('06:30-14:30')).toBeTruthy();

    const importGuideTitle = screen.getByText('Як підготувати та імпортувати PDF');
    await user.click(importGuideTitle);
    expect(screen.getByText('Відкрийте «Таймер»')).toBeTruthy();
    expect(screen.getByText(/Натисніть ⋮/)).toBeTruthy();
    expect(screen.getByText(/зверніться до керівництва/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Переглянуто' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Попередження' })).toBeNull();
    });
    await expect(reviewRepository.getAll()).resolves.toMatchObject([
      {
        shiftId: completedShift.id
      }
    ]);
  });

  it('does not render an empty schedule-control block', async () => {
    await localDb.shifts.clear();

    render(
      <SchedulePage
        settings={settings}
        calendarMonth={{ year: 2026, month: 7 }}
        selectedRange={null}
        onCalendarMonthChange={vi.fn()}
        onSelectedRangeChange={vi.fn()}
        activeRangePreset={null}
        isAllTimePresetEnabled={false}
        onRangePresetSelect={vi.fn()}
      />
    );

    await screen.findAllByRole('heading', { name: 'Графік підприємства' });
    expect(screen.queryByRole('heading', { name: 'Попередження' })).toBeNull();
  });

  it('reads a PDF, previews the result and imports valid shifts after confirmation', async () => {
    const user = userEvent.setup();
    const onCalendarMonthChange = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    parseEnterpriseSchedulePdfMock.mockResolvedValue(parsedPdfResult);

    const { container } = render(
      <SchedulePage
        settings={settings}
        calendarMonth={{ year: 2026, month: 7 }}
        selectedRange={null}
        onCalendarMonthChange={onCalendarMonthChange}
        onSelectedRangeChange={vi.fn()}
        activeRangePreset={null}
        isAllTimePresetEnabled={false}
        onRangePresetSelect={vi.fn()}
      />
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    const file = new File(['pdf'], parsedPdfResult.fileName, { type: 'application/pdf' });

    expect(input).not.toBeNull();
    await user.upload(input!, file);

    expect(await screen.findByText(parsedPdfResult.fileName)).toBeTruthy();
    expect(screen.getByText('Валідні: 1').getAttribute('data-status')).toBe('success');
    expect(screen.getByText('Порожні: 3').getAttribute('data-status')).toBe('warning');
    expect(screen.getByText('Помилки: 0').getAttribute('data-status')).toBe('neutral');
    expect(screen.getByText('2 стор. · файл готовий до імпорту')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Імпортувати 1 зміну' }));

    await waitFor(async () => {
      await expect(
        enterpriseScheduleRepository.getItemById('enterprise-schedule-2026-08-01')
      ).resolves.toMatchObject({
        date: '2026-08-01',
        enterpriseStartTime: '06:01',
        enterpriseEndTime: '14:30'
      });
    });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('табель-липень.pdf'));
    await waitFor(() => {
      expect(onCalendarMonthChange).toHaveBeenCalledWith({ year: 2026, month: 8 });
    });
    expect(await screen.findByText(/Пропущено порожніх днів: 3/)).toBeTruthy();
  });

  it('allows a partial import but warns about invalid records in confirmation', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    parseEnterpriseSchedulePdfMock.mockResolvedValue({
      ...parsedPdfResult,
      errors: [
        {
          line: 4,
          message: 'У блоці 2026-08-02 Total не збігається з In time та Out time.',
          sourceText: '02.08.2026 Total 08:28'
        }
      ]
    });

    const { container } = render(
      <SchedulePage
        settings={settings}
        calendarMonth={{ year: 2026, month: 7 }}
        selectedRange={null}
        onCalendarMonthChange={vi.fn()}
        onSelectedRangeChange={vi.fn()}
        activeRangePreset={null}
        isAllTimePresetEnabled={false}
        onRangePresetSelect={vi.fn()}
      />
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');

    await user.upload(
      input!,
      new File(['pdf'], parsedPdfResult.fileName, { type: 'application/pdf' })
    );
    expect((await screen.findByText('Помилки: 1')).getAttribute('data-status')).toBe('error');
    await user.click(screen.getByRole('button', { name: 'Імпортувати 1 зміну' }));

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('1 невалідний запис буде пропущено')
    );
    await expect(
      enterpriseScheduleRepository.getItemById('enterprise-schedule-2026-08-01')
    ).resolves.toBeNull();
  });

  it('shows a readable PDF error and keeps import disabled', async () => {
    const user = userEvent.setup();
    parseEnterpriseSchedulePdfMock.mockRejectedValue(
      new Error('PDF не містить текстового шару. Скановані файли без тексту не підтримуються.')
    );

    const { container } = render(
      <SchedulePage
        settings={settings}
        calendarMonth={{ year: 2026, month: 7 }}
        selectedRange={null}
        onCalendarMonthChange={vi.fn()}
        onSelectedRangeChange={vi.fn()}
        activeRangePreset={null}
        isAllTimePresetEnabled={false}
        onRangePresetSelect={vi.fn()}
      />
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');

    await user.upload(input!, new File(['scan'], 'scan.pdf', { type: 'application/pdf' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Скановані файли без тексту'
    );
    expect(
      (screen.getByRole('button', { name: 'Імпортувати' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('reviews discrepancies sequentially across every imported month', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await localDb.shifts.bulkPut([
      {
        ...completedShift,
        id: 'may-shift',
        date: '2026-05-30',
        startTime: '2026-05-30T06:30:00.000+03:00',
        endTime: '2026-05-30T14:30:00.000+03:00'
      },
      {
        ...completedShift,
        id: 'june-shift',
        date: '2026-06-01',
        startTime: '2026-06-01T06:30:00.000+03:00',
        endTime: '2026-06-01T14:30:00.000+03:00'
      }
    ]);
    parseEnterpriseSchedulePdfMock.mockResolvedValue({
      fileName: 'табель-травень-червень.pdf',
      pageCount: 4,
      skippedEmptyCount: 1,
      errors: [],
      items: [
        {
          date: '2026-05-30',
          shiftType: 'first',
          plannedStartTime: '06:30',
          plannedEndTime: '14:30',
          inTime: '06:00',
          outTime: '15:29',
          total: '09:29',
          sourceText:
            '--30.05.2026--\nIn time: 06:00\nOut time: 15:29\nTotal: 09:29'
        },
        {
          date: '2026-06-01',
          shiftType: 'first',
          plannedStartTime: '06:30',
          plannedEndTime: '14:30',
          inTime: '05:57',
          outTime: '16:52',
          total: '10:55',
          sourceText:
            '--01.06.2026--\nIn time: 05:57\nOut time: 16:52\nTotal: 10:55'
        }
      ]
    } satisfies EnterpriseSchedulePdfParseResult);

    const { container } = render(
      <SchedulePage
        settings={settings}
        calendarMonth={{ year: 2026, month: 7 }}
        selectedRange={null}
        onCalendarMonthChange={vi.fn()}
        onSelectedRangeChange={vi.fn()}
        activeRangePreset={null}
        isAllTimePresetEnabled={false}
        onRangePresetSelect={vi.fn()}
      />
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');

    await user.upload(
      input!,
      new File(['pdf'], 'табель-травень-червень.pdf', { type: 'application/pdf' })
    );
    await user.click(screen.getByRole('button', { name: 'Імпортувати 2 зміни' }));

    expect(await screen.findByLabelText('Обрана дата 30.05.2026')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Пропустити' }));
    expect(await screen.findByLabelText('Обрана дата 01.06.2026')).toBeTruthy();
  });

  it('runs only one synchronization when the button is clicked repeatedly before rerender', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    parseEnterpriseSchedulePdfMock.mockResolvedValue({
      fileName: 'табель-липень.pdf',
      pageCount: 1,
      skippedEmptyCount: 0,
      errors: [],
      items: [
        {
          date: '2026-07-27',
          shiftType: 'first',
          plannedStartTime: '06:30',
          plannedEndTime: '14:30',
          inTime: '06:30',
          outTime: '14:30',
          total: '08:00',
          sourceText:
            '--27.07.2026--\nIn time: 06:30\nOut time: 14:30\nTotal: 08:00'
        }
      ]
    } satisfies EnterpriseSchedulePdfParseResult);

    let finishSynchronization: ((shift: Shift) => void) | undefined;
    syncShiftWithEnterpriseScheduleMock.mockImplementation(
      () =>
        new Promise<Shift>((resolve) => {
          finishSynchronization = resolve;
        })
    );

    const { container } = render(
      <SchedulePage
        settings={settings}
        calendarMonth={{ year: 2026, month: 7 }}
        selectedRange={null}
        onCalendarMonthChange={vi.fn()}
        onSelectedRangeChange={vi.fn()}
        activeRangePreset={null}
        isAllTimePresetEnabled={false}
        onRangePresetSelect={vi.fn()}
      />
    );
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');

    await user.upload(
      input!,
      new File(['pdf'], 'табель-липень.pdf', { type: 'application/pdf' })
    );
    await user.click(screen.getByRole('button', { name: 'Імпортувати 1 зміну' }));

    const syncButton = await screen.findByRole('button', { name: 'Синхронізувати' });
    act(() => {
      syncButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      syncButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(syncShiftWithEnterpriseScheduleMock).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole('button', { name: 'Збереження...' }) as HTMLButtonElement).disabled
    ).toBe(true);

    await act(async () => {
      finishSynchronization?.(completedShift);
    });
    await waitFor(() => {
      expect(
        (screen.getByRole('button', { name: 'Синхронізувати' }) as HTMLButtonElement).disabled
      ).toBe(false);
    });
    expect(syncShiftWithEnterpriseScheduleMock).toHaveBeenCalledTimes(1);
  });
});
