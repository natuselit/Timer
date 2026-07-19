import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Edit3, Eye, EyeOff, Trash2, X } from 'lucide-react';
import { BottomNavigation } from '../../../widgets/bottom-navigation';
import { AppShell } from '../../../shared/ui/app-shell';
import {
  calculateGradeHourlyRateFromMonthlySalary,
  calculateGradeProductionTarget,
  createGradeSnapshot,
  formatProductionTarget,
  getGradeIndex,
  type Settings
} from '../../../entities/settings';
import { AnalyticsPage } from '../../analytics';
import { HistoryPage } from '../../history';
import { SchedulePage } from '../../schedule';
import { SettingsPage } from '../../settings';
import { calculateSalaryBreakdown, type ISODateTimeString, type Shift, type WorkTicket } from '../../../entities/shift';
import {
  closeOverdueActiveShift,
  addWorkTicketToActiveShift,
  closeShiftWorkTickets,
  createShift,
  deleteWorkTicketFromActiveShift,
  getLatestCompletedShift,
  localDb,
  ShiftConstraintError,
  ShiftRepository,
  updateWorkTicketInActiveShift,
  updateShift
} from '../../../shared/lib/local-db';
import {
  formatDate,
  formatDurationMinutes,
  formatTime,
  getCurrentMonth,
  getDateFromDateTime,
  getDurationMinutes,
  toLocalIsoString
} from '../../../shared/lib/date-time';
import { formatHourlyRate, formatMoney } from '../../../shared/lib/format';
import type { NavigationItem } from '../../../shared/config/navigation';
import type { CalendarDateRange } from '../../../shared/ui/month-calendar';
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

const shiftRepository = new ShiftRepository(localDb);

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

const prepareAutoCloseNotification = (_shift: Shift): void => {
  // Місце для майбутнього локального сповіщення після запиту permissions у користувача.
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

const getTicketElapsedMinutes = (startedAt: ISODateTimeString, endedAt: ISODateTimeString): number =>
  Math.max(0, Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 60_000));

const normalizeTicketNormDraft = (value: string): string => {
  const digits = value.replace(/\D/g, '');

  return digits === '' ? '' : String(Math.min(Number(digits), 999));
};

