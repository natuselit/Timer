import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Hand,
  MousePointerClick,
  X,
  type LucideIcon
} from 'lucide-react';
import './CalendarTutorial.css';

type CalendarTutorialProps = {
  isOpen: boolean;
  onDismiss: () => void;
};

type TutorialStep = {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  points: string[];
};

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    icon: CalendarDays,
    eyebrow: 'Швидкий вибір',
    title: 'Почніть із потрібного періоду',
    description:
      'Календар відкривається на «Сьогодні», а пресети допомагають швидко змінити період.',
    points: [
      '«Сьогодні» показує один поточний день.',
      '«Місяць» обирає весь видимий місяць.',
      '«Весь час» охоплює всі локальні записи.'
    ]
  },
  {
    icon: MousePointerClick,
    eyebrow: 'Один день',
    title: 'Коротко натисніть на дату',
    description:
      'Звичайний тап обирає один день і відразу оновлює підсумки, список та аналітику.',
    points: [
      'Обрана дата виділяється в календарі.',
      'Повторний вибір іншої дати замінює поточний.',
      'Дні сусіднього місяця також можна натискати.'
    ]
  },
  {
    icon: Hand,
    eyebrow: 'Діапазон',
    title: 'Утримуйте початок і кінець',
    description:
      'Затисніть початкову дату до завершення прогресу, перейдіть стрілкою за потреби й так само затисніть кінцеву.',
    points: [
      'Початкова дата не зникне під час переходу між місяцями.',
      'Можна завершити діапазон раніше або пізніше початкової дати.',
      'Підказка під пресетами показує, яку межу потрібно обрати.'
    ]
  }
];

export function CalendarTutorial({ isOpen, onDismiss }: CalendarTutorialProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const step = TUTORIAL_STEPS[stepIndex];
  const isLastStep = stepIndex === TUTORIAL_STEPS.length - 1;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setStepIndex(0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    headingRef.current?.focus();
  }, [isOpen, stepIndex]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismiss();
      }
    };

    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isOpen, onDismiss]);

  if (!isOpen) {
    return null;
  }

  const StepIcon = step.icon;

  return (
    <div className="calendar-tutorial" role="presentation">
      <section
        className="calendar-tutorial__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="calendar-tutorial-title"
        aria-describedby="calendar-tutorial-description"
      >
        <header className="calendar-tutorial__topline">
          <span>
            Крок {stepIndex + 1} із {TUTORIAL_STEPS.length}
          </span>
          <button type="button" aria-label="Закрити навчання календаря" onClick={onDismiss}>
            <X aria-hidden="true" size={20} />
          </button>
        </header>

        <div className="calendar-tutorial__progress" aria-hidden="true">
          {TUTORIAL_STEPS.map((tutorialStep, index) => (
            <span data-active={index <= stepIndex ? 'true' : 'false'} key={tutorialStep.title} />
          ))}
        </div>

        <div className="calendar-tutorial__icon" aria-hidden="true">
          <StepIcon size={34} strokeWidth={1.9} />
        </div>

        <div className="calendar-tutorial__copy">
          <p>{step.eyebrow}</p>
          <h2 id="calendar-tutorial-title" ref={headingRef} tabIndex={-1}>
            {step.title}
          </h2>
          <p id="calendar-tutorial-description">{step.description}</p>
        </div>

        <ul>
          {step.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>

        <footer className="calendar-tutorial__actions">
          <button
            className="calendar-tutorial__back"
            type="button"
            disabled={stepIndex === 0}
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
          >
            <ChevronLeft aria-hidden="true" size={19} />
            Назад
          </button>
          <button
            className="calendar-tutorial__next"
            type="button"
            onClick={() => {
              if (isLastStep) {
                onDismiss();
                return;
              }

              setStepIndex((current) => current + 1);
            }}
          >
            {isLastStep ? 'Готово' : 'Далі'}
            {!isLastStep ? <ChevronRight aria-hidden="true" size={19} /> : null}
          </button>
        </footer>
      </section>
    </div>
  );
}
