// @vitest-environment jsdom

import 'fake-indexeddb/auto';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../../entities/settings';
import {
  CALENDAR_TUTORIAL_SEEN_KEY,
  localDb
} from '../../../shared/lib/local-db';
import { SettingsPage } from './SettingsPage';

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
  overtimeLimitPercent: 0,
  overtimeStepMinutes: 30,
  overtimeStrategy: 'standard',
  overtimeSaturdayCount: 1,
  overtimeWeekdayMaxMinutes: 240,
  overtimeSaturdayMaxMinutes: 480,
  overtimeUnavailableDates: [],
  incognitoEnabled: false,
  onboardingCompleted: true,
  updatedAt: '2026-07-27T19:30:00.000+03:00'
};

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await localDb.appMeta.clear();
  await localDb.shifts.clear();
});

describe('SettingsPage', () => {
  it('keeps groups compact and shows save actions only for draft changes', async () => {
    const user = userEvent.setup();

    render(
      <SettingsPage
        settings={settings}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
        onOpenCalendarTutorial={vi.fn()}
      />
    );

    const paymentSection = screen.getByRole('heading', { name: 'Оплата' }).closest('details');

    expect(paymentSection?.open).toBe(false);
    expect(screen.queryByRole('button', { name: 'Зберегти налаштування' })).toBeNull();

    await user.click(paymentSection!.querySelector('summary')!);
    expect(paymentSection?.open).toBe(true);

    const monthlySalary = screen.getByLabelText(/Ставка за місяць/) as HTMLInputElement;
    await user.clear(monthlySalary);
    await user.type(monthlySalary, '51000');

    expect(screen.getByRole('button', { name: 'Зберегти налаштування' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Скасувати' }));

    expect(monthlySalary.value).toBe('50800');
    expect(screen.queryByRole('button', { name: 'Зберегти налаштування' })).toBeNull();
  });

  it('shows an accessible offline FAQ accordion', async () => {
    const user = userEvent.setup();
    const onOpenCalendarTutorial = vi.fn();

    render(
      <SettingsPage
        settings={settings}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
        onOpenCalendarTutorial={onOpenCalendarTutorial}
      />
    );

    const faqHeading = screen.getByRole('heading', { name: 'FAQ' });
    const faqDropdown = faqHeading.closest('details');

    expect(faqDropdown?.open).toBe(false);
    await user.click(faqHeading.closest('summary')!);
    expect(faqDropdown?.open).toBe(true);

    const coefficientQuestion = screen.getByText('Як працює коефіцієнт?');
    const details = coefficientQuestion.closest('details');

    expect(details?.open).toBe(false);
    await user.click(coefficientQuestion);
    expect(details?.open).toBe(true);
    expect(
      screen.getByText(/Нові суботні й недільні зміни отримують x1.5/)
    ).toBeTruthy();
    expect(screen.getByText(/Ліміт рахується як відсоток від плану 5\/2/)).toBeTruthy();
    expect(screen.getByText('Відкрийте «Таймер»')).toBeTruthy();
    expect(screen.getByText(/Натисніть ⋮/)).toBeTruthy();
    expect(screen.getByText(/Ваш PDF залишається на пристрої/)).toBeTruthy();

    await user.click(
      screen.getByRole('button', { name: 'Як користуватися календарем' })
    );
    expect(onOpenCalendarTutorial).toHaveBeenCalledTimes(1);
  });

  it('requests the native decimal keyboard for numeric settings', () => {
    render(
      <SettingsPage
        settings={settings}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
        onOpenCalendarTutorial={vi.fn()}
      />
    );

    const monthlySalary = screen.getByLabelText(
      /Ставка за місяць/
    ) as HTMLInputElement;
    const holdDelay = screen.getByLabelText(
      'Затримка кнопок, с'
    ) as HTMLInputElement;

    expect(monthlySalary.type).toBe('text');
    expect(monthlySalary.inputMode).toBe('decimal');
    expect(monthlySalary.pattern).toBe('[0-9]*([.,][0-9]*)?');
    expect(holdDelay.type).toBe('text');
    expect(holdDelay.inputMode).toBe('decimal');
  });

  it('shows backup instructions and Telegram feedback without an author row', async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn().mockResolvedValue(undefined);

    render(
      <SettingsPage
        settings={settings}
        onSettingsChange={onSettingsChange}
        onLocalDataReplace={vi.fn()}
        onOpenCalendarTutorial={vi.fn()}
      />
    );

    expect(screen.queryByText('Автор')).toBeNull();
    expect(screen.queryByText('natuselit')).toBeNull();
    expect(
      screen.getByText(/Як зробити: натисніть «Експорт» нижче та збережіть JSON-файл/)
    ).toBeTruthy();
    const feedbackLink = screen.getByRole('link', {
      name: /Зворотний звʼязок у Telegram/
    }) as HTMLAnchorElement;
    expect(feedbackLink.href).toBe('https://t.me/natuselit');
    expect(feedbackLink.querySelector('svg')).toBeNull();

    await user.selectOptions(screen.getByLabelText(/Нагадувати про backup/), '30');
    await user.click(screen.getByRole('button', { name: 'Зберегти налаштування' }));

    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ backupReminderIntervalDays: 30 })
    );
  });

  it('validates and saves the overtime limit, step and custom strategy', async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn().mockResolvedValue(undefined);

    render(
      <SettingsPage
        settings={settings}
        onSettingsChange={onSettingsChange}
        onLocalDataReplace={vi.fn()}
        onOpenCalendarTutorial={vi.fn()}
      />
    );

    const limitInput = screen.getByLabelText(/Ліміт від планових годин/) as HTMLInputElement;
    const stepInput = screen.getByLabelText(/Крок рекомендацій, хв/) as HTMLInputElement;
    const weekdayMaxInput = screen.getByLabelText(
      /Максимум перепрацювання за будній день/
    ) as HTMLInputElement;
    const saturdayMaxInput = screen.getByLabelText(
      /Максимум роботи в суботу/
    ) as HTMLInputElement;
    expect(screen.getByRole('option', { name: 'Автоматичний' })).toBeTruthy();
    await user.clear(limitInput);
    await user.type(limitInput, '12,5');
    await user.clear(stepInput);
    await user.type(stepInput, '15');
    await user.selectOptions(screen.getByLabelText('Стратегія перепрацювань'), 'custom');
    const saturdayCountInput = screen.getByLabelText(
      /Кількість субот у місяці/
    ) as HTMLInputElement;
    await user.clear(saturdayCountInput);
    await user.type(saturdayCountInput, '3');
    await user.clear(weekdayMaxInput);
    await user.type(weekdayMaxInput, '300');
    await user.clear(saturdayMaxInput);
    await user.type(saturdayMaxInput, '600');
    await user.type(screen.getByLabelText('Дата без перепрацювання'), '2099-01-01');
    await user.click(screen.getByRole('button', { name: 'Додати' }));
    await user.click(screen.getByRole('button', { name: 'Зберегти налаштування' }));

    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        overtimeLimitPercent: 12.5,
        overtimeStepMinutes: 15,
        overtimeStrategy: 'custom',
        overtimeSaturdayCount: 3,
        overtimeWeekdayMaxMinutes: 300,
        overtimeSaturdayMaxMinutes: 600,
        overtimeUnavailableDates: ['2099-01-01']
      })
    );

    await user.clear(limitInput);
    await user.type(limitInput, '101');
    await user.click(screen.getByRole('button', { name: 'Зберегти налаштування' }));
    expect(screen.getByText('Ліміт має бути від 0 до 100%.')).toBeTruthy();

    await user.clear(limitInput);
    await user.type(limitInput, '10');
    await user.clear(stepInput);
    await user.type(stepInput, '17');
    await user.click(screen.getByRole('button', { name: 'Зберегти налаштування' }));
    expect(screen.getByText(/Крок має бути цілим числом.*кратним 5/)).toBeTruthy();
  });

  it('does not show the removed monthly Saturday x2 feature', () => {
    render(
      <SettingsPage
        settings={settings}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
        onOpenCalendarTutorial={vi.fn()}
      />
    );

    expect(screen.queryByText('Коефіцієнт субот')).toBeNull();
    expect(screen.queryByRole('button', { name: /Встановити x2/ })).toBeNull();
  });

  it('resets the calendar tutorial marker when all local data is cleared', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await localDb.appMeta.put({
      key: CALENDAR_TUTORIAL_SEEN_KEY,
      value: 'true',
      updatedAt: '2026-08-04T10:00:00.000Z'
    });

    render(
      <SettingsPage
        settings={settings}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
        onOpenCalendarTutorial={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Очистити' }));

    await waitFor(async () => {
      expect(await localDb.appMeta.get(CALENDAR_TUTORIAL_SEEN_KEY)).toBeUndefined();
    });
  });
});
