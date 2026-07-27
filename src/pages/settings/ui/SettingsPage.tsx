import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Download, Eraser, FileUp, FlaskConical, RotateCcw, Save, Shield } from 'lucide-react';
import appPackage from '../../../../package.json';
import {
  DEFAULT_SETTINGS,
  GRADE_VALUES,
  HOLD_DELAY_MAX_MS,
  HOLD_DELAY_MIN_MS,
  calculateCumulativeGradePercent,
  calculateGradeMonthlyBonus,
  calculateHourlyRateFromMonthlySalary,
  getNextDesiredGrade,
  type Grade,
  type GradePercentSet,
  type Settings,
  type ThemePreference
} from '../../../entities/settings';
import { INCOGNITO_FINANCIAL_MASK, formatHourlyRate, formatMoney } from '../../../shared/lib/format';
import {
  BackupValidationError,
  createBackup,
  localDb,
  parseBackupImportJson,
  recalculateHourlyRateSnapshotsForAllShifts,
  replaceShiftsFromLegacyBackup,
  replaceLocalDataWithDemo,
  restoreBackup,
  ShiftRepository,
  serializeBackup
} from '../../../shared/lib/local-db';
import { toLocalIsoString } from '../../../shared/lib/date-time';
import './SettingsPage.css';

type SettingsPageProps = {
  settings: Settings;
  onSettingsChange: (settings: Settings) => Promise<void>;
  onLocalDataReplace: (settings: Settings) => void;
  onLocalDataChange?: () => void;
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
};

type FormErrors = Partial<Record<keyof FormValues, string>>;
type Notice = {
  tone: 'success' | 'error' | 'info';
  text: string;
};

const delayMinSeconds = HOLD_DELAY_MIN_MS / 1000;
const delayMaxSeconds = HOLD_DELAY_MAX_MS / 1000;
const FAQ_ITEMS = [
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
      'В автоматичному режимі плановий час оплачується за x1, а час до початку або після завершення планової зміни — за x1.5. Ручні x1, x1.5 або x2 діють на всю зміну.'
  },
  {
    question: 'Як працюють тікети та простій?',
    answer:
      'Одночасно активний лише один тікет. Простій зменшує продуктивний час; його можна коригувати цілими хвилинами через додавання або віднімання.'
  },
  {
    question: 'Як рахуються оплата та грейди?',
    answer:
      'Базова погодинна ставка для нової зміни рахується з місячної ставки, робочих днів 5/2 і восьми годин. Грейдова премія додається окремо за повний календарний місяць.'
  },
  {
    question: 'Що робить режим інкогніто?',
    answer:
      'Інкогніто приховує фінансові значення та блокує редагування грошових полів, але не видаляє й не змінює реальні дані.'
  },
  {
    question: 'Як працюють backup та імпорт зі старого додатку?',
    answer:
      'Звичайний Shifter-backup повністю відновлює налаштування, зміни й графік. Backup старого додатку замінює лише історію змін, залишаючи чинні налаштування та графік.'
  },
  {
    question: 'Як імпортувати графік підприємства?',
    answer:
      'Відкрийте вкладку «Графік», вставте текст із датами та часом приходу/виходу, перевірте розпізнані записи й лише тоді застосуйте імпорт.'
  }
] as const;

