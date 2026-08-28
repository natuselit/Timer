import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import {
  ArrowRight,
  CalendarClock,
  Check,
  Clock3,
  Edit3,
  Ellipsis,
  Eye,
  EyeOff,
  SlidersHorizontal,
  StickyNote,
  Trash2,
  X
} from 'lucide-react';
import { BottomNavigation } from '../../../widgets/bottom-navigation';
import { AppShell } from '../../../shared/ui/app-shell';
import {
  calculateHourlyRateFromMonthlySalary,
  createGradeSnapshot,
  SHIFT_HOLD_DELAY_MS,
  type OvertimeStrategy,
  type Settings
} from '../../../entities/settings';
import {
  calculateSalaryBreakdown,
  calculateTicketProductionSummary,
  detectShiftType,
  getEffectiveCoefficient,
  isValidWorkTicketNorm,
  normalizeWorkTicketNormDraft,
  SHIFT_NOTE_MAX_LENGTH,
  type ISODateTimeString,
  type Shift,
  type ShiftType,
  type WorkTicket
} from '../../../entities/shift';
import {
  adjustWorkTicketDowntime,
  addWorkTicketToActiveShift,
  CalendarTutorialRepository,
  completeWorkTicket,
  createShift,
  deleteWorkTicketFromActiveShift,
  EnterpriseScheduleRepository,
  getActiveShift,
  getShiftsByMonth,
  getLocalDataDateBounds,
  localDb,
  ShiftConstraintError,
  ShiftRepository,
  updateWorkTicketInActiveShift,
  updateActiveShiftNote,
  updateShift
} from '../../../shared/lib/local-db';
import { CalendarTutorial } from '../../../shared/ui/calendar-tutorial';
import {
  combineLocalDateAndTime,
  getCalendarMonthRange,
  getCalendarPresetSelection,
  formatTimeInputDraft,
  formatDate,
  formatDurationMinutes,
  formatShortMinuteDuration,
  formatTime,
  getCurrentMonth,
  getDateFromDateTime,
  getDurationMinutes,
  getLocalDateKey,
  getSingleDateRange,
  getTimeInputValue,
  normalizeTimeInput,
  toLocalIsoString,
  type CalendarDateRange,
  type CalendarRangePreset
} from '../../../shared/lib/date-time';
import { formatHourlyRate, formatMoney } from '../../../shared/lib/format';
import {
  copyTextToClipboard,
  copyTextToClipboardFromUserGesture,
  formatShiftClipboardText,
  prepareTextClipboardWrite,
  type PreparedTextClipboardWrite
} from '../../../shared/lib/clipboard/shiftClipboard';
import {
  ACTIVE_NAVIGATION_SESSION_KEY,
  getStoredNavigationItem,
  type NavigationItem
} from '../../../shared/config/navigation';
import {
  calculateMonthlyOvertimePlan,
  OVERTIME_STRATEGY_LABELS,
  type MonthlyOvertimePlan,
  type OvertimeScenario
} from '../../../shared/lib/shifts/overtimePlanner';
import {
  recordDiagnosticBreadcrumb,
  recordDiagnosticError
} from '../../../shared/lib/diagnostics';
import './MainPage.css';

const HistoryPage = lazy(() =>
  import('../../history').then((module) => ({ default: module.HistoryPage }))
);
const AnalyticsPage = lazy(() =>
  import('../../analytics').then((module) => ({ default: module.AnalyticsPage }))
);
const SchedulePage = lazy(() =>
  import('../../schedule').then((module) => ({ default: module.SchedulePage }))
);
const SettingsPage = lazy(() =>
  import('../../settings').then((module) => ({ default: module.SettingsPage }))
);

type MainPageProps = {
  settings: Settings;
  dataVersion: number;
  onSettingsChange: (settings: Settings) => Promise<void>;
  onLocalDataReplace: (settings: Settings) => void;
};

type HoldButtonProps = {
  label: string;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  onHoldStart?: () => void;
  onHoldCancel?: () => void;
  onConfirm: () => Promise<void>;
};

type CalendarMonth = {
  year: number;
  month: number;
};

type TicketEditDraft = {
  normPerEightHours: string;
  startedAt: string;
  endedAt: string;
  actualQuantity: string;
  downtimeMinutes: string;
};

type DowntimeAdjustmentMode = 'add' | 'subtract';

const createTicketEditDraft = (ticket: WorkTicket): TicketEditDraft => ({
  normPerEightHours: String(ticket.normPerEightHours),
  startedAt: getTimeInputValue(ticket.startedAt),
  endedAt: ticket.endedAt ? getTimeInputValue(ticket.endedAt) : '',
  actualQuantity: ticket.actualQuantity === null ? '' : String(ticket.actualQuantity),
  downtimeMinutes: String(ticket.downtimeMinutes)
});

const shiftRepository = new ShiftRepository(localDb);
const enterpriseScheduleRepository = new EnterpriseScheduleRepository(localDb);
const calendarTutorialRepository = new CalendarTutorialRepository(localDb);
const calendarPageIds = new Set<NavigationItem['id']>(['history', 'analytics', 'schedule']);

const getShiftTitle = (shift: Shift): string => (shift.type === 'first' ? '1 зміна' : '2 зміна');

const getTimerErrorMessage = (error: unknown): string => {
  if (error instanceof ShiftConstraintError) {
    if (error.message.includes('Active shift')) {
      return 'Активна зміна вже існує.';
    }

    if (error.message.includes('Shift already exists')) {
      return 'За цей день зміна вже створена.';
    }
  }

  return 'Не вдалося виконати дію. Спробуйте ще раз.';
};

const pageEyebrowById: Record<NavigationItem['id'], string> = {
  timer: 'Таймер',
  history: 'Історія',
  analytics: 'Аналітика',
  schedule: 'Графік',
  settings: 'Налаштування'
};

const getGreetingName = (settings: Settings): string =>
  settings.employeeFirstName.trim() || settings.employeeLastName.trim() || 'працівнику';

const getActiveWorkTicket = (shift: Shift) =>
  shift.workTickets.find((ticket) => ticket.endedAt === null) ?? null;

const getTicketErrorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : 'Не вдалося оновити тікет.';

const getTicketTargets = (
  shift: Shift,
  ticket: WorkTicket,
  endedAt: ISODateTimeString,
  settings: Settings
) => {
  const gradeSnapshot = shift.gradeSnapshot;
  const currentGrade = gradeSnapshot?.currentGrade ?? settings.currentGrade;
  const gradeNormPercents = gradeSnapshot?.gradeNormPercents ?? settings.gradeNormPercents;

  return calculateTicketProductionSummary({
    ticket,
    effectiveEndTime: endedAt,
    currentGrade,
    gradeNormPercents
  });
};

function TimerLiveMetrics({
  shift,
  incognitoEnabled
}: {
  shift: Shift;
  incognitoEnabled: boolean;
}) {
  const [liveNow, setLiveNow] = useState(() => toLocalIsoString(new Date()));

  useEffect(() => {
    setLiveNow(toLocalIsoString(new Date()));
    const intervalId = window.setInterval(() => {
      setLiveNow(toLocalIsoString(new Date()));
    }, 1_000);

    return () => window.clearInterval(intervalId);
  }, [shift.id]);

  const currentEarning = useMemo(
    () => calculateSalaryBreakdown({ ...shift, endTime: liveNow }).totalAmount,
    [liveNow, shift]
  );

  return (
    <div className="main-page__metrics main-page__metrics--active" aria-label="Поточний стан зміни">
      <article className="main-page__metric main-page__metric--money">
        <span>Зароблено зараз</span>
        <strong>{formatMoney(currentEarning, incognitoEnabled)}</strong>
      </article>
      <article className="main-page__metric">
        <span>Прихід-вихід</span>
        <strong>{formatTime(shift.startTime)} - зараз</strong>
      </article>
      <article className="main-page__metric">
        <span>Відробив</span>
        <strong>{formatDurationMinutes(getDurationMinutes(shift.startTime, liveNow))}</strong>
      </article>
      <article className="main-page__metric">
        <span>Ставка</span>
        <strong>{formatHourlyRate(shift.baseHourlyRateSnapshot, incognitoEnabled)}</strong>
      </article>
      <article className="main-page__metric">
        <span>Рівень</span>
        <strong>
          {shift.gradeSnapshot
            ? `G${shift.gradeSnapshot.currentGrade} → G${shift.gradeSnapshot.desiredGrade}`
            : 'Без snapshot'}
        </strong>
      </article>
    </div>
  );
}

