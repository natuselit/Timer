import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileText,
  FileUp,
  LoaderCircle,
  RefreshCw,
  SkipForward,
  Upload,
  X
} from 'lucide-react';
import {
  calculateEnterpriseScheduleComparison,
  parseEnterpriseSchedulePdf
} from '../../../entities/enterprise-schedule';
import type {
  EnterpriseScheduleDiscrepancy,
  EnterpriseScheduleItem,
  EnterpriseSchedulePdfParseResult
} from '../../../entities/enterprise-schedule';
import {
  calculateHourlyRateFromMonthlySalary,
  calculateMonthlySalaryFromHourlyRate,
  type Settings
} from '../../../entities/settings';
import type { LocalDateString, Shift, ShiftType } from '../../../entities/shift';
import {
  EnterpriseScheduleRepository,
  getEnterpriseScheduleBetween,
  getShiftsBetween,
  importParsedEnterpriseSchedule,
  localDb,
  ScheduleWarningReviewRepository,
  ShiftRepository,
  skipEnterpriseScheduleDiscrepancy,
  syncShiftWithEnterpriseSchedule,
  type ReviewedScheduleWarning
} from '../../../shared/lib/local-db';
import {
  formatDate,
  formatDurationClock,
  formatDurationMinutes,
  formatShortMinuteDuration,
  formatShortNumericDate,
  formatTime,
  countWeekdaysInDateRange,
  toLocalIsoString
} from '../../../shared/lib/date-time';
import { formatHourlyRate, formatMoney } from '../../../shared/lib/format';
import {
  calculateScheduleControlSummary,
  type ScheduleControlWarning
} from '../../../shared/lib/shifts/scheduleControl';
import {
  MonthCalendar,
  type CalendarDateRange,
  type CalendarRangePreset
} from '../../../shared/ui/month-calendar';
import {
  getImportedMonths,
  getPrimaryImportedMonth,
  type CalendarMonth
} from '../model/importMonths';
import './SchedulePage.css';

const enterpriseScheduleRepository = new EnterpriseScheduleRepository(localDb);
const shiftRepository = new ShiftRepository(localDb);
const scheduleWarningReviewRepository = new ScheduleWarningReviewRepository(localDb);

type SchedulePageProps = {
  settings: Settings;
  calendarMonth: CalendarMonth;
  selectedRange: CalendarDateRange | null;
  onCalendarMonthChange: (month: CalendarMonth) => void;
  onSelectedRangeChange: (range: CalendarDateRange | null) => void;
  activeRangePreset: CalendarRangePreset | null;
  isAllTimePresetEnabled: boolean;
  onRangePresetSelect: (preset: CalendarRangePreset) => void;
  onDataChange?: () => void;
};

type DiscrepancyModalState = {
  month: CalendarMonth;
  discrepancies: EnterpriseScheduleDiscrepancy[];
  selectedDate: LocalDateString;
};

type DiscrepancyReviewBatch = Omit<DiscrepancyModalState, 'selectedDate'>;

const shiftTypeLabels: Record<ShiftType, string> = {
  first: '1 зміна',
  second: '2 зміна'
};

const getCountForm = (
  count: number,
  forms: readonly [one: string, few: string, many: string]
): string => {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return forms[2];
  }

  if (lastDigit === 1) {
    return forms[0];
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return forms[1];
  }

  return forms[2];
};

const formatImportShiftCount = (count: number): string =>
  `${count} ${getCountForm(count, ['зміну', 'зміни', 'змін'])}`;

const formatInvalidRecordCount = (count: number): string =>
  `${count} ${getCountForm(count, [
    'невалідний запис',
    'невалідні записи',
    'невалідних записів'
  ])}`;

const formatDurationDifference = (minutes: number): string => {
  const sign = minutes > 0 ? '+' : minutes < 0 ? '-' : '';
  const absoluteMinutes = Math.abs(minutes);

  return absoluteMinutes < 60
    ? `${sign}${absoluteMinutes} хв`
    : `${sign}${formatDurationMinutes(absoluteMinutes)}`;
};

