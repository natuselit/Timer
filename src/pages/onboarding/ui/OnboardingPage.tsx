import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  ChartNoAxesCombined,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  ShieldCheck,
  type LucideIcon
} from 'lucide-react';
import { DEFAULT_SETTINGS, SHIFT_HOLD_DELAY_MS } from '../../../entities/settings';
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
};

type FormErrors = Partial<Record<keyof FormValues, string>>;

type TutorialPoint = {
  title: string;
  description: string;
};

type TutorialStep = {
  icon: LucideIcon;
  title: string;
  description: string;
  points: TutorialPoint[];
};

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    icon: Clock3,
    title: 'Відмічайте початок і кінець зміни',
    description: 'Головний екран одразу показує стан вашої поточної зміни.',
    points: [
      {
        title: 'Утримуйте кнопку',
        description: 'Дії «Прийшов» і «Пішов» спрацьовують після утримання, а не випадкового тапу.'
      },
      {
        title: 'Тип зміни визначиться автоматично',
        description: 'Застосунок обере найближчу планову зміну за часом вашого приходу.'
      }
    ]
  },
  {
    icon: ClipboardCheck,
    title: 'Фіксуйте роботу в тікетах',
    description: 'Тікети допомагають бачити виробіток, простій і результат зміни.',
    points: [
      {
        title: 'Один активний тікет',
        description: 'Завершіть поточний тікет, перш ніж починати наступний.'
      },
      {
        title: 'Вкажіть фактичну кількість',
        description: 'Перед завершенням тікета внесіть виконаний результат — значення може бути від нуля.'
      },
      {
        title: 'Спочатку тікет, потім вихід',
        description: 'Активний тікет потрібно завершити до утримання кнопки «Пішов».'
      }
    ]
  },
  {
    icon: ChartNoAxesCombined,
    title: 'Контролюйте час і заробіток',
    description: 'Усі потрібні дані доступні в застосунку навіть без інтернету.',
    points: [
      {
        title: 'Історія та аналітика',
        description: 'Переглядайте відпрацьовані зміни, виробіток і фінансові підсумки.'
      },
      {
        title: 'Графік підприємства',
        description: 'Імпортуйте текстовий графік і порівнюйте його зі своїми змінами.'
      },
      {
        title: 'Приватність',
        description: 'Режим інкогніто приховає фінансові показники, не змінюючи збережені дані.'
      }
    ]
  }
];

const SETTINGS_STEP_INDEX = TUTORIAL_STEPS.length;
const TOTAL_STEPS = SETTINGS_STEP_INDEX + 1;

const initialValues: FormValues = {
  employeeFirstName: '',
  employeeLastName: '',
  monthlySalary: '',
  monthlyBonus: String(DEFAULT_SETTINGS.monthlyBonus)
};

const parsePositiveNumber = (value: string): number => Number(value.replace(',', '.'));

const validateForm = (values: FormValues): FormErrors => {
  const errors: FormErrors = {};
  const firstName = values.employeeFirstName.trim();
  const lastName = values.employeeLastName.trim();
  const monthlySalary = parsePositiveNumber(values.monthlySalary);
  const monthlyBonus = parsePositiveNumber(values.monthlyBonus);

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

  return errors;
};

