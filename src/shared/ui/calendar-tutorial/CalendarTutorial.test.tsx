// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarTutorial } from './CalendarTutorial';

afterEach(() => {
  cleanup();
});

describe('CalendarTutorial', () => {
  it('walks through all three calendar lessons and finishes', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(<CalendarTutorial isOpen onDismiss={onDismiss} />);

    expect(screen.getByText('Крок 1 із 3')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Почніть із потрібного періоду' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Далі' }));
    expect(screen.getByRole('heading', { name: 'Коротко натисніть на дату' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Далі' }));
    expect(screen.getByRole('heading', { name: 'Утримуйте початок і кінець' })).toBeTruthy();
    expect(screen.getByText(/не зникне під час переходу між місяцями/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Готово' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
