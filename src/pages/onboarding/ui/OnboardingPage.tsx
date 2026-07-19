import { useState, type ChangeEvent, type FormEvent } from 'react';
import {
  DEFAULT_SETTINGS,
  HOLD_DELAY_MAX_MS,
  HOLD_DELAY_MIN_MS
} from '../../../entities/settings';
import './OnboardingPage.css';

export type OnboardingValues = {
  employeeFirstName: string;
  employeeLastName: string;
  monthlySalary: number;
  monthlyBonus: number;
  arriveHoldDelayMs: number;
  leaveHoldDelayMs: number;
};

type OnboardingPageProps = {
  onComplete: (values: OnboardingValues) => Promise<void>;
};

type FormValues = {
  employeeFirstName: string;
  employeeLastName: string;
  monthlySalary: string;
  monthlyBonus: string;
  holdDelaySeconds: string;
};

type FormErrors = Partial<Record<keyof FormValues, string>>;

const delayMinSeconds = HOLD_DELAY_MIN_MS / 1000;
const delayMaxSeconds = HOLD_DELAY_MAX_MS / 1000;

const initialValues: FormValues = {
  employeeFirstName: '',
  employeeLastName: '',
  monthlySalary: '',
  monthlyBonus: String(DEFAULT_SETTINGS.monthlyBonus),
  holdDelaySeconds: String(DEFAULT_SETTINGS.arriveHoldDelayMs / 1000)
};

const parsePositiveNumber = (value: string): number => Number(value.replace(',', '.'));

const validateForm = (values: FormValues): FormErrors => {
  const errors: FormErrors = {};
  const firstName = values.employeeFirstName.trim();
  const lastName = values.employeeLastName.trim();
  const monthlySalary = parsePositiveNumber(values.monthlySalary);
  const monthlyBonus = parsePositiveNumber(values.monthlyBonus);
  const holdDelay = parsePositiveNumber(values.holdDelaySeconds);

  if (!firstName) {
    errors.employeeFirstName = 'Вкажіть імʼя.';
  }

  if (!lastName) {
    errors.employeeLastName = 'Вкажіть прізвище.';
  }

  if (!Number.isFinite(monthlySalary) || monthlySalary <= 0) {
    errors.monthlySalary = 'Ставка за місяць має бути більшою за 0.';
  }

  if (!Number.isFinite(monthlyBonus) || monthlyBonus < 0) {
    errors.monthlyBonus = 'Премія не може бути відʼємною.';
  }

  if (
    !Number.isFinite(holdDelay) ||
    holdDelay < delayMinSeconds ||
    holdDelay > delayMaxSeconds
  ) {
    errors.holdDelaySeconds = `Затримка має бути від ${delayMinSeconds} до ${delayMaxSeconds} с.`;
  }

  return errors;
};

export function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField =
    (field: keyof FormValues) => (event: ChangeEvent<HTMLInputElement>) => {
      setValues((current) => ({
        ...current,
        [field]: event.target.value
      }));
      setErrors((current) => ({
        ...current,
        [field]: undefined
      }));
    };

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateForm(values);

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setSubmitError(null);
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const holdDelayMs = Math.round(parsePositiveNumber(values.holdDelaySeconds) * 1000);

      await onComplete({
        employeeFirstName: values.employeeFirstName.trim(),
        employeeLastName: values.employeeLastName.trim(),
        monthlySalary: parsePositiveNumber(values.monthlySalary),
        monthlyBonus: parsePositiveNumber(values.monthlyBonus),
        arriveHoldDelayMs: holdDelayMs,
        leaveHoldDelayMs: holdDelayMs
      });
    } catch (_error) {
      setSubmitError('Не вдалося зберегти налаштування. Спробуйте ще раз.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="onboarding-page" aria-labelledby="onboarding-title">
      <section className="onboarding-page__panel">
        <div className="onboarding-page__header">
          <p className="onboarding-page__eyebrow">Перший запуск</p>
          <h1 id="onboarding-title">Початкові налаштування</h1>
        </div>

        <form className="onboarding-page__form" onSubmit={submitForm} noValidate>
          <label className="onboarding-page__field">
            <span>Імʼя</span>
            <input
              autoComplete="given-name"
              autoFocus
              aria-invalid={errors.employeeFirstName ? 'true' : 'false'}
              aria-describedby={errors.employeeFirstName ? 'employeeFirstName-error' : undefined}
              value={values.employeeFirstName}
              onChange={updateField('employeeFirstName')}
              placeholder="Наприклад, Тарас"
            />
            {errors.employeeFirstName ? (
              <small id="employeeFirstName-error">{errors.employeeFirstName}</small>
            ) : null}
          </label>

          <label className="onboarding-page__field">
            <span>Прізвище</span>
            <input
              autoComplete="family-name"
              aria-invalid={errors.employeeLastName ? 'true' : 'false'}
              aria-describedby={errors.employeeLastName ? 'employeeLastName-error' : undefined}
              value={values.employeeLastName}
              onChange={updateField('employeeLastName')}
              placeholder="Наприклад, Шевченко"
            />
            {errors.employeeLastName ? (
              <small id="employeeLastName-error">{errors.employeeLastName}</small>
            ) : null}
          </label>

          <label className="onboarding-page__field">
            <span>Ставка за місяць, ₴</span>
            <input
              inputMode="decimal"
              aria-invalid={errors.monthlySalary ? 'true' : 'false'}
              aria-describedby={errors.monthlySalary ? 'monthlySalary-error' : undefined}
              value={values.monthlySalary}
              onChange={updateField('monthlySalary')}
              placeholder="0"
            />
            {errors.monthlySalary ? (
              <small id="monthlySalary-error">{errors.monthlySalary}</small>
            ) : null}
          </label>

          <label className="onboarding-page__field">
            <span>Премія за місяць, ₴</span>
            <input
              inputMode="decimal"
              aria-invalid={errors.monthlyBonus ? 'true' : 'false'}
              aria-describedby={errors.monthlyBonus ? 'monthlyBonus-error' : undefined}
              value={values.monthlyBonus}
              onChange={updateField('monthlyBonus')}
            />
            {errors.monthlyBonus ? (
              <small id="monthlyBonus-error">{errors.monthlyBonus}</small>
            ) : null}
          </label>

          <label className="onboarding-page__field">
            <span>Затримка кнопок, с</span>
            <input
              inputMode="decimal"
              aria-invalid={errors.holdDelaySeconds ? 'true' : 'false'}
              aria-describedby={errors.holdDelaySeconds ? 'holdDelaySeconds-error' : undefined}
              value={values.holdDelaySeconds}
              onChange={updateField('holdDelaySeconds')}
            />
            {errors.holdDelaySeconds ? (
              <small id="holdDelaySeconds-error">{errors.holdDelaySeconds}</small>
            ) : null}
          </label>

          {submitError ? <p className="onboarding-page__submit-error">{submitError}</p> : null}

          <button className="onboarding-page__submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Збереження...' : 'Перейти до Таймера'}
          </button>
        </form>
      </section>
    </main>
  );
}
