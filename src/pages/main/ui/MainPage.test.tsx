// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../../entities/settings';
import type { Shift } from '../../../entities/shift';
import { BACKUP_REMINDER_ANCHOR_KEY, localDb } from '../../../shared/lib/local-db';
import { MainPage } from './MainPage';

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
  coefficientMode: 'auto',
  shiftDetectionMode: 'auto',
  themePreference: 'system',
  backupReminderIntervalDays: 14,
  incognitoEnabled: false,
  onboardingCompleted: true,
  updatedAt: '2026-07-27T06:00:00.000+03:00'
};

const activeShift: Shift = {
  id: 'active-shift',
  date: '2026-07-27',
  type: 'first',
  detectionMode: 'auto',
  plannedStartTime: '06:30',
  plannedEndTime: '14:30',
  startTime: '2026-07-27T06:15:00.000+03:00',
  endTime: null,
  baseHourlyRateSnapshot: 280,
  hourlyRateSnapshot: 280,
  gradeSnapshot: null,
  workTickets: [
    {
      id: 'active-ticket',
      normPerEightHours: 80,
      startedAt: '2026-07-27T06:15:00.000+03:00',
      endedAt: null,
      actualQuantity: null,
      downtimeMinutes: 5,
      createdAt: '2026-07-27T06:15:00.000+03:00',
      updatedAt: '2026-07-27T06:15:00.000+03:00'
    }
  ],
  coefficientMode: 'x2',
  isAutoClosed: false,
  createdAt: '2026-07-27T06:15:00.000+03:00',
  updatedAt: '2026-07-27T06:15:00.000+03:00'
};

beforeEach(async () => {
  vi.stubGlobal('scrollTo', vi.fn());
  await localDb.shifts.clear();
  await localDb.enterpriseSchedule.clear();
  await localDb.appMeta.clear();
  await localDb.settings.clear();
  await localDb.shifts.put(activeShift);
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await localDb.shifts.clear();
});