function HoldButton({
  label,
  disabled = false,
  tone = 'default',
  onHoldStart,
  onHoldCancel,
  onConfirm
}: HoldButtonProps) {
  const [isHolding, setIsHolding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const isHoldActiveRef = useRef(false);
  const isSubmittingRef = useRef(false);
  const disabledRef = useRef(disabled);
  const onHoldStartRef = useRef(onHoldStart);
  const onHoldCancelRef = useRef(onHoldCancel);
  const onConfirmRef = useRef(onConfirm);

  disabledRef.current = disabled;
  onHoldStartRef.current = onHoldStart;
  onHoldCancelRef.current = onHoldCancel;
  onConfirmRef.current = onConfirm;

  const clearHoldTimer = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const cancelHold = () => {
    if (!isHoldActiveRef.current) {
      return;
    }

    clearHoldTimer();
    isHoldActiveRef.current = false;
    setIsHolding(false);
    onHoldCancelRef.current?.();
  };

  useEffect(
    () => () => {
      clearHoldTimer();

      if (isHoldActiveRef.current) {
        isHoldActiveRef.current = false;
        onHoldCancelRef.current?.();
      }
    },
    []
  );

  const startHold = () => {
    if (disabledRef.current || isSubmittingRef.current || isHoldActiveRef.current) {
      return;
    }

    isHoldActiveRef.current = true;
    setIsHolding(true);
    onHoldStartRef.current?.();
    timeoutRef.current = window.setTimeout(async () => {
      timeoutRef.current = null;

      if (!isHoldActiveRef.current) {
        return;
      }

      if (disabledRef.current) {
        cancelHold();
        return;
      }

      isHoldActiveRef.current = false;
      isSubmittingRef.current = true;
      setIsHolding(false);
      setIsSubmitting(true);

      try {
        await onConfirmRef.current();
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
      }
    }, SHIFT_HOLD_DELAY_MS);
  };

  return (
    <button
      className="main-page__hold-button"
      data-tone={tone}
      type="button"
      disabled={disabled || isSubmitting}
      aria-label={`${label}. Утримуйте ${SHIFT_HOLD_DELAY_MS / 1000} с`}
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerCancel={cancelHold}
      onPointerLeave={cancelHold}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span
        className="main-page__hold-progress"
        style={{
          transitionDuration: isHolding ? `${SHIFT_HOLD_DELAY_MS}ms` : '120ms',
          transform: isHolding ? 'scaleX(1)' : 'scaleX(0)'
        }}
      />
      <span className="main-page__hold-label">{isSubmitting ? 'Збереження...' : label}</span>
    </button>
  );
}

type ShiftNoteEditorProps = {
  initialNote: string;
  shiftId: string;
  onSave: (note: string) => Promise<void>;
};

const ShiftNoteEditor = memo(function ShiftNoteEditor({
  initialNote,
  shiftId,
  onSave
}: ShiftNoteEditorProps) {
  const [draft, setDraft] = useState(initialNote);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const previousInitialNoteRef = useRef(initialNote);
  const previousShiftIdRef = useRef(shiftId);

  useEffect(() => {
    const previousInitialNote = previousInitialNoteRef.current;
    const didShiftChange = previousShiftIdRef.current !== shiftId;

    previousInitialNoteRef.current = initialNote;
    previousShiftIdRef.current = shiftId;

    if (didShiftChange) {
      setDraft(initialNote);
      setStatus('idle');
      setError(null);
      return;
    }

    setDraft((current) => current === previousInitialNote ? initialNote : current);
  }, [initialNote, shiftId]);

  const save = async () => {
    setStatus('saving');
    setError(null);

    try {
      await onSave(draft);
      setStatus('saved');
    } catch (saveError) {
      setStatus('idle');
      setError(
        saveError instanceof Error && saveError.message
          ? saveError.message
          : 'Не вдалося зберегти нотатку.'
      );
    }
  };

  return (
    <section className="main-page__shift-note" aria-labelledby="shift-note-title">
      <div className="main-page__shift-note-heading">
        <div>
          <p className="main-page__label">Для цієї зміни</p>
          <h3 id="shift-note-title">
            <StickyNote size={18} aria-hidden="true" />
            Нотатка
          </h3>
        </div>
        <span aria-label={`${draft.length} із ${SHIFT_NOTE_MAX_LENGTH} символів`}>
          {draft.length}/{SHIFT_NOTE_MAX_LENGTH}
        </span>
      </div>
      <textarea
        aria-label="Нотатка до зміни"
        maxLength={SHIFT_NOTE_MAX_LENGTH}
        placeholder="Наприклад: номер партії, особливості зміни..."
        rows={3}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setStatus('idle');
          setError(null);
        }}
      />
      <div className="main-page__shift-note-footer">
        <p>Зберігається локально разом зі зміною.</p>
        <button
          type="button"
          disabled={status === 'saving' || draft === initialNote}
          onClick={() => void save()}
        >
          {status === 'saving'
            ? 'Збереження...'
            : status === 'saved'
              ? 'Збережено'
              : 'Зберегти'}
        </button>
      </div>
      {error ? (
        <p className="main-page__error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
});

type TicketEditFormProps = {
  isActive: boolean;
  isPending: boolean;
  ticket: WorkTicket;
  onCancel: () => void;
  onChange: () => void;
  onSave: (ticketId: string, draft: TicketEditDraft) => Promise<void>;
};

function TicketEditForm({
  isActive,
  isPending,
  ticket,
  onCancel,
  onChange,
  onSave
}: TicketEditFormProps) {
  const [draft, setDraft] = useState(() => createTicketEditDraft(ticket));

  const changeDraft = (key: keyof TicketEditDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    onChange();
  };

  const completeTimeDraft = (key: 'startedAt' | 'endedAt') => {
    setDraft((current) => ({
      ...current,
      [key]: current[key].trim() ? normalizeTimeInput(current[key]) : ''
    }));
  };

  return (
    <div className="main-page__ticket-edit-form">
      <div className="main-page__ticket-edit-header">
        <strong>Редагування тікета</strong>
        <small>Час у форматі HH:mm</small>
      </div>
      <div className="main-page__ticket-edit-fields">
        <label>
          <span>Норма, шт</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={3}
            pattern="[0-9]*"
            value={draft.normPerEightHours}
            onChange={(event) =>
              changeDraft(
                'normPerEightHours',
                normalizeWorkTicketNormDraft(event.target.value)
              )
            }
          />
        </label>
        <label>
          <span>Взято</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={5}
            pattern="[0-9]{1,2}:?[0-9]{0,2}"
            placeholder={isActive ? '06:30' : undefined}
            value={draft.startedAt}
            onBlur={() => completeTimeDraft('startedAt')}
            onChange={(event) =>
              changeDraft('startedAt', formatTimeInputDraft(event.target.value))
            }
          />
        </label>
        <label>
          <span>Завершено</span>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            maxLength={5}
            pattern="[0-9]{1,2}:?[0-9]{0,2}"
            placeholder={isActive ? 'Триває' : undefined}
            disabled={isActive}
            value={draft.endedAt}
            onBlur={() => completeTimeDraft('endedAt')}
            onChange={(event) =>
              changeDraft('endedAt', formatTimeInputDraft(event.target.value))
            }
          />
        </label>
        {!isActive ? (
          <>
            <label>
              <span>Факт, шт</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]*"
                value={draft.actualQuantity}
                placeholder="Не внесено"
                onChange={(event) =>
                  changeDraft('actualQuantity', event.target.value.replace(/\D/g, ''))
                }
              />
            </label>
            <label>
              <span>Простій, хв</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                pattern="[0-9]*"
                value={draft.downtimeMinutes}
                onChange={(event) =>
                  changeDraft('downtimeMinutes', event.target.value.replace(/\D/g, ''))
                }
              />
            </label>
          </>
        ) : null}
      </div>
      <div className="main-page__ticket-edit-actions">
        <button
          className="main-page__ticket-edit-save"
          type="button"
          disabled={isPending}
          onClick={() => void onSave(ticket.id, draft)}
        >
          <Check size={15} aria-hidden="true" />
          <span>Зберегти</span>
        </button>
        <button type="button" disabled={isPending} onClick={onCancel}>
          <X size={15} aria-hidden="true" />
          <span>Скасувати</span>
        </button>
      </div>
    </div>
  );
}

type OvertimePlannerCardProps = {
  plan: MonthlyOvertimePlan;
  settings: Settings;
  selectedShiftType: ShiftType;
  canSelectShiftType: boolean;
  onShiftTypeChange: (type: ShiftType) => void;
  onStrategyChange: (strategy: OvertimeStrategy) => Promise<void>;
  onDateUnavailable: (date: string) => Promise<void>;
  onOpenSettings: () => void;
};

const formatScenarioIncome = (
  scenario: OvertimeScenario,
  incognitoEnabled: boolean
): string => {
  if (incognitoEnabled) {
    return formatMoney(0, true);
  }

  const minimum = formatMoney(scenario.projectedIncomeMin, false);
  const maximum = formatMoney(scenario.projectedIncomeMax, false);

  return Math.round(scenario.projectedIncomeMin) === Math.round(scenario.projectedIncomeMax)
    ? minimum
    : `${minimum} – ${maximum}`;
};

const OvertimePlannerCard = memo(function OvertimePlannerCard({
  plan,
  settings,
  selectedShiftType,
  canSelectShiftType,
  onShiftTypeChange,
  onStrategyChange,
  onDateUnavailable,
  onOpenSettings
}: OvertimePlannerCardProps) {
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [isSavingStrategy, setIsSavingStrategy] = useState(false);
  const [strategyError, setStrategyError] = useState<string | null>(null);
  const [isSkippingDate, setIsSkippingDate] = useState(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);
  const isIncomeHidden = settings.incognitoEnabled;
  const earnedPercent =
    isIncomeHidden
      ? 0
      : plan.maximumAmount > 0
        ? Math.min(100, Math.max(0, (plan.earnedAmount / plan.maximumAmount) * 100))
        : plan.earnedAmount > 0
          ? 100
          : 0;
  const isOverMaximum =
    !isIncomeHidden && plan.earnedAmount > plan.maximumAmount;
  const accessibleMaximum = isIncomeHidden ? 100 : Math.max(1, plan.maximumAmount);
  const accessibleValue = isIncomeHidden
    ? 0
    : plan.maximumAmount > 0
      ? Math.min(plan.earnedAmount, plan.maximumAmount)
      : plan.earnedAmount > 0
        ? 1
      : 0;
  const shiftTypeSelector = canSelectShiftType ? (
    <div className="main-page__shift-type-selector">
      <span>Зміна для рекомендації</span>
      <div role="group" aria-label="Вибір зміни перед стартом">
        {(['first', 'second'] as const).map((type) => (
          <button
            type="button"
            aria-pressed={selectedShiftType === type}
            data-selected={selectedShiftType === type ? 'true' : 'false'}
            key={type}
            onClick={() => onShiftTypeChange(type)}
          >
            {type === 'first' ? '1 зміна' : '2 зміна'}
          </button>
        ))}
      </div>
    </div>
  ) : null;

  const selectStrategy = async (strategy: OvertimeStrategy) => {
    if (strategy === settings.overtimeStrategy) {
      setIsOptionsOpen(false);
      return;
    }

    setIsSavingStrategy(true);
    setStrategyError(null);

    try {
      await onStrategyChange(strategy);
      setIsOptionsOpen(false);
    } catch (error) {
      recordDiagnosticError('settings.save_failed', 'timer', error);
      setStrategyError('Не вдалося змінити стратегію.');
    } finally {
      setIsSavingStrategy(false);
    }
  };

  const skipRecommendationDate = async () => {
    if (!plan.recommendation.date) {
      return;
    }

    setIsSkippingDate(true);
    setAvailabilityError(null);

    try {
      await onDateUnavailable(plan.recommendation.date);
    } catch (error) {
      recordDiagnosticError('settings.save_failed', 'timer', error);
      setAvailabilityError('Не вдалося виключити цю дату.');
    } finally {
      setIsSkippingDate(false);
    }
  };

  if (settings.overtimeLimitPercent === 0) {
    return (
      <section className="main-page__overtime-card main-page__overtime-card--disabled">
        <div>
          <p className="main-page__label">Перепрацювання</p>
          <h3>Планувальник вимкнено</h3>
          <p>Вкажіть відсоток ліміту, щоб отримувати рекомендації на місяць.</p>
        </div>
        <button type="button" onClick={onOpenSettings}>
          Налаштувати
        </button>
      </section>
    );
  }

  const recommendationStatus =
    plan.exceededMinutes > 0
      ? `Ліміт перевищено на ${formatShortMinuteDuration(plan.exceededMinutes)}`
      : plan.recommendation.kind === 'rest' || plan.recommendation.minutes === 0
        ? plan.recommendation.isToday
          ? 'Сьогодні без запланованого перепрацювання'
          : 'До кінця місяця немає наступної доступної дати'
        : null;
  const hasRecommendedShift =
    recommendationStatus === null &&
    plan.recommendation.date !== null &&
    plan.recommendation.recommendedStartAt !== null &&
    plan.recommendation.recommendedEndAt !== null;
  const recommendationEndsNextDay =
    hasRecommendedShift && plan.recommendation.date
      ? getDateFromDateTime(
          toLocalIsoString(new Date(plan.recommendation.recommendedEndAt!))
        ) > plan.recommendation.date
      : false;
  return (
    <section
      className="main-page__overtime-card"
      data-over-limit={plan.exceededMinutes > 0 ? 'true' : 'false'}
      aria-labelledby="overtime-plan-title"
    >
      <div className="main-page__overtime-heading">
        <div className="main-page__overtime-title">
          <span className="main-page__overtime-title-icon" aria-hidden="true">
            <Clock3 size={19} />
          </span>
          <p className="main-page__label">Перепрацювання</p>
        </div>
        <h3 className="main-page__overtime-strategy" id="overtime-plan-title">
          {OVERTIME_STRATEGY_LABELS[settings.overtimeStrategy]}
        </h3>
      </div>

      <div
        className="main-page__money-panel"
        data-incognito={isIncomeHidden ? 'true' : 'false'}
      >
        <div className="main-page__money-progress-heading">
          <span>Зароблено цього місяця</span>
          <strong>{formatMoney(plan.earnedAmount, isIncomeHidden)}</strong>
          {isOverMaximum ? <small>Вище розрахункового максимуму</small> : null}
        </div>
        <div className="main-page__money-scale">
          <div
            className="main-page__money-progress"
            data-incognito={isIncomeHidden ? 'true' : 'false'}
            data-over-maximum={isOverMaximum ? 'true' : 'false'}
            role="progressbar"
            aria-label="Прогрес заробітку за місяць"
            aria-valuemin={0}
            aria-valuemax={accessibleMaximum}
            aria-valuenow={accessibleValue}
            aria-valuetext={
              isIncomeHidden
                ? formatMoney(0, true)
                : `${formatMoney(plan.earnedAmount, false)} з ${formatMoney(plan.maximumAmount, false)}`
            }
          >
            <span
              className="main-page__money-progress-fill"
              style={{ width: `${earnedPercent}%` }}
            />
            <span
              className="main-page__money-progress-earned-marker"
              style={{ left: `${earnedPercent}%` }}
              aria-hidden="true"
            />
          </div>
          <div className="main-page__money-progress-labels">
            <span aria-label={`Початок шкали: ${formatMoney(0, isIncomeHidden)}`}>
              <strong>{formatMoney(0, isIncomeHidden)}</strong>
            </span>
            <span
              aria-label={`Максимум шкали: ${formatMoney(plan.maximumAmount, isIncomeHidden)}`}
            >
              <strong>{formatMoney(plan.maximumAmount, isIncomeHidden)}</strong>
            </span>
          </div>
        </div>
      </div>

      <dl className="main-page__overtime-metrics">
        <div>
          <dt>План місяця</dt>
          <dd>{formatDurationMinutes(plan.plannedMinutes)}</dd>
        </div>
        <div>
          <dt>Відпрацьовано</dt>
          <dd>{formatDurationMinutes(plan.workedMinutes)}</dd>
        </div>
        <div>
          <dt>Ліміт</dt>
          <dd>{formatDurationMinutes(plan.limitMinutes)}</dd>
        </div>
        <div>
          <dt>Використано</dt>
          <dd>{formatDurationMinutes(plan.usedMinutes)}</dd>
        </div>
        <div>
          <dt>Залишилось</dt>
          <dd>{formatDurationMinutes(plan.remainingMinutes)}</dd>
        </div>
      </dl>

      <div className="main-page__overtime-guidance">
        {shiftTypeSelector}
        {hasRecommendedShift ? (
          <div className="main-page__overtime-next-shift">
            <div className="main-page__overtime-next-shift-header">
              <span>
                <CalendarClock size={15} aria-hidden="true" />
                {plan.recommendation.isToday
                  ? 'Рекомендація на сьогодні'
                  : 'Наступна рекомендована зміна'}
              </span>
              <strong>{formatDate(plan.recommendation.date!)}</strong>
            </div>
            <div
              className="main-page__overtime-time-range"
              aria-label={`Рекомендований час: з ${formatTime(
                plan.recommendation.recommendedStartAt!
              )} до ${formatTime(plan.recommendation.recommendedEndAt!)}`}
            >
              <time dateTime={plan.recommendation.recommendedStartAt!}>
                {formatTime(plan.recommendation.recommendedStartAt!)}
              </time>
              <span aria-hidden="true">
                <ArrowRight size={20} />
              </span>
              <time dateTime={plan.recommendation.recommendedEndAt!}>
                {formatTime(plan.recommendation.recommendedEndAt!)}
              </time>
              {recommendationEndsNextDay ? <small>+1 день</small> : null}
            </div>
            <dl className="main-page__overtime-shift-summary">
              <div>
                <dt>Всього часу</dt>
                <dd>{formatDurationMinutes(plan.recommendation.totalMinutes)}</dd>
              </div>
              <div>
                <dt>Перепрацювання</dt>
                <dd>{formatDurationMinutes(plan.recommendation.minutes)}</dd>
              </div>
            </dl>
            <button
              className="main-page__overtime-skip-date"
              type="button"
              disabled={isSkippingDate}
              onClick={() => void skipRecommendationDate()}
            >
              <X size={15} aria-hidden="true" />
              {isSkippingDate ? 'Оновлення…' : 'Цей день недоступний'}
            </button>
          </div>
        ) : (
          <div className="main-page__overtime-recommendation-status">
            <Clock3 size={20} aria-hidden="true" />
            <strong>{recommendationStatus}</strong>
          </div>
        )}

      </div>

      {availabilityError ? (
        <p className="main-page__error" role="alert">
          {availabilityError}
        </p>
      ) : null}

      <div className="main-page__overtime-actions">
        <button type="button" onClick={() => setIsOptionsOpen(true)}>
          <SlidersHorizontal size={16} aria-hidden="true" />
          Інші варіанти
        </button>
      </div>

      {isOptionsOpen ? (
        <div className="main-page__overtime-modal-overlay" role="presentation">
          <section
            className="main-page__overtime-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="overtime-options-title"
          >
            <header>
              <div>
                <p className="main-page__label">До кінця місяця</p>
                <h3 id="overtime-options-title">Варіанти перепрацювань</h3>
              </div>
              <button
                type="button"
                aria-label="Закрити варіанти перепрацювань"
                onClick={() => setIsOptionsOpen(false)}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <div className="main-page__overtime-scenarios">
              {plan.scenarios.map((scenario) => (
                <button
                  type="button"
                  data-selected={scenario.strategy === settings.overtimeStrategy ? 'true' : 'false'}
                  disabled={isSavingStrategy}
                  key={scenario.strategy}
                  onClick={() => void selectStrategy(scenario.strategy)}
                >
                  <span>
                    <strong>{OVERTIME_STRATEGY_LABELS[scenario.strategy]}</strong>
                    <small>
                      Будні {formatShortMinuteDuration(scenario.weekdayMinutes)} · суботи{' '}
                      {formatShortMinuteDuration(scenario.saturdayMinutes)}
                    </small>
                  </span>
                  <span>{formatScenarioIncome(scenario, settings.incognitoEnabled)}</span>
                  {scenario.unallocatedMinutes > 0 ? (
                    <small>
                      {scenario.unallocatedMinutes < settings.overtimeStepMinutes
                        ? `Залишок менший за крок ${formatShortMinuteDuration(settings.overtimeStepMinutes)}`
                        : `Не розподілено ${formatShortMinuteDuration(scenario.unallocatedMinutes)}`}
                    </small>
                  ) : null}
                </button>
              ))}
            </div>
            {strategyError ? (
              <p className="main-page__error" role="alert">
                {strategyError}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
});

export function MainPage({
  settings,
  dataVersion,
  onSettingsChange,
  onLocalDataReplace
}: MainPageProps) {
  const [activePage, setActivePage] = useState<NavigationItem['id']>(() =>
    getStoredNavigationItem(
      typeof window === 'undefined' ? null : window.sessionStorage
    )
  );
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [overtimeMonthShifts, setOvertimeMonthShifts] = useState<Shift[]>([]);
  const [preferredShiftType, setPreferredShiftType] = useState<ShiftType | null>(null);
  const [now, setNow] = useState(() => toLocalIsoString(new Date()));
  const [isLoadingShift, setIsLoadingShift] = useState(true);
  const [timerError, setTimerError] = useState<string | null>(null);
  const [ticketNormDraft, setTicketNormDraft] = useState('');
  const [editingTicketId, setEditingTicketId] = useState<string | null>(null);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [isAddingTicket, setIsAddingTicket] = useState(false);
  const [pendingTicketId, setPendingTicketId] = useState<string | null>(null);
  const [isTicketMenuOpen, setIsTicketMenuOpen] = useState(false);
  const [openCompletedTicketMenuId, setOpenCompletedTicketMenuId] = useState<string | null>(null);
  const [isDowntimeModalOpen, setIsDowntimeModalOpen] = useState(false);
  const [downtimeAdjustmentMode, setDowntimeAdjustmentMode] =
    useState<DowntimeAdjustmentMode>('add');
  const [ticketActualDraft, setTicketActualDraft] = useState('');
  const [downtimeAdjustmentDraft, setDowntimeAdjustmentDraft] = useState('');
  const [downtimeModalError, setDowntimeModalError] = useState<string | null>(null);
  const [isCompletionModalOpen, setIsCompletionModalOpen] = useState(false);
  const [completionModalError, setCompletionModalError] = useState<string | null>(null);
  const [isCompletingTicket, setIsCompletingTicket] = useState(false);
  const [clipboardNotice, setClipboardNotice] = useState<{
    tone: 'success' | 'warning';
    message: string;
    text: string;
  } | null>(null);
  const [isRetryingClipboard, setIsRetryingClipboard] = useState(false);
  const [isTogglingIncognito, setIsTogglingIncognito] = useState(false);
  const [dataRevision, setDataRevision] = useState(0);
  const [sharedCalendarMonth, setSharedCalendarMonth] = useState<CalendarMonth>(getCurrentMonth);
  const [sharedCalendarRange, setSharedCalendarRange] = useState<CalendarDateRange | null>(
    () => getSingleDateRange(getLocalDateKey(new Date()))
  );
  const [allTimeRange, setAllTimeRange] = useState<CalendarDateRange | null>(null);
  const [activeCalendarRangePreset, setActiveCalendarRangePreset] =
    useState<CalendarRangePreset | null>('today');
  const [isCalendarTutorialOpen, setIsCalendarTutorialOpen] = useState(false);
  const calendarTutorialCheckRef = useRef(false);
  const calendarTutorialDismissedRef = useRef(false);
  const ticketMenuRef = useRef<HTMLDivElement | null>(null);
  const ticketMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const completedTicketMenuRef = useRef<HTMLDivElement | null>(null);
  const completedTicketMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const downtimeInputRef = useRef<HTMLInputElement | null>(null);
  const completeTicketButtonRef = useRef<HTMLButtonElement | null>(null);
  const actualQuantityInputRef = useRef<HTMLInputElement | null>(null);
  const preparedLeaveClipboardRef = useRef<PreparedTextClipboardWrite | null>(null);
  const releaseClipboardTextRef = useRef<string | null>(null);
  const releaseClipboardCleanupRef = useRef<(() => void) | null>(null);
  const externalDataVersionRef = useRef(dataVersion);
  const currentMonthKey = now.slice(0, 7);

  const clearReleaseClipboardListener = useCallback(() => {
    const cleanup = releaseClipboardCleanupRef.current;
    releaseClipboardCleanupRef.current = null;
    cleanup?.();
  }, []);

  const notifyLocalDataChange = useCallback(() => {
    setDataRevision((current) => current + 1);
  }, []);

  useEffect(() => {
    if (externalDataVersionRef.current === dataVersion) {
      return;
    }

    externalDataVersionRef.current = dataVersion;
    setDataRevision((current) => current + 1);
  }, [dataVersion]);

  useEffect(
    () => () => {
      preparedLeaveClipboardRef.current?.cancel();
      preparedLeaveClipboardRef.current = null;
      releaseClipboardTextRef.current = null;
      clearReleaseClipboardListener();
    },
    [clearReleaseClipboardListener]
  );

  const dismissCalendarTutorial = useCallback(() => {
    calendarTutorialDismissedRef.current = true;
    setIsCalendarTutorialOpen(false);
    void calendarTutorialRepository.markSeen(toLocalIsoString(new Date())).catch(() => undefined);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    recordDiagnosticBreadcrumb('navigation.changed', activePage);
  }, [activePage]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(ACTIVE_NAVIGATION_SESSION_KEY, activePage);
    } catch {
      // Навігація продовжує працювати, навіть якщо сховище браузера недоступне.
    }
  }, [activePage]);

  useEffect(() => {
    if (
      !calendarPageIds.has(activePage) ||
      calendarTutorialCheckRef.current ||
      calendarTutorialDismissedRef.current
    ) {
      return;
    }

    let isMounted = true;
    calendarTutorialCheckRef.current = true;

    calendarTutorialRepository
      .hasSeen()
      .then((hasSeen) => {
        if (isMounted && !hasSeen && !calendarTutorialDismissedRef.current) {
          setIsCalendarTutorialOpen(true);
        }
      })
      .catch(() => {
        if (isMounted && !calendarTutorialDismissedRef.current) {
          setIsCalendarTutorialOpen(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [activePage]);

  useEffect(() => {
    if (activePage !== 'timer') {
      return;
    }

    let isMounted = true;

    const loadTimerData = async () => {
      try {
        const [year, month] = currentMonthKey.split('-').map(Number);
        const [shift, monthShifts] = await Promise.all([
          getActiveShift(shiftRepository),
          getShiftsByMonth(shiftRepository, year, month)
        ]);

        if (isMounted) {
          setActiveShift(shift);
          setOvertimeMonthShifts(monthShifts);
        }
      } catch (error) {
        recordDiagnosticError('timer.load_failed', 'timer', error);
        if (isMounted) {
          setTimerError('Не вдалося прочитати активну зміну.');
        }
      } finally {
        if (isMounted) {
          setIsLoadingShift(false);
        }
      }
    };

    void loadTimerData();

    return () => {
      isMounted = false;
    };
  }, [activePage, currentMonthKey, dataRevision]);

  useEffect(() => {
    if (activeCalendarRangePreset !== 'all') {
      return;
    }

    setSharedCalendarRange(allTimeRange);

    if (!allTimeRange) {
      setActiveCalendarRangePreset(null);
    }
  }, [activeCalendarRangePreset, allTimeRange]);

  useEffect(() => {
    if (!calendarPageIds.has(activePage)) {
      return;
    }

    let isMounted = true;

    getLocalDataDateBounds(shiftRepository, enterpriseScheduleRepository)
      .then((bounds) => {
        if (isMounted) {
          const nextRange = bounds ? { start: bounds.start, end: bounds.end } : null;

          setAllTimeRange((currentRange) =>
            currentRange?.start === nextRange?.start && currentRange?.end === nextRange?.end
              ? currentRange
              : nextRange
          );
        }
      })
      .catch(() => {
        if (isMounted) {
          setAllTimeRange((currentRange) => currentRange === null ? currentRange : null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [activePage, dataRevision]);

  useEffect(() => {
    if (activePage !== 'timer') {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(toLocalIsoString(new Date()));
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [activePage]);

  const selectedShiftType = preferredShiftType ?? detectShiftType(now);
  const overtimePlan = useMemo(
    () =>
      calculateMonthlyOvertimePlan({
        shifts: overtimeMonthShifts,
        now,
        monthlySalary: settings.monthlySalary,
        monthlyBonus: settings.monthlyBonus,
        currentGrade: settings.currentGrade,
        gradeSalaryBonusPercents: settings.gradeSalaryBonusPercents,
        overtimeLimitPercent: settings.overtimeLimitPercent,
        overtimeStepMinutes: settings.overtimeStepMinutes,
        overtimeStrategy: settings.overtimeStrategy,
        overtimeWeekdayMaxMinutes: settings.overtimeWeekdayMaxMinutes,
        overtimeSaturdayMaxMinutes: settings.overtimeSaturdayMaxMinutes,
        overtimeUnavailableDates: settings.overtimeUnavailableDates,
        preferredShiftType: selectedShiftType
      }),
    [
      now,
      overtimeMonthShifts,
      settings.monthlySalary,
      settings.monthlyBonus,
      settings.currentGrade,
      settings.gradeSalaryBonusPercents,
      settings.overtimeLimitPercent,
      settings.overtimeStepMinutes,
      settings.overtimeWeekdayMaxMinutes,
      settings.overtimeSaturdayMaxMinutes,
      settings.overtimeUnavailableDates,
      settings.overtimeStrategy,
      selectedShiftType
    ]
  );
  const currentCoefficient = activeShift
    ? getEffectiveCoefficient(activeShift, now)
    : null;
  const activeWorkTicket = activeShift ? getActiveWorkTicket(activeShift) : null;
  const activeTicketTargets = useMemo(() => {
    if (!activeShift || !activeWorkTicket) {
      return null;
    }

    return getTicketTargets(activeShift, activeWorkTicket, now, settings);
  }, [activeShift, activeWorkTicket, now, settings.currentGrade, settings.desiredGrade, settings.gradeNormPercents]);
  const availableDowntimeAdjustmentMinutes = useMemo(() => {
    if (!activeWorkTicket) {
      return 0;
    }

    if (downtimeAdjustmentMode === 'subtract') {
      return activeWorkTicket.downtimeMinutes;
    }

    return Math.max(
      0,
      getDurationMinutes(activeWorkTicket.startedAt, now) - activeWorkTicket.downtimeMinutes
    );
  }, [activeWorkTicket, downtimeAdjustmentMode, now]);
  const completedTicketTargets = useMemo(() => {
    if (!activeShift) {
      return [];
    }

    const completed: Array<{
      ticket: WorkTicket & { endedAt: ISODateTimeString };
      ticketNumber: number;
      targets: ReturnType<typeof getTicketTargets>;
    }> = [];

    activeShift.workTickets.forEach((ticket, index) => {
      if (ticket.endedAt !== null) {
        completed.push({
          ticket: ticket as WorkTicket & { endedAt: ISODateTimeString },
          ticketNumber: index + 1,
          targets: getTicketTargets(activeShift, ticket, ticket.endedAt, settings)
        });
      }
    });

    return completed.reverse();
  }, [activeShift, settings.currentGrade, settings.desiredGrade, settings.gradeNormPercents]);

  useEffect(() => {
    setTicketActualDraft('');
    setDowntimeAdjustmentDraft('');
    setIsTicketMenuOpen(false);
    setOpenCompletedTicketMenuId(null);
    setIsDowntimeModalOpen(false);
    setDowntimeAdjustmentMode('add');
    setDowntimeModalError(null);
    setIsCompletionModalOpen(false);
    setCompletionModalError(null);
  }, [activeWorkTicket?.id]);

  useEffect(() => {
    if (!isTicketMenuOpen) {
      return;
    }

    const closeMenuOnPointerDown = (event: PointerEvent) => {
      if (!ticketMenuRef.current?.contains(event.target as Node)) {
        setIsTicketMenuOpen(false);
      }
    };
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsTicketMenuOpen(false);
        ticketMenuButtonRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', closeMenuOnPointerDown);
    document.addEventListener('keydown', closeMenuOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeMenuOnPointerDown);
      document.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [isTicketMenuOpen]);

  useEffect(() => {
    if (openCompletedTicketMenuId === null) {
      return;
    }

    const closeMenuOnPointerDown = (event: PointerEvent) => {
      if (!completedTicketMenuRef.current?.contains(event.target as Node)) {
        setOpenCompletedTicketMenuId(null);
      }
    };
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenCompletedTicketMenuId(null);
        completedTicketMenuButtonRef.current?.focus();
      }
    };

    document.addEventListener('pointerdown', closeMenuOnPointerDown);
    document.addEventListener('keydown', closeMenuOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeMenuOnPointerDown);
      document.removeEventListener('keydown', closeMenuOnEscape);
    };
  }, [openCompletedTicketMenuId]);

  useEffect(() => {
    if (!isDowntimeModalOpen && !isCompletionModalOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const closeModalOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || pendingTicketId !== null || isCompletingTicket) {
        return;
      }

      if (isDowntimeModalOpen) {
        setIsDowntimeModalOpen(false);
        setDowntimeAdjustmentDraft('');
        setDowntimeModalError(null);
        ticketMenuButtonRef.current?.focus();
      } else {
        setIsCompletionModalOpen(false);
        setTicketActualDraft('');
        setCompletionModalError(null);
        completeTicketButtonRef.current?.focus();
      }
    };

    document.addEventListener('keydown', closeModalOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', closeModalOnEscape);
    };
  }, [isCompletionModalOpen, isCompletingTicket, isDowntimeModalOpen, pendingTicketId]);

  useEffect(() => {
    if (isDowntimeModalOpen) {
      downtimeInputRef.current?.focus();
    }
  }, [isDowntimeModalOpen]);

  useEffect(() => {
    if (isCompletionModalOpen) {
      actualQuantityInputRef.current?.focus();
    }
  }, [isCompletionModalOpen]);

  const toggleIncognito = async () => {
    setTimerError(null);
    setIsTogglingIncognito(true);

    try {
      await onSettingsChange({
        ...settings,
        incognitoEnabled: !settings.incognitoEnabled,
        updatedAt: toLocalIsoString(new Date())
      });
    } catch (error) {
      recordDiagnosticError('timer.incognito_failed', 'timer', error);
      setTimerError('Не вдалося змінити режим інкогніто.');
    } finally {
      setIsTogglingIncognito(false);
    }
  };

  const arrive = async () => {
    setTimerError(null);
    setClipboardNotice(null);
    const startedAt = toLocalIsoString(new Date());
    const startedDate = getDateFromDateTime(startedAt);
    const baseHourlyRate = calculateHourlyRateFromMonthlySalary(
      settings.monthlySalary,
      startedDate
    );
    recordDiagnosticBreadcrumb('timer.shift_start_started', 'timer');

    try {
      const createdShift = await createShift(shiftRepository, {
        startTime: startedAt,
        type: selectedShiftType,
        baseHourlyRateSnapshot: baseHourlyRate,
        hourlyRateSnapshot: baseHourlyRate,
        gradeSnapshot: createGradeSnapshot(settings),
        now: startedAt
      });

      setNow(startedAt);
      setActiveShift(createdShift);
      setOvertimeMonthShifts((current) => [
        ...current.filter((shift) => shift.id !== createdShift.id),
        createdShift
      ]);
      setPreferredShiftType(null);
      setTicketNormDraft('');
      setTicketError(null);
      recordDiagnosticBreadcrumb('timer.shift_start_completed', 'timer');
    } catch (error) {
      if (!(error instanceof ShiftConstraintError)) {
        recordDiagnosticError('timer.shift_start_failed', 'timer', error);
      }
      setTimerError(getTimerErrorMessage(error));
    }
  };

  const showClipboardResult = useCallback((clipboardText: string, didCopy: boolean) => {
    setClipboardNotice((current) => {
      if (!didCopy && current?.text === clipboardText && current.tone === 'success') {
        return current;
      }

      return {
        tone: didCopy ? 'success' : 'warning',
        message: didCopy
          ? `Скопійовано: ${clipboardText}`
          : `Зміну завершено, але текст не скопійовано: ${clipboardText}`,
        text: clipboardText
      };
    });
  }, []);

  const prepareLeaveClipboard = () => {
    preparedLeaveClipboardRef.current?.cancel();
    releaseClipboardTextRef.current = null;
    clearReleaseClipboardListener();
    preparedLeaveClipboardRef.current = prepareTextClipboardWrite();

    const handleRelease = () => {
      const clipboardText = releaseClipboardTextRef.current;
      releaseClipboardTextRef.current = null;
      clearReleaseClipboardListener();

      if (!clipboardText) {
        return;
      }

      void copyTextToClipboardFromUserGesture(clipboardText).then((didCopy) => {
        recordDiagnosticBreadcrumb(
          didCopy
            ? 'timer.shift_clipboard_release_completed'
            : 'timer.shift_clipboard_release_failed',
          'timer'
        );
        showClipboardResult(clipboardText, didCopy);
      });
    };
    const handleReleaseCancel = () => {
      clearReleaseClipboardListener();
    };

    document.addEventListener('pointerup', handleRelease, true);
    document.addEventListener('touchend', handleRelease, true);
    document.addEventListener('pointercancel', handleReleaseCancel, true);
    document.addEventListener('touchcancel', handleReleaseCancel, true);
    releaseClipboardCleanupRef.current = () => {
      document.removeEventListener('pointerup', handleRelease, true);
      document.removeEventListener('touchend', handleRelease, true);
      document.removeEventListener('pointercancel', handleReleaseCancel, true);
      document.removeEventListener('touchcancel', handleReleaseCancel, true);
    };
  };

  const cancelPreparedLeaveClipboard = () => {
    preparedLeaveClipboardRef.current?.cancel();
    preparedLeaveClipboardRef.current = null;
    releaseClipboardTextRef.current = null;
    clearReleaseClipboardListener();
  };

  const leave = async () => {
    const preparedClipboardWrite = preparedLeaveClipboardRef.current;
    preparedLeaveClipboardRef.current = null;

    if (!activeShift) {
      preparedClipboardWrite?.cancel();
      return;
    }

    if (activeWorkTicket) {
      preparedClipboardWrite?.cancel();
      setTimerError('Спершу завершіть активний тікет і внесіть фактичну кількість.');
      return;
    }

    setTimerError(null);
    const finishedAt = toLocalIsoString(new Date());
    const clipboardText = formatShiftClipboardText(settings, {
      ...activeShift,
      endTime: finishedAt
    });
    releaseClipboardTextRef.current = clipboardText;
    recordDiagnosticBreadcrumb('timer.shift_finish_started', 'timer');

    try {
      const updatePromise = updateShift(shiftRepository, {
        ...activeShift,
        endTime: finishedAt,
        updatedAt: finishedAt
      });
      const copyPromise = preparedClipboardWrite
        ? updatePromise.then(async () => {
            const didPreparedCopy = await preparedClipboardWrite.complete(clipboardText);
            return didPreparedCopy || copyTextToClipboard(clipboardText);
          })
        : copyTextToClipboard(clipboardText);
      const [didCopy, completedShift] = await Promise.all([copyPromise, updatePromise]);

      setNow(finishedAt);
      setActiveShift(completedShift.endTime === null ? completedShift : null);
      setOvertimeMonthShifts((current) =>
        current.map((shift) => (shift.id === completedShift.id ? completedShift : shift))
      );
      setTicketNormDraft('');
      setTicketError(null);

      if (completedShift.endTime !== null) {
        recordDiagnosticBreadcrumb(
          didCopy ? 'timer.shift_clipboard_completed' : 'timer.shift_clipboard_failed',
          'timer'
        );
        showClipboardResult(clipboardText, didCopy);
      }
      recordDiagnosticBreadcrumb('timer.shift_finish_completed', 'timer');
    } catch (error) {
      preparedClipboardWrite?.cancel();
      if (!(error instanceof ShiftConstraintError)) {
        recordDiagnosticError('timer.shift_finish_failed', 'timer', error);
      }
      setTimerError(getTimerErrorMessage(error));
    }
  };

  const retryClipboardCopy = async () => {
    const clipboardText = clipboardNotice?.text;

    if (!clipboardText || isRetryingClipboard) {
      return;
    }

    setIsRetryingClipboard(true);

    try {
      const didCopy = await copyTextToClipboardFromUserGesture(clipboardText);
      recordDiagnosticBreadcrumb(
        didCopy
          ? 'timer.shift_clipboard_retry_completed'
          : 'timer.shift_clipboard_retry_failed',
        'timer'
      );
      showClipboardResult(clipboardText, didCopy);
    } finally {
      setIsRetryingClipboard(false);
    }
  };

  const saveShiftNote = useCallback(async (note: string) => {
    if (!activeShift) {
      throw new Error('Активну зміну не знайдено.');
    }

    try {
      const updatedShift = await updateActiveShiftNote(shiftRepository, {
        shiftId: activeShift.id,
        note,
        updatedAt: toLocalIsoString(new Date())
      });

      setActiveShift(updatedShift);
    } catch (error) {
      recordDiagnosticError('timer.note_save_failed', 'timer', error);
      throw error;
    }
  }, [activeShift]);

  const parseTicketNormDraft = (value: string): number | null => {
    const normPerEightHours = Number(value);

    if (!isValidWorkTicketNorm(normPerEightHours)) {
      setTicketError('Норма має бути більшою за 0 і не більшою за 999.');
      return null;
    }

    return normPerEightHours;
  };

  const addTicket = async () => {
    if (!activeShift) {
      return;
    }

    const normPerEightHours = parseTicketNormDraft(ticketNormDraft);

    if (normPerEightHours === null) {
      return;
    }

    const startedAt = toLocalIsoString(new Date());

    setIsAddingTicket(true);
    setTicketError(null);
    recordDiagnosticBreadcrumb('ticket.create_started', 'timer');

    try {
      const updatedShift = await addWorkTicketToActiveShift(shiftRepository, {
        shiftId: activeShift.id,
        normPerEightHours,
        startedAt
      });

      setNow(startedAt);
      setActiveShift(updatedShift);
      setTicketNormDraft('');
      recordDiagnosticBreadcrumb('ticket.create_completed', 'timer');
    } catch (error) {
      recordDiagnosticError('ticket.create_failed', 'timer', error);
      setTicketError(getTicketErrorMessage(error));
    } finally {
      setIsAddingTicket(false);
    }
  };

  const openDowntimeModal = () => {
    setIsTicketMenuOpen(false);
    setDowntimeAdjustmentMode('add');
    setDowntimeAdjustmentDraft('');
    setDowntimeModalError(null);
    setIsDowntimeModalOpen(true);
  };

  const closeDowntimeModal = () => {
    if (pendingTicketId !== null) {
      return;
    }

    setIsDowntimeModalOpen(false);
    setDowntimeAdjustmentDraft('');
    setDowntimeModalError(null);
    window.setTimeout(() => ticketMenuButtonRef.current?.focus(), 0);
  };

  const openCompletionModal = () => {
    setTicketActualDraft('');
    setCompletionModalError(null);
    setIsCompletionModalOpen(true);
  };

  const closeCompletionModal = () => {
    if (isCompletingTicket) {
      return;
    }

    setIsCompletionModalOpen(false);
    setTicketActualDraft('');
    setCompletionModalError(null);
    window.setTimeout(() => completeTicketButtonRef.current?.focus(), 0);
  };

  const addTicketDowntimeAdjustment = async () => {
    if (!activeShift || !activeWorkTicket) {
      return;
    }

    const adjustmentMinutes = Number(downtimeAdjustmentDraft);

    if (!Number.isSafeInteger(adjustmentMinutes) || adjustmentMinutes <= 0) {
      setDowntimeModalError('Вкажіть цілу кількість хвилин, більшу за 0.');
      return;
    }

    if (adjustmentMinutes > availableDowntimeAdjustmentMinutes) {
      setDowntimeModalError(
        downtimeAdjustmentMode === 'add'
          ? `Можна додати не більше ${availableDowntimeAdjustmentMinutes} хв.`
          : `Можна відняти не більше ${availableDowntimeAdjustmentMinutes} хв.`
      );
      return;
    }

    const deltaMinutes = downtimeAdjustmentMode === 'subtract'
      ? -adjustmentMinutes
      : adjustmentMinutes;
    const changedAt = toLocalIsoString(new Date());
    setPendingTicketId(activeWorkTicket.id);
    setDowntimeModalError(null);

    try {
      const updatedShift = await adjustWorkTicketDowntime(shiftRepository, {
        shiftId: activeShift.id,
        deltaMinutes,
        updatedAt: changedAt
      });

      setNow(changedAt);
      setActiveShift(updatedShift);
      setDowntimeAdjustmentDraft('');
      setIsDowntimeModalOpen(false);
      window.setTimeout(() => ticketMenuButtonRef.current?.focus(), 0);
    } catch (error) {
      recordDiagnosticError('ticket.downtime_failed', 'timer', error);
      setDowntimeModalError(getTicketErrorMessage(error));
    } finally {
      setPendingTicketId(null);
    }
  };

  const finishActiveTicket = async () => {
    if (!activeShift || !activeWorkTicket || !activeTicketTargets) {
      return;
    }

    if (ticketActualDraft.trim() === '') {
      setCompletionModalError('Вкажіть цілу фактичну кількість від 0.');
      return;
    }

    const actualQuantity = Number(ticketActualDraft);

    if (!Number.isSafeInteger(actualQuantity) || actualQuantity < 0) {
      setCompletionModalError('Вкажіть цілу фактичну кількість від 0.');
      return;
    }

    const endedAt = toLocalIsoString(new Date());
    setIsCompletingTicket(true);
    setCompletionModalError(null);

    try {
      const updatedShift = await completeWorkTicket(shiftRepository, {
        shiftId: activeShift.id,
        endedAt,
        actualQuantity
      });

      setNow(endedAt);
      setActiveShift(updatedShift);
      setTicketActualDraft('');
      setIsCompletionModalOpen(false);
    } catch (error) {
      recordDiagnosticError('ticket.complete_failed', 'timer', error);
      setCompletionModalError(getTicketErrorMessage(error));
    } finally {
      setIsCompletingTicket(false);
    }
  };

  const startTicketEdit = (ticket: WorkTicket) => {
    setEditingTicketId(ticket.id);
    setTicketError(null);
  };

  const cancelTicketEdit = () => {
    setEditingTicketId(null);
    setTicketError(null);
  };

  const saveTicketEdit = async (ticketId: string, draft: TicketEditDraft) => {
    if (!activeShift) {
      return;
    }

    const normPerEightHours = parseTicketNormDraft(draft.normPerEightHours);

    if (normPerEightHours === null) {
      return;
    }

    if (!draft.startedAt.trim()) {
      setTicketError('Вкажіть час взяття тікета.');
      return;
    }

    const updatedAt = toLocalIsoString(new Date());
    const startedAt = combineLocalDateAndTime(
      activeShift.date,
      normalizeTimeInput(draft.startedAt)
    );
    const endedAt = draft.endedAt.trim()
      ? combineLocalDateAndTime(activeShift.date, normalizeTimeInput(draft.endedAt))
      : null;
    const editedTicket = activeShift.workTickets.find((ticket) => ticket.id === ticketId);
    const actualQuantity = draft.actualQuantity.trim() === ''
      ? null
      : Number(draft.actualQuantity);
    const downtimeMinutes = Number(draft.downtimeMinutes);

    if (
      !editedTicket ||
      (actualQuantity !== null && (!Number.isSafeInteger(actualQuantity) || actualQuantity < 0)) ||
      !Number.isSafeInteger(downtimeMinutes) ||
      downtimeMinutes < 0
    ) {
      setTicketError('Факт і простій мають бути цілими невідʼємними числами.');
      return;
    }
    setPendingTicketId(ticketId);
    setTicketError(null);

    try {
      const updatedShift = await updateWorkTicketInActiveShift(shiftRepository, {
        shiftId: activeShift.id,
        ticketId,
        normPerEightHours,
        startedAt,
        endedAt,
        actualQuantity: endedAt === null ? null : actualQuantity,
        downtimeMinutes,
        updatedAt
      });

      setNow(updatedAt);
      setActiveShift(updatedShift);
      setEditingTicketId(null);
    } catch (error) {
      recordDiagnosticError('ticket.update_failed', 'timer', error);
      setTicketError(getTicketErrorMessage(error));
    } finally {
      setPendingTicketId(null);
    }
  };

  const removeTicket = async (ticket: WorkTicket) => {
    if (!activeShift) {
      return;
    }

    if (!window.confirm('Видалити цей тікет?')) {
      return;
    }

    const updatedAt = toLocalIsoString(new Date());
    setPendingTicketId(ticket.id);
    setTicketError(null);

    try {
      const updatedShift = await deleteWorkTicketFromActiveShift(shiftRepository, {
        shiftId: activeShift.id,
        ticketId: ticket.id,
        updatedAt
      });

      setNow(updatedAt);
      setActiveShift(updatedShift);

      if (editingTicketId === ticket.id) {
        setEditingTicketId(null);
      }

    } catch (error) {
      recordDiagnosticError('ticket.delete_failed', 'timer', error);
      setTicketError('Не вдалося видалити тікет.');
    } finally {
      setPendingTicketId(null);
    }
  };
  const changeSharedCalendarRange = useCallback((range: CalendarDateRange | null) => {
    setSharedCalendarRange(range);
    setActiveCalendarRangePreset(null);
  }, []);
  const changeSharedCalendarMonth = useCallback(
    (month: CalendarMonth) => {
      setSharedCalendarMonth(month);

      if (activeCalendarRangePreset === 'month') {
        setSharedCalendarRange(getCalendarMonthRange(month));
      }
    },
    [activeCalendarRangePreset]
  );
  const selectCalendarRangePreset = useCallback(
    (preset: CalendarRangePreset) => {
      const selection = getCalendarPresetSelection({
        preset,
        calendarMonth: sharedCalendarMonth,
        allTimeRange,
        now: new Date()
      });

      setSharedCalendarMonth(selection.calendarMonth);
      setSharedCalendarRange(selection.selectedRange);
      setActiveCalendarRangePreset(preset);
    },
    [allTimeRange, sharedCalendarMonth]
  );
  const changeOvertimeStrategy = useCallback(
    async (overtimeStrategy: OvertimeStrategy) => {
      await onSettingsChange({
        ...settings,
        overtimeStrategy,
        updatedAt: toLocalIsoString(new Date())
      });
    },
    [onSettingsChange, settings]
  );

  const markOvertimeDateUnavailable = useCallback(
    async (date: string) => {
      const today = now.slice(0, 10);

      await onSettingsChange({
        ...settings,
        overtimeUnavailableDates: [
          ...new Set([
            ...settings.overtimeUnavailableDates.filter(
              (unavailableDate) => unavailableDate >= today
            ),
            date
          ])
        ].sort(),
        updatedAt: toLocalIsoString(new Date())
      });
    },
    [now, onSettingsChange, settings]
  );
  const openSettings = useCallback(() => setActivePage('settings'), []);

  return (
    <>
      <AppShell
        navigationSlot={<BottomNavigation activeItem={activePage} onSelect={setActivePage} />}
        headerSlot={
          <header
            aria-label="Шапка застосунку"
            className={
              activeShift ? 'main-page__header main-page__header--active' : 'main-page__header'
            }
          >
            <div className="main-page__header-copy">
              <div className="main-page__eyebrow-row">
                <p className="main-page__eyebrow">{pageEyebrowById[activePage]}</p>
                <span className="main-page__version">Версія {__APP_VERSION__}</span>
              </div>
              <h1>Вітаю, {getGreetingName(settings)}</h1>
            </div>
            <button
              className="main-page__icon-button"
              type="button"
              aria-label={settings.incognitoEnabled ? 'Вимкнути інкогніто' : 'Увімкнути інкогніто'}
              aria-pressed={settings.incognitoEnabled}
              disabled={isTogglingIncognito}
              onClick={toggleIncognito}
            >
              {settings.incognitoEnabled ? <EyeOff size={22} /> : <Eye size={22} />}
            </button>
          </header>
        }
      >
      <Suspense
        fallback={
          <section className="main-page__summary" role="status" aria-live="polite">
            <p className="main-page__muted">Завантаження сторінки...</p>
          </section>
        }
      >
      {activePage === 'history' ? (
        <HistoryPage
          settings={settings}
          calendarMonth={sharedCalendarMonth}
          selectedRange={sharedCalendarRange}
          onCalendarMonthChange={changeSharedCalendarMonth}
          onSelectedRangeChange={changeSharedCalendarRange}
          activeRangePreset={activeCalendarRangePreset}
          isAllTimePresetEnabled={allTimeRange !== null}
          onRangePresetSelect={selectCalendarRangePreset}
          dataRevision={dataRevision}
          onDataChange={notifyLocalDataChange}
        />
      ) : activePage === 'analytics' ? (
        <AnalyticsPage
          settings={settings}
          calendarMonth={sharedCalendarMonth}
          selectedRange={sharedCalendarRange}
          onCalendarMonthChange={changeSharedCalendarMonth}
          onSelectedRangeChange={changeSharedCalendarRange}
          activeRangePreset={activeCalendarRangePreset}
          isAllTimePresetEnabled={allTimeRange !== null}
          onRangePresetSelect={selectCalendarRangePreset}
          dataRevision={dataRevision}
        />
      ) : activePage === 'schedule' ? (
        <SchedulePage
          settings={settings}
          calendarMonth={sharedCalendarMonth}
          selectedRange={sharedCalendarRange}
          onCalendarMonthChange={changeSharedCalendarMonth}
          onSelectedRangeChange={changeSharedCalendarRange}
          activeRangePreset={activeCalendarRangePreset}
          isAllTimePresetEnabled={allTimeRange !== null}
          onRangePresetSelect={selectCalendarRangePreset}
          dataRevision={dataRevision}
          onDataChange={notifyLocalDataChange}
        />
      ) : activePage === 'settings' ? (
        <SettingsPage
          settings={settings}
          onSettingsChange={onSettingsChange}
          onLocalDataReplace={onLocalDataReplace}
          onLocalDataChange={notifyLocalDataChange}
        />
      ) : null}
      </Suspense>
      {activePage === 'timer' ? (
        isLoadingShift ? (
        <section className="main-page__summary main-page__timer-screen">
          <p className="main-page__muted">Завантаження таймера...</p>
          {timerError ? (
            <p className="main-page__error" role="alert">
              {timerError}
            </p>
          ) : null}
        </section>
      ) : activeShift ? (
        <>
          <section
            className="main-page__summary main-page__timer-screen main-page__timer-screen--active"
            aria-labelledby="timer-title"
          >
            <div className="main-page__timer-heading">
              <div className="main-page__status-row">
                <p className="main-page__status main-page__status--active">
                  <span aria-hidden="true" />
                  Зміна активна
                </p>
                <span
                  className="main-page__coefficient-badge"
                  data-coefficient={currentCoefficient}
                  aria-label={`Поточний коефіцієнт: x${currentCoefficient}`}
                >
                  x{currentCoefficient}
                </span>
              </div>
              <div className="main-page__timer-title-row">
                <h2 id="timer-title">{getShiftTitle(activeShift)}</h2>
                <p className="main-page__timer-subtitle">
                  {activeShift.plannedStartTime}-{activeShift.plannedEndTime}
                </p>
              </div>
            </div>

            <TimerLiveMetrics
              shift={activeShift}
              incognitoEnabled={settings.incognitoEnabled}
            />

            {timerError ? (
              <p className="main-page__error" role="alert">
                {timerError}
              </p>
            ) : null}
          </section>

          <OvertimePlannerCard
            plan={overtimePlan}
            settings={settings}
            selectedShiftType={selectedShiftType}
            canSelectShiftType={false}
            onShiftTypeChange={setPreferredShiftType}
            onStrategyChange={changeOvertimeStrategy}
            onDateUnavailable={markOvertimeDateUnavailable}
            onOpenSettings={openSettings}
          />

          <section
            className={
              activeWorkTicket
                ? 'main-page__tasker main-page__tasker--active-ticket'
                : 'main-page__tasker'
            }
            aria-labelledby="active-ticket-title"
          >
                  <div className="main-page__tasker-header">
                    <div>
                      <p className="main-page__label">Виробіток</p>
                      <h3 id="active-ticket-title">Тікет зміни</h3>
                    </div>
                    <div className="main-page__tasker-header-tools">
                      <span>{activeShift.workTickets.length} тік.</span>
                      {activeTicketTargets && activeTicketTargets.downtimeMinutes > 0 ? (
                        <output
                          className="main-page__ticket-downtime-badge main-page__ticket-downtime-badge--header"
                          aria-label={`Загальний простій: ${formatDurationMinutes(
                            activeTicketTargets.downtimeMinutes
                          )}`}
                        >
                          <Clock3 size={15} aria-hidden="true" />
                          <span>Простій</span>
                          <strong>{formatDurationMinutes(activeTicketTargets.downtimeMinutes)}</strong>
                        </output>
                      ) : null}
                      {activeWorkTicket ? (
                        <div className="main-page__ticket-more" ref={ticketMenuRef}>
                          <button
                            ref={ticketMenuButtonRef}
                            type="button"
                            title="Дії з тікетом"
                            aria-label="Інші дії з активним тікетом"
                            aria-haspopup="menu"
                            aria-expanded={isTicketMenuOpen}
                            disabled={pendingTicketId !== null || isCompletingTicket}
                            onClick={() => {
                              setOpenCompletedTicketMenuId(null);
                              setIsTicketMenuOpen((current) => !current);
                            }}
                          >
                            <Ellipsis size={16} aria-hidden="true" />
                          </button>
                          {isTicketMenuOpen ? (
                            <div
                              className="main-page__ticket-menu"
                              role="menu"
                              aria-label="Інші дії з тікетом"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setIsTicketMenuOpen(false);
                                  startTicketEdit(activeWorkTicket);
                                }}
                              >
                                <Edit3 size={17} aria-hidden="true" />
                                <span>Редагувати</span>
                              </button>
                              <button type="button" role="menuitem" onClick={openDowntimeModal}>
                                <Clock3 size={17} aria-hidden="true" />
                                <span>Додати простій</span>
                              </button>
                              <button
                                className="main-page__ticket-menu-item--danger"
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setIsTicketMenuOpen(false);
                                  void removeTicket(activeWorkTicket);
                                }}
                              >
                                <Trash2 size={17} aria-hidden="true" />
                                <span>Видалити</span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {!activeWorkTicket ? <div className="main-page__ticket-form">
                    <label>
                      <span>Норма, шт</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={3}
                        pattern="[0-9]*"
                        value={ticketNormDraft}
                        placeholder="50"
                        onChange={(event) => {
                        setTicketNormDraft(normalizeWorkTicketNormDraft(event.target.value));
                          setTicketError(null);
                        }}
                      />
                    </label>
                    <button type="button" disabled={isAddingTicket} onClick={() => void addTicket()}>
                      {isAddingTicket ? 'Додавання...' : 'Додати тікет'}
                    </button>
                  </div> : null}

                  {activeWorkTicket && activeTicketTargets ? (
                    <div className="main-page__ticket-current">
                      {editingTicketId === activeWorkTicket.id ? (
                        <TicketEditForm
                          isActive
                          isPending={pendingTicketId !== null}
                          ticket={activeWorkTicket}
                          onCancel={cancelTicketEdit}
                          onChange={() => setTicketError(null)}
                          onSave={saveTicketEdit}
                        />
                      ) : null}
                      <div className="main-page__ticket-plan">
                        <div className="main-page__ticket-plan-header">
                          <span>План за час тікета</span>
                          <strong>Ваш G{activeTicketTargets.currentGrade}</strong>
                        </div>
                        <div className="main-page__ticket-targets" aria-label="План для всіх рівнів">
                          {activeTicketTargets.targets.map((target) => (
                            <article
                              data-current={target.grade === activeTicketTargets.currentGrade ? 'true' : 'false'}
                              key={target.grade}
                            >
                              <span>G{target.grade}</span>
                              <strong>{target.quantity} шт</strong>
                            </article>
                          ))}
                        </div>
                      </div>
                      <div className="main-page__ticket-footer">
                        <button
                          ref={completeTicketButtonRef}
                          className="main-page__ticket-complete-button"
                          type="button"
                          disabled={isCompletingTicket || pendingTicketId !== null}
                          onClick={openCompletionModal}
                        >
                          <Check size={16} aria-hidden="true" />
                          <span>Завершити тікет</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="main-page__muted main-page__ticket-hint">
                      Додайте тікет, щоб бачити поточну норму.
                    </p>
                  )}

                  {completedTicketTargets.length > 0 ? (
                    <div className="main-page__ticket-history" aria-label="Завершені тікети">
                      {completedTicketTargets.map(({ ticket, ticketNumber, targets }) => {
                        const isEditingTicket = editingTicketId === ticket.id;
                        const gradeOneTarget =
                          targets.targets.find((target) => target.grade === 1)?.quantity ?? 0;
                        const completionLabel = targets.completionPercent === null
                          ? '—'
                          : `${Math.round(targets.completionPercent)}%`;
                        const actualQuantityLabel = ticket.actualQuantity === null
                          ? '—'
                          : String(ticket.actualQuantity);
                        const isCompletedMenuOpen = openCompletedTicketMenuId === ticket.id;

                        return (
                          <article
                            className={
                              isEditingTicket
                                ? 'main-page__ticket-history-item main-page__ticket-history-item--editing'
                                : 'main-page__ticket-history-item'
                            }
                            key={ticket.id}
                            aria-label={`Підсумок тікета ${formatTime(ticket.startedAt)}`}
                          >
                            {isEditingTicket ? (
                              <TicketEditForm
                                isActive={false}
                                isPending={pendingTicketId !== null}
                                ticket={ticket}
                                onCancel={cancelTicketEdit}
                                onChange={() => setTicketError(null)}
                                onSave={saveTicketEdit}
                              />
                            ) : (
                              <>
                                <div className="main-page__ticket-history-header">
                                  <div className="main-page__ticket-history-meta">
                                    <span className="main-page__ticket-history-number">
                                      Тікет {ticketNumber}
                                    </span>
                                    <time className="main-page__ticket-history-time">
                                      {formatTime(ticket.startedAt)}–{formatTime(ticket.endedAt)}
                                    </time>
                                  </div>
                                  <output
                                    className="main-page__ticket-history-completion"
                                    aria-label={`Виконання: ${completionLabel}${
                                      ticket.manualCompletionPercent !== null ? ', вручну' : ''
                                    }`}
                                  >
                                    {completionLabel}
                                    {ticket.manualCompletionPercent !== null ? (
                                      <small>вручну</small>
                                    ) : null}
                                  </output>
                                  <div
                                    className="main-page__ticket-more"
                                    ref={isCompletedMenuOpen ? completedTicketMenuRef : undefined}
                                  >
                                    <button
                                      ref={isCompletedMenuOpen ? completedTicketMenuButtonRef : undefined}
                                      type="button"
                                      title="Дії з завершеним тікетом"
                                      aria-label={`Інші дії з тікетом ${formatTime(ticket.startedAt)}`}
                                      aria-haspopup="menu"
                                      aria-expanded={isCompletedMenuOpen}
                                      disabled={pendingTicketId !== null}
                                      onClick={(event) => {
                                        setIsTicketMenuOpen(false);
                                        completedTicketMenuButtonRef.current = event.currentTarget;
                                        setOpenCompletedTicketMenuId((current) =>
                                          current === ticket.id ? null : ticket.id
                                        );
                                      }}
                                    >
                                      <Ellipsis size={16} aria-hidden="true" />
                                    </button>
                                    {isCompletedMenuOpen ? (
                                      <div
                                        className="main-page__ticket-menu"
                                        role="menu"
                                        aria-label={`Дії з завершеним тікетом ${formatTime(ticket.startedAt)}`}
                                      >
                                        <button
                                          type="button"
                                          role="menuitem"
                                          onClick={() => {
                                            setOpenCompletedTicketMenuId(null);
                                            startTicketEdit(ticket);
                                          }}
                                        >
                                          <Edit3 size={17} aria-hidden="true" />
                                          <span>Редагувати</span>
                                        </button>
                                        <button
                                          className="main-page__ticket-menu-item--danger"
                                          type="button"
                                          role="menuitem"
                                          onClick={() => {
                                            setOpenCompletedTicketMenuId(null);
                                            void removeTicket(ticket);
                                          }}
                                        >
                                          <Trash2 size={17} aria-hidden="true" />
                                          <span>Видалити</span>
                                        </button>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                                <dl className="main-page__ticket-history-metrics">
                                  <div>
                                    <dt>Факт / план G1</dt>
                                    <dd>{actualQuantityLabel} / {gradeOneTarget} шт</dd>
                                  </div>
                                  <div>
                                    <dt>Продуктивно</dt>
                                    <dd>{formatDurationMinutes(targets.productiveMinutes)}</dd>
                                  </div>
                                  {targets.downtimeMinutes > 0 ? (
                                    <div data-tone="warning">
                                      <dt>Простій</dt>
                                      <dd>{formatDurationMinutes(targets.downtimeMinutes)}</dd>
                                    </div>
                                  ) : null}
                                </dl>
                              </>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  ) : null}

                  {ticketError ? (
                    <p className="main-page__error" role="alert">
                      {ticketError}
                    </p>
                  ) : null}
          </section>

          <ShiftNoteEditor
            initialNote={activeShift.note}
            shiftId={activeShift.id}
            onSave={saveShiftNote}
          />

          {!activeWorkTicket ? (
            <div className="main-page__action-bar">
              <HoldButton
                label="Пішов"
                onConfirm={leave}
                onHoldStart={prepareLeaveClipboard}
                onHoldCancel={cancelPreparedLeaveClipboard}
                tone="danger"
              />
            </div>
          ) : null}

          {isDowntimeModalOpen && activeWorkTicket && activeTicketTargets ? (
            <div
              className="main-page__ticket-modal-overlay"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  closeDowntimeModal();
                }
              }}
            >
              <section
                className="main-page__ticket-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="downtime-modal-title"
              >
                <header className="main-page__ticket-modal-header">
                  <div>
                    <p className="main-page__label">Тікет зміни</p>
                    <h2 id="downtime-modal-title">Простій</h2>
                  </div>
                  <button
                    className="main-page__ticket-modal-close"
                    type="button"
                    aria-label="Закрити додавання простою"
                    disabled={pendingTicketId !== null}
                    onClick={closeDowntimeModal}
                  >
                    <X size={20} aria-hidden="true" />
                  </button>
                </header>

                <div className="main-page__ticket-modal-summary">
                  <span>Накопичений простій</span>
                  <strong>{formatDurationMinutes(activeTicketTargets.downtimeMinutes)}</strong>
                </div>

                <form
                  className="main-page__ticket-modal-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addTicketDowntimeAdjustment();
                  }}
                >
                  <div
                    className="main-page__ticket-mode-switch"
                    role="group"
                    aria-label="Спосіб коригування простою"
                  >
                    <button
                      type="button"
                      aria-pressed={downtimeAdjustmentMode === 'add'}
                      disabled={pendingTicketId !== null}
                      onClick={() => {
                        setDowntimeAdjustmentMode('add');
                        setDowntimeModalError(null);
                      }}
                    >
                      Додати
                    </button>
                    <button
                      type="button"
                      aria-pressed={downtimeAdjustmentMode === 'subtract'}
                      disabled={pendingTicketId !== null}
                      onClick={() => {
                        setDowntimeAdjustmentMode('subtract');
                        setDowntimeModalError(null);
                      }}
                    >
                      Відняти
                    </button>
                  </div>

                  <label className="main-page__ticket-modal-field">
                    <span>Кількість хвилин</span>
                    <span className="main-page__ticket-modal-input">
                      <input
                        ref={downtimeInputRef}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        pattern="[0-9]*"
                        aria-label="Кількість хвилин"
                        aria-invalid={downtimeModalError ? 'true' : 'false'}
                        aria-describedby={
                          downtimeModalError
                            ? 'downtime-modal-help downtime-modal-error'
                            : 'downtime-modal-help'
                        }
                        value={downtimeAdjustmentDraft}
                        placeholder="15"
                        onChange={(event) => {
                          setDowntimeAdjustmentDraft(event.target.value.replace(/\D/g, ''));
                          setDowntimeModalError(null);
                        }}
                      />
                      <span aria-hidden="true">хв</span>
                    </span>
                    <small id="downtime-modal-help">
                      {downtimeAdjustmentMode === 'add' ? 'Можна додати' : 'Можна відняти'} до{' '}
                      {availableDowntimeAdjustmentMinutes} хв.
                    </small>
                  </label>

                  {downtimeModalError ? (
                    <p
                      className="main-page__ticket-modal-error"
                      id="downtime-modal-error"
                      role="alert"
                    >
                      {downtimeModalError}
                    </p>
                  ) : null}

                  <div className="main-page__ticket-modal-actions">
                    <button
                      type="button"
                      disabled={pendingTicketId !== null}
                      onClick={closeDowntimeModal}
                    >
                      Скасувати
                    </button>
                    <button type="submit" disabled={pendingTicketId !== null}>
                      {pendingTicketId !== null
                        ? 'Збереження...'
                        : downtimeAdjustmentMode === 'add'
                          ? 'Додати простій'
                          : 'Відняти простій'}
                    </button>
                  </div>
                </form>
              </section>
            </div>
          ) : null}

          {isCompletionModalOpen && activeWorkTicket ? (
            <div
              className="main-page__ticket-modal-overlay"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  closeCompletionModal();
                }
              }}
            >
              <section
                className="main-page__ticket-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="completion-modal-title"
              >
                <header className="main-page__ticket-modal-header">
                  <div>
                    <p className="main-page__label">Тікет зміни</p>
                    <h2 id="completion-modal-title">Завершення тікета</h2>
                  </div>
                  <button
                    className="main-page__ticket-modal-close"
                    type="button"
                    aria-label="Закрити завершення тікета"
                    disabled={isCompletingTicket}
                    onClick={closeCompletionModal}
                  >
                    <X size={20} aria-hidden="true" />
                  </button>
                </header>

                <form
                  className="main-page__ticket-modal-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void finishActiveTicket();
                  }}
                >
                  <label className="main-page__ticket-modal-field">
                    <span>Фактично зроблено, шт</span>
                    <input
                      ref={actualQuantityInputRef}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      pattern="[0-9]*"
                      aria-label="Фактично зроблено, шт"
                      aria-invalid={completionModalError ? 'true' : 'false'}
                      aria-describedby={
                        completionModalError
                          ? 'completion-modal-help completion-modal-error'
                          : 'completion-modal-help'
                      }
                      value={ticketActualDraft}
                      placeholder="0"
                      onChange={(event) => {
                        setTicketActualDraft(event.target.value.replace(/\D/g, ''));
                        setCompletionModalError(null);
                      }}
                    />
                    <small id="completion-modal-help">Можна вказати 0, якщо виробітку не було.</small>
                  </label>

                  {completionModalError ? (
                    <p
                      className="main-page__ticket-modal-error"
                      id="completion-modal-error"
                      role="alert"
                    >
                      {completionModalError}
                    </p>
                  ) : null}

                  <div className="main-page__ticket-modal-actions">
                    <button
                      type="button"
                      disabled={isCompletingTicket}
                      onClick={closeCompletionModal}
                    >
                      Скасувати
                    </button>
                    <button type="submit" disabled={isCompletingTicket}>
                      {isCompletingTicket ? 'Збереження...' : 'Завершити тікет'}
                    </button>
                  </div>
                </form>
              </section>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <section
            className="main-page__summary main-page__timer-screen main-page__timer-screen--idle"
            aria-label="План перепрацювань"
          >
            <OvertimePlannerCard
              plan={overtimePlan}
              settings={settings}
              selectedShiftType={selectedShiftType}
              canSelectShiftType
              onShiftTypeChange={setPreferredShiftType}
              onStrategyChange={changeOvertimeStrategy}
              onDateUnavailable={markOvertimeDateUnavailable}
              onOpenSettings={openSettings}
            />
            <div className="main-page__action-bar">
              <p className="main-page__hold-hint">Утримай “Прийшов”, щоб почати зміну</p>
              <HoldButton
                label="Прийшов"
                onConfirm={arrive}
              />
            </div>

            {timerError ? (
              <p className="main-page__error" role="alert">
                {timerError}
              </p>
            ) : null}
            {clipboardNotice ? (
              <div
                className="main-page__notice"
                data-tone={clipboardNotice.tone}
              >
                <p role="status" aria-live="polite">
                  {clipboardNotice.message}
                </p>
                <button
                  type="button"
                  disabled={isRetryingClipboard}
                  onClick={() => void retryClipboardCopy()}
                >
                  {isRetryingClipboard ? 'Копіюю...' : 'Скопіювати ще раз'}
                </button>
              </div>
            ) : null}
          </section>
        </>
        )
      ) : null}
      </AppShell>
      <CalendarTutorial
        isOpen={isCalendarTutorialOpen}
        onDismiss={dismissCalendarTutorial}
      />
    </>
  );
}
