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

    expect(screen.getByRole('heading', { name: 'FAQ' })).toBeTruthy();
    const coefficientQuestion = screen.getByText('Як працює коефіцієнт?');
    const details = coefficientQuestion.closest('details');

    expect(details?.open).toBe(false);
    await user.click(coefficientQuestion);
    expect(details?.open).toBe(true);
    expect(
      screen.getByText(/В автоматичному режимі плановий час оплачується за x1/)
    ).toBeTruthy();
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
});
