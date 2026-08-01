// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../../entities/settings';
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
  incognitoEnabled: false,
  onboardingCompleted: true,
  updatedAt: '2026-07-27T19:30:00.000+03:00'
};

afterEach(() => {
  cleanup();
});

describe('SettingsPage', () => {
  it('shows an accessible offline FAQ accordion', async () => {
    const user = userEvent.setup();

    render(
      <SettingsPage
        settings={settings}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
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
      screen.getByText(/В автоматичному режимі плановий час оплачується за x1/)
    ).toBeTruthy();
    expect(screen.getByText(/оберіть локальний PDF табеля з текстовим шаром/i)).toBeTruthy();
  });

  it('requests the native decimal keyboard for numeric settings', () => {
    render(
      <SettingsPage
        settings={settings}
        onSettingsChange={vi.fn().mockResolvedValue(undefined)}
        onLocalDataReplace={vi.fn()}
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

    await user.selectOptions(screen.getByLabelText(/Нагадувати про backup/), '30');
    await user.click(screen.getByRole('button', { name: 'Зберегти налаштування' }));

    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ backupReminderIntervalDays: 30 })
    );
  });
});