const getTicketTargets = (
  shift: Shift,
  ticket: WorkTicket,
  endedAt: ISODateTimeString,
  settings: Settings
) => {
  const gradeSnapshot = shift.gradeSnapshot;
  const currentGrade = gradeSnapshot?.currentGrade ?? settings.currentGrade;
  const desiredGrade = gradeSnapshot?.desiredGrade ?? settings.desiredGrade;
  const gradeNormPercents = gradeSnapshot?.gradeNormPercents ?? settings.gradeNormPercents;
  const elapsedMinutes = getTicketElapsedMinutes(ticket.startedAt, endedAt);
  const currentGradeNormPercent = gradeNormPercents[getGradeIndex(currentGrade)];
  const desiredGradeNormPercent = gradeNormPercents[getGradeIndex(desiredGrade)];

  return {
    elapsedMinutes,
    currentGrade,
    desiredGrade,
    currentTarget: formatProductionTarget(
      calculateGradeProductionTarget({
        normPerEightHours: ticket.normPerEightHours,
        gradeNormPercent: currentGradeNormPercent,
        elapsedMinutes
      })
    ),
    desiredTarget: formatProductionTarget(
      calculateGradeProductionTarget({
        normPerEightHours: ticket.normPerEightHours,
        gradeNormPercent: desiredGradeNormPercent,
        elapsedMinutes
      })
    )
  };
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
  const [ticketEditDraft, setTicketEditDraft] = useState('');
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [isAddingTicket, setIsAddingTicket] = useState(false);
  const [pendingTicketId, setPendingTicketId] = useState<string | null>(null);
  const [isTogglingIncognito, setIsTogglingIncognito] = useState(false);
  const [localDataRefreshKey, setLocalDataRefreshKey] = useState(0);
  const [sharedCalendarMonth, setSharedCalendarMonth] = useState<CalendarMonth>(getCurrentMonth);
  const [sharedCalendarRange, setSharedCalendarRange] = useState<CalendarDateRange | null>(null);

  const notifyLocalDataChange = useCallback(() => {
    setLocalDataRefreshKey((current) => current + 1);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [activePage]);

  const checkActiveShift = useCallback(async (): Promise<Shift | null> => {
    const shift = await closeOverdueActiveShift(shiftRepository, {
      now: toLocalIsoString(new Date()),
      onAutoCloseDue: prepareAutoCloseNotification
    });

    return shift?.endTime === null ? shift : null;
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadTimerData = async () => {
      try {
        const shift = await checkActiveShift();
        const latestShift = await getLatestCompletedShift(shiftRepository);

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
  }, [checkActiveShift, dataVersion, localDataRefreshKey]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(toLocalIsoString(new Date()));
    }, activeShift ? 1_000 : 15_000);

    return () => window.clearInterval(intervalId);
  }, [activeShift]);

  useEffect(() => {
    if (!activeShift) {
      return;
    }

    const intervalId = window.setInterval(() => {
      checkActiveShift()
        .then(setActiveShift)
        .catch(() => {
          setTimerError('Не вдалося перевірити активну зміну.');
        });
    }, 15_000);

    return () => window.clearInterval(intervalId);
  }, [activeShift, checkActiveShift]);

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
    const startedAt = toLocalIsoString(new Date());
    const startedDate = getDateFromDateTime(startedAt);
    const hourlyRates = calculateGradeHourlyRateFromMonthlySalary(
      settings.monthlySalary,
      startedDate,
      settings
    );

    try {
      const createdShift = await createShift(shiftRepository, {
        startTime: startedAt,
        baseHourlyRateSnapshot: hourlyRates.baseHourlyRate,
        hourlyRateSnapshot: hourlyRates.effectiveHourlyRate,
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

    setTimerError(null);
    const finishedAt = toLocalIsoString(new Date());

    try {
      const completedShift = await updateShift(shiftRepository, {
        ...closeShiftWorkTickets(activeShift, finishedAt),
        endTime: finishedAt,
        updatedAt: finishedAt
      });

      setNow(finishedAt);
      setActiveShift(completedShift.endTime === null ? completedShift : null);
      setLatestCompletedShift(completedShift.endTime ? completedShift : latestCompletedShift);
      setTicketNormDraft('');
      setTicketError(null);
      notifyLocalDataChange();
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
    } catch {
      setTicketError('Не вдалося додати тікет.');
    } finally {
      setIsAddingTicket(false);
    }
  };

  const startTicketEdit = (ticket: WorkTicket) => {
    setEditingTicketId(ticket.id);
    setTicketEditDraft(String(ticket.normPerEightHours));
    setTicketError(null);
  };

  const cancelTicketEdit = () => {
    setEditingTicketId(null);
    setTicketEditDraft('');
    setTicketError(null);
  };

  const saveTicketEdit = async (ticketId: string) => {
    if (!activeShift) {
      return;
    }

    const normPerEightHours = parseTicketNormDraft(ticketEditDraft);

    if (normPerEightHours === null) {
      return;
    }

    const updatedAt = toLocalIsoString(new Date());
    setPendingTicketId(ticketId);
    setTicketError(null);

    try {
      const updatedShift = await updateWorkTicketInActiveShift(shiftRepository, {
        shiftId: activeShift.id,
        ticketId,
        normPerEightHours,
        updatedAt
      });

      setNow(updatedAt);
      setActiveShift(updatedShift);
      setEditingTicketId(null);
      setTicketEditDraft('');
      notifyLocalDataChange();
    } catch {
      setTicketError('Не вдалося оновити тікет.');
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
        setTicketEditDraft('');
      }

      notifyLocalDataChange();
    } catch {
      setTicketError('Не вдалося видалити тікет.');
    } finally {
      setPendingTicketId(null);
    }
  };
  const currentDate = getDateFromDateTime(now);
  const currentHourlyRates = calculateGradeHourlyRateFromMonthlySalary(
    settings.monthlySalary,
    currentDate,
    settings
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
          onSelectedRangeChange={setSharedCalendarRange}
          onDataChange={notifyLocalDataChange}
        />
      ) : activePage === 'analytics' ? (
        <AnalyticsPage
          key={`analytics-${dataVersion}-${localDataRefreshKey}`}
          settings={settings}
          calendarMonth={sharedCalendarMonth}
          selectedRange={sharedCalendarRange}
          onCalendarMonthChange={setSharedCalendarMonth}
          onSelectedRangeChange={setSharedCalendarRange}
        />
      ) : activePage === 'schedule' ? (
        <SchedulePage
          key={`schedule-${dataVersion}`}
          settings={settings}
          calendarMonth={sharedCalendarMonth}
          selectedRange={sharedCalendarRange}
          onCalendarMonthChange={setSharedCalendarMonth}
          onSelectedRangeChange={setSharedCalendarRange}
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

                  <div className="main-page__ticket-form">
                    <label>
                      <span>Норма, шт</span>
                      <input
                        inputMode="numeric"
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
                  </div>

                  {activeWorkTicket && activeTicketTargets ? (
                    <div className="main-page__ticket-current">
                      <div className="main-page__ticket-current-card main-page__ticket-current-card--wide">
                        <div className="main-page__ticket-current-main">
                          <span>Зараз треба</span>
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
                          <label>
                            <span>Норма</span>
                            <input
                              inputMode="numeric"
                              maxLength={3}
                              pattern="[0-9]*"
                              value={ticketEditDraft}
                              onChange={(event) => {
                                setTicketEditDraft(normalizeTicketNormDraft(event.target.value));
                                setTicketError(null);
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            title="Зберегти"
                            aria-label="Зберегти тікет"
                            disabled={pendingTicketId !== null}
                            onClick={() => void saveTicketEdit(activeWorkTicket.id)}
                          >
                            <Check size={15} />
                          </button>
                          <button
                            type="button"
                            title="Скасувати"
                            aria-label="Скасувати редагування тікета"
                            disabled={pendingTicketId !== null}
                            onClick={cancelTicketEdit}
                          >
                            <X size={15} />
                          </button>
                        </div>
                      ) : null}
                      <div className="main-page__ticket-current-card">
                        <span>Зберегти Г{activeTicketTargets.currentGrade}</span>
                        <strong>{activeTicketTargets.currentTarget} шт зараз</strong>
                      </div>
                      <div className="main-page__ticket-current-card">
                        <span>
                          {activeTicketTargets.desiredGrade === activeTicketTargets.currentGrade
                            ? `Бажаний Г${activeTicketTargets.desiredGrade}`
                            : `До Г${activeTicketTargets.desiredGrade}`}
                        </span>
                        <strong>{activeTicketTargets.desiredTarget} шт зараз</strong>
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
                                <span className="main-page__ticket-history-time">
                                  {formatTime(ticket.startedAt)}-{formatTime(ticket.endedAt)}
                                </span>
                                <div className="main-page__ticket-edit-form">
                                  <label>
                                    <span>Норма</span>
                                    <input
                                      inputMode="numeric"
                                      maxLength={3}
                                      pattern="[0-9]*"
                                      value={ticketEditDraft}
                                      onChange={(event) => {
                                        setTicketEditDraft(normalizeTicketNormDraft(event.target.value));
                                        setTicketError(null);
                                      }}
                                    />
                                  </label>
                                  <button
                                    type="button"
                                    title="Зберегти"
                                    aria-label="Зберегти тікет"
                                    disabled={pendingTicketId !== null}
                                    onClick={() => void saveTicketEdit(ticket.id)}
                                  >
                                    <Check size={15} />
                                  </button>
                                  <button
                                    type="button"
                                    title="Скасувати"
                                    aria-label="Скасувати редагування тікета"
                                    disabled={pendingTicketId !== null}
                                    onClick={cancelTicketEdit}
                                  >
                                    <X size={15} />
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <span className="main-page__ticket-history-time">
                                  {formatTime(ticket.startedAt)}-{formatTime(ticket.endedAt)}
                                </span>
                                <strong>{ticket.normPerEightHours} шт</strong>
                                <small>Г{targets.currentGrade}: {targets.currentTarget}</small>
                                <small>
                                  {targets.desiredGrade === targets.currentGrade
                                    ? `Г${targets.desiredGrade}`
                                    : `До Г${targets.desiredGrade}`}
                                  : {targets.desiredTarget}
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

          <div className="main-page__action-bar">
            <HoldButton
              label="Пішов"
              delayMs={settings.leaveHoldDelayMs}
              onConfirm={leave}
              tone="danger"
            />
          </div>
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
                        <span>Ставка з грейдом</span>
                        <strong>
                          {formatHourlyRate(
                            latestCompletedShift.hourlyRateSnapshot,
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
                        <span>Ставка з грейдом</span>
                        <strong>
                          {formatHourlyRate(currentHourlyRates.effectiveHourlyRate, settings.incognitoEnabled)}
                        </strong>
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
          </section>
          <div className="main-page__action-spacer" aria-hidden="true" />
        </>
      )}
    </AppShell>
  );
}
