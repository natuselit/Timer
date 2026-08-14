import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode
} from 'react';
import {
  CalendarClock,
  CalendarDays,
  ChevronDown,
  CircleHelp,
  Database,
  Download,
  Eraser,
  FileUp,
  FlaskConical,
  Info,
  Palette,
  RotateCcw,
  Save,
  Shield,
  TimerReset,
  Trophy,
  UserRound,
  WalletCards,
  X,
  type LucideIcon
} from 'lucide-react';
import appPackage from '../../../../package.json';
import {
  DEFAULT_SETTINGS,
  BACKUP_REMINDER_INTERVAL_DAYS,
  GRADE_VALUES,
  HOLD_DELAY_MAX_MS,
  HOLD_DELAY_MIN_MS,
  OVERTIME_LIMIT_PERCENT_MAX,
  OVERTIME_LIMIT_PERCENT_MIN,
  OVERTIME_STEP_MINUTES_MAX,
  OVERTIME_STEP_MINUTES_MIN,
  calculateCumulativeGradePercent,
  calculateGradeMonthlyBonus,
  calculateHourlyRateFromMonthlySalary,
  getNextDesiredGrade,
  isBackupReminderIntervalDays,
  isOvertimeDailyMaxMinutes,
  isOvertimeStrategy,
  type Grade,
  type GradePercentSet,
  type OvertimeStrategy,
  type Settings,
  type ThemePreference
} from '../../../entities/settings';
import { INCOGNITO_FINANCIAL_MASK, formatHourlyRate, formatMoney } from '../../../shared/lib/format';
import {
  BackupValidationError,
  BackupReminderRepository,
  localDb,
  parseBackupImportJson,
  recalculateHourlyRateSnapshotsForPeriod,
  replaceShiftsFromLegacyBackup,
  replaceLocalDataWithDemo,
  restoreBackup,
  SCHEDULE_WARNING_REVIEW_PREFIX,
  ShiftRepository
} from '../../../shared/lib/local-db';
import { downloadBackup } from '../../../shared/lib/backup';
import {
  addMinutesToLocalTime,
  formatTimeInputDraft,
  formatDate,
  getNextHeldCalendarRange,
  getSingleDateRange,
  normalizeTimeInput,
  toLocalIsoString
} from '../../../shared/lib/date-time';
import {
  MonthCalendar,
  type CalendarDateRange
} from '../../../shared/ui/month-calendar';
import {
  ENTERPRISE_SCHEDULE_IMPORT_NOTE,
  ENTERPRISE_SCHEDULE_IMPORT_STEPS,
  type EnterpriseScheduleImportStep
} from '../../../shared/config/enterpriseScheduleImportGuide';
import './SettingsPage.css';

type SettingsPageProps = {
  settings: Settings;
  onSettingsChange: (settings: Settings) => Promise<void>;
  onLocalDataReplace: (settings: Settings) => void;
  onLocalDataChange?: () => void;
  onOpenCalendarTutorial: () => void;
};

type FormValues = {
  employeeFirstName: string;
  employeeLastName: string;
  monthlySalary: string;
  monthlyBonus: string;
  currentGrade: string;
  desiredGrade: string;
  gradeSalaryBonusPercents: [string, string, string, string];
  gradeNormPercents: [string, string, string, string];
  holdDelaySeconds: string;
  backupReminderIntervalDays: string;
  overtimeLimitPercent: string;
  overtimeStepMinutes: string;
  overtimeStrategy: OvertimeStrategy;
  overtimeWeekdayEndTime: string;
  overtimeSaturdayEndTime: string;
};

type FormErrors = Partial<Record<keyof FormValues, string>>;
type Notice = {
  tone: 'success' | 'error' | 'info';
  text: string;
};

type RecalculationPeriod = {
  start: string;
  end: string;
};

type RecalculationCalendarMonth = {
  year: number;
  month: number;
};

const EMPTY_RECALCULATION_PERIOD: RecalculationPeriod = {
  start: '',
  end: ''
};

const getCurrentCalendarMonth = (): RecalculationCalendarMonth => {
  const today = new Date();

  return {
    year: today.getFullYear(),
    month: today.getMonth() + 1
  };
};

type SettingsSectionId =
  | 'employee'
  | 'payment'
  | 'overtime'
  | 'grades'
  | 'timer'
  | 'appearance'
  | 'privacy'
  | 'data'
  | 'help'
  | 'information';

type SettingsSectionProps = {
  id: SettingsSectionId;
  title: string;
  description: string;
  summary: string;
  icon: LucideIcon;
  children: ReactNode;
};

function SettingsSection({
  id,
  title,
  description,
  summary,
  icon: Icon,
  children
}: SettingsSectionProps) {
  return (
    <details className="settings-page__section" data-settings-section={id}>
      <summary className="settings-page__section-summary">
        <span className="settings-page__section-icon" aria-hidden="true">
          <Icon size={20} />
        </span>
        <span className="settings-page__section-copy">
          <h2>{title}</h2>
          <small>{description}</small>
        </span>
        <span className="settings-page__section-value">{summary}</span>
        <ChevronDown className="settings-page__section-chevron" size={20} aria-hidden="true" />
      </summary>
      <div className="settings-page__section-content">{children}</div>
    </details>
  );
}

const FORM_FIELD_SECTIONS: Record<keyof FormValues, SettingsSectionId> = {
  employeeFirstName: 'employee',
  employeeLastName: 'employee',
  monthlySalary: 'payment',
  monthlyBonus: 'payment',
  currentGrade: 'grades',
  desiredGrade: 'grades',
  gradeSalaryBonusPercents: 'grades',
  gradeNormPercents: 'grades',
  holdDelaySeconds: 'timer',
  backupReminderIntervalDays: 'data',
  overtimeLimitPercent: 'overtime',
  overtimeStepMinutes: 'overtime',
  overtimeStrategy: 'overtime',
  overtimeWeekdayEndTime: 'overtime',
  overtimeSaturdayEndTime: 'overtime'
};