const parseNumber = (value: string): number => Number(value.replace(',', '.'));

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
  holdDelaySeconds: String(settings.arriveHoldDelayMs / 1000)
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
    errors.currentGrade = 'Оберіть поточний грейд.';
  }

  if (!GRADE_VALUES.includes(desiredGrade as Grade)) {
    errors.desiredGrade = 'Оберіть бажаний грейд.';
  }

  if (
    !incognitoEnabled &&
    gradeSalaryBonusPercents.some((percent) => !Number.isFinite(percent) || percent < 0)
  ) {
    errors.gradeSalaryBonusPercents = 'Надбавки до ЗП не можуть бути відʼємними.';
  }

  if (gradeNormPercents.some((percent) => !Number.isFinite(percent) || percent < 0)) {
    errors.gradeNormPercents = 'Норми грейдів не можуть бути відʼємними.';
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

export function SettingsPage({
  settings,
  onSettingsChange,
  onLocalDataReplace,
  onLocalDataChange
}: SettingsPageProps) {
  const [values, setValues] = useState<FormValues>(() => toFormValues(settings));
  const [errors, setErrors] = useState<FormErrors>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isApplyingRate, setIsApplyingRate] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isBackupBusy, setIsBackupBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setValues(toFormValues(settings));
  }, [settings]);

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
      setNotice(null);
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
      return;
    }

    setIsSaving(true);
    setNotice(null);

    const holdDelayMs = Math.round(parseNumber(values.holdDelaySeconds) * 1000);
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

  const recalculateExistingShiftRates = async () => {
    const monthlySalary = parseNumber(values.monthlySalary);

    if (settings.incognitoEnabled) {
      setNotice({
        tone: 'error',
        text: 'Вимкніть режим інкогніто, щоб змінювати фінансові дані.'
      });
      return;
    }

    if (!Number.isFinite(monthlySalary) || monthlySalary < 0) {
      setErrors((current) => ({
        ...current,
        monthlySalary: 'Ставка за місяць не може бути відʼємною.'
      }));
      setNotice({ tone: 'error', text: 'Перевірте ставку за місяць.' });
      return;
    }

    const gradeSalaryBonusPercents = parsePercentFormValues(values.gradeSalaryBonusPercents);
    const gradeNormPercents = parsePercentFormValues(values.gradeNormPercents);

    if (gradeSalaryBonusPercents.some((percent) => !Number.isFinite(percent) || percent < 0)) {
      setErrors((current) => ({
        ...current,
        gradeSalaryBonusPercents: 'Надбавки до ЗП не можуть бути відʼємними.'
      }));
      setNotice({ tone: 'error', text: 'Перевірте надбавки до ЗП.' });
      return;
    }

    if (gradeNormPercents.some((percent) => !Number.isFinite(percent) || percent < 0)) {
      setErrors((current) => ({
        ...current,
        gradeNormPercents: 'Норми грейдів не можуть бути відʼємними.'
      }));
      setNotice({ tone: 'error', text: 'Перевірте норми грейдів.' });
      return;
    }

    if (
      !window.confirm(
        'Перерахувати базову ставку, грейд і ефективну ставку для всіх існуючих змін за поточними налаштуваннями? Snapshot-и в історії змін буде перезаписано.'
      )
    ) {
      return;
    }

    setIsApplyingRate(true);
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
      const updatedCount = await recalculateHourlyRateSnapshotsForAllShifts(
        shiftRepository,
        monthlySalary,
        nextGradeSettings,
        updatedAt
      );

      onLocalDataChange?.();
      setNotice({
        tone: 'success',
        text: `Ставки і грейди перераховано за ${formatMoney(monthlySalary, false)}/міс для ${updatedCount} змін.`
      });
    } catch {
      setNotice({ tone: 'error', text: 'Не вдалося перерахувати ставки у змінах.' });
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
      const backup = await createBackup(localDb, toLocalIsoString(new Date()));
      const blob = new Blob([serializeBackup(backup)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const datePart = backup.exportedAt.slice(0, 10);

      anchor.href = url;
      anchor.download = `shifter-backup-${datePart}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
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
      await localDb.shifts.clear();
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

  return (
    <form className="settings-page" onSubmit={saveSettings} noValidate>
      <section className="settings-page__section" aria-labelledby="employee-settings-title">
        <h2 id="employee-settings-title">Працівник</h2>
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
      </section>

      <section className="settings-page__section" aria-labelledby="payment-settings-title">
        <h2 id="payment-settings-title">Оплата</h2>
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
            Базова погодинна: {formatHourlyRate(currentHourlyRate, settings.incognitoEnabled)} · грейдова премія:{' '}
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
          onClick={() => void recalculateExistingShiftRates()}
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
      </section>

      <section className="settings-page__section" aria-labelledby="grade-settings-title">
        <h2 id="grade-settings-title">Грейди</h2>
        <div className="settings-page__grade-selects">
          <label className="settings-page__field">
            <span>Поточний грейд</span>
            <select
              disabled={settings.incognitoEnabled}
              aria-invalid={errors.currentGrade ? 'true' : 'false'}
              aria-describedby={errors.currentGrade ? 'currentGrade-error' : undefined}
              value={settings.incognitoEnabled ? String(settings.currentGrade) : values.currentGrade}
              onChange={updateGradeValue('currentGrade')}
            >
              {GRADE_VALUES.map((grade) => (
                <option value={grade} key={grade}>
                  Грейд {grade}
                </option>
              ))}
            </select>
            {errors.currentGrade ? (
              <small id="currentGrade-error">{errors.currentGrade}</small>
            ) : null}
          </label>

          <label className="settings-page__field">
            <span>Бажаний грейд</span>
            <select
              aria-invalid={errors.desiredGrade ? 'true' : 'false'}
              aria-describedby={errors.desiredGrade ? 'desiredGrade-error' : undefined}
              value={values.desiredGrade}
              onChange={updateGradeValue('desiredGrade')}
            >
              {GRADE_VALUES.map((grade) => (
                <option value={grade} key={grade}>
                  Грейд {grade}
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
            <h3>Грейдова премія від ставки</h3>
            <span aria-hidden="true">%</span>
          </div>
          <div className="settings-page__grade-grid">
            {values.gradeSalaryBonusPercents.map((value, index) => (
              <label className="settings-page__field settings-page__grade-field" key={`salary-grade-${index}`}>
                <span>Грейд {index + 1}</span>
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
                <span>Грейд {index + 1}</span>
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
      </section>

      <section className="settings-page__section" aria-labelledby="timer-settings-title">
        <h2 id="timer-settings-title">Таймер</h2>
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
      </section>

      <section className="settings-page__section" aria-labelledby="appearance-settings-title">
        <h2 id="appearance-settings-title">Вигляд</h2>
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
      </section>

      <section className="settings-page__section" aria-labelledby="privacy-settings-title">
        <h2 id="privacy-settings-title">Конфіденційність</h2>
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
                : `Ставка: ${formatMoney(settings.monthlySalary, false)}/міс, грейд ${settings.currentGrade}`}
            </small>
          </span>
          <span className="settings-page__switch" aria-hidden="true" />
        </button>
      </section>

      <section className="settings-page__section" aria-labelledby="data-settings-title">
        <h2 id="data-settings-title">Дані</h2>
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
      </section>

      <section className="settings-page__section" aria-labelledby="faq-settings-title">
        <h2 id="faq-settings-title">FAQ</h2>
        <div className="settings-page__faq">
          {FAQ_ITEMS.map((item) => (
            <details key={item.question}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="settings-page__section" aria-labelledby="info-settings-title">
        <h2 id="info-settings-title">Інформація</h2>
        <div className="settings-page__readonly-row">
          <span>Версія додатку</span>
          <strong>{appPackage.version}</strong>
        </div>
        <div className="settings-page__readonly-row">
          <span>Дата останнього оновлення</span>
          <strong>{formatDateTime(settings.updatedAt)}</strong>
        </div>
      </section>

      {notice ? (
        <p className="settings-page__notice" data-tone={notice.tone} role="status">
          {notice.text}
        </p>
      ) : null}

      <button className="settings-page__submit" type="submit" disabled={isSaving}>
        <Save size={18} aria-hidden="true" />
        {isSaving ? 'Збереження...' : 'Зберегти налаштування'}
      </button>
    </form>
  );
}
