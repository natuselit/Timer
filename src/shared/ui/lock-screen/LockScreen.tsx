import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Fingerprint, LockKeyhole, RotateCcw } from 'lucide-react';
import {
  authenticateWithBiometrics,
  createPin,
  getPinSecurityStatus,
  verifyPin,
  type PinSecurityStatus
} from '../../lib/security/pinSecurity';
import './LockScreen.css';

type LockScreenProps = {
  status: PinSecurityStatus;
  onUnlock: () => void;
  onFullReset: () => Promise<void>;
};

const normalizePin = (value: string): string => value.replace(/\D/g, '').slice(0, 4);

export function LockScreen({ status, onUnlock, onFullReset }: LockScreenProps) {
  const [pin, setPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [mode, setMode] = useState<'unlock' | 'reset'>('unlock');
  const [error, setError] = useState<string | null>(null);
  const [lockoutUntil, setLockoutUntil] = useState(status.lockoutUntil);
  const [now, setNow] = useState(Date.now());
  const [isBusy, setIsBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const remainingSeconds = Math.max(0, Math.ceil((lockoutUntil - now) / 1000));

  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (remainingSeconds <= 0) {
      return;
    }

    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [remainingSeconds]);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();

    if (pin.length !== 4 || remainingSeconds > 0) {
      return;
    }

    setIsBusy(true);
    setError(null);

    try {
      const result = await verifyPin(pin);

      if (result.ok) {
        onUnlock();
        return;
      }

      setPin('');
      setLockoutUntil(result.lockoutUntil);
      setNow(Date.now());
      setError(
        result.reason === 'locked'
          ? 'Забагато спроб. Зачекайте 30 секунд.'
          : `Невірний PIN. Залишилось спроб: ${result.remainingAttempts}.`
      );
    } finally {
      setIsBusy(false);
    }
  };

  const unlockWithBiometrics = async () => {
    setIsBusy(true);
    setError(null);

    try {
      if (await authenticateWithBiometrics()) {
        onUnlock();
      } else {
        setError('Біометричну перевірку не пройдено.');
      }
    } finally {
      setIsBusy(false);
    }
  };

  const startForgotPin = async () => {
    if (status.biometricEnabled) {
      setIsBusy(true);
      const authenticated = await authenticateWithBiometrics();
      setIsBusy(false);

      if (authenticated) {
        setMode('reset');
        setError(null);
      } else {
        setError('Для заміни PIN потрібна успішна біометрична перевірка.');
      }
      return;
    }

    if (
      window.confirm(
        'Без біометрії відновити PIN неможливо. Повністю очистити всі локальні дані?'
      )
    ) {
      setIsBusy(true);
      await onFullReset();
    }
  };

  const resetPin = async (event: FormEvent) => {
    event.preventDefault();

    if (newPin.length !== 4 || confirmPin.length !== 4) {
      setError('PIN має містити рівно 4 цифри.');
      return;
    }

    if (newPin !== confirmPin) {
      setError('PIN і підтвердження не збігаються.');
      return;
    }

    setIsBusy(true);
    try {
      await createPin(newPin);
      onUnlock();
    } catch (resetError) {
      setError(
        resetError instanceof Error ? resetError.message : 'Не вдалося замінити PIN.'
      );
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <main className="lock-screen">
      <section className="lock-screen__card" aria-labelledby="lock-screen-title">
        <span className="lock-screen__icon" aria-hidden="true">
          <LockKeyhole size={30} />
        </span>
        <div>
          <p>Shifter</p>
          <h1 id="lock-screen-title">
            {mode === 'unlock' ? 'Введіть PIN' : 'Створіть новий PIN'}
          </h1>
        </div>

        {mode === 'unlock' ? (
          <form onSubmit={unlock}>
            <label>
              <span>PIN із 4 цифр</span>
              <input
                ref={inputRef}
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                autoComplete="off"
                value={pin}
                disabled={isBusy || remainingSeconds > 0}
                onChange={(event) => {
                  setPin(normalizePin(event.target.value));
                  setError(null);
                }}
              />
            </label>
            <div className="lock-screen__dots" aria-hidden="true">
              {[0, 1, 2, 3].map((index) => (
                <span data-filled={pin.length > index ? 'true' : 'false'} key={index} />
              ))}
            </div>
            <button type="submit" disabled={isBusy || pin.length !== 4 || remainingSeconds > 0}>
              {remainingSeconds > 0 ? `Спробуйте через ${remainingSeconds} с` : 'Розблокувати'}
            </button>
          </form>
        ) : (
          <form onSubmit={resetPin}>
            <label>
              <span>Новий PIN</span>
              <input
                ref={inputRef}
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={newPin}
                onChange={(event) => setNewPin(normalizePin(event.target.value))}
              />
            </label>
            <label>
              <span>Підтвердіть PIN</span>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={confirmPin}
                onChange={(event) => setConfirmPin(normalizePin(event.target.value))}
              />
            </label>
            <button type="submit" disabled={isBusy}>
              Зберегти новий PIN
            </button>
          </form>
        )}

        {error ? <p className="lock-screen__error" role="alert">{error}</p> : null}

        {mode === 'unlock' && status.biometricEnabled ? (
          <button
            className="lock-screen__secondary"
            type="button"
            disabled={isBusy}
            onClick={() => void unlockWithBiometrics()}
          >
            <Fingerprint size={20} aria-hidden="true" />
            Біометрія
          </button>
        ) : null}

        {mode === 'unlock' ? (
          <button
            className="lock-screen__link"
            type="button"
            disabled={isBusy}
            onClick={() => void startForgotPin()}
          >
            <RotateCcw size={16} aria-hidden="true" />
            Забув PIN
          </button>
        ) : null}

        <small>Екранний замок не шифрує локальну базу або JSON backup.</small>
      </section>
    </main>
  );
}
