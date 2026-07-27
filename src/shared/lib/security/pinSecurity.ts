import { Capacitor } from '@capacitor/core';
import {
  AccessControl,
  NativeBiometric
} from '@capgo/capacitor-native-biometric';
import { localDb } from '../local-db';

const PIN_META_KEY = 'security-pin-config';
const NATIVE_VERIFIER_KEY = 'shifter.pin.verifier';
const BIOMETRIC_RESET_KEY = 'shifter.pin.biometric-reset';
const PIN_ITERATIONS = 600_000;
const PIN_FAILURE_LIMIT = 5;
const PIN_LOCKOUT_MS = 30_000;

type PinVerifier = {
  salt: string;
  hash: string;
};

type PinMeta = {
  version: 1;
  verifier?: PinVerifier;
  failedAttempts: number;
  lockoutUntil: number;
  biometricEnabled: boolean;
};

export type PinSecurityStatus = {
  enabled: boolean;
  native: boolean;
  biometricAvailable: boolean;
  biometricEnabled: boolean;
  failedAttempts: number;
  lockoutUntil: number;
};

export type PinVerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'invalid' | 'locked' | 'unavailable';
      remainingAttempts: number;
      lockoutUntil: number;
    };

const isPin = (pin: string): boolean => /^\d{4}$/.test(pin);

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

const derivePinHash = async (pin: string, salt: Uint8Array): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PIN_ITERATIONS,
      hash: 'SHA-256'
    },
    key,
    256
  );

  return toBase64(new Uint8Array(bits));
};

const timingSafeEqual = (left: string, right: string): boolean => {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let difference = 0;
  leftBytes.forEach((byte, index) => {
    difference |= byte ^ rightBytes[index];
  });

  return difference === 0;
};

const readMeta = async (): Promise<PinMeta | null> => {
  const record = await localDb.appMeta.get(PIN_META_KEY);

  if (!record) {
    return null;
  }

  try {
    const value = JSON.parse(record.value) as Partial<PinMeta>;

    if (value.version !== 1) {
      return null;
    }

    return {
      version: 1,
      verifier: value.verifier,
      failedAttempts:
        Number.isSafeInteger(value.failedAttempts) && value.failedAttempts! >= 0
          ? value.failedAttempts!
          : 0,
      lockoutUntil:
        Number.isFinite(value.lockoutUntil) && value.lockoutUntil! > 0
          ? value.lockoutUntil!
          : 0,
      biometricEnabled: value.biometricEnabled === true
    };
  } catch {
    return null;
  }
};

const saveMeta = async (meta: PinMeta): Promise<void> => {
  await localDb.appMeta.put({
    key: PIN_META_KEY,
    value: JSON.stringify(meta),
    updatedAt: new Date().toISOString()
  });
};

const readVerifier = async (meta: PinMeta): Promise<PinVerifier | null> => {
  if (!Capacitor.isNativePlatform()) {
    return meta.verifier ?? null;
  }

  try {
    const stored = await NativeBiometric.getData({ key: NATIVE_VERIFIER_KEY });
    const verifier = JSON.parse(stored.value) as Partial<PinVerifier>;

    return typeof verifier.salt === 'string' && typeof verifier.hash === 'string'
      ? (verifier as PinVerifier)
      : null;
  } catch {
    return null;
  }
};

const getBiometricAvailability = async (): Promise<boolean> => {
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  try {
    return (await NativeBiometric.isAvailable()).isAvailable;
  } catch {
    return false;
  }
};

export const getPinSecurityStatus = async (): Promise<PinSecurityStatus> => {
  const meta = await readMeta();

  return {
    enabled: meta !== null && (await readVerifier(meta)) !== null,
    native: Capacitor.isNativePlatform(),
    biometricAvailable: await getBiometricAvailability(),
    biometricEnabled: meta?.biometricEnabled === true,
    failedAttempts: meta?.failedAttempts ?? 0,
    lockoutUntil: meta?.lockoutUntil ?? 0
  };
};

