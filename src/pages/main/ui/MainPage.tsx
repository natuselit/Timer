import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Edit3, Eye, EyeOff, Trash2, X } from 'lucide-react';
import { BottomNavigation } from '../../../widgets/bottom-navigation';
import { AppShell } from '../../../shared/ui/app-shell';
import {
  calculateGradeMonthlyBonus,
  calculateCumulativeGradePercent,
  calculateHourlyRateFromMonthlySalary,
  createGradeSnapshot,
  type Settings
} from '../../../entities/settings';
import { AnalyticsPage } from '../../analytics';
import { HistoryPage } from '../../history';
import { SchedulePage } from '../../schedule';
import { SettingsPage } from '../../settings';
import {
  calculateSalaryBreakdown,
  calculateTicketProductionSummary,
  getEffectiveCoefficient,
  type ISODateTimeString,
  type Shift,
  type WorkTicket
} from '../../../entities/shift';
import {
  adjustWorkTicketDowntime,
  addWorkTicketToActiveShift,
  completeWorkTicket,
  createShift,
  deleteWorkTicketFromActiveShift,
  EnterpriseScheduleRepository,
  getActiveShift,
  getLatestCompletedShift,
  getLocalDataDateBounds,
  localDb,
  ShiftConstraintError,
  ShiftRepository,
  updateWorkTicketInActiveShift,
  updateShift
} from '../../../shared/lib/local-db';
import {
  combineLocalDateAndTime,
  getCalendarPresetSelection,
  formatTimeInputDraft,
  formatDate,
  formatDurationMinutes,
  formatTime,
  getCurrentMonth,
  getDateFromDateTime,
  getDurationMinutes,
  getTimeInputValue,
  normalizeTimeInput,
  toLocalIsoString,
  type CalendarDateRange,
  type CalendarRangePreset
} from '../../../shared/lib/date-time';
import {
  INCOGNITO_FINANCIAL_MASK,
  formatHourlyRate,
  formatMoney
} from '../../../shared/lib/format';
import {
  copyTextToClipboard,
  formatShiftClipboardText
} from '../../../shared/lib/clipboard/shiftClipboard';
import type { NavigationItem } from '../../../shared/config/navigation';
import './MainPage.css';

type MainPageProps = {
  settings: Settings;
  dataVersion: number;
  onSettingsChange: (settings: Settings) => Promise<void>;
  onLocalDataReplace: (settings: Settings) => void;
};