describe('MainPage active shift', () => {
  it('uses the current month preset for calendar screens by default', async () => {
    const user = userEvent.setup();

    render(
      <MainPage
        settings={settings}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    await user.click(await screen.findByRole('button', { name: 'Аналітика' }));

    const monthPreset = screen.getByRole('button', { name: 'Місяць' });

    expect(monthPreset.getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByRole('button', { name: 'Попередній місяць' }));

    expect(monthPreset.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows compact downtime and opens the accessible action modal from the menu', async () => {
    const user = userEvent.setup();

    render(
      <MainPage
        settings={settings}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    expect(await screen.findByLabelText('Поточний коефіцієнт: x2')).toBeTruthy();
    expect(screen.queryByText('Коефіцієнт зараз')).toBeNull();
    expect(screen.queryByText('Потрібно для G1')).toBeNull();
    expect(screen.queryByText(/Додайте або відніміть/)).toBeNull();
    expect(screen.queryByLabelText('Редагувати активний тікет')).toBeNull();
    expect(screen.queryByLabelText('Видалити активний тікет')).toBeNull();
    expect(screen.getByLabelText('Загальний простій: 0:05')).toBeTruthy();
    expect(screen.queryByLabelText('Кількість хвилин')).toBeNull();
    expect(screen.queryByLabelText('Фактично зроблено, шт')).toBeNull();

    const menuButton = screen.getByRole('button', {
      name: 'Інші дії з активним тікетом'
    });
    expect(menuButton.getAttribute('aria-haspopup')).toBe('menu');
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');

    await user.click(menuButton);

    expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu', { name: 'Інші дії з тікетом' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Редагувати' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Додати простій' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Видалити' })).toBeTruthy();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu', { name: 'Інші дії з тікетом' })).toBeNull();
    expect(document.activeElement).toBe(menuButton);

    await user.click(menuButton);
    await user.click(screen.getByRole('menuitem', { name: 'Додати простій' }));

    const dialog = screen.getByRole('dialog', { name: 'Простій' });
    const downtimeAdjustment = within(dialog).getByLabelText(
      'Кількість хвилин'
    ) as HTMLInputElement;

    expect(downtimeAdjustment.inputMode).toBe('numeric');
    expect(downtimeAdjustment.pattern).toBe('[0-9]*');
    expect(document.activeElement).toBe(downtimeAdjustment);
    expect(document.body.style.overflow).toBe('hidden');

    await user.click(within(dialog).getByRole('button', { name: 'Скасувати' }));

    expect(screen.queryByRole('dialog', { name: 'Простій' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(menuButton));
    expect(document.body.style.overflow).toBe('');
  });

  it('hides an empty downtime summary and expands the completion action', async () => {
    await localDb.shifts.put({
      ...activeShift,
      workTickets: activeShift.workTickets.map((ticket) => ({
        ...ticket,
        downtimeMinutes: 0
      }))
    });

    render(
      <MainPage
        settings={settings}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    await screen.findByLabelText('Поточний коефіцієнт: x2');

    expect(screen.queryByLabelText('Загальний простій: 0:00')).toBeNull();

    const completionButton = screen.getByRole('button', { name: 'Завершити тікет' });

    expect(completionButton.parentElement?.children).toHaveLength(1);
  });

  it('shows a compact G1 summary and an accessible actions menu for a completed ticket', async () => {
    const user = userEvent.setup();

    await localDb.shifts.put({
      ...activeShift,
      workTickets: activeShift.workTickets.map((ticket) => ({
        ...ticket,
        endedAt: '2026-07-27T07:15:00.000+03:00',
        actualQuantity: 56,
        downtimeMinutes: 15
      }))
    });

    render(
      <MainPage
        settings={{ ...settings, currentGrade: 3 }}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    const summary = await screen.findByLabelText('Підсумок тікета 06:15');
    const summaryQueries = within(summary);

    expect(summaryQueries.getByText('Тікет 1')).toBeTruthy();
    expect(summaryQueries.getByText('06:15–07:15')).toBeTruthy();
    expect(summaryQueries.getByText('Факт / план G1')).toBeTruthy();
    expect(summaryQueries.getByText('56 / 8 шт')).toBeTruthy();
    expect(summaryQueries.getByLabelText('Виконання плану G1: 700%')).toBeTruthy();
    expect(summaryQueries.getByText('0:45')).toBeTruthy();
    expect(summaryQueries.getByText('Простій')).toBeTruthy();
    expect(summaryQueries.getByText('0:15')).toBeTruthy();
    expect(summaryQueries.queryByText('G2')).toBeNull();
    expect(summaryQueries.queryByText('G3')).toBeNull();
    expect(summaryQueries.queryByText('G4')).toBeNull();
    expect(summaryQueries.queryByText('Результат')).toBeNull();

    const menuButton = summaryQueries.getByRole('button', {
      name: 'Інші дії з тікетом 06:15'
    });
    expect(menuButton.getAttribute('aria-haspopup')).toBe('menu');
    expect(menuButton.getAttribute('aria-expanded')).toBe('false');

    await user.click(menuButton);

    expect(menuButton.getAttribute('aria-expanded')).toBe('true');
    expect(
      summaryQueries.getByRole('menu', { name: 'Дії з завершеним тікетом 06:15' })
    ).toBeTruthy();
    expect(summaryQueries.getByRole('menuitem', { name: 'Редагувати' })).toBeTruthy();
    expect(summaryQueries.getByRole('menuitem', { name: 'Видалити' })).toBeTruthy();

    await user.keyboard('{Escape}');

    expect(summaryQueries.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(menuButton);

    await user.click(menuButton);
    await user.click(summaryQueries.getByRole('menuitem', { name: 'Редагувати' }));

    expect(summaryQueries.getByText('Редагування тікета')).toBeTruthy();
    await user.click(summaryQueries.getByRole('button', { name: 'Скасувати' }));

    const confirmDeletion = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(
      summaryQueries.getByRole('button', { name: 'Інші дії з тікетом 06:15' })
    );
    await user.click(summaryQueries.getByRole('menuitem', { name: 'Видалити' }));

    expect(confirmDeletion).toHaveBeenCalledWith('Видалити цей тікет?');
    await waitFor(() => {
      expect(screen.queryByLabelText('Підсумок тікета 06:15')).toBeNull();
    });
  });

  it('keeps completed tickets newest-first and handles missing fact, zero plan and zero downtime', async () => {
    await localDb.shifts.put({
      ...activeShift,
      workTickets: [
        {
          ...activeShift.workTickets[0],
          id: 'older-ticket',
          endedAt: '2026-07-27T07:15:00.000+03:00',
          actualQuantity: 10,
          downtimeMinutes: 0,
          updatedAt: '2026-07-27T07:15:00.000+03:00'
        },
        {
          ...activeShift.workTickets[0],
          id: 'newer-ticket',
          startedAt: '2026-07-27T07:15:00.000+03:00',
          endedAt: '2026-07-27T07:16:00.000+03:00',
          actualQuantity: null,
          downtimeMinutes: 1,
          createdAt: '2026-07-27T07:15:00.000+03:00',
          updatedAt: '2026-07-27T07:16:00.000+03:00'
        }
      ]
    });

    render(
      <MainPage
        settings={{ ...settings, currentGrade: 4 }}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    const summaries = await screen.findAllByLabelText(/Підсумок тікета/);
    expect(summaries).toHaveLength(2);
    expect(summaries[0].getAttribute('aria-label')).toBe('Підсумок тікета 07:15');
    expect(summaries[1].getAttribute('aria-label')).toBe('Підсумок тікета 06:15');

    const newerSummary = within(summaries[0]);
    expect(newerSummary.getByText('Тікет 2')).toBeTruthy();
    expect(newerSummary.getByText('— / 0 шт')).toBeTruthy();
    expect(newerSummary.getByLabelText('Виконання плану G1: —')).toBeTruthy();
    expect(newerSummary.getByText('Простій')).toBeTruthy();
    expect(newerSummary.getByText('0:01')).toBeTruthy();

    const olderSummary = within(summaries[1]);
    expect(olderSummary.getByText('Тікет 1')).toBeTruthy();
    expect(olderSummary.getByText('10 / 10 шт')).toBeTruthy();
    expect(olderSummary.getByLabelText('Виконання плану G1: 100%')).toBeTruthy();
    expect(olderSummary.queryByText('Простій')).toBeNull();
  });

  it('adds and subtracts downtime through the modal and validates the available duration', async () => {
    const user = userEvent.setup();

    render(
      <MainPage
        settings={settings}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    await screen.findByLabelText('Поточний коефіцієнт: x2');
    const menuButton = screen.getByRole('button', {
      name: 'Інші дії з активним тікетом'
    });

    await user.click(menuButton);
    await user.click(screen.getByRole('menuitem', { name: 'Додати простій' }));

    let dialog = screen.getByRole('dialog', { name: 'Простій' });
    await user.click(within(dialog).getByRole('button', { name: 'Відняти' }));
    await user.type(within(dialog).getByLabelText('Кількість хвилин'), '6');
    await user.click(within(dialog).getByRole('button', { name: 'Відняти простій' }));

    expect(within(dialog).getByRole('alert').textContent).toContain(
      'Можна відняти не більше 5 хв.'
    );
    expect((await localDb.shifts.get(activeShift.id))?.workTickets[0].downtimeMinutes).toBe(5);

    await user.clear(within(dialog).getByLabelText('Кількість хвилин'));
    await user.type(within(dialog).getByLabelText('Кількість хвилин'), '3');
    await user.click(within(dialog).getByRole('button', { name: 'Відняти простій' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Загальний простій: 0:02')).toBeTruthy();
    });

    await user.click(menuButton);
    await user.click(screen.getByRole('menuitem', { name: 'Додати простій' }));
    dialog = screen.getByRole('dialog', { name: 'Простій' });
    await user.type(within(dialog).getByLabelText('Кількість хвилин'), '4');
    await user.click(within(dialog).getByRole('button', { name: 'Додати простій' }));

    await waitFor(() => {
      expect(screen.getByLabelText('Загальний простій: 0:06')).toBeTruthy();
    });
    expect((await localDb.shifts.get(activeShift.id))?.workTickets[0].downtimeMinutes).toBe(6);
  });

  it('completes a ticket only after a valid fact is confirmed in the modal', async () => {
    const user = userEvent.setup();

    render(
      <MainPage
        settings={settings}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    await screen.findByLabelText('Поточний коефіцієнт: x2');
    const completionButton = screen.getByRole('button', { name: 'Завершити тікет' });
    await user.click(completionButton);

    const dialog = screen.getByRole('dialog', { name: 'Завершення тікета' });
    const actualQuantity = within(dialog).getByLabelText(
      'Фактично зроблено, шт'
    ) as HTMLInputElement;
    const storedBeforeConfirmation = await localDb.shifts.get(activeShift.id);

    expect(storedBeforeConfirmation?.workTickets[0].endedAt).toBeNull();
    expect(actualQuantity.inputMode).toBe('numeric');
    expect(actualQuantity.pattern).toBe('[0-9]*');
    expect(document.activeElement).toBe(actualQuantity);

    await user.click(within(dialog).getByRole('button', { name: 'Завершити тікет' }));
    expect(within(dialog).getByRole('alert').textContent).toContain(
      'Вкажіть цілу фактичну кількість від 0.'
    );
    expect((await localDb.shifts.get(activeShift.id))?.workTickets[0].endedAt).toBeNull();

    await user.type(actualQuantity, '0');
    await user.click(within(dialog).getByRole('button', { name: 'Завершити тікет' }));

    await waitFor(async () => {
      const storedShift = await localDb.shifts.get(activeShift.id);
      expect(storedShift?.workTickets[0].actualQuantity).toBe(0);
      expect(storedShift?.workTickets[0].endedAt).not.toBeNull();
    });
    expect(screen.queryByRole('dialog', { name: 'Завершення тікета' })).toBeNull();
  });

  it('cancels ticket completion without changing data and restores focus', async () => {
    const user = userEvent.setup();

    render(
      <MainPage
        settings={settings}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    await screen.findByLabelText('Поточний коефіцієнт: x2');
    const completionButton = screen.getByRole('button', { name: 'Завершити тікет' });
    await user.click(completionButton);

    const dialog = screen.getByRole('dialog', { name: 'Завершення тікета' });
    await user.type(within(dialog).getByLabelText('Фактично зроблено, шт'), '12');
    await user.click(within(dialog).getByRole('button', { name: 'Скасувати' }));

    expect((await localDb.shifts.get(activeShift.id))?.workTickets[0]).toMatchObject({
      endedAt: null,
      actualQuantity: null
    });
    await waitFor(() => expect(document.activeElement).toBe(completionButton));
  });

  it('keeps the compact coefficient badge visible in incognito mode', async () => {
    render(
      <MainPage
        settings={{ ...settings, incognitoEnabled: true }}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    expect(await screen.findByLabelText('Поточний коефіцієнт: x2')).toBeTruthy();
  });

  it('keeps the mandatory reminder visible until backup export succeeds', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:backup'),
      revokeObjectURL: vi.fn()
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    await localDb.appMeta.put({
      key: BACKUP_REMINDER_ANCHOR_KEY,
      value: '2000-01-01T00:00:00.000Z',
      updatedAt: '2000-01-01T00:00:00.000Z'
    });

    render(
      <MainPage
        settings={settings}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    expect(await screen.findByText('Час зберегти backup')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Закрити/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Створити backup' }));

    await waitFor(() => {
      expect(screen.queryByText('Час зберегти backup')).toBeNull();
    });
  });
});

describe('MainPage latest completed shift', () => {
  it('shows aggregate production statistics for all completed tickets', async () => {
    await localDb.shifts.clear();
    await localDb.shifts.put({
      ...activeShift,
      id: 'completed-shift',
      endTime: '2026-07-27T14:30:00.000+03:00',
      gradeSnapshot: {
        currentGrade: 2,
        desiredGrade: 3,
        gradeSalaryBonusPercents: [10, 10, 15, 15],
        gradeNormPercents: [100, 120, 140, 160],
        cumulativeSalaryBonusPercent: 20
      },
      workTickets: [
        {
          id: 'ticket-1',
          normPerEightHours: 80,
          startedAt: '2026-07-27T06:15:00.000+03:00',
          endedAt: '2026-07-27T07:15:00.000+03:00',
          actualQuantity: 10,
          downtimeMinutes: 0,
          createdAt: '2026-07-27T06:15:00.000+03:00',
          updatedAt: '2026-07-27T07:15:00.000+03:00'
        },
        {
          id: 'ticket-2',
          normPerEightHours: 80,
          startedAt: '2026-07-27T07:15:00.000+03:00',
          endedAt: '2026-07-27T09:15:00.000+03:00',
          actualQuantity: 20,
          downtimeMinutes: 30,
          createdAt: '2026-07-27T07:15:00.000+03:00',
          updatedAt: '2026-07-27T09:15:00.000+03:00'
        },
        {
          id: 'ticket-3',
          normPerEightHours: 80,
          startedAt: '2026-07-27T09:15:00.000+03:00',
          endedAt: '2026-07-27T10:15:00.000+03:00',
          actualQuantity: null,
          downtimeMinutes: 10,
          createdAt: '2026-07-27T09:15:00.000+03:00',
          updatedAt: '2026-07-27T10:15:00.000+03:00'
        }
      ]
    });

    render(
      <MainPage
        settings={settings}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    const summary = await screen.findByLabelText(
      'Загальна статистика тікетів останньої зміни'
    );
    const summaryQueries = within(summary);

    expect(summaryQueries.getByText('2/3 заповнено')).toBeTruthy();
    expect(summaryQueries.getAllByText('30 шт')).toHaveLength(2);
    expect(summaryQueries.getByText('120%')).toBeTruthy();
    expect(summaryQueries.getByText('Продуктивний час')).toBeTruthy();
    expect(summaryQueries.getByText('2:30')).toBeTruthy();
    expect(summaryQueries.getByText('0:30')).toBeTruthy();
  });

  it('shows a compact empty state when the last shift has no tickets', async () => {
    await localDb.shifts.clear();
    await localDb.shifts.put({
      ...activeShift,
      id: 'completed-without-tickets',
      endTime: '2026-07-27T14:30:00.000+03:00',
      workTickets: []
    });

    render(
      <MainPage
        settings={settings}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    const summary = await screen.findByLabelText(
      'Загальна статистика тікетів останньої зміни'
    );

    expect(within(summary).getByText('0/0 заповнено')).toBeTruthy();
    expect(within(summary).getByText('У цій зміні тікетів немає.')).toBeTruthy();
  });
});
