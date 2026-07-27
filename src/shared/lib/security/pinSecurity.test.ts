import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false
  }
}));

import { localDb } from '../local-db';
import {
  createPin,
  deletePinSecurity,
  getPinSecurityStatus,
  verifyPin
} from './pinSecurity';

afterEach(async () => {
  await deletePinSecurity();
  await localDb.appMeta.clear();
});

describe('PIN security', () => {
  it('stores and verifies exactly four digits without plain text', async () => {
    await createPin('1234');

    await expect(verifyPin('1234')).resolves.toEqual({ ok: true });
    await expect(getPinSecurityStatus()).resolves.toMatchObject({
      enabled: true,
      native: false,
      biometricEnabled: false
    });

    const stored = await localDb.appMeta.get('security-pin-config');
    expect(stored?.value).not.toContain('1234');
    expect(stored?.value).toContain('"salt"');
    expect(stored?.value).toContain('"hash"');
  }, 15_000);

  it('locks for 30 seconds after five wrong attempts', async () => {
    await createPin('1234');

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await verifyPin('0000', 1_000);
      expect(result).toMatchObject({
        ok: false,
        reason: 'invalid',
        remainingAttempts: 4 - attempt
      });
    }

    const fifth = await verifyPin('0000', 1_000);
    expect(fifth).toEqual({
      ok: false,
      reason: 'locked',
      remainingAttempts: 0,
      lockoutUntil: 31_000
    });
    await expect(verifyPin('1234', 30_999)).resolves.toMatchObject({
      ok: false,
      reason: 'locked'
    });
    await expect(verifyPin('1234', 31_000)).resolves.toEqual({ ok: true });
  }, 30_000);
});
