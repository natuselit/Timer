// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingPage } from './OnboardingPage';

afterEach(() => {
  cleanup();
});

describe('OnboardingPage', () => {
  it('moves through tutorial steps and allows returning to the previous step', async () => {
    const user = userEvent.setup();

    render(<OnboardingPage onComplete={vi.fn()} />);

    expect(
      screen.getByRole('heading', { name: 'Відмічайте початок і кінець зміни' })
    ).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Крок 1 з 4' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Далі' }));
    expect(screen.getByRole('heading', { name: 'Фіксуйте роботу в тікетах' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Далі' }));
    expect(screen.getByRole('heading', { name: 'Контролюйте час і заробіток' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByRole('heading', { name: 'Фіксуйте роботу в тікетах' })).toBeTruthy();
  });

  it('skips only the tutorial and keeps initial settings required', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();

    render(<OnboardingPage onComplete={onComplete} />);

    await user.click(screen.getByRole('button', { name: 'Пропустити' }));
    expect(screen.getByRole('heading', { name: 'Початкові налаштування' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Крок 4 з 4' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Перейти до Таймера' }));

    expect(screen.getByText('Вкажіть імʼя.')).toBeTruthy();
    expect(screen.getByText('Вкажіть прізвище.')).toBeTruthy();
    expect(screen.getByText('Ставка за місяць має бути більшою за 0.')).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('submits normalized settings with the fixed 1.5 second hold delay', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn().mockResolvedValue(undefined);

    render(<OnboardingPage onComplete={onComplete} />);

    await user.click(screen.getByRole('button', { name: 'Пропустити' }));
    expect(screen.queryByLabelText('Затримка кнопок, с')).toBeNull();
    await user.type(screen.getByLabelText('Імʼя'), '  Тарас  ');
    await user.type(screen.getByLabelText('Прізвище'), '  Шевченко  ');
    await user.type(screen.getByLabelText('Ставка за місяць, ₴'), '17600');
    await user.click(screen.getByRole('button', { name: 'Перейти до Таймера' }));

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith({
        employeeFirstName: 'Тарас',
        employeeLastName: 'Шевченко',
        monthlySalary: 17_600,
        monthlyBonus: 2000,
        arriveHoldDelayMs: 1500,
        leaveHoldDelayMs: 1500
      });
    });
  });

  it('returns from settings without losing entered values', async () => {
    const user = userEvent.setup();

    render(<OnboardingPage onComplete={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Пропустити' }));
    await user.type(screen.getByLabelText('Імʼя'), 'Олена');
    await user.click(screen.getByRole('button', { name: 'Назад' }));
    await user.click(screen.getByRole('button', { name: 'До налаштувань' }));

    expect((screen.getByLabelText('Імʼя') as HTMLInputElement).value).toBe('Олена');
  });
});
