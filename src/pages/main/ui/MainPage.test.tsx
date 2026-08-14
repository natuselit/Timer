// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../../entities/settings';
import type { Shift } from '../../../entities/shift';
import {
  BACKUP_REMINDER_ANCHOR_KEY,
  CALENDAR_TUTORIAL_SEEN_KEY,
  localDb
} from '../../../shared/lib/local-db';
import { combineLocalDateAndTime, toLocalIsoString } from '../../../shared/lib/date-time';
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
  note: '',
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
  it('saves a local note for the active shift', async () => {
    const user = userEvent.setup();

    render(
      <MainPage
        settings={settings}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    const noteInput = await screen.findByLabelText('Нотатка до зміни') as HTMLTextAreaElement;
    const saveButton = screen.getByRole('button', { name: 'Зберегти' });
    const ticketSection = screen.getByRole('region', { name: 'Тікет зміни' });
    const noteSection = noteInput.closest('section');

    expect(noteInput.maxLength).toBe(500);
    expect(
      ticketSection.compareDocumentPosition(noteSection!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);

    await user.type(noteInput, 'Перевірити партію №42');
    expect(screen.getByLabelText('21 із 500 символів')).toBeTruthy();
    expect((saveButton as HTMLButtonElement).disabled).toBe(false);

    await user.click(saveButton);

    await waitFor(async () => {
      expect((await localDb.shifts.get(activeShift.id))?.note).toBe(
        'Перевірити партію №42'
      );
    });
    expect(
      (screen.getByRole('button', { name: 'Збережено' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('uses today as the default preset for calendar screens', async () => {
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

    expect(
      screen.getByRole('button', { name: 'Сьогодні' }).getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Місяць' }).getAttribute('aria-pressed')
    ).toBe('false');
  });

  it('shows the calendar tutorial once and allows reopening it from settings', async () => {
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

    expect(
      await screen.findByRole('dialog', { name: 'Почніть із потрібного періоду' })
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Закрити навчання календаря' }));

    await waitFor(async () => {
      expect((await localDb.appMeta.get(CALENDAR_TUTORIAL_SEEN_KEY))?.value).toBe('true');
    });

    await user.click(screen.getByRole('button', { name: 'Таймер' }));
    await user.click(screen.getByRole('button', { name: 'Історія' }));

    expect(screen.queryByRole('dialog', { name: 'Почніть із потрібного періоду' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Налашт.' }));
    await user.click(
      screen.getByRole('button', { name: 'Як користуватися календарем' })
    );

    expect(
      screen.getByRole('dialog', { name: 'Почніть із потрібного періоду' })
    ).toBeTruthy();
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
        settings={{ ...settings, overtimeLimitPercent: 10, incognitoEnabled: true }}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    expect(await screen.findByLabelText('Поточний коефіцієнт: x2')).toBeTruthy();
    const moneyProgress = screen.getByRole('progressbar', {
      name: 'Прогрес заробітку за місяць'
    });
    expect(moneyProgress.getAttribute('aria-valuetext')).toBe('••••');
    expect(moneyProgress.getAttribute('aria-valuenow')).toBe('0');
    expect(moneyProgress.getAttribute('data-incognito')).toBe('true');
  });

  it('shows the monthly overtime plan and saves a selected alternative', async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn().mockResolvedValue(undefined);

    render(
      <MainPage
        settings={{ ...settings, overtimeLimitPercent: 10 }}
        dataVersion={0}
        onSettingsChange={onSettingsChange}
        onLocalDataReplace={vi.fn()}
      />
    );

    expect(await screen.findByRole('heading', { name: 'Стандарт' })).toBeTruthy();
    const moneyProgress = screen.getByRole('progressbar', {
      name: 'Прогрес заробітку за місяць'
    });
    const moneyPanel = moneyProgress.closest('.main-page__money-panel') as HTMLElement | null;
    expect(moneyPanel).toBeTruthy();
    expect(screen.getByText('План місяця')).toBeTruthy();
    expect(screen.getAllByText('Ліміт')).toHaveLength(1);
    expect(
      screen.queryByLabelText('Ліміт перепрацювань: 10% від планових годин')
    ).toBeNull();
    expect(screen.getByText('Зароблено цього місяця')).toBeTruthy();
    expect(screen.getByLabelText(/Початок шкали:/)).toBeTruthy();
    expect(screen.getByLabelText(/Максимум шкали:/)).toBeTruthy();
    expect(within(moneyPanel!).queryByText('Ставка')).toBeNull();
    expect(within(moneyPanel!).queryByText('Максимум')).toBeNull();
    expect(within(moneyPanel!).queryByText(/Ставка \+ перепрацювання/)).toBeNull();
    expect(
      screen.getByText('Перепрацювання', {
        selector: '.main-page__overtime-title .main-page__label'
      })
    ).toBeTruthy();
    expect(screen.queryByText('Орієнтовний додатковий дохід за залишок')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Налаштування' })).toBeNull();
    expect(screen.queryByText(/Залишок .* менший за крок рекомендації/)).toBeNull();
    const recommendationOvertime = document.querySelector(
      '.main-page__overtime-shift-summary > div:nth-child(2) dd'
    );
    expect(recommendationOvertime?.textContent).toMatch(/^\d+:\d{2}$/);

    await user.click(screen.getByRole('button', { name: 'Цей день недоступний' }));
    await waitFor(() => {
      expect(onSettingsChange).toHaveBeenCalledWith(
        expect.objectContaining({
          overtimeUnavailableDates: expect.arrayContaining([expect.any(String)])
        })
      );
    });

    await user.click(screen.getByRole('button', { name: 'Інші варіанти' }));
    const dialog = screen.getByRole('dialog', { name: 'Варіанти перепрацювань' });
    expect(within(dialog).getByRole('button', { name: /^СтандартБудні/ })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /^Стандарт\+Будні/ })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: /^Стандарт\+\+Будні/ })).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /Лише будні/ })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: /^Стандарт\+Будні/ }));

    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ overtimeStrategy: 'standard-plus' })
    );
    expect(screen.queryByRole('dialog', { name: 'Варіанти перепрацювань' })).toBeNull();
  });

  it('shows a separate over-limit state without blocking an inactive timer', async () => {
    const date = toLocalIsoString(new Date()).slice(0, 10);
    await localDb.shifts.clear();
    await localDb.shifts.put({
      ...activeShift,
      id: 'completed-over-limit-shift',
      date,
      plannedStartTime: '06:30',
      plannedEndTime: '14:30',
      startTime: combineLocalDateAndTime(date, '05:30'),
      endTime: combineLocalDateAndTime(date, '15:30'),
      workTickets: []
    });

    render(
      <MainPage
        settings={{ ...settings, overtimeLimitPercent: 0.01 }}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    expect(await screen.findByText(/Ліміт перевищено на/)).toBeTruthy();
    expect(screen.getByRole('region', { name: 'План перепрацювань' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Прийшов/ })).toBeTruthy();
  });

  it('caps the financial fill and shows the full amount above the calculated maximum', async () => {
    const date = toLocalIsoString(new Date()).slice(0, 10);
    await localDb.shifts.clear();
    await localDb.shifts.put({
      ...activeShift,
      id: 'income-over-maximum-shift',
      date,
      startTime: combineLocalDateAndTime(date, '06:30'),
      endTime: combineLocalDateAndTime(date, '14:30'),
      coefficientMode: 'x2',
      workTickets: []
    });

    render(
      <MainPage
        settings={{
          ...settings,
          monthlySalary: 100,
          overtimeLimitPercent: 10
        }}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    expect(await screen.findByText('Вище розрахункового максимуму')).toBeTruthy();
    const progress = screen.getByRole('progressbar', {
      name: 'Прогрес заробітку за місяць'
    });
    expect(progress.getAttribute('data-over-maximum')).toBe('true');
    expect(progress.getAttribute('aria-valuenow')).toBe(
      progress.getAttribute('aria-valuemax')
    );
    expect(progress.getAttribute('aria-valuetext')).toContain('з');
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

describe('MainPage inactive state', () => {
  it('hides the previous shift and moves its recommendation forward', async () => {
    const date = toLocalIsoString(new Date()).slice(0, 10);
    await localDb.shifts.clear();
    await localDb.shifts.put({
      ...activeShift,
      id: 'completed-shift',
      date,
      startTime: combineLocalDateAndTime(date, '06:30'),
      endTime: combineLocalDateAndTime(date, '14:30'),
      workTickets: []
    });

    render(
      <MainPage
        settings={{
          ...settings,
          overtimeLimitPercent: 10,
          overtimeStrategy: 'standard'
        }}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    expect(
      await screen.findByText(
        /Наступна рекомендована зміна|немає наступної доступної дати/
      )
    ).toBeTruthy();
    expect(screen.getByText('Всього часу')).toBeTruthy();
    expect(screen.getAllByText('Перепрацювання').length).toBeGreaterThan(0);
    expect(screen.queryByText('Орієнтовний додатковий дохід за залишок')).toBeNull();
    expect(screen.queryByText('Остання зміна')).toBeNull();
    expect(
      screen.queryByLabelText('Загальна статистика тікетів останньої зміни')
    ).toBeNull();
    expect(
      screen.getByRole('region', { name: 'План перепрацювань' })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Прийшов/ })).toBeTruthy();
  });

  it('shows only the planner invitation when overtime planning is disabled', async () => {
    await localDb.shifts.clear();

    render(
      <MainPage
        settings={settings}
        dataVersion={0}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
      />
    );

    expect(
      await screen.findByRole('heading', { name: 'Планувальник вимкнено' })
    ).toBeTruthy();
    expect(screen.queryByText('Зміна не активна')).toBeNull();
    expect(screen.queryByText('Остання зміна')).toBeNull();
  });
});