type HoldButtonProps = {
  label: string;
  delayMs: number;
  disabled?: boolean;
  tone?: 'default' | 'danger';
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

const createEmptyTicketEditDraft = (): TicketEditDraft => ({
  normPerEightHours: '',
  startedAt: '',
  endedAt: '',
  actualQuantity: '',
  downtimeMinutes: '0'
});

const shiftRepository = new ShiftRepository(localDb);
const enterpriseScheduleRepository = new EnterpriseScheduleRepository(localDb);

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

const normalizeTicketNormDraft = (value: string): string => {
  const digits = value.replace(/\D/g, '');

  return digits === '' ? '' : String(Math.min(Number(digits), 999));
};

const normalizeSignedIntegerDraft = (value: string): string => {
  const trimmed = value.trim();
  const sign = trimmed.startsWith('-') ? '-' : trimmed.startsWith('+') ? '+' : '';
  const digits = trimmed.replace(/\D/g, '');

  return `${sign}${digits}`;
};

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

function HoldButton({ label, delayMs, disabled = false, tone = 'default', onConfirm }: HoldButtonProps) {
  const [isHolding, setIsHolding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  const clearHold = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    setIsHolding(false);
  };

  useEffect(() => clearHold, []);

  const startHold = () => {
    if (disabled || isSubmitting || timeoutRef.current !== null) {
      return;
    }

    setIsHolding(true);
    timeoutRef.current = window.setTimeout(async () => {
      timeoutRef.current = null;
      setIsHolding(false);
      setIsSubmitting(true);

      try {
        await onConfirm();
      } finally {
        setIsSubmitting(false);
      }
    }, delayMs);
  };

  return (
    <button
      className="main-page__hold-button"
      data-tone={tone}
      type="button"
      disabled={disabled || isSubmitting}
      aria-label={`${label}. Утримуйте ${Math.round(delayMs / 100) / 10} с`}
      onPointerDown={startHold}
      onPointerUp={clearHold}
      onPointerCancel={clearHold}
      onPointerLeave={clearHold}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span
        className="main-page__hold-progress"
        style={{
          transitionDuration: isHolding ? `${delayMs}ms` : '120ms',
          transform: isHolding ? 'scaleX(1)' : 'scaleX(0)'
        }}
      />
      <span className="main-page__hold-label">{isSubmitting ? 'Збереження...' : label}</span>
    </button>
  );
}

export function MainPage({
  settings,
  dataVersion,
  onSettingsChange,
  onLocalDataReplace
}: MainPageProps) {
  const [activePage, setActivePage] = useState<NavigationItem['id']>('timer');
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [latestCompletedShift, setLatestCompletedShift] = useState<Shift | null>(null);
  const [now, setNow] = useState(() => toLocalIsoString(new Date()));
  const [isLoadingShift, setIsLoadingShift] = useState(true);
  const [timerError, setTimerError] = useState<string | null>(null);
  const [ticketNormDraft, setTicketNormDraft] = useState('');
  const [editingTicketId, setEditingTicketId] = useState<string | null>(null);
  const [ticketEditDraft, setTicketEditDraft] = useState<TicketEditDraft>(
    createEmptyTicketEditDraft
  );
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [isAddingTicket, setIsAddingTicket] = useState(false);
  const [pendingTicketId, setPendingTicketId] = useState<string | null>(null);
  const [ticketActualDraft, setTicketActualDraft] = useState('');
  const [downtimeAdjustmentDraft, setDowntimeAdjustmentDraft] = useState('');
  const [isCompletingTicket, setIsCompletingTicket] = useState(false);
  const [clipboardNotice, setClipboardNotice] = useState<{
    tone: 'success' | 'warning';
    message: string;
  } | null>(null);
  const [isTogglingIncognito, setIsTogglingIncognito] = useState(false);
  const [localDataRefreshKey, setLocalDataRefreshKey] = useState(0);
  const [sharedCalendarMonth, setSharedCalendarMonth] = useState<CalendarMonth>(getCurrentMonth);
  const [sharedCalendarRange, setSharedCalendarRange] = useState<CalendarDateRange | null>(null);
  const [allTimeRange, setAllTimeRange] = useState<CalendarDateRange | null>(null);
  const [activeCalendarRangePreset, setActiveCalendarRangePreset] =
    useState<CalendarRangePreset | null>('month');

  const notifyLocalDataChange = useCallback(() => {
    setLocalDataRefreshKey((current) => current + 1);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [activePage]);

  useEffect(() => {
    let isMounted = true;

    const loadTimerData = async () => {
      try {
        const [shift, latestShift] = await Promise.all([
          getActiveShift(shiftRepository),
          getLatestCompletedShift(shiftRepository)
        ]);

        if (isMounted) {
          setActiveShift(shift);
          setLatestCompletedShift(latestShift);
        }
      } catch {
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
  }, [dataVersion, localDataRefreshKey]);

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
    let isMounted = true;

    getLocalDataDateBounds(shiftRepository, enterpriseScheduleRepository)
      .then((bounds) => {
        if (isMounted) {
          setAllTimeRange(bounds ? { start: bounds.start, end: bounds.end } : null);
        }
      })
      .catch(() => {
        if (isMounted) {
          setAllTimeRange(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [dataVersion, localDataRefreshKey]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(toLocalIsoString(new Date()));
    }, activeShift ? 1_000 : 15_000);

    return () => window.clearInterval(intervalId);
  }, [activeShift]);

  const activeSalaryBreakdown = useMemo(() => {
    if (!activeShift) {
      return null;
    }

    return calculateSalaryBreakdown({
      ...activeShift,
      endTime: now
    });
  }, [activeShift, now]);
  const latestCompletedSalaryBreakdown = useMemo(() => {
    if (!latestCompletedShift?.endTime) {
      return null;
    }

    return calculateSalaryBreakdown({
      ...latestCompletedShift,
      endTime: latestCompletedShift.endTime
    });
  }, [latestCompletedShift]);
  const currentEarning = activeSalaryBreakdown?.totalAmount ?? 0;
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
  const completedTicketTargets = useMemo(() => {
    if (!activeShift) {
      return [];
    }

    return activeShift.workTickets
      .filter((ticket): ticket is WorkTicket & { endedAt: ISODateTimeString } => ticket.endedAt !== null)
      .map((ticket) => ({
        ticket,
        targets: getTicketTargets(activeShift, ticket, ticket.endedAt, settings)
      }))
      .reverse();
  }, [activeShift, settings.currentGrade, settings.desiredGrade, settings.gradeNormPercents]);

  useEffect(() => {
    setTicketActualDraft('');
    setDowntimeAdjustmentDraft('');
  }, [activeWorkTicket?.id]);

  const toggleIncognito = async () => {
    setTimerError(null);
    setIsTogglingIncognito(true);

    try {
      await onSettingsChange({
        ...settings,
        incognitoEnabled: !settings.incognitoEnabled,
        updatedAt: toLocalIsoString(new Date())
      });
    } catch {
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

    try {
      const createdShift = await createShift(shiftRepository, {
        startTime: startedAt,
        baseHourlyRateSnapshot: baseHourlyRate,
        hourlyRateSnapshot: baseHourlyRate,
        gradeSnapshot: createGradeSnapshot(settings),
        coefficientMode: settings.coefficientMode,
        now: startedAt
      });

      setNow(startedAt);
      setActiveShift(createdShift);
      setTicketNormDraft('');
      setTicketError(null);
    } catch (error) {
      setTimerError(getTimerErrorMessage(error));
    }
  };

  const leave = async () => {
    if (!activeShift) {
      return;
    }

    if (activeWorkTicket) {
      setTimerError('Спершу завершіть активний тікет і внесіть фактичну кількість.');
      return;
    }

    setTimerError(null);
    const finishedAt = toLocalIsoString(new Date());

    try {
      const completedShift = await updateShift(shiftRepository, {
        ...activeShift,
        endTime: finishedAt,
        updatedAt: finishedAt
      });

      setNow(finishedAt);
      setActiveShift(completedShift.endTime === null ? completedShift : null);
      setLatestCompletedShift(completedShift.endTime ? completedShift : latestCompletedShift);
      setTicketNormDraft('');
      setTicketError(null);
      notifyLocalDataChange();

      if (completedShift.endTime !== null) {
        const clipboardText = formatShiftClipboardText(settings, {
          ...completedShift,
          endTime: completedShift.endTime
        });
        const didCopy = await copyTextToClipboard(clipboardText);

        setClipboardNotice({
          tone: didCopy ? 'success' : 'warning',
          message: didCopy
            ? `Скопійовано: ${clipboardText}`
            : `Зміну завершено, але текст не скопійовано: ${clipboardText}`
        });
      }
    } catch (error) {
      setTimerError(getTimerErrorMessage(error));
    }
  };

  const parseTicketNormDraft = (value: string): number | null => {
    const normPerEightHours = Number(value);

    if (!Number.isFinite(normPerEightHours) || normPerEightHours <= 0) {
      setTicketError('Норма має бути більшою за 0.');
      return null;
    }

    if (normPerEightHours > 999) {
      setTicketError('Норма має бути не більшою за 999.');
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

    try {
      const updatedShift = await addWorkTicketToActiveShift(shiftRepository, {
        shiftId: activeShift.id,
        normPerEightHours,
        startedAt
      });

      setNow(startedAt);
      setActiveShift(updatedShift);
      setTicketNormDraft('');
      notifyLocalDataChange();
    } catch (error) {
      setTicketError(getTicketErrorMessage(error));
    } finally {
      setIsAddingTicket(false);
    }
  };

  const addTicketDowntimeAdjustment = async () => {
    if (!activeShift || !activeWorkTicket) {
      return;
    }

    const deltaMinutes = Number(downtimeAdjustmentDraft);

    if (!Number.isSafeInteger(deltaMinutes) || deltaMinutes === 0) {
      setTicketError('Вкажіть цілу ненульову кількість хвилин, наприклад +15 або -5.');
      return;
    }

    const changedAt = toLocalIsoString(new Date());
    setPendingTicketId(activeWorkTicket.id);
    setTicketError(null);

    try {
      const updatedShift = await adjustWorkTicketDowntime(shiftRepository, {
        shiftId: activeShift.id,
        deltaMinutes,
        updatedAt: changedAt
      });

      setNow(changedAt);
      setActiveShift(updatedShift);
      setDowntimeAdjustmentDraft('');
      notifyLocalDataChange();
    } catch (error) {
      setTicketError(getTicketErrorMessage(error));
    } finally {
      setPendingTicketId(null);
    }
  };

  const finishActiveTicket = async () => {
    if (!activeShift || !activeWorkTicket || !activeTicketTargets) {
      return;
    }

    if (ticketActualDraft.trim() === '') {
      setTicketError('Вкажіть цілу фактичну кількість від 0.');
      return;
    }

    const actualQuantity = Number(ticketActualDraft);

    if (!Number.isSafeInteger(actualQuantity) || actualQuantity < 0) {
      setTicketError('Вкажіть цілу фактичну кількість від 0.');
      return;
    }

    const endedAt = toLocalIsoString(new Date());
    setIsCompletingTicket(true);
    setTicketError(null);

    try {
      const updatedShift = await completeWorkTicket(shiftRepository, {
        shiftId: activeShift.id,
        endedAt,
        actualQuantity
      });

      setNow(endedAt);
      setActiveShift(updatedShift);
      notifyLocalDataChange();
    } catch (error) {
      setTicketError(getTicketErrorMessage(error));
    } finally {
      setIsCompletingTicket(false);
    }
  };

  const startTicketEdit = (ticket: WorkTicket) => {
    setEditingTicketId(ticket.id);
    setTicketEditDraft({
      normPerEightHours: String(ticket.normPerEightHours),
      startedAt: getTimeInputValue(ticket.startedAt),
      endedAt: ticket.endedAt ? getTimeInputValue(ticket.endedAt) : '',
      actualQuantity: ticket.actualQuantity === null ? '' : String(ticket.actualQuantity),
      downtimeMinutes: String(ticket.downtimeMinutes)
    });
    setTicketError(null);
  };

  const cancelTicketEdit = () => {
    setEditingTicketId(null);
    setTicketEditDraft(createEmptyTicketEditDraft());
    setTicketError(null);
  };

  const changeTicketEditDraft = (key: keyof TicketEditDraft, value: string) => {
    setTicketEditDraft((current) => ({ ...current, [key]: value }));
    setTicketError(null);
  };

  const completeTicketTimeDraft = (key: 'startedAt' | 'endedAt') => {
    setTicketEditDraft((current) => ({
      ...current,
      [key]: current[key].trim() ? normalizeTimeInput(current[key]) : ''
    }));
  };

  const saveTicketEdit = async (ticketId: string) => {
    if (!activeShift) {
      return;
    }

    const normPerEightHours = parseTicketNormDraft(ticketEditDraft.normPerEightHours);

    if (normPerEightHours === null) {
      return;
    }

    if (!ticketEditDraft.startedAt.trim()) {
      setTicketError('Вкажіть час взяття тікета.');
      return;
    }

    const updatedAt = toLocalIsoString(new Date());
    const startedAt = combineLocalDateAndTime(
      activeShift.date,
      normalizeTimeInput(ticketEditDraft.startedAt)
    );
    const endedAt = ticketEditDraft.endedAt.trim()
      ? combineLocalDateAndTime(activeShift.date, normalizeTimeInput(ticketEditDraft.endedAt))
      : null;
    const editedTicket = activeShift.workTickets.find((ticket) => ticket.id === ticketId);
    const actualQuantity = ticketEditDraft.actualQuantity.trim() === ''
      ? null
      : Number(ticketEditDraft.actualQuantity);
    const downtimeMinutes = Number(ticketEditDraft.downtimeMinutes);

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
      setTicketEditDraft(createEmptyTicketEditDraft());
      notifyLocalDataChange();
    } catch (error) {
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
        setTicketEditDraft(createEmptyTicketEditDraft());
      }

      notifyLocalDataChange();
    } catch {
      setTicketError('Не вдалося видалити тікет.');
    } finally {
      setPendingTicketId(null);
    }
  };
  const changeSharedCalendarRange = useCallback((range: CalendarDateRange | null) => {
    setSharedCalendarRange(range);
    setActiveCalendarRangePreset(null);
  }, []);
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
  const currentDate = getDateFromDateTime(now);
  const currentHourlyRate = calculateHourlyRateFromMonthlySalary(
    settings.monthlySalary,
    currentDate
  );
  const currentGradeBonus = calculateGradeMonthlyBonus(
    settings.monthlySalary,
    calculateCumulativeGradePercent(settings.currentGrade, settings.gradeSalaryBonusPercents)
  );

  return (
    <AppShell
      navigationSlot={<BottomNavigation activeItem={activePage} onSelect={setActivePage} />}
      headerSlot={
        activePage === 'timer' ? (
          <header className={activeShift ? 'main-page__header main-page__header--active' : 'main-page__header'}>
            <div>
              <p className="main-page__eyebrow">{pageEyebrowById[activePage]}</p>
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
        ) : null
      }
    >
      {activePage === 'history' ? (
        <HistoryPage
          key={`history-${dataVersion}-${localDataRefreshKey}`}
          settings={settings}
          calendarMonth={sharedCalendarMonth}
          selectedRange={sharedCalendarRange}
          onCalendarMonthChange={setSharedCalendarMonth}
          onSelectedRangeChange={changeSharedCalendarRange}
          activeRangePreset={activeCalendarRangePreset}
          isAllTimePresetEnabled={allTimeRange !== null}
          onRangePresetSelect={selectCalendarRangePreset}
          onDataChange={notifyLocalDataChange}
        />
      ) : activePage === 'analytics' ? (
        <AnalyticsPage
          key={`analytics-${dataVersion}-${localDataRefreshKey}`}
          settings={settings}
          calendarMonth={sharedCalendarMonth}
          selectedRange={sharedCalendarRange}
          onCalendarMonthChange={setSharedCalendarMonth}
          onSelectedRangeChange={changeSharedCalendarRange}
          activeRangePreset={activeCalendarRangePreset}
          isAllTimePresetEnabled={allTimeRange !== null}
          onRangePresetSelect={selectCalendarRangePreset}
        />
      ) : activePage === 'schedule' ? (
        <SchedulePage
          key={`schedule-${dataVersion}`}
          settings={settings}
          calendarMonth={sharedCalendarMonth}
          selectedRange={sharedCalendarRange}
          onCalendarMonthChange={setSharedCalendarMonth}
          onSelectedRangeChange={changeSharedCalendarRange}
          activeRangePreset={activeCalendarRangePreset}
          isAllTimePresetEnabled={allTimeRange !== null}
          onRangePresetSelect={selectCalendarRangePreset}
          onDataChange={notifyLocalDataChange}
        />
      ) : activePage === 'settings' ? (
        <SettingsPage
          settings={settings}
          onSettingsChange={onSettingsChange}
          onLocalDataReplace={onLocalDataReplace}
          onLocalDataChange={notifyLocalDataChange}
        />
      ) : isLoadingShift ? (
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
              <p className="main-page__status main-page__status--active">
                <span aria-hidden="true" />
                Зміна активна
              </p>
              <div className="main-page__timer-title-row">
                <h2 id="timer-title">{getShiftTitle(activeShift)}</h2>
                <p className="main-page__timer-subtitle">
                  {activeShift.plannedStartTime}-{activeShift.plannedEndTime}
                </p>
              </div>
            </div>

            <div className="main-page__metrics main-page__metrics--active" aria-label="Поточний стан зміни">
              <article className="main-page__metric main-page__metric--money">
                <span>Зароблено зараз</span>
                <strong>{formatMoney(currentEarning, settings.incognitoEnabled)}</strong>
              </article>
              <article className="main-page__metric">
                <span>Прихід-вихід</span>
                <strong>{formatTime(activeShift.startTime)} - зараз</strong>
              </article>
              <article className="main-page__metric">
                <span>Відробив</span>
                <strong>{formatDurationMinutes(getDurationMinutes(activeShift.startTime, now))}</strong>
              </article>
              <article className="main-page__metric">
                <span>Ставка</span>
                <strong>{formatHourlyRate(activeShift.baseHourlyRateSnapshot, settings.incognitoEnabled)}</strong>
              </article>
              <article className="main-page__metric">
                <span>Грейд</span>
                <strong>
                  {activeShift.gradeSnapshot
                    ? `${activeShift.gradeSnapshot.currentGrade} -> ${activeShift.gradeSnapshot.desiredGrade}`
                    : 'Без snapshot'}
                </strong>
              </article>
              <article className="main-page__metric main-page__metric--coefficient">
                <span>Коефіцієнт зараз</span>
                <strong>
                  {settings.incognitoEnabled
                    ? INCOGNITO_FINANCIAL_MASK
                    : `x${currentCoefficient}`}
                </strong>
              </article>
            </div>

            {timerError ? (
              <p className="main-page__error" role="alert">
                {timerError}
              </p>
            ) : null}
          </section>

          <section className="main-page__tasker" aria-labelledby="active-ticket-title">
                  <div className="main-page__tasker-header">
                    <div>
                      <p className="main-page__label">Виробіток</p>
                      <h3 id="active-ticket-title">Тікет зміни</h3>
                    </div>
                    <span>{activeShift.workTickets.length} тік.</span>
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
                          setTicketNormDraft(normalizeTicketNormDraft(event.target.value));
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
                      <div className="main-page__ticket-current-card main-page__ticket-current-card--wide">
                        <div className="main-page__ticket-current-main">
                          <div>
                            <span>Потрібно для G{activeTicketTargets.currentGrade}</span>
                            <small>
                              Продуктивно {formatDurationMinutes(activeTicketTargets.productiveMinutes)}
                            </small>
                          </div>
                          <strong>{activeTicketTargets.currentTarget} шт</strong>
                        </div>
                        <div className="main-page__ticket-actions" aria-label="Дії з активним тікетом">
                          <button
                            type="button"
                            title="Редагувати тікет"
                            aria-label="Редагувати активний тікет"
                            disabled={pendingTicketId !== null}
                            onClick={() => startTicketEdit(activeWorkTicket)}
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            type="button"
                            title="Видалити тікет"
                            aria-label="Видалити активний тікет"
                            disabled={pendingTicketId !== null}
                            onClick={() => void removeTicket(activeWorkTicket)}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      {editingTicketId === activeWorkTicket.id ? (
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
                                value={ticketEditDraft.normPerEightHours}
                                onChange={(event) => {
                                  changeTicketEditDraft(
                                    'normPerEightHours',
                                    normalizeTicketNormDraft(event.target.value)
                                  );
                                }}
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
                                placeholder="06:30"
                                value={ticketEditDraft.startedAt}
                                onBlur={() => completeTicketTimeDraft('startedAt')}
                                onChange={(event) =>
                                  changeTicketEditDraft(
                                    'startedAt',
                                    formatTimeInputDraft(event.target.value)
                                  )
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
                                placeholder="Триває"
                                disabled
                                value={ticketEditDraft.endedAt}
                                onBlur={() => completeTicketTimeDraft('endedAt')}
                                onChange={(event) =>
                                  changeTicketEditDraft(
                                    'endedAt',
                                    formatTimeInputDraft(event.target.value)
                                  )
                                }
                              />
                            </label>
                          </div>
                          <div className="main-page__ticket-edit-actions">
                            <button
                              className="main-page__ticket-edit-save"
                              type="button"
                              disabled={pendingTicketId !== null}
                              onClick={() => void saveTicketEdit(activeWorkTicket.id)}
                            >
                              <Check size={15} aria-hidden="true" />
                              <span>Зберегти</span>
                            </button>
                            <button
                              type="button"
                              disabled={pendingTicketId !== null}
                              onClick={cancelTicketEdit}
                            >
                              <X size={15} aria-hidden="true" />
                              <span>Скасувати</span>
                            </button>
                          </div>
                        </div>
                      ) : null}
                      <div className="main-page__ticket-targets" aria-label="План для всіх грейдів">
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
                      <div className="main-page__ticket-downtime">
                        <div className="main-page__ticket-downtime-header">
                          <div>
                            <span>Облік часу</span>
                            <strong>Простій</strong>
                          </div>
                          <output
                            aria-label={`Загальний простій: ${formatDurationMinutes(
                              activeTicketTargets.downtimeMinutes
                            )}`}
                          >
                            {formatDurationMinutes(activeTicketTargets.downtimeMinutes)}
                          </output>
                        </div>
                        <p>Додайте або відніміть цілу кількість хвилин.</p>
                        <div className="main-page__ticket-downtime-control">
                          <label>
                            <span>Коригування, хв</span>
                            <span className="main-page__ticket-downtime-input">
                              <input
                                type="text"
                                inputMode="text"
                                autoComplete="off"
                                pattern="[+-]?[0-9]*"
                                aria-label="Коригування, хв"
                                value={downtimeAdjustmentDraft}
                                placeholder="+15 або -5"
                                onChange={(event) => {
                                  setDowntimeAdjustmentDraft(
                                    normalizeSignedIntegerDraft(event.target.value)
                                  );
                                  setTicketError(null);
                                }}
                              />
                              <span aria-hidden="true">хв</span>
                            </span>
                          </label>
                          <button
                            type="button"
                            disabled={pendingTicketId !== null || isCompletingTicket}
                            onClick={() => void addTicketDowntimeAdjustment()}
                          >
                            Додати
                          </button>
                        </div>
                      </div>
                      <div className="main-page__ticket-complete-form">
                        <label>
                          <span>Фактично зроблено, шт</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            pattern="[0-9]*"
                            value={ticketActualDraft}
                            placeholder="0"
                            onChange={(event) => {
                              setTicketActualDraft(event.target.value.replace(/\D/g, ''));
                              setTicketError(null);
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={isCompletingTicket || pendingTicketId !== null}
                          onClick={() => void finishActiveTicket()}
                        >
                          {isCompletingTicket ? 'Збереження...' : 'Завершити тікет'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="main-page__muted">Додайте тікет, щоб бачити поточну норму.</p>
                  )}

                  {completedTicketTargets.length > 0 ? (
                    <div className="main-page__ticket-history" aria-label="Завершені тікети">
                      {completedTicketTargets.map(({ ticket, targets }) => {
                        const isEditingTicket = editingTicketId === ticket.id;

                        return (
                          <article
                            className={
                              isEditingTicket
                                ? 'main-page__ticket-history-item main-page__ticket-history-item--editing'
                                : 'main-page__ticket-history-item'
                            }
                            key={ticket.id}
                          >
                            {isEditingTicket ? (
                              <>
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
                                        value={ticketEditDraft.normPerEightHours}
                                        onChange={(event) => {
                                          changeTicketEditDraft(
                                            'normPerEightHours',
                                            normalizeTicketNormDraft(event.target.value)
                                          );
                                        }}
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
                                        value={ticketEditDraft.startedAt}
                                        onBlur={() => completeTicketTimeDraft('startedAt')}
                                        onChange={(event) =>
                                          changeTicketEditDraft(
                                            'startedAt',
                                            formatTimeInputDraft(event.target.value)
                                          )
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
                                        value={ticketEditDraft.endedAt}
                                        onBlur={() => completeTicketTimeDraft('endedAt')}
                                        onChange={(event) =>
                                          changeTicketEditDraft(
                                            'endedAt',
                                            formatTimeInputDraft(event.target.value)
                                          )
                                        }
                                      />
                                    </label>
                                    <label>
                                      <span>Факт, шт</span>
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        autoComplete="off"
                                        pattern="[0-9]*"
                                        value={ticketEditDraft.actualQuantity}
                                        placeholder="Не внесено"
                                        onChange={(event) =>
                                          changeTicketEditDraft(
                                            'actualQuantity',
                                            event.target.value.replace(/\D/g, '')
                                          )
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
                                        value={ticketEditDraft.downtimeMinutes}
                                        onChange={(event) =>
                                          changeTicketEditDraft(
                                            'downtimeMinutes',
                                            event.target.value.replace(/\D/g, '')
                                          )
                                        }
                                      />
                                    </label>
                                  </div>
                                  <div className="main-page__ticket-edit-actions">
                                    <button
                                      className="main-page__ticket-edit-save"
                                      type="button"
                                      disabled={pendingTicketId !== null}
                                      onClick={() => void saveTicketEdit(ticket.id)}
                                    >
                                      <Check size={15} aria-hidden="true" />
                                      <span>Зберегти</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={pendingTicketId !== null}
                                      onClick={cancelTicketEdit}
                                    >
                                      <X size={15} aria-hidden="true" />
                                      <span>Скасувати</span>
                                    </button>
                                  </div>
                                </div>
                              </>
                            ) : (
                              <>
                                <span className="main-page__ticket-history-time">
                                  {formatTime(ticket.startedAt)}-{formatTime(ticket.endedAt)}
                                </span>
                                <strong>{ticket.actualQuantity === null ? 'Факт не внесено' : `Факт ${ticket.actualQuantity} шт`}</strong>
                                <small>
                                  Продуктивно {formatDurationMinutes(targets.productiveMinutes)} · простій{' '}
                                  {formatDurationMinutes(targets.downtimeMinutes)}
                                </small>
                                <small>
                                  {targets.targets.map((target) => `G${target.grade}: ${target.quantity}`).join(' · ')}
                                </small>
                                <small>
                                  Виконання G{targets.currentGrade}:{' '}
                                  {targets.completionPercent === null
                                    ? '—'
                                    : `${Math.round(targets.completionPercent)}%`}
                                </small>
                                <small>
                                  Результат: {ticket.actualQuantity === null
                                    ? '—'
                                    : targets.productiveMinutes === 0
                                      ? 'грейд не визначено'
                                    : targets.achievedGrade
                                      ? `G${targets.achievedGrade}`
                                      : 'нижче G1'}
                                </small>
                                <div className="main-page__ticket-actions" aria-label="Дії з завершеним тікетом">
                                  <button
                                    type="button"
                                    title="Редагувати тікет"
                                    aria-label={`Редагувати тікет ${formatTime(ticket.startedAt)}`}
                                    disabled={pendingTicketId !== null}
                                    onClick={() => startTicketEdit(ticket)}
                                  >
                                    <Edit3 size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    title="Видалити тікет"
                                    aria-label={`Видалити тікет ${formatTime(ticket.startedAt)}`}
                                    disabled={pendingTicketId !== null}
                                    onClick={() => void removeTicket(ticket)}
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
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

          {!activeWorkTicket ? (
            <div className="main-page__action-bar">
              <HoldButton
                label="Пішов"
                delayMs={settings.leaveHoldDelayMs}
                onConfirm={leave}
                tone="danger"
              />
            </div>
          ) : null}
        </>
      ) : (
        <>
          <section className="main-page__summary main-page__timer-screen" aria-labelledby="timer-title">
                {latestCompletedShift && latestCompletedSalaryBreakdown ? (
                  <>
                    <div>
                      <p className="main-page__status main-page__status--idle">
                        <span aria-hidden="true" />
                        Зміна не активна
                      </p>
                      <h2 id="timer-title">Остання зміна</h2>
                    </div>
                    <div className="main-page__metrics" aria-label="Остання завершена зміна">
                      <article className="main-page__metric main-page__metric--money">
                        <span>Зароблено</span>
                        <strong>
                          {formatMoney(
                            latestCompletedSalaryBreakdown.totalAmount,
                            settings.incognitoEnabled
                          )}
                        </strong>
                      </article>
                      <article className="main-page__metric">
                        <span>Дата</span>
                        <strong>{formatDate(latestCompletedShift.date)}</strong>
                      </article>
                      <article className="main-page__metric">
                        <span>Час</span>
                        <strong>
                          {formatTime(latestCompletedShift.startTime)} -{' '}
                          {latestCompletedShift.endTime
                            ? formatTime(latestCompletedShift.endTime)
                            : 'триває'}
                        </strong>
                      </article>
                      <article className="main-page__metric">
                        <span>Тривалість</span>
                        <strong>
                          {formatDurationMinutes(
                            getDurationMinutes(
                              latestCompletedShift.startTime,
                              latestCompletedShift.endTime ?? now
                            )
                          )}
                        </strong>
                      </article>
                      <article className="main-page__metric">
                        <span>Тип</span>
                        <strong>{getShiftTitle(latestCompletedShift)}</strong>
                      </article>
                      <article className="main-page__metric">
                        <span>Базова ставка</span>
                        <strong>
                          {formatHourlyRate(
                            latestCompletedShift.baseHourlyRateSnapshot,
                            settings.incognitoEnabled
                          )}
                        </strong>
                      </article>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <p className="main-page__status main-page__status--idle">
                        <span aria-hidden="true" />
                        Сьогодні без активної зміни
                      </p>
                      <h2 id="timer-title">Зміна не активна</h2>
                    </div>
                    <div className="main-page__metrics" aria-label="Поточний стан таймера">
                      <article className="main-page__metric main-page__metric--money">
                        <span>Базова ставка</span>
                        <strong>
                          {formatHourlyRate(currentHourlyRate, settings.incognitoEnabled)}
                        </strong>
                      </article>
                      <article className="main-page__metric main-page__metric--money">
                        <span>Грейдова премія/міс</span>
                        <strong>{formatMoney(currentGradeBonus, settings.incognitoEnabled)}</strong>
                      </article>
                      <article className="main-page__metric main-page__metric--boosted">
                        <span>Остання зміна</span>
                        <strong>Ще немає записів</strong>
                      </article>
                    </div>
                  </>
                )}
                <div className="main-page__action-bar">
                  <p className="main-page__hold-hint">Утримай “Прийшов”, щоб почати зміну</p>
                  <HoldButton label="Прийшов" delayMs={settings.arriveHoldDelayMs} onConfirm={arrive} />
                </div>

                {timerError ? (
                  <p className="main-page__error" role="alert">
                    {timerError}
                  </p>
                ) : null}
                {clipboardNotice ? (
                  <p
                    className="main-page__notice"
                    data-tone={clipboardNotice.tone}
                    role="status"
                    aria-live="polite"
                  >
                    {clipboardNotice.message}
                  </p>
                ) : null}
          </section>
          <div className="main-page__action-spacer" aria-hidden="true" />
        </>
      )}
    </AppShell>
  );
}