const delayMinSeconds = HOLD_DELAY_MIN_MS / 1000;
const delayMaxSeconds = HOLD_DELAY_MAX_MS / 1000;
const OVERTIME_STRATEGY_DESCRIPTIONS: Record<OvertimeStrategy, string> = {
  standard: 'Використовуються дві найближчі суботи, решта — на будні.',
  'standard-plus': 'Використовуються три найближчі суботи, решта — на будні.',
  'standard-plus-plus': 'Використовуються чотири найближчі суботи, решта — на будні.'
};
const OVERTIME_STRATEGY_LABELS: Record<OvertimeStrategy, string> = {
  standard: 'Стандарт',
  'standard-plus': 'Стандарт+',
  'standard-plus-plus': 'Стандарт++'
};
const FAQ_ITEMS: Array<{
  question: string;
  answer: string;
  steps?: readonly EnterpriseScheduleImportStep[];
}> = [
  {
    question: 'Як почати й завершити зміну?',
    answer:
      'Утримуйте «Прийшов» для старту та «Пішов» для завершення. Активну зміну не можна завершити, доки активний тікет не закрито з фактичною кількістю.'
  },
  {
    question: 'Як визначається тип зміни?',
    answer:
      'Тип визначається автоматично за найближчим плановим часом: 06:30–14:30 або 14:30–22:30. За день може бути лише одна зміна й лише одна активна зміна загалом.'
  },
  {
    question: 'Як працює коефіцієнт?',
    answer:
      'У будні плановий час в auto оплачується за x1, а час до початку або після завершення — за x1.5. У суботу й неділю режим auto оплачує всю фактичну тривалість за x1.5.'
  },
  {
    question: 'Як працює ліміт перепрацювань?',
    answer:
      'Ліміт рахується як відсоток від плану 5/2 по 8 годин. У будні враховується час до або після планової зміни, а у вихідні — вся фактична тривалість. Денний максимум задається в налаштуваннях. Перевищення показується, але не блокує таймер.'
  },
  {
    question: 'Як працюють тікети та простій?',
    answer:
      'Одночасно активний лише один тікет. Простій додається або віднімається через меню «…» активного тікета. Під час завершення вкажіть фактичну кількість у модальному вікні.'
  },
  {
    question: 'Як рахуються оплата та рівні?',
    answer:
      'Базова погодинна ставка для нової зміни рахується з місячної ставки, робочих днів 5/2 і восьми годин. Премія за рівень додається окремо за повний календарний місяць.'
  },
  {
    question: 'Що робить режим інкогніто?',
    answer:
      'Інкогніто приховує фінансові значення та блокує редагування грошових полів, але не видаляє й не змінює реальні дані.'
  },
  {
    question: 'Як працюють backup та імпорт зі старого додатку?',
    answer:
      'Звичайний backup «Таймера» повністю відновлює налаштування, зміни й графік. Backup старого додатку замінює лише історію змін, залишаючи чинні налаштування та графік.'
  },
  {
    question: 'Як імпортувати графік підприємства?',
    answer: ENTERPRISE_SCHEDULE_IMPORT_NOTE,
    steps: ENTERPRISE_SCHEDULE_IMPORT_STEPS
  }
];

const parseNumber = (value: string): number => Number(value.replace(',', '.'));

const WEEKDAY_OVERTIME_START_TIME = '14:30';
const SATURDAY_WORK_START_TIME = '06:00';
const COMPLETE_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const formatOvertimeEndTime = (startTime: string, minutes: number): string =>
  addMinutesToLocalTime(startTime, minutes).time;

const getMinutesUntilTime = (startTime: string, endTime: string): number => {
  if (!COMPLETE_TIME_PATTERN.test(endTime)) {
    return Number.NaN;
  }

  const [startHours, startMinutes] = startTime.split(':').map(Number);
  const [endHours, endMinutes] = endTime.split(':').map(Number);
  const startTotal = startHours * 60 + startMinutes;
  const endTotal = endHours * 60 + endMinutes;
  const sameDayDifference = endTotal - startTotal;

  return sameDayDifference > 0 ? sameDayDifference : sameDayDifference + 24 * 60;
};

const toPercentFormValues = (percents: GradePercentSet): [string, string, string, string] =>
  percents.map(String) as [string, string, string, string];

const parsePercentFormValues = (values: [string, string, string, string]): GradePercentSet =>
  values.map(parseNumber) as GradePercentSet;

const parseGrade = (value: string): Grade => {
  const grade = Number(value);

  return GRADE_VALUES.includes(grade as Grade) ? (grade as Grade) : 1;
};

const toFormValues = (settings: Settings): FormValues => ({
  employeeFirstName: settings.employeeFirstName,
  employeeLastName: settings.employeeLastName,
  monthlySalary: String(settings.monthlySalary),
  monthlyBonus: String(settings.monthlyBonus),
  currentGrade: String(settings.currentGrade),
  desiredGrade: String(settings.desiredGrade),
  gradeSalaryBonusPercents: toPercentFormValues(settings.gradeSalaryBonusPercents),
  gradeNormPercents: toPercentFormValues(settings.gradeNormPercents),
  holdDelaySeconds: String(settings.arriveHoldDelayMs / 1000),
  backupReminderIntervalDays: String(settings.backupReminderIntervalDays),
  overtimeLimitPercent: String(settings.overtimeLimitPercent),
  overtimeStepMinutes: String(settings.overtimeStepMinutes),
  overtimeStrategy: settings.overtimeStrategy,
  overtimeWeekdayEndTime: formatOvertimeEndTime(
    WEEKDAY_OVERTIME_START_TIME,
    settings.overtimeWeekdayMaxMinutes
  ),
  overtimeSaturdayEndTime: formatOvertimeEndTime(
    SATURDAY_WORK_START_TIME,
    settings.overtimeSaturdayMaxMinutes
  )
});

const validateForm = (values: FormValues, incognitoEnabled: boolean): FormErrors => {
  const errors: FormErrors = {};
  const monthlySalary = parseNumber(values.monthlySalary);
  const monthlyBonus = parseNumber(values.monthlyBonus);
  const currentGrade = Number(values.currentGrade);
  const desiredGrade = Number(values.desiredGrade);
  const gradeSalaryBonusPercents = parsePercentFormValues(values.gradeSalaryBonusPercents);
  const gradeNormPercents = parsePercentFormValues(values.gradeNormPercents);
  const holdDelay = parseNumber(values.holdDelaySeconds);
  const backupReminderIntervalDays = Number(values.backupReminderIntervalDays);
  const overtimeLimitPercent = parseNumber(values.overtimeLimitPercent);
  const overtimeStepMinutes = Number(values.overtimeStepMinutes);
  const overtimeWeekdayMaxMinutes = getMinutesUntilTime(
    WEEKDAY_OVERTIME_START_TIME,
    values.overtimeWeekdayEndTime
  );
  const overtimeSaturdayMaxMinutes = getMinutesUntilTime(
    SATURDAY_WORK_START_TIME,
    values.overtimeSaturdayEndTime
  );

  if (!values.employeeFirstName.trim()) {
    errors.employeeFirstName = 'Вкажіть імʼя.';
  }

  if (!values.employeeLastName.trim()) {
    errors.employeeLastName = 'Вкажіть прізвище.';
  }

  if (!incognitoEnabled && (!Number.isFinite(monthlySalary) || monthlySalary < 0)) {
    errors.monthlySalary = 'Ставка за місяць не може бути відʼємною.';
  }

  if (!incognitoEnabled && (!Number.isFinite(monthlyBonus) || monthlyBonus < 0)) {
    errors.monthlyBonus = 'Премія не може бути відʼємною.';
  }

  if (!incognitoEnabled && (!GRADE_VALUES.includes(currentGrade as Grade))) {
    errors.currentGrade = 'Оберіть поточний рівень.';
  }

  if (!GRADE_VALUES.includes(desiredGrade as Grade)) {
    errors.desiredGrade = 'Оберіть бажаний рівень.';
  }

  if (
    !incognitoEnabled &&
    gradeSalaryBonusPercents.some((percent) => !Number.isFinite(percent) || percent < 0)
  ) {
    errors.gradeSalaryBonusPercents = 'Надбавки до ЗП не можуть бути відʼємними.';
  }

  if (gradeNormPercents.some((percent) => !Number.isFinite(percent) || percent < 0)) {
    errors.gradeNormPercents = 'Норми рівнів не можуть бути відʼємними.';
  }

  if (
    !Number.isFinite(holdDelay) ||
    holdDelay < delayMinSeconds ||
    holdDelay > delayMaxSeconds
  ) {
    errors.holdDelaySeconds = `Затримка має бути від ${delayMinSeconds} до ${delayMaxSeconds} с.`;
  }

  if (!isBackupReminderIntervalDays(backupReminderIntervalDays)) {
    errors.backupReminderIntervalDays = 'Оберіть 7, 14 або 30 днів.';
  }

  if (
    !Number.isFinite(overtimeLimitPercent) ||
    overtimeLimitPercent < OVERTIME_LIMIT_PERCENT_MIN ||
    overtimeLimitPercent > OVERTIME_LIMIT_PERCENT_MAX
  ) {
    errors.overtimeLimitPercent = 'Ліміт має бути від 0 до 100%.';
  }

  if (!isOvertimeStrategy(values.overtimeStrategy)) {
    errors.overtimeStrategy = 'Оберіть стратегію перепрацювань.';
  }

  if (
    !Number.isSafeInteger(overtimeStepMinutes) ||
    overtimeStepMinutes < OVERTIME_STEP_MINUTES_MIN ||
    overtimeStepMinutes > OVERTIME_STEP_MINUTES_MAX ||
    overtimeStepMinutes % 5 !== 0
  ) {
    errors.overtimeStepMinutes = `Крок має бути цілим числом від ${OVERTIME_STEP_MINUTES_MIN} до ${OVERTIME_STEP_MINUTES_MAX} і кратним 5.`;
  }

  if (!isOvertimeDailyMaxMinutes(overtimeWeekdayMaxMinutes)) {
    errors.overtimeWeekdayEndTime = 'Вкажіть час від 14:35 до 02:30 наступного дня з кроком 5 хв.';
  }

  if (!isOvertimeDailyMaxMinutes(overtimeSaturdayMaxMinutes)) {
    errors.overtimeSaturdayEndTime = 'Вкажіть час від 06:05 до 18:00 з кроком 5 хв.';
  }

  return errors;
};

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));