const getScheduleStartTime = (item: EnterpriseScheduleItem): string =>
  item.enterpriseStartTime ?? item.plannedStartTime;

const getScheduleEndTime = (item: EnterpriseScheduleItem): string =>
  item.enterpriseEndTime ?? item.plannedEndTime;

const toDateKey = (year: number, month: number, day: number): LocalDateString =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const getMonthRange = (
  year: number,
  month: number
): { start: LocalDateString; end: LocalDateString } => ({
  start: toDateKey(year, month, 1),
  end: toDateKey(year, month, new Date(year, month, 0).getDate())
});

const getSelectedRangeBounds = (
  range: CalendarDateRange
): { start: LocalDateString; end: LocalDateString } => ({
  start: range.start,
  end: range.end ?? range.start
});

const getNextSelectedRange = (
  current: CalendarDateRange | null,
  date: LocalDateString
): CalendarDateRange => {
  if (!current || current.end) {
    return {
      start: date,
      end: null
    };
  }

  if (date < current.start) {
    return {
      start: date,
      end: current.start
    };
  }

  return {
    start: current.start,
    end: date
  };
};

const getActualShiftDurationMinutes = (shift: Shift): number => {
  if (!shift.endTime) {
    return 0;
  }

  return Math.max(
    0,
    Math.round((new Date(shift.endTime).getTime() - new Date(shift.startTime).getTime()) / 60_000)
  );
};

const getVisibleMonthlySalary = (settings: Settings, shifts: Shift[]): number => {
  const latestShift = [...shifts].sort((left, right) => right.date.localeCompare(left.date))[0];

  return latestShift
    ? calculateMonthlySalaryFromHourlyRate(latestShift.baseHourlyRateSnapshot, latestShift.date)
    : settings.monthlySalary;
};

const getMonthDate = ({ year, month }: CalendarMonth): LocalDateString =>
  `${year}-${String(month).padStart(2, '0')}-01`;

const getWarningFacts = (
  warning: ScheduleControlWarning
): Array<{
  key: 'late' | 'early';
  label: string;
  value: string;
}> => [
  ...(warning.lateArrivalMinutes > 0
    ? [
        {
          key: 'late' as const,
          label: 'Запізнення',
          value: formatShortMinuteDuration(warning.lateArrivalMinutes)
        }
      ]
    : []),
  ...(warning.earlyExitMinutes > 0
    ? [
        {
          key: 'early' as const,
          label: 'Ранній вихід',
          value: formatShortMinuteDuration(warning.earlyExitMinutes)
        }
      ]
    : [])
];