export const createPin = async (pin: string): Promise<void> => {
  if (!isPin(pin)) {
    throw new Error('PIN має містити рівно 4 цифри.');
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const verifier: PinVerifier = {
    salt: toBase64(salt),
    hash: await derivePinHash(pin, salt)
  };
  const previous = await readMeta();
  const meta: PinMeta = {
    version: 1,
    verifier: Capacitor.isNativePlatform() ? undefined : verifier,
    failedAttempts: 0,
    lockoutUntil: 0,
    biometricEnabled: previous?.biometricEnabled === true
  };

  if (Capacitor.isNativePlatform()) {
    await NativeBiometric.setData({
      key: NATIVE_VERIFIER_KEY,
      value: JSON.stringify(verifier),
      accessControl: AccessControl.NONE
    });
  }

  await saveMeta(meta);
};

export const verifyPin = async (
  pin: string,
  now = Date.now()
): Promise<PinVerificationResult> => {
  const meta = await readMeta();

  if (!meta) {
    return {
      ok: false,
      reason: 'unavailable',
      remainingAttempts: 0,
      lockoutUntil: 0
    };
  }

  if (meta.lockoutUntil > now) {
    return {
      ok: false,
      reason: 'locked',
      remainingAttempts: 0,
      lockoutUntil: meta.lockoutUntil
    };
  }

  const verifier = await readVerifier(meta);

  if (!verifier || !isPin(pin)) {
    return {
      ok: false,
      reason: 'invalid',
      remainingAttempts: Math.max(0, PIN_FAILURE_LIMIT - meta.failedAttempts),
      lockoutUntil: 0
    };
  }

  const hash = await derivePinHash(pin, fromBase64(verifier.salt));

  if (timingSafeEqual(hash, verifier.hash)) {
    await saveMeta({ ...meta, failedAttempts: 0, lockoutUntil: 0 });
    return { ok: true };
  }

  const nextFailedAttempts = meta.failedAttempts + 1;
  const shouldLock = nextFailedAttempts >= PIN_FAILURE_LIMIT;
  const lockoutUntil = shouldLock ? now + PIN_LOCKOUT_MS : 0;

  await saveMeta({
    ...meta,
    failedAttempts: shouldLock ? 0 : nextFailedAttempts,
    lockoutUntil
  });

  return {
    ok: false,
    reason: shouldLock ? 'locked' : 'invalid',
    remainingAttempts: shouldLock ? 0 : PIN_FAILURE_LIMIT - nextFailedAttempts,
    lockoutUntil
  };
};

export const setBiometricEnabled = async (enabled: boolean): Promise<void> => {
  const meta = await readMeta();

  if (!meta || !(await readVerifier(meta))) {
    throw new Error('Спочатку створіть PIN.');
  }

  if (!Capacitor.isNativePlatform()) {
    throw new Error('Біометрія доступна лише в Android/iOS збірці.');
  }

  if (enabled) {
    if (!(await getBiometricAvailability())) {
      throw new Error('Біометрія недоступна або не налаштована на пристрої.');
    }

    await NativeBiometric.setData({
      key: BIOMETRIC_RESET_KEY,
      value: 'authorized',
      accessControl: AccessControl.BIOMETRY_CURRENT_SET,
      title: 'Увімкнення біометрії',
      negativeButtonText: 'Скасувати'
    });
  } else {
    await NativeBiometric.deleteData({ key: BIOMETRIC_RESET_KEY }).catch(() => undefined);
  }

  await saveMeta({ ...meta, biometricEnabled: enabled });
};

export const authenticateWithBiometrics = async (): Promise<boolean> => {
  const meta = await readMeta();

  if (
    !Capacitor.isNativePlatform() ||
    !meta?.biometricEnabled ||
    !(await getBiometricAvailability())
  ) {
    return false;
  }

  try {
    const stored = await NativeBiometric.getSecureData({
      key: BIOMETRIC_RESET_KEY,
      reason: 'Розблокувати Shifter',
      title: 'Розблокування',
      subtitle: 'Підтвердьте особу',
      negativeButtonText: 'Скасувати'
    });

    return stored.value === 'authorized';
  } catch {
    return false;
  }
};

export const deletePinSecurity = async (): Promise<void> => {
  await localDb.appMeta.delete(PIN_META_KEY);

  if (Capacitor.isNativePlatform()) {
    await Promise.all([
      NativeBiometric.deleteData({ key: NATIVE_VERIFIER_KEY }).catch(() => undefined),
      NativeBiometric.deleteData({ key: BIOMETRIC_RESET_KEY }).catch(() => undefined)
    ]);
  }
};