export function OnboardingPage({ onComplete }: OnboardingPageProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [values, setValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const isSettingsStep = currentStepIndex === SETTINGS_STEP_INDEX;
  const tutorialStep = TUTORIAL_STEPS[currentStepIndex];

  useEffect(() => {
    headingRef.current?.focus();
  }, [currentStepIndex]);

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

  const goToNextStep = () => {
    setCurrentStepIndex((current) => Math.min(current + 1, SETTINGS_STEP_INDEX));
  };

  const goToPreviousStep = () => {
    setCurrentStepIndex((current) => Math.max(current - 1, 0));
  };

  const skipTutorial = () => {
    setCurrentStepIndex(SETTINGS_STEP_INDEX);
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
      await onComplete({
        employeeFirstName: values.employeeFirstName.trim(),
        employeeLastName: values.employeeLastName.trim(),
        monthlySalary: parsePositiveNumber(values.monthlySalary),
        monthlyBonus: parsePositiveNumber(values.monthlyBonus),
        arriveHoldDelayMs: SHIFT_HOLD_DELAY_MS,
        leaveHoldDelayMs: SHIFT_HOLD_DELAY_MS
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
        <div className="onboarding-page__topline">
          <p>Перший запуск</p>
          {!isSettingsStep ? (
            <button type="button" onClick={skipTutorial}>
              Пропустити
            </button>
          ) : null}
        </div>

        <div
          className="onboarding-page__progress"
          role="group"
          aria-label={`Крок ${currentStepIndex + 1} з ${TOTAL_STEPS}`}
        >
          <span>
            Крок {currentStepIndex + 1} з {TOTAL_STEPS}
          </span>
          <div className="onboarding-page__progress-track" aria-hidden="true">
            {Array.from({ length: TOTAL_STEPS }, (_, index) => (
              <span
                className={index <= currentStepIndex ? 'is-active' : undefined}
                key={index}
              />
            ))}
          </div>
        </div>

        {isSettingsStep ? (
          <section className="onboarding-page__settings">
            <div className="onboarding-page__header">
              <span className="onboarding-page__header-icon" aria-hidden="true">
                <ShieldCheck size={26} />
              </span>
              <div>
                <p className="onboarding-page__eyebrow">Останній крок</p>
                <h1 id="onboarding-title" ref={headingRef} tabIndex={-1}>
                  Початкові налаштування
                </h1>
                <p className="onboarding-page__intro">
                  Дані залишаться тільки на цьому пристрої. Їх можна змінити пізніше.
                </p>
              </div>
            </div>

            <form className="onboarding-page__form" onSubmit={submitForm} noValidate>
              <label className="onboarding-page__field">
                <span>Імʼя</span>
                <input
                  autoComplete="given-name"
                  aria-invalid={errors.employeeFirstName ? 'true' : 'false'}
                  aria-describedby={
                    errors.employeeFirstName ? 'employeeFirstName-error' : undefined
                  }
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
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  pattern="[0-9]*([.,][0-9]*)?"
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
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  pattern="[0-9]*([.,][0-9]*)?"
                  aria-invalid={errors.monthlyBonus ? 'true' : 'false'}
                  aria-describedby={errors.monthlyBonus ? 'monthlyBonus-error' : undefined}
                  value={values.monthlyBonus}
                  onChange={updateField('monthlyBonus')}
                />
                {errors.monthlyBonus ? (
                  <small id="monthlyBonus-error">{errors.monthlyBonus}</small>
                ) : null}
              </label>

              {submitError ? (
                <p className="onboarding-page__submit-error" role="alert">
                  {submitError}
                </p>
              ) : null}

              <div className="onboarding-page__form-actions">
                <button
                  className="onboarding-page__back"
                  type="button"
                  onClick={goToPreviousStep}
                  disabled={isSubmitting}
                >
                  <ChevronLeft size={20} />
                  Назад
                </button>
                <button
                  className="onboarding-page__submit"
                  type="submit"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Збереження...' : 'Перейти до Таймера'}
                </button>
              </div>
            </form>
          </section>
        ) : (
          <article className="onboarding-page__tutorial" aria-live="polite">
            <span className="onboarding-page__tutorial-icon" aria-hidden="true">
              {tutorialStep ? <tutorialStep.icon size={38} strokeWidth={1.9} /> : null}
            </span>

            <div className="onboarding-page__tutorial-copy">
              <p className="onboarding-page__eyebrow">Швидкий старт</p>
              <h1 id="onboarding-title" ref={headingRef} tabIndex={-1}>
                {tutorialStep?.title}
              </h1>
              <p className="onboarding-page__intro">{tutorialStep?.description}</p>
            </div>

            <ul className="onboarding-page__points">
              {tutorialStep?.points.map((point) => (
                <li key={point.title}>
                  <span aria-hidden="true">
                    <Check size={17} strokeWidth={2.5} />
                  </span>
                  <div>
                    <strong>{point.title}</strong>
                    <p>{point.description}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="onboarding-page__tutorial-actions">
              <button
                className="onboarding-page__back"
                type="button"
                onClick={goToPreviousStep}
                disabled={currentStepIndex === 0}
              >
                <ChevronLeft size={20} />
                Назад
              </button>
              <button className="onboarding-page__next" type="button" onClick={goToNextStep}>
                {currentStepIndex === SETTINGS_STEP_INDEX - 1 ? 'До налаштувань' : 'Далі'}
                <ChevronRight size={20} />
              </button>
            </div>
          </article>
        )}
      </section>
    </main>
  );
}