export function SchedulePage({
  settings,
  calendarMonth,
  selectedRange,
  onCalendarMonthChange,
  onSelectedRangeChange,
  activeRangePreset,
  isAllTimePresetEnabled,
  onRangePresetSelect,
  onDataChange
}: SchedulePageProps) {
  const importInputRef = useRef<HTMLInputElement>(null);
  const pendingActionIdRef = useRef<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [pdfParseResult, setPdfParseResult] = useState<EnterpriseSchedulePdfParseResult | null>(null);
  const [scheduleItems, setScheduleItems] = useState<EnterpriseScheduleItem[]>([]);
  const [calendarScheduleItems, setCalendarScheduleItems] = useState<EnterpriseScheduleItem[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [calendarShifts, setCalendarShifts] = useState<Shift[]>([]);
  const [reviewedWarnings, setReviewedWarnings] = useState<ReviewedScheduleWarning[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isReadingPdf, setIsReadingPdf] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [discrepancyModal, setDiscrepancyModal] = useState<DiscrepancyModalState | null>(null);
  const [discrepancyReviewQueue, setDiscrepancyReviewQueue] = useState<DiscrepancyReviewBatch[]>([]);
  const [pendingImportMessage, setPendingImportMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canImport =
    pdfParseResult !== null &&
    pdfParseResult.items.length > 0 &&
    !isReadingPdf &&
    !isImporting;
  const calendarMonthRange = useMemo(
    () => getMonthRange(calendarMonth.year, calendarMonth.month),
    [calendarMonth]
  );
  const loadedDateRange = useMemo(
    () =>
      selectedRange
        ? getSelectedRangeBounds(selectedRange)
        : calendarMonthRange,
    [selectedRange, calendarMonthRange]
  );
  const periodWorkedMinutes = useMemo(
    () => shifts.reduce((total, shift) => total + getActualShiftDurationMinutes(shift), 0),
    [shifts]
  );
  const periodNormMinutes = useMemo(
    () => countWeekdaysInDateRange(loadedDateRange.start, loadedDateRange.end) * 8 * 60,
    [loadedDateRange]
  );
  const visibleMonthlySalary = useMemo(
    () => getVisibleMonthlySalary(settings, calendarShifts),
    [settings, calendarShifts]
  );
  const visibleHourlyRate = useMemo(
    () => calculateHourlyRateFromMonthlySalary(visibleMonthlySalary, getMonthDate(calendarMonth)),
    [calendarMonth, visibleMonthlySalary]
  );
  const scheduleControl = useMemo(
    () => calculateScheduleControlSummary(shifts),
    [shifts]
  );
  const unreviewedWarnings = useMemo(() => {
    const reviewedFingerprintByShiftId = new Map(
      reviewedWarnings.map((review) => [review.shiftId, review.fingerprint])
    );

    return scheduleControl.warnings.filter(
      (warning) =>
        reviewedFingerprintByShiftId.get(warning.shiftId) !== warning.fingerprint
    );
  }, [reviewedWarnings, scheduleControl.warnings]);

  const loadSchedule = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [
        nextScheduleItems,
        nextShifts,
        nextCalendarScheduleItems,
        nextCalendarShifts,
        nextReviewedWarnings
      ] =
        await Promise.all([
          getEnterpriseScheduleBetween(
            enterpriseScheduleRepository,
            loadedDateRange.start,
            loadedDateRange.end
          ),
          getShiftsBetween(shiftRepository, loadedDateRange.start, loadedDateRange.end),
          getEnterpriseScheduleBetween(
            enterpriseScheduleRepository,
            calendarMonthRange.start,
            calendarMonthRange.end
          ),
          getShiftsBetween(shiftRepository, calendarMonthRange.start, calendarMonthRange.end),
          scheduleWarningReviewRepository.getAll()
        ]);

      setScheduleItems(nextScheduleItems);
      setShifts(nextShifts);
      setCalendarScheduleItems(nextCalendarScheduleItems);
      setCalendarShifts(nextCalendarShifts);
      setReviewedWarnings(nextReviewedWarnings);
    } catch {
      setError('Не вдалося завантажити графік.');
    } finally {
      setIsLoading(false);
    }
  }, [calendarMonthRange, loadedDateRange]);

  useEffect(() => {
    void loadSchedule();
  }, [loadSchedule]);

  useEffect(() => {
    if (!message) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setMessage(null);
    }, 3_500);

    return () => window.clearTimeout(timeoutId);
  }, [message]);

  const moveMonth = (direction: -1 | 1) => {
    const next = new Date(calendarMonth.year, calendarMonth.month - 1 + direction, 1);

    onCalendarMonthChange({
      year: next.getFullYear(),
      month: next.getMonth() + 1
    });
    onSelectedRangeChange(null);
  };

  const selectDate = (date: LocalDateString) => {
    const [year, month] = date.split('-').map(Number);
    const isOutsideVisibleMonth = year !== calendarMonth.year || month !== calendarMonth.month;

    if (isOutsideVisibleMonth) {
      onCalendarMonthChange({ year, month });
    }

    onSelectedRangeChange(getNextSelectedRange(selectedRange, date));
  };

  const getComparisonForMonth = async (month: CalendarMonth) => {
    const monthRange = getMonthRange(month.year, month.month);
    const [monthScheduleItems, monthShifts] = await Promise.all([
      getEnterpriseScheduleBetween(
        enterpriseScheduleRepository,
        monthRange.start,
        monthRange.end
      ),
      getShiftsBetween(shiftRepository, monthRange.start, monthRange.end)
    ]);

    return calculateEnterpriseScheduleComparison(monthScheduleItems, monthShifts);
  };

  const openDiscrepancyModal = (
    month: CalendarMonth,
    discrepancies: EnterpriseScheduleDiscrepancy[]
  ) => {
    const selectedDate = discrepancies[0]?.date;

    if (!selectedDate) {
      return;
    }

    setDiscrepancyModal({
      month,
      discrepancies,
      selectedDate
    });
  };

  const beginPendingAction = (actionId: string): boolean => {
    if (pendingActionIdRef.current !== null) {
      return false;
    }

    pendingActionIdRef.current = actionId;
    setPendingActionId(actionId);
    return true;
  };

  const finishPendingAction = (actionId: string) => {
    if (pendingActionIdRef.current !== actionId) {
      return;
    }

    pendingActionIdRef.current = null;
    setPendingActionId(null);
  };

  const refreshDiscrepancyModal = async (month: CalendarMonth) => {
    const nextComparison = await getComparisonForMonth(month);

    if (nextComparison.discrepancies.length === 0) {
      const [nextBatch, ...remainingBatches] = discrepancyReviewQueue;

      if (nextBatch) {
        setDiscrepancyReviewQueue(remainingBatches);
        openDiscrepancyModal(nextBatch.month, nextBatch.discrepancies);
        return;
      }

      setDiscrepancyModal(null);
      setMessage(pendingImportMessage ?? 'Усі розбіжності графіка опрацьовано.');
      setPendingImportMessage(null);
      return;
    }

    setDiscrepancyModal((current) => {
      const selectedDateStillExists = nextComparison.discrepancies.some(
        (discrepancy) => discrepancy.date === current?.selectedDate
      );

      return {
        month,
        discrepancies: nextComparison.discrepancies,
        selectedDate: selectedDateStillExists
          ? current?.selectedDate ?? nextComparison.discrepancies[0].date
          : nextComparison.discrepancies[0].date
      };
    });
  };

  const closeDiscrepancyModal = () => {
    if (pendingActionIdRef.current !== null) {
      return;
    }

    setDiscrepancyModal(null);
    setDiscrepancyReviewQueue([]);

    if (pendingImportMessage) {
      setMessage(pendingImportMessage);
      setPendingImportMessage(null);
    }
  };

  const openImportPicker = () => {
    if (!importInputRef.current || isReadingPdf || isImporting) {
      return;
    }

    importInputRef.current.value = '';
    importInputRef.current.click();
  };

  const readSchedulePdf = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    setSelectedFileName(file.name);
    setPdfParseResult(null);
    setIsReadingPdf(true);
    setMessage(null);
    setError(null);

    try {
      setPdfParseResult(await parseEnterpriseSchedulePdf(file));
    } catch (readError) {
      setError(
        readError instanceof Error
          ? readError.message
          : 'Не вдалося прочитати PDF. Оберіть інший файл.'
      );
    } finally {
      setIsReadingPdf(false);
    }
  };

  const importSchedule = async () => {
    if (!canImport || !pdfParseResult) {
      return;
    }

    const invalidRecordsWarning =
      pdfParseResult.errors.length > 0
        ? ` ${formatInvalidRecordCount(pdfParseResult.errors.length)} буде пропущено.`
        : '';
    const confirmed = window.confirm(
      `Імпортувати ${formatImportShiftCount(pdfParseResult.items.length)} із «${pdfParseResult.fileName}»?${invalidRecordsWarning} Відсутні зміни буде створено, а наявні не буде перезаписано без вашого рішення.`
    );

    if (!confirmed) {
      return;
    }

    setIsImporting(true);
    setMessage(null);
    setError(null);

    try {
      const result = await importParsedEnterpriseSchedule(
        enterpriseScheduleRepository,
        pdfParseResult,
        toLocalIsoString(new Date()),
        {
          shiftRepository,
          settings
        }
      );
      const importedMonths = getImportedMonths(result.items);
      const primaryMonth = getPrimaryImportedMonth(result.items);
      const comparisonBatches = await Promise.all(
        importedMonths.map(async ({ year, month }) => {
          const calendarMonth = { year, month };
          const comparison = await getComparisonForMonth(calendarMonth);

          return {
            month: calendarMonth,
            discrepancies: comparison.discrepancies
          };
        })
      );
      const reviewBatches = comparisonBatches.filter(
        (batch) => batch.discrepancies.length > 0
      );
      const importMessage = `Збережено записів: ${result.savedCount}. Створено змін: ${result.createdShiftCount}. Пропущено порожніх днів: ${result.skippedEmptyCount}. Помилок: ${result.errors.length}.`;

      if (reviewBatches.length > 0) {
        const [firstBatch, ...remainingBatches] = reviewBatches;
        setPendingImportMessage(importMessage);
        setDiscrepancyReviewQueue(remainingBatches);
        openDiscrepancyModal(firstBatch.month, firstBatch.discrepancies);
      } else {
        setMessage(importMessage);
      }

      onDataChange?.();
      onSelectedRangeChange(null);
      if (primaryMonth) {
        onCalendarMonthChange(primaryMonth);
      }
      setSelectedFileName(null);
      setPdfParseResult(null);
      if (importInputRef.current) {
        importInputRef.current.value = '';
      }
      await loadSchedule();
    } catch {
      setError('Не вдалося зберегти графік.');
    } finally {
      setIsImporting(false);
    }
  };

  const syncDiscrepancy = async (discrepancyId: string, shiftId: string, scheduleId: string) => {
    if (!beginPendingAction(discrepancyId)) {
      return;
    }

    setMessage(null);
    setError(null);

    try {
      await syncShiftWithEnterpriseSchedule(
        shiftRepository,
        enterpriseScheduleRepository,
        shiftId,
        scheduleId
      );
      setMessage('Зміну синхронізовано з графіком підприємства.');
      await loadSchedule();
      if (discrepancyModal) {
        await refreshDiscrepancyModal(discrepancyModal.month);
      }
    } catch {
      setError('Не вдалося синхронізувати зміну.');
    } finally {
      finishPendingAction(discrepancyId);
    }
  };

  const skipDiscrepancy = async (discrepancyId: string, scheduleId: string) => {
    if (!beginPendingAction(discrepancyId)) {
      return;
    }

    setMessage(null);
    setError(null);

    try {
      await skipEnterpriseScheduleDiscrepancy(enterpriseScheduleRepository, scheduleId);
      setMessage('Розбіжність позначено як пропущену.');
      await loadSchedule();
      if (discrepancyModal) {
        await refreshDiscrepancyModal(discrepancyModal.month);
      }
    } catch {
      setError('Не вдалося пропустити розбіжність.');
    } finally {
      finishPendingAction(discrepancyId);
    }
  };

  const markWarningReviewed = async (warning: ScheduleControlWarning) => {
    if (!beginPendingAction(warning.id)) {
      return;
    }

    setMessage(null);
    setError(null);

    try {
      const review = await scheduleWarningReviewRepository.markReviewed({
        shiftId: warning.shiftId,
        fingerprint: warning.fingerprint,
        reviewedAt: toLocalIsoString(new Date())
      });

      setReviewedWarnings((current) => [
        ...current.filter((item) => item.shiftId !== review.shiftId),
        review
      ]);
      setMessage('Попередження позначено як переглянуте.');
    } catch {
      setError('Не вдалося позначити попередження як переглянуте.');
    } finally {
      finishPendingAction(warning.id);
    }
  };

  const selectedModalDiscrepancy = discrepancyModal
    ? discrepancyModal.discrepancies.find(
      (discrepancy) => discrepancy.date === discrepancyModal.selectedDate
    ) ?? null
    : null;

  return (
    <>
      <MonthCalendar
        year={calendarMonth.year}
        month={calendarMonth.month}
        salaryLabel={String(shifts.length)}
        salaryTitle="Змін"
        shiftCount={formatDurationClock(periodWorkedMinutes)}
        shiftCountTitle="Відробив"
        hoursLabel={formatDurationClock(periodNormMinutes)}
        hoursTitle="Норма"
        shifts={calendarScheduleItems.map((item) => ({ id: item.id, date: item.date }))}
        selectedRange={selectedRange}
        onPreviousMonth={() => moveMonth(-1)}
        onNextMonth={() => moveMonth(1)}
        onDateSelect={selectDate}
        activeRangePreset={activeRangePreset}
        isAllTimePresetEnabled={isAllTimePresetEnabled}
        onRangePresetSelect={onRangePresetSelect}
      />

      <section className="schedule-page__rate-card" aria-label="Ставка за обраний місяць">
        <span>Ставка за обраний місяць</span>
        <strong>{formatHourlyRate(visibleHourlyRate, settings.incognitoEnabled)}</strong>
      </section>

      {unreviewedWarnings.length > 0 ? (
        <section
          className="schedule-page__control"
          aria-labelledby="schedule-control-title"
        >
          <header className="schedule-page__control-header">
            <span className="schedule-page__control-icon" aria-hidden="true">
              <AlertTriangle size={19} />
            </span>
            <div>
              <p className="schedule-page__label">Контроль графіка</p>
              <h2 id="schedule-control-title">Попередження</h2>
            </div>
            <strong>{unreviewedWarnings.length}</strong>
          </header>

          <div className="schedule-page__warning-list">
            {unreviewedWarnings.map((warning) => (
              <article className="schedule-page__warning" key={warning.id}>
                <time dateTime={warning.date}>
                  {formatShortNumericDate(warning.date)}
                </time>
                <div className="schedule-page__warning-facts">
                  {getWarningFacts(warning).map((fact) => (
                    <span data-tone={fact.key} key={fact.key}>
                      <small>{fact.label}</small>
                      <strong>{fact.value}</strong>
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={pendingActionId === warning.id}
                  onClick={() => void markWarningReviewed(warning)}
                >
                  <Check aria-hidden="true" size={17} />
                  <span>
                    {pendingActionId === warning.id
                      ? 'Збереження...'
                      : 'Переглянуто'}
                  </span>
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {isLoading || scheduleItems.length === 0 ? (
        <section className="schedule-page__list" aria-labelledby="schedule-list-title">
          <div className="schedule-page__list-heading">
            <div>
              <p className="schedule-page__label">Записи</p>
              <h2 id="schedule-list-title">Графік підприємства</h2>
            </div>
            <span>{scheduleItems.length}</span>
          </div>
          {isLoading ? (
            <p className="schedule-page__muted">Завантаження графіка...</p>
          ) : (
            <p className="schedule-page__muted">
              {selectedRange
                ? 'У вибраному діапазоні записів немає.'
                : 'За цей місяць записів немає.'}
            </p>
          )}
        </section>
      ) : (
        <details className="schedule-page__list">
          <summary className="schedule-page__list-heading">
            <div>
              <p className="schedule-page__label">Записи</p>
              <h2>Графік підприємства</h2>
            </div>
            <span>{scheduleItems.length}</span>
            <ChevronDown aria-hidden="true" size={19} />
          </summary>
          <div className="schedule-page__items">
            {scheduleItems.map((item) => (
              <article className="schedule-page__item" key={item.id}>
                <time dateTime={item.date}>{formatShortNumericDate(item.date)}</time>
                <span className="schedule-page__chip">{shiftTypeLabels[item.shiftType]}</span>
                <strong>
                  {getScheduleStartTime(item)}-{getScheduleEndTime(item)}
                </strong>
              </article>
            ))}
          </div>
        </details>
      )}

      <section className="schedule-page__import" aria-labelledby="schedule-import-title">
        <div>
          <p className="schedule-page__label">Імпорт</p>
          <h2 id="schedule-import-title">Табель підприємства з PDF</h2>
        </div>

        <p className="schedule-page__muted">
          Оберіть PDF із листа «Ваш табель робочого часу». Файл обробляється лише на цьому пристрої.
        </p>

        <input
          ref={importInputRef}
          className="schedule-page__file-input"
          type="file"
          accept="application/pdf,.pdf"
          disabled={isReadingPdf || isImporting}
          onChange={(event) => void readSchedulePdf(event.target.files?.[0])}
        />

        <button
          className="schedule-page__file-button"
          type="button"
          disabled={isReadingPdf || isImporting}
          onClick={openImportPicker}
        >
          {isReadingPdf ? (
            <LoaderCircle className="schedule-page__spinner" aria-hidden="true" size={20} />
          ) : (
            <FileUp aria-hidden="true" size={20} />
          )}
          <span>
            {isReadingPdf
              ? 'Читання PDF...'
              : selectedFileName
                ? 'Обрати інший PDF'
                : 'Обрати PDF'}
          </span>
        </button>

        {selectedFileName ? (
          <div className="schedule-page__selected-file" aria-live="polite">
            <FileText aria-hidden="true" size={20} />
            <div>
              <strong>{selectedFileName}</strong>
              <span>
                {isReadingPdf
                  ? 'Перевіряємо вміст...'
                  : pdfParseResult
                    ? `${pdfParseResult.pageCount} стор. · файл готовий до імпорту`
                    : 'Файл не готовий до імпорту'}
              </span>
            </div>
          </div>
        ) : null}

        {pdfParseResult ? (
          <div className="schedule-page__summary-row" aria-live="polite">
            <span data-status="success">Валідні: {pdfParseResult.items.length}</span>
            <span data-status={pdfParseResult.skippedEmptyCount > 0 ? 'warning' : 'neutral'}>
              Порожні: {pdfParseResult.skippedEmptyCount}
            </span>
            <span data-status={pdfParseResult.errors.length > 0 ? 'error' : 'neutral'}>
              Помилки: {pdfParseResult.errors.length}
            </span>
          </div>
        ) : null}

        {pdfParseResult && pdfParseResult.errors.length > 0 ? (
          <div className="schedule-page__errors" role="alert">
            {pdfParseResult.errors.map((parseError) => (
              <article key={`${parseError.line}-${parseError.message}`}>
                <strong>Запис біля рядка {parseError.line}</strong>
                <p>{parseError.message}</p>
              </article>
            ))}
          </div>
        ) : null}

        <button
          className="schedule-page__primary-button"
          type="button"
          disabled={!canImport}
          onClick={importSchedule}
        >
          <Upload aria-hidden="true" size={20} />
          <span>
            {isImporting
              ? 'Збереження...'
              : pdfParseResult
                ? `Імпортувати ${formatImportShiftCount(pdfParseResult.items.length)}`
                : 'Імпортувати'}
          </span>
        </button>

        {error ? (
          <p className="schedule-page__error" role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {discrepancyModal ? (
        <div className="schedule-page__modal" role="dialog" aria-modal="true" aria-labelledby="schedule-discrepancy-modal-title">
          <section className="schedule-page__modal-panel">
            <header className="schedule-page__modal-header">
              <div>
                <p className="schedule-page__label">Опрацювання</p>
                <h2 id="schedule-discrepancy-modal-title">Розбіжності графіка</h2>
              </div>
              <button
                className="schedule-page__modal-close"
                type="button"
                aria-label="Закрити модальне вікно"
                disabled={pendingActionId !== null}
                onClick={closeDiscrepancyModal}
              >
                <X aria-hidden="true" size={20} />
              </button>
            </header>

            <MonthCalendar
              year={discrepancyModal.month.year}
              month={discrepancyModal.month.month}
              salaryLabel=""
              shiftCount=""
              hoursLabel=""
              shifts={discrepancyModal.discrepancies.map((discrepancy) => ({
                id: discrepancy.id,
                date: discrepancy.date
              }))}
              selectedRange={{ start: discrepancyModal.selectedDate, end: null }}
              onPreviousMonth={() => undefined}
              onNextMonth={() => undefined}
              onDateSelect={(date) =>
                setDiscrepancyModal((current) =>
                  current
                    ? {
                        ...current,
                        selectedDate: date
                      }
                    : current
                )
              }
              titleId="schedule-discrepancy-calendar-title"
              hideSummary
              hideNavigation
              isCompact
              selectionMode="single"
            />

            <section className="schedule-page__modal-detail" aria-label="Деталі розбіжності">
              {selectedModalDiscrepancy ? (
                <>
                  <div className="schedule-page__modal-detail-title">
                    <strong>{formatDate(selectedModalDiscrepancy.date)}</strong>
                    <span>
                      {formatMoney(
                        selectedModalDiscrepancy.salaryDifferenceAmount,
                        settings.incognitoEnabled
                      )}
                    </span>
                  </div>

                  <dl className="schedule-page__diff-grid">
                    <div>
                      <dt>Фактичний час</dt>
                      <dd>
                        {formatTime(selectedModalDiscrepancy.actualStartTime)}-
                        {formatTime(selectedModalDiscrepancy.actualEndTime)}
                      </dd>
                    </div>
                    <div>
                      <dt>Час підприємства</dt>
                      <dd>
                        {formatTime(selectedModalDiscrepancy.enterpriseStartTime)}-
                        {formatTime(selectedModalDiscrepancy.enterpriseEndTime)}
                      </dd>
                    </div>
                    <div>
                      <dt>Різниця тривалості</dt>
                      <dd>{formatDurationDifference(selectedModalDiscrepancy.durationDifferenceMinutes)}</dd>
                    </div>
                    <div>
                      <dt>Різниця зарплати</dt>
                      <dd>
                        {formatMoney(
                          selectedModalDiscrepancy.salaryDifferenceAmount,
                          settings.incognitoEnabled
                        )}
                      </dd>
                    </div>
                  </dl>

                  <div className="schedule-page__actions">
                    <button
                      type="button"
                      disabled={pendingActionId !== null}
                      onClick={() =>
                        void syncDiscrepancy(
                          selectedModalDiscrepancy.id,
                          selectedModalDiscrepancy.shiftId,
                          selectedModalDiscrepancy.scheduleId
                        )
                      }
                    >
                      <RefreshCw
                        className={pendingActionId !== null ? 'schedule-page__spinner' : undefined}
                        aria-hidden="true"
                        size={18}
                      />
                      <span>
                        {pendingActionId !== null
                          ? 'Збереження...'
                          : 'Синхронізувати'}
                      </span>
                    </button>
                    <button
                      type="button"
                      disabled={pendingActionId !== null}
                      onClick={() =>
                        void skipDiscrepancy(
                          selectedModalDiscrepancy.id,
                          selectedModalDiscrepancy.scheduleId
                        )
                      }
                    >
                      <SkipForward aria-hidden="true" size={18} />
                      <span>Пропустити</span>
                    </button>
                  </div>
                </>
              ) : (
                <p className="schedule-page__muted">Оберіть дату з крапкою, щоб переглянути деталі.</p>
              )}
            </section>
          </section>
        </div>
      ) : null}

      {message ? (
        <div className="schedule-page__toast" role="status" aria-live="polite">
          {message}
        </div>
      ) : null}
    </>
  );
}
