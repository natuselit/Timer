// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppSplash } from './AppSplash';

afterEach(() => {
  cleanup();
});

describe('AppSplash', () => {
  it('renders the branded loading state', () => {
    render(<AppSplash />);

    expect(screen.getByRole('status', { name: 'Завантаження' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Облік часу' })).toBeTruthy();
    expect(screen.getByText('Готуємо ваш робочий день')).toBeTruthy();
  });
});