const getImportErrorMessage = (error: unknown): string => {
  if (error instanceof BackupValidationError) {
    return error.message;
  }

  return 'Не вдалося імпортувати backup. Поточні дані не змінено.';
};

const shiftRepository = new ShiftRepository(localDb);
const backupReminderRepository = new BackupReminderRepository(localDb);

export function SettingsPage({
  settings,
  onSettingsChange,
  onLocalDataReplace,
  onLocalDataChange,
  onOpenCalendarTutorial
}: SettingsPageProps) {
  const [values, setValues] = useState<FormValues>(() => toFormValues(settings));
  const [errors, setErrors] = useState<FormErrors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isApplyingRate, setIsApplyingRate] = useState(false);
  const [isRecalculationOpen, setIsRecalculationOpen] = useState(false);
  const [recalculationPeriod, setRecalculationPeriod] = useState<RecalculationPeriod>(
    EMPTY_RECALCULATION_PERIOD
  );
  const [recalculationPreviewCount, setRecalculationPreviewCount] = useState<number | null>(
    null
  );
  const [recalculationError, setRecalculationError] = useState<string | null>(null);
  const [recalculationCalendarMonth, setRecalculationCalendarMonth] =
    useState<RecalculationCalendarMonth>(getCurrentCalendarMonth);
  const [isClearing, setIsClearing] = useState(false);
  const [isBackupBusy, setIsBackupBusy] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const syncedValuesRef = useRef<FormValues>(toFormValues(settings));

  useEffect(() => {
    const nextValues = toFormValues(settings);

    setValues((currentValues) =>
      JSON.stringify(currentValues) === JSON.stringify(syncedValuesRef.current)
        ? nextValues
        : currentValues
    );
    syncedValuesRef.current = nextValues;
  }, [settings]);

  useEffect(() => {
    if (
      !isRecalculationOpen ||
      !recalculationPeriod.start ||
      !recalculationPeriod.end ||
      recalculationPeriod.start > recalculationPeriod.end
    ) {
      setRecalculationPreviewCount(null);
      return;
    }

    let isCancelled = false;
    setRecalculationPreviewCount(null);

    void shiftRepository
      .getShiftsBetween(recalculationPeriod.start, recalculationPeriod.end)
      .then((shifts) => {
        if (!isCancelled) {
          setRecalculationPreviewCount(shifts.length);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setRecalculationError('Не вдалося підрахувати зміни у вибраному періоді.');
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isRecalculationOpen, recalculationPeriod]);

  const updateField =
    (field: keyof FormValues) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setValues((current) => ({
        ...current,
        [field]: event.target.value
      }));
      setErrors((current) => ({
        ...current,
        [field]: undefined
      }));
      setNotice(null);
    };

  const updateTimeField =
    (field: 'overtimeWeekdayEndTime' | 'overtimeSaturdayEndTime') =>
    (event: ChangeEvent<HTMLInputElement>) => {
      setValues((current) => ({
        ...current,
        [field]: formatTimeInputDraft(event.target.value)
      }));
      setErrors((current) => ({ ...current, [field]: undefined }));
      setNotice(null);
    };

  const normalizeTimeField =
    (field: 'overtimeWeekdayEndTime' | 'overtimeSaturdayEndTime') => () => {
      setValues((current) => ({
        ...current,
        [field]: current[field] ? normalizeTimeInput(current[field]) : ''
      }));
    };

  const updateGradeValue =
    (field: 'currentGrade' | 'desiredGrade') => (event: ChangeEvent<HTMLSelectElement>) => {
      const nextValue = event.target.value;

      setValues((current) => {
        if (field === 'currentGrade') {
          const nextCurrentGrade = parseGrade(nextValue);

          return {
            ...current,
            currentGrade: nextValue,
            desiredGrade: String(getNextDesiredGrade(nextCurrentGrade))
          };
        }

        return {
          ...current,
          desiredGrade: nextValue
        };
      });
      setErrors((current) => ({
        ...current,
        [field]: undefined
      }));
      setNotice(null);
    };

  const updateGradePercent =
    (field: 'gradeSalaryBonusPercents' | 'gradeNormPercents', index: number) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;

      setValues((current) => {
        const nextPercents = [...current[field]] as [string, string, string, string];
        nextPercents[index] = nextValue;

        return {
          ...current,
          [field]: nextPercents
        };
      });
      setErrors((current) => ({
        ...current,
        [field]: undefined
      }));
      setNotice(null);
    };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validateForm(values, settings.incognitoEnabled);

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setNotice({ tone: 'error', text: 'Перевірте поля з помилками.' });
      const firstInvalidField = Object.keys(nextErrors)[0] as keyof FormValues | undefined;
      const firstInvalidSection = firstInvalidField
        ? FORM_FIELD_SECTIONS[firstInvalidField]
        : undefined;

      if (firstInvalidSection) {
        const section = formRef.current?.querySelector<HTMLDetailsElement>(
          `[data-settings-section="${firstInvalidSection}"]`
        );

        if (section) {
          section.open = true;
        }
      }

      window.requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      });
      return;
    }

    setIsSaving(true);
    setNotice(null);

    const holdDelayMs = Math.round(parseNumber(values.holdDelaySeconds) * 1000);
    const overtimeWeekdayMaxMinutes = getMinutesUntilTime(
      WEEKDAY_OVERTIME_START_TIME,
      values.overtimeWeekdayEndTime
    );
    const overtimeSaturdayMaxMinutes = getMinutesUntilTime(
      SATURDAY_WORK_START_TIME,
      values.overtimeSaturdayEndTime
    );
    const currentGrade = settings.incognitoEnabled
      ? settings.currentGrade
      : parseGrade(values.currentGrade);
    const desiredGradeDraft = parseGrade(values.desiredGrade);
    const desiredGrade = desiredGradeDraft < currentGrade ? currentGrade : desiredGradeDraft;
    const nextSettings: Settings = {
      ...settings,
      employeeFirstName: values.employeeFirstName.trim(),
      employeeLastName: values.employeeLastName.trim(),
      monthlySalary: settings.incognitoEnabled
        ? settings.monthlySalary
        : parseNumber(values.monthlySalary),
      monthlyBonus: settings.incognitoEnabled ? settings.monthlyBonus : parseNumber(values.monthlyBonus),
      currentGrade,
      desiredGrade,
      gradeSalaryBonusPercents: settings.incognitoEnabled
        ? settings.gradeSalaryBonusPercents
        : parsePercentFormValues(values.gradeSalaryBonusPercents),
      gradeNormPercents: parsePercentFormValues(values.gradeNormPercents),
      arriveHoldDelayMs: holdDelayMs,
      leaveHoldDelayMs: holdDelayMs,
      backupReminderIntervalDays: Number(
        values.backupReminderIntervalDays
      ) as Settings['backupReminderIntervalDays'],
      overtimeLimitPercent: parseNumber(values.overtimeLimitPercent),
      overtimeStepMinutes: Number(values.overtimeStepMinutes),
      overtimeStrategy: values.overtimeStrategy,
      overtimeWeekdayMaxMinutes,
      overtimeSaturdayMaxMinutes,
      updatedAt: toLocalIsoString(new Date())
    };

    try {
      await onSettingsChange(nextSettings);
      setNotice({ tone: 'success', text: 'Налаштування збережено.' });
    } catch {
      setNotice({ tone: 'error', text: 'Не вдалося зберегти налаштування.' });
    } finally {
      setIsSaving(false);
    }
  };

  const openRateRecalculation = () => {
    if (settings.incognitoEnabled) {
      setNotice({
        tone: 'error',
        text: 'Вимкніть режим інкогніто, щоб змінювати фінансові дані.'
      });
      return;
    }

    setRecalculationPeriod(EMPTY_RECALCULATION_PERIOD);
    setRecalculationCalendarMonth(getCurrentCalendarMonth());
    setRecalculationPreviewCount(null);
    setRecalculationError(null);
    setNotice(null);
    setIsRecalculationOpen(true);
  };

  const moveRecalculationCalendarMonth = (direction: -1 | 1) => {
    const next = new Date(
      recalculationCalendarMonth.year,
      recalculationCalendarMonth.month - 1 + direction,
      1
    );

    setRecalculationCalendarMonth({
      year: next.getFullYear(),
      month: next.getMonth() + 1
    });
  };

  const syncRecalculationCalendarMonth = (date: string) => {
    const [year, month] = date.split('-').map(Number);

    if (
      year !== recalculationCalendarMonth.year ||
      month !== recalculationCalendarMonth.month
    ) {
      setRecalculationCalendarMonth({ year, month });
    }
  };

  const selectRecalculationDate = (date: string) => {
    const range = getSingleDateRange(date);

    syncRecalculationCalendarMonth(date);
    setRecalculationPeriod({ start: range.start, end: range.end ?? '' });
    setRecalculationError(null);
  };

  const holdRecalculationDate = (date: string) => {
    const selectedRange: CalendarDateRange | null = recalculationPeriod.start
      ? {
          start: recalculationPeriod.start,
          end: recalculationPeriod.end || null
        }
      : null;
    const range = getNextHeldCalendarRange(selectedRange, date);

    syncRecalculationCalendarMonth(date);
    setRecalculationPeriod({ start: range.start, end: range.end ?? '' });
    setRecalculationError(null);
  };

  const closeRateRecalculation = () => {
    if (isApplyingRate) {
      return;
    }

    setIsRecalculationOpen(false);
    setRecalculationPreviewCount(null);
    setRecalculationError(null);
  };

  const recalculateExistingShiftRates = async () => {
    if (!recalculationPeriod.start || !recalculationPeriod.end) {
      setRecalculationError('Вкажіть початок і завершення періоду.');
      return;
    }

    if (recalculationPeriod.start > recalculationPeriod.end) {
      setRecalculationError('Дата початку не може бути пізніше дати завершення.');
      return;
    }

    const monthlySalary = parseNumber(values.monthlySalary);

    if (!Number.isFinite(monthlySalary) || monthlySalary < 0) {
      setErrors((current) => ({
        ...current,
        monthlySalary: 'Ставка за місяць не може бути відʼємною.'
      }));
      setRecalculationError('Перевірте ставку за місяць у налаштуваннях.');
      return;
    }

    const gradeSalaryBonusPercents = parsePercentFormValues(values.gradeSalaryBonusPercents);
    const gradeNormPercents = parsePercentFormValues(values.gradeNormPercents);

    if (gradeSalaryBonusPercents.some((percent) => !Number.isFinite(percent) || percent < 0)) {
      setErrors((current) => ({
        ...current,
        gradeSalaryBonusPercents: 'Надбавки до ЗП не можуть бути відʼємними.'
      }));
      setRecalculationError('Перевірте надбавки до ЗП у налаштуваннях.');
      return;
    }

    if (gradeNormPercents.some((percent) => !Number.isFinite(percent) || percent < 0)) {
      setErrors((current) => ({
        ...current,
        gradeNormPercents: 'Норми рівнів не можуть бути відʼємними.'
      }));
      setRecalculationError('Перевірте норми рівнів у налаштуваннях.');
      return;
    }

    setIsApplyingRate(true);
    setRecalculationError(null);
    setNotice(null);

    const updatedAt = toLocalIsoString(new Date());
    const currentGrade = parseGrade(values.currentGrade);
    const desiredGradeDraft = parseGrade(values.desiredGrade);
    const nextGradeSettings = {
      currentGrade,
      desiredGrade: desiredGradeDraft < currentGrade ? currentGrade : desiredGradeDraft,
      gradeSalaryBonusPercents,
      gradeNormPercents
    };
    const nextSettings: Settings = {
      ...settings,
      monthlySalary,
      ...nextGradeSettings,
      updatedAt
    };

    try {
      await onSettingsChange(nextSettings);
      const updatedCount = await recalculateHourlyRateSnapshotsForPeriod(
        shiftRepository,
        monthlySalary,
        nextGradeSettings,
        recalculationPeriod,
        updatedAt
      );

      onLocalDataChange?.();
      setIsRecalculationOpen(false);
      setRecalculationPeriod(EMPTY_RECALCULATION_PERIOD);
      setNotice({
        tone: 'success',
        text: `Ставки й рівні перераховано за ${formatMoney(monthlySalary, false)}/міс. Перераховано змін: ${updatedCount}. Період: ${formatDate(recalculationPeriod.start)} — ${formatDate(recalculationPeriod.end)}.`
      });
    } catch {
      setRecalculationError('Не вдалося перерахувати ставки у вибраному періоді.');
    } finally {
      setIsApplyingRate(false);
    }
  };

  const toggleIncognito = async () => {
    setIsSaving(true);
    setNotice(null);

    try {
      await onSettingsChange({
        ...settings,
        incognitoEnabled: !settings.incognitoEnabled,
        updatedAt: toLocalIsoString(new Date())
      });
    } catch {
      setNotice({ tone: 'error', text: 'Не вдалося змінити режим інкогніто.' });
    } finally {
      setIsSaving(false);
    }
  };

  const updateThemePreference = async (event: ChangeEvent<HTMLSelectElement>) => {
    const themePreference = event.target.value as ThemePreference;

    setIsSaving(true);
    setNotice(null);

    try {
      await onSettingsChange({
        ...settings,
        themePreference,
        updatedAt: toLocalIsoString(new Date())
      });
    } catch {
      setNotice({ tone: 'error', text: 'Не вдалося змінити тему.' });
    } finally {
      setIsSaving(false);
    }
  };

  const exportBackup = async () => {
    setIsBackupBusy(true);
    setNotice(null);

    try {
      const exportedAt = toLocalIsoString(new Date());
      const backup = await downloadBackup(localDb, exportedAt);
      await backupReminderRepository.markExported(backup.exportedAt);
      onLocalDataChange?.();
      setNotice({ tone: 'success', text: 'JSON backup створено.' });
    } catch {
      setNotice({ tone: 'error', text: 'Не вдалося створити JSON backup.' });
    } finally {
      setIsBackupBusy(false);
    }
  };

  const openImportPicker = () => {
    importInputRef.current?.click();
  };

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) {
      return;
    }

    setIsBackupBusy(true);
    setNotice(null);

    try {
      const source = await file.text();
      const parsedImport = parseBackupImportJson(source);

      if (parsedImport.kind === 'legacy') {
        if (
          !window.confirm(
            `Старий backup містить ${parsedImport.shifts.length} змін. Поточну історію змін буде повністю замінено, а налаштування та графік підприємства залишаться без змін. Продовжити?`
          )
        ) {
          return;
        }

        await replaceShiftsFromLegacyBackup(localDb, parsedImport.shifts);
        await backupReminderRepository.resetAnchor(toLocalIsoString(new Date()));
        onLocalDataChange?.();
        setNotice({
          tone: 'success',
          text: `Стару історію імпортовано. Змін: ${parsedImport.shifts.length}. Налаштування та графік не змінено.`
        });
      } else {
        const { backup } = parsedImport;

        if (
          !window.confirm(
            'Імпорт backup повністю замінить поточні локальні дані: налаштування, зміни та графік підприємства. Продовжити?'
          )
        ) {
          return;
        }

        const restoredSettings = await restoreBackup(localDb, backup);
        await backupReminderRepository.resetAnchor(toLocalIsoString(new Date()));

        setValues(toFormValues(restoredSettings));
        setErrors({});
        onLocalDataReplace(restoredSettings);
        setNotice({
          tone: 'success',
          text: `Backup імпортовано. Змін: ${backup.shifts.length}, записів графіка: ${backup.enterpriseSchedule.length}.`
        });
      }
    } catch (error) {
      setNotice({ tone: 'error', text: getImportErrorMessage(error) });
    } finally {
      setIsBackupBusy(false);
    }
  };

  const clearShifts = async () => {
    if (!window.confirm('Очистити всі зміни? Налаштування залишаться без змін.')) {
      return;
    }

    setIsClearing(true);
    setNotice(null);

    try {
      await localDb.transaction('rw', localDb.shifts, localDb.appMeta, async () => {
        await localDb.shifts.clear();
        await localDb.appMeta
          .where('key')
          .startsWith(SCHEDULE_WARNING_REVIEW_PREFIX)
          .delete();
      });
      onLocalDataChange?.();
      setNotice({ tone: 'success', text: 'Зміни очищено.' });
    } catch {
      setNotice({ tone: 'error', text: 'Не вдалося очистити зміни.' });
    } finally {
      setIsClearing(false);
    }
  };

  const clearAll = async () => {
    if (
      !window.confirm(
        'Очистити всі локальні дані? Зміни, графік і налаштування будуть скинуті.'
      )
    ) {
      return;
    }

    setIsClearing(true);
    setNotice(null);

    try {
      const resetSettings: Settings = {
        ...DEFAULT_SETTINGS,
        updatedAt: toLocalIsoString(new Date())
      };

      await localDb.transaction(
        'rw',
        localDb.shifts,
        localDb.enterpriseSchedule,
        localDb.appMeta,
        localDb.settings,
        async () => {
          await localDb.shifts.clear();
          await localDb.enterpriseSchedule.clear();
          await localDb.appMeta.clear();
          await localDb.settings.clear();
        }
      );
      await onSettingsChange(resetSettings);
      setValues(toFormValues(resetSettings));
      setErrors({});
      await backupReminderRepository.resetAnchor(toLocalIsoString(new Date()));
      onLocalDataChange?.();
      setNotice({ tone: 'success', text: 'Локальні дані очищено.' });
    } catch {
      setNotice({ tone: 'error', text: 'Не вдалося очистити всі дані.' });
    } finally {
      setIsClearing(false);
    }
  };

  const replaceWithDemoData = async () => {
    if (
      !window.confirm(
        'Повністю замінити поточні локальні дані демо-набором за попередній і поточний місяці?'
      )
    ) {
      return;
    }

    setIsClearing(true);
    setNotice(null);

    try {
      const now = toLocalIsoString(new Date());
      const demoData = await replaceLocalDataWithDemo(localDb, now.slice(0, 10), now);
      await backupReminderRepository.resetAnchor(now);

      setValues(toFormValues(demoData.settings));
      setErrors({});
      onLocalDataReplace(demoData.settings);
      onLocalDataChange?.();
      setNotice({
        tone: 'success',
        text: `Демо-дані створено за ${demoData.range.start}–${demoData.range.end}: ${demoData.shifts.length} змін і ${demoData.enterpriseSchedule.length} записів графіка.`
      });
    } catch {
      setNotice({ tone: 'error', text: 'Не вдалося створити демо-дані.' });
    } finally {
      setIsClearing(false);
    }
  };

  const financialValue = (rawValue: string): string =>
    settings.incognitoEnabled ? INCOGNITO_FINANCIAL_MASK : rawValue;
  const parsedMonthlySalary = parseNumber(values.monthlySalary);
  const previewMonthlySalary =
    settings.incognitoEnabled || !Number.isFinite(parsedMonthlySalary)
      ? settings.monthlySalary
      : parsedMonthlySalary;
  const currentMonthDate = toLocalIsoString(new Date()).slice(0, 10);
  const previewCurrentGrade = settings.incognitoEnabled
    ? settings.currentGrade
    : parseGrade(values.currentGrade);
  const previewGradeSalaryBonusPercents = settings.incognitoEnabled
    ? settings.gradeSalaryBonusPercents
    : parsePercentFormValues(values.gradeSalaryBonusPercents).some((percent) => !Number.isFinite(percent))
      ? settings.gradeSalaryBonusPercents
      : parsePercentFormValues(values.gradeSalaryBonusPercents);
  const currentHourlyRate = calculateHourlyRateFromMonthlySalary(
    previewMonthlySalary,
    currentMonthDate
  );
  const currentGradeBonus = calculateGradeMonthlyBonus(
    previewMonthlySalary,
    calculateCumulativeGradePercent(
      previewCurrentGrade,
      previewGradeSalaryBonusPercents
    )
  );
  const isDirty = JSON.stringify(values) !== JSON.stringify(toFormValues(settings));
  const employeeSummary = [values.employeeFirstName.trim(), values.employeeLastName.trim()]
    .filter(Boolean)
    .join(' ') || 'Не вказано';
  const themeLabels: Record<ThemePreference, string> = {
    system: 'Системна',
    light: 'Світла',
    dark: 'Темна'
  };

  const discardChanges = () => {
    setValues(toFormValues(settings));
    setErrors({});
    setNotice({ tone: 'info', text: 'Незбережені зміни скасовано.' });
  };

  return (
    <form
      ref={formRef}
      className={`settings-page${isDirty ? ' settings-page--dirty' : ''}`}
      onSubmit={saveSettings}
      noValidate
    >
      <div className="settings-page__intro">
        <div>
          <span>Оберіть розділ</span>
          <p>Змінюйте лише потрібні параметри, не переглядаючи всю форму.</p>
        </div>
      </div>

      <SettingsSection
        id="employee"
        title="Працівник"
        description="Імʼя для змін і копіювання"
        summary={employeeSummary}
        icon={UserRound}
      >
        <label className="settings-page__field">
          <span>Імʼя</span>
          <input
            autoComplete="given-name"
            aria-invalid={errors.employeeFirstName ? 'true' : 'false'}
            aria-describedby={errors.employeeFirstName ? 'employeeFirstName-error' : undefined}
            value={values.employeeFirstName}
            onChange={updateField('employeeFirstName')}
          />
          {errors.employeeFirstName ? (
            <small id="employeeFirstName-error">{errors.employeeFirstName}</small>
          ) : null}
        </label>

        <label className="settings-page__field">
          <span>Прізвище</span>
          <input
            autoComplete="family-name"
            aria-invalid={errors.employeeLastName ? 'true' : 'false'}
            aria-describedby={errors.employeeLastName ? 'employeeLastName-error' : undefined}
            value={values.employeeLastName}
            onChange={updateField('employeeLastName')}
          />
          {errors.employeeLastName ? (
            <small id="employeeLastName-error">{errors.employeeLastName}</small>
          ) : null}
        </label>
      </SettingsSection>

      <SettingsSection
        id="payment"
        title="Оплата"
        description="Місячна ставка та премія"
        summary={formatMoney(previewMonthlySalary, settings.incognitoEnabled)}
        icon={WalletCards}
      >
        <label className="settings-page__field">
          <span>Ставка за місяць, ₴</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            pattern="[0-9]*([.,][0-9]*)?"
            disabled={settings.incognitoEnabled}
            aria-invalid={errors.monthlySalary ? 'true' : 'false'}
            aria-describedby={errors.monthlySalary ? 'monthlySalary-error' : undefined}
            value={financialValue(values.monthlySalary)}
            onChange={updateField('monthlySalary')}
          />
          <small>
            Базова погодинна: {formatHourlyRate(currentHourlyRate, settings.incognitoEnabled)} · премія за рівень:{' '}
            {formatMoney(currentGradeBonus, settings.incognitoEnabled)}/міс
          </small>
          {errors.monthlySalary ? (
            <small id="monthlySalary-error">{errors.monthlySalary}</small>
          ) : null}
        </label>

        <button
          className="settings-page__secondary-action"
          type="button"
          disabled={settings.incognitoEnabled || isApplyingRate}
          onClick={openRateRecalculation}
        >
          <RotateCcw size={18} aria-hidden="true" />
          {isApplyingRate ? 'Перерахунок...' : 'Перерахувати історію'}
        </button>

        <label className="settings-page__field">
          <span>Премія за місяць, ₴</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            pattern="[0-9]*([.,][0-9]*)?"
            disabled={settings.incognitoEnabled}
            aria-invalid={errors.monthlyBonus ? 'true' : 'false'}
            aria-describedby={errors.monthlyBonus ? 'monthlyBonus-error' : undefined}
            value={financialValue(values.monthlyBonus)}
            onChange={updateField('monthlyBonus')}
          />
          {errors.monthlyBonus ? (
            <small id="monthlyBonus-error">{errors.monthlyBonus}</small>
          ) : null}
        </label>
      </SettingsSection>

      <SettingsSection
        id="overtime"
        title="Перепрацювання"
        description="Ліміт, стратегія та денні максимуми"
        summary={`${values.overtimeLimitPercent}% · ${OVERTIME_STRATEGY_LABELS[values.overtimeStrategy]}`}
        icon={CalendarClock}
      >
        <div className="settings-page__grid">
          <label className="settings-page__field">
            <span>Ліміт від планових годин, %</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              pattern="[0-9]*([.,][0-9]*)?"
              aria-invalid={errors.overtimeLimitPercent ? 'true' : 'false'}
              aria-describedby={
                errors.overtimeLimitPercent
                  ? 'overtimeLimitPercent-error'
                  : 'overtimeLimitPercent-help'
              }
              value={values.overtimeLimitPercent}
              onChange={updateField('overtimeLimitPercent')}
            />
            <small id="overtimeLimitPercent-help">
              0% вимикає планувальник. План місяця — будні 5/2 по 8 годин;
              коефіцієнт впливає лише на гроші.
            </small>
            {errors.overtimeLimitPercent ? (
              <small id="overtimeLimitPercent-error">{errors.overtimeLimitPercent}</small>
            ) : null}
          </label>

          <label className="settings-page__field">
            <span>Крок рекомендацій, хв</span>
            <input
              type="number"
              inputMode="numeric"
              min={OVERTIME_STEP_MINUTES_MIN}
              max={OVERTIME_STEP_MINUTES_MAX}
              step={5}
              aria-invalid={errors.overtimeStepMinutes ? 'true' : 'false'}
              aria-describedby={
                errors.overtimeStepMinutes
                  ? 'overtimeStepMinutes-error'
                  : 'overtimeStepMinutes-help'
              }
              value={values.overtimeStepMinutes}
              onChange={updateField('overtimeStepMinutes')}
            />
            <small id="overtimeStepMinutes-help">
              Від {OVERTIME_STEP_MINUTES_MIN} до {OVERTIME_STEP_MINUTES_MAX} хв,
              кратно 5.
            </small>
            {errors.overtimeStepMinutes ? (
              <small id="overtimeStepMinutes-error">{errors.overtimeStepMinutes}</small>
            ) : null}
          </label>

          <label className="settings-page__field">
            <span>Стратегія</span>
            <select
              aria-label="Стратегія перепрацювань"
              aria-invalid={errors.overtimeStrategy ? 'true' : 'false'}
              value={values.overtimeStrategy}
              onChange={updateField('overtimeStrategy')}
            >
              <option value="standard">Стандарт</option>
              <option value="standard-plus">Стандарт+</option>
              <option value="standard-plus-plus">Стандарт++</option>
            </select>
            <small>{OVERTIME_STRATEGY_DESCRIPTIONS[values.overtimeStrategy]}</small>
            {errors.overtimeStrategy ? (
              <small id="overtimeStrategy-error">{errors.overtimeStrategy}</small>
            ) : null}
          </label>

          <label className="settings-page__field">
            <span>Перепрацювання до</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={5}
              placeholder="ГГ:ХХ"
              aria-invalid={errors.overtimeWeekdayEndTime ? 'true' : 'false'}
              aria-describedby={
                errors.overtimeWeekdayEndTime
                  ? 'overtimeWeekdayEndTime-error'
                  : undefined
              }
              value={values.overtimeWeekdayEndTime}
              onBlur={normalizeTimeField('overtimeWeekdayEndTime')}
              onChange={updateTimeField('overtimeWeekdayEndTime')}
            />
            {errors.overtimeWeekdayEndTime ? (
              <small id="overtimeWeekdayEndTime-error">
                {errors.overtimeWeekdayEndTime}
              </small>
            ) : null}
          </label>

          <label className="settings-page__field">
            <span>Робота в суботу до</span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={5}
              placeholder="ГГ:ХХ"
              aria-invalid={errors.overtimeSaturdayEndTime ? 'true' : 'false'}
              aria-describedby={
                errors.overtimeSaturdayEndTime
                  ? 'overtimeSaturdayEndTime-error'
                  : undefined
              }
              value={values.overtimeSaturdayEndTime}
              onBlur={normalizeTimeField('overtimeSaturdayEndTime')}
              onChange={updateTimeField('overtimeSaturdayEndTime')}
            />
            {errors.overtimeSaturdayEndTime ? (
              <small id="overtimeSaturdayEndTime-error">
                {errors.overtimeSaturdayEndTime}
              </small>
            ) : null}
          </label>

        </div>
      </SettingsSection>

      <SettingsSection
        id="grades"
        title="Рівні"
        description="Премії та норми виробітку"
        summary={`G${values.currentGrade} → G${values.desiredGrade}`}
        icon={Trophy}
      >
        <div className="settings-page__grade-selects">
          <label className="settings-page__field">
            <span>Поточний рівень</span>
            <select
              disabled={settings.incognitoEnabled}
              aria-invalid={errors.currentGrade ? 'true' : 'false'}
              aria-describedby={errors.currentGrade ? 'currentGrade-error' : undefined}
              value={settings.incognitoEnabled ? String(settings.currentGrade) : values.currentGrade}
              onChange={updateGradeValue('currentGrade')}
            >
              {GRADE_VALUES.map((grade) => (
                <option value={grade} key={grade}>
                  Рівень G{grade}
                </option>
              ))}
            </select>
            {errors.currentGrade ? (
              <small id="currentGrade-error">{errors.currentGrade}</small>
            ) : null}
          </label>

          <label className="settings-page__field">
            <span>Бажаний рівень</span>
            <select
              aria-invalid={errors.desiredGrade ? 'true' : 'false'}
              aria-describedby={errors.desiredGrade ? 'desiredGrade-error' : undefined}
              value={values.desiredGrade}
              onChange={updateGradeValue('desiredGrade')}
            >
              {GRADE_VALUES.map((grade) => (
                <option value={grade} key={grade}>
                  Рівень G{grade}
                </option>
              ))}
            </select>
            {errors.desiredGrade ? (
              <small id="desiredGrade-error">{errors.desiredGrade}</small>
            ) : null}
          </label>
        </div>

        <div className="settings-page__grade-block">
          <div className="settings-page__grade-block-header">
            <h3>Премія за рівень від ставки</h3>
            <span aria-hidden="true">%</span>
          </div>
          <div className="settings-page__grade-grid">
            {values.gradeSalaryBonusPercents.map((value, index) => (
              <label className="settings-page__field settings-page__grade-field" key={`salary-grade-${index}`}>
                <span>Рівень G{index + 1}</span>
                <span className="settings-page__grade-input">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    pattern="[0-9]*([.,][0-9]*)?"
                    disabled={settings.incognitoEnabled}
                    value={settings.incognitoEnabled ? INCOGNITO_FINANCIAL_MASK : value}
                    onChange={updateGradePercent('gradeSalaryBonusPercents', index)}
                  />
                  <span aria-hidden="true">%</span>
                </span>
              </label>
            ))}
          </div>
          {errors.gradeSalaryBonusPercents ? (
            <small className="settings-page__field-error">{errors.gradeSalaryBonusPercents}</small>
          ) : null}
        </div>

        <div className="settings-page__grade-block">
          <div className="settings-page__grade-block-header">
            <h3>Норма від тікета</h3>
            <span aria-hidden="true">%</span>
          </div>
          <div className="settings-page__grade-grid">
            {values.gradeNormPercents.map((value, index) => (
              <label className="settings-page__field settings-page__grade-field" key={`norm-grade-${index}`}>
                <span>Рівень G{index + 1}</span>
                <span className="settings-page__grade-input">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    pattern="[0-9]*([.,][0-9]*)?"
                    value={value}
                    onChange={updateGradePercent('gradeNormPercents', index)}
                  />
                  <span aria-hidden="true">%</span>
                </span>
              </label>
            ))}
          </div>
          {errors.gradeNormPercents ? (
            <small className="settings-page__field-error">{errors.gradeNormPercents}</small>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        id="timer"
        title="Таймер"
        description="Захист від випадкового натискання"
        summary={`${values.holdDelaySeconds} с`}
        icon={TimerReset}
      >
        <div className="settings-page__grid">
          <label className="settings-page__field">
            <span>Затримка кнопок, с</span>
            <input
              type="text"
              inputMode="decimal"
              autoComplete="off"
              pattern="[0-9]*([.,][0-9]*)?"
              aria-invalid={errors.holdDelaySeconds ? 'true' : 'false'}
              aria-describedby={errors.holdDelaySeconds ? 'holdDelaySeconds-error' : undefined}
              value={values.holdDelaySeconds}
              onChange={updateField('holdDelaySeconds')}
            />
            {errors.holdDelaySeconds ? (
              <small id="holdDelaySeconds-error">{errors.holdDelaySeconds}</small>
            ) : null}
          </label>
        </div>
      </SettingsSection>

      <SettingsSection
        id="appearance"
        title="Вигляд"
        description="Тема інтерфейсу"
        summary={themeLabels[settings.themePreference]}
        icon={Palette}
      >
        <label className="settings-page__field">
          <span>Тема</span>
          <select
            value={settings.themePreference}
            disabled={isSaving}
            onChange={(event) => void updateThemePreference(event)}
          >
            <option value="system">Системна</option>
            <option value="light">Світла</option>
            <option value="dark">Темна</option>
          </select>
          <small>
            Системна тема автоматично повторює налаштування Android або iOS.
          </small>
        </label>
      </SettingsSection>

      <SettingsSection
        id="privacy"
        title="Конфіденційність"
        description="Маскування фінансових даних"
        summary={settings.incognitoEnabled ? 'Увімкнено' : 'Вимкнено'}
        icon={Shield}
      >
        <button
          className="settings-page__toggle"
          type="button"
          aria-pressed={settings.incognitoEnabled}
          disabled={isSaving}
          onClick={toggleIncognito}
        >
          <span className="settings-page__toggle-icon">
            <Shield size={20} aria-hidden="true" />
          </span>
          <span className="settings-page__toggle-copy">
            <strong>Режим інкогніто</strong>
            <small>
              {settings.incognitoEnabled
                ? 'Фінанси приховано.'
                : `Ставка: ${formatMoney(settings.monthlySalary, false)}/міс, рівень G${settings.currentGrade}`}
            </small>
          </span>
          <span className="settings-page__switch" aria-hidden="true" />
        </button>
      </SettingsSection>

      <SettingsSection
        id="data"
        title="Дані та backup"
        description="Експорт, імпорт і очищення"
        summary={`Кожні ${values.backupReminderIntervalDays} днів`}
        icon={Database}
      >
        <label className="settings-page__field">
          <span>Нагадувати про backup</span>
          <select
            aria-invalid={errors.backupReminderIntervalDays ? 'true' : 'false'}
            aria-describedby={
              errors.backupReminderIntervalDays
                ? 'backupReminderIntervalDays-error'
                : 'backupReminderIntervalDays-help'
            }
            value={values.backupReminderIntervalDays}
            onChange={updateField('backupReminderIntervalDays')}
          >
            {BACKUP_REMINDER_INTERVAL_DAYS.map((days) => (
              <option value={days} key={days}>
                Кожні {days} днів
              </option>
            ))}
          </select>
          <small id="backupReminderIntervalDays-help">
            Як зробити: натисніть «Експорт» нижче та збережіть JSON-файл у надійному
            місці. Після цього нагадування зникне.
          </small>
          {errors.backupReminderIntervalDays ? (
            <small id="backupReminderIntervalDays-error">
              {errors.backupReminderIntervalDays}
            </small>
          ) : null}
        </label>
        <div className="settings-page__actions">
          <button
            type="button"
            aria-label="Експорт даних"
            title="Експорт даних"
            disabled={isBackupBusy}
            onClick={() => void exportBackup()}
          >
            <Download size={18} aria-hidden="true" />
            Експорт
          </button>
          <button
            type="button"
            className="settings-page__warning"
            aria-label="Імпорт даних"
            title="Імпорт даних"
            disabled={isBackupBusy}
            onClick={openImportPicker}
          >
            <FileUp size={18} aria-hidden="true" />
            Імпорт
          </button>
          <input
            ref={importInputRef}
            className="settings-page__file-input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importBackup(event)}
          />
          <button
            type="button"
            className="settings-page__danger"
            aria-label="Очистити зміни"
            title="Очистити зміни"
            disabled={isClearing}
            onClick={clearShifts}
          >
            <Eraser size={18} aria-hidden="true" />
            Очистити зміни
          </button>
          <button
            type="button"
            className="settings-page__danger settings-page__danger--strong"
            aria-label="Очистити"
            title="Очистити"
            disabled={isClearing}
            onClick={clearAll}
          >
            <RotateCcw size={18} aria-hidden="true" />
            Очистити все
          </button>
          {import.meta.env.DEV ? (
            <button
              type="button"
              className="settings-page__demo"
              aria-label="Створити демо-дані за два місяці"
              title="Створити демо-дані за два місяці"
              disabled={isClearing}
              onClick={() => void replaceWithDemoData()}
            >
              <FlaskConical size={18} aria-hidden="true" />
              Демо 2 міс.
            </button>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection
        id="help"
        title="Допомога"
        description="Календар і щоденні сценарії"
        summary={`${FAQ_ITEMS.length} відповідей`}
        icon={CircleHelp}
      >
        <button
          className="settings-page__help-button"
          type="button"
          onClick={onOpenCalendarTutorial}
        >
          <CalendarDays size={19} aria-hidden="true" />
          Як користуватися календарем
        </button>

        <details className="settings-page__faq-dropdown">
          <summary>
            <span
              id="faq-settings-title"
              className="settings-page__faq-title"
              role="heading"
              aria-level={2}
            >
              FAQ
            </span>
            <span className="settings-page__faq-count">{FAQ_ITEMS.length} питань</span>
            <ChevronDown size={20} aria-hidden="true" />
          </summary>
          <div className="settings-page__faq">
            {FAQ_ITEMS.map((item) => (
              <details key={item.question}>
                <summary>{item.question}</summary>
                {item.steps ? (
                  <ol>
                    {item.steps.map((step) => (
                      <li key={step.title}>
                        <strong>{step.title}</strong>
                        <span>{step.description}</span>
                      </li>
                    ))}
                  </ol>
                ) : null}
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </details>
      </SettingsSection>

      <SettingsSection
        id="information"
        title="Про застосунок"
        description="Версія та зворотний звʼязок"
        summary={`v${appPackage.version}`}
        icon={Info}
      >
        <a
          className="settings-page__feedback-link"
          href="https://t.me/natuselit"
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Зворотний звʼязок у Telegram"
        >
          <span>Зворотний звʼязок</span>
        </a>
        <div className="settings-page__readonly-row">
          <span>Версія додатку</span>
          <strong>{appPackage.version}</strong>
        </div>
        <div className="settings-page__readonly-row">
          <span>Дата останнього оновлення</span>
          <strong>{formatDateTime(settings.updatedAt)}</strong>
        </div>
      </SettingsSection>

      {isRecalculationOpen ? (
        <div
          className="settings-page__modal-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeRateRecalculation();
            }
          }}
        >
          <section
            className="settings-page__modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rate-recalculation-title"
          >
            <header className="settings-page__modal-header">
              <div>
                <p>Оплата</p>
                <h2 id="rate-recalculation-title">Перерахувати історію</h2>
              </div>
              <button
                type="button"
                aria-label="Закрити перерахунок історії"
                disabled={isApplyingRate}
                onClick={closeRateRecalculation}
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <p className="settings-page__modal-copy">
              Оберіть включний період. Базова ставка та рівні будуть перезаписані лише
              у змінах із цього діапазону.
            </p>

            <div className="settings-page__recalculation-calendar">
              <MonthCalendar
                year={recalculationCalendarMonth.year}
                month={recalculationCalendarMonth.month}
                salaryLabel=""
                shiftCount={0}
                hoursLabel=""
                shifts={[]}
                selectedRange={
                  recalculationPeriod.start
                    ? {
                        start: recalculationPeriod.start,
                        end: recalculationPeriod.end || null
                      }
                    : null
                }
                onPreviousMonth={() => moveRecalculationCalendarMonth(-1)}
                onNextMonth={() => moveRecalculationCalendarMonth(1)}
                onDateSelect={selectRecalculationDate}
                onDateHold={holdRecalculationDate}
                titleId="rate-recalculation-calendar-title"
                hideSummary
              />
            </div>

            {recalculationPeriod.start &&
            recalculationPeriod.end &&
            recalculationPeriod.start <= recalculationPeriod.end ? (
              <p className="settings-page__recalculation-preview" aria-live="polite">
                {recalculationPreviewCount === null
                  ? 'Підрахунок змін…'
                  : `Період: ${formatDate(recalculationPeriod.start)} — ${formatDate(recalculationPeriod.end)}. Буде перераховано змін: ${recalculationPreviewCount}.`}
              </p>
            ) : null}

            {recalculationError ? (
              <p className="settings-page__modal-error" role="alert">
                {recalculationError}
              </p>
            ) : null}

            <div className="settings-page__modal-actions">
              <button type="button" disabled={isApplyingRate} onClick={closeRateRecalculation}>
                Скасувати
              </button>
              <button
                type="button"
                disabled={
                  isApplyingRate ||
                  (Boolean(recalculationPeriod.start && recalculationPeriod.end) &&
                    recalculationPeriod.start <= recalculationPeriod.end &&
                    recalculationPreviewCount === null)
                }
                onClick={() => void recalculateExistingShiftRates()}
              >
                <RotateCcw size={18} aria-hidden="true" />
                {isApplyingRate ? 'Перерахунок...' : 'Перерахувати'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {notice ? (
        <p className="settings-page__notice" data-tone={notice.tone} role="status">
          {notice.text}
        </p>
      ) : null}

      {isDirty ? (
        <div className="settings-page__save-bar" aria-label="Незбережені зміни">
          <button
            className="settings-page__discard"
            type="button"
            disabled={isSaving}
            onClick={discardChanges}
          >
            Скасувати
          </button>
          <button
            className="settings-page__submit"
            type="submit"
            aria-label="Зберегти налаштування"
            disabled={isSaving}
          >
            <Save size={18} aria-hidden="true" />
            {isSaving ? 'Збереження...' : 'Зберегти'}
          </button>
        </div>
      ) : null}
    </form>
  );
}
