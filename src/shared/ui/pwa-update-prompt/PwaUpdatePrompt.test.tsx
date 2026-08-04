// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaUpdatePrompt } from './PwaUpdatePrompt';

const pwaMocks = vi.hoisted(() => ({
  isUpdateReady: false,
  updateServiceWorker: vi.fn()
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [pwaMocks.isUpdateReady, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: pwaMocks.updateServiceWorker
  })
}));

beforeEach(() => {
  pwaMocks.isUpdateReady = false;
  pwaMocks.updateServiceWorker.mockReset();
  pwaMocks.updateServiceWorker.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('PwaUpdatePrompt', () => {
  it('stays hidden while no update is waiting', () => {
    render(<PwaUpdatePrompt />);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('waits for an explicit click before applying a ready update', () => {
    pwaMocks.isUpdateReady = true;

    render(<PwaUpdatePrompt />);

    expect(screen.getByRole('status').textContent).toContain('Оновлення готове');
    expect(pwaMocks.updateServiceWorker).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Оновити' }));

    expect(pwaMocks.updateServiceWorker).toHaveBeenCalledOnce();
    expect(pwaMocks.updateServiceWorker).toHaveBeenCalledWith(true);
  });
});
