// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const securityMocks = vi.hoisted(() => ({
  authenticateWithBiometrics: vi.fn(),
  createPin: vi.fn(),
  getPinSecurityStatus: vi.fn(),
  verifyPin: vi.fn()
}));

vi.mock('../../lib/security/pinSecurity', () => securityMocks);

import { LockScreen } from './LockScreen';

const status = {
  enabled: true,
  native: false,
  biometricAvailable: false,
  biometricEnabled: false,
  failedAttempts: 0,
  lockoutUntil: 0
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('LockScreen', () => {
  it('uses a numeric keypad and unlocks after a valid four-digit PIN', async () => {
    securityMocks.verifyPin.mockResolvedValue({ ok: true });
    const onUnlock = vi.fn();

    render(
      <LockScreen
        status={status}
        onUnlock={onUnlock}
        onFullReset={vi.fn()}
      />
    );

    const pinInput = screen.getByLabelText('PIN із 4 цифр');
    expect(pinInput.getAttribute('inputmode')).toBe('numeric');
    expect(pinInput.getAttribute('maxlength')).toBe('4');

    fireEvent.change(pinInput, { target: { value: '12a34' } });
    fireEvent.click(screen.getByRole('button', { name: 'Розблокувати' }));

    await waitFor(() => expect(onUnlock).toHaveBeenCalledOnce());
    expect(securityMocks.verifyPin).toHaveBeenCalledWith('1234');
  });

  it('offers confirmed full reset when biometrics are unavailable', async () => {
    const onFullReset = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <LockScreen
        status={status}
        onUnlock={vi.fn()}
        onFullReset={onFullReset}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Забув PIN' }));
    await waitFor(() => expect(onFullReset).toHaveBeenCalledOnce());
  });
});
